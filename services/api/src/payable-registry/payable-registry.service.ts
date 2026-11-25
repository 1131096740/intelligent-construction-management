import {transferRepaymentUsage} from "../company-transfer/company-transfer-legacy";
import { createHash, randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import {
  assertInterEntityReturnAmount,
  deriveInterEntityRelationshipBalance,
  type InterEntityRelationshipEntryInput
} from "./inter-entity-relationship.domain";
import { derivePayableSettlementBalance } from "./payable-registry.domain";
import {
  loadPayableSettlementAllocationTotals,
  payableSettlementAllocationTotalsFor
} from "./payable-settlement-balance-authority";
import {
  deriveEffectiveWagePayableAmount,
  payableSourceAdapterRegistry,
} from "./wage-payable-source.adapter";
const WAGE_PAYABLE_RETIRED = "工资应付核销已停止办理，只能查看历史记录";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AllocatePaymentExecutionInput = Readonly<{
  payableRef: string;
  selectionRef: string;
  selectionExpiresAt: string;
  amountCents: bigint;
  expectedCaseRevision: number;
  idempotencyKey: string;
}>;

export type PayableSettlementCaseCommandInput = Readonly<{
  settlementCaseId: string;
  expectedRevision: number;
  idempotencyKey: string;
}>;

export type InterEntityRelationshipReturnInput = Readonly<{
  relationshipEntryId: string;
  amountCents: bigint;
  evidenceFileId: string;
  evidenceClaimId: string;
  reason: string;
  idempotencyKey: string;
}>;

type PayableRegistryDb = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PayableRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly audit: AuditService
  ) {}

  async getCapabilities(actorUserId: string) {
    let roles: readonly RoleKey[];
    try {
      roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前用户不具备工资应付核销权限");
    }
    return {
      read: canPerform("payable_settlement.read", roles),
      allocate: false,
      submit: false,
      confirm: false,
      return: false,
      // Evidence uploads and returns still use the existing global finance director authority.
      returnRelationship: roles.includes("finance_director")
    };
  }

  async listWagePayableCases(actorUserId: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const rows = await this.prisma.wagePayableRef.findMany({
      where: {
        direction: "increase",
        adjustsPayableRefId: null,
        confirmedVersion: { status: "confirmed" }
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      include: {
        confirmedVersion: { select: { status: true, revision: true } },
        creditorBreakdown: {
          select: {
            creditorSubjectType: true,
            creditorSubjectIdentityKey: true,
            creditorNameSnapshot: true,
            creditorUnifiedIdentitySnapshot: true,
            creditorVersionFingerprint: true
          }
        },
        adjustments: { select: { direction: true, amountCents: true } }
      }
    });
    const allocationTotals = await loadPayableSettlementAllocationTotals(
      this.prisma,
      rows.map(({ id }) => id)
    );
    const cases = [];
    for (const row of rows) {
      const registered = payableSourceAdapterRegistry.require("wage_payable_ref").toRegisteredPayable(row);
      const effectiveAmountCents = deriveEffectiveWagePayableAmount(
        row.amountCents,
        row.adjustments
      );
      const totals = payableSettlementAllocationTotalsFor(
        allocationTotals,
        row.id
      );
      const confirmedBalance = derivePayableSettlementBalance({
        effectiveAmountCents,
        validSettledAmountCents: totals.confirmedAmountCents
      });
      const overSettled = confirmedBalance.overSettledAmountCents > 0n;
      const allocatableAmountCents =
        effectiveAmountCents - totals.activeAmountCents;
      if (!overSettled && allocatableAmountCents <= 0n) continue;
      const [company, project] = await Promise.all([
        this.prisma.companyEntity.findUnique({
          where: { id: registered.debtorCompanyId },
          select: { name: true }
        }),
        this.prisma.project.findUnique({
          where: { id: registered.beneficiaryProjectId },
          select: { code: true, name: true }
        })
      ]);
      if (!company || !project) {
        throw new ConflictException("工资应付案件的公司或项目档案不完整");
      }
      const caseRevision = await this.loadPayableCaseRevision(this.prisma, row.id);
      const creditorLabel = registered.payeeSubjectType === "employee_user"
        ? "员工净付"
        : row.creditorBreakdown.creditorNameSnapshot;
      cases.push({
        payableRef: row.id,
        caseRevision,
        displayLabel: `${project.code} · ${project.name} · ${creditorLabel}`,
        debtorCompanyLabel: company.name,
        creditorLabel,
        status: overSettled ? "over_settled_reconciliation_required" : "allocatable",
        statusLabel: overSettled ? "超额核销待核对" : "历史余额",
        remainingAmountCents: overSettled ? "0" : allocatableAmountCents.toString(),
        overSettledAmountCents: confirmedBalance.overSettledAmountCents.toString()
      });
    }
    return cases;
  }

  async listPaymentExecutionCandidates(actorUserId: string, payableRef: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const normalizedPayableRef = requiredText(payableRef, "工资应付案件不能为空");
    const payable = await this.prisma.wagePayableRef.findUnique({
      where: { id: normalizedPayableRef },
      select: { confirmedVersion: { select: { status: true } } }
    });
    if (payable?.confirmedVersion.status !== "confirmed") {
      throw new NotFoundException("工资应付案件不存在或尚未确认");
    }
    return {
      caseRevision: await this.loadPayableCaseRevision(this.prisma, normalizedPayableRef),
      candidates: []
    };
  }

  async allocatePaymentExecution(actorUserId: string, input: AllocatePaymentExecutionInput) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const payableRef = requiredText(input.payableRef, "工资应付案件不能为空");
    const selectionRef = requiredText(input.selectionRef, "付款候选引用不能为空");
    const selectionExpiresAt = requiredText(input.selectionExpiresAt, "付款候选有效期不能为空");
    if (!Number.isInteger(input.expectedCaseRevision) || input.expectedCaseRevision < 0) {
      throw new ConflictException("工资应付案件修订号无效");
    }
    if (input.amountCents <= 0n) throw new ConflictException("核销金额必须大于零");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const fingerprint = commandFingerprint("payable_settlement.allocation.create", {
      actorUserId,
      payableRef,
      selectionRef,
      selectionExpiresAt,
      amountCents: input.amountCents.toString(),
      expectedCaseRevision: String(input.expectedCaseRevision)
    });

    return this.serializableWithRetry(() => this.prisma.$transaction(async (tx) => {
      await this.assertTransactionFinanceWriter(tx, actorUserId);
      await this.lockIdempotencyKey(tx, idempotencyKey);
      const receipt = await tx.payableSettlementCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (receipt) {
        if (receipt.payloadFingerprint !== fingerprint) {
          throw new ConflictException("幂等键已用于不同核销载荷");
        }
        return receipt.responseSnapshot;
      }

      throw new GoneException(WAGE_PAYABLE_RETIRED);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async loadPayableCaseRevision(
    db: PayableRegistryDb,
    payableRef: string
  ): Promise<number> {
    const caseClient = (db as unknown as {
      payableSettlementCase?: {
        findMany(args: Record<string, unknown>): Promise<Array<{ revision: number }>>;
      };
    }).payableSettlementCase;
    if (!caseClient || typeof caseClient.findMany !== "function") return 0;
    const rows = await caseClient.findMany({
      where: { allocations: { some: { payableRef } } },
      orderBy: [{ revision: "desc" }, { id: "desc" }],
      take: 1,
      select: { revision: true }
    });
    return rows[0]?.revision ?? 0;
  }

  async listWorkbench(actorUserId: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const rows = await this.prisma.payableSettlementCase.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true, status: true, revision: true,
        createdAt: true, submittedAt: true, confirmedAt: true, updatedAt: true,
        allocations: { select: { amountCents: true } }
      }
    });
    return rows.map((row) => ({
      settlementCaseId: row.id,
      status: row.status,
      statusLabel: settlementStatusLabel(row.status),
      revision: row.revision,
      allocatedAmountCents: row.allocations
        .reduce((total, allocation) => total + allocation.amountCents, 0n)
        .toString(),
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async listInterEntityRelationships(actorUserId: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const rows = await this.prisma.interEntityRelationshipEntry.findMany({
      where: { entryKind: "proxy_payment", direction: "increase", status: "confirmed" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      include: {
        adjustments: {
          where: { status: "confirmed" },
          select: { direction: true, amountCents: true }
        }
      }
    });
    return Promise.all(rows.map(async (row) => {
      const usage = await transferRepaymentUsage(this.prisma, { originalInterEntityRelationshipId: row.id });
      const balance = deriveInterEntityRelationshipBalance([
        { direction: "increase", amountCents: row.amountCents },
        ...(usage.received === 0n ? [] : [{ direction: "decrease" as const, amountCents: usage.received }]),
        ...row.adjustments.map((entry) => ({
          direction: entry.direction as InterEntityRelationshipEntryInput["direction"],
          amountCents: entry.amountCents
        }))
      ]);
      return {
        relationshipEntryId: row.id,
        debtorLabel: snapshotLabel(row.debtorSnapshot, row.originalDebtorCompanyId),
        creditorLabel: snapshotLabel(row.creditorSnapshot, row.creditorCompanyId),
        approvedPayerLabel: snapshotLabel(row.approvedPayerSnapshot, row.approvedPayerCompanyId),
        amountCents: row.amountCents.toString(),
        remainingAmountCents: balance.remainingAmountCents.toString(),
        status: balance.remainingAmountCents === 0n ? "returned" : "open",
        statusLabel: balance.remainingAmountCents === 0n ? "已归还" : "未结"
      };
    }));
  }

  async assertInterEntityRelationshipEvidenceUpload(
    actorUserId: string,
    relationshipEntryId: string
  ) {
    await this.assertGlobalFinanceDirector(actorUserId);
    const normalizedId = requiredText(relationshipEntryId, "代付往来不能为空");
    const row = await this.prisma.interEntityRelationshipEntry.findUnique({
      where: { id: normalizedId },
      select: {
        entryKind: true,
        direction: true,
        status: true,
        adjustsEntryId: true
      }
    });
    if (
      !row ||
      row.entryKind !== "proxy_payment" ||
      row.direction !== "increase" ||
      row.status !== "confirmed" ||
      row.adjustsEntryId !== null
    ) {
      throw new ConflictException("代付往来不存在或尚未确认");
    }
  }

  async createInterEntityRelationshipEvidenceClaim(
    actorUserId: string,
    relationshipEntryId: string,
    evidenceFileId: string,
    idempotencyKey?: string
  ) {
    await this.assertGlobalFinanceDirector(actorUserId);
    const normalizedRelationshipEntryId = requiredText(relationshipEntryId, "代付往来不能为空");
    const normalizedEvidenceFileId = requiredText(evidenceFileId, "归还凭证不能为空");
    const claimIdempotencyKey = idempotencyKey ? requiredUuid(idempotencyKey) : randomUUID();
    const fingerprint = commandFingerprint("inter_entity_relationship.evidence_claim", {
      actorUserId,
      relationshipEntryId: normalizedRelationshipEntryId,
      evidenceFileId: normalizedEvidenceFileId
    });

    return this.serializableWithRetry(() => this.prisma.$transaction(async (tx) => {
      const roleKeys = await this.assertTransactionFinanceDirector(tx, actorUserId);
      await this.lockIdempotencyKey(tx, claimIdempotencyKey);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "InterEntityRelationshipEntry" WHERE "id" = ${normalizedRelationshipEntryId} FOR UPDATE`
      );
      const root = await tx.interEntityRelationshipEntry.findUnique({
        where: { id: normalizedRelationshipEntryId },
        select: {
          id: true,
          entryKind: true,
          direction: true,
          status: true,
          adjustsEntryId: true
        }
      });
      if (
        !root ||
        root.entryKind !== "proxy_payment" ||
        root.direction !== "increase" ||
        root.status !== "confirmed" ||
        root.adjustsEntryId !== null
      ) {
        throw new ConflictException("代付往来不存在或尚未确认");
      }
      const claimClient = (tx as unknown as {
        interEntityRelationshipEvidenceClaim?: {
          findUnique(args: { where: Record<string, unknown> }): Promise<{
            id: string;
            relationshipEntryId: string;
            fileId: string;
            uploadedByUserId: string;
            contentSha256: string;
            status: string;
          } | null>;
          create(args: { data: Record<string, unknown> }): Promise<{
            id: string;
            relationshipEntryId: string;
            fileId: string;
            uploadedByUserId: string;
            contentSha256: string;
            status: string;
          }>;
        };
      }).interEntityRelationshipEvidenceClaim;
      if (!claimClient) {
        throw new ConflictException("归还凭证关系服务暂不可用，请稍后重试");
      }
      const existing = await claimClient.findUnique({
        where: { idempotencyKey: claimIdempotencyKey }
      });
      if (existing) {
        if (
          existing.relationshipEntryId !== normalizedRelationshipEntryId ||
          existing.fileId !== normalizedEvidenceFileId ||
          existing.uploadedByUserId !== actorUserId
        ) {
          throw new ConflictException("归还凭证关系幂等键已用于其他载荷");
        }
        return { id: existing.fileId, claimId: existing.id };
      }
      const file = await tx.fileObject.findUnique({
        where: { id: normalizedEvidenceFileId },
        select: { id: true, uploadedByUserId: true, storageStatus: true, contentSha256: true }
      });
      if (
        !file ||
        file.storageStatus !== "active" ||
        file.uploadedByUserId !== actorUserId ||
        !file.contentSha256 ||
        !/^[0-9a-f]{64}$/u.test(file.contentSha256)
      ) {
        throw new ConflictException("归还凭证不存在、已失效或缺少内容指纹");
      }
      const claim = await claimClient.create({
        data: {
          id: randomUUID(),
          relationshipEntryId: normalizedRelationshipEntryId,
          fileId: normalizedEvidenceFileId,
          uploadedByUserId: actorUserId,
          contentSha256: file.contentSha256,
          status: "pending",
          idempotencyKey: claimIdempotencyKey
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "inter_entity_relationship.evidence_claim.create",
        businessType: "inter_entity_relationship_entry",
        businessId: root.id,
        metadata: {
          scope: "global",
          roleKeys,
          relationshipFingerprint: auditFingerprint("inter_entity_relationship", root.id),
          claimFingerprint: auditFingerprint("evidence_claim", claim.id),
          fileFingerprint: auditFingerprint("evidence_file", file.id),
          contentFingerprint: auditFingerprint("evidence_content", file.contentSha256),
          payloadFingerprint: fingerprint
        }
      });
      return { id: claim.fileId, claimId: claim.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async returnInterEntityRelationship(
    actorUserId: string,
    input: InterEntityRelationshipReturnInput
  ) {
    await this.assertGlobalFinanceDirector(actorUserId);
    const relationshipEntryId = requiredText(input.relationshipEntryId, "代付往来不能为空");
    if (input.amountCents <= 0n) throw new ConflictException("代付往来归还金额必须大于零");
    const evidenceFileId = requiredText(input.evidenceFileId, "归还凭证不能为空");
    const evidenceClaimId = requiredText(input.evidenceClaimId, "归还凭证关系不能为空");
    const reason = requiredText(input.reason, "归还原因不能为空");
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const fingerprint = commandFingerprint("inter_entity_relationship.return", {
      actorUserId,
      relationshipEntryId,
      amountCents: input.amountCents.toString(),
      evidenceFileId,
      evidenceClaimId,
      reason
    });

    return this.serializableWithRetry(() => this.prisma.$transaction(async (tx) => {
      const roleKeys = await this.assertTransactionFinanceDirector(tx, actorUserId);
      await this.lockIdempotencyKey(tx, idempotencyKey);
      const receipt = await tx.payableSettlementCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (receipt) {
        if (receipt.payloadFingerprint !== fingerprint) {
          throw new ConflictException("幂等键已用于不同代付归还载荷");
        }
        return receipt.responseSnapshot;
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "InterEntityRelationshipEntry" WHERE "id" = ${relationshipEntryId} FOR UPDATE`
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId" = ${relationshipEntryId} ORDER BY "id" FOR UPDATE`
      );
      const root = await tx.interEntityRelationshipEntry.findUnique({
        where: { id: relationshipEntryId },
        include: {
          adjustments: {
            where: { status: "confirmed" },
            select: { direction: true, amountCents: true }
          },
          paymentExecution: { select: { executedByUserId: true } }
        }
      });
      if (
        !root ||
        root.entryKind !== "proxy_payment" ||
        root.direction !== "increase" ||
        root.status !== "confirmed" ||
        root.adjustsEntryId !== null
      ) {
        throw new ConflictException("代付往来不存在或尚未确认");
      }
      if(root.originalDebtorCompanyId!==root.creditorCompanyId)throw new ConflictException("公司间往来归还请从公司互转台账发起，须经领导终审和两侧银行核对");
      if (
        root.createdByUserId === actorUserId ||
        root.confirmedByUserId === actorUserId ||
        root.paymentExecution?.executedByUserId === actorUserId
      ) {
        throw new ForbiddenException("代付归还人与原付款职责必须分离");
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "InterEntityRelationshipEvidenceClaim" WHERE "id" = ${evidenceClaimId} FOR UPDATE`
      );
      const claimClient = (tx as unknown as {
        interEntityRelationshipEvidenceClaim?: {
          findUnique(args: { where: { id: string } }): Promise<{
            id: string;
            relationshipEntryId: string;
            fileId: string;
            uploadedByUserId: string;
            contentSha256: string;
            status: string;
          } | null>;
          update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
        };
      }).interEntityRelationshipEvidenceClaim;
      if (!claimClient) {
        throw new ConflictException("归还凭证关系服务暂不可用，请稍后重试");
      }
      const claim = await claimClient.findUnique({ where: { id: evidenceClaimId } });
      if (
        !claim ||
        claim.relationshipEntryId !== root.id ||
        claim.fileId !== evidenceFileId ||
        claim.uploadedByUserId !== actorUserId ||
        claim.status !== "pending" ||
        !/^[0-9a-f]{64}$/u.test(claim.contentSha256)
      ) {
        throw new ConflictException("归还凭证关系不存在、已使用或主体不匹配");
      }
      const evidence = await tx.fileObject.findUnique({
        where: { id: evidenceFileId },
        select: { id: true, storageStatus: true, uploadedByUserId: true, contentSha256: true }
      });
      if (
        !evidence ||
        evidence.storageStatus !== "active" ||
        evidence.uploadedByUserId !== actorUserId ||
        evidence.contentSha256 !== claim.contentSha256
      ) {
        throw new ConflictException("归还凭证不存在或已失效");
      }
      const balance = deriveInterEntityRelationshipBalance([
        { direction: "increase", amountCents: root.amountCents },
        ...root.adjustments.map((entry) => ({
          direction: entry.direction as InterEntityRelationshipEntryInput["direction"],
          amountCents: entry.amountCents
        }))
      ]);
      const next = assertInterEntityReturnAmount({
        increasedAmountCents: balance.increasedAmountCents,
        existingDecreasedAmountCents: balance.decreasedAmountCents,
        requestedDecreaseAmountCents: input.amountCents
      });
      const now = new Date();
      const returnId = randomUUID();
      await tx.interEntityRelationshipEntry.create({
        data: {
          id: returnId,
          entryKind: "proxy_return",
          direction: "decrease",
          status: "draft",
          adjustsEntryId: root.id,
          originalDebtorCompanyId: root.originalDebtorCompanyId,
          creditorCompanyId: root.creditorCompanyId,
          approvedPayerCompanyId: root.approvedPayerCompanyId,
          debtorSnapshot: root.debtorSnapshot as Prisma.InputJsonValue,
          creditorSnapshot: root.creditorSnapshot as Prisma.InputJsonValue,
          approvedPayerSnapshot: root.approvedPayerSnapshot as Prisma.InputJsonValue,
          amountCents: input.amountCents,
          currencyCode: root.currencyCode,
          evidenceFileId,
          evidenceClaimId,
          evidenceUploadedByUserId: claim.uploadedByUserId,
          evidenceContentSha256: claim.contentSha256,
          projectId: root.projectId,
          contractId: root.contractId,
          contractVersionId: root.contractVersionId,
          sourceType: root.sourceType,
          sourceAggregateId: root.sourceAggregateId,
          sourceAllocationCount: root.sourceAllocationCount,
          sourceAllocationAmountCents: root.sourceAllocationAmountCents,
          reason,
          idempotencyKey,
          payloadFingerprint: fingerprint,
          createdByUserId: actorUserId,
        }
      });
      await claimClient.update({
        where: { id: claim.id },
        data: { status: "consumed", consumedAt: now, consumedByUserId: actorUserId }
      });
      await tx.interEntityRelationshipEntry.update({
        where: { id: returnId },
        data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: now }
      });
      const response = {
        relationshipEntryId: root.id,
        returnEntryId: returnId,
        returnedAmountCents: input.amountCents.toString(),
        remainingAmountCents: next.remainingAmountCents.toString(),
        status: next.remainingAmountCents === 0n ? "returned" : "open"
      };
      await tx.payableSettlementCommandReceipt.create({
        data: {
          id: randomUUID(),
          idempotencyKey,
          payloadFingerprint: fingerprint,
          action: "inter_entity_relationship.return",
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "inter_entity_relationship.return",
        businessType: "inter_entity_relationship_entry",
        businessId: root.id,
        metadata: {
          scope: "global",
          roleKeys,
          relationshipFingerprint: auditFingerprint("inter_entity_relationship", root.id),
          returnFingerprint: auditFingerprint("inter_entity_relationship_return", returnId),
          amountCentsFingerprint: auditFingerprint("amount_cents", input.amountCents.toString()),
          evidenceFingerprint: auditFingerprint("evidence_file", evidenceFileId),
          evidenceClaimFingerprint: auditFingerprint("evidence_claim", evidenceClaimId),
          evidenceContentFingerprint: auditFingerprint("evidence_content", claim.contentSha256),
          payloadFingerprint: fingerprint,
          idempotencyKeyFingerprint: auditFingerprint("idempotency_key", idempotencyKey)
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async submit(actorUserId: string, input: PayableSettlementCaseCommandInput) {
    await this.assertGlobalFinanceWriter(actorUserId);
    return this.transition(actorUserId, input, "submit");
  }

  async confirm(actorUserId: string, input: PayableSettlementCaseCommandInput) {
    await this.assertGlobalFinanceDirector(actorUserId);
    return this.transition(actorUserId, input, "confirm");
  }

  async returnForReview(actorUserId: string, input: PayableSettlementCaseCommandInput) {
    await this.assertGlobalFinanceDirector(actorUserId);
    return this.transition(actorUserId, input, "return");
  }

  private async transition(
    actorUserId: string,
    input: PayableSettlementCaseCommandInput,
    action: "submit" | "confirm" | "return"
  ) {
    const settlementCaseId = requiredText(input.settlementCaseId, "核销案件不能为空");
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new ConflictException("核销案件修订号无效");
    }
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const actionName = `payable_settlement.case.${action}`;
    const fingerprint = commandFingerprint(actionName, {
      actorUserId,
      settlementCaseId,
      expectedRevision: String(input.expectedRevision)
    });
    return this.serializableWithRetry(() => this.prisma.$transaction(async (tx) => {
      if (action === "submit") await this.assertTransactionFinanceWriter(tx, actorUserId);
      else await this.assertTransactionFinanceDirector(tx, actorUserId);
      await this.lockIdempotencyKey(tx, idempotencyKey);
      const receipt = await tx.payableSettlementCommandReceipt.findUnique({
        where: { idempotencyKey }, select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (receipt) {
        if (receipt.payloadFingerprint !== fingerprint) throw new ConflictException("幂等键已用于不同核销载荷");
        return receipt.responseSnapshot;
      }
      const settlementCase = await tx.payableSettlementCase.findUnique({
        where: { id: settlementCaseId }, select: { id: true }
      });
      if (!settlementCase) throw new NotFoundException("核销案件不存在，请刷新后重试");
      throw new GoneException(WAGE_PAYABLE_RETIRED);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async assertTransactionFinanceWriter(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const roles = await this.transactionGlobalRoleKeys(
      tx,
      actorUserId,
      "当前用户不具备全系统财务核销权限"
    );
    if (!roles.some((key) => key === "finance_staff" || key === "finance_director")) {
      throw new ForbiddenException("只有全系统财务人员可以办理核销案件");
    }
    return roles;
  }

  private async lockIdempotencyKey(
    tx: Prisma.TransactionClient,
    idempotencyKey: string
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payable-settlement:${idempotencyKey}`}, 0))::text AS "locked"`
    );
  }

  private async assertTransactionFinanceDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const roles = await this.transactionGlobalRoleKeys(
      tx,
      actorUserId,
      "当前用户不具备全系统财务负责人权限"
    );
    if (!roles.includes("finance_director")) {
      throw new ForbiddenException("当前用户不具备全系统财务负责人权限");
    }
    return roles;
  }

  private async transactionGlobalRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    failureMessage: string
  ) {
    const user = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { isActive: true }
    });
    if (!user?.isActive) {
      throw new ForbiddenException(failureMessage);
    }
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null },
      select: { positionId: true }
    });
    const positionIds = Array.from(new Set(assignments.map(({ positionId }) => positionId)));
    if (!positionIds.length) {
      throw new ForbiddenException(failureMessage);
    }
    const positions = await tx.position.findMany({
      where: { id: { in: positionIds } },
      select: { id: true, key: true }
    });
    if (
      positions.length !== positionIds.length
    ) {
      throw new ForbiddenException(failureMessage);
    }
    return positions.map(({ key }) => key);
  }

  private async assertGlobalFinanceWriter(actorUserId: string) {
    let roles: readonly string[];
    try {
      roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前用户不具备全系统财务核销权限");
    }
    if (!roles.includes("finance_staff") && !roles.includes("finance_director")) {
      throw new ForbiddenException("只有全系统财务人员可以办理核销案件");
    }
  }

  private async assertGlobalFinanceDirector(actorUserId: string) {
    let roles: readonly string[];
    try {
      roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前用户不具备全系统财务负责人权限");
    }
    if (!roles.includes("finance_director")) {
      throw new ForbiddenException("只有全系统财务负责人可以确认或退回核销案件");
    }
  }

  private async serializableWithRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (prismaCode(error) === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException("核销案件并发写入未能完成，请刷新后重试");
  }
}

function requiredText(value: string, message: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new ConflictException(message);
  return trimmed;
}

function requiredUuid(value: string) {
  const normalized = requiredText(value, "幂等键不能为空").toLowerCase();
  if (!UUID_V4.test(normalized)) throw new ConflictException("幂等键必须为 UUIDv4");
  return normalized;
}

function commandFingerprint(action: string, payload: Record<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify({ action, ...Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))) }))
    .digest("hex");
}

function auditFingerprint(kind: string, value: string) {
  return commandFingerprint("payable_settlement.audit_fingerprint", { kind, value });
}

function settlementStatusLabel(status: string) {
  if (status === "draft") return "草稿";
  if (status === "submitted") return "待确认";
  if (status === "confirmed") return "已确认";
  if (status === "review_returned") return "已退回复核";
  return "状态异常";
}

function snapshotLabel(snapshot: Prisma.JsonValue, fallback: string) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const name = (snapshot as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return fallback;
}

function prismaCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta && ["40001", "40P01"].includes(String(meta.code))) return "P2034";
  if (code === "40P01") return "P2034";
  return typeof code === "string" ? code : undefined;
}
