import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import {
  occurredBeforeEffectiveDate,
  sourceJson,
  stableNamedSubjectId
} from "../operating-ledger/formal-operating-source.helpers";
import {
  type AppendOperatingFactInput,
  OperatingLedgerService
} from "../operating-ledger/operating-ledger.service";
import {
  OTHER_PROJECT_PAYMENT_CATEGORIES,
  projectClaimPaymentCapacity
} from "./other-project-payment";

const CORRECTION_CONFIRM_ROLES = ["finance_director"] as const;
const EXPENSE_SOURCE_TYPE = "expense_claim_approval";

interface ClaimLockRow {
  id: string;
  code: string;
  claimType: string;
  status: string;
  projectId: string | null;
  companyEntityId: string;
  costBearingCompanySpecified: boolean;
  costBearingCompanyEntityId: string | null;
  incidentalExpenseCategory: string | null;
  payeeNameSnapshot: string | null;
  companyPayableAmountCents: bigint;
  handledByUserId: string;
  applicantUserId: string | null;
}

/**
 * #405：其他项目付款的已确认费用更正。
 *
 * 无迁移约束下不另造更正事实表：更正结果以经营账“更正来源”追加写入
 * （原 confirmed_cost / payable 事实不改，新事实通过 adjustsFactId 指向原事实），
 * 同时更新费用单的应付投影；财务主管确认、自审原因+密码与 #400/APR-14 同构。
 */
@Injectable()
export class ExpenseClaimCorrectionService {
  private readonly roles: CompanyRoleResolverService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly ledger: OperatingLedgerService
  ) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  fingerprint(value: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  }

  async correctConfirmedAmount(
    claimId: string,
    actorUserId: string,
    input: {
      correctedAmountCents: string;
      reason: string;
      confirmationPassword: string;
      selfReviewReason?: string | null;
      idempotencyKey: string;
    }
  ) {
    const correctedAmountCents = parseMoneyCentsInput(
      input.correctedAmountCents,
      "更正后费用金额",
      "更正后费用金额必须按分填写为大于 0 的整数"
    );
    if (correctedAmountCents <= 0n) throw new BadRequestException("更正后费用金额必须大于 0");
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("请填写更正原因");
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException("请提供更正登记幂等键");
    const selfReviewReason = input.selfReviewReason?.trim() || null;
    const password = input.confirmationPassword?.trim();
    if (!password) throw new BadRequestException("更正费用金额需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, password);

    return this.prisma.$transaction(async (tx) => {
      const roles = await this.requireDirector(tx, actorUserId);
      const rows = await tx.$queryRaw<ClaimLockRow[]>(Prisma.sql`
        SELECT "id", "code", "claimType", "status", "projectId", "companyEntityId", "costBearingCompanySpecified",
               "costBearingCompanyEntityId", "incidentalExpenseCategory",
               "payeeNameSnapshot", "companyPayableAmountCents", "handledByUserId", "applicantUserId"
        FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException("费用申请不存在，请刷新后重试");
      if (claim.claimType !== "incidental_expense") {
        throw new BadRequestException("只有其他项目付款可以更正费用金额");
      }
      if (!["approved_pending_payment", "partially_paid", "paid"].includes(claim.status)) {
        throw new BadRequestException("当前费用申请不可更正金额");
      }
      if (!claim.projectId) throw new ConflictException("未关联项目的费用申请不能更正项目成本");
      if (!claim.payeeNameSnapshot?.trim()) throw new ConflictException("费用申请缺少收款对象，不能更正应付");
      const fingerprint = this.fingerprint({
        kind: "expense_claim_correction",
        claimId: claim.id,
        actorUserId,
        correctedAmountCents: correctedAmountCents.toString(),
        reason,
        selfReviewReason
      });
      const correctionBusinessId = `${claim.id}:correction:${idempotencyKey}`;
      const existing = await tx.operatingFact.findUnique({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: EXPENSE_SOURCE_TYPE,
            sourceBusinessId: correctionBusinessId
          }
        }
      });
      if (existing) {
        const snapshot = (existing.sourceSnapshot ?? {}) as Record<string, unknown>;
        if (snapshot.fingerprint !== fingerprint) {
          throw new ConflictException("更正登记幂等键已用于不同请求，请查询原结果");
        }
        return this.replayView(claim, snapshot);
      }
      const original = await tx.operatingFact.findUnique({
        where: {
          sourceType_sourceBusinessId: {
            sourceType: EXPENSE_SOURCE_TYPE,
            sourceBusinessId: claim.id
          }
        },
        select: {
          id: true,
          projectId: true,
          numericProtocolVersion: true,
          operatingLedgerEffectiveDateSnapshot: true,
          affiliateAssignmentId: true,
          affiliateBusinessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true
        }
      });
      if (!original) throw new BadRequestException("费用成本尚未确认，不能更正金额");
      if (!original.affiliateAssignmentId || !original.affiliateBusinessPartyVersionId || !original.affiliateNameSnapshot) {
        throw new ConflictException("原费用成本缺少施工企业快照，不能更正金额");
      }
      const originalAmountCents = claim.companyPayableAmountCents;
      if (correctedAmountCents === originalAmountCents) {
        throw new BadRequestException("更正后金额与原金额相同，无需更正");
      }
      const isSelfReview = claim.handledByUserId === actorUserId || claim.applicantUserId === actorUserId;
      if (isSelfReview && !selfReviewReason) {
        throw new BadRequestException("本人经办或申请的费用更正必须填写自审原因");
      }
      const capacity = await this.projectionFor(tx, claim.id, correctedAmountCents);
      const deltaCents = correctedAmountCents - originalAmountCents;
      const absoluteDeltaCents = deltaCents < 0n ? -deltaCents : deltaCents;
      const direction = deltaCents < 0n ? "inflow" as const : "outflow" as const;
      const impactDirection = deltaCents < 0n ? "decrease" as const : "increase" as const;
      const confirmedAt = new Date();
      const costCategoryCode = OTHER_PROJECT_PAYMENT_CATEGORIES.find(
        (item) => item.key === claim.incidentalExpenseCategory
      )?.costCategoryCode ?? "other_project_cost";
      const companyId = claim.costBearingCompanySpecified ? claim.costBearingCompanyEntityId : claim.companyEntityId;
      const company: AppendOperatingFactInput["subjects"]["costBearingCompany"] = companyId
        ? { kind: "participating_company", id: companyId } : undefined;
      const payee: AppendOperatingFactInput["subjects"]["payee"] = {
        kind: "downstream_counterparty",
        id: stableNamedSubjectId("downstream_counterparty", claim.payeeNameSnapshot)
      };
      const factInput: AppendOperatingFactInput = {
        projectId: claim.projectId,
        sourceType: EXPENSE_SOURCE_TYPE,
        sourceBusinessId: correctionBusinessId,
        sourceBusinessCode: `${claim.code}/费用更正/${idempotencyKey.slice(0, 8)}`,
        sourceVersion: 2,
        idempotencyKey: `${EXPENSE_SOURCE_TYPE}:${correctionBusinessId}`,
        adjustsFactId: original.id,
        occurredAt: confirmedAt,
        confirmedAt,
        confirmedByUserId: actorUserId,
        factKind: "expense",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents: absoluteDeltaCents,
        currencyCode: "CNY",
        direction,
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          confirmedAt,
          original.operatingLedgerEffectiveDateSnapshot
        ),
        affiliateAssignmentId: original.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
        affiliateNameSnapshot: original.affiliateNameSnapshot,
        ...(original.affiliateCreditCodeSnapshot
          ? { affiliateCreditCodeSnapshot: original.affiliateCreditCodeSnapshot }
          : {}),
        sourceSnapshot: sourceJson({
          formalStatus: "confirmed",
          claimId: claim.id,
          originalOperatingFactId: original.id,
          originalAmountCents: originalAmountCents.toString(),
          correctedAmountCents: correctedAmountCents.toString(),
          deltaCents: deltaCents.toString(),
          reason,
          selfReviewReason,
          fingerprint
        }),
        basisSnapshot: sourceJson({
          authority: "other_project_payment_correction",
          claimId: claim.id,
          originalAmountCents: originalAmountCents.toString(),
          correctedAmountCents: correctedAmountCents.toString()
        }),
        subjects: { ...(company ? { costBearingCompany: company } : {}), payee },
        impacts: [
          {
            idempotencyKey: `${EXPENSE_SOURCE_TYPE}:${correctionBusinessId}:confirmed_cost`,
            sourceImpactKey: "confirmed_cost",
            impactKind: "confirmed_cost",
            amountCents: absoluteDeltaCents,
            direction: impactDirection,
            ...(company ? { subjectRole: "cost_bearing_company" as const, subject: company } : {}),
            costCategoryCode,
            description: deltaCents < 0n ? "其他项目付款更正调减项目成本" : "其他项目付款更正调增项目成本"
          },
          {
            idempotencyKey: `${EXPENSE_SOURCE_TYPE}:${correctionBusinessId}:payable`,
            sourceImpactKey: "payable",
            impactKind: deltaCents < 0n ? "payable_decrease" : "payable_increase",
            amountCents: absoluteDeltaCents,
            direction: impactDirection,
            subjectRole: "payee",
            subject: payee,
            description: deltaCents < 0n ? "其他项目付款更正减少下游应付" : "其他项目付款更正增加下游应付"
          }
        ]
      };
      await this.ledger.appendConfirmedSourceInTransaction(tx, factInput, actorUserId, "correction");
      await tx.expenseClaim.update({
        where: { id: claim.id },
        data: { companyPayableAmountCents: correctedAmountCents, status: capacity.status }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "incidental_expense.correction.confirmed",
        businessType: "incidental_expense",
        businessId: claim.id,
        metadata: {
          originalAmountCents: originalAmountCents.toString(),
          correctedAmountCents: correctedAmountCents.toString(),
          deltaCents: deltaCents.toString(),
          selfReview: isSelfReview,
          roles: roles.join(",")
        }
      });
      return {
        claimId: claim.id,
        originalAmountCents: moneyCentsToApi(originalAmountCents),
        correctedAmountCents: moneyCentsToApi(correctedAmountCents),
        correctionDeltaCents: moneyCentsToApi(deltaCents),
        fundedAmountCents: moneyCentsToApi(capacity.fundedCents),
        refundedCents: moneyCentsToApi(capacity.refundedCents),
        netPaidCents: moneyCentsToApi(capacity.netPaidCents),
        remainingPayableCents: moneyCentsToApi(capacity.remainingPayableCents),
        overpaidCents: moneyCentsToApi(capacity.overpaidCents),
        status: capacity.status,
        replayed: false
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private replayView(claim: ClaimLockRow, snapshot: Record<string, unknown>) {
    const originalAmountCents = BigInt(String(snapshot.originalAmountCents ?? "0"));
    const correctedAmountCents = BigInt(String(snapshot.correctedAmountCents ?? "0"));
    return {
      claimId: claim.id,
      originalAmountCents: moneyCentsToApi(originalAmountCents),
      correctedAmountCents: moneyCentsToApi(correctedAmountCents),
      correctionDeltaCents: moneyCentsToApi(correctedAmountCents - originalAmountCents),
      status: claim.status,
      replayed: true
    };
  }

  private async projectionFor(tx: Prisma.TransactionClient, claimId: string, payableCents: bigint) {
    const executions = await tx.expenseClaimPaymentExecution.findMany({
      where: { expenseClaimId: claimId },
      select: { id: true, amountCents: true }
    });
    const executionIds = executions.map((row) => row.id);
    const fundedCents = executions.reduce((total, row) => total + row.amountCents, 0n);
    const recorded = executionIds.length
      ? await tx.paymentExecutionRefund.aggregate({
        where: {
          executionType: "expense_claim_payment_execution",
          expenseClaimPaymentExecutionId: { in: executionIds }
        },
        _sum: { amountCents: true }
      })
      : { _sum: { amountCents: 0n as bigint | null } };
    return projectClaimPaymentCapacity({
      payableCents,
      fundedCents,
      refundedCents: recorded._sum.amountCents ?? 0n
    });
  }

  private async requireDirector(tx: Prisma.TransactionClient, actorUserId: string): Promise<string[]> {
    let roles: string[];
    try {
      roles = await this.roles.resolveActiveRoleScopesInTransaction(tx as never, actorUserId);
    } catch {
      throw new ForbiddenException("当前资金岗位已失效，不能更正费用金额");
    }
    if (!roles.some((role) => (CORRECTION_CONFIRM_ROLES as readonly string[]).includes(role))) {
      throw new ForbiddenException("只有当前财务主管可以确认费用金额更正");
    }
    return roles;
  }
}
