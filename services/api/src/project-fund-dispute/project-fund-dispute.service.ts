import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ACTION_REQUIRED_ROLES,
  PROJECT_FUND_DISPUTE_TRANSITION_ACTIONS,
  PROJECT_FUND_DISPUTE_SOURCE_TYPE,
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type ProjectFundDisputeTransitionAction,
  type RoleKey
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { isPostgresSerializationFailure } from "../project/project-operating-constraint";
import {
  assertProjectFundDisputeDraft,
  assertProjectFundDisputeTransition,
  buildProjectFundDisputeIdentity,
  buildProjectFundDisputeFingerprint,
  sha256Jcs,
  type ProjectFundDisputeDraftCommand,
  type ValidatedProjectFundDisputeDraft
} from "./project-fund-dispute.domain";

type Tx = Prisma.TransactionClient;
type DisputeEntryWithRelations = Prisma.ProjectFundDisputeEntryGetPayload<{
  include: { dispute: true; replacements: true };
}>;
type DisputeWithEntries = Prisma.ProjectFundDisputeGetPayload<{
  include: { entries: { include: { replacements: true } } };
}>;
type DisputeEntryPublicData = Prisma.ProjectFundDisputeEntryGetPayload<{
  include: { replacements: true };
}>;

const PROJECT_FUND_DISPUTE_REPLACEMENT_IMPACT_PAIRS = new Set([
  "confirmed_cost:increase",
  "payable_increase:increase",
  "estimated_clearing_expense:increase",
  "necessary_expense_reserve_increase:increase",
  "construction_enterprise_funds_freeze:decrease",
  "construction_enterprise_funds_decrease:decrease",
  "company_project_funds_decrease:decrease",
  "inter_subject_balance_increase:increase",
  "inter_subject_balance_decrease:decrease"
]);

export interface ProjectFundDisputeActor {
  userId: string;
}

export interface ProjectFundDisputeWorkbenchQuery {
  projectId: string;
  disputeId?: string;
}

export interface ProjectFundDisputeTransitionCommand {
  entryId: string;
  action: ProjectFundDisputeTransitionAction;
  expectedRevision: number;
  expectedFingerprint: string;
  idempotencyKey: string;
  reason?: string;
}

export interface ProjectFundDisputeEntryReadModel {
  id: string;
  disputeId: string;
  sequenceNo: number;
  revision: number;
  entryKind: string;
  adjustsEntryId: string | null;
  amountCents: string;
  occurredAt: string;
  disputeSummary: string;
  resolutionBasisSummary: string | null;
  evidenceLevel: string;
  evidenceFileId: string;
  evidenceSha256: string;
  status: string;
  fingerprint: string;
  preparedByUserId: string;
  submittedByUserId: string | null;
  attestedByUserId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  returnReason: string | null;
  replacements: Array<{ operatingImpactEntryId: string; amountCents: string }>;
}

/**
 * Deep business Module for #280. Callers only learn workbench, draft and
 * transition; lifecycle, authority, snapshots, deduplication and ledger
 * append remain local to this implementation.
 */
@Injectable()
export class ProjectFundDisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly replay: OperatingSourceReplayService,
    private readonly audit: AuditService,
    private readonly clearingReconciliation: ClearingReconciliationReaderService,
    private readonly files: FileService
  ) {}

  async getWorkbench(
    query: ProjectFundDisputeWorkbenchQuery,
    actor: ProjectFundDisputeActor
  ) {
    const projectId = requiredText(query.projectId, "项目不能为空");
    return this.prisma.$transaction(async (tx) => {
      const roles = await this.requireAction(
        tx,
        actor.userId,
        projectId,
        "project_fund_dispute.read"
      );
      const disputes = await tx.projectFundDispute.findMany({
        where: {
          projectId,
          ...(query.disputeId ? { id: query.disputeId } : {})
        },
        include: {
          entries: {
            include: { replacements: true },
            orderBy: [{ sequenceNo: "desc" }, { createdAt: "desc" }]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      });
      return {
        projectId,
        capabilities: this.capabilities(roles),
        disputes: disputes.map((dispute) => this.publicDispute(dispute))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async saveDraft(
    command: ProjectFundDisputeDraftCommand,
    actor: ProjectFundDisputeActor
  ): Promise<ProjectFundDisputeEntryReadModel> {
    const draft = assertProjectFundDisputeDraft(command);
    const identity = buildProjectFundDisputeIdentity({
      projectId: draft.projectId,
      affiliateAssignmentId: draft.affiliateAssignmentId,
      fundHolderKind: draft.fundHolderKind,
      fundHolderId: draft.fundHolderId,
      basisKind: draft.basisKind,
      basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256,
      currencyCode: "CNY"
    });
    const fingerprint = buildProjectFundDisputeFingerprint(draft);
    const receiptAction = draft.entryId ? "update_draft" : "create_draft";
    const commandFingerprint = sha256Jcs({
      interface: "ProjectFundDisputeModule.saveDraft/V1",
      action: receiptAction,
      actorUserId: actor.userId,
      entryId: draft.entryId ?? null,
      expectedRevision: draft.expectedRevision ?? null,
      payloadFingerprint: fingerprint
    });
    return this.serializable(async (tx) => {
      // This must be the first statement in the serializable transaction. A
      // waiter therefore receives a fresh snapshot after another #279/#280
      // confirmation commits and deterministically reaches duplicate_blocked.
      await this.lockEconomicIdentity(tx, identity.economicIdentityKey);
      const roles = await this.requireAction(
        tx,
        actor.userId,
        draft.projectId,
        "project_fund_dispute.prepare"
      );
      await this.lockCommandIdempotency(tx, draft.idempotencyKey);
      const priorReceipt = await tx.projectFundDisputeCommandReceipt.findUnique({
        where: { idempotencyKey: draft.idempotencyKey }
      });
      if (priorReceipt) {
        if (priorReceipt.commandFingerprint !== commandFingerprint) {
          throw new ConflictException("幂等键已用于另一条争议资金命令");
        }
        return this.commandReceiptResult(priorReceipt.resultSnapshot);
      }
      const context = await this.readAuthoritativeContext(tx, draft, actor.userId);
      const existingByCommand = await tx.projectFundDisputeEntry.findUnique({
        where: { idempotencyKey: draft.idempotencyKey },
        include: { dispute: true, replacements: true }
      });
      if (existingByCommand) {
        if (
          receiptAction !== "create_draft" ||
          existingByCommand.fingerprint !== fingerprint ||
          existingByCommand.dispute.projectId !== draft.projectId
        ) {
          throw new ConflictException("幂等键已用于另一份争议资金草稿");
        }
        const result = this.publicEntry(existingByCommand);
        await this.createCommandReceipt(tx, {
          entryId: existingByCommand.id,
          idempotencyKey: draft.idempotencyKey,
          action: receiptAction,
          actorUserId: actor.userId,
          commandFingerprint,
          result
        });
        return result;
      }

      const dispute = draft.disputeId
        ? await this.requireCompatibleDispute(tx, draft.disputeId, draft, identity)
        : await this.createDispute(tx, draft, identity, context, actor.userId);
      const entry = draft.entryId
        ? await this.updateDraft(tx, dispute.id, draft, fingerprint, actor.userId)
        : await this.createEntry(tx, dispute.id, draft, fingerprint, actor.userId);
      const result = this.publicEntry({ ...entry, replacements: [] });
      await this.audit.record(tx, {
        action: draft.entryId
          ? "project_fund_dispute.draft.update"
          : "project_fund_dispute.draft.create",
        actorUserId: actor.userId,
        businessType: "project_fund_dispute_entry",
        businessId: entry.id,
        metadata: {
          projectId: dispute.projectId,
          effectiveRoles: roles,
          entryKind: entry.entryKind,
          revision: entry.draftRevision,
          fingerprint,
          amountCents: entry.amountCents.toString(),
          occurredAt: entry.occurredAt.toISOString().slice(0, 10),
          result: "success"
        }
      });
      await this.createCommandReceipt(tx, {
        entryId: entry.id,
        idempotencyKey: draft.idempotencyKey,
        action: receiptAction,
        actorUserId: actor.userId,
        commandFingerprint,
        result
      });
      return result;
    });
  }

  async transition(
    command: ProjectFundDisputeTransitionCommand,
    actor: ProjectFundDisputeActor
  ): Promise<ProjectFundDisputeEntryReadModel> {
    validateTransitionCommand(command);
    const commandFingerprint = sha256Jcs({
      interface: "ProjectFundDisputeModule.transition/V1",
      entryId: command.entryId,
      action: command.action,
      expectedRevision: command.expectedRevision,
      expectedFingerprint: command.expectedFingerprint,
      reason: command.reason?.trim() || null,
      actorUserId: actor.userId
    });
    const confirmationIdentity = command.action === "confirm"
      ? await this.prisma.projectFundDisputeEntry.findUnique({
          where: { id: command.entryId },
          select: { dispute: { select: { economicIdentityKey: true } } }
        })
      : null;
    return this.serializable(async (tx) => {
      if (confirmationIdentity) {
        await this.lockEconomicIdentity(
          tx,
          confirmationIdentity.dispute.economicIdentityKey
        );
      }
      await this.lockCommandIdempotency(tx, command.idempotencyKey);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT entry."id"
          FROM "ProjectFundDisputeEntry" entry
         WHERE entry."id" = ${command.entryId}
         FOR UPDATE
      `);
      if (!locked[0]) throw new NotFoundException("争议资金分录不存在");
      const entry = await tx.projectFundDisputeEntry.findUnique({
        where: { id: command.entryId },
        include: { dispute: true, replacements: true }
      });
      if (!entry) throw new NotFoundException("争议资金分录不存在");
      const action = `project_fund_dispute.${command.action}` as BusinessAction;
      const roles = await this.requireAction(
        tx,
        actor.userId,
        entry.dispute.projectId,
        action
      );
      const priorReceipt = await tx.projectFundDisputeCommandReceipt.findUnique({
        where: { idempotencyKey: command.idempotencyKey }
      });
      if (priorReceipt) {
        if (priorReceipt.commandFingerprint !== commandFingerprint) {
          throw new ConflictException("幂等键已用于另一条争议资金命令");
        }
        return this.commandReceiptResult(priorReceipt.resultSnapshot);
      }
      if (entry.draftRevision !== command.expectedRevision) {
        throw new ConflictException("争议资金草稿修订已变化，请刷新后重试");
      }
      const targetStatus = assertProjectFundDisputeTransition({
        action: command.action,
        status: entry.status as never,
        preparedByUserId: entry.preparedByUserId,
        attestedByUserId: entry.attestedByUserId,
        actorUserId: actor.userId,
        actorRoles: roles,
        fingerprint: entry.fingerprint,
        expectedFingerprint: command.expectedFingerprint
      });
      const now = new Date();
      let payloadSnapshot: Prisma.InputJsonObject | undefined;
      if (command.action === "submit") {
        payloadSnapshot = await this.buildFrozenSnapshot(tx, entry);
      }
      if (command.action === "confirm") {
        await this.lockConfirmationRows(tx, entry);
        await this.assertConfirmableSource(tx, entry, actor.userId);
        if (entry.entryKind === "technical_reversal") {
          const targetFact = await tx.operatingFact.findUnique({
            where: {
              sourceType_sourceBusinessId: {
                sourceType: PROJECT_FUND_DISPUTE_SOURCE_TYPE,
                sourceBusinessId: entry.adjustsEntryId!
              }
            },
            select: { id: true, amountCents: true, projectId: true }
          });
          if (!targetFact || targetFact.projectId !== entry.dispute.projectId || targetFact.amountCents !== entry.amountCents) {
            throw new ConflictException("技术冲销引用的原争议资金经营事实不一致");
          }
        }
        if (!entry.payloadSnapshot) {
          throw new ConflictException("争议资金提交冻结快照缺失，拒绝确认");
        }
      }
      const updated = await tx.projectFundDisputeEntry.update({
        where: { id: entry.id },
        data: {
          status: targetStatus,
          ...(command.action === "submit"
            ? {
                submittedByUserId: actor.userId,
                submittedAt: now,
                attestedByUserId: null,
                attestedAt: null,
                confirmedByUserId: null,
                confirmedAt: null,
                returnedByUserId: null,
                returnedAt: null,
                returnReason: null,
                payloadSnapshot
              }
            : {}),
          ...(command.action === "attest"
            ? { attestedByUserId: actor.userId, attestedAt: now }
            : {}),
          ...(command.action === "confirm"
            ? { confirmedByUserId: actor.userId, confirmedAt: now }
            : {}),
          ...(command.action === "return"
            ? {
                returnedByUserId: actor.userId,
                returnedAt: now,
                returnReason: requiredText(command.reason, "退回原因不能为空")
              }
            : {})
        },
        include: { dispute: true, replacements: true }
      });
      if (command.action === "confirm") {
        await this.replay.appendConfirmedSourceIfEnabledInTransaction(
          tx,
          {
            projectId: entry.dispute.projectId,
            sourceType: PROJECT_FUND_DISPUTE_SOURCE_TYPE,
            sourceBusinessId: entry.id
          },
          actor.userId
        );
        if (entry.entryKind === "release") {
          await this.appendReplacementLinks(tx, entry, entry.payloadSnapshot);
        }
      }
      await this.audit.record(tx, {
        action: `project_fund_dispute.${command.action}`,
        actorUserId: actor.userId,
        businessType: "project_fund_dispute_entry",
        businessId: entry.id,
        metadata: {
          projectId: entry.dispute.projectId,
          effectiveRoles: roles,
          entryKind: entry.entryKind,
          revision: entry.draftRevision,
          fingerprint: entry.fingerprint,
          previousStatus: entry.status,
          nextStatus: targetStatus,
          amountCents: entry.amountCents.toString(),
          occurredAt: entry.occurredAt.toISOString().slice(0, 10),
          confirmedAt: command.action === "confirm" ? now.toISOString() : null,
          result: "success"
        }
      });
      if (
        command.action === "confirm" &&
        (entry.entryKind === "release" || entry.entryKind === "technical_reversal")
      ) {
        await this.audit.record(tx, {
          action: `project_fund_dispute.${entry.entryKind}`,
          actorUserId: actor.userId,
          businessType: "project_fund_dispute_entry",
          businessId: entry.id,
          metadata: {
            projectId: entry.dispute.projectId,
            effectiveRoles: roles,
            revision: entry.draftRevision,
            fingerprint: entry.fingerprint,
            occurredAt: entry.occurredAt.toISOString().slice(0, 10),
            confirmedAt: now.toISOString(),
            amountCents: entry.amountCents.toString(),
            result: "success"
          }
        });
      }
      const result = this.publicEntry(updated);
      await this.createCommandReceipt(tx, {
        entryId: entry.id,
        idempotencyKey: command.idempotencyKey,
        action: command.action,
        actorUserId: actor.userId,
        commandFingerprint,
        result
      });
      return result;
    });
  }

  private async createDispute(
    tx: Tx,
    draft: ValidatedProjectFundDisputeDraft,
    identity: ReturnType<typeof buildProjectFundDisputeIdentity>,
    context: Awaited<ReturnType<ProjectFundDisputeService["readAuthoritativeContext"]>>,
    actorUserId: string
  ) {
    if (draft.entryKind !== "establish") {
      throw new BadRequestException("新争议资金必须先建立，不能从增加、释放或冲销开始");
    }
    return tx.projectFundDispute.create({
      data: {
        id: randomUUID(),
        projectId: draft.projectId,
        businessCode: draft.businessCode,
        affiliateAssignmentId: draft.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: context.assignment.businessPartyVersionId,
        affiliateNameSnapshot: context.assignment.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: context.assignment.affiliateCreditCodeSnapshot,
        fundHolderKind: draft.fundHolderKind,
        fundHolderId: draft.fundHolderId,
        counterpartyKind: draft.counterpartyKind,
        counterpartyId: draft.counterpartyId,
        disputeKind: draft.disputeKind,
        counterpartyNameSnapshot: draft.counterpartyNameSnapshot,
        basisKind: draft.basisKind,
        basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256,
        referenceCode: draft.referenceCode,
        economicIdentityKey: identity.economicIdentityKey,
        sourceIdentityKey: identity.sourceIdentityKey,
        createdByUserId: actorUserId
      }
    });
  }

  private async requireCompatibleDispute(
    tx: Tx,
    disputeId: string,
    draft: ValidatedProjectFundDisputeDraft,
    identity: ReturnType<typeof buildProjectFundDisputeIdentity>
  ) {
    const dispute = await tx.projectFundDispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.projectId !== draft.projectId) {
      throw new NotFoundException("争议资金事项不存在");
    }
    if (
      dispute.economicIdentityKey !== identity.economicIdentityKey ||
      dispute.sourceIdentityKey !== identity.sourceIdentityKey ||
      dispute.businessCode !== draft.businessCode ||
      dispute.disputeKind !== draft.disputeKind ||
      dispute.counterpartyKind !== draft.counterpartyKind ||
      dispute.counterpartyId !== draft.counterpartyId
    ) {
      throw new ConflictException("争议资金经济身份已冻结，不能通过草稿改写");
    }

    if (dispute.counterpartyNameSnapshot === draft.counterpartyNameSnapshot && dispute.referenceCode === draft.referenceCode) {
      return dispute;
    }
    if (!draft.entryId) {
      throw new ConflictException("争议资金事项说明已冻结，后续分录必须沿用原事项说明");
    }
    const [editableEntry, entryCount] = await Promise.all([
      tx.projectFundDisputeEntry.findUnique({
        where: { id: draft.entryId },
        select: { disputeId: true, status: true }
      }),
      tx.projectFundDisputeEntry.count({ where: { disputeId } })
    ]);
    if (
      !editableEntry ||
      editableEntry.disputeId !== disputeId ||
      !new Set(["draft", "returned"]).has(editableEntry.status) ||
      entryCount !== 1
    ) {
      throw new ConflictException("争议资金事项说明已冻结，不能由后续或非草稿分录改写");
    }
    return tx.projectFundDispute.update({
      where: { id: disputeId },
      data: { counterpartyNameSnapshot: draft.counterpartyNameSnapshot, referenceCode: draft.referenceCode }
    });
  }

  private async createEntry(
    tx: Tx,
    disputeId: string,
    draft: ValidatedProjectFundDisputeDraft,
    fingerprint: string,
    actorUserId: string
  ) {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended('pol280:dispute:' || ${disputeId}, 0))
    `);
    const [last, confirmedEstablishment] = await Promise.all([
      tx.projectFundDisputeEntry.aggregate({
        where: { disputeId },
        _max: { sequenceNo: true }
      }),
      tx.projectFundDisputeEntry.findFirst({
        where: { disputeId, entryKind: "establish", status: "confirmed" },
        select: { id: true }
      })
    ]);
    const lastSequenceNo = last._max.sequenceNo ?? 0;
    if (lastSequenceNo === 0 && draft.entryKind !== "establish") {
      throw new ConflictException("争议资金首笔分录必须先建立争议");
    }
    if (lastSequenceNo > 0 && draft.entryKind === "establish") {
      throw new ConflictException("争议资金已建立，后续变化必须追加增加、释放或技术冲销");
    }
    if (draft.entryKind === "increase" && !confirmedEstablishment) {
      throw new ConflictException("争议资金建立分录确认后才能追加增加");
    }
    return tx.projectFundDisputeEntry.create({
      data: {
        id: randomUUID(),
        disputeId,
        sequenceNo: lastSequenceNo + 1,
        draftRevision: 1,
        entryKind: draft.entryKind,
        adjustsEntryId: draft.adjustsEntryId,
        amountCents: draft.amountCents,
        currencyCode: "CNY",
        occurredAt: draft.occurredAtDate,
        disputeSummary: draft.disputeSummary,
        resolutionBasisSummary: draft.resolutionBasisSummary,
        evidenceLevel: draft.evidenceLevel,
        evidenceFileId: draft.evidenceFileId,
        evidenceSha256: draft.evidenceSha256,
        fingerprint,
        idempotencyKey: draft.idempotencyKey,
        preparedByUserId: actorUserId,
        payloadSnapshot: this.draftReplacementSnapshot(draft)
      }
    });
  }

  private async updateDraft(
    tx: Tx,
    disputeId: string,
    draft: ValidatedProjectFundDisputeDraft,
    fingerprint: string,
    actorUserId: string
  ) {
    const entry = await tx.projectFundDisputeEntry.findUnique({ where: { id: draft.entryId } });
    if (!entry || entry.disputeId !== disputeId) throw new NotFoundException("争议资金草稿不存在");
    if (!new Set(["draft", "returned"]).has(entry.status)) {
      throw new ConflictException("已提交或已确认的争议资金分录不能覆盖修改");
    }
    if (entry.preparedByUserId !== actorUserId) {
      throw new ForbiddenException("争议资金草稿只能由原准备人继续修改");
    }
    if (
      entry.entryKind !== draft.entryKind ||
      entry.adjustsEntryId !== (draft.adjustsEntryId ?? null)
    ) {
      throw new ConflictException("争议资金分录类型与精确调整目标创建后不可改写");
    }
    if (draft.expectedRevision !== entry.draftRevision) {
      throw new ConflictException("争议资金草稿修订已变化，请刷新后重试");
    }
    return tx.projectFundDisputeEntry.update({
      where: { id: entry.id },
      data: {
        draftRevision: { increment: 1 },
        amountCents: draft.amountCents,
        occurredAt: draft.occurredAtDate,
        disputeSummary: draft.disputeSummary,
        resolutionBasisSummary: draft.resolutionBasisSummary,
        evidenceLevel: draft.evidenceLevel,
        evidenceFileId: draft.evidenceFileId,
        evidenceSha256: draft.evidenceSha256,
        status: "draft",
        fingerprint,
        payloadSnapshot: this.draftReplacementSnapshot(draft),
        submittedByUserId: null,
        submittedAt: null,
        attestedByUserId: null,
        attestedAt: null,
        confirmedByUserId: null,
        confirmedAt: null,
        returnedByUserId: null,
        returnedAt: null,
        returnReason: null
      }
    });
  }

  private async readAuthoritativeContext(
    tx: Tx,
    draft: ValidatedProjectFundDisputeDraft,
    actorUserId: string
  ) {
    const project = await tx.project.findUnique({
      where: { id: draft.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) {
      throw new ConflictException("项目尚未启用经营账，不能建立一般争议资金");
    }
    const assignment = await tx.projectAffiliateAssignment.findFirst({
      where: {
        id: draft.affiliateAssignmentId,
        projectId: draft.projectId,
        effectiveFrom: { lte: draft.occurredAtDate },
        OR: [{ endedAt: null }, { endedAt: { gt: draft.occurredAtDate } }]
      },
      select: {
        id: true,
        businessPartyVersionId: true,
        affiliateNameSnapshot: true,
        affiliateCreditCodeSnapshot: true
      }
    });
    if (!assignment) throw new ConflictException("业务发生日缺少有效施工企业档案");
    if (draft.fundHolderKind === "construction_enterprise") {
      if (draft.fundHolderId !== assignment.businessPartyVersionId) {
        throw new ConflictException("施工企业资金持有主体与冻结施工企业版本不一致");
      }
    } else {
      const company = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: draft.projectId,
          companyEntityId: draft.fundHolderId,
          effectiveFrom: { lte: draft.occurredAtDate },
          OR: [{ endedAt: null }, { endedAt: { gt: draft.occurredAtDate } }]
        },
        select: { id: true }
      });
      if (!company) throw new ConflictException("业务发生日资金持有公司不是项目有效参与公司");
    }
    // Reuse the canonical file ACL before the non-exclusive #280 binding is
    // created. This prevents a known id/hash from laundering a private file
    // across projects while still allowing an authorized existing binding.
    await this.files.assertCanDownloadFile(tx, draft.evidenceFileId, actorUserId);
    const evidence = await tx.fileObject.findUnique({
      where: { id: draft.evidenceFileId },
      select: { contentSha256: true, storageStatus: true }
    });
    if (!evidence || evidence.storageStatus !== "active" || evidence.contentSha256 !== draft.evidenceSha256) {
      throw new ConflictException("私有证据文件不存在、不可用或内容哈希已变化");
    }
    return { project, assignment };
  }

  private async assertConfirmableSource(
    tx: Tx,
    entry: DisputeEntryWithRelations,
    actorUserId: string
  ) {
    const draft = this.entryAsDraft(entry);
    await this.readAuthoritativeContext(tx, draft, actorUserId);
    // Positive entries must prove that this economic matter has not already
    // been recognized elsewhere. A release or exact technical reversal is the
    // append-only way to reduce an existing dispute and may intentionally point
    // at the formal impact that replaced it; applying the positive-entry guard
    // here would make that frozen replacement workflow impossible.
    if (entry.entryKind === "release" || entry.entryKind === "technical_reversal") {
      return;
    }
    const crossSource = await tx.$queryRaw<Array<{ duplicateExists: boolean }>>(Prisma.sql`
      SELECT "pol280_cross_source_identity_exists"(
        ${entry.dispute.economicIdentityKey}
      ) AS "duplicateExists"
    `);
    if (crossSource[0]?.duplicateExists) {
      throw new ConflictException("duplicate_blocked：该经济事项已由必要费用准备正式来源覆盖");
    }
    const clearingDuplicate =
      await this.clearingReconciliation.readProjectFundDisputeDuplicateInTransaction(
        tx,
        {
          projectId: entry.dispute.projectId,
          constructionEnterpriseAssignmentId:
            entry.dispute.affiliateAssignmentId,
          basisBusinessIdOrEvidenceSha256:
            entry.dispute.basisBusinessIdOrEvidenceSha256,
          evidenceSha256: entry.evidenceSha256
        }
      );
    if (clearingDuplicate === "active") {
      throw new ConflictException(
        "duplicate_blocked：该经济事项已由 #275 待对账、覆盖或继续暂扣正式关系覆盖"
      );
    }
    if (clearingDuplicate === "integrity_conflict") {
      throw new ConflictException(
        "duplicate_suspected：#275 核对关系不完整，无法证明该事项未被正式覆盖"
      );
    }
    const duplicate = await tx.$queryRaw<Array<{ duplicateExists: boolean }>>(Prisma.sql`
      WITH matched AS (
        SELECT CASE
          WHEN impact."impactKind" IN (
            'confirmed_cost', 'payable_increase', 'estimated_clearing_expense',
            'necessary_expense_reserve_increase', 'project_disputed_funds_increase'
          ) AND impact."direction" = 'increase' THEN impact."amountCents"
          WHEN impact."impactKind" IN (
            'confirmed_cost', 'payable_increase', 'estimated_clearing_expense',
            'necessary_expense_reserve_increase', 'project_disputed_funds_increase'
          ) AND impact."direction" = 'decrease' THEN -impact."amountCents"
          WHEN impact."impactKind" = 'construction_enterprise_funds_freeze'
            AND impact."direction" = 'decrease' THEN impact."amountCents"
          WHEN impact."impactKind" = 'construction_enterprise_funds_release'
            AND impact."direction" = 'increase' THEN -impact."amountCents"
          WHEN impact."impactKind" IN (
            'construction_enterprise_funds_decrease', 'company_project_funds_decrease'
          ) AND impact."direction" = 'decrease' THEN impact."amountCents"
          WHEN impact."impactKind" IN (
            'construction_enterprise_funds_increase', 'company_project_funds_increase'
          ) AND impact."direction" = 'increase' THEN -impact."amountCents"
          ELSE 0
        END AS "signedAmount"
          FROM "OperatingImpactEntry" impact
          JOIN "OperatingFact" fact ON fact."id" = impact."factId"
         WHERE impact."projectId" = ${entry.dispute.projectId}
           AND fact."status" = 'confirmed'
           AND impact."impactKind" IN (
             'confirmed_cost', 'payable_increase', 'estimated_clearing_expense',
             'necessary_expense_reserve_increase', 'project_disputed_funds_increase',
             'construction_enterprise_funds_freeze', 'construction_enterprise_funds_release',
             'construction_enterprise_funds_decrease', 'construction_enterprise_funds_increase',
             'company_project_funds_decrease', 'company_project_funds_increase'
           )
           AND (
             (
               NOT (
                 fact."sourceType" = ${PROJECT_FUND_DISPUTE_SOURCE_TYPE}
                 AND impact."impactSnapshot" ->> 'disputeId' = ${entry.dispute.id}
               )
               AND (
                 impact."impactSnapshot" ->> 'economicIdentityKey' = ${entry.dispute.economicIdentityKey}
                 OR fact."sourceSnapshot" ->> 'basisBusinessIdOrEvidenceSha256' = ${entry.dispute.basisBusinessIdOrEvidenceSha256}
                 OR fact."basisSnapshot" ->> 'evidenceSha256' = ${entry.evidenceSha256}
                 OR jsonb_path_exists(
                   fact."sourceSnapshot",
                   '$.** ? (@ == $needle)',
                   jsonb_build_object('needle', to_jsonb(${entry.dispute.basisBusinessIdOrEvidenceSha256}::text))
                 )
                 OR jsonb_path_exists(
                   COALESCE(fact."basisSnapshot", '{}'::jsonb),
                   '$.** ? (@ == $needle)',
                   jsonb_build_object('needle', to_jsonb(${entry.evidenceSha256}::text))
                 )
               )
             )
             OR (
               fact."sourceType" = ${PROJECT_FUND_DISPUTE_SOURCE_TYPE}
               AND impact."impactSnapshot" ->> 'disputeId' = ${entry.dispute.id}
               AND fact."basisSnapshot" ->> 'evidenceSha256' = ${entry.evidenceSha256}
             )
           )
      )
      SELECT (COALESCE(SUM("signedAmount"), 0) > 0) AS "duplicateExists"
        FROM matched
    `);
    if (duplicate[0]?.duplicateExists) {
      throw new ConflictException("duplicate_blocked：该经济事项已由 #275 待对账/暂扣、必要准备、成本、应付、资金变动或其他正式来源覆盖");
    }
    const suspected = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT impact."id"
        FROM "OperatingImpactEntry" impact
        JOIN "OperatingFact" fact ON fact."id" = impact."factId"
       WHERE impact."projectId" = ${entry.dispute.projectId}
         AND fact."status" = 'confirmed'
         AND impact."impactKind" IN (
           'estimated_clearing_expense', 'necessary_expense_reserve_increase',
           'construction_enterprise_funds_freeze', 'project_disputed_funds_increase'
         )
         AND impact."amountCents" = ${entry.amountCents}
         AND impact."subjectKind" = ${entry.dispute.fundHolderKind}
         AND impact."subjectId" = ${entry.dispute.fundHolderId}
         AND NULLIF(impact."impactSnapshot" ->> 'economicIdentityKey', '') IS NULL
         AND NULLIF(fact."sourceSnapshot" ->> 'basisBusinessIdOrEvidenceSha256', '') IS NULL
         AND NULLIF(fact."basisSnapshot" ->> 'evidenceSha256', '') IS NULL
       LIMIT 1
    `);
    if (suspected[0]) {
      throw new ConflictException("duplicate_suspected：存在同金额、同资金主体但缺少可比经济身份的正式扣减，请补充依据后复核");
    }
  }

  private async buildFrozenSnapshot(
    tx: Tx,
    entry: {
      id: string;
      draftRevision: number;
      entryKind: string;
      adjustsEntryId: string | null;
      amountCents: bigint;
      occurredAt: Date;
      disputeSummary: string;
      resolutionBasisSummary: string | null;
      evidenceLevel: string;
      evidenceFileId: string;
      evidenceSha256: string;
      fingerprint: string;
      idempotencyKey: string;
      payloadSnapshot: Prisma.JsonValue | null;
      dispute: {
        id: string;
        projectId: string;
        businessCode: string;
        disputeKind: string;
        counterpartyKind: string;
        counterpartyId: string;
        counterpartyNameSnapshot: string;
        affiliateAssignmentId: string;
        affiliateBusinessPartyVersionId: string;
        affiliateNameSnapshot: string;
        affiliateCreditCodeSnapshot: string | null;
        fundHolderKind: string;
        fundHolderId: string;
        basisKind: string;
        basisBusinessIdOrEvidenceSha256: string;
        referenceCode: string;
        economicIdentityKey: string;
        sourceIdentityKey: string;
      };
    }
  ): Promise<Prisma.InputJsonObject> {
    const project = await tx.project.findUnique({
      where: { id: entry.dispute.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) {
      throw new ConflictException("项目经营账生效日不存在");
    }
    const adjustedEntry = entry.adjustsEntryId
      ? await tx.projectFundDisputeEntry.findUnique({
          where: { id: entry.adjustsEntryId },
          select: {
            disputeId: true,
            entryKind: true,
            amountCents: true,
            fingerprint: true,
            status: true
          }
        })
      : null;
    if (
      entry.adjustsEntryId &&
      (!adjustedEntry ||
        adjustedEntry.disputeId !== entry.dispute.id ||
        adjustedEntry.status !== "confirmed" ||
        !["establish", "increase"].includes(adjustedEntry.entryKind))
    ) {
      throw new ConflictException("释放或技术冲销必须引用同一事项的已确认建立/增加分录");
    }
    if (
      entry.entryKind === "technical_reversal" &&
      adjustedEntry?.amountCents !== entry.amountCents
    ) {
      throw new ConflictException("技术冲销必须等额冲销原确认分录");
    }
    return {
      schema: "project_fund_dispute_entry/V1",
      disputeId: entry.dispute.id,
      entryId: entry.id,
      entryKind: entry.entryKind,
      ...(entry.adjustsEntryId ? { adjustsEntryId: entry.adjustsEntryId } : {}),
      ...(adjustedEntry
        ? {
            adjustsEntryKind: adjustedEntry.entryKind,
            adjustsEntryFingerprint: adjustedEntry.fingerprint
          }
        : {}),
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString(),
      disputeSummary: entry.disputeSummary,
      resolutionBasisSummary: entry.resolutionBasisSummary,
      operatingLedgerEffectiveDate: project.operatingLedgerEffectiveDate.toISOString(),
      evidenceLevel: entry.evidenceLevel,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      fingerprint: entry.fingerprint,
      economicIdentityKey: entry.dispute.economicIdentityKey,
      sourceIdentityKey: entry.dispute.sourceIdentityKey,
      idempotencyKey: entry.idempotencyKey,
      sourceVersion: String(entry.draftRevision),
      businessCode: entry.dispute.businessCode,
      disputeKind: entry.dispute.disputeKind,
      counterpartyKind: entry.dispute.counterpartyKind,
      counterpartyId: entry.dispute.counterpartyId,
      counterpartyNameSnapshot: entry.dispute.counterpartyNameSnapshot,
      basisKind: entry.dispute.basisKind,
      basisBusinessIdOrEvidenceSha256:
        entry.dispute.basisBusinessIdOrEvidenceSha256,
      referenceCode: entry.dispute.referenceCode,
      affiliate: {
        assignmentId: entry.dispute.affiliateAssignmentId,
        businessPartyVersionId: entry.dispute.affiliateBusinessPartyVersionId,
        name: entry.dispute.affiliateNameSnapshot,
        ...(entry.dispute.affiliateCreditCodeSnapshot
          ? { creditCode: entry.dispute.affiliateCreditCodeSnapshot }
          : {})
      },
      fundHolder: {
        kind: entry.dispute.fundHolderKind,
        id: entry.dispute.fundHolderId
      },
      replacementImpacts: this.replacementSnapshot(entry.payloadSnapshot)
    };
  }

  private async appendReplacementLinks(
    tx: Tx,
    entry: { id: string; amountCents: bigint; dispute: { projectId: string } },
    snapshot: unknown
  ) {
    const replacements = this.replacementSnapshot(snapshot);
    if (!replacements.length) return;
    const impacts = await tx.operatingImpactEntry.findMany({
      where: {
        id: { in: replacements.map((replacement) => replacement.operatingImpactEntryId) },
        projectId: entry.dispute.projectId
      },
      select: {
        id: true,
        amountCents: true,
        impactKind: true,
        direction: true,
        sourceType: true,
        fact: { select: { status: true } }
      }
    });
    if (impacts.length !== replacements.length) {
      throw new ConflictException("释放声明的替代正式影响不存在或不属于同一项目");
    }
    const impactById = new Map(impacts.map((impact) => [impact.id, impact]));
    if (impacts.some((impact) =>
      impact.fact.status !== "confirmed" ||
      impact.sourceType === PROJECT_FUND_DISPUTE_SOURCE_TYPE ||
      !PROJECT_FUND_DISPUTE_REPLACEMENT_IMPACT_PAIRS.has(
        `${impact.impactKind}:${impact.direction}`
      )
    )) {
      throw new ConflictException("释放替代只能引用同项目已确认的正式扣减影响");
    }
    const total = replacements.reduce((sum, replacement) => sum + BigInt(replacement.amountCents), 0n);
    if (total > entry.amountCents || replacements.some((replacement) => {
      const impact = impactById.get(replacement.operatingImpactEntryId);
      return !impact || BigInt(replacement.amountCents) > impact.amountCents;
    })) {
      throw new ConflictException("释放替代分配超过释放金额或正式影响金额");
    }
    const orderedReplacements = [...replacements].sort((left, right) =>
      left.operatingImpactEntryId < right.operatingImpactEntryId
        ? -1
        : left.operatingImpactEntryId > right.operatingImpactEntryId
          ? 1
          : 0
    );
    for (const replacement of orderedReplacements) {
      await tx.projectFundDisputeReplacement.create({
        data: {
          id: randomUUID(),
          disputeEntryId: entry.id,
          operatingImpactEntryId: replacement.operatingImpactEntryId,
          amountCents: BigInt(replacement.amountCents)
        }
      });
    }
  }

  private entryAsDraft(entry: {
    dispute: {
      id: string;
      projectId: string;
      businessCode: string;
      affiliateAssignmentId: string;
      fundHolderKind: string;
      fundHolderId: string;
      disputeKind: string;
      counterpartyKind: string;
      counterpartyId: string;
      counterpartyNameSnapshot: string;
      basisKind: string;
      basisBusinessIdOrEvidenceSha256: string;
      referenceCode: string;
    };
    id: string;
    entryKind: string;
    adjustsEntryId: string | null;
    amountCents: bigint;
    occurredAt: Date;
    evidenceLevel: string;
    evidenceFileId: string;
    evidenceSha256: string;
    disputeSummary: string;
    resolutionBasisSummary: string | null;
    idempotencyKey: string;
    draftRevision: number;
    payloadSnapshot: Prisma.JsonValue | null;
  }): ValidatedProjectFundDisputeDraft {
    return assertProjectFundDisputeDraft({
      disputeId: entry.dispute.id,
      entryId: entry.id,
      projectId: entry.dispute.projectId,
      businessCode: entry.dispute.businessCode,
      affiliateAssignmentId: entry.dispute.affiliateAssignmentId,
      fundHolderKind: entry.dispute.fundHolderKind as never,
      fundHolderId: entry.dispute.fundHolderId,
      disputeKind: entry.dispute.disputeKind as never,
      counterpartyKind: entry.dispute.counterpartyKind,
      counterpartyId: entry.dispute.counterpartyId,
      counterpartyNameSnapshot: entry.dispute.counterpartyNameSnapshot,
      basisKind: entry.dispute.basisKind,
      basisBusinessIdOrEvidenceSha256: entry.dispute.basisBusinessIdOrEvidenceSha256,
      referenceCode: entry.dispute.referenceCode,
      entryKind: entry.entryKind as never,
      ...(entry.adjustsEntryId ? { adjustsEntryId: entry.adjustsEntryId } : {}),
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString().slice(0, 10),
      evidenceLevel: entry.evidenceLevel as never,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      disputeSummary: entry.disputeSummary,
      ...(entry.resolutionBasisSummary
        ? { resolutionBasisSummary: entry.resolutionBasisSummary }
        : {}),
      replacementImpacts: this.replacementSnapshot(entry.payloadSnapshot),
      idempotencyKey: entry.idempotencyKey,
      expectedRevision: entry.draftRevision
    });
  }

  private draftReplacementSnapshot(draft: ValidatedProjectFundDisputeDraft): Prisma.InputJsonObject {
    return { replacementImpacts: draft.replacementImpacts ?? [] } as Prisma.InputJsonObject;
  }

  private replacementSnapshot(value: unknown): Array<{
    operatingImpactEntryId: string;
    amountCents: string;
  }> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = (value as Record<string, unknown>).replacementImpacts;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      return typeof record.operatingImpactEntryId === "string" &&
        typeof record.amountCents === "string"
        ? [{
            operatingImpactEntryId: record.operatingImpactEntryId,
            amountCents: record.amountCents
          }]
        : [];
    });
  }

  private async requireAction(
    tx: Tx,
    userId: string,
    projectId: string,
    action: BusinessAction
  ): Promise<RoleKey[]> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) throw new ForbiddenException("当前账号不可用");
    const assignments = await tx.userPosition.findMany({
      where: { userId, OR: [{ projectId: null }, { projectId }] },
      select: { positionId: true, projectId: true }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: [...new Set(assignments.map((row) => row.positionId))] } },
          select: { id: true, key: true }
        })
      : [];
    const positionById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const projectMembers = await tx.projectMember.findMany({
      where: { userId, projectId },
      select: { positionKey: true }
    });
    const globalRoles = assignments
      .filter((row) => row.projectId === null)
      .map((row) => positionById.get(row.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const projectRoles = [
      ...assignments
        .filter((row) => row.projectId === projectId)
        .map((row) => positionById.get(row.positionId))
        .filter((role): role is RoleKey => Boolean(role)),
      ...projectMembers.map((row) => row.positionKey as RoleKey)
    ];
    const roles = resolveEffectiveRoleKeys(globalRoles, projectRoles);
    if (!canPerform(action, roles)) {
      throw new ForbiddenException(`当前账号缺少争议资金动作权限：${ACTION_REQUIRED_ROLES[action].join("、")}`);
    }
    return roles;
  }

  private lockEconomicIdentity(tx: Tx, economicIdentityKey: string) {
    return tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('pol:project-cash-restriction:economic:' || ${economicIdentityKey}, 0)
      )
    `);
  }

  private lockCommandIdempotency(tx: Tx, idempotencyKey: string) {
    return tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('pol280:command:' || ${idempotencyKey}, 0)
      )
    `);
  }

  private async lockConfirmationRows(
    tx: Tx,
    entry: DisputeEntryWithRelations
  ) {
    const project = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT project."id"
        FROM "Project" project
       WHERE project."id" = ${entry.dispute.projectId}
       FOR UPDATE
    `);
    const dispute = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT dispute."id"
        FROM "ProjectFundDispute" dispute
       WHERE dispute."id" = ${entry.dispute.id}
       FOR UPDATE
    `);
    if (!project[0] || !dispute[0]) {
      throw new ConflictException("争议资金确认锚点已变化，请刷新后重试");
    }
    if (entry.adjustsEntryId) {
      const adjusted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT adjusted."id"
          FROM "ProjectFundDisputeEntry" adjusted
         WHERE adjusted."id" = ${entry.adjustsEntryId}
         FOR UPDATE
      `);
      if (!adjusted[0]) {
        throw new ConflictException("争议资金调整目标已变化，请刷新后重试");
      }
    }
  }

  private createCommandReceipt(
    tx: Tx,
    input: {
      entryId: string;
      idempotencyKey: string;
      action: string;
      actorUserId: string;
      commandFingerprint: string;
      result: ProjectFundDisputeEntryReadModel;
    }
  ) {
    return tx.projectFundDisputeCommandReceipt.create({
      data: {
        id: randomUUID(),
        entryId: input.entryId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        actorUserId: input.actorUserId,
        commandFingerprint: input.commandFingerprint,
        resultSnapshot: input.result as unknown as Prisma.InputJsonObject
      }
    });
  }

  private capabilities(roles: readonly RoleKey[]) {
    const actions = ["read", "prepare", "submit", "attest", "confirm", "return"] as const;
    return Object.fromEntries(actions.map((action) => [
      action,
      canPerform(`project_fund_dispute.${action}` as BusinessAction, roles)
    ]));
  }

  private publicDispute(dispute: DisputeWithEntries) {
    return {
      id: dispute.id,
      businessCode: dispute.businessCode,
      disputeKind: dispute.disputeKind,
      counterpartyKind: dispute.counterpartyKind,
      counterpartyId: dispute.counterpartyId,
      counterpartyNameSnapshot: dispute.counterpartyNameSnapshot,
      fundHolderKind: dispute.fundHolderKind,
      fundHolderId: dispute.fundHolderId,
      basisKind: dispute.basisKind,
      basisBusinessIdOrEvidenceSha256:
        dispute.basisBusinessIdOrEvidenceSha256,
      referenceCode: dispute.referenceCode,
      entries: dispute.entries.map((entry) => this.publicEntry(entry))
    };
  }

  private commandReceiptResult(value: Prisma.JsonValue): ProjectFundDisputeEntryReadModel {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.id !== "string" ||
      typeof value.disputeId !== "string" ||
      typeof value.fingerprint !== "string" ||
      typeof value.status !== "string" ||
      !Array.isArray(value.replacements)
    ) {
      throw new ConflictException("争议资金命令回执损坏，拒绝幂等重放");
    }
    return value as unknown as ProjectFundDisputeEntryReadModel;
  }

  private publicEntry(entry: DisputeEntryPublicData): ProjectFundDisputeEntryReadModel {
    return {
      id: entry.id,
      disputeId: entry.disputeId,
      sequenceNo: entry.sequenceNo,
      revision: entry.draftRevision,
      entryKind: entry.entryKind,
      adjustsEntryId: entry.adjustsEntryId,
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString().slice(0, 10),
      disputeSummary: entry.disputeSummary,
      resolutionBasisSummary: entry.resolutionBasisSummary,
      evidenceLevel: entry.evidenceLevel,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      status: entry.status,
      fingerprint: entry.fingerprint,
      preparedByUserId: entry.preparedByUserId,
      submittedByUserId: entry.submittedByUserId,
      attestedByUserId: entry.attestedByUserId,
      confirmedByUserId: entry.confirmedByUserId,
      confirmedAt: entry.confirmedAt?.toISOString() ?? null,
      returnReason: entry.returnReason,
      replacements: entry.replacements.map((replacement) => ({
        operatingImpactEntryId: replacement.operatingImpactEntryId,
        amountCents: replacement.amountCents.toString()
      }))
    };
  }

  private async serializable<T>(work: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (attempt === 0 && isDatabaseSerializationFailure(error)) {
          continue;
        }
        if (isProjectFundDisputeConcurrencyOrCapacityConflict(error)) {
          throw new ConflictException(
            "争议资金并发或容量校验冲突，请刷新后重试"
          );
        }
        throw error;
      }
    }
    throw new ConflictException("争议资金并发冲突，请刷新后重试");
  }
}

function validateTransitionCommand(command: ProjectFundDisputeTransitionCommand) {
  requiredText(command.entryId, "争议资金分录不能为空");
  if (!PROJECT_FUND_DISPUTE_TRANSITION_ACTIONS.includes(command.action)) {
    throw new BadRequestException("争议资金动作不正确");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new BadRequestException("expectedRevision 必须是正整数");
  }
  if (!/^[0-9a-f]{64}$/u.test(command.expectedFingerprint)) {
    throw new BadRequestException("expectedFingerprint 必须是 SHA-256");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.idempotencyKey)) {
    throw new BadRequestException("幂等键必须使用 UUIDv4");
  }
}

function isProjectFundDisputeConcurrencyOrCapacityConflict(error: unknown): boolean {
  if (isPostgresSerializationFailure(error)) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  const message = `${String(record.message ?? "")} ${String(record.meta?.message ?? "")}`;
  return record.code === "P2034" ||
    record.code === "40001" ||
    record.code === "40P01" ||
    record.code === "23514" ||
    record.meta?.code === "40001" ||
    record.meta?.code === "40P01" ||
    record.meta?.code === "23514" ||
    message.includes("POL-280") ||
    message.includes("40001") ||
    message.includes("40P01") ||
    message.includes("23514") ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected");
}

function isDatabaseSerializationFailure(error: unknown): boolean {
  if (isPostgresSerializationFailure(error)) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  const message = `${String(record.message ?? "")} ${String(record.meta?.message ?? "")}`;
  return record.code === "P2034" ||
    record.code === "40001" ||
    record.code === "40P01" ||
    record.meta?.code === "40001" ||
    record.meta?.code === "40P01" ||
    message.includes("40001") ||
    message.includes("40P01") ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected");
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}
