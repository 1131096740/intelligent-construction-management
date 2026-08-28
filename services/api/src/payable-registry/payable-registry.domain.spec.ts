import {
  assertPayableCanAcceptAllocation,
  derivePayableSettlementBalance
} from "./payable-registry.domain";

describe("payable registry settlement balance", () => {
  it("marks an upstream-corrected payable as over-settled and blocks a new allocation without rewriting payment history", () => {
    const balance = derivePayableSettlementBalance({
      effectiveAmountCents: 6_000n,
      validSettledAmountCents: 7_500n
    });

    expect(balance).toEqual({
      remainingPayableCents: 0n,
      overSettledAmountCents: 1_500n,
      settlementReconciliationRequired: true
    });
    expect(() => assertPayableCanAcceptAllocation(balance, 1n)).toThrow(
      "该应付已超额核销，必须先完成核对"
    );
  });
});
