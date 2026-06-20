import { PaymentAmountService } from "./payment-amount.service";

describe("PaymentAmountService", () => {
  const service = new PaymentAmountService();

  it("allows a request within remaining payable amount", () => {
    expect(() =>
      service.assertCanRequest(
        {
          payableAmountCents: 100_000,
          approvedPendingPaymentCents: 20_000,
          paidAmountCents: 30_000
        },
        50_000
      )
    ).not.toThrow();
  });

  it("rejects over-requesting against settlement capacity", () => {
    expect(() =>
      service.assertCanRequest(
        {
          payableAmountCents: 100_000,
          approvedPendingPaymentCents: 20_000,
          paidAmountCents: 30_000
        },
        50_001
      )
    ).toThrow("exceeds remaining settlement capacity");
  });

  it("rejects non-positive or decimal request amounts", () => {
    const capacity = {
      payableAmountCents: 100_000,
      approvedPendingPaymentCents: 0,
      paidAmountCents: 0
    };

    expect(() => service.assertCanRequest(capacity, 0)).toThrow(
      "Payment request amount must be positive cents"
    );
    expect(() => service.assertCanRequest(capacity, 1.5)).toThrow(
      "Payment request amount must be positive cents"
    );
  });
});
