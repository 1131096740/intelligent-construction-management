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
import { derivePayableSettlementBalance } from "./payable-registry.domain";
import {
  type PaymentExecutionSelectionBinding,
  PaymentExecutionSelectionRefService
} from "./payment-execution-selection-ref.service";
import {
  deriveEffectiveWagePayableAmount,
  type RegisteredPayable,
  WagePayableSourceAdapter
} from "./wage-payable-source.adapter";

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
    const cases = [];
    for (const row of rows) {
      const registered = new WagePayableSourceAdapter().toRegisteredPayable(row);
      const effectiveAmountCents = deriveEffectiveWagePayableAmount(
        row.amountCents,
        row.adjustments
      );
      const [confirmed, active] = await Promise.all([
        this.prisma.payableSettlementAllocation.aggregate({
          where: { payableRef: row.id, settlementCase: { status: "confirmed" } },
          _sum: { amountCents: true }
        }),
        this.prisma.payableSettlementAllocation.aggregate({
          where: {
            payableRef: row.id,
            settlementCase: { status: { in: ["draft", "submitted", "confirmed"] } }
          },
          _sum: { amountCents: true }
        })
      ]);
      const confirmedBalance = derivePayableSettlementBalance({
        effectiveAmountCents,
        validSettledAmountCents: confirmed._sum.amountCents ?? 0n
      });
      const overSettled = confirmedBalance.overSettledAmountCents > 0n;
      const allocatableAmountCents = effectiveAmountCents - (active._sum.amountCents ?? 0n);
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
    const registered = new WagePayableSourceAdapter().toRegisteredPayable(payable);
    const caseRevision = await this.loadPayableCaseRevision(db, payableRef);
    const effectiveAmountCents = deriveEffectiveWagePayableAmount(
      payable.amountCents,
      payable.adjustments
    );
    const [confirmed, active] = await Promise.all([
      db.payableSettlementAllocation.aggregate({
        where: { payableRef, settlementCase: { status: "confirmed" } },
        _sum: { amountCents: true }
      }),
      db.payableSettlementAllocation.aggregate({
        where: {
          payableRef,
          settlementCase: { status: { in: ["draft", "submitted", "confirmed"] } }
        },
        _sum: { amountCents: true }
      })
    ]);
    const confirmedBalance = derivePayableSettlementBalance({
      effectiveAmountCents,
      validSettledAmountCents: confirmed._sum.amountCents ?? 0n
    });
    if (confirmedBalance.overSettledAmountCents > 0n) {
      throw new ConflictException("该工资应付已超额核销，必须先完成核对");
    }
    const allocatablePayableCents = effectiveAmountCents - (active._sum.amountCents ?? 0n);
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
        projectId: true,
        contractVersionId: true,
        status: true,
        paymentSubjectType: true,
        updatedAt: true
      }
    });
    const contractVersionIds = [...new Set(requests.map((request) => request.contractVersionId))];
    const [contractVersions, allocatedByExecution, allocatedByPair] = await Promise.all([
      contractVersionIds.length === 0 ? Promise.resolve([]) : db.contractVersion.findMany({
        where: { id: { in: contractVersionIds } },
        select: {
          id: true,
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
      })
    ]);
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const contractVersionById = new Map(contractVersions.map((version) => [version.id, version]));
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
    const candidates: EligiblePaymentCandidateState["candidates"][number][] = [];
    for (const execution of executions) {
      const wageBinding = bindingByExecutionId.get(execution.id);
      const request = requestById.get(execution.paymentRequestId);
      const contractVersion = request
        ? contractVersionById.get(request.contractVersionId)
        : undefined;
      if (
        !request ||
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
        request.paymentSubjectType !== "our_company" ||
        execution.paymentSubjectType !== "our_company" ||
        !["paid", "partially_paid"].includes(request.status) ||
        contractVersion.status !== "effective" ||
        contractVersion.signingSubjectType !== "our_company" ||
        !contractVersion.companyEntityIdSnapshot ||
        !contractVersion.companyEntityVersionId ||
        contractVersion.companyEntityIdSnapshot !== registered.debtorCompanyId ||
        execution.companyEntityIdSnapshot !== contractVersion.companyEntityIdSnapshot
      ) {
        continue;
      }
      const executionAvailableAmountCents = execution.amountCents -
        (allocatedAmountByExecutionId.get(execution.id) ?? 0n);
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
        contractVersionId: contractVersion.id,
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
        executionAvailableAmountCents: availableAmountCents.toString(),
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
        const { execution, request, contractVersion, counterparties, allocations, wageBindings } = context;
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
        const payer = resolvePayerCompanies(request, contractVersion, execution);
        assertAllocationSetMatchesPaymentExecution({
          id: execution.id, amountCents: execution.amountCents, currencyCode: "CNY",
          approvedPayerCompanyId: payer.approvedPayerCompanyId,
          actualPayerCompanyId: payer.actualPayerCompanyId
        }, allocations.map(toSettlementAllocationInput), { wageBindings });
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

    const [settlementCase, execution, request, contractVersion, counterparties, allocations] = await Promise.all([
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
    return { settlementCase, execution, request, contractVersion, counterparties, allocations, wageBindings };
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
      const current = new WagePayableSourceAdapter().toRegisteredPayable(payable);
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
      const confirmed = await tx.payableSettlementAllocation.aggregate({
        where: {
          payableRef,
          settlementCaseId: { not: settlementCaseId },
          settlementCase: { status: "confirmed" }
        },
        _sum: { amountCents: true }
      });
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
        validSettledAmountCents: (confirmed._sum.amountCents ?? 0n) + currentCaseAmountCents
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

function resolvePayerCompanies(
  request: Readonly<{ paymentSubjectType: string }>,
  contractVersion: Readonly<{
    status: string;
    signingSubjectType: string;
    companyEntityIdSnapshot: string | null;
    companyEntityVersionId: string | null;
  }>,
  execution: Readonly<{
    paymentSubjectType: string;
    companyEntityIdSnapshot: string;
  }>
) {
  if (
    request.paymentSubjectType !== "our_company" ||
    contractVersion.status !== "effective" ||
    contractVersion.signingSubjectType !== "our_company" ||
    !contractVersion.companyEntityIdSnapshot ||
    !contractVersion.companyEntityVersionId ||
    execution.paymentSubjectType !== "our_company"
  ) {
    throw new ConflictException("付款主体事实不属于本票允许的我方公司付款范围");
  }
  return {
    approvedPayerCompanyId: contractVersion.companyEntityIdSnapshot,
    actualPayerCompanyId: execution.companyEntityIdSnapshot
  };
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
