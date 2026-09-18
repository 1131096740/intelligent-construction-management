import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Prisma, type ProjectCloseStageVersion } from "@prisma/client";
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  buildProjectCloseStageTimeline,
  type RoleKey,
  type ProjectStage
} from "@jiangkong/shared-domain";

import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { resolveProjectCloseImpactPolicy } from "./project-close-impact-policy";
import { projectParticipationChangeFingerprint } from "./project-close-impact-invalidation";

type StageVersionSnapshot = Pick<
  ProjectCloseStageVersion,
  | "id"
  | "stageKey"
  | "revision"
  | "status"
  | "prerequisiteStageVersionIds"
  | "projectionReadAt"
  | "projectionCutoffAt"
  | "projectionFingerprint"
  | "amountSnapshot"
  | "stateSnapshot"
  | "basisSnapshot"
  | "confirmedByUserId"
  | "confirmedAt"
>;

export type CompleteProjectCloseStageInput = Readonly<{
  stageKey: string;
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: Readonly<{
    summary: string;
    evidenceFileIds: readonly string[];
  }>;
}>;

type ConfirmationBasis = CompleteProjectCloseStageInput["basis"];
type DownstreamCostSpecialty = "contract" | "finance";

export type AttestDownstreamCostInput = Readonly<{
  specialty: string;
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: ConfirmationBasis;
}>;

export type ConfirmFinalProfitInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  submissionId: string;
}>;

export type SubmitFinalProfitInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: ConfirmationBasis;
}>;

export type SubmitDistributionInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: ConfirmationBasis;
  lines: readonly Readonly<{
    projectParticipatingCompanyId: string;
    finalShareCents: string;
  }>[];
}>;

export type ConfirmDistributionInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  submissionId: string;
}>;

export type CreateTemporaryDistributionInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: ConfirmationBasis;
  projectParticipatingCompanyId: string;
  amountCents: string;
}>;

export type ReconcileProjectCloseImpactsInput = Readonly<{
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: ConfirmationBasis;
}>;

type CompleteStageResult = Readonly<{
  stageVersionId: string;
  stageKey: ProjectStage;
  revision: number;
  status: "completed";
  confirmedAt: string;
}>;

const STAGE_CONFIRMATION_ROLES: Readonly<Record<ProjectStage, readonly RoleKey[]>> = {
  construction_completed: ["project_manager"],
  owner_settlement_completed: ["contract_director"],
  downstream_cost_confirmed: ["contract_director", "finance_director"],
  tax_and_enterprise_clearing_completed: ["finance_director"],
  final_profit_confirmed: ["chairman", "general_manager"],
  profit_distribution_completed: ["chairman", "general_manager"],
  project_funds_cleared: ["finance_director"]
};

const STAGE_RESPONSIBILITY_LABELS: Readonly<Record<ProjectStage, string>> = {
  construction_completed: "项目负责人",
  owner_settlement_completed: "合同负责人",
  downstream_cost_confirmed: "合同负责人、财务负责人分别确认",
  tax_and_enterprise_clearing_completed: "财务负责人",
  final_profit_confirmed: "董事长或总经理",
  profit_distribution_completed: "董事长或总经理",
  project_funds_cleared: "财务负责人"
};

const GENERIC_COMPLETION_STAGES = new Set<ProjectStage>([
  "construction_completed",
  "owner_settlement_completed",
  "tax_and_enterprise_clearing_completed",
  "project_funds_cleared"
]);

@Injectable()
export class ProjectCloseProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projections: OperatingProjectionService,
    private readonly visibility: ProjectVisibilityService,
    private readonly audit: AuditService,
    private readonly operatingLedger: OperatingLedgerService = null as never
  ) {}

  async getWorkbench(actorUserId: string, projectId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [
        projection,
        versions,
        roleKeysByProject,
        attestations,
        profitConfirmations,
        distributions,
        participatingCompanies,
        temporaryDistributions,
        impacts,
        decisionSubmissions
      ] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }],
          select: {
            id: true,
            stageKey: true,
            revision: true,
            status: true,
            prerequisiteStageVersionIds: true,
            projectionReadAt: true,
            projectionCutoffAt: true,
            projectionFingerprint: true,
            amountSnapshot: true,
            stateSnapshot: true,
            basisSnapshot: true,
            confirmedByUserId: true,
            confirmedAt: true
          }
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(
          tx,
          actorUserId,
          [projectId]
        ),
        tx.projectCloseProfessionalAttestation.findMany({
          where: { projectId },
          orderBy: [{ specialty: "asc" }, { revision: "desc" }],
          select: {
            id: true,
            specialty: true,
            revision: true,
            projectionFingerprint: true,
            basisSnapshot: true,
            attestedByUserId: true,
            attestedAt: true
          }
        }),
        tx.projectCloseProfitConfirmation.findMany({
          where: { projectId },
          orderBy: { revision: "desc" },
          select: {
            id: true,
            stageVersionId: true,
            revision: true,
            finalProfitCents: true,
            projectionFingerprint: true,
            formulaVersion: true,
            basisSnapshot: true,
            confirmedByUserId: true,
            confirmedAt: true
          }
        }),
        tx.projectCloseDistribution.findMany({
          where: { projectId },
          orderBy: { revision: "desc" },
          include: {
            lines: { orderBy: { companyNameSnapshot: "asc" } },
            authorizations: true
          }
        }),
        tx.projectParticipatingCompany.findMany({
          where: { projectId },
          orderBy: { companyNameSnapshot: "asc" },
          select: {
            id: true,
            companyEntityId: true,
            companyEntityVersionId: true,
            companyNameSnapshot: true,
            effectiveFrom: true,
            endedAt: true
          }
        }),
        tx.projectTemporaryProfitDistribution.findMany({
          where: { projectId },
          orderBy: { revision: "desc" }
        }),
        tx.projectCloseImpact.findMany({
          where: { projectId },
          orderBy: { observedAt: "desc" }
        }),
        tx.projectCloseDecisionSubmission.findMany({
          where: { projectId },
          orderBy: [{ decisionKind: "asc" }, { revision: "desc" }]
        })
      ]);
      const latestByStage = latestStageVersions(versions);
      const completedStages = PROJECT_STAGES.filter(
        (stage) => latestByStage.get(stage)?.status === "completed"
      );
      const affectedStages = PROJECT_STAGES.filter(
        (stage) => latestByStage.get(stage)?.status === "needs_reconfirmation"
      );
      const roleKeys = roleKeysByProject.get(projectId) ?? [];
      const technicalAdministrator = roleKeys.includes("super_admin");
      const timeline = buildProjectCloseStageTimeline(completedStages, affectedStages);
      const currentProfitConfirmation = profitConfirmations.find(
        (row) => row.stageVersionId === latestByStage.get("final_profit_confirmed")?.id
      );
      const currentDistribution = distributions.find(
        (row) => row.stageVersionId === latestByStage.get("profit_distribution_completed")?.id
      );
      const currentFinalProfitSubmission = decisionSubmissions.find(
        (row) => row.decisionKind === "final_profit" &&
          row.projectionFingerprint === projection.fingerprint
      );
      const currentDistributionSubmission = decisionSubmissions.find(
        (row) => row.decisionKind === "distribution" &&
          row.projectionFingerprint === projection.fingerprint
      );

      return {
        schema: "project_close_profit/V1" as const,
        projectId,
        canReconcileImpacts:
          !technicalAdministrator && roleKeys.includes("finance_director"),
        availableActions: technicalAdministrator
          ? []
          : [...new Set(timeline.flatMap((item, index) =>
              availableStageActions(
                item.stage,
                stageActionStatus(timeline, index),
                roleKeys,
                {
                  hasFinalProfitSubmission: Boolean(currentFinalProfitSubmission),
                  hasDistributionSubmission: Boolean(currentDistributionSubmission)
                }
              )
            ))],
        projection: {
          readAt: projection.readAt.toISOString(),
          cutoffAt: projection.cutoffAt.toISOString(),
          fingerprint: projection.fingerprint,
          view: projection.aggregate
        },
        stages: timeline.map((item, index) => ({
          key: item.stage,
          label: PROJECT_STAGE_LABELS[item.stage],
          status: item.status,
          responsibility: STAGE_RESPONSIBILITY_LABELS[item.stage],
          blockedReason: item.status === "pending" ? "前置阶段尚未正式完成" : null,
          currentVersion: stageVersionReadModel(latestByStage.get(item.stage)),
          availableActions: technicalAdministrator
            ? []
            : availableStageActions(
                item.stage,
                stageActionStatus(timeline, index),
                roleKeys,
                {
                  hasFinalProfitSubmission: Boolean(currentFinalProfitSubmission),
                  hasDistributionSubmission: Boolean(currentDistributionSubmission)
                }
              )
        })),
        downstreamCostAttestations: attestations.map((row) => ({
          ...row,
          attestedAt: row.attestedAt.toISOString()
        })),
        currentProfitConfirmation: currentProfitConfirmation
          ? {
              ...currentProfitConfirmation,
              finalProfitCents: currentProfitConfirmation.finalProfitCents.toString(),
              confirmedAt: currentProfitConfirmation.confirmedAt.toISOString()
            }
          : null,
        currentDistribution: currentDistribution
          ? distributionReadModel(currentDistribution)
          : null,
        currentDecisionSubmissions: {
          finalProfit: currentFinalProfitSubmission
            ? decisionSubmissionReadModel(currentFinalProfitSubmission)
            : null,
          distribution: currentDistributionSubmission
            ? decisionSubmissionReadModel(currentDistributionSubmission)
            : null
        },
        temporaryDistributions: temporaryDistributions.map((row) => ({
          id: row.id,
          projectParticipatingCompanyId: row.projectParticipatingCompanyId,
          companyEntityId: row.companyEntityId,
          companyName: row.companyNameSnapshot,
          amountCents: row.amountCents.toString(),
          projectionFingerprint: row.projectionFingerprint,
          createdByUserId: row.authorizedByUserId,
          createdAt: row.authorizedAt.toISOString()
        })),
        impacts: impacts.map((row) => ({
          id: row.id,
          reason: row.reason,
          affectedStageKeys: row.affectedStages,
          occurredAt: row.observedAt.toISOString()
        })),
        participatingCompanies: participatingCompanies
          .filter((row) => participantEffectiveAt(row, projection.cutoffAt))
          .map((row) => ({
          id: row.id,
          companyEntityId: row.companyEntityId,
          companyEntityVersionId: row.companyEntityVersionId,
          companyName: row.companyNameSnapshot
        })),
        history: {
          stageVersions: versions.map(stageVersionReadModel),
          profitConfirmations: profitConfirmations.map((row) => ({
            ...row,
            finalProfitCents: row.finalProfitCents.toString(),
            confirmedAt: row.confirmedAt.toISOString()
          })),
          distributions: distributions.map(distributionReadModel),
          decisionSubmissions: decisionSubmissions.map(decisionSubmissionReadModel)
        }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async completeStage(
    actorUserId: string,
    projectId: string,
    input: CompleteProjectCloseStageInput
  ): Promise<CompleteStageResult> {
    const stageKey = requiredStage(input.stageKey);
    if (!GENERIC_COMPLETION_STAGES.has(stageKey)) {
      throw new BadRequestException("该项目收口阶段必须使用专用确认操作");
    }
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const basis = {
      summary: requiredText(input.basis?.summary, "确认依据不能为空"),
      evidenceFileIds: Array.from(new Set(input.basis?.evidenceFileIds ?? [])).sort()
    };
    const payloadFingerprint = fingerprint({
      action: "project_close.stage.complete",
      projectId,
      stageKey,
      expectedProjectionFingerprint,
      basis
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await tx.projectCloseAggregate.upsert({
        where: { projectId },
        create: { projectId },
        update: {}
      });
      await tx.$queryRaw(Prisma.sql`
        SELECT "projectId"
        FROM "ProjectCloseAggregate"
        WHERE "projectId" = ${projectId}
        FOR UPDATE
      `);

      const existing = await tx.projectCloseCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) {
          throw new ConflictException("幂等键已用于不同的项目收口操作");
        }
        return existing.responseSnapshot as unknown as CompleteStageResult;
      }

      const [projection, versions, roleKeysByProject] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(
          tx,
          actorUserId,
          [projectId]
        )
      ]);
      if (projection.fingerprint !== expectedProjectionFingerprint) {
        throw new ConflictException("经营数据已经变化，请刷新后重新确认");
      }
      const latestByStage = latestStageVersions(versions);
      assertStageReady(versions, stageKey);
      const roleKeys = roleKeysByProject.get(projectId) ?? [];
      if (roleKeys.includes("super_admin") || (
        !STAGE_CONFIRMATION_ROLES[stageKey].some((role) => roleKeys.includes(role))
      )) {
        throw new ForbiddenException("当前岗位不能确认该项目收口阶段");
      }

      const previous = latestByStage.get(stageKey);
      const revision = (previous?.revision ?? 0) + 1;
      const created = await tx.projectCloseStageVersion.create({
        data: {
          projectId,
          stageKey,
          revision,
          status: "completed",
          previousVersionId: previous?.id,
          prerequisiteStageVersionIds: prerequisiteStageVersionIds(latestByStage, stageKey),
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          amountSnapshot: projectionAmountSnapshot(projection.projection),
          stateSnapshot: projectionStateSnapshot(projection.projection),
          basisSnapshot: basis,
          confirmedByUserId: actorUserId,
          confirmedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        },
        select: {
          id: true,
          stageKey: true,
          revision: true,
          status: true,
          confirmedAt: true
        }
      });
      await tx.projectCloseAggregate.update({
        where: { projectId },
        data: { revision: { increment: 1 } }
      });
      const response: CompleteStageResult = {
        stageVersionId: created.id,
        stageKey: created.stageKey as ProjectStage,
        revision: created.revision,
        status: "completed",
        confirmedAt: created.confirmedAt.toISOString()
      };
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          stageVersionId: created.id,
          action: "complete_stage",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.stage.complete",
        businessType: "project_close_stage",
        businessId: created.id,
        metadata: {
          projectId,
          stageKey,
          revision,
          projectionFingerprint: projection.fingerprint,
          payloadFingerprint
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async attestDownstreamCost(
    actorUserId: string,
    projectId: string,
    input: AttestDownstreamCostInput
  ) {
    const specialty = requiredSpecialty(input.specialty);
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const basis = normalizedBasis(input.basis);
    const payloadFingerprint = fingerprint({
      action: "project_close.downstream_cost.attest",
      projectId,
      specialty,
      expectedProjectionFingerprint,
      basis
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;

      const [projection, versions, roleKeysByProject, attestations] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
        tx.projectCloseProfessionalAttestation.findMany({
          where: { projectId },
          orderBy: [{ specialty: "asc" }, { revision: "desc" }]
        })
      ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      assertStageReady(versions, "downstream_cost_confirmed");
      const roleKeys = roleKeysByProject.get(projectId) ?? [];
      if (specialty === "contract") {
        if (
          roleKeys.includes("super_admin") ||
          !roleKeys.includes("contract_director")
        ) {
          throw new ForbiddenException("当前岗位不能完成该专业成本确认");
        }
      } else {
        assertExactRole(roleKeys, ["finance_director"], "当前岗位不能完成该专业成本确认");
      }

      const latestAttestations = latestProfessionalAttestations(attestations);
      const previousSameSpecialty = latestAttestations.get(specialty);
      const attestation = await tx.projectCloseProfessionalAttestation.create({
        data: {
          projectId,
          specialty,
          revision: (previousSameSpecialty?.revision ?? 0) + 1,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          basisSnapshot: basis,
          attestedByUserId: actorUserId,
          attestedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        },
        select: {
          id: true,
          specialty: true,
          revision: true,
          attestedAt: true
        }
      });
      const otherSpecialty: DownstreamCostSpecialty = specialty === "contract" ? "finance" : "contract";
      const counterpart = latestAttestations.get(otherSpecialty);
      let stageVersion: CompleteStageResult | null = null;
      if (counterpart?.projectionFingerprint === projection.fingerprint) {
        stageVersion = await appendCompletedStage(tx, {
          projectId,
          stageKey: "downstream_cost_confirmed",
          actorUserId,
          idempotencyKey,
          payloadFingerprint,
          projection,
          versions,
          basis: {
            summary: "合同与财务专业成本确认均已完成",
            evidenceFileIds: basis.evidenceFileIds,
            attestationIds: [counterpart.id, attestation.id].sort()
          }
        });
        await tx.projectCloseStageAttestationLink.createMany({
          data: [
            {
              stageVersionId: stageVersion.stageVersionId,
              attestationId: counterpart.id,
              specialty: otherSpecialty
            },
            {
              stageVersionId: stageVersion.stageVersionId,
              attestationId: attestation.id,
              specialty
            }
          ]
        });
      }
      const response = {
        attestationId: attestation.id,
        specialty,
        revision: attestation.revision,
        attestedAt: attestation.attestedAt.toISOString(),
        stageCompleted: Boolean(stageVersion),
        stageVersionId: stageVersion?.stageVersionId ?? null
      };
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          stageVersionId: stageVersion?.stageVersionId,
          action: "attest_downstream_cost",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.downstream_cost.attest",
        businessType: "project_close_professional_attestation",
        businessId: attestation.id,
        metadata: {
          projectId,
          specialty,
          projectionFingerprint: projection.fingerprint,
          stageVersionId: stageVersion?.stageVersionId ?? null
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submitFinalProfit(
    actorUserId: string,
    projectId: string,
    input: SubmitFinalProfitInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const basis = normalizedBasis(input.basis);
    const payloadFingerprint = fingerprint({
      action: "project_close.final_profit.submit",
      projectId,
      expectedProjectionFingerprint,
      basis
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [projection, versions, roleKeysByProject, participants, previous] =
        await Promise.all([
          this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
          tx.projectCloseStageVersion.findMany({
            where: { projectId },
            orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
          }),
          this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
          tx.projectParticipatingCompany.findMany({ where: { projectId } }),
          tx.projectCloseDecisionSubmission.findFirst({
            where: { projectId, decisionKind: "final_profit" },
            orderBy: { revision: "desc" }
          })
        ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      assertStageReady(versions, "final_profit_confirmed");
      assertExactRole(
        roleKeysByProject.get(projectId) ?? [],
        ["finance_director"],
        "仅财务负责人可以制作并提交最终盈亏确认单"
      );
      assertProjectionFinalizable(projection.projection);
      const finalProfitCents = requiredMoney(
        projection.projection.profitAndLoss.currentEstimatedProfitCents,
        "当前预计盈亏金额无效"
      );
      const participantSnapshot = participantDecisionSnapshot(participants, projection.cutoffAt);
      const latestVersions = latestStageVersions(versions);
      const submission = await tx.projectCloseDecisionSubmission.create({
        data: {
          projectId,
          decisionKind: "final_profit",
          revision: (previous?.revision ?? 0) + 1,
          previousSubmissionId: previous?.id,
          prerequisiteStageVersionIds: prerequisiteStageVersionIds(
            latestVersions,
            "final_profit_confirmed"
          ),
          profitConfirmationId: null,
          profitStageVersionId: null,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          amountSnapshot: projectionAmountSnapshot(projection.projection),
          stateSnapshot: projectionStateSnapshot(projection.projection),
          participantsSnapshot: participantSnapshot,
          proposalSnapshot: { finalProfitCents: finalProfitCents.toString() },
          basisSnapshot: basis,
          preparedByUserId: actorUserId,
          preparedAt: projection.readAt,
          submittedByUserId: actorUserId,
          submittedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        }
      });
      const response = decisionSubmissionReadModel(submission);
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          action: "submit_final_profit",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.final_profit.submit",
        businessType: "project_close_decision_submission",
        businessId: submission.id,
        metadata: {
          projectId,
          revision: submission.revision,
          projectionFingerprint: submission.projectionFingerprint
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmFinalProfit(
    actorUserId: string,
    projectId: string,
    input: ConfirmFinalProfitInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const submissionId = requiredUuid(input.submissionId);
    const payloadFingerprint = fingerprint({
      action: "project_close.final_profit.confirm",
      projectId,
      expectedProjectionFingerprint,
      submissionId
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [projection, versions, roleKeysByProject, previous, submission] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
        tx.projectCloseProfitConfirmation.findFirst({
          where: { projectId },
          orderBy: { revision: "desc" }
        }),
        tx.projectCloseDecisionSubmission.findUnique({
          where: { id: submissionId }
        })
      ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      assertStageReady(versions, "final_profit_confirmed");
      assertExactRole(
        roleKeysByProject.get(projectId) ?? [],
        ["chairman", "general_manager"],
        "仅董事长或总经理可以最终确认项目盈亏"
      );
      const decision = assertDecisionSubmission(
        submission,
        projectId,
        "final_profit",
        projection.fingerprint
      );
      assertFrozenPrerequisites(
        submission!.prerequisiteStageVersionIds,
        prerequisiteStageVersionIds(
          latestStageVersions(versions),
          "final_profit_confirmed"
        )
      );
      const finalProfitCents = decision.finalProfitCents;
      const stageVersion = await appendCompletedStage(tx, {
        projectId,
        stageKey: "final_profit_confirmed",
        actorUserId,
        idempotencyKey,
        payloadFingerprint,
        projection,
        versions,
        basis: decision.basisSnapshot
      });
      const confirmation = await tx.projectCloseProfitConfirmation.create({
        data: {
          projectId,
          stageVersionId: stageVersion.stageVersionId,
          submissionId: submission!.id,
          revision: (previous?.revision ?? 0) + 1,
          previousConfirmationId: previous?.id,
          finalProfitCents,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          formulaVersion: "operating_projection/V1-final-profit",
          amountSnapshot: projectionAmountSnapshot(projection.projection),
          sourceSnapshot: projectionStateSnapshot(projection.projection),
          basisSnapshot: decision.basisSnapshot,
          confirmedByUserId: actorUserId,
          confirmedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        },
        select: { id: true, revision: true, finalProfitCents: true, confirmedAt: true }
      });
      const response = {
        confirmationId: confirmation.id,
        stageVersionId: stageVersion.stageVersionId,
        revision: confirmation.revision,
        finalProfitCents: confirmation.finalProfitCents.toString(),
        confirmedAt: confirmation.confirmedAt.toISOString()
      };
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          stageVersionId: stageVersion.stageVersionId,
          action: "confirm_final_profit",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.final_profit.confirm",
        businessType: "project_close_profit_confirmation",
        businessId: confirmation.id,
        metadata: {
          projectId,
          finalProfitCents: confirmation.finalProfitCents.toString(),
          projectionFingerprint: projection.fingerprint
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createTemporaryDistribution(
    actorUserId: string,
    projectId: string,
    input: CreateTemporaryDistributionInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const projectParticipatingCompanyId = requiredText(
      input.projectParticipatingCompanyId,
      "暂分公司不能为空"
    );
    const amountCents = requiredPositiveMoney(input.amountCents, "暂分金额必须大于零");
    const basis = normalizedBasis(input.basis);
    const payloadFingerprint = fingerprint({
      action: "project_close.temporary_distribution.create",
      projectId,
      projectParticipatingCompanyId,
      amountCents,
      expectedProjectionFingerprint,
      basis
    });

    return translateProjectCloseConcurrencyConflict(this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [
        projection,
        versions,
        roleKeysByProject,
        participant,
        prior,
        project
      ] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
        tx.projectParticipatingCompany.findUnique({
          where: { id: projectParticipatingCompanyId }
        }),
        tx.projectTemporaryProfitDistribution.aggregate({
          where: { projectId },
          _sum: { amountCents: true },
          _max: { revision: true }
        }),
        tx.project.findUnique({
          where: { id: projectId },
          select: { isActive: true, operatingLedgerEffectiveDate: true }
        })
      ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      const affiliate = await tx.projectAffiliateAssignment.findFirst({
        where: {
          projectId,
          effectiveFrom: { lte: projection.cutoffAt },
          OR: [{ endedAt: null }, { endedAt: { gt: projection.cutoffAt } }]
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
        select: {
          id: true,
          businessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true
        }
      });
      const roles = roleKeysByProject.get(projectId) ?? [];
      if (roles.includes("super_admin") || !roles.includes("finance_director")) {
        throw new ForbiddenException("仅财务负责人可以登记暂分利润");
      }
      const latest = latestStageVersions(versions);
      if (
        latest.get("tax_and_enterprise_clearing_completed")?.status !== "completed" ||
        latest.get("final_profit_confirmed")?.status === "completed"
      ) {
        throw new ConflictException("暂分利润仅允许在税费清算完成且最终盈亏确认前登记");
      }
      if (!participant || participant.projectId !== projectId ||
          !participantEffectiveAt(participant, projection.cutoffAt)) {
        throw new BadRequestException("暂分对象必须是投影截止日有效的项目参与公司");
      }
      if (!project?.isActive || !project.operatingLedgerEffectiveDate || !affiliate) {
        throw new ConflictException("项目经营账或施工企业快照不完整，不能暂分利润");
      }
      const currentDistributable = requiredMoney(
        projection.projection.distribution.currentDistributableProfitCents,
        "当前可分配利润不完整，不能暂分"
      );
      if (amountCents > currentDistributable) {
        throw new ConflictException("暂分金额超过当前可分配利润");
      }
      const distributedBefore = prior._sum.amountCents ?? 0n;
      const revision = (prior._max.revision ?? 0) + 1;
      const temporary = await tx.projectTemporaryProfitDistribution.create({
        data: {
          projectId,
          revision,
          projectParticipatingCompanyId: participant.id,
          companyEntityId: participant.companyEntityId,
          companyEntityVersionId: participant.companyEntityVersionId,
          companyNameSnapshot: participant.companyNameSnapshot,
          companyCreditCodeSnapshot: participant.companyCreditCodeSnapshot,
          amountCents,
          authorizationCeilingCents: distributedBefore + currentDistributable,
          temporaryDistributedBeforeCents: distributedBefore,
          authorizedCumulativeCents: distributedBefore + amountCents,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          basisSnapshot: basis,
          authorizedByUserId: actorUserId,
          authorizedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        }
      });
      const authorization = await tx.projectProfitDistributionAuthorization.create({
        data: {
          projectId,
          authorizationKind: "temporary",
          temporaryDistributionId: temporary.id,
          distributionId: null,
          distributionLineId: null,
          companyEntityId: participant.companyEntityId,
          authorizedAmountCents: amountCents,
          projectionFingerprint: projection.fingerprint,
          authorizedByUserId: actorUserId,
          authorizedAt: projection.readAt,
          idempotencyKey: randomUUID(),
          payloadFingerprint: fingerprint({ temporaryDistributionId: temporary.id, amountCents })
        }
      });
      await this.operatingLedger.appendConfirmedSourceInTransaction(tx, {
        projectId,
        sourceType: "project_temporary_profit_distribution",
        sourceBusinessId: temporary.id,
        sourceBusinessCode: `TZ-${revision}`,
        sourceVersion: revision,
        idempotencyKey: `pol109-temp:${temporary.id}`,
        occurredAt: projection.readAt,
        confirmedAt: projection.readAt,
        confirmedByUserId: actorUserId,
        factKind: "profit_distribution",
        operatingLevel: "participating_company",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate:
          projection.readAt < project.operatingLedgerEffectiveDate,
        affiliateAssignmentId: affiliate.id,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: affiliate.affiliateCreditCodeSnapshot ?? undefined,
        sourceSnapshot: {
          temporaryDistributionId: temporary.id,
          projectParticipatingCompanyId: participant.id,
          companyEntityId: participant.companyEntityId,
          projectionFingerprint: projection.fingerprint
        },
        basisSnapshot: basis,
        subjects: {},
        impacts: [{
          idempotencyKey: `pol109-temp:${temporary.id}:impact`,
          sourceImpactKey: `temporary:${temporary.id}`,
          impactKind: "temporary_profit_distribution",
          amountCents,
          direction: "increase",
          subject: { kind: "participating_company", id: participant.companyEntityId },
          description: "项目暂分利润",
          impactSnapshot: { temporaryDistributionId: temporary.id }
        }]
      }, actorUserId);
      const response = {
        temporaryDistributionId: temporary.id,
        profitAuthorizationId: authorization.id,
        revision,
        amountCents: amountCents.toString(),
        authorizedAt: projection.readAt.toISOString()
      };
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          action: "create_temporary_distribution",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.temporary_distribution.create",
        businessType: "project_temporary_profit_distribution",
        businessId: temporary.id,
        metadata: { projectId, amountCents: amountCents.toString() }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    "暂分利润发生并发冲突，请刷新后重试");
  }

  async reconcileImpacts(
    actorUserId: string,
    projectId: string,
    input: ReconcileProjectCloseImpactsInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const basis = normalizedBasis(input.basis);
    const payloadFingerprint = fingerprint({
      action: "project_close.impacts.reconcile",
      projectId,
      expectedProjectionFingerprint,
      basis
    });
    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [projection, versions, roleKeysByProject] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId])
      ]);
      assertExactRole(
        roleKeysByProject.get(projectId) ?? [],
        ["finance_director"],
        "仅财务负责人可以核对项目收口影响"
      );
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      const latest = latestStageVersions(versions);
      const completed = [...latest.values()].filter((row) => row.status === "completed");
      const oldestCutoff = completed.reduce<Date | null>(
        (value, row) => value === null || row.projectionCutoffAt < value
          ? row.projectionCutoffAt
          : value,
        null
      );
      if (!oldestCutoff) {
        const response = { createdImpactCount: 0, affectedStageKeys: [] as ProjectStage[] };
        await saveReconcileReceipt(tx, projectId, idempotencyKey, payloadFingerprint, response);
        return response;
      }
      const [operatingImpacts, participantChanges, existingImpacts] = await Promise.all([
        tx.operatingImpactEntry.findMany({
          where: { projectId, createdAt: { gt: oldestCutoff, lte: projection.cutoffAt } },
          select: {
            id: true,
            sourceType: true,
            sourceBusinessId: true,
            sourceImpactKey: true,
            impactKind: true,
            amountCents: true,
            direction: true,
            subjectId: true,
            createdAt: true
          }
        }),
        tx.projectParticipatingCompany.findMany({
          where: { projectId, updatedAt: { gt: oldestCutoff, lte: projection.cutoffAt } },
          select: {
            id: true,
            companyEntityId: true,
            companyEntityVersionId: true,
            effectiveFrom: true,
            updatedAt: true,
            endedAt: true
          }
        }),
        tx.projectCloseImpact.findMany({
          where: { projectId },
          select: { sourceType: true, sourceId: true, sourceFingerprint: true }
        })
      ]);
      const seen = new Set(existingImpacts.map((row) =>
        `${row.sourceType}:${row.sourceId}:${row.sourceFingerprint}`));
      const candidates: Array<{
        sourceType: string;
        sourceId: string;
        sourceFingerprint: string;
        reason: string;
        affectedStages: ProjectStage[];
        observedAt: Date;
      }> = [];
      for (const impact of operatingImpacts) {
        const impactPolicy = resolveProjectCloseImpactPolicy(impact.impactKind);
        const affectedStages = [...impactPolicy.affectedStages];
        if (!affectedStages.length) continue;
        const sourceId = `${impact.sourceBusinessId}:${impact.sourceImpactKey}`;
        const sourceFingerprint = fingerprint({
          impactKind: impact.impactKind,
          amountCents: impact.amountCents,
          direction: impact.direction,
          subjectId: impact.subjectId
        });
        if (!seen.has(`${impact.sourceType}:${sourceId}:${sourceFingerprint}`)) {
          candidates.push({
            sourceType: impact.sourceType,
            sourceId,
            sourceFingerprint,
            reason: impactPolicy.reason,
            affectedStages,
            observedAt: impact.createdAt
          });
        }
      }
      for (const participant of participantChanges) {
        const sourceFingerprint = projectParticipationChangeFingerprint({
          companyEntityId: participant.companyEntityId,
          companyEntityVersionId: participant.companyEntityVersionId,
          effectiveFrom: participant.effectiveFrom,
          endedAt: participant.endedAt,
          mutation: participant.endedAt === null ? "added" : "ended"
        });
        if (!seen.has(`project_participating_company:${participant.id}:${sourceFingerprint}`)) {
          candidates.push({
            sourceType: "project_participating_company",
            sourceId: participant.id,
            sourceFingerprint,
            reason: "项目参与公司或分配关系发生变化",
            affectedStages: ["profit_distribution_completed", "project_funds_cleared"],
            observedAt: participant.updatedAt
          });
        }
      }
      const affected = new Set<ProjectStage>();
      let createdImpactCount = 0;
      for (const candidate of candidates) {
        const relevant = candidate.affectedStages.filter((stage) => {
          const row = latest.get(stage);
          return row?.status === "completed" && candidate.observedAt > row.projectionCutoffAt;
        });
        if (!relevant.length) continue;
        const impactIdempotencyKey = randomUUID();
        await tx.projectCloseImpact.create({
          data: {
            projectId,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
            sourceFingerprint: candidate.sourceFingerprint,
            reason: candidate.reason,
            affectedStages: relevant,
            observedAt: candidate.observedAt,
            projectionFingerprint: projection.fingerprint,
            idempotencyKey: impactIdempotencyKey,
            payloadFingerprint: fingerprint(candidate)
          }
        });
        createdImpactCount += 1;
        relevant.forEach((stage) => affected.add(stage));
      }
      for (const stage of PROJECT_STAGES.filter((candidate) => affected.has(candidate))) {
        const previous = latest.get(stage);
        if (!previous || previous.status !== "completed") continue;
        const stageIdempotencyKey = randomUUID();
        const created = await tx.projectCloseStageVersion.create({
          data: {
            projectId,
            stageKey: stage,
            revision: previous.revision + 1,
            status: "needs_reconfirmation",
            previousVersionId: previous.id,
            prerequisiteStageVersionIds: prerequisiteStageVersionIds(latest, stage),
            projectionReadAt: projection.readAt,
            projectionCutoffAt: projection.cutoffAt,
            projectionFingerprint: projection.fingerprint,
            amountSnapshot: projectionAmountSnapshot(projection.projection),
            stateSnapshot: projectionStateSnapshot(projection.projection),
            basisSnapshot: basis,
            confirmedByUserId: actorUserId,
            confirmedAt: projection.readAt,
            idempotencyKey: stageIdempotencyKey,
            payloadFingerprint: fingerprint({ stage, projectionFingerprint: projection.fingerprint })
          }
        });
        latest.set(stage, created as StageVersionSnapshot);
      }
      if (affected.size > 0) {
        await tx.projectCloseAggregate.update({
          where: { projectId },
          data: { revision: { increment: affected.size } }
        });
      }
      const response = {
        createdImpactCount,
        affectedStageKeys: PROJECT_STAGES.filter((stage) => affected.has(stage))
      };
      await saveReconcileReceipt(tx, projectId, idempotencyKey, payloadFingerprint, response);
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.impacts.reconcile",
        businessType: "project_close_impact",
        businessId: projectId,
        metadata: response
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submitDistribution(
    actorUserId: string,
    projectId: string,
    input: SubmitDistributionInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const basis = normalizedBasis(input.basis);
    const requestedLines = normalizeDistributionLines(input.lines);
    const payloadFingerprint = fingerprint({
      action: "project_close.distribution.submit",
      projectId,
      expectedProjectionFingerprint,
      basis,
      lines: requestedLines
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [
        projection,
        versions,
        roleKeysByProject,
        profitConfirmation,
        participants,
        previous
      ] = await Promise.all([
        this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
        tx.projectCloseStageVersion.findMany({
          where: { projectId },
          orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
        }),
        this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
        tx.projectCloseProfitConfirmation.findFirst({
          where: { projectId },
          orderBy: { revision: "desc" }
        }),
        tx.projectParticipatingCompany.findMany({ where: { projectId } }),
        tx.projectCloseDecisionSubmission.findFirst({
          where: { projectId, decisionKind: "distribution" },
          orderBy: { revision: "desc" }
        })
      ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      assertStageReady(versions, "profit_distribution_completed");
      assertExactRole(
        roleKeysByProject.get(projectId) ?? [],
        ["finance_director"],
        "仅财务负责人可以制作并提交盈亏分配确认单"
      );
      if (!profitConfirmation) throw new ConflictException("项目最终盈亏尚未确认");
      const latestVersions = latestStageVersions(versions);
      if (latestVersions.get("final_profit_confirmed")?.id !== profitConfirmation.stageVersionId) {
        throw new ConflictException("最终盈亏确认已不是当前经营版本，请先重新确认");
      }
      const participantById = effectiveParticipantById(participants, projection.cutoffAt);
      assertDistributionProposal(requestedLines, participantById, profitConfirmation.finalProfitCents);
      const submission = await tx.projectCloseDecisionSubmission.create({
        data: {
          projectId,
          decisionKind: "distribution",
          revision: (previous?.revision ?? 0) + 1,
          previousSubmissionId: previous?.id,
          prerequisiteStageVersionIds: [],
          profitConfirmationId: profitConfirmation.id,
          profitStageVersionId: profitConfirmation.stageVersionId,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          amountSnapshot: projectionAmountSnapshot(projection.projection),
          stateSnapshot: projectionStateSnapshot(projection.projection),
          participantsSnapshot: participantDecisionSnapshot(participants, projection.cutoffAt),
          proposalSnapshot: {
            totalProfitCents: profitConfirmation.finalProfitCents.toString(),
            lines: requestedLines.map((line) => ({
              projectParticipatingCompanyId: line.projectParticipatingCompanyId,
              finalShareCents: line.finalShareCents.toString()
            }))
          },
          basisSnapshot: basis,
          preparedByUserId: actorUserId,
          preparedAt: projection.readAt,
          submittedByUserId: actorUserId,
          submittedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        }
      });
      const response = decisionSubmissionReadModel(submission);
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          action: "submit_distribution",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.distribution.submit",
        businessType: "project_close_decision_submission",
        businessId: submission.id,
        metadata: {
          projectId,
          revision: submission.revision,
          projectionFingerprint: submission.projectionFingerprint
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmDistribution(
    actorUserId: string,
    projectId: string,
    input: ConfirmDistributionInput
  ) {
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const expectedProjectionFingerprint = requiredText(
      input.expectedProjectionFingerprint,
      "经营投影版本不能为空"
    );
    const submissionId = requiredUuid(input.submissionId);
    const payloadFingerprint = fingerprint({
      action: "project_close.distribution.confirm",
      projectId,
      expectedProjectionFingerprint,
      submissionId
    });

    return this.prisma.$transaction(async (tx) => {
      await lockCommandIdempotency(tx, idempotencyKey);
      await lockProjectCloseAggregate(tx, projectId);
      const replay = await readCommandReplay(tx, idempotencyKey, payloadFingerprint);
      if (replay) return replay;
      const [
        projection,
        versions,
        roleKeysByProject,
        profitConfirmation,
        participants,
        previous,
        priorAuthorizations,
        temporaryDistributions,
        submission
      ] =
        await Promise.all([
          this.projections.readProjectInTransaction(tx, actorUserId, { projectId }),
          tx.projectCloseStageVersion.findMany({
            where: { projectId },
            orderBy: [{ stageKey: "asc" }, { revision: "desc" }]
          }),
          this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, [projectId]),
          tx.projectCloseProfitConfirmation.findFirst({
            where: { projectId },
            orderBy: { revision: "desc" }
          }),
          tx.projectParticipatingCompany.findMany({
            where: { projectId }
          }),
          tx.projectCloseDistribution.findFirst({
            where: { projectId },
            orderBy: { revision: "desc" },
            include: { lines: true }
          }),
          tx.projectProfitDistributionAuthorization.findMany({
            where: { projectId },
            include: {
              movements: {
                where: { status: "confirmed" },
                select: { paymentAmountCents: true }
              }
            }
          }),
          tx.projectTemporaryProfitDistribution.findMany({
            where: { projectId },
            select: { companyEntityId: true, amountCents: true }
          }),
          tx.projectCloseDecisionSubmission.findUnique({
            where: { id: submissionId }
          })
        ]);
      assertProjectionFingerprint(projection.fingerprint, expectedProjectionFingerprint);
      assertStageReady(versions, "profit_distribution_completed");
      assertExactRole(
        roleKeysByProject.get(projectId) ?? [],
        ["chairman", "general_manager"],
        "仅董事长或总经理可以最终确认盈亏分配"
      );
      if (!profitConfirmation) {
        throw new ConflictException("项目最终盈亏尚未确认");
      }
      const latestVersions = latestStageVersions(versions);
      if (
        latestVersions.get("final_profit_confirmed")?.id !== profitConfirmation.stageVersionId
      ) {
        throw new ConflictException("最终盈亏确认已不是当前经营版本，请先重新确认");
      }
      const decision = assertDecisionSubmission(
        submission,
        projectId,
        "distribution",
        projection.fingerprint
      );
      if (
        submission!.profitConfirmationId !== profitConfirmation.id ||
        submission!.profitStageVersionId !== profitConfirmation.stageVersionId
      ) {
        throw new ConflictException("财务提交绑定的最终盈亏版本已过期，请重新制作");
      }
      const requestedLines = decision.lines;
      const totalProfitCents = BigInt(profitConfirmation.finalProfitCents);
      const participantById = effectiveParticipantById(participants, projection.cutoffAt);
      assertDistributionProposal(requestedLines, participantById, totalProfitCents);
      const stageVersion = await appendCompletedStage(tx, {
        projectId,
        stageKey: "profit_distribution_completed",
        actorUserId,
        idempotencyKey,
        payloadFingerprint,
        projection,
        versions,
        basis: decision.basisSnapshot
      });
      const distribution = await tx.projectCloseDistribution.create({
        data: {
          projectId,
          stageVersionId: stageVersion.stageVersionId,
          submissionId: submission!.id,
          profitConfirmationId: profitConfirmation.id,
          revision: (previous?.revision ?? 0) + 1,
          previousDistributionId: previous?.id,
          totalProfitCents,
          projectionReadAt: projection.readAt,
          projectionCutoffAt: projection.cutoffAt,
          projectionFingerprint: projection.fingerprint,
          basisSnapshot: decision.basisSnapshot,
          confirmedByUserId: actorUserId,
          confirmedAt: projection.readAt,
          idempotencyKey,
          payloadFingerprint
        },
        select: { id: true, revision: true, confirmedAt: true }
      });
      const actualTransferByCompany = new Map<string, bigint>();
      for (const authorization of priorAuthorizations) {
        const actual = authorization.movements.reduce(
          (sum, movement) => sum + movement.paymentAmountCents,
          0n
        );
        actualTransferByCompany.set(
          authorization.companyEntityId,
          (actualTransferByCompany.get(authorization.companyEntityId) ?? 0n) + actual
        );
      }
      const temporaryByCompany = new Map<string, bigint>();
      for (const temporary of temporaryDistributions) {
        temporaryByCompany.set(
          temporary.companyEntityId,
          (temporaryByCompany.get(temporary.companyEntityId) ?? 0n) + temporary.amountCents
        );
      }
      const currentFundsByCompany = currentCompanyProjectFundsByCompany(projection.projection);
      const lineRows = requestedLines.map((line) => {
        const participant = participantById.get(line.projectParticipatingCompanyId)!;
        const finalShare = line.finalShareCents;
        const temporaryDistributed = temporaryByCompany.get(participant.companyEntityId) ?? 0n;
        const actualTransfer = actualTransferByCompany.get(participant.companyEntityId) ?? 0n;
        const currentCompanyProjectFunds =
          currentFundsByCompany.get(participant.companyEntityId) ?? 0n;
        const existingFundsApplied = calculateExistingFundsApplied(
          finalShare,
          currentCompanyProjectFunds,
          actualTransfer
        );
        const settlement = calculateDistributionSettlement(
          finalShare,
          existingFundsApplied + actualTransfer
        );
        return {
          id: randomUUID(),
          distributionId: distribution.id,
          projectParticipatingCompanyId: participant.id,
          companyEntityId: participant.companyEntityId,
          companyEntityVersionId: participant.companyEntityVersionId,
          companyNameSnapshot: participant.companyNameSnapshot,
          finalShareCents: finalShare,
          temporaryDistributedCents: temporaryDistributed,
          existingFundsAppliedCents: existingFundsApplied,
          actualTransferCents: actualTransfer,
          toReceiveCents: settlement.toReceiveCents,
          toReturnCents: settlement.toReturnCents,
          additionalBearingCents: settlement.additionalBearingCents,
          sourceSnapshot: {
            projectParticipatingCompanyId: participant.id,
            companyEntityVersionId: participant.companyEntityVersionId,
            currentCompanyProjectFundsCents: currentCompanyProjectFunds.toString(),
            projectionFingerprint: projection.fingerprint
          }
        };
      });
      await tx.projectCloseDistributionLine.createMany({ data: lineRows });
      const authorizationRows = lineRows
        .filter((line) => line.toReceiveCents > 0n)
        .map((line) => ({
          id: randomUUID(),
          projectId,
          authorizationKind: "final",
          temporaryDistributionId: null,
          distributionId: distribution.id,
          distributionLineId: line.id,
          companyEntityId: line.companyEntityId,
          authorizedAmountCents: line.toReceiveCents,
          projectionFingerprint: projection.fingerprint,
          authorizedByUserId: actorUserId,
          authorizedAt: projection.readAt,
          idempotencyKey: randomUUID(),
          payloadFingerprint: fingerprint({
            distributionId: distribution.id,
            distributionLineId: line.id,
            amountCents: line.toReceiveCents.toString()
          })
        }));
      if (authorizationRows.length > 0) {
        await tx.projectProfitDistributionAuthorization.createMany({ data: authorizationRows });
      }
      const response = {
        distributionId: distribution.id,
        stageVersionId: stageVersion.stageVersionId,
        revision: distribution.revision,
        totalProfitCents: totalProfitCents.toString(),
        confirmedAt: distribution.confirmedAt.toISOString(),
        lines: lineRows.map((line) => ({
          distributionLineId: line.id,
          projectParticipatingCompanyId: line.projectParticipatingCompanyId,
          companyEntityId: line.companyEntityId,
          companyName: line.companyNameSnapshot,
          finalShareCents: line.finalShareCents.toString(),
          toReceiveCents: line.toReceiveCents.toString(),
          toReturnCents: line.toReturnCents.toString(),
          additionalBearingCents: line.additionalBearingCents.toString(),
          profitAuthorizationId:
            authorizationRows.find((row) => row.distributionLineId === line.id)?.id ?? null
        }))
      };
      await tx.projectCloseCommandReceipt.create({
        data: {
          projectId,
          stageVersionId: stageVersion.stageVersionId,
          action: "confirm_distribution",
          idempotencyKey,
          payloadFingerprint,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project_close.distribution.confirm",
        businessType: "project_close_distribution",
        businessId: distribution.id,
        metadata: {
          projectId,
          totalProfitCents: totalProfitCents.toString(),
          companyCount: lineRows.length,
          projectionFingerprint: projection.fingerprint
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function latestStageVersions(rows: readonly StageVersionSnapshot[]) {
  const latest = new Map<ProjectStage, StageVersionSnapshot>();
  for (const row of rows) {
    if (!PROJECT_STAGES.includes(row.stageKey as ProjectStage)) continue;
    const stage = row.stageKey as ProjectStage;
    if (!latest.has(stage)) latest.set(stage, row);
  }
  return latest;
}

type MinimalStageVersion = Readonly<{
  id: string;
  stageKey: string;
  revision: number;
  status: string;
}>;

type TransactionProjection = Awaited<
  ReturnType<OperatingProjectionService["readProjectInTransaction"]>
>;

async function lockCommandIdempotency(
  tx: Prisma.TransactionClient,
  idempotencyKey: string
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`pol109-command:${idempotencyKey}`}, 0)
    )::text AS "locked"
  `);
}

async function translateProjectCloseConcurrencyConflict<T>(
  operation: Promise<T>,
  message: string
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      throw new ConflictException(message, { cause: error });
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["P2034", "40001", "40P01"].includes(String(error.code).toUpperCase())
    ) {
      throw new ConflictException(message, { cause: error });
    }
    throw error;
  }
}

async function lockProjectCloseAggregate(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  await tx.projectCloseAggregate.upsert({
    where: { projectId },
    create: { projectId },
    update: {}
  });
  await tx.$queryRaw(Prisma.sql`
    SELECT "projectId"
    FROM "ProjectCloseAggregate"
    WHERE "projectId" = ${projectId}
    FOR UPDATE
  `);
}

async function readCommandReplay(
  tx: Prisma.TransactionClient,
  idempotencyKey: string,
  payloadFingerprint: string
) {
  const existing = await tx.projectCloseCommandReceipt.findUnique({
    where: { idempotencyKey },
    select: { payloadFingerprint: true, responseSnapshot: true }
  });
  if (!existing) return null;
  if (existing.payloadFingerprint !== payloadFingerprint) {
    throw new ConflictException("幂等键已用于不同的项目收口操作");
  }
  return existing.responseSnapshot;
}

async function saveReconcileReceipt(
  tx: Prisma.TransactionClient,
  projectId: string,
  idempotencyKey: string,
  payloadFingerprint: string,
  response: Prisma.InputJsonValue
) {
  await tx.projectCloseCommandReceipt.create({
    data: {
      projectId,
      action: "reconcile_impacts",
      idempotencyKey,
      payloadFingerprint,
      responseSnapshot: response
    }
  });
}

function assertProjectionFingerprint(actual: string, expected: string) {
  if (actual !== expected) {
    throw new ConflictException("经营数据已经变化，请刷新后重新确认");
  }
}

function assertStageReady(rows: readonly MinimalStageVersion[], stageKey: ProjectStage) {
  const latest = latestMinimalStageVersions(rows);
  const completed = PROJECT_STAGES.filter((stage) => latest.get(stage)?.status === "completed");
  const affected = PROJECT_STAGES.filter(
    (stage) => latest.get(stage)?.status === "needs_reconfirmation"
  );
  const current = buildProjectCloseStageTimeline(completed, affected)
    .find((item) => item.stage === stageKey);
  const stageIndex = PROJECT_STAGES.indexOf(stageKey);
  const canReconfirm = current?.status === "needs_reconfirmation" &&
    PROJECT_STAGES.slice(0, stageIndex).every(
      (stage) => latest.get(stage)?.status === "completed"
    );
  if (current?.status !== "ready" && !canReconfirm) {
    throw new ConflictException("前置项目收口阶段尚未正式完成");
  }
}

function stageActionStatus(
  timeline: ReturnType<typeof buildProjectCloseStageTimeline>,
  stageIndex: number
) {
  const current = timeline[stageIndex];
  if (
    current?.status === "needs_reconfirmation" &&
    timeline.slice(0, stageIndex).every((item) => item.status === "completed")
  ) {
    return "ready" as const;
  }
  return current?.status ?? "pending";
}

function latestMinimalStageVersions(rows: readonly MinimalStageVersion[]) {
  const latest = new Map<ProjectStage, MinimalStageVersion>();
  for (const row of rows) {
    if (!PROJECT_STAGES.includes(row.stageKey as ProjectStage)) continue;
    const stage = row.stageKey as ProjectStage;
    const current = latest.get(stage);
    if (!current || row.revision > current.revision) latest.set(stage, row);
  }
  return latest;
}

function assertExactRole(
  roleKeys: readonly RoleKey[],
  allowed: readonly RoleKey[],
  message: string
) {
  if (
    roleKeys.includes("super_admin") ||
    !allowed.some((role) => roleKeys.includes(role))
  ) {
    throw new ForbiddenException(message);
  }
}

function normalizedBasis(value: ConfirmationBasis) {
  return {
    summary: requiredText(value?.summary, "确认依据不能为空"),
    evidenceFileIds: Array.from(new Set(value?.evidenceFileIds ?? [])).sort()
  };
}

function requiredSpecialty(value: unknown): DownstreamCostSpecialty {
  if (value !== "contract" && value !== "finance") {
    throw new BadRequestException("成本确认专业类型无效");
  }
  return value;
}

function latestProfessionalAttestations(rows: readonly Readonly<{
  id: string;
  specialty: string;
  revision: number;
  projectionFingerprint: string;
}>[]) {
  const latest = new Map<DownstreamCostSpecialty, typeof rows[number]>();
  for (const row of rows) {
    if (row.specialty !== "contract" && row.specialty !== "finance") continue;
    const current = latest.get(row.specialty);
    if (!current || row.revision > current.revision) latest.set(row.specialty, row);
  }
  return latest;
}

async function appendCompletedStage(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    projectId: string;
    stageKey: ProjectStage;
    actorUserId: string;
    idempotencyKey: string;
    payloadFingerprint: string;
    projection: TransactionProjection;
    versions: readonly MinimalStageVersion[];
    basis: Prisma.InputJsonValue;
  }>
): Promise<CompleteStageResult> {
  const latest = latestMinimalStageVersions(input.versions);
  const previous = latest.get(input.stageKey);
  const revision = (previous?.revision ?? 0) + 1;
  const created = await tx.projectCloseStageVersion.create({
    data: {
      projectId: input.projectId,
      stageKey: input.stageKey,
      revision,
      status: "completed",
      previousVersionId: previous?.id,
      prerequisiteStageVersionIds: prerequisiteStageVersionIds(latest, input.stageKey),
      projectionReadAt: input.projection.readAt,
      projectionCutoffAt: input.projection.cutoffAt,
      projectionFingerprint: input.projection.fingerprint,
      amountSnapshot: projectionAmountSnapshot(input.projection.projection),
      stateSnapshot: projectionStateSnapshot(input.projection.projection),
      basisSnapshot: input.basis,
      confirmedByUserId: input.actorUserId,
      confirmedAt: input.projection.readAt,
      idempotencyKey: input.idempotencyKey,
      payloadFingerprint: input.payloadFingerprint
    },
    select: {
      id: true,
      stageKey: true,
      revision: true,
      confirmedAt: true
    }
  });
  await tx.projectCloseAggregate.update({
    where: { projectId: input.projectId },
    data: { revision: { increment: 1 } }
  });
  return {
    stageVersionId: created.id,
    stageKey: created.stageKey as ProjectStage,
    revision: created.revision,
    status: "completed",
    confirmedAt: created.confirmedAt.toISOString()
  };
}

function assertProjectionFinalizable(
  projection: TransactionProjection["projection"]
) {
  if (
    !projection.integrity.moneyComplete ||
    projection.evidence.gapFactCount !== 0 ||
    requiredMoney(projection.evidence.gapAmountCents, "经营证据差额无效") !== 0n ||
    projection.restrictions.openUncoveredReconciliationCents === null ||
    ["legacy_unmodeled", "integrity_conflict"].includes(
      projection.restrictions.relationshipCompleteness
    )
  ) {
    throw new ConflictException("经营金额或来源仍不完整，不能最终确认盈亏");
  }
}

function requiredMoney(value: unknown, message: string) {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/u.test(value)) {
    throw new ConflictException(message);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ConflictException(message);
  }
}

function requiredPositiveMoney(value: unknown, message: string) {
  const amount = requiredMoney(value, message);
  if (amount <= 0n) throw new BadRequestException(message);
  return amount;
}

function normalizeDistributionLines(lines: SubmitDistributionInput["lines"] | unknown) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new BadRequestException("公司分配明细数量无效");
  }
  const seen = new Set<string>();
  return (lines as Array<{
    projectParticipatingCompanyId?: unknown;
    finalShareCents?: unknown;
  }>).map((line) => {
    const projectParticipatingCompanyId = requiredText(
      line?.projectParticipatingCompanyId,
      "项目参与公司不能为空"
    );
    if (seen.has(projectParticipatingCompanyId)) {
      throw new BadRequestException("同一项目参与公司不能重复分配");
    }
    seen.add(projectParticipatingCompanyId);
    return {
      projectParticipatingCompanyId,
      finalShareCents: requiredMoney(line?.finalShareCents, "公司分配金额无效")
    };
  }).sort((left, right) =>
    left.projectParticipatingCompanyId.localeCompare(right.projectParticipatingCompanyId)
  );
}

export function calculateDistributionSettlement(
  finalShareCents: bigint,
  confirmedTransferCents: bigint
) {
  if (confirmedTransferCents < 0n) {
    throw new ConflictException("已确认实际资金转移金额无效");
  }
  if (finalShareCents < 0n) {
    return {
      toReceiveCents: 0n,
      toReturnCents: confirmedTransferCents,
      additionalBearingCents: -finalShareCents
    } as const;
  }
  return {
    toReceiveCents:
      finalShareCents > confirmedTransferCents
        ? finalShareCents - confirmedTransferCents
        : 0n,
    toReturnCents:
      confirmedTransferCents > finalShareCents
        ? confirmedTransferCents - finalShareCents
        : 0n,
    additionalBearingCents: 0n
  } as const;
}

export function calculateExistingFundsApplied(
  finalShareCents: bigint,
  currentCompanyProjectFundsCents: bigint,
  confirmedTransferCents: bigint
) {
  if (confirmedTransferCents < 0n) {
    throw new ConflictException("已确认实际资金转移金额无效");
  }
  if (finalShareCents <= 0n || currentCompanyProjectFundsCents <= 0n) {
    return 0n;
  }
  const outstandingShare = finalShareCents > confirmedTransferCents
    ? finalShareCents - confirmedTransferCents
    : 0n;
  return currentCompanyProjectFundsCents < outstandingShare
    ? currentCompanyProjectFundsCents
    : outstandingShare;
}

function currentCompanyProjectFundsByCompany(
  projection: Awaited<ReturnType<OperatingProjectionService["readProjectInTransaction"]>>["projection"]
) {
  const result = new Map<string, bigint>();
  for (const detail of projection.details ?? []) {
    if (
      detail.subjectKind !== "participating_company" ||
      !detail.subjectId ||
      detail.signedImpactCents === null ||
      (detail.impactKind !== "company_project_funds_increase" &&
        detail.impactKind !== "company_project_funds_decrease")
    ) {
      continue;
    }
    const signed = requiredMoney(
      detail.signedImpactCents,
      "公司项目资金投影金额无效"
    );
    result.set(detail.subjectId, (result.get(detail.subjectId) ?? 0n) + signed);
  }
  return result;
}

function stageVersionReadModel(row: StageVersionSnapshot | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    stageKey: row.stageKey,
    revision: row.revision,
    status: row.status,
    prerequisiteStageVersionIds: row.prerequisiteStageVersionIds,
    projectionReadAt: row.projectionReadAt.toISOString(),
    projectionCutoffAt: row.projectionCutoffAt.toISOString(),
    projectionFingerprint: row.projectionFingerprint,
    amountSnapshot: row.amountSnapshot,
    stateSnapshot: row.stateSnapshot,
    basisSnapshot: row.basisSnapshot,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt.toISOString()
  };
}

type DecisionSubmissionLike = Readonly<{
  id: string;
  projectId: string;
  decisionKind: string;
  revision: number;
  previousSubmissionId: string | null;
  prerequisiteStageVersionIds: Prisma.JsonValue;
  profitConfirmationId: string | null;
  profitStageVersionId: string | null;
  projectionReadAt: Date;
  projectionCutoffAt: Date;
  projectionFingerprint: string;
  amountSnapshot: Prisma.JsonValue;
  stateSnapshot: Prisma.JsonValue;
  participantsSnapshot: Prisma.JsonValue;
  proposalSnapshot: Prisma.JsonValue;
  basisSnapshot: Prisma.JsonValue;
  preparedByUserId: string;
  preparedAt: Date;
  submittedByUserId: string;
  submittedAt: Date;
}>;

function decisionSubmissionReadModel(row: DecisionSubmissionLike) {
  return {
    id: row.id,
    decisionKind: row.decisionKind,
    revision: row.revision,
    previousSubmissionId: row.previousSubmissionId,
    prerequisiteStageVersionIds: row.prerequisiteStageVersionIds,
    profitConfirmationId: row.profitConfirmationId,
    profitStageVersionId: row.profitStageVersionId,
    projectionReadAt: row.projectionReadAt.toISOString(),
    projectionCutoffAt: row.projectionCutoffAt.toISOString(),
    projectionFingerprint: row.projectionFingerprint,
    amountSnapshot: row.amountSnapshot,
    stateSnapshot: row.stateSnapshot,
    participantsSnapshot: row.participantsSnapshot,
    proposalSnapshot: row.proposalSnapshot,
    basisSnapshot: row.basisSnapshot,
    preparedByUserId: row.preparedByUserId,
    preparedAt: row.preparedAt.toISOString(),
    submittedByUserId: row.submittedByUserId,
    submittedAt: row.submittedAt.toISOString()
  };
}

function assertDecisionSubmission(
  submission: DecisionSubmissionLike | null,
  projectId: string,
  expectedKind: "final_profit" | "distribution",
  projectionFingerprint: string
) {
  if (!submission || submission.projectId !== projectId || submission.decisionKind !== expectedKind) {
    throw new ConflictException("财务提交版本不存在或不属于当前项目");
  }
  if (submission.projectionFingerprint !== projectionFingerprint) {
    throw new ConflictException("财务提交版本已过期，请由财务负责人重新制作");
  }
  if (!isJsonObject(submission.proposalSnapshot)) {
    throw new ConflictException("财务提交方案快照无效");
  }
  if (!isJsonObject(submission.basisSnapshot)) {
    throw new ConflictException("财务提交依据快照无效");
  }
  if (expectedKind === "final_profit") {
    return {
      finalProfitCents: requiredMoney(
        submission.proposalSnapshot.finalProfitCents,
        "财务提交的最终盈亏金额无效"
      ),
      lines: [] as ReturnType<typeof normalizeDistributionLines>,
      basisSnapshot: submission.basisSnapshot
    };
  }
  return {
    finalProfitCents: requiredMoney(
      submission.proposalSnapshot.totalProfitCents,
      "财务提交的分配总额无效"
    ),
    lines: normalizeDistributionLines(submission.proposalSnapshot.lines),
    basisSnapshot: submission.basisSnapshot
  };
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function participantDecisionSnapshot(
  participants: readonly Readonly<{
    id: string;
    companyEntityId: string;
    companyEntityVersionId: string;
    companyNameSnapshot: string;
    effectiveFrom: Date;
    endedAt: Date | null;
  }>[],
  cutoffAt: Date
) {
  return participants
    .filter((row) => participantEffectiveAt(row, cutoffAt))
    .map((row) => ({
      projectParticipatingCompanyId: row.id,
      companyEntityId: row.companyEntityId,
      companyEntityVersionId: row.companyEntityVersionId,
      companyName: row.companyNameSnapshot
    }))
    .sort((left, right) =>
      left.projectParticipatingCompanyId.localeCompare(right.projectParticipatingCompanyId)
    );
}

function effectiveParticipantById<T extends Readonly<{
  id: string;
  effectiveFrom: Date;
  endedAt: Date | null;
}>>(participants: readonly T[], cutoffAt: Date) {
  return new Map(
    participants
      .filter((row) => participantEffectiveAt(row, cutoffAt))
      .map((row) => [row.id, row] as const)
  );
}

function assertDistributionProposal<T>(
  lines: ReturnType<typeof normalizeDistributionLines>,
  participantById: ReadonlyMap<string, T>,
  totalProfitValue: bigint
) {
  const allocated = lines.reduce((sum, line) => sum + line.finalShareCents, 0n);
  if (allocated !== BigInt(totalProfitValue)) {
    throw new BadRequestException("公司分配合计必须精确等于最终盈亏");
  }
  if (lines.some((line) => !participantById.has(line.projectParticipatingCompanyId))) {
    throw new BadRequestException("分配对象必须是当前有效的项目参与公司");
  }
  if (
    lines.length !== participantById.size ||
    [...participantById.keys()].some(
      (participantId) =>
        !lines.some((line) => line.projectParticipatingCompanyId === participantId)
    )
  ) {
    throw new BadRequestException("公司分配必须覆盖投影截止日全部有效参与公司");
  }
}

function prerequisiteStageVersionIds(
  latest: ReadonlyMap<ProjectStage, MinimalStageVersion>,
  stage: ProjectStage
) {
  const index = PROJECT_STAGES.indexOf(stage);
  return PROJECT_STAGES.slice(0, index).map((requiredStageKey) => {
    const version = latest.get(requiredStageKey);
    if (!version || version.status !== "completed") {
      throw new ConflictException("前置项目收口阶段尚未全部完成");
    }
    return version.id;
  });
}

function assertFrozenPrerequisites(value: Prisma.JsonValue, expected: readonly string[]) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((id, index) => typeof id !== "string" || id !== expected[index])
  ) {
    throw new ConflictException("财务提交绑定的前置收口版本已过期，请重新制作");
  }
}

function availableStageActions(
  stage: ProjectStage,
  status: "pending" | "ready" | "completed" | "needs_reconfirmation",
  roleKeys: readonly RoleKey[],
  context: Readonly<{
    hasFinalProfitSubmission: boolean;
    hasDistributionSubmission: boolean;
  }>
) {
  if (status !== "ready") return [];
  if (stage === "downstream_cost_confirmed") {
    return [
      ...(roleKeys.includes("contract_director")
        ? ["attest_contract_cost" as const]
        : []),
      ...(roleKeys.includes("finance_director") ? ["attest_finance_cost" as const] : [])
    ];
  }
  if (stage === "final_profit_confirmed") {
    return [
      ...(roleKeys.includes("finance_director")
        ? ["create_temporary_distribution" as const, "submit_final_profit" as const]
        : []),
      ...(context.hasFinalProfitSubmission &&
      roleKeys.some((role) => role === "chairman" || role === "general_manager")
        ? ["confirm_final_profit" as const]
        : [])
    ];
  }
  if (stage === "profit_distribution_completed") {
    return [
      ...(roleKeys.includes("finance_director")
        ? ["submit_distribution" as const]
        : []),
      ...(context.hasDistributionSubmission &&
      roleKeys.some((role) => role === "chairman" || role === "general_manager")
        ? ["confirm_distribution" as const]
        : [])
    ];
  }
  return GENERIC_COMPLETION_STAGES.has(stage) &&
    STAGE_CONFIRMATION_ROLES[stage].some((role) => roleKeys.includes(role))
    ? ["complete" as const]
    : [];
}

type DistributionWithLines = Prisma.ProjectCloseDistributionGetPayload<{
  include: { lines: true; authorizations: true };
}>;

function distributionReadModel(row: DistributionWithLines) {
  const authorizationByLine = new Map(
    row.authorizations.map((authorization) => [authorization.distributionLineId, authorization])
  );
  return {
    id: row.id,
    revision: row.revision,
    profitConfirmationId: row.profitConfirmationId,
    totalProfitCents: row.totalProfitCents.toString(),
    projectionFingerprint: row.projectionFingerprint,
    basisSnapshot: row.basisSnapshot,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      projectParticipatingCompanyId: line.projectParticipatingCompanyId,
      companyEntityId: line.companyEntityId,
      companyEntityVersionId: line.companyEntityVersionId,
      companyName: line.companyNameSnapshot,
      finalShareCents: line.finalShareCents.toString(),
      temporaryDistributedCents: line.temporaryDistributedCents.toString(),
      existingFundsAppliedCents: line.existingFundsAppliedCents.toString(),
      actualTransferCents: line.actualTransferCents.toString(),
      toReceiveCents: line.toReceiveCents.toString(),
      toReturnCents: line.toReturnCents.toString(),
      additionalBearingCents: line.additionalBearingCents.toString(),
      profitAuthorizationId: authorizationByLine.get(line.id)?.id ?? null
    }))
  };
}

function participantEffectiveAt(
  participant: { effectiveFrom: Date; endedAt: Date | null },
  cutoffAt: Date
) {
  return participant.effectiveFrom <= cutoffAt &&
    (participant.endedAt === null || participant.endedAt > cutoffAt);
}

function requiredStage(value: unknown): ProjectStage {
  if (typeof value !== "string" || !PROJECT_STAGES.includes(value as ProjectStage)) {
    throw new BadRequestException("项目收口阶段无效");
  }
  return value as ProjectStage;
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  return value.trim();
}

function requiredUuid(value: unknown) {
  const text = requiredText(value, "幂等键不能为空");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)) {
    throw new BadRequestException("幂等键格式无效");
  }
  return text;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === undefined) {
    throw new BadRequestException("项目收口请求包含未定义字段");
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function projectionAmountSnapshot(
  projection: Awaited<ReturnType<OperatingProjectionService["readProjectInTransaction"]>>["projection"]
): Prisma.InputJsonValue {
  return {
    commitments: projection.commitments,
    operating: projection.operating,
    actualFunds: projection.actualFunds,
    restrictions: projection.restrictions,
    profitAndLoss: projection.profitAndLoss,
    distribution: projection.distribution
  } as Prisma.InputJsonValue;
}

function projectionStateSnapshot(
  projection: Awaited<ReturnType<OperatingProjectionService["readProjectInTransaction"]>>["projection"]
): Prisma.InputJsonValue {
  return {
    schema: projection.schema,
    asOf: projection.asOf,
    integrity: projection.integrity,
    evidence: projection.evidence,
    sourceReferenceTotals: projection.sourceReferenceTotals
  } as Prisma.InputJsonValue;
}
