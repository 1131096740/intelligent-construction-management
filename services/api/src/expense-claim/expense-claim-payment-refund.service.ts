import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertRefundNotBeforePaymentChinaDate, chinaDateOnly, requiredPastChinaDate } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import { appendPaymentFinancialFunding } from "../payment/payment-financial-funding";
import {
  assertExecutionRefundWithinCap,
  projectClaimPaymentCapacity
} from "./other-project-payment";

const REFUND_ROLES = ["finance_staff", "finance_director", "comprehensive_director"] as const;

interface ClaimLockRow {
  id: string;
  code: string;
  claimType: string;
  status: string;
  projectId: string | null;
  companyEntityId: string;
  companyEntityNameSnapshot: string;
  companyPayableAmountCents: bigint;
  fundedAmountCents: bigint;
  handledByUserId: string;
  applicantUserId: string | null;
}

/**
 * #405：无合同项目付款的实际退款。
 *
 * 复用 #400 的 PaymentExecutionRefund 事实（executionType 为
 * expense_claim_payment_execution）、payment_refund 资金登记与只增语义：
 * 原 ExpenseClaimPaymentExecution 不改，退款累计不超过原实付；退款把对应
 * 金额重新变为可付，但已确认费用成本不因多付款退款而减少（PAY-16）。
 */
@Injectable()
export class ExpenseClaimPaymentRefundService {
  private readonly roles: CompanyRoleResolverService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  fingerprint(value: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  }

  protected appendFunding(
    tx: Prisma.TransactionClient,
    input: Parameters<typeof appendPaymentFinancialFunding>[1]
  ): ReturnType<typeof appendPaymentFinancialFunding> {
    return appendPaymentFinancialFunding(tx, input);
  }

  private async requireRefundActor(tx: Prisma.TransactionClient, actorUserId: string): Promise<string[]> {
    let roles: string[];
    try {
      roles = await this.roles.resolveActiveRoleScopesInTransaction(tx as never, actorUserId);
    } catch {
      throw new ForbiddenException("当前资金岗位已失效，不能登记退款");
    }
    if (!roles.some((role) => (REFUND_ROLES as readonly string[]).includes(role))) {
      throw new ForbiddenException("只有当前财务人员或综合部主管可以登记实际收到的退款");
    }
    return roles;
  }

  private async projectionFor(
    tx: Prisma.TransactionClient,
    claim: { id: string; companyPayableAmountCents: bigint; status: string },
    extraRefundCents: bigint
  ) {
    const executions = await tx.expenseClaimPaymentExecution.findMany({
      where: { expenseClaimId: claim.id },
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
    const refundedCents = (recorded._sum.amountCents ?? 0n) + extraRefundCents;
    return projectClaimPaymentCapacity({ payableCents: claim.companyPayableAmountCents, fundedCents, refundedCents });
  }

  private view(claimId: string, executionId: string, capacity: ReturnType<typeof projectClaimPaymentCapacity>, refund: { id: string; amountCents: bigint }, replayed: boolean) {
    return {
      id: refund.id,
      claimId,
      executionId,
      amountCents: moneyCentsToApi(refund.amountCents),
      fundedAmountCents: moneyCentsToApi(capacity.fundedCents),
      refundedCents: moneyCentsToApi(capacity.refundedCents),
      netPaidCents: moneyCentsToApi(capacity.netPaidCents),
      remainingPayableCents: moneyCentsToApi(capacity.remainingPayableCents),
      overpaidCents: moneyCentsToApi(capacity.overpaidCents),
      status: capacity.status,
      replayed
    };
  }

  async recordRefund(
    claimId: string,
    executionId: string,
    actorUserId: string,
    input: { amountCents: string; receivedAt: string; reason: string; accountId?: string | null; accountScopeKey?: string | null; evidenceReference?: string | null; idempotencyKey: string }
  ) {
    const amountCents = parseMoneyCentsInput(input.amountCents, "退款金额", "退款金额必须按分填写为大于 0 的整数");
    if (amountCents <= 0n) throw new BadRequestException("退款金额必须大于 0");
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("请填写退款原因");
    let accountId = input.accountId?.trim() ?? "";
    const accountScopeKey = input.accountScopeKey?.trim() ?? "";
    if (!accountId && !accountScopeKey) throw new BadRequestException("请选择实际收款的资金账户");
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException("请提供退款登记幂等键");
    let receivedAtDay: string;
    let receivedAt: Date;
    try {
      receivedAt = requiredPastChinaDate(input.receivedAt, "退款到账日期");
      receivedAtDay = chinaDateOnly(receivedAt);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "退款到账日期不正确");
    }
    const evidenceReference = input.evidenceReference?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const roles = await this.requireRefundActor(tx, actorUserId);
      const rows = await tx.$queryRaw<ClaimLockRow[]>(Prisma.sql`
        SELECT "id", "code", "claimType", "status", "projectId", "companyEntityId", "companyEntityNameSnapshot",
               "companyPayableAmountCents", "fundedAmountCents", "handledByUserId", "applicantUserId"
        FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException("费用申请不存在，请刷新后重试");
      if (claim.claimType !== "incidental_expense") {
        throw new BadRequestException("只有其他项目付款可以登记实际退款");
      }
      if (!["approved_pending_payment", "partially_paid", "paid"].includes(claim.status)) {
        throw new BadRequestException("当前费用申请不可登记退款");
      }
      if (!claim.projectId) throw new ConflictException("未关联项目的费用申请不能登记项目退款");
      if (!accountId && accountScopeKey) {
        const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: accountScopeKey }, select: { id: true } });
        if (!account) throw new NotFoundException("实际收款的资金账户不存在，请先核对资金登记");
        accountId = account.id;
      }
      const execution = await tx.expenseClaimPaymentExecution.findFirst({
        where: { id: executionId, expenseClaimId: claim.id },
        select: { id: true, amountCents: true, paidAt: true }
      });
      if (!execution) throw new NotFoundException("待退款的实付记录不存在，请刷新费用详情");
      try {
        assertRefundNotBeforePaymentChinaDate(`${receivedAtDay}T00:00:00.000Z`, execution.paidAt);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "退款到账日期不能早于付款日期");
      }
      const fingerprint = this.fingerprint({
        kind: "expense_claim_refund",
        claimId: claim.id,
        executionId: execution.id,
        actorUserId,
        amountCents: amountCents.toString(),
        receivedAt: receivedAtDay,
        reason,
        accountId,
        evidenceReference
      });
      const existing = await tx.paymentExecutionRefund.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint) {
          throw new ConflictException("退款登记幂等键已用于不同请求，请查询原结果");
        }
        const capacity = await this.projectionFor(tx, claim, 0n);
        return this.view(claim.id, execution.id, capacity, existing, true);
      }
      const refunded = await tx.paymentExecutionRefund.aggregate({
        where: {
          executionType: "expense_claim_payment_execution",
          expenseClaimPaymentExecutionId: execution.id
        },
        _sum: { amountCents: true }
      });
      assertExecutionRefundWithinCap(execution.amountCents, refunded._sum.amountCents ?? 0n, amountCents);
      const refundId = randomUUID();
      const funding = await this.appendFunding(tx, {
        kind: "payment_refund",
        direction: "credit",
        accountId,
        projectId: claim.projectId,
        executionId: execution.id,
        referenceId: refundId,
        reason,
        occurredOn: receivedAtDay,
        amountCents,
        actorUserId,
        actorRoles: roles
      });
      const refund = await tx.paymentExecutionRefund.create({
        data: {
          id: refundId,
          idempotencyKey,
          executionType: "expense_claim_payment_execution",
          expenseClaimPaymentExecutionId: execution.id,
          projectId: claim.projectId,
          accountId,
          fundRegistrationId: funding.registrationId,
          amountCents,
          receivedAt: new Date(`${receivedAtDay}T00:00:00.000Z`),
          reason,
          evidenceReference,
          recordedByUserId: actorUserId,
          payloadFingerprint: fingerprint
        }
      });
      const capacity = await this.projectionFor(tx, claim, 0n);
      await tx.expenseClaim.update({ where: { id: claim.id }, data: { status: capacity.status } });
      await this.audit.record(tx, {
        actorUserId,
        action: "incidental_expense.refund.record",
        businessType: "incidental_expense",
        businessId: claim.id,
        metadata: {
          refundId: refund.id,
          paymentExecutionId: execution.id,
          amountCents: amountCents.toString(),
          netPaidCents: capacity.netPaidCents.toString(),
          accountId
        }
      });
      return this.view(claim.id, execution.id, capacity, refund, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
