import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { chinaDateOnly, requiredPastChinaDate } from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import type { ConfirmPaymentCorrectionDto, RequestPaymentCorrectionDto } from "./dto/request-payment-correction.dto";
import {
  correctionDeltaCents,
  netPaidAfterCorrection,
  paymentStatusForNetPaid,
  settlementStatusForNetPaid
} from "./payment-financial-facts";
import { appendPaymentFinancialFunding, readPaymentExecutionFundingAccount } from "./payment-financial-funding";

const REQUEST_ROLES = ["finance_staff", "finance_director", "comprehensive_director"] as const;

@Injectable()
export class PaymentCorrectionService {
  private readonly roles: CompanyRoleResolverService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService
  ) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  private async roleKeys(tx: Prisma.TransactionClient, actorUserId: string) {
    try {
      return await this.roles.resolveActiveRoleScopesInTransaction(tx, actorUserId);
    } catch {
      throw new ForbiddenException("当前资金岗位已失效，不能办理实付更正");
    }
  }

  private async requireRequestActor(tx: Prisma.TransactionClient, actorUserId: string) {
    const roles = await this.roleKeys(tx, actorUserId);
    if (!roles.some(role => (REQUEST_ROLES as readonly string[]).includes(role))) {
      throw new ForbiddenException("只有当前财务人员或综合部主管可以发起实付更正");
    }
    return roles;
  }

  private async requireDirector(tx: Prisma.TransactionClient, actorUserId: string) {
    const roles = await this.roleKeys(tx, actorUserId);
    if (!roles.includes("finance_director")) throw new ForbiddenException("只有当前财务主管可以确认实付更正");
    return roles;
  }

  private fingerprint(value: Record<string, unknown>) {
    return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  }

  async request(paymentId: string, executionId: string, actorUserId: string, input: RequestPaymentCorrectionDto) {
    const correctedAmountCents = parseMoneyCentsInput(input.correctedAmountCents, "更正后的金额", "更正后的金额必须按分填写为大于 0 的整数");
    if (correctedAmountCents <= 0n) throw new BadRequestException("更正后的实付金额必须大于 0");
    const correctionReason = input.correctionReason?.trim();
    if (!correctionReason) throw new BadRequestException("请填写更正原因");
    let correctedPaidAt: Date;
    try {
      correctedPaidAt = requiredPastChinaDate(input.correctedPaidAt, "更正后的付款日期");
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "更正后的付款日期不正确");
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException("请提供更正申请幂等键");

    return this.prisma.$transaction(async tx => {
      await this.requireRequestActor(tx, actorUserId);
      const payment = await tx.paymentRequest.findFirst({ where: { OR: [{ id: paymentId }, { code: paymentId }] } });
      if (!payment) throw new NotFoundException("付款申请不存在，请刷新付款详情");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${executionId} FOR UPDATE`);
      const execution = await tx.paymentExecution.findFirst({ where: { id: executionId, paymentRequestId: payment.id } });
      if (!execution) throw new NotFoundException("待更正的实付记录不存在，请刷新付款详情");
      const originalPaidAt = chinaDateOnly(execution.paidAt);
      const fingerprint = this.fingerprint({
        kind: "correction-request", paymentId: payment.id, executionId, actorUserId,
        correctedAmountCents: correctedAmountCents.toString(), correctedPaidAt: chinaDateOnly(correctedPaidAt), correctionReason
      });
      const existing = await tx.paymentExecutionCorrection.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.paymentExecutionId !== execution.id || existing.payloadFingerprint !== fingerprint) {
          throw new ConflictException("更正申请幂等键已用于不同请求，请查询原结果");
        }
        return this.view(tx, existing, true);
      }
      if (execution.amountCents === correctedAmountCents && originalPaidAt === chinaDateOnly(correctedPaidAt)) {
        throw new BadRequestException("更正后的金额和日期与原实付相同，无需更正");
      }
      const open = await tx.paymentExecutionCorrection.findFirst({ where: { paymentExecutionId: execution.id, status: "pending_confirm" } });
      if (open) throw new ConflictException("该实付已有待财务主管确认的更正，请先完成或等待处理");
      const approvedCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const nextPaid = netPaidAfterCorrection(payment.paidAmountCents, execution.amountCents, correctedAmountCents);
      if (nextPaid < 0n) throw new BadRequestException("更正后净已付不能为负数");
      if (nextPaid > approvedCents) {
        throw new BadRequestException(`更正后实付超过付款申请批复金额，当前最多可更正为 ${this.formatYuan(payment.paidAmountCents - execution.amountCents + approvedCents)} 元`);
      }
      const funding = await readPaymentExecutionFundingAccount(tx, execution.id);
      const amountDeltaCents = correctionDeltaCents(execution.amountCents, correctedAmountCents);
      const originalSnapshot = {
        entryKind: "original", executionId: execution.id, paymentRequestId: payment.id, projectId: payment.projectId,
        amountCents: moneyCentsToApi(execution.amountCents), paidAt: originalPaidAt,
        executedByUserId: execution.executedByUserId, companyEntityIdSnapshot: execution.companyEntityIdSnapshot,
        fundingAccountId: funding?.accountId ?? null, correctionOf: null
      };
      const reversalSnapshot = {
        entryKind: "reversal", executionId: execution.id, paymentRequestId: payment.id,
        amountCents: moneyCentsToApi(execution.amountCents), paidAt: originalPaidAt,
        reason: correctionReason, adjusts: "original"
      };
      const correctionSnapshot = {
        entryKind: "correction", executionId: execution.id, paymentRequestId: payment.id,
        amountCents: moneyCentsToApi(correctedAmountCents), paidAt: chinaDateOnly(correctedPaidAt),
        reason: correctionReason, adjusts: "original"
      };
      const correction = await tx.paymentExecutionCorrection.create({
        data: {
          idempotencyKey,
          paymentExecutionId: execution.id,
          paymentRequestId: payment.id,
          projectId: payment.projectId,
          status: "pending_confirm",
          correctionReason,
          originalAmountCents: execution.amountCents,
          correctedAmountCents,
          amountDeltaCents,
          originalPaidAt: execution.paidAt,
          correctedPaidAt,
          originalSnapshot,
          reversalSnapshot,
          correctionSnapshot,
          requestedByUserId: actorUserId,
          payloadFingerprint: fingerprint
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.execution.correction.request",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code, projectId: payment.projectId, executionId: execution.id,
          correctionId: correction.id, originalAmountCents: moneyCentsToApi(execution.amountCents),
          correctedAmountCents: moneyCentsToApi(correctedAmountCents), amountDeltaCents: moneyCentsToApi(amountDeltaCents),
          originalPaidAt, correctedPaidAt: chinaDateOnly(correctedPaidAt), correctionReason, idempotencyKey
        }
      });
      return this.view(tx, correction, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirm(correctionId: string, actorUserId: string, input: ConfirmPaymentCorrectionDto) {
    const confirmationKey = input.idempotencyKey?.trim();
    if (!confirmationKey) throw new BadRequestException("请提供更正确认幂等键");
    if (!input.confirmationPassword?.trim()) throw new BadRequestException("确认实付更正需要当前登录密码");

    return this.prisma.$transaction(async tx => {
      await this.requireDirector(tx, actorUserId);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecutionCorrection" WHERE "id" = ${correctionId} FOR UPDATE`);
      const correction = await tx.paymentExecutionCorrection.findUnique({ where: { id: correctionId } });
      if (!correction) throw new NotFoundException("实付更正记录不存在，请刷新后重试");
      if (correction.status === "confirmed") {
        if (correction.confirmationKey !== confirmationKey) throw new ConflictException("该实付更正已由其他确认动作完成");
        return this.view(tx, correction, true);
      }
      const execution = await tx.paymentExecution.findUniqueOrThrow({ where: { id: correction.paymentExecutionId } });
      const selfReview = correction.requestedByUserId === actorUserId || execution.executedByUserId === actorUserId;
      const selfReviewReason = input.selfReviewReason?.trim();
      if (selfReview && !selfReviewReason) {
        throw new BadRequestException("本人为实付创建人或更正发起人时，必须填写自审原因");
      }
      await this.auth.confirmPassword(actorUserId, input.confirmationPassword, tx);

      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentExecution" WHERE "id" = ${correction.paymentExecutionId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PaymentRequest" WHERE "id" = ${correction.paymentRequestId} FOR UPDATE`);
      const payment = await tx.paymentRequest.findUniqueOrThrow({ where: { id: correction.paymentRequestId } });
      const nextPaid = netPaidAfterCorrection(payment.paidAmountCents, correction.originalAmountCents, correction.correctedAmountCents);
      const approvedCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      if (nextPaid < 0n) throw new BadRequestException("更正后净已付不能为负数");
      if (nextPaid > approvedCents) throw new BadRequestException("更正后实付超过付款申请批复金额");
      let settlement: { id: string; payableAmountCents: bigint; paidAmountCents: bigint } | null = null;
      if (payment.settlementId) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${payment.settlementId} FOR UPDATE`);
        const row = await tx.settlement.findUnique({ where: { id: payment.settlementId }, select: { id: true, payableAmountCents: true, paidAmountCents: true } });
        if (row) settlement = row;
      }
      let settlementPaid: bigint | null = null;
      if (settlement) {
        settlementPaid = settlement.paidAmountCents + correction.amountDeltaCents;
        if (settlementPaid < 0n) throw new BadRequestException("更正后结算净已付不能为负数");
      }

      let fundRegistrationId: string | null = null;
      if (correction.amountDeltaCents !== 0n) {
        const funding = await readPaymentExecutionFundingAccount(tx, correction.paymentExecutionId);
        if (funding) {
          const result = await appendPaymentFinancialFunding(tx, {
            kind: "payment_correction",
            direction: correction.amountDeltaCents > 0n ? "debit" : "credit",
            accountId: funding.accountId,
            projectId: correction.projectId,
            executionId: correction.paymentExecutionId,
            referenceId: correction.id,
            reason: correction.correctionReason,
            occurredOn: chinaDateOnly(correction.correctedPaidAt),
            amountCents: correction.amountDeltaCents > 0n ? correction.amountDeltaCents : -correction.amountDeltaCents,
            actorUserId,
            actorRoles: [ "finance_director" ]
          });
          fundRegistrationId = result.registrationId;
        }
      }

      const confirmedAt = new Date();
      const updated = await tx.paymentExecutionCorrection.update({
        where: { id: correction.id },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt,
          confirmationKey,
          selfReviewReason: selfReviewReason ?? null,
          reviewNote: input.reviewNote?.trim() || null,
          fundRegistrationId
        }
      });
      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { paidAmountCents: nextPaid, status: paymentStatusForNetPaid(nextPaid, approvedCents) }
      });
      if (settlement && settlementPaid !== null) {
        await tx.settlement.update({
          where: { id: settlement.id },
          data: { paidAmountCents: settlementPaid, status: settlementStatusForNetPaid(settlementPaid, settlement.payableAmountCents) }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.execution.correction.confirm",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code, projectId: payment.projectId, executionId: correction.paymentExecutionId,
          correctionId: correction.id, originalAmountCents: moneyCentsToApi(correction.originalAmountCents),
          correctedAmountCents: moneyCentsToApi(correction.correctedAmountCents),
          amountDeltaCents: moneyCentsToApi(correction.amountDeltaCents),
          netPaidCents: moneyCentsToApi(nextPaid), selfReview, selfReviewReason: selfReviewReason ?? null,
          confirmedByUserId: actorUserId, confirmationKey, fundRegistrationId
        }
      });
      return this.view(tx, updated, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async read(correctionId: string, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      await this.roleKeys(tx, actorUserId);
      const correction = await tx.paymentExecutionCorrection.findUnique({ where: { id: correctionId } });
      if (!correction) throw new NotFoundException("实付更正记录不存在，请刷新后重试");
      return this.view(tx, correction, false);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listForPayment(paymentId: string, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      await this.roleKeys(tx, actorUserId);
      const payment = await tx.paymentRequest.findFirst({ where: { OR: [{ id: paymentId }, { code: paymentId }] } });
      if (!payment) throw new NotFoundException("付款申请不存在，请刷新付款详情");
      const rows = await tx.paymentExecutionCorrection.findMany({ where: { paymentRequestId: payment.id }, orderBy: { createdAt: "desc" } });
      return { paymentId: payment.id, items: await Promise.all(rows.map(row => this.view(tx, row, false))) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async view(tx: Prisma.TransactionClient, correction: {
    id: string; paymentExecutionId: string; paymentRequestId: string; status: string;
    originalAmountCents: bigint; correctedAmountCents: bigint; amountDeltaCents: bigint;
    originalPaidAt: Date; correctedPaidAt: Date; correctionReason: string; selfReviewReason: string | null;
    reviewNote: string | null; originalSnapshot: Prisma.JsonValue; reversalSnapshot: Prisma.JsonValue;
    correctionSnapshot: Prisma.JsonValue; requestedByUserId: string; confirmedByUserId: string | null;
    confirmedAt: Date | null; fundRegistrationId: string | null; createdAt: Date;
  }, idempotent: boolean) {
    const payment = await tx.paymentRequest.findUniqueOrThrow({ where: { id: correction.paymentRequestId }, select: { paidAmountCents: true, status: true, code: true } });
    return {
      correctionId: correction.id,
      paymentId: correction.paymentRequestId,
      code: payment.code,
      executionId: correction.paymentExecutionId,
      status: correction.status,
      originalAmountCents: moneyCentsToApi(correction.originalAmountCents),
      correctedAmountCents: moneyCentsToApi(correction.correctedAmountCents),
      amountDeltaCents: moneyCentsToApi(correction.amountDeltaCents),
      originalPaidAt: chinaDateOnly(correction.originalPaidAt),
      correctedPaidAt: chinaDateOnly(correction.correctedPaidAt),
      correctionReason: correction.correctionReason,
      selfReviewReason: correction.selfReviewReason,
      reviewNote: correction.reviewNote,
      originalSnapshot: correction.originalSnapshot,
      reversalSnapshot: correction.reversalSnapshot,
      correctionSnapshot: correction.correctionSnapshot,
      requestedByUserId: correction.requestedByUserId,
      confirmedByUserId: correction.confirmedByUserId,
      confirmedAt: correction.confirmedAt?.toISOString() ?? null,
      fundRegistrationId: correction.fundRegistrationId,
      netPaidCents: moneyCentsToApi(payment.paidAmountCents),
      paymentStatus: payment.status,
      createdAt: correction.createdAt.toISOString(),
      idempotent
    };
  }

  private formatYuan(cents: bigint) {
    const negative = cents < 0n;
    const absolute = negative ? -cents : cents;
    return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
  }
}
