import { deriveSpotProcurementPaymentExecutionStatus } from "./spot-procurement-payment-status";

const base = {
  companyPaymentAmountCents: 6_000n,
  canceledCompanyPaymentAmountCents: 0n,
  paidAmountCents: 0n,
  supplierBalanceAmountCents: 4_000n,
  canceledSupplierBalanceAmountCents: 0n,
  executedSupplierBalanceAmountCents: 0n
};

describe("deriveSpotProcurementPaymentExecutionStatus", () => {
  it.each([
    ["approved_pending_payment", base],
    [
      "partially_paid",
      { ...base, executedSupplierBalanceAmountCents: 4_000n }
    ],
    ["paid", { ...base, paidAmountCents: 6_000n }],
    [
      "paid",
      {
        ...base,
        companyPaymentAmountCents: 10_000n,
        paidAmountCents: 10_000n,
        supplierBalanceAmountCents: 0n
      }
    ],
    [
      "settled",
      {
        ...base,
        paidAmountCents: 6_000n,
        executedSupplierBalanceAmountCents: 4_000n
      }
    ],
    [
      "settled",
      {
        ...base,
        canceledCompanyPaymentAmountCents: 6_000n,
        canceledSupplierBalanceAmountCents: 4_000n
      }
    ],
    [
      "settled",
      {
        ...base,
        canceledCompanyPaymentAmountCents: 1_000n,
        paidAmountCents: 5_000n,
        canceledSupplierBalanceAmountCents: 1_000n,
        executedSupplierBalanceAmountCents: 3_000n
      }
    ]
  ])("derives %s from independent execution facts", (status, facts) => {
    expect(
      deriveSpotProcurementPaymentExecutionStatus(facts)
    ).toBe(status);
  });
});
