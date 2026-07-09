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
    ).toThrow("付款申请金额超过当前可申请余额，当前最多可申请 500.00 元");
  });

  it("rejects non-positive or decimal request amounts", () => {
    const capacity = {
      payableAmountCents: 100_000,
      approvedPendingPaymentCents: 0,
      paidAmountCents: 0
    };

    expect(() => service.assertCanRequest(capacity, 0)).toThrow(
      "付款申请金额必须为大于 0 的整数分"
    );
    expect(() => service.assertCanRequest(capacity, 1.5)).toThrow(
      "付款申请金额必须为大于 0 的整数分"
    );
  });
});
