export type SpotProcurementPaymentExecutionFacts = {
  companyPaymentAmountCents: bigint;
  canceledCompanyPaymentAmountCents: bigint;
  paidAmountCents: bigint;
  supplierBalanceAmountCents: bigint;
  canceledSupplierBalanceAmountCents: bigint;
  executedSupplierBalanceAmountCents: bigint;
};

export function deriveSpotProcurementPaymentExecutionStatus(
  payment: SpotProcurementPaymentExecutionFacts
) {
  const effectiveCompanyAmountCents = nonnegative(
    payment.companyPaymentAmountCents -
      payment.canceledCompanyPaymentAmountCents
  );
  const effectiveSupplierBalanceAmountCents = nonnegative(
    payment.supplierBalanceAmountCents -
      payment.canceledSupplierBalanceAmountCents
  );
  const companyComplete =
    payment.paidAmountCents === effectiveCompanyAmountCents;
  const supplierBalanceComplete =
    payment.executedSupplierBalanceAmountCents ===
    effectiveSupplierBalanceAmountCents;

  if (companyComplete && supplierBalanceComplete) {
    if (
      effectiveCompanyAmountCents > 0n &&
      effectiveSupplierBalanceAmountCents === 0n
    ) {
      return "paid";
    }
    return "settled";
  }
  if (companyComplete && payment.paidAmountCents > 0n) {
    return "paid";
  }
  if (
    payment.paidAmountCents > 0n ||
    payment.executedSupplierBalanceAmountCents > 0n ||
    payment.canceledCompanyPaymentAmountCents > 0n ||
    payment.canceledSupplierBalanceAmountCents > 0n
  ) {
    return "partially_paid";
  }
  return "approved_pending_payment";
}

function nonnegative(value: bigint) {
  return value > 0n ? value : 0n;
}
