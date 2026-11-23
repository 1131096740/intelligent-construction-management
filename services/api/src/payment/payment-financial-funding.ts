import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import {
  assertPublicCashCustodian
} from "../fund-account/public-cash-custodian";
import { availableRegisteredBalance, RegisteredBalanceDecimal } from "./registered-payment-funding";

const decimal = Prisma.Decimal.clone({ precision: 50 });

export interface PaymentFinancialFundingInput {
  kind: "payment_refund" | "payment_correction";
  direction: "credit" | "debit";
  accountId: string | null;
  projectId: string;
  executionId: string;
  referenceId: string;
  reason: string;
  occurredOn: string;
  amountCents: bigint;
  actorUserId: string;
  actorRoles: readonly string[];
}

/**
 * 退款/更正对“实际收款的公司资金或公共现金”的直接登记。
 * 退款是资金回流（credit）；更正净额下降同样回流，净额上升则补扣（debit）。
 * 只追加已确认登记与来源快照，不修改原付款的登记记录。
 */
export async function appendPaymentFinancialFunding(
  tx: Prisma.TransactionClient,
  input: PaymentFinancialFundingInput
): Promise<{ accountId: string; registrationId: string }> {
  if (input.amountCents <= 0n) throw new BadRequestException("退款或更正的资金金额必须大于 0");
  if (!input.accountId) throw new BadRequestException("请选择实际收款的资金账户");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.occurredOn)) throw new BadRequestException("实际收款日期格式不正确");
  const account = await tx.registeredFundAccount.findUnique({ where: { id: input.accountId }, include: { company: true } });
  if (!account) throw new NotFoundException("实际收款的资金账户不存在，请先核对资金登记");
  if (account.kind === "company" && (!account.company || !account.company.isActive)) {
    throw new ConflictException("实际收款的公司账户已停用，不能登记退款或更正");
  }
  const financeRole = input.actorRoles.some(role => role === "finance_staff" || role === "finance_director");
  if (account.kind === "public_cash" && !financeRole) await assertPublicCashCustodian(tx, account.id, input.actorUserId);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RegisteredFundAccount" WHERE "id" = ${account.id} FOR UPDATE`);
  const current = await tx.fundAccountBalanceRegistration.findFirst({
    where: { accountId: account.id, status: "confirmed" },
    orderBy: { version: "desc" },
    include: { sources: true }
  });
  if (!current || current.balanceYuan === null) {
    throw new ConflictException("资金账户尚未核对登记余额，不能直接登记退款或更正");
  }
  const amountYuan = new RegisteredBalanceDecimal(input.amountCents.toString()).div(100);
  const available = await availableRegisteredBalance(tx, current);
  if (input.direction === "debit") {
    if (available.balanceYuan === null || available.balanceYuan.lt(amountYuan)) {
      throw new ConflictException("资金账户可用余额不足，请先核对实际资金");
    }
  }
  const balanceYuan = input.direction === "credit"
    ? new RegisteredBalanceDecimal(current.balanceYuan.toFixed(4)).plus(amountYuan)
    : new RegisteredBalanceDecimal(current.balanceYuan.toFixed(4)).minus(amountYuan);
  if (balanceYuan.lt(0)) throw new ConflictException("更正后资金账户余额不能为负数");

  const touched = await tx.registeredFundAccount.updateMany({
    where: { id: account.id, writeRevision: account.writeRevision },
    data: { writeRevision: account.writeRevision + 1 }
  });
  if (touched.count !== 1) throw new ConflictException("资金登记已变化，请刷新后重试");

  const latest = await tx.fundAccountBalanceRegistration.findFirstOrThrow({
    where: { accountId: account.id },
    orderBy: { version: "desc" }
  });
  const label = input.kind === "payment_refund" ? "退款回补" : "付款更正回补";
  const fingerprint = createHash("sha256").update(JSON.stringify({
    kind: input.kind, direction: input.direction, accountId: account.id, executionId: input.executionId,
    referenceId: input.referenceId, amountCents: input.amountCents.toString(), occurredOn: input.occurredOn,
    actorUserId: input.actorUserId
  }), "utf8").digest("hex");
  const registration = await tx.fundAccountBalanceRegistration.create({
    data: {
      id: randomUUID(),
      kind: input.kind,
      status: "confirmed",
      accountId: account.id,
      previousRegistrationId: current.id,
      version: latest.version + 1,
      balanceYuan,
      coveredExecutionIds: current.coveredExecutionIds,
      asOfDate: input.occurredOn,
      evidenceReference: `${input.kind}:${input.referenceId}`,
      reconciliationNote: input.kind === "payment_refund" ? "按原实付关联登记实际收到的退款" : "按财务更正确认结果重算实际付款资金",
      reason: input.reason,
      idempotencyKey: `${input.kind}:${input.referenceId}`,
      payloadFingerprint: fingerprint,
      createdByUserId: input.actorUserId,
      confirmedByUserId: input.actorUserId,
      confirmedAt: new Date()
    }
  });

  const lines: Array<{
    registrationId: string;
    lineNo: number;
    previousSourceBatchId: string | null;
    sourceStatus: string;
    sourceName: string | null;
    projectStatus: string;
    projectId: string | null;
    amountYuan: Prisma.Decimal;
  }> = current.sources.map(source => ({
    registrationId: registration.id,
    lineNo: source.lineNo,
    previousSourceBatchId: source.id,
    sourceStatus: source.sourceStatus,
    sourceName: source.sourceName,
    projectStatus: source.projectStatus,
    projectId: source.projectId,
    amountYuan: source.amountYuan
  }));
  if (input.direction === "credit") {
    lines.push({
      registrationId: registration.id,
      lineNo: Math.max(0, ...current.sources.map(source => source.lineNo)) + 1,
      previousSourceBatchId: null,
      sourceStatus: "known",
      sourceName: label,
      projectStatus: "project",
      projectId: input.projectId,
      amountYuan
    });
  } else {
    let remaining = amountYuan;
    for (const line of lines) {
      if (remaining.lte(0)) break;
      const availableYuan = new RegisteredBalanceDecimal(line.amountYuan.toFixed(4));
      if (availableYuan.lte(0)) continue;
      const take = availableYuan.lt(remaining) ? availableYuan : remaining;
      line.amountYuan = availableYuan.minus(take);
      remaining = remaining.minus(take);
    }
    if (remaining.gt(0)) throw new ConflictException("资金来源不足以冲减本次更正，请先核对资金登记");
  }
  await tx.fundAccountSourceBatch.createMany({ data: lines });
  return { accountId: account.id, registrationId: registration.id };
}

/** 供服务读取原实付关联的登记资金账户；旧实付没有登记资金时返回 null。 */
export async function readPaymentExecutionFundingAccount(
  tx: Prisma.TransactionClient,
  executionId: string
): Promise<{ accountId: string } | null> {
  const funding = await tx.registeredPaymentFunding.findUnique({
    where: { executionId },
    select: { accountId: true }
  });
  return funding ? { accountId: funding.accountId } : null;
}

export function paymentOccurredOn(value: Date): string {
  return chinaDateOnly(value);
}

export function moneyToDecimal(cents: bigint): Prisma.Decimal {
  return new decimal(cents.toString()).div(100);
}

void moneyToDecimal;
void ForbiddenException;
