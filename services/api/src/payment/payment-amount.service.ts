import { Injectable } from "@nestjs/common";

export interface PaymentCapacity {
  payableAmountCents: number;
  approvedPendingPaymentCents: number;
  paidAmountCents: number;
}

@Injectable()
export class PaymentAmountService {
  remainingCapacity(input: PaymentCapacity): number {
    return (
      input.payableAmountCents -
      input.approvedPendingPaymentCents -
      input.paidAmountCents
    );
  }

  assertCanRequest(input: PaymentCapacity, requestedAmountCents: number): void {
    const remaining = this.remainingCapacity(input);

    if (!Number.isInteger(requestedAmountCents) || requestedAmountCents <= 0) {
      throw new Error("付款申请金额必须为大于 0 的整数分");
    }

    if (requestedAmountCents > remaining) {
      throw new Error(
        `付款申请金额超过当前可申请余额，当前最多可申请 ${formatYuan(remaining)} 元`
      );
    }
  }
}

function formatYuan(amountCents: number) {
  return (Math.max(amountCents, 0) / 100).toFixed(2);
}
