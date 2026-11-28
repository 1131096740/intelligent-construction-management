import {
  correctionDeltaCents,
  netPaidAfterCorrection,
  netPaidAfterRefund,
  paymentStatusForNetPaid,
  remainingRefundableCents,
  settlementStatusForNetPaid
} from "./payment-financial-facts";

describe("payment financial facts", () => {
  it("shows original paid 10, refund 2 and net paid 8 without rewriting the original payment", () => {
    expect(netPaidAfterRefund(1000n, 200n)).toBe(800n);
    expect(remainingRefundableCents(1000n, 200n)).toBe(800n);
  });

  it("rejects refunds that exceed the original payment or the current net paid amount", () => {
    expect(remainingRefundableCents(1000n, 1000n)).toBe(0n);
    expect(remainingRefundableCents(1000n, 1001n)).toBe(-1n);
    expect(netPaidAfterRefund(800n, 900n)).toBe(-100n);
  });

  it("reopens the payment request after a refund while keeping paid status when still fully paid", () => {
    expect(paymentStatusForNetPaid(800n, 1000n)).toBe("partially_paid");
    expect(paymentStatusForNetPaid(1000n, 1000n)).toBe("paid");
    expect(paymentStatusForNetPaid(0n, 1000n)).toBe("approved_pending_payment");
    expect(paymentStatusForNetPaid(1200n, 1000n)).toBe("paid");
  });

  it("returns the settlement to effective when a refund removes all paid amount", () => {
    expect(settlementStatusForNetPaid(0n, 1000n)).toBe("effective");
    expect(settlementStatusForNetPaid(1n, 1000n)).toBe("partially_paid");
    expect(settlementStatusForNetPaid(1000n, 1000n)).toBe("paid");
  });

  it("uses the signed corrected amount delta for reversal and re-registration", () => {
    expect(correctionDeltaCents(1000n, 800n)).toBe(-200n);
    expect(correctionDeltaCents(800n, 1000n)).toBe(200n);
    expect(netPaidAfterCorrection(1000n, 1000n, 800n)).toBe(800n);
    expect(netPaidAfterCorrection(1000n, 800n, 1000n)).toBe(1200n);
  });

  it("keeps a paid 10 with a 2 correction on a different execution independent", () => {
    // 1000 + 500 gross paid, correcting the first execution to 800 leaves 1300.
    const currentPaid = 1500n;
    expect(netPaidAfterCorrection(currentPaid, 1000n, 800n)).toBe(1300n);
  });
});
