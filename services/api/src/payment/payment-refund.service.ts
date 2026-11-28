import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { chinaDateOnly, requiredPastChinaDate } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import type { RecordPaymentRefundDto } from "./dto/record-payment-refund.dto";
import {
  netPaidAfterRefund,
  paymentStatusForNetPaid,
  remainingRefundableCents,
  settlementStatusForNetPaid
} from "./payment-financial-facts";
import { appendPaymentFinancialFunding, readPaymentExecutionFundingAccount } from "./payment-financial-funding";

const FINANCE_FACT_ROLES = ["finance_staff", "finance_director", "comprehensive_director"] as const;

function refundRejected(message: string) {
  return new ConflictException({ code: "PAYMENT_REFUND_REJECTED", message });
}

@Injectable()
export class PaymentRefundService {
  private readonly roles: CompanyRoleResolverService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  private async requireFinanceActor(tx: Prisma.TransactionClient, actorUserId: string) {
    let roles: string[];
    try {
      roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actorUserId);
    } catch {
      throw new ForbiddenException("当前资金岗位已失效，不能登记退款");
    }
    if (!roles.some(role => (FINANCE_FACT_ROLES as readonly string[]).includes(role))) {
      throw new ForbiddenException("只有当前财务人员或综合部主管可以登记实际收到的退款");
    }
    return roles;
  }

  private async loadPayment(tx: Prisma.TransactionClient, paymentId: string) {
    const payment = await tx.paymentRequest.findFirst({
      where: { OR: [{ id: paymentId }, { code: paymentId }] }
    });
    if (!payment) throw new NotFoundException("付款申请不存在，请刷新付款台账");
    return payment;
  }

  private async executionAggregates(tx: Prisma.TransactionClient, paymentId: string) {
    const executions = await tx.paymentExecution.findMany({
      where: { paymentRequestId: paymentId },
      select: { id: true, amountCents: true, paidAt: true }
    });
    const refunds = await tx.paymentExecutionRefund.findMany({
      where: { paymentRequestId: paymentId, executionType: "payment_execution" },
      select: { id: true, paymentExecutionId: true, amountCents: true, receivedAt: true, accountId: true, fundRegistrationId: true }
    });
    return { executions, refunds };
  }

  async capability(paymentId: string, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      const roles = await this.requireFinanceActor(tx, actorUserId);
      const payment = await this.loadPayment(tx, paymentId);
      const { executions, refunds } = await this.executionAggregates(tx, payment.id);
      const refundedByExecution = new Map<string, bigint>();
      for (const refund of refunds) {
        if (!refund.paymentExecutionId) continue;
        refundedByExecution.set(refund.paymentExecutionId, (refundedByExecution.get(refund.paymentExecutionId) ?? 0n) + refund.amountCents);
      }
      const refundedCents = refunds.reduce((sum, refund) => sum + refund.amountCents, 0n);
      return {
        paymentId: payment.id,
        code: payment.code,
        status: payment.status,
        approvedAmountCents: moneyCentsToApi(payment.approvedAmountCents ?? payment.requestedAmountCents),
        paidAmountCents: moneyCentsToApi(payment.paidAmountCents),
        refundedCents: moneyCentsToApi(refundedCents),
        netPaidCents: moneyCentsToApi(payment.paidAmountCents),
        canRefund: payment.paidAmountCents > 0n,
        canCorrect: roles.some(role => ["finance_staff", "finance_director", "comprehensive_director"].includes(role)),
        canConfirmCorrection: roles.includes("finance_director"),
        executions: executions.map(execution => {
          const refunded = refundedByExecution.get(execution.id) ?? 0n;
          return {
            executionId: execution.id,
            paidAt: chinaDateOnly(execution.paidAt),
            amountCents: moneyCentsToApi(execution.amountCents),
            refundedCents: moneyCentsToApi(refunded),
            refundableCents: moneyCentsToApi(remainingRefundableCents(execution.amountCents, refunded) > 0n ? remainingRefundableCents(execution.amountCents, refunded) : 0n)
          };
        }),
        roles
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordRefund(paymentId: string, executionId: string, actorUserId: string, input: RecordPaymentRefundDto) {
    const amountCents = parseMoneyCentsInput(input.amountCents, "退款金额", "退款金额必须按分填写为大于 0 的整数");
    if (amountCents <= 0n) throw new BadRequestException("退款金额必须大于 0");
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("请填写退款原因");
    let receivedAt: Date;
    try {
      receivedAt = requiredPastChinaDate(input.receivedAt, "退款到账日期");
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "退款到账日期不正确");
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException("请提供退款登记幂等键");

    try {
      return await this.prisma.$transaction(async tx => {
        const roles = await this.requireFinanceActor(tx, actorUserId);
        const payment = await this.loadPayment(tx, paymentId);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${executionId} FOR UPDATE`);
        const execution = await tx.paymentExecution.findFirst({
          where: { id: executionId, paymentRequestId: payment.id }
        });
        if (!execution) throw new NotFoundException("待退款的实付记录不存在，请刷新付款详情");
        const fingerprint = this.fingerprint({ kind: "refund", paymentId: payment.id, executionId, actorUserId, amountCents: amountCents.toString(), receivedAt: chinaDateOnly(receivedAt), reason, accountId: input.accountId ?? null });
        const existing = await tx.paymentExecutionRefund.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.paymentExecutionId !== execution.id || existing.payloadFingerprint !== fingerprint) {
            throw new ConflictException("退款登记幂等键已用于不同请求，请查询原结果");
          }
          return this.refundView(tx, existing, true);
        }
        if (payment.paidAmountCents <= 0n) throw new BadRequestException("该付款申请当前没有可退净已付金额");
        if (amountCents > payment.paidAmountCents) {
          throw new BadRequestException(`退款金额超过当前净已付，最多可退 ${this.formatYuan(payment.paidAmountCents)} 元`);
        }
        const refunded = await tx.paymentExecutionRefund.aggregate({
          where: { paymentExecutionId: execution.id },
          _sum: { amountCents: true }
        });
        const alreadyRefunded = refunded._sum.amountCents ?? 0n;
        if (amountCents > remainingRefundableCents(execution.amountCents, alreadyRefunded)) {
          throw new BadRequestException(`累计退款不得超过原实付 ${this.formatYuan(execution.amountCents)} 元，当前最多可退 ${this.formatYuan(remainingRefundableCents(execution.amountCents, alreadyRefunded) > 0n ? remainingRefundableCents(execution.amountCents, alreadyRefunded) : 0n)} 元`);
        }
        const funding = await readPaymentExecutionFundingAccount(tx, execution.id);
        const accountId = input.accountId ?? funding?.accountId ?? null;
        if (!accountId) throw new BadRequestException("请选择实际收款的资金账户");

        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${payment.id} FOR UPDATE`);
        const currentPayment = await tx.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
        const newPaidCents = netPaidAfterRefund(currentPayment.paidAmountCents, amountCents);
        if (newPaidCents < 0n) throw new BadRequestException("退款金额超过当前净已付，请刷新后重试");
        const approvedCents = currentPayment.approvedAmountCents ?? currentPayment.requestedAmountCents;
        const newStatus = paymentStatusForNetPaid(newPaidCents, approvedCents);

        let settlement: { id: string; payableAmountCents: bigint; paidAmountCents: bigint } | null = null;
        if (currentPayment.settlementId) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${currentPayment.settlementId} FOR UPDATE`);
          const row = await tx.settlement.findUnique({ where: { id: currentPayment.settlementId }, select: { id: true, payableAmountCents: true, paidAmountCents: true } });
          if (row) settlement = row;
        }
        if (settlement && amountCents > settlement.paidAmountCents) {
          throw refundRejected("退款金额超过结算当前净已付，请核对原付款与结算记录");
        }

        const refundId = randomUUID();
        const fundingResult = await appendPaymentFinancialFunding(tx, {
          kind: "payment_refund",
          direction: "credit",
          accountId,
          projectId: payment.projectId,
          executionId: execution.id,
          referenceId: refundId,
          reason,
          occurredOn: chinaDateOnly(receivedAt),
          amountCents,
          actorUserId,
          actorRoles: roles
        });
        const refund = await tx.paymentExecutionRefund.create({
          data: {
            id: refundId,
            idempotencyKey,
            paymentExecutionId: execution.id,
            paymentRequestId: payment.id,
            projectId: payment.projectId,
            accountId,
            fundRegistrationId: fundingResult.registrationId,
            amountCents,
            receivedAt,
            reason,
            evidenceReference: input.evidenceReference?.trim() || null,
            recordedByUserId: actorUserId,
            payloadFingerprint: fingerprint
          }
        });
        await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { paidAmountCents: newPaidCents, status: newStatus }
        });
        if (settlement) {
          const newSettlementPaid = settlement.paidAmountCents - amountCents;
          await tx.settlement.update({
            where: { id: settlement.id },
            data: {
              paidAmountCents: newSettlementPaid,
              status: settlementStatusForNetPaid(newSettlementPaid, settlement.payableAmountCents)
            }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "payment.execution.refund",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            projectId: payment.projectId,
            executionId: execution.id,
            refundId: refund.id,
            amountCents: moneyCentsToApi(amountCents),
            receivedAt: chinaDateOnly(receivedAt),
            accountId,
            fundRegistrationId: fundingResult.registrationId,
            originalPaidCents: moneyCentsToApi(execution.amountCents),
            netPaidCents: moneyCentsToApi(newPaidCents),
            refundedCents: moneyCentsToApi(alreadyRefunded + amountCents),
            idempotencyKey
          }
        });
        return this.refundView(tx, refund, false);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      const message = error instanceof Error ? error.message : "";
      if (message.includes("payment_execution_refund_cap_exceeded")) throw new BadRequestException("累计退款不得超过原实付");
      if (message.includes("payment_execution_refund_before_payment")) throw new BadRequestException("退款到账日期不能早于原付款日期");
      if (message.includes("payment_execution_refund_future_date")) throw new BadRequestException("退款到账日期不能晚于当前日期");
      if (message.includes("payment_execution_refund_is_append_only")) throw refundRejected("退款事实不可修改或删除");
      throw error;
    }
  }

  private async refundView(tx: Prisma.TransactionClient, refund: {
    id: string; paymentExecutionId: string | null; paymentRequestId: string | null; amountCents: bigint;
    receivedAt: Date; accountId: string | null; fundRegistrationId: string | null;
  }, idempotent: boolean) {
    if (!refund.paymentExecutionId || !refund.paymentRequestId) throw new ConflictException("退款事实关联不完整，请核对原实付");
    const [execution, refunds, payment] = await Promise.all([
      tx.paymentExecution.findUniqueOrThrow({ where: { id: refund.paymentExecutionId }, select: { id: true, amountCents: true } }),
      tx.paymentExecutionRefund.aggregate({ where: { paymentExecutionId: refund.paymentExecutionId }, _sum: { amountCents: true } }),
      tx.paymentRequest.findUniqueOrThrow({ where: { id: refund.paymentRequestId }, select: { paidAmountCents: true, status: true, code: true } })
    ]);
    return {
      refundId: refund.id,
      paymentId: refund.paymentRequestId,
      code: payment.code,
      executionId: execution.id,
      amountCents: moneyCentsToApi(refund.amountCents),
      receivedAt: chinaDateOnly(refund.receivedAt),
      accountId: refund.accountId,
      fundRegistrationId: refund.fundRegistrationId,
      originalPaidCents: moneyCentsToApi(execution.amountCents),
      refundedCents: moneyCentsToApi(refunds._sum.amountCents ?? 0n),
      netPaidCents: moneyCentsToApi(payment.paidAmountCents),
      status: payment.status,
      idempotent
    };
  }

  private fingerprint(value: Record<string, unknown>) {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  }

  private formatYuan(cents: bigint) {
    const negative = cents < 0n;
    const absolute = negative ? -cents : cents;
    const yuan = absolute / 100n;
    const fraction = (absolute % 100n).toString().padStart(2, "0");
    return `${negative ? "-" : ""}${yuan}.${fraction}`;
  }
}
