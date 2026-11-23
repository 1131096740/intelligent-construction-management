import { summarizeTakeoverMoney } from "./contract-takeover-money-summary";

describe("historical takeover money summary", () => {
  it("shows 70 paid against 60 settled as a 10 overpayment pending verification", () => {
    const summary = summarizeTakeoverMoney({
      relationship: "outside",
      paidCents: 7_000n,
      settledCents: 6_000n
    });

    expect(summary.historicalPaidCents).toBe(7_000n);
    expect(summary.historicalSettledCents).toBe(6_000n);
    expect(summary.historicalOverpaidCents).toBe(1_000n);
    expect(summary.historicalOverpaymentKind).toBe("pending_verification");
    expect(summary.historicalOverpaymentLabel).toBe("超付，性质待核对");
    expect(summary.historicalOverReceivedCents).toBe(0n);
  });

  it("labels a verified agreed advance as an unsettled advance instead of an error", () => {
    expect(
      summarizeTakeoverMoney({
        relationship: "outside",
        paidCents: 7_000n,
        settledCents: 6_000n,
        excessTreatment: "historical_advance"
      })
    ).toMatchObject({
      historicalOverpaidCents: 1_000n,
      historicalOverpaymentKind: "unsettled_advance",
      historicalOverpaymentLabel: "未结算预付款"
    });
  });

  it("keeps upward receipts as a fact and only asks for verification when over-received", () => {
    const summary = summarizeTakeoverMoney({
      relationship: "upward",
      paidCents: 7_000n,
      settledCents: 6_000n
    });

    expect(summary.historicalReceiptsCents).toBe(7_000n);
    expect(summary.historicalOverReceivedCents).toBe(1_000n);
    expect(summary.historicalOverReceivedPendingVerification).toBe(true);
    expect(summary.historicalOverpaidCents).toBe(0n);
    expect(summary).not.toHaveProperty("refundCents");
    expect(summary).not.toHaveProperty("automaticRefund");
  });

  it("keeps a missing historical record unclassified instead of inventing a zero", () => {
    const summary = summarizeTakeoverMoney({
      relationship: "inside",
      paidCents: 0n,
      settledCents: 6_000n
    });

    expect(summary.historicalOverpaidCents).toBe(0n);
    expect(summary.historicalOverpaymentKind).toBe("none");
    expect(summary.historicalOverpaymentLabel).toBe("未超付");
  });
});
