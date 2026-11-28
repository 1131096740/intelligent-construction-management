import { createHash } from "node:crypto";

/** 退款、更正共用的纯计算：不依赖 Prisma，便于用独立手算例验证。 */

export function remainingRefundableCents(
  executionAmountCents: bigint,
  refundedCents: bigint
): bigint {
  return executionAmountCents - refundedCents;
}

export function netPaidAfterRefund(paidAmountCents: bigint, amountCents: bigint): bigint {
  return paidAmountCents - amountCents;
}

export function netPaidAfterCorrection(
  currentPaidAmountCents: bigint,
  originalAmountCents: bigint,
  correctedAmountCents: bigint
): bigint {
  return currentPaidAmountCents - originalAmountCents + correctedAmountCents;
}

export function correctionDeltaCents(
  originalAmountCents: bigint,
  correctedAmountCents: bigint
): bigint {
  return correctedAmountCents - originalAmountCents;
}

export type PaymentRequestNetPaidStatus =
  | "approved_pending_payment"
  | "partially_paid"
  | "paid";

/** 已付按净额推进；退款后未付部分重新出现，但不伪造新的付款事实。 */
export function paymentStatusForNetPaid(
  netPaidCents: bigint,
  approvedAmountCents: bigint
): PaymentRequestNetPaidStatus {
  if (netPaidCents <= 0n) return "approved_pending_payment";
  return netPaidCents >= approvedAmountCents ? "paid" : "partially_paid";
}

export type SettlementNetPaidStatus = "effective" | "partially_paid" | "paid";

export function settlementStatusForNetPaid(
  netPaidCents: bigint,
  payableAmountCents: bigint
): SettlementNetPaidStatus {
  if (netPaidCents <= 0n) return "effective";
  return netPaidCents >= payableAmountCents ? "paid" : "partially_paid";
}

export function centsFingerprint(value: {
  kind: "refund" | "correction";
  idempotencyKey: string;
  paymentExecutionId: string;
  amountCents: string;
  occurredAt: string;
  actorUserId: string;
  [key: string]: unknown;
}): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
