import { centsToSafeNumber } from "../money/decimal-money";

export const SETTLEMENT_CAPACITY_PAYMENT_STATUSES = [
  "approval_pending",
  "in_approval",
  "approved_pending_payment",
  "partially_paid"
] as const;

export interface SettlementCapacityPaymentRequest {
  status: string;
  requestedAmountCents: number;
  approvedAmountCents?: number | null;
  paidAmountCents: number;
}

export interface SettlementPaymentCapacity {
  outstandingPaymentCents: number;
  occupiedCents: number;
  remainingCents: number;
}

export function calculateSettlementPaymentCapacity(input: {
  payableAmountCents: number;
  actualPaidAmountCents: number;
  proxyPaidAmountCents: number;
  paymentRequests: readonly SettlementCapacityPaymentRequest[];
}): SettlementPaymentCapacity {
  const outstandingPaymentCents = input.paymentRequests.reduce<bigint>(
    (total, payment) => total + BigInt(outstandingPaymentRequestCents(payment)),
    0n
  );
  const occupiedCents =
    BigInt(input.actualPaidAmountCents) +
    BigInt(input.proxyPaidAmountCents) +
    outstandingPaymentCents;
  const remainingCents = BigInt(input.payableAmountCents) - occupiedCents;

  return {
    outstandingPaymentCents: centsToSafeNumber(outstandingPaymentCents),
    occupiedCents: centsToSafeNumber(occupiedCents),
    remainingCents: centsToSafeNumber(remainingCents)
  };
}

export function sumSafeCents(values: Array<bigint | number>): number {
  return centsToSafeNumber(
    values.reduce<bigint>((total, value) => total + BigInt(value), 0n)
  );
}

function outstandingPaymentRequestCents(payment: SettlementCapacityPaymentRequest): number {
  if (["approval_pending", "in_approval"].includes(payment.status)) {
    return Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0);
  }

  if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
    return Math.max(
      (payment.approvedAmountCents ?? payment.requestedAmountCents) - payment.paidAmountCents,
      0
    );
  }

  return 0;
}
