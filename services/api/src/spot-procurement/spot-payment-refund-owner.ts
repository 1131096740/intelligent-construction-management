export type SpotPaymentRefundOwnerCandidate = {
  id: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  createdAt: Date;
};

export function spotPaymentRefundOwnerId(
  discrepancy: {
    procurementId: string;
    procurementVersionId: string;
  },
  payments: readonly SpotPaymentRefundOwnerCandidate[]
) {
  const refundSettlementStatuses = new Set([
    "partially_paid",
    "paid",
    "settled"
  ]);
  return [...payments]
    .filter(
      (payment) =>
        payment.procurementId === discrepancy.procurementId &&
        payment.procurementVersionId === discrepancy.procurementVersionId
    )
    .sort((left, right) => {
      const leftPriority = refundSettlementStatuses.has(left.status)
        ? 2
        : ["voided", "invalidated"].includes(left.status)
          ? 0
          : 1;
      const rightPriority = refundSettlementStatuses.has(right.status)
        ? 2
        : ["voided", "invalidated"].includes(right.status)
          ? 0
          : 1;
      return (
        rightPriority - leftPriority ||
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id)
      );
    })[0]?.id ?? null;
}
