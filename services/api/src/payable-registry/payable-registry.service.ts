import { createHash, randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import {
  assertAllocationSetMatchesPaymentExecution,
  type WagePayableBindingFact
} from "./payable-settlement.domain";
import {
  assertInterEntityReturnAmount,
  assertProxySettlementFacts,
  deriveInterEntityRelationshipBalance,
  type InterEntityRelationshipEntryInput
} from "./inter-entity-relationship.domain";
import { derivePayableSettlementBalance } from "./payable-registry.domain";
import {
  loadPayableSettlementAllocationTotals,
  payableSettlementAllocationTotalsFor
} from "./payable-settlement-balance-authority";
import {
  type PaymentExecutionSelectionBinding,
  PaymentExecutionSelectionRefService
} from "./payment-execution-selection-ref.service";
import {
  deriveEffectiveWagePayableAmount,
  payableSourceAdapterRegistry,
  type RegisteredPayable,
} from "./wage-payable-source.adapter";
import {
  assertPayerAttestationFacts,
  requiresPayerAuthorization,
  type PayerAttestationAuthorization
} from "./payer-attestation.domain";

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

type PayerAttestationRecord = Readonly<{
  payerVerificationId?: string;
  bankAccountReference: string;
  holderCompanyEntityId: string;
  holderNameSnapshot: string;
  holderCreditCodeSnapshot: string;
  verificationReference: string;
  verifiedByUserId: string;
  verifiedAt: Date;
  verificationEvidenceFileId: string;
  verificationEvidenceContentSha256: string;
  proxyAuthorizationReason: string | null;
  proxyAuthorizationEvidenceFileId: string | null;
  proxyAuthorizationEvidenceSha256: string | null;
  reauthorizationReference: string | null;
  reauthorizationApprovalInstanceId?: string | null;
  reauthorizationApprovalActionLogId?: string | null;
  reauthorizationPaymentRequestId?: string | null;
  reauthorizationContractVersionId?: string | null;
  reauthorizedByUserId: string | null;
  reauthorizedAt: Date | null;
}>;

type PayableRegistryDb = Prisma.TransactionClient | PrismaService;

type EligiblePaymentCandidateState = Readonly<{
  confirmedVersionId: string;
  caseRevision: number;
  registered: RegisteredPayable;
  allocatablePayableCents: bigint;
  candidates: readonly Readonly<{
    paymentExecutionId: string;
    paymentRequestId: string;
    contractVersionId: string;
    availableAmountCents: bigint;
    binding: PaymentExecutionSelectionBinding;
    projection: Readonly<{
      selectionRef: string;
      expiresAt: string;
      displayLabel: string;
      executedAt: string;
      payerLabel: string;
      statusLabel: string;
      availableAmountCents: string;
    }>;
  }>[];
}>;

@Injectable()
export class PayableRegistryService {
  private readonly selectionRefs = new PaymentExecutionSelectionRefService();

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
      allocate: canPerform("payable_settlement.allocate", roles),
      submit: canPerform("payable_settlement.submit", roles),
      confirm: canPerform("payable_settlement.confirm", roles),
      return: canPerform("payable_settlement.return", roles)
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
        statusLabel: overSettled ? "超额核销待核对" : "可核销",
        remainingAmountCents: overSettled ? "0" : allocatableAmountCents.toString(),
        overSettledAmountCents: confirmedBalance.overSettledAmountCents.toString()
      });
    }
    return cases;
  }

  async listPaymentExecutionCandidates(actorUserId: string, payableRef: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const normalizedPayableRef = requiredText(payableRef, "工资应付案件不能为空");
    const state = await this.loadEligiblePaymentCandidates(
      this.prisma,
      actorUserId,
      normalizedPayableRef,
      new Date()
    );
    return {
      caseRevision: state.caseRevision,
      candidates: state.candidates.map((candidate) => candidate.projection)
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
      const roleKeys = await this.assertTransactionFinanceWriter(tx, actorUserId);
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

      const now = new Date();
      const beforeLock = await this.loadEligiblePaymentCandidates(tx, actorUserId, payableRef, now);
      if (beforeLock.caseRevision !== input.expectedCaseRevision) {
        throw new ConflictException("工资应付案件已更新，请刷新候选后重试");
      }
      const beforeMatches = beforeLock.candidates.filter((candidate) =>
        this.selectionRefs.matches(
          selectionRef,
          selectionExpiresAt,
          candidate.binding,
          now
        )
      );
      if (beforeMatches.length !== 1) {
        throw new ConflictException("付款候选已失效，请刷新后重新选择");
      }
      const selected = beforeMatches[0];

      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${selected.paymentRequestId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${selected.contractVersionId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${selected.paymentExecutionId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "WagePayableRef" WHERE "id" = ${payableRef} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "WageStatementVersion" WHERE "id" = ${beforeLock.confirmedVersionId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PayableSettlementCase" WHERE "paymentExecutionId" = ${selected.paymentExecutionId} ORDER BY "revision" FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PayableSettlementAllocation" WHERE "paymentExecutionId" = ${selected.paymentExecutionId} OR "payableRef" = ${payableRef} ORDER BY "id" FOR UPDATE`);

      const afterLockNow = new Date();
      const afterLock = await this.loadEligiblePaymentCandidates(tx, actorUserId, payableRef, afterLockNow);
      if (afterLock.caseRevision !== input.expectedCaseRevision) {
        throw new ConflictException("工资应付案件已更新，请刷新候选后重试");
      }
      const afterMatches = afterLock.candidates.filter((candidate) =>
        this.selectionRefs.matches(
          selectionRef,
          selectionExpiresAt,
          candidate.binding,
          afterLockNow
        )
      );
      if (
        afterMatches.length !== 1 ||
        afterMatches[0].paymentExecutionId !== selected.paymentExecutionId
      ) {
        throw new ConflictException("付款候选状态或余额已变化，请刷新后重新选择");
      }
      const current = afterMatches[0];
      if (
        input.amountCents > current.availableAmountCents ||
        input.amountCents > afterLock.allocatablePayableCents
      ) {
        throw new ConflictException("核销金额超过付款或应付的当前可核销余额");
      }

      const latest = await tx.payableSettlementCase.findFirst({
        where: { paymentExecutionId: current.paymentExecutionId },
        orderBy: [{ revision: "desc" }, { id: "desc" }]
      });
      const nextRevision = Math.max(
        beforeLock.caseRevision,
        latest?.revision ?? 0
      ) + 1;
      let settlementCase: { id: string; status: string; revision: number };
      if (!latest || latest.status === "review_returned") {
        settlementCase = await tx.payableSettlementCase.create({
          data: {
            id: randomUUID(),
            paymentExecutionId: current.paymentExecutionId,
            status: "draft",
            revision: nextRevision,
            ...(latest ? { supersedesCaseId: latest.id } : {}),
            createdByUserId: actorUserId
          },
          select: { id: true, status: true, revision: true }
        });
      } else if (latest.status === "draft") {
        settlementCase = latest;
      } else {
        throw new ConflictException("该实际付款的核销案件已提交，不能继续追加");
      }
      const duplicate = await tx.payableSettlementAllocation.findFirst({
        where: { settlementCaseId: settlementCase.id, payableRef },
        select: { id: true }
      });
      if (duplicate) throw new ConflictException("该应付已加入当前核销案件");

      const allocationId = randomUUID();
      await tx.payableSettlementAllocation.create({
        data: {
          id: allocationId,
          settlementCaseId: settlementCase.id,
          paymentExecutionId: current.paymentExecutionId,
          payableRef,
          sourceType: afterLock.registered.sourceType,
          sourceAggregateId: afterLock.registered.sourceAggregateId,
          sourceLineId: afterLock.registered.sourceLineId,
          confirmedVersionId: afterLock.registered.confirmedVersionId,
          debtorCompanyId: afterLock.registered.debtorCompanyId,
          payeeSubjectType: afterLock.registered.payeeSubjectType,
          payeeSubjectId: afterLock.registered.payeeSubjectId,
          currencyCode: afterLock.registered.currencyCode,
          beneficiaryProjectId: afterLock.registered.beneficiaryProjectId,
          sourceSnapshot: jsonSafe({
            payableRef,
            sourceType: afterLock.registered.sourceType,
            sourceAggregateId: afterLock.registered.sourceAggregateId,
            sourceLineId: afterLock.registered.sourceLineId,
            confirmedVersionId: afterLock.registered.confirmedVersionId,
            debtorCompanyId: afterLock.registered.debtorCompanyId,
            payeeSubjectType: afterLock.registered.payeeSubjectType,
            payeeSubjectId: afterLock.registered.payeeSubjectId,
            currencyCode: afterLock.registered.currencyCode,
            beneficiaryProjectId: afterLock.registered.beneficiaryProjectId,
            confirmedAmountCents: afterLock.registered.confirmedAmountCents.toString()
          }),
          confirmedAmountCents: afterLock.registered.confirmedAmountCents,
          amountCents: input.amountCents,
          createdByUserId: actorUserId
        }
      });
      if (latest?.status === "draft") {
        settlementCase = await tx.payableSettlementCase.update({
          where: { id: settlementCase.id },
          data: { revision: nextRevision },
          select: { id: true, status: true, revision: true }
        });
      }
      const response = {
        settlementCaseId: settlementCase.id,
        status: settlementCase.status,
        revision: settlementCase.revision,
        payableRef,
        allocatedAmountCents: input.amountCents.toString()
      };
      await tx.payableSettlementCommandReceipt.create({
        data: {
          id: randomUUID(),
          idempotencyKey,
          payloadFingerprint: fingerprint,
          action: "payable_settlement.allocation.create",
          settlementCaseId: settlementCase.id,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "payable_settlement.allocation.create",
        businessType: "payable_settlement_case",
        businessId: settlementCase.id,
        metadata: {
          revision: settlementCase.revision,
          scope: "global",
          roleKeys,
          idempotencyKeyFingerprint: auditFingerprint("idempotency_key", idempotencyKey),
          payloadFingerprint: fingerprint,
          allocationFingerprint: auditFingerprint("allocation", allocationId),
          payableRefFingerprint: auditFingerprint("payable_ref", payableRef),
          paymentExecutionFingerprint: auditFingerprint(
            "payment_execution",
            current.paymentExecutionId
          ),
          amountCentsFingerprint: auditFingerprint("amount_cents", input.amountCents.toString()),
          allocationCount: 1
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async loadEligiblePaymentCandidates(
    db: PayableRegistryDb,
    actorUserId: string,
    payableRef: string,
    now: Date
  ): Promise<EligiblePaymentCandidateState> {
    const payable = await db.wagePayableRef.findUnique({
      where: { id: payableRef },
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
    if (!payable || payable.confirmedVersion.status !== "confirmed") {
      throw new NotFoundException("工资应付案件不存在或尚未确认");
    }
    const registered = payableSourceAdapterRegistry.require("wage_payable_ref").toRegisteredPayable(payable);
    const caseRevision = await this.loadPayableCaseRevision(db, payableRef);
    const effectiveAmountCents = deriveEffectiveWagePayableAmount(
      payable.amountCents,
      payable.adjustments
    );
    const allocationTotals = payableSettlementAllocationTotalsFor(
      await loadPayableSettlementAllocationTotals(db, [payableRef]),
      payableRef
    );
    const confirmedBalance = derivePayableSettlementBalance({
      effectiveAmountCents,
      validSettledAmountCents: allocationTotals.confirmedAmountCents
    });
    if (confirmedBalance.overSettledAmountCents > 0n) {
      throw new ConflictException("该工资应付已超额核销，必须先完成核对");
    }
    const allocatablePayableCents =
      effectiveAmountCents - allocationTotals.activeAmountCents;
    if (allocatablePayableCents < 0n) {
      throw new ConflictException("该工资应付存在超额待确认核销，必须先完成核对");
    }
    if (allocatablePayableCents === 0n) {
      return {
        confirmedVersionId: payable.confirmedVersionId,
        caseRevision,
        registered,
        allocatablePayableCents,
        candidates: []
      };
    }

    type WageBindingCandidateRow = {
      paymentExecutionId: string;
      wagePayableRefId: string;
      debtorCompanyId: string;
      projectId: string;
      creditorSubjectType: string;
      creditorUserId: string | null;
      creditorBusinessPartyVersionId: string | null;
      creditorSubjectIdentityKey: string;
      creditorNameSnapshot: string;
      creditorUnifiedIdentitySnapshot: string | null;
      creditorVersionFingerprint: string | null;
      amountCents: bigint;
    };
    const bindingClient = (db as unknown as {
      paymentExecutionWagePayableBinding?: {
        findMany(args: Record<string, unknown>): Promise<WageBindingCandidateRow[]>;
      };
    }).paymentExecutionWagePayableBinding;
    if (!bindingClient) {
      return { confirmedVersionId: payable.confirmedVersionId, caseRevision, registered, allocatablePayableCents, candidates: [] };
    }
    const wageBindings = await bindingClient.findMany({
      where: { wagePayableRefId: payableRef },
      orderBy: [{ createdAt: "desc" }, { paymentExecutionId: "asc" }],
      take: 100,
      select: {
        paymentExecutionId: true,
        wagePayableRefId: true,
        debtorCompanyId: true,
        projectId: true,
        creditorSubjectType: true,
        creditorUserId: true,
        creditorBusinessPartyVersionId: true,
        creditorSubjectIdentityKey: true,
        creditorNameSnapshot: true,
        creditorUnifiedIdentitySnapshot: true,
        creditorVersionFingerprint: true,
        amountCents: true
      }
    });
    if (wageBindings.length === 0) {
      return { confirmedVersionId: payable.confirmedVersionId, caseRevision, registered, allocatablePayableCents, candidates: [] };
    }
    const executions = await db.paymentExecution.findMany({
      where: { id: { in: [...new Set(wageBindings.map((binding) => binding.paymentExecutionId))] } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        paymentRequestId: true,
        paymentSubjectType: true,
        amountCents: true,
        companyEntityIdSnapshot: true,
        companyEntityNameSnapshot: true,
        paidAt: true,
        createdAt: true
      }
    });
    const requestIds = executions.map((execution) => execution.paymentRequestId);
    const executionIds = executions.map((execution) => execution.id);
    const requests = requestIds.length === 0 ? [] : await db.paymentRequest.findMany({
      where: { id: { in: requestIds } },
      select: {
        id: true,
        contractId: true,
        projectId: true,
        contractVersionId: true,
        status: true,
        paymentSubjectType: true,
        updatedAt: true
      }
    });
    const contractVersionIds = [...new Set(requests.map((request) => request.contractVersionId))];
    const contractIds = [...new Set(requests.map((request) => request.contractId))];
    const [
      contracts,
      contractVersions,
      allocatedByExecution,
      allocatedByPair,
      paymentExecutionAllocations
    ] = await Promise.all([
      contractIds.length === 0 ? Promise.resolve([]) : db.contract.findMany({
        where: { id: { in: contractIds } },
        select: { id: true, projectId: true, contractTypeKey: true }
      }),
      contractVersionIds.length === 0 ? Promise.resolve([]) : db.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: {
          id: true,
          contractId: true,
          status: true,
          signingSubjectType: true,
          companyEntityIdSnapshot: true,
          companyEntityVersionId: true,
          affiliateBusinessPartyVersionId: true,
          updatedAt: true
        }
      }),
      executionIds.length === 0 ? Promise.resolve([]) : db.payableSettlementAllocation.groupBy({
        by: ["paymentExecutionId"],
        where: {
          paymentExecutionId: { in: executionIds },
          settlementCase: { status: { in: ["draft", "submitted", "confirmed"] } }
        },
        _sum: { amountCents: true }
      }),
      executionIds.length === 0 ? Promise.resolve([]) : db.payableSettlementAllocation.groupBy({
        by: ["paymentExecutionId", "payableRef"],
        where: {
          paymentExecutionId: { in: executionIds },
          payableRef,
          settlementCase: { status: { in: ["draft", "submitted", "confirmed"] } }
        },
        _sum: { amountCents: true }
      }),
      executionIds.length === 0 ? Promise.resolve([]) : db.paymentExecutionAllocation.findMany({
        where: { paymentExecutionId: { in: executionIds } },
        select: { paymentExecutionId: true, allocationType: true, amountCents: true }
      })
    ]);
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const contractVersionById = new Map(contractVersions.map((version) => [version.id, version]));
    const companyIds = Array.from(new Set([
      registered.debtorCompanyId,
      ...contractVersions.map((version) => version.companyEntityIdSnapshot),
      ...executions.map((execution) => execution.companyEntityIdSnapshot)
    ].filter((value): value is string => Boolean(value && value.trim()))));
    const companyEntities = companyIds.length === 0
      ? []
      : await db.companyEntity.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true, unifiedSocialCreditCode: true }
        });
    const companyById = new Map(companyEntities.map((company) => [company.id, company]));
    const bindingByExecutionId = new Map(
      wageBindings.map((binding) => [binding.paymentExecutionId, binding])
    );
    const allocatedAmountByExecutionId = new Map(
      allocatedByExecution.map((row) => [row.paymentExecutionId, row._sum.amountCents ?? 0n])
    );
    const allocatedAmountByExecutionAndPayable = new Map(
      allocatedByPair.map((row) => [
        `${row.paymentExecutionId}:${row.payableRef}`,
        row._sum.amountCents ?? 0n
      ])
    );
    const paymentExecutionAllocatedAmountById = paymentExecutionAllocations.reduce<Map<string, bigint>>(
      (totals, allocation) => {
        if (allocation.allocationType !== "contract_due_payment") return totals;
        totals.set(
          allocation.paymentExecutionId,
          (totals.get(allocation.paymentExecutionId) ?? 0n) + allocation.amountCents
        );
        return totals;
      },
      new Map()
    );
    const candidates: EligiblePaymentCandidateState["candidates"][number][] = [];
    for (const execution of executions) {
      const wageBinding = bindingByExecutionId.get(execution.id);
      const request = requestById.get(execution.paymentRequestId);
      const contractVersion = request
        ? contractVersionById.get(request.contractVersionId)
        : undefined;
      const contract = request ? contractById.get(request.contractId) : undefined;
      if (
        !request ||
        !contract ||
        !contractVersion ||
        !wageBinding ||
        wageBinding.wagePayableRefId !== payableRef ||
        wageBinding.debtorCompanyId !== registered.debtorCompanyId ||
        wageBinding.projectId !== registered.beneficiaryProjectId ||
        wageBinding.creditorSubjectType !== registered.payeeSubjectType ||
        wageBinding.creditorSubjectIdentityKey !== registered.payeeSubjectId ||
        (registered.payeeSubjectType === "employee_user"
          ? wageBinding.creditorUserId !== registered.payeeSubjectId.slice("employee_user:".length)
          : wageBinding.creditorBusinessPartyVersionId !== registered.payeeSubjectId.slice("business_party:".length)) ||
        wageBinding.creditorNameSnapshot !== payable.creditorBreakdown.creditorNameSnapshot ||
        (wageBinding.creditorUnifiedIdentitySnapshot ?? null) !==
          (payable.creditorBreakdown.creditorUnifiedIdentitySnapshot ?? null) ||
        (wageBinding.creditorVersionFingerprint ?? null) !==
          (payable.creditorBreakdown.creditorVersionFingerprint ?? null) ||
        request.projectId !== registered.beneficiaryProjectId ||
        contract.projectId !== request.projectId ||
        contractVersion.contractId !== request.contractId ||
        request.paymentSubjectType !== "our_company" ||
        execution.paymentSubjectType !== "our_company" ||
        !["paid", "partially_paid"].includes(request.status) ||
        contract.contractTypeKey !== "labor_subcontract" ||
        contractVersion.status !== "effective" ||
        contractVersion.signingSubjectType !== "our_company" ||
        !contractVersion.companyEntityIdSnapshot ||
        !contractVersion.companyEntityVersionId ||
        !execution.companyEntityIdSnapshot.trim() ||
        !companyById.has(registered.debtorCompanyId) ||
        !companyById.has(contractVersion.companyEntityIdSnapshot) ||
        !companyById.has(execution.companyEntityIdSnapshot)
      ) {
        continue;
      }
      const executionAvailableAmountCents = execution.amountCents -
        (allocatedAmountByExecutionId.get(execution.id) ?? 0n) -
        (paymentExecutionAllocatedAmountById.get(execution.id) ?? 0n);
      const bindingAvailableAmountCents = wageBinding.amountCents -
        (allocatedAmountByExecutionAndPayable.get(`${execution.id}:${payableRef}`) ?? 0n);
      const availableAmountCents = [
        executionAvailableAmountCents,
        bindingAvailableAmountCents,
        allocatablePayableCents
      ].reduce((minimum, value) => value < minimum ? value : minimum);
      if (availableAmountCents <= 0n) continue;
      const executionFingerprint = commandFingerprint("payment_execution_selection", {
        paymentExecutionId: execution.id,
        paymentRequestId: request.id,
        paymentRequestStatus: request.status,
        paymentRequestUpdatedAt: request.updatedAt.toISOString(),
        contractId: request.contractId,
        contractProjectId: contract.projectId,
        contractVersionId: contractVersion.id,
        contractTypeKey: contract.contractTypeKey,
        contractVersionStatus: contractVersion.status,
        contractVersionUpdatedAt: contractVersion.updatedAt.toISOString(),
        approvedPayerCompanyId: contractVersion.companyEntityIdSnapshot,
        approvedPayerCompanyVersionId: contractVersion.companyEntityVersionId,
        actualPayerCompanyId: execution.companyEntityIdSnapshot,
        paymentRequestSubjectType: request.paymentSubjectType,
        paymentExecutionSubjectType: execution.paymentSubjectType,
        payableRef,
        wageBindingAmountCents: wageBinding.amountCents.toString(),
        wageBindingSubjectType: wageBinding.creditorSubjectType,
        wageBindingSubjectIdentityKey: wageBinding.creditorSubjectIdentityKey,
        amountCents: execution.amountCents.toString(),
        paidAt: execution.paidAt.toISOString(),
        createdAt: execution.createdAt.toISOString()
      });
      const balanceFingerprint = commandFingerprint("payment_execution_selection_balance", {
        executionBalanceCents: executionAvailableAmountCents.toString(),
        wageBindingBalanceCents: bindingAvailableAmountCents.toString(),
        payableRemainingAmountCents: allocatablePayableCents.toString()
      });
      const binding = {
        actorUserId,
        caseId: payableRef,
        companyId: registered.debtorCompanyId,
        projectId: registered.beneficiaryProjectId,
        paymentExecutionId: execution.id,
        executionFingerprint,
        caseRevision,
        balanceFingerprint
      } satisfies PaymentExecutionSelectionBinding;
      const issued = this.selectionRefs.issue(binding, now);
      candidates.push({
        paymentExecutionId: execution.id,
        paymentRequestId: request.id,
        contractVersionId: contractVersion.id,
        availableAmountCents,
        binding,
        projection: {
          ...issued,
          displayLabel: `${dateLabel(execution.paidAt)} · ${execution.companyEntityNameSnapshot} · 候选${String(candidates.length + 1).padStart(2, "0")}`,
          executedAt: execution.paidAt.toISOString(),
          payerLabel: execution.companyEntityNameSnapshot,
          statusLabel: "已执行，可核销",
          availableAmountCents: availableAmountCents.toString()
        }
      });
    }
    return {
      confirmedVersionId: payable.confirmedVersionId,
      caseRevision,
      registered,
      allocatablePayableCents,
      candidates
    };
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
    return rows.map((row) => {
      const balance = deriveInterEntityRelationshipBalance([
        { direction: "increase", amountCents: row.amountCents },
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
    });
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
      const roleKeys = action === "submit"
        ? await this.assertTransactionFinanceWriter(tx, actorUserId)
        : await this.assertTransactionFinanceDirector(tx, actorUserId);
      await this.lockIdempotencyKey(tx, idempotencyKey);
      const receipt = await tx.payableSettlementCommandReceipt.findUnique({
        where: { idempotencyKey }, select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (receipt) {
        if (receipt.payloadFingerprint !== fingerprint) throw new ConflictException("幂等键已用于不同核销载荷");
        return receipt.responseSnapshot;
      }
      const context = await this.lockSettlementContext(tx, settlementCaseId);
      const settlementCase = context.settlementCase;
      if (settlementCase.revision !== input.expectedRevision) throw new ConflictException("核销案件已被更新，请刷新后重试");
      const requiredStatus = action === "submit" ? "draft" : "submitted";
      if (settlementCase.status !== requiredStatus) throw new ConflictException("当前核销案件状态不允许此操作");
      if (action === "confirm" && settlementCase.createdByUserId === actorUserId) {
        throw new ForbiddenException("创建人与确认人必须职责分离");
      }
      if (action === "confirm" && settlementCase.submittedByUserId === actorUserId) {
        throw new ForbiddenException("提交人与确认人必须职责分离");
      }

      if (action !== "return") {
        const {
          execution,
          request,
          contractVersion,
          counterparties,
          allocations,
          wageBindings,
          otherAllocatedAmountCents
        } = context;
        if (action === "confirm" && execution.executedByUserId === actorUserId) {
          throw new ForbiddenException("付款执行人与确认人必须职责分离");
        }
        if (
          action === "confirm" &&
          allocations.some((allocation) => allocation.createdByUserId === actorUserId)
        ) {
          throw new ForbiddenException("核销编辑人与确认人必须职责分离");
        }
        assertCurrentPaymentRequestContext(request, execution, counterparties, allocations, wageBindings);
        const payer = await this.resolvePayerCompanies(
          tx,
          request,
          contractVersion,
          execution,
          allocations[0]?.debtorCompanyId,
          actorUserId,
          context.payerAttestation
        );
        assertAllocationSetMatchesPaymentExecution({
          id: execution.id, amountCents: execution.amountCents, currencyCode: "CNY",
          approvedPayerCompanyId: payer.approvedPayerCompanyId,
          actualPayerCompanyId: payer.actualPayerCompanyId
        }, allocations.map(toSettlementAllocationInput), {
          wageBindings,
          otherAllocatedAmountCents,
          allowInterEntityProxy: true,
          expectedOriginalDebtorCompanyId: allocations[0]?.debtorCompanyId
        });
        await this.assertCurrentPayableBalances(tx, settlementCaseId, allocations);
      }
      const now = new Date();
      let row;
      let successorCase: typeof context.settlementCase | null = null;
      if (action === "return") {
        // A returned submission remains an immutable historical revision. The
        // next editable draft is created in this same transaction and carries
        // forward the frozen allocation snapshots for a new review cycle.
        row = await tx.payableSettlementCase.update({ where: { id: settlementCaseId }, data: {
          status: "review_returned",
          revision: { increment: 1 }
        } });
        successorCase = await tx.payableSettlementCase.create({
          data: {
            id: randomUUID(),
            paymentExecutionId: settlementCase.paymentExecutionId,
            status: "draft",
            revision: row.revision + 1,
            supersedesCaseId: settlementCaseId,
            createdByUserId: actorUserId
          }
        });
        for (const allocation of context.allocations) {
          await tx.payableSettlementAllocation.create({
            data: {
              id: randomUUID(),
              settlementCaseId: successorCase.id,
              paymentExecutionId: allocation.paymentExecutionId,
              payableRef: allocation.payableRef,
              sourceType: allocation.sourceType,
              sourceAggregateId: allocation.sourceAggregateId,
              sourceLineId: allocation.sourceLineId,
              confirmedVersionId: allocation.confirmedVersionId,
              debtorCompanyId: allocation.debtorCompanyId,
              payeeSubjectType: allocation.payeeSubjectType,
              payeeSubjectId: allocation.payeeSubjectId,
              currencyCode: allocation.currencyCode,
              beneficiaryProjectId: allocation.beneficiaryProjectId,
          sourceSnapshot: allocation.sourceSnapshot as Prisma.InputJsonValue,
              confirmedAmountCents: allocation.confirmedAmountCents,
              amountCents: allocation.amountCents,
              createdByUserId: actorUserId
            }
          });
        }
      } else {
        row = await tx.payableSettlementCase.update({ where: { id: settlementCaseId }, data: {
          status: action === "submit" ? "submitted" : "confirmed",
          revision: { increment: 1 },
          ...(action === "submit" ? { submittedByUserId: actorUserId, submittedAt: now } : {}),
          ...(action === "confirm" ? { confirmedByUserId: actorUserId, confirmedAt: now } : {})
        } });
        if (action === "confirm") {
          const firstAllocation = context.allocations[0];
          if (firstAllocation) {
            const payer = await this.resolvePayerCompanies(
              tx,
              context.request,
              context.contractVersion,
              context.execution,
              firstAllocation.debtorCompanyId,
              actorUserId,
              context.payerAttestation
            );
            const totalPayableAmountCents = context.allocations.reduce(
              (total, allocation) => total + allocation.amountCents,
              0n
            );
            await this.createInterEntityRelationship(
              tx,
              actorUserId,
              context,
              payer,
              firstAllocation.debtorCompanyId,
              totalPayableAmountCents
            );
          }
        }
      }
      const response = action === "return" && successorCase
        ? {
            ...safeSettlementCaseResponse(successorCase),
            returnedSettlementCaseId: settlementCaseId,
            supersedesCaseId: settlementCaseId
          }
        : safeSettlementCaseResponse(row);
      await tx.payableSettlementCommandReceipt.create({ data: {
        id: randomUUID(), idempotencyKey, payloadFingerprint: fingerprint, action: actionName,
        settlementCaseId: successorCase?.id ?? settlementCaseId, responseSnapshot: response
      } });
      const totalAmountCents = context.allocations.reduce(
        (total, allocation) => total + allocation.amountCents,
        0n
      );
      await this.audit.record(tx, {
        actorUserId,
        action: actionName,
        businessType: "payable_settlement_case",
        businessId: settlementCaseId,
        metadata: {
          revision: row.revision,
          scope: "global",
          roleKeys,
          allocationTrace: context.allocations.map((allocation) => ({
            allocationFingerprint: auditFingerprint("allocation", allocation.id),
            payableRefFingerprint: auditFingerprint("payable_ref", allocation.payableRef),
            amountCentsFingerprint: auditFingerprint(
              "amount_cents",
              allocation.amountCents.toString()
            )
          })),
          idempotencyKeyFingerprint: auditFingerprint("idempotency_key", idempotencyKey),
          payloadFingerprint: fingerprint,
          settlementCaseFingerprint: auditFingerprint("settlement_case", settlementCaseId),
          ...(successorCase ? {
            successorSettlementCaseFingerprint: auditFingerprint("settlement_case", successorCase.id)
          } : {}),
          paymentExecutionFingerprint: auditFingerprint(
            "payment_execution",
            context.execution.id
          ),
          allocationCount: context.allocations.length,
          amountCentsFingerprint: auditFingerprint("amount_cents", totalAmountCents.toString())
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async resolvePayerCompanies(
    tx: Prisma.TransactionClient,
    request: Readonly<{ paymentSubjectType: string; id?: string; contractVersionId?: string }>,
    contractVersion: Readonly<{
      status: string;
      signingSubjectType: string;
      companyEntityIdSnapshot: string | null;
      companyEntityVersionId: string | null;
      companyEntityNameSnapshot?: string | null;
      companyEntityCreditCodeSnapshot?: string | null;
    }>,
    execution: Readonly<{
      paymentSubjectType: string;
      companyEntityIdSnapshot: string;
      companyEntityNameSnapshot?: string;
      companyEntityCreditCodeSnapshot?: string;
      voucherFileId?: string;
    }>,
    originalDebtorCompanyId?: string,
    actorUserId?: string,
    payerAttestation?: PayerAttestationRecord | null
  ) {
    if (
      request.paymentSubjectType !== "our_company" ||
      contractVersion.status !== "effective" ||
      contractVersion.signingSubjectType !== "our_company" ||
      !contractVersion.companyEntityIdSnapshot ||
      !contractVersion.companyEntityVersionId ||
      execution.paymentSubjectType !== "our_company" ||
      !execution.companyEntityIdSnapshot.trim()
    ) {
      throw new ConflictException("付款主体事实不属于本票允许的我方公司付款范围");
    }
    const approvedPayerCompanyId = contractVersion.companyEntityIdSnapshot;
    let payerVerification: {
      id: string;
      reference: string;
      holderCompanyEntityId: string;
      holderNameSnapshot: string;
      holderCreditCodeSnapshot: string;
      verificationReference: string;
      verifiedByUserId: string;
      verifiedAt: Date;
      verificationEvidenceFileId: string;
      verificationEvidenceContentSha256: string;
      status: string;
      sourceType: string;
      sourceRecordId: string;
    } | null = null;
    if (payerAttestation) {
      if (!payerAttestation.payerVerificationId) {
        throw new ConflictException("实际付款主体缺少服务端银行账户核验引用");
      }
      const verificationClient = (tx as unknown as {
        paymentExecutionPayerVerification?: {
          findUnique(args: { where: { id: string } }): Promise<typeof payerVerification>;
        };
      }).paymentExecutionPayerVerification;
      if (!verificationClient) {
        throw new ConflictException("银行账户核验权威服务暂不可用，请稍后重试");
      }
      payerVerification = await verificationClient.findUnique({
        where: { id: payerAttestation.payerVerificationId }
      });
      if (
        !payerVerification ||
        payerVerification.status !== "verified" ||
        payerVerification.sourceType !== "bank_account_legal_holder" ||
        payerVerification.reference !== payerAttestation.bankAccountReference ||
        payerVerification.holderCompanyEntityId !== payerAttestation.holderCompanyEntityId ||
        payerVerification.holderNameSnapshot !== payerAttestation.holderNameSnapshot ||
        payerVerification.holderCreditCodeSnapshot !== payerAttestation.holderCreditCodeSnapshot ||
        payerVerification.verificationReference !== payerAttestation.verificationReference ||
        payerVerification.verifiedByUserId !== payerAttestation.verifiedByUserId ||
        payerVerification.verifiedAt.getTime() !== payerAttestation.verifiedAt.getTime() ||
        payerVerification.verificationEvidenceFileId !== payerAttestation.verificationEvidenceFileId ||
        payerVerification.verificationEvidenceContentSha256 !== payerAttestation.verificationEvidenceContentSha256
      ) {
        throw new ConflictException("付款主体核验事实未与服务端银行账户权威记录一致");
      }
    }
    const actualPayerCompanyId = payerVerification?.holderCompanyEntityId?.trim() ||
      execution.companyEntityIdSnapshot.trim();
    const ids = Array.from(new Set([
      contractVersion.companyEntityIdSnapshot,
      actualPayerCompanyId,
      originalDebtorCompanyId
    ].filter((value): value is string => Boolean(value && value.trim()))));
    const [companies, approvedVersion] = await Promise.all([
      tx.companyEntity.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, unifiedSocialCreditCode: true, isActive: true }
      }),
      tx.companyEntityVersion.findUnique({
        where: { id: contractVersion.companyEntityVersionId },
        select: { companyEntityId: true, name: true, unifiedSocialCreditCode: true, isActive: true }
      })
    ]);
    if (
      companies.length !== ids.length ||
      !approvedVersion ||
      approvedVersion.companyEntityId !== approvedPayerCompanyId ||
      !approvedVersion.isActive
    ) {
      throw new ConflictException("代付主体档案不存在或身份不明确");
    }
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const approved = companyById.get(approvedPayerCompanyId);
    const actual = companyById.get(actualPayerCompanyId);
    if (!approved || !actual || !approved.isActive || !actual.isActive) {
      throw new ConflictException("批准付款主体或实际付款主体档案不完整");
    }
    const original = originalDebtorCompanyId?.trim() || approvedPayerCompanyId;
    const authorizationRequired = requiresPayerAuthorization({
      originalDebtorCompanyId: original,
      approvedPayerCompanyId,
      actualPayerCompanyId
    });
    if (authorizationRequired) {
      if (!payerAttestation || !actorUserId) {
        throw new ConflictException("跨主体付款必须先完成银行账户核验和重新授权");
      }
      const authorization: PayerAttestationAuthorization | null =
        payerAttestation.proxyAuthorizationReason &&
        payerAttestation.proxyAuthorizationEvidenceFileId &&
        payerAttestation.reauthorizationReference &&
        payerAttestation.reauthorizationApprovalInstanceId &&
        payerAttestation.reauthorizationApprovalActionLogId &&
        payerAttestation.reauthorizationPaymentRequestId &&
        payerAttestation.reauthorizationContractVersionId &&
        payerAttestation.reauthorizedByUserId &&
        payerAttestation.reauthorizedAt
          ? {
              reason: payerAttestation.proxyAuthorizationReason,
              evidenceFileId: payerAttestation.proxyAuthorizationEvidenceFileId,
              reauthorizationReference: payerAttestation.reauthorizationReference,
              reauthorizedByUserId: payerAttestation.reauthorizedByUserId,
          reauthorizedAt: payerAttestation.reauthorizedAt
        }
          : null;
      if (
        !authorization ||
        !request.id ||
        !request.contractVersionId ||
        payerAttestation.reauthorizationPaymentRequestId !== request.id ||
        payerAttestation.reauthorizationContractVersionId !== request.contractVersionId
      ) {
        throw new ConflictException("跨主体付款的重新授权未绑定当前付款申请和合同版本");
      }
      try {
        assertPayerAttestationFacts({
          originalDebtorCompanyId: original,
          approvedPayerCompanyId,
          actualPayerCompanyId,
          bankAccountReference: payerAttestation.bankAccountReference,
          holderCompanyEntityId: payerAttestation.holderCompanyEntityId,
          holderNameSnapshot: payerAttestation.holderNameSnapshot,
          holderCreditCodeSnapshot: payerAttestation.holderCreditCodeSnapshot,
          verificationReference: payerAttestation.verificationReference,
          verifiedByUserId: payerAttestation.verifiedByUserId,
          verifiedAt: payerAttestation.verifiedAt,
          verificationEvidenceFileId: payerAttestation.verificationEvidenceFileId,
          authorization
        });
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "付款主体核验事实无效");
      }
      if (
        !/^[0-9a-f]{64}$/u.test(payerAttestation.verificationEvidenceContentSha256) ||
        payerAttestation.verifiedAt.getTime() > Date.now()
      ) {
        throw new ConflictException("银行账户核验证据无效或尚未生效");
      }
      const evidenceIds = [
        payerAttestation.verificationEvidenceFileId,
        ...(authorization ? [authorization.evidenceFileId] : [])
      ];
      const evidenceRows = await Promise.all(
        evidenceIds.map((id) => tx.fileObject.findUnique({
          where: { id },
          select: { id: true, storageStatus: true, contentSha256: true }
        }))
      );
      const verificationEvidence = evidenceRows[0];
      if (
        !verificationEvidence ||
        verificationEvidence.storageStatus !== "active" ||
        verificationEvidence.contentSha256 !== payerAttestation.verificationEvidenceContentSha256
      ) {
        throw new ConflictException("银行账户核验证据不存在、已失效或内容已变化");
      }
      if (authorization) {
        const authorizationEvidence = evidenceRows[1];
        if (
          !authorizationEvidence ||
          authorizationEvidence.storageStatus !== "active" ||
          authorizationEvidence.contentSha256 !== payerAttestation.proxyAuthorizationEvidenceSha256 ||
          authorization.reauthorizedAt.getTime() > Date.now() ||
          authorization.reauthorizedByUserId === actorUserId
        ) {
          throw new ConflictException("跨主体付款授权证据不存在、已失效或职责不分离");
        }
      }
    }
    const actualPayerSnapshot = payerAttestation
      ? jsonSafe({
          companyEntityId: actual.id,
          name: payerAttestation.holderNameSnapshot,
          unifiedSocialCreditCode: payerAttestation.holderCreditCodeSnapshot
        })
      : jsonSafe({
          companyEntityId: actual.id,
          name: execution.companyEntityNameSnapshot ?? actual.name,
          unifiedSocialCreditCode:
            execution.companyEntityCreditCodeSnapshot ?? actual.unifiedSocialCreditCode
        });
    return {
      approvedPayerCompanyId,
      actualPayerCompanyId,
      approvedPayerSnapshot: jsonSafe({
        companyEntityId: approved.id,
        companyEntityVersionId: contractVersion.companyEntityVersionId,
        name: contractVersion.companyEntityNameSnapshot ?? approvedVersion.name ?? approved.name,
        unifiedSocialCreditCode:
          contractVersion.companyEntityCreditCodeSnapshot ?? approvedVersion.unifiedSocialCreditCode ?? approved.unifiedSocialCreditCode
      }),
      actualPayerSnapshot,
      originalDebtorSnapshot: originalDebtorCompanyId
        ? jsonSafe({
            companyEntityId: originalDebtorCompanyId,
            name: companyById.get(originalDebtorCompanyId)?.name,
            unifiedSocialCreditCode:
              companyById.get(originalDebtorCompanyId)?.unifiedSocialCreditCode
          })
        : null,
      proxyAuthorizationReason: payerAttestation?.proxyAuthorizationReason ?? null,
      authorizationEvidenceFileId: payerAttestation?.proxyAuthorizationEvidenceFileId ?? null,
      authorizationEvidenceContentSha256:
        payerAttestation?.proxyAuthorizationEvidenceSha256 ?? null,
      reauthorizationReference: payerAttestation?.reauthorizationReference ?? null,
      reauthorizationApprovalInstanceId:
        payerAttestation?.reauthorizationApprovalInstanceId ?? null,
      reauthorizationApprovalActionLogId:
        payerAttestation?.reauthorizationApprovalActionLogId ?? null,
      reauthorizationPaymentRequestId:
        payerAttestation?.reauthorizationPaymentRequestId ?? null,
      reauthorizationContractVersionId:
        payerAttestation?.reauthorizationContractVersionId ?? null,
      reauthorizedByUserId: payerAttestation?.reauthorizedByUserId ?? null,
      reauthorizedAt: payerAttestation?.reauthorizedAt ?? null,
      actualPayerVerificationEvidenceFileId:
        payerAttestation?.verificationEvidenceFileId ?? null,
      actualPayerVerificationContentSha256:
        payerAttestation?.verificationEvidenceContentSha256 ?? null,
      payerVerificationId: payerAttestation?.payerVerificationId ?? null
    };
  }

  private async createInterEntityRelationship(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    context: Readonly<{
      settlementCase: { id: string };
      execution: {
        id: string;
        voucherFileId: string;
      };
      request?: {
        id: string;
        projectId: string;
        contractId: string;
        contractVersionId: string;
      };
      allocations?: ReadonlyArray<{
        amountCents: bigint;
        sourceType?: string;
        sourceAggregateId?: string;
        sourceLineId?: string;
        confirmedVersionId?: string;
        debtorCompanyId: string;
      }>;
    }>,
    payer: Readonly<{
      approvedPayerCompanyId: string;
      actualPayerCompanyId: string;
      approvedPayerSnapshot: Prisma.JsonValue;
      actualPayerSnapshot: Prisma.JsonValue;
      originalDebtorSnapshot: Prisma.JsonValue | null;
      proxyAuthorizationReason: string | null;
      authorizationEvidenceFileId: string | null;
      authorizationEvidenceContentSha256: string | null;
      reauthorizationReference: string | null;
      reauthorizedByUserId: string | null;
      reauthorizedAt: Date | null;
      actualPayerVerificationEvidenceFileId: string | null;
      actualPayerVerificationContentSha256: string | null;
      reauthorizationApprovalInstanceId: string | null;
      reauthorizationApprovalActionLogId: string | null;
      reauthorizationPaymentRequestId: string | null;
      reauthorizationContractVersionId: string | null;
      payerVerificationId: string | null;
    }>,
    originalDebtorCompanyId: string,
    amountCents: bigint
  ) {
    if (payer.actualPayerCompanyId === originalDebtorCompanyId) return null;
    const facts = assertProxySettlementFacts({
      originalDebtorCompanyId,
      approvedPayerCompanyId: payer.approvedPayerCompanyId,
      actualPayerCompanyId: payer.actualPayerCompanyId,
      amountCents,
      currencyCode: "CNY",
      paymentExecutionId: context.execution.id,
      settlementCaseId: context.settlementCase.id,
      voucherFileId: context.execution.voucherFileId
    });
    const existing = await tx.interEntityRelationshipEntry.findFirst({
      where: {
        settlementCaseId: context.settlementCase.id,
        entryKind: "proxy_payment",
        direction: "increase"
      },
      select: { id: true }
    });
    if (existing) return existing;
    const now = new Date();
    const entryId = randomUUID();
    const idempotencyKey = `inter-entity-proxy:${context.settlementCase.id}`;
    const allocationRows = context.allocations ?? [];
    const sourceProjectId = context.request?.projectId ?? null;
    const sourceContractId = context.request?.contractId ?? null;
    const sourceContractVersionId = context.request?.contractVersionId ?? null;
    const sourceAggregateIds = Array.from(new Set(
      allocationRows.map((allocation) => allocation.sourceAggregateId).filter(
        (value): value is string => Boolean(value)
      )
    ));
    if (
      !sourceProjectId ||
      !sourceContractId ||
      !sourceContractVersionId ||
      allocationRows.length === 0 ||
      sourceAggregateIds.length !== 1
    ) {
      throw new ConflictException("代付往来缺少完整工资来源与分摊快照");
    }
    const allocationAmountCents = allocationRows.reduce(
      (total, allocation) => total + allocation.amountCents,
      0n
    );
    if (allocationAmountCents !== amountCents) {
      throw new ConflictException("代付往来金额与核销分摊合计不一致");
    }
    const payloadFingerprint = commandFingerprint("inter_entity_relationship.proxy_payment", {
      settlementCaseId: context.settlementCase.id,
      paymentExecutionId: context.execution.id,
      debtorCompanyId: facts.debtorCompanyId,
      creditorCompanyId: facts.creditorCompanyId,
      approvedPayerCompanyId: facts.approvedPayerCompanyId,
      amountCents: facts.amountCents.toString()
    });
    const created = await tx.interEntityRelationshipEntry.create({
      data: {
        id: entryId,
        entryKind: "proxy_payment",
        direction: "increase",
        status: "draft",
        paymentExecutionId: facts.paymentExecutionId,
        settlementCaseId: facts.settlementCaseId,
        originalDebtorCompanyId: facts.debtorCompanyId,
        creditorCompanyId: facts.creditorCompanyId,
        approvedPayerCompanyId: facts.approvedPayerCompanyId,
        debtorSnapshot: payer.originalDebtorSnapshot ?? jsonSafe({ companyEntityId: originalDebtorCompanyId }),
        creditorSnapshot: payer.actualPayerSnapshot as Prisma.InputJsonValue,
        approvedPayerSnapshot: payer.approvedPayerSnapshot as Prisma.InputJsonValue,
        amountCents: facts.amountCents,
        currencyCode: facts.currencyCode,
        evidenceFileId: facts.voucherFileId,
        reason: payer.proxyAuthorizationReason ?? "跨主体代付",
        authorizationEvidenceFileId: payer.authorizationEvidenceFileId ?? undefined,
        authorizationEvidenceContentSha256:
          payer.authorizationEvidenceContentSha256 ?? undefined,
        reauthorizationReference: payer.reauthorizationReference ?? undefined,
        reauthorizedByUserId: payer.reauthorizedByUserId ?? undefined,
        reauthorizedAt: payer.reauthorizedAt ?? undefined,
        actualPayerVerificationEvidenceFileId:
          payer.actualPayerVerificationEvidenceFileId ?? undefined,
        actualPayerVerificationContentSha256:
          payer.actualPayerVerificationContentSha256 ?? undefined,
        projectId: sourceProjectId,
        contractId: sourceContractId,
        contractVersionId: sourceContractVersionId,
        sourceType: "wage_payable_ref",
        sourceAggregateId: sourceAggregateIds[0],
        sourceAllocationCount: allocationRows.length,
        sourceAllocationAmountCents: allocationAmountCents,
        idempotencyKey,
        payloadFingerprint,
        createdByUserId: actorUserId,
      },
      select: { id: true }
    });
    await tx.interEntityRelationshipEntry.update({
      where: { id: created.id },
      data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: now }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "inter_entity_relationship.proxy_payment",
      businessType: "inter_entity_relationship_entry",
      businessId: created.id,
      metadata: {
        scope: "global",
        relationshipFingerprint: auditFingerprint("inter_entity_relationship", created.id),
        settlementCaseFingerprint: auditFingerprint("settlement_case", context.settlementCase.id),
        paymentExecutionFingerprint: auditFingerprint("payment_execution", context.execution.id),
        originalDebtorFingerprint: auditFingerprint("company_entity", facts.debtorCompanyId),
        creditorFingerprint: auditFingerprint("company_entity", facts.creditorCompanyId),
        approvedPayerFingerprint: auditFingerprint("company_entity", facts.approvedPayerCompanyId),
        payerVerificationFingerprint: payer.payerVerificationId
          ? auditFingerprint("payer_verification", payer.payerVerificationId)
          : null,
        actualPayerVerificationEvidenceFingerprint:
          payer.actualPayerVerificationEvidenceFileId
            ? auditFingerprint(
                "evidence_file",
                payer.actualPayerVerificationEvidenceFileId
              )
            : null,
        actualPayerVerificationContentFingerprint:
          payer.actualPayerVerificationContentSha256
            ? auditFingerprint(
                "evidence_content",
                payer.actualPayerVerificationContentSha256
              )
            : null,
        authorizationEvidenceFingerprint: payer.authorizationEvidenceFileId
          ? auditFingerprint("evidence_file", payer.authorizationEvidenceFileId)
          : null,
        authorizationEvidenceContentFingerprint:
          payer.authorizationEvidenceContentSha256
            ? auditFingerprint(
                "evidence_content",
                payer.authorizationEvidenceContentSha256
              )
            : null,
        approvalInstanceFingerprint: payer.reauthorizationApprovalInstanceId
          ? auditFingerprint(
              "approval_instance",
              payer.reauthorizationApprovalInstanceId
            )
          : null,
        reauthorizationActionFingerprint: payer.reauthorizationApprovalActionLogId
          ? auditFingerprint("approval_action", payer.reauthorizationApprovalActionLogId)
          : null,
        sourceType: "wage_payable_ref",
        sourceAggregateFingerprint: auditFingerprint("wage_statement_version", sourceAggregateIds[0]),
        projectFingerprint: auditFingerprint("project", sourceProjectId),
        contractFingerprint: auditFingerprint("contract", sourceContractId),
        contractVersionFingerprint: auditFingerprint("contract_version", sourceContractVersionId),
        sourceAllocationFingerprints: allocationRows.map((allocation) => ({
          sourceAggregateFingerprint: allocation.sourceAggregateId
            ? auditFingerprint("wage_statement_version", allocation.sourceAggregateId)
            : null,
          sourceLineFingerprint: allocation.sourceLineId
            ? auditFingerprint("wage_payable_ref", allocation.sourceLineId)
            : null,
          confirmedVersionFingerprint: allocation.confirmedVersionId
            ? auditFingerprint("wage_statement_version", allocation.confirmedVersionId)
            : null,
          amountCentsFingerprint: auditFingerprint(
            "amount_cents",
            allocation.amountCents.toString()
          )
        })),
        allocationCount: allocationRows.length,
        amountCentsFingerprint: auditFingerprint("amount_cents", amountCents.toString())
      }
    });
    return created;
  }

  private async lockSettlementContext(
    tx: Prisma.TransactionClient,
    settlementCaseId: string
  ) {
    const caseSnapshot = await tx.payableSettlementCase.findUnique({
      where: { id: settlementCaseId },
      select: { paymentExecutionId: true }
    });
    if (!caseSnapshot) throw new NotFoundException("核销案件不存在，请刷新后重试");
    const executionSnapshot = await tx.paymentExecution.findUnique({
      where: { id: caseSnapshot.paymentExecutionId },
      select: { paymentRequestId: true }
    });
    if (!executionSnapshot) throw new NotFoundException("实际付款不存在，请刷新后重试");
    const requestSnapshot = await tx.paymentRequest.findUnique({
      where: { id: executionSnapshot.paymentRequestId },
      select: { contractVersionId: true }
    });
    if (!requestSnapshot) throw new NotFoundException("付款申请不存在，请刷新后重试");
    const allocationSnapshot = await tx.payableSettlementAllocation.findMany({
      where: { settlementCaseId },
      select: { payableRef: true },
      orderBy: [{ payableRef: "asc" }, { id: "asc" }]
    });
    const payableRefs = Array.from(
      new Set(allocationSnapshot.map(({ payableRef }) => payableRef))
    ).sort();

    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${executionSnapshot.paymentRequestId} FOR UPDATE`
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${requestSnapshot.contractVersionId} FOR UPDATE`
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${caseSnapshot.paymentExecutionId} FOR UPDATE`
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PaymentExecutionAllocation" WHERE "paymentExecutionId" = ${caseSnapshot.paymentExecutionId} ORDER BY "id" FOR UPDATE`
    );
    for (const payableRef of payableRefs) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "WagePayableRef" WHERE "id" = ${payableRef} OR "adjustsPayableRefId" = ${payableRef} ORDER BY "id" FOR UPDATE`
      );
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PayableSettlementCase" WHERE "id" = ${settlementCaseId} FOR UPDATE`
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "PayableSettlementAllocation" WHERE "settlementCaseId" = ${settlementCaseId} ORDER BY "payableRef", "id" FOR UPDATE`
    );

    const [settlementCase, execution, request, contractVersion, counterparties, allocations, paymentExecutionAllocations] = await Promise.all([
      tx.payableSettlementCase.findUnique({ where: { id: settlementCaseId } }),
      tx.paymentExecution.findUnique({ where: { id: caseSnapshot.paymentExecutionId } }),
      tx.paymentRequest.findUnique({ where: { id: executionSnapshot.paymentRequestId } }),
      tx.contractVersion.findUnique({ where: { id: requestSnapshot.contractVersionId } }),
      tx.contractPartySnapshot.findMany({
        where: { contractVersionId: requestSnapshot.contractVersionId, roleKey: "party_b" },
        select: { id: true, businessPartyVersionId: true },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }]
      }),
      tx.payableSettlementAllocation.findMany({
        where: { settlementCaseId },
        orderBy: [{ payableRef: "asc" }, { id: "asc" }]
      }),
      tx.paymentExecutionAllocation.findMany({
        where: { paymentExecutionId: caseSnapshot.paymentExecutionId },
        select: { allocationType: true, amountCents: true },
        orderBy: [{ allocationOrder: "asc" }, { id: "asc" }]
      })
    ]);
    if (!settlementCase || settlementCase.paymentExecutionId !== caseSnapshot.paymentExecutionId) {
      throw new ConflictException("核销案件已被更新，请刷新后重试");
    }
    if (!execution || execution.paymentRequestId !== executionSnapshot.paymentRequestId) {
      throw new ConflictException("实际付款已被更新，请刷新后重试");
    }
    if (!request || request.contractVersionId !== requestSnapshot.contractVersionId) {
      throw new ConflictException("付款申请已被更新，请刷新后重试");
    }
    if (!contractVersion) {
      throw new ConflictException("批准付款主体版本不存在，请刷新后重试");
    }
    const currentPayableRefs = Array.from(
      new Set(allocations.map(({ payableRef }) => payableRef))
    ).sort();
    if (
      currentPayableRefs.length !== payableRefs.length ||
      currentPayableRefs.some((payableRef, index) => payableRef !== payableRefs[index])
    ) {
      throw new ConflictException("核销明细已被更新，请刷新后重试");
    }
    const bindingClient = (tx as unknown as {
      paymentExecutionWagePayableBinding?: {
        findMany(args: Record<string, unknown>): Promise<Array<{
          wagePayableRefId: string;
          creditorSubjectType: string;
          creditorSubjectIdentityKey: string;
          amountCents: bigint;
        }>>;
      };
    }).paymentExecutionWagePayableBinding;
    const wageBindings: WagePayableBindingFact[] = bindingClient
      ? (await bindingClient.findMany({
          where: { paymentExecutionId: caseSnapshot.paymentExecutionId },
          select: {
            wagePayableRefId: true,
            creditorSubjectType: true,
            creditorSubjectIdentityKey: true,
            amountCents: true
          }
        })).map((binding) => ({
          payableRef: binding.wagePayableRefId,
          payeeSubjectType: binding.creditorSubjectType as WagePayableBindingFact["payeeSubjectType"],
          payeeSubjectId: binding.creditorSubjectIdentityKey,
          amountCents: binding.amountCents
        }))
      : [];
    const otherAllocatedAmountCents = paymentExecutionAllocations.reduce(
      (total, allocation) => allocation.allocationType === "contract_due_payment"
        ? total + allocation.amountCents
        : total,
      0n
    );
    const attestationClient = (tx as unknown as {
      paymentExecutionPayerAttestation?: {
        findUnique(args: { where: { paymentExecutionId: string } }): Promise<PayerAttestationRecord | null>;
      };
    }).paymentExecutionPayerAttestation;
    const payerAttestation = attestationClient
      ? await attestationClient.findUnique({
          where: { paymentExecutionId: caseSnapshot.paymentExecutionId }
        })
      : null;
    return {
      settlementCase,
      execution,
      request,
      contractVersion,
      counterparties,
      allocations,
      wageBindings,
      otherAllocatedAmountCents,
      payerAttestation
    };
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

  private async assertCurrentPayableBalances(
    tx: Prisma.TransactionClient,
    settlementCaseId: string,
    allocations: readonly Readonly<{
      payableRef: string;
      sourceType: string;
      sourceAggregateId: string;
      sourceLineId: string;
      confirmedVersionId: string;
      debtorCompanyId: string;
      payeeSubjectType: string;
      payeeSubjectId: string;
      currencyCode: string;
      beneficiaryProjectId: string;
      confirmedAmountCents: bigint;
      amountCents: bigint;
    }>[]
  ) {
    const payableRefs = Array.from(new Set(allocations.map(({ payableRef }) => payableRef))).sort();
    const allocationTotals = await loadPayableSettlementAllocationTotals(
      tx,
      payableRefs,
      { excludeSettlementCaseId: settlementCaseId }
    );
    for (const payableRef of payableRefs) {
      const payable = await tx.wagePayableRef.findUnique({
        where: { id: payableRef },
        include: {
          confirmedVersion: { select: { status: true, revision: true } },
          creditorBreakdown: {
            select: {
              creditorSubjectType: true,
              creditorSubjectIdentityKey: true,
              creditorNameSnapshot: true
            }
          },
          adjustments: { select: { direction: true, amountCents: true } }
        }
      });
      if (!payable) {
        throw new ConflictException("工资应付余额已变化，请刷新后重试");
      }
      const current = payableSourceAdapterRegistry.require("wage_payable_ref").toRegisteredPayable(payable);
      const caseAllocations = allocations.filter((allocation) => allocation.payableRef === payableRef);
      if (
        caseAllocations.some((allocation) =>
          allocation.sourceType !== current.sourceType ||
          allocation.sourceAggregateId !== current.sourceAggregateId ||
          allocation.sourceLineId !== current.sourceLineId ||
          allocation.confirmedVersionId !== current.confirmedVersionId ||
          allocation.debtorCompanyId !== current.debtorCompanyId ||
          allocation.payeeSubjectType !== current.payeeSubjectType ||
          allocation.payeeSubjectId !== current.payeeSubjectId ||
          allocation.currencyCode !== current.currencyCode ||
          allocation.beneficiaryProjectId !== current.beneficiaryProjectId ||
          allocation.confirmedAmountCents !== current.confirmedAmountCents
        )
      ) {
        throw new ConflictException("工资应付身份或版本已变化，请刷新后重试");
      }
      const totals = payableSettlementAllocationTotalsFor(
        allocationTotals,
        payableRef
      );
      const effectiveAmountCents = deriveEffectiveWagePayableAmount(
        payable.amountCents,
        payable.adjustments
      );
      const currentCaseAmountCents = caseAllocations.reduce(
        (total, allocation) => total + allocation.amountCents,
        0n
      );
      const balance = derivePayableSettlementBalance({
        effectiveAmountCents,
        validSettledAmountCents:
          totals.confirmedAmountCents + currentCaseAmountCents
      });
      if (balance.overSettledAmountCents > 0n) {
        throw new ConflictException("工资应付余额已变化，请刷新后重试");
      }
    }
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

function assertCurrentPaymentRequestContext(
  request: Readonly<{
    status: string;
    projectId: string;
    approvedAmountCents: bigint | null;
  }>,
  execution: Readonly<{ amountCents: bigint }>,
  counterparties: readonly Readonly<{ businessPartyVersionId: string | null }>[],
  allocations: readonly Readonly<{
    beneficiaryProjectId: string;
    payeeSubjectType: string;
    payeeSubjectId: string;
    payableRef: string;
  }>[],
  wageBindings: readonly WagePayableBindingFact[] = []
) {
  if (!["paid", "partially_paid"].includes(request.status)) {
    throw new ConflictException("付款申请状态已变化，请刷新后重试");
  }
  if (request.approvedAmountCents === null || execution.amountCents > request.approvedAmountCents) {
    throw new ConflictException("实际付款超过当前批准额度，请刷新后重试");
  }
  if (allocations.some((allocation) => allocation.beneficiaryProjectId !== request.projectId)) {
    throw new ConflictException("付款申请项目与核销明细不一致");
  }
  if (wageBindings.length > 0) {
    const wageBindingByRef = new Map(
      wageBindings.map((binding) => [binding.payableRef, binding])
    );
    if (allocations.some((allocation) => {
      const binding = wageBindingByRef.get(allocation.payableRef);
      return !binding ||
        binding.payeeSubjectType !== allocation.payeeSubjectType ||
        binding.payeeSubjectId !== allocation.payeeSubjectId;
    })) {
      throw new ConflictException("工资债权人与核销明细不一致");
    }
  } else {
    if (counterparties.length !== 1 || !counterparties[0].businessPartyVersionId) {
      throw new ConflictException("合同当前未冻结唯一收款方，请刷新后重试");
    }
    const approvedPayeeSubjectId = `business_party:${counterparties[0].businessPartyVersionId}`;
    if (allocations.some((allocation) =>
      allocation.payeeSubjectType !== "business_party" ||
      allocation.payeeSubjectId !== approvedPayeeSubjectId
    )) {
      throw new ConflictException("合同收款方与核销明细不一致");
    }
  }
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested)) as T;
}

function safeSettlementCaseResponse(value: Readonly<{
  id: string;
  status: string;
  revision: number;
  createdAt?: Date;
  submittedAt?: Date | null;
  confirmedAt?: Date | null;
  updatedAt?: Date;
}>) {
  return {
    settlementCaseId: value.id,
    status: value.status,
    statusLabel: settlementStatusLabel(value.status),
    revision: value.revision,
    ...(value.createdAt ? { createdAt: value.createdAt.toISOString() } : {}),
    ...(value.submittedAt !== undefined
      ? { submittedAt: value.submittedAt?.toISOString() ?? null }
      : {}),
    ...(value.confirmedAt !== undefined
      ? { confirmedAt: value.confirmedAt?.toISOString() ?? null }
      : {}),
    ...(value.updatedAt ? { updatedAt: value.updatedAt.toISOString() } : {})
  };
}

function dateLabel(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}年${month}月${day}日`;
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

function toSettlementAllocationInput(allocation: Readonly<{
  payableRef: string;
  amountCents: bigint;
  debtorCompanyId: string;
  payeeSubjectType: string;
  payeeSubjectId: string;
  currencyCode: string;
}>) {
  if (allocation.payeeSubjectType !== "employee_user" && allocation.payeeSubjectType !== "business_party") {
    throw new ConflictException("核销债权人主体类型无效");
  }
  if (allocation.currencyCode !== "CNY") {
    throw new ConflictException("核销币种无效");
  }
  return {
    ...allocation,
    payeeSubjectType: allocation.payeeSubjectType,
    currencyCode: allocation.currencyCode
  } as const;
}
