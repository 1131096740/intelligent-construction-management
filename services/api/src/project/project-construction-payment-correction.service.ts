import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { PrismaService } from "../database/prisma.service";
import {
  missingOperatingSourceReplayService,
  OperatingSourceReplayService,
  type OperatingSourceAppendPort
} from "../operating-ledger/operating-source-replay.service";
import { lockSettlementLedger, syncAffiliatePaymentRequest } from "./project-affiliate-business.service";
import { validateRemittanceLineage } from "./project.service";
import { CONSTRUCTION_ENTERPRISE_FEE_SOURCE_TYPE } from "./project-construction-enterprise-fee-operating-source.adapter";

export const CONSTRUCTION_PAYMENT_CORRECTION_SOURCES = [
  "downstream_payment",
  "affiliate_remittance_to_company",
  "affiliate_deduction"
] as const;
export type ConstructionPaymentCorrectionSource =
  (typeof CONSTRUCTION_PAYMENT_CORRECTION_SOURCES)[number];

export interface RequestConstructionPaymentCorrectionInput {
  sourceType: ConstructionPaymentCorrectionSource;
  originalFactId: string;
  correctionReason: string;
  idempotencyKey: string;
  amountCents?: string;
  occurredAt?: string;
  counterpartyName?: string;
  feeName?: string;
  contractLedgerId?: string;
  settlementLedgerId?: string;
  paymentRequestId?: string;
  companyEntityId?: string;
  affiliateCompanyContractId?: string;
  affiliateSettlementFactId?: string;
  invoiceRecordId?: string;
  evidenceFileId?: string;
  description?: string;
}

export interface ConfirmConstructionPaymentCorrectionInput {
  confirmationPassword: string;
  confirmationActionId: string;
  selfReviewReason?: string;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requiredText(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new BadRequestException(message);
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveMoney(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value.trim())) {
    throw new BadRequestException("更正后的金额必须按分填写为大于零的整数");
  }
  return BigInt(value.trim());
}

function parseCorrectionDate(value: string | undefined, fallback: Date, message: string): Date {
  if (value === undefined) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(message);
  return parsed;
}

async function loadActorRoleKeys(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  projectId: string
): Promise<RoleKey[]> {
  const [globalPositions, projectPositions, projectMembers] = await Promise.all([
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
    tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
  ]);
  const positionIds = [
    ...new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    )
  ];
  const positions = positionIds.length
    ? await tx.position.findMany({ where: { id: { in: positionIds } } })
    : [];
  return [
    ...new Set([
      ...positions.map((position) => position.key as RoleKey),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ])
  ];
}

/**
 * OPS-09「同一更正」，方案 A：反转 + 重登，零迁移。
 *
 * - 不新增更正实体，不新增文件列；
 * - 原事实保持 confirmed 不变，反向事实精确等额冲回；
 * - 重登事实以 entryKind=correction、adjustsFactId=原事实弱关联正确值；
 * - 综合部或财务提出（pending_confirm），财务主管确认；本人自审需原因 + 本人密码；
 * - 确认后两端（施工企业已付与项目资金投影）由同一事务重放，不改写原记录。
 */
@Injectable()
export class ProjectConstructionPaymentCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit: AuditService = new AuditService(),
    @Optional() private readonly auth?: AuthService,
    @Optional()
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService()
  ) {}

  async getCorrectionCapability(projectId: string, actorUserId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    const roleKeys = await loadActorRoleKeys(
      this.prisma as unknown as Prisma.TransactionClient,
      actorUserId,
      projectId
    );
    const availableActions: string[] = [];
    if (canPerform("project.construction_payment_correction.request", roleKeys)) {
      availableActions.push("request_construction_payment_correction");
    }
    if (canPerform("project.construction_payment_correction.confirm", roleKeys)) {
      availableActions.push("confirm_construction_payment_correction");
    }
    return { projectId, availableActions };
  }

  async requestCorrection(
    projectId: string,
    actorUserId: string,
    input: RequestConstructionPaymentCorrectionInput
  ) {
    const sourceType = input.sourceType;
    if (!CONSTRUCTION_PAYMENT_CORRECTION_SOURCES.includes(sourceType)) {
      throw new BadRequestException("施工企业付款更正来源类型不正确");
    }
    const originalFactId = requiredText(input.originalFactId, "请选择需要更正的施工企业付款事实");
    const correctionReason = requiredText(input.correctionReason, "请填写更正原因");
    const idempotencyKey = requiredText(input.idempotencyKey, "请提供施工企业付款更正幂等键");

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`
      );
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      if (!canPerform("project.construction_payment_correction.request", roleKeys)) {
        throw new ForbiddenException("只有综合部主管、财务人员或财务主管可以提出施工企业付款更正");
      }
      const reversalKey = `${idempotencyKey}:reversal`;
      const existingReversal = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "ProjectAffiliatePaymentFact"
        WHERE "idempotencyKey" = ${reversalKey}
        UNION ALL
        SELECT "id" FROM "ProjectUpstreamFundFact"
        WHERE "idempotencyKey" = ${reversalKey}
      `);
      if (existingReversal.length > 0) {
        const pair = await this.readPendingPair(
          tx,
          sourceType,
          originalFactId
        );
        if (!pair) {
          throw new ConflictException("施工企业付款更正幂等键已用于不同动作");
        }
        return this.toCorrectionReadModel(pair);
      }

      if (sourceType === "downstream_payment") {
        const original = await tx.projectAffiliatePaymentFact.findFirst({
          where: { id: originalFactId, projectId }
        });
        if (!original) throw new NotFoundException("待更正的施工企业付款事实不存在");
        if (original.entryKind !== "original" || original.status !== "confirmed") {
          throw new BadRequestException("只能对已确认的原始施工企业付款事实发起更正");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ProjectAffiliatePaymentFact"
          WHERE "id" = ${originalFactId} AND "projectId" = ${projectId} FOR UPDATE
        `);
        await this.assertNoOpenCorrection(tx, originalFactId);
        const corrected = await this.resolveDownstreamCorrection(
          tx,
          projectId,
          actorUserId,
          original,
          input
        );
        const reversal = await tx.projectAffiliatePaymentFact.create({
          data: {
            ...this.paymentFactCore(original),
            projectId,
            id: randomUUID(),
            entryKind: "reversal",
            adjustsFactId: original.id,
            effectDirection: "decrease",
            externalPaymentReference: null,
            idempotencyKey: reversalKey,
            requestFingerprint: fingerprint({
              correctionKind: "reversal",
              originalFactId,
              idempotencyKey
            }),
            recordedByUserId: actorUserId,
            recordedByRoleKey: this.roleKeyFor(roleKeys),
            status: "pending_confirm"
          }
        });
        const replacement = await tx.projectAffiliatePaymentFact.create({
          data: {
            ...corrected,
            projectId,
            id: randomUUID(),
            ledgerId: original.ledgerId,
            entryKind: "correction",
            adjustsFactId: original.id,
            effectDirection: "increase",
            externalPaymentReference: null,
            idempotencyKey: `${idempotencyKey}:correction`,
            requestFingerprint: fingerprint({
              correctionKind: "correction",
              originalFactId,
              idempotencyKey,
              request: input
            }),
            recordedByUserId: actorUserId,
            recordedByRoleKey: this.roleKeyFor(roleKeys),
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.construction_payment_correction.request",
          businessType: "project_affiliate_payment_fact",
          businessId: original.id,
          metadata: {
            projectId,
            sourceType,
            originalFactId,
            reversalFactId: reversal.id,
            replacementFactId: replacement.id,
            correctionReason,
            idempotencyKey
          }
        });
        return this.toCorrectionReadModel({
          sourceType,
          originalFactId,
          reversalFactId: reversal.id,
          replacementFactId: replacement.id
        });
      }

      if (sourceType === "affiliate_deduction") {
        const deduction = await tx.projectUpstreamFundFact.findFirst({
          where: { id: originalFactId, projectId }
        });
        if (!deduction) throw new NotFoundException("待更正的施工企业扣费事实不存在");
        if (
          deduction.factType !== "affiliate_deduction" ||
          deduction.entryKind !== "original" ||
          deduction.status !== "confirmed"
        ) {
          throw new BadRequestException("只能对已确认的施工企业扣费原始事实发起更正");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ProjectUpstreamFundFact"
          WHERE "id" = ${originalFactId} AND "projectId" = ${projectId} FOR UPDATE
        `);
        await this.assertNoOpenCorrection(tx, originalFactId);
        const corrected = await this.resolveDeductionCorrection(
          tx,
          actorUserId,
          deduction,
          input
        );
        const reversal = await tx.projectUpstreamFundFact.create({
          data: {
            ...this.remittanceFactCore(deduction),
            projectId,
            id: randomUUID(),
            entryKind: "reversal",
            adjustsFactId: deduction.id,
            effectDirection: "decrease",
            idempotencyKey: reversalKey,
            requestFingerprint: fingerprint({
              correctionKind: "reversal",
              originalFactId,
              idempotencyKey
            }),
            recordedByUserId: actorUserId,
            recordedByRoleKey: this.roleKeyFor(roleKeys),
            status: "pending_confirm"
          }
        });
        const replacement = await tx.projectUpstreamFundFact.create({
          data: {
            ...corrected,
            projectId,
            id: randomUUID(),
            entryKind: "correction",
            adjustsFactId: deduction.id,
            effectDirection: "increase",
            idempotencyKey: `${idempotencyKey}:correction`,
            requestFingerprint: fingerprint({
              correctionKind: "correction",
              originalFactId,
              idempotencyKey,
              request: input
            }),
            recordedByUserId: actorUserId,
            recordedByRoleKey: this.roleKeyFor(roleKeys),
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.construction_payment_correction.request",
          businessType: "project_upstream_fund_fact",
          businessId: deduction.id,
          metadata: {
            projectId,
            sourceType,
            originalFactId,
            reversalFactId: reversal.id,
            replacementFactId: replacement.id,
            correctionReason,
            idempotencyKey
          }
        });
        return this.toCorrectionReadModel({
          sourceType,
          originalFactId,
          reversalFactId: reversal.id,
          replacementFactId: replacement.id
        });
      }

      const original = await tx.projectUpstreamFundFact.findFirst({
        where: { id: originalFactId, projectId }
      });
      if (!original) throw new NotFoundException("待更正的施工企业拨款事实不存在");
      if (
        original.factType !== "affiliate_remittance_to_company" ||
        original.entryKind !== "original" ||
        original.status !== "confirmed"
      ) {
        throw new BadRequestException("只能对已确认的施工企业拨款原始事实发起更正");
      }
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ProjectUpstreamFundFact"
        WHERE "id" = ${originalFactId} AND "projectId" = ${projectId} FOR UPDATE
      `);
      await this.assertNoOpenCorrection(tx, originalFactId);
      const corrected = await this.resolveRemittanceCorrection(
        tx,
        projectId,
        actorUserId,
        original,
        input
      );
      const reversal = await tx.projectUpstreamFundFact.create({
        data: {
          ...this.remittanceFactCore(original),
          id: randomUUID(),
          entryKind: "reversal",
          adjustsFactId: original.id,
          effectDirection: "decrease",
          idempotencyKey: reversalKey,
          requestFingerprint: fingerprint({
            correctionKind: "reversal",
            originalFactId,
            idempotencyKey
          }),
          recordedByUserId: actorUserId,
          recordedByRoleKey: this.roleKeyFor(roleKeys),
          status: "pending_confirm"
        }
      });
      const replacement = await tx.projectUpstreamFundFact.create({
        data: {
          ...corrected,
          id: randomUUID(),
          entryKind: "correction",
          adjustsFactId: original.id,
          effectDirection: "increase",
          idempotencyKey: `${idempotencyKey}:correction`,
          requestFingerprint: fingerprint({
            correctionKind: "correction",
            originalFactId,
            idempotencyKey,
            request: input
          }),
          recordedByUserId: actorUserId,
          recordedByRoleKey: this.roleKeyFor(roleKeys),
          status: "pending_confirm"
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.construction_payment_correction.request",
        businessType: "project_upstream_fund_fact",
        businessId: original.id,
        metadata: {
          projectId,
          sourceType,
          originalFactId,
          reversalFactId: reversal.id,
          replacementFactId: replacement.id,
          correctionReason,
          idempotencyKey
        }
      });
      return this.toCorrectionReadModel({
        sourceType,
        originalFactId,
        reversalFactId: reversal.id,
        replacementFactId: replacement.id
      });
    });
  }

  async confirmCorrection(
    projectId: string,
    sourceType: ConstructionPaymentCorrectionSource,
    originalFactId: string,
    actorUserId: string,
    input: ConfirmConstructionPaymentCorrectionInput
  ) {
    const confirmationPassword = requiredText(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    const confirmationActionId = requiredText(
      input.confirmationActionId,
      "请提供施工企业付款更正确认幂等键"
    );
    if (!this.auth) {
      throw new Error("施工企业付款更正需要密码确认服务");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`
      );
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      if (!canPerform("project.construction_payment_correction.confirm", roleKeys)) {
        throw new ForbiddenException("施工企业付款更正必须由财务主管确认");
      }
      const pair = await this.readPendingPair(tx, sourceType, originalFactId);
      if (!pair) {
        throw new BadRequestException("没有待确认的施工企业付款更正，请刷新后核对");
      }
      const proposerUserId =
        sourceType === "downstream_payment"
          ? (await tx.projectAffiliatePaymentFact.findUnique({
              where: { id: pair.reversalFactId },
              select: { recordedByUserId: true }
            }))?.recordedByUserId
          : (await tx.projectUpstreamFundFact.findUnique({
              where: { id: pair.reversalFactId },
              select: { recordedByUserId: true }
            }))?.recordedByUserId;
      const selfReview = proposerUserId === actorUserId;
      const selfReviewReason = optionalText(input.selfReviewReason);
      if (selfReview && !selfReviewReason) {
        throw new BadRequestException("本人提出的施工企业付款更正自审必须填写原因");
      }
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });
      const now = new Date();
      if (sourceType === "downstream_payment") {
        for (const [factId, suffix] of [
          [pair.reversalFactId, "reversal"],
          [pair.replacementFactId, "correction"]
        ] as const) {
          const updated = await tx.projectAffiliatePaymentFact.updateMany({
            where: {
              id: factId,
              projectId,
              status: "pending_confirm",
              confirmationActionId: null
            },
            data: {
              status: "confirmed",
              confirmedByUserId: actorUserId,
              confirmedAt: now,
              confirmationActionId: `${confirmationActionId}:${suffix}`,
              confirmationSignatureVersionId: signature.versionId,
              confirmationSignatureFileId: signature.fileId,
              confirmationSignatureSha256: signature.sha256
            }
          });
          if (updated.count !== 1) {
            throw new ConflictException("施工企业付款更正已被其他操作确认，请刷新后核对");
          }
        }
        const confirmedFacts = await tx.projectAffiliatePaymentFact.findMany({
          where: { id: { in: [pair.reversalFactId, pair.replacementFactId] } }
        });
        for (const fact of confirmedFacts) {
          await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
            tx,
            {
              projectId,
              sourceType: "project_affiliate_payment_fact",
              sourceBusinessId: fact.id
            },
            actorUserId
          );
        }
        const requestIds = new Set(
          confirmedFacts
            .map((fact) => fact.paymentRequestId)
            .filter((id): id is string => Boolean(id))
        );
        for (const requestId of requestIds) {
          await syncAffiliatePaymentRequest(tx, projectId, requestId);
        }
      } else {
        for (const [factId, suffix] of [
          [pair.reversalFactId, "reversal"],
          [pair.replacementFactId, "correction"]
        ] as const) {
          const updated = await tx.projectUpstreamFundFact.updateMany({
            where: {
              id: factId,
              projectId,
              status: "pending_confirm",
              confirmationActionId: null
            },
            data: {
              status: "confirmed",
              confirmedByUserId: actorUserId,
              confirmedAt: now,
              confirmationActionId: `${confirmationActionId}:${suffix}`,
              confirmationSignatureVersionId: signature.versionId,
              confirmationSignatureFileId: signature.fileId,
              confirmationSignatureSha256: signature.sha256
            }
          });
          if (updated.count !== 1) {
            throw new ConflictException("施工企业拨款更正已被其他操作确认，请刷新后核对");
          }
        }
        for (const factId of [pair.reversalFactId, pair.replacementFactId]) {
          await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
            tx,
            {
              projectId,
              sourceType: "project_upstream_fund_fact",
              sourceBusinessId: factId
            },
            actorUserId
          );
          if (sourceType === "affiliate_deduction") {
            await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
              tx,
              {
                projectId,
                sourceType: CONSTRUCTION_ENTERPRISE_FEE_SOURCE_TYPE,
                sourceBusinessId: factId
              },
              actorUserId
            );
          }
        }
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "project.construction_payment_correction.confirm",
        businessType:
          sourceType === "downstream_payment"
            ? "project_affiliate_payment_fact"
            : "project_upstream_fund_fact",
        businessId: originalFactId,
        metadata: {
          projectId,
          sourceType,
          originalFactId,
          reversalFactId: pair.reversalFactId,
          replacementFactId: pair.replacementFactId,
          confirmationActionId,
          confirmationSignatureVersionId: signature.versionId,
          confirmedAt: now.toISOString(),
          selfReview,
          selfReviewReason: selfReview ? selfReviewReason : null
        }
      });
      return this.toCorrectionReadModel(pair);
    });
  }

  private roleKeyFor(roleKeys: readonly RoleKey[]) {
    if (roleKeys.includes("finance_director")) return "finance_director";
    if (roleKeys.includes("finance_staff")) return "finance_staff";
    if (roleKeys.includes("comprehensive_director")) return "comprehensive_director";
    return "finance_staff";
  }

  private async assertNoOpenCorrection(
    tx: Prisma.TransactionClient,
    originalFactId: string
  ) {
    const [paymentReversal, remittanceReversal] = await Promise.all([
      tx.projectAffiliatePaymentFact.findFirst({
        where: {
          entryKind: "reversal",
          adjustsFactId: originalFactId,
          status: "pending_confirm"
        },
        select: { id: true }
      }),
      tx.projectUpstreamFundFact.findFirst({
        where: {
          entryKind: "reversal",
          adjustsFactId: originalFactId,
          status: "pending_confirm"
        },
        select: { id: true }
      })
    ]);
    if (paymentReversal || remittanceReversal) {
      throw new ConflictException("该施工企业付款已有待确认更正，请先完成或等待确认");
    }
  }

  private async readPendingPair(
    tx: Prisma.TransactionClient,
    sourceType: ConstructionPaymentCorrectionSource,
    originalFactId: string
  ): Promise<{
    sourceType: ConstructionPaymentCorrectionSource;
    originalFactId: string;
    reversalFactId: string;
    replacementFactId: string;
  } | null> {
    const whereReversal = {
      entryKind: "reversal" as const,
      adjustsFactId: originalFactId,
      status: "pending_confirm" as const
    };
    const whereCorrection = {
      entryKind: "correction" as const,
      adjustsFactId: originalFactId,
      status: "pending_confirm" as const
    };
    const [reversal, replacement] =
      sourceType === "downstream_payment"
        ? await Promise.all([
            tx.projectAffiliatePaymentFact.findFirst({
              where: whereReversal,
              select: { id: true }
            }),
            tx.projectAffiliatePaymentFact.findFirst({
              where: whereCorrection,
              select: { id: true }
            })
          ])
        : await Promise.all([
            tx.projectUpstreamFundFact.findFirst({
              where: whereReversal,
              select: { id: true }
            }),
            tx.projectUpstreamFundFact.findFirst({
              where: whereCorrection,
              select: { id: true }
            })
          ]);
    if (!reversal || !replacement) return null;
    return {
      sourceType,
      originalFactId,
      reversalFactId: reversal.id,
      replacementFactId: replacement.id
    };
  }

  private toCorrectionReadModel(pair: {
    sourceType: ConstructionPaymentCorrectionSource;
    originalFactId: string;
    reversalFactId: string;
    replacementFactId: string;
  }) {
    return {
      ...pair,
      correctionMode: "reversal_and_re_register" as const,
      status: "pending_confirm" as const,
      availableAction: "confirm_construction_payment_correction" as const
    };
  }

  private paymentFactCore(
    original: Prisma.ProjectAffiliatePaymentFactGetPayload<Record<string, never>>
  ) {
    return {
      ledgerId: original.ledgerId,
      projectId: original.projectId,
      contractLedgerId: original.contractLedgerId,
      settlementLedgerId: original.settlementLedgerId,
      paymentRequestId: original.paymentRequestId,
      counterpartyName: original.counterpartyName,
      paidAt: original.paidAt,
      amountCents: original.amountCents,
      paymentKind: original.paymentKind,
      externalPaymentReference: null,
      affiliateAssignmentId: original.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: original.affiliateNameSnapshot,
      basisType: original.basisType,
      description: original.description,
      evidenceFileId: original.evidenceFileId,
      documentVersion: original.documentVersion,
      fileContentSha256Snapshot: original.fileContentSha256Snapshot
    };
  }

  private remittanceFactCore(
    original: Prisma.ProjectUpstreamFundFactGetPayload<Record<string, never>>
  ) {
    return {
      projectId: original.projectId,
      factType: original.factType,
      occurredAt: original.occurredAt,
      amountCents: original.amountCents,
      counterpartyName: original.counterpartyName,
      basisType: original.basisType,
      deductionCategory: original.deductionCategory,
      upstreamSettlementId: original.upstreamSettlementId,
      companyEntityId: original.companyEntityId,
      affiliateCompanyContractId: original.affiliateCompanyContractId,
      affiliateSettlementFactId: original.affiliateSettlementFactId,
      invoiceRecordId: original.invoiceRecordId,
      affiliateAssignmentId: original.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: original.affiliateNameSnapshot,
      description: original.description,
      evidenceFileId: original.evidenceFileId,
      documentVersion: original.documentVersion,
      fileContentSha256Snapshot: original.fileContentSha256Snapshot,
      bankObservationReference: null
    };
  }

  private async resolveDownstreamCorrection(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string,
    original: Prisma.ProjectAffiliatePaymentFactGetPayload<Record<string, never>>,
    input: RequestConstructionPaymentCorrectionInput
  ) {
    const contractLedgerId =
      optionalText(input.contractLedgerId) ?? original.contractLedgerId;
    const contract = await tx.projectAffiliateContractFact.findFirst({
      where: { id: contractLedgerId, projectId, status: "confirmed" },
      select: {
        counterpartyName: true,
        affiliateAssignmentId: true,
        affiliateBusinessPartyVersionId: true,
        affiliateNameSnapshot: true
      }
    });
    if (!contract) {
      throw new BadRequestException("更正后的施工企业合同不存在或尚未确认");
    }
    const counterpartyName =
      optionalText(input.counterpartyName) ?? original.counterpartyName;
    if (counterpartyName !== contract.counterpartyName) {
      throw new BadRequestException("更正后的付款对象必须与施工企业合同相对方完全一致");
    }
    const settlementLedgerId =
      input.settlementLedgerId === undefined
        ? original.settlementLedgerId
        : optionalText(input.settlementLedgerId) ?? null;
    if (original.paymentKind === "normal") {
      if (!settlementLedgerId) {
        throw new BadRequestException("正常施工企业付款更正后仍必须关联已确认结算");
      }
      const settlement = await tx.projectAffiliateSettlementFact.findFirst({
        where: { ledgerId: settlementLedgerId, projectId, status: "confirmed" },
        select: {
          contractLedgerId: true,
          counterpartyName: true,
          affiliateAssignmentId: true,
          affiliateBusinessPartyVersionId: true
        }
      });
      if (
        !settlement ||
        settlement.contractLedgerId !== contractLedgerId ||
        settlement.counterpartyName !== counterpartyName ||
        settlement.affiliateAssignmentId !== contract.affiliateAssignmentId ||
        settlement.affiliateBusinessPartyVersionId !==
          contract.affiliateBusinessPartyVersionId
      ) {
        throw new BadRequestException("更正后的合同、结算、相对方或施工企业主体不一致");
      }
      await lockSettlementLedger(tx, projectId, settlementLedgerId);
    } else if (settlementLedgerId) {
      throw new BadRequestException("预付款或直接付款更正不得伪装成结算付款");
    }
    const paymentRequestId =
      input.paymentRequestId === undefined
        ? original.paymentRequestId
        : optionalText(input.paymentRequestId) ?? null;
    if (paymentRequestId) {
      const request = await tx.paymentRequest.findFirst({
        where: { projectId, id: paymentRequestId },
        select: {
          status: true,
          paymentSubjectType: true,
          sourceType: true
        }
      });
      const expectedSourceType =
        original.paymentKind === "normal"
          ? "settlement"
          : original.paymentKind === "advance"
            ? "contract_advance"
            : "contract_due";
      const keepsPaidAdvanceRequest =
        request?.status === "paid" &&
        original.paymentKind === "advance" &&
        paymentRequestId === original.paymentRequestId &&
        contractLedgerId === original.contractLedgerId;
      if (
        !request ||
        (!["approved_pending_payment", "partially_paid"].includes(request.status) && !keepsPaidAdvanceRequest) ||
        request.paymentSubjectType !== "affiliate" ||
        request.sourceType !== expectedSourceType
      ) {
        throw new BadRequestException(
          "更正后的付款申请必须已审批且付款主体、来源与施工企业付款类型一致"
        );
      }
    }
    const evidence = await this.resolveEvidence(
      tx,
      actorUserId,
      original.evidenceFileId,
      input.evidenceFileId,
      original.basisType
    );
    return {
      contractLedgerId,
      settlementLedgerId,
      paymentRequestId,
      counterpartyName,
      paidAt: parseCorrectionDate(
        input.occurredAt,
        original.paidAt,
        "更正后的付款日期格式不正确"
      ),
      amountCents: positiveMoney(input.amountCents, original.amountCents),
      paymentKind: original.paymentKind,
      affiliateAssignmentId: contract.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: contract.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: contract.affiliateNameSnapshot,
      basisType: original.basisType,
      description: optionalText(input.description) ?? original.description,
      evidenceFileId: evidence.evidenceFileId,
      fileContentSha256Snapshot: evidence.fileContentSha256Snapshot
    };
  }

  private async resolveRemittanceCorrection(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string,
    original: Prisma.ProjectUpstreamFundFactGetPayload<Record<string, never>>,
    input: RequestConstructionPaymentCorrectionInput
  ) {
    const counterpartyName =
      optionalText(input.counterpartyName) ?? original.counterpartyName;
    const companyEntityId =
      optionalText(input.companyEntityId) ?? original.companyEntityId;
    const affiliateCompanyContractId =
      optionalText(input.affiliateCompanyContractId) ??
      original.affiliateCompanyContractId;
    const affiliateSettlementFactId =
      optionalText(input.affiliateSettlementFactId) ??
      original.affiliateSettlementFactId;
    const invoiceRecordId =
      optionalText(input.invoiceRecordId) ?? original.invoiceRecordId;
    if (
      !companyEntityId ||
      !affiliateCompanyContractId ||
      !affiliateSettlementFactId ||
      !invoiceRecordId
    ) {
      throw new BadRequestException(
        "施工企业向我方拨款更正后仍必须保留完整合同、结算和发票链路"
      );
    }
    await validateRemittanceLineage(tx, {
      projectId,
      counterpartyName,
      affiliate: {
        assignmentId: original.affiliateAssignmentId,
        businessPartyVersionId: original.affiliateBusinessPartyVersionId,
        name: original.affiliateNameSnapshot
      },
      companyEntityId,
      affiliateCompanyContractId,
      affiliateSettlementFactId,
      invoiceRecordId
    });
    const evidence = await this.resolveEvidence(
      tx,
      actorUserId,
      original.evidenceFileId,
      input.evidenceFileId,
      original.basisType
    );
    return {
      projectId,
      factType: original.factType,
      occurredAt: parseCorrectionDate(
        input.occurredAt,
        original.occurredAt,
        "更正后的到账日期格式不正确"
      ),
      amountCents: positiveMoney(input.amountCents, original.amountCents),
      counterpartyName,
      basisType: original.basisType,
      deductionCategory: original.deductionCategory,
      upstreamSettlementId: original.upstreamSettlementId,
      companyEntityId,
      affiliateCompanyContractId,
      affiliateSettlementFactId,
      invoiceRecordId,
      affiliateAssignmentId: original.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: original.affiliateNameSnapshot,
      description: optionalText(input.description) ?? original.description,
      evidenceFileId: evidence.evidenceFileId,
      fileContentSha256Snapshot: evidence.fileContentSha256Snapshot,
      bankObservationReference: original.bankObservationReference
    };
  }

  private async resolveDeductionCorrection(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    original: Prisma.ProjectUpstreamFundFactGetPayload<Record<string, never>>,
    input: RequestConstructionPaymentCorrectionInput
  ) {
    const feeName =
      optionalText(input.feeName) ??
      optionalText(input.description) ??
      optionalText(original.description ?? undefined);
    if (!feeName) {
      throw new BadRequestException("更正后的费用名称不能为空");
    }
    const counterpartyName = optionalText(input.counterpartyName);
    if (counterpartyName && counterpartyName !== original.counterpartyName) {
      throw new BadRequestException("施工企业扣费更正不得改变施工企业主体");
    }
    if (input.companyEntityId || input.affiliateCompanyContractId ||
        input.affiliateSettlementFactId || input.invoiceRecordId ||
        input.contractLedgerId || input.settlementLedgerId ||
        input.paymentRequestId) {
      throw new BadRequestException("施工企业扣费更正不能关联资金链路的合同、结算或付款申请");
    }
    const evidence = await this.resolveEvidence(
      tx,
      actorUserId,
      original.evidenceFileId,
      input.evidenceFileId,
      original.basisType
    );
    return {
      factType: original.factType,
      occurredAt: parseCorrectionDate(
        input.occurredAt,
        original.occurredAt,
        "更正后的扣费日期格式不正确"
      ),
      amountCents: positiveMoney(input.amountCents, original.amountCents),
      counterpartyName: original.counterpartyName,
      basisType: evidence.evidenceFileId ? "written" : "oral",
      deductionCategory: original.deductionCategory ?? "other",
      upstreamSettlementId: null,
      companyEntityId: null,
      affiliateCompanyContractId: null,
      affiliateSettlementFactId: null,
      invoiceRecordId: null,
      affiliateAssignmentId: original.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: original.affiliateNameSnapshot,
      description: feeName,
      evidenceFileId: evidence.evidenceFileId,
      fileContentSha256Snapshot: evidence.fileContentSha256Snapshot,
      documentVersion: original.documentVersion,
      bankObservationReference: null
    };
  }

  private async resolveEvidence(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    originalFileId: string | null,
    requestedFileId: string | undefined,
    basisType: string
  ): Promise<{
    evidenceFileId: string | null;
    fileContentSha256Snapshot: string | null;
  }> {
    const nextFileId = optionalText(requestedFileId);
    if (!nextFileId || nextFileId === originalFileId) {
      if (basisType === "written" && !originalFileId) {
        throw new BadRequestException("书面依据的施工企业付款更正必须上传依据文件");
      }
      if (!originalFileId) {
        return { evidenceFileId: null, fileContentSha256Snapshot: null };
      }
      const original = await tx.fileObject.findUnique({
        where: { id: originalFileId },
        select: { id: true, contentSha256: true }
      });
      if (!original) {
        throw new BadRequestException("原施工企业付款依据文件不存在，请重新上传");
      }
      return {
        evidenceFileId: original.id,
        fileContentSha256Snapshot: original.contentSha256
      };
    }
    const file = await tx.fileObject.findUnique({
      where: { id: nextFileId },
      select: {
        id: true,
        uploadedByUserId: true,
        storageStatus: true,
        contentSha256: true
      }
    });
    if (!file) throw new NotFoundException("施工企业付款更正依据文件不存在，请重新上传");
    if (file.uploadedByUserId !== actorUserId) {
      throw new BadRequestException("只能使用本人上传的施工企业付款更正依据文件");
    }
    if (
      file.storageStatus !== "active" ||
      typeof file.contentSha256 !== "string" ||
      file.contentSha256.length !== 64
    ) {
      throw new BadRequestException("施工企业付款更正依据文件尚未完成有效性校验");
    }
    return {
      evidenceFileId: file.id,
      fileContentSha256Snapshot: file.contentSha256
    };
  }
}
