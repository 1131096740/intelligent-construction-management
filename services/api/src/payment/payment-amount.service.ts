import { Injectable } from "@nestjs/common";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  moneyCentsToApi
} from "../money/decimal-money";

export interface PaymentCapacity {
  payableAmountCents: bigint;
  approvedPendingPaymentCents: bigint;
  paidAmountCents: bigint;
}

@Injectable()
export class PaymentAmountService {
  remainingCapacity(input: PaymentCapacity): string {
    return moneyCentsToApi(this.remainingCapacityBigInt(input));
  }

  remainingCapacityBigInt(input: PaymentCapacity): bigint {
    return (
      dbMoneyToBigInt(input.payableAmountCents, "应付金额") -
      dbMoneyToBigInt(input.approvedPendingPaymentCents, "已批待付金额") -
      dbMoneyToBigInt(input.paidAmountCents, "已付金额")
    );
  }

  assertCanRequest(input: PaymentCapacity, requestedAmountCents: bigint): void {
    if (requestedAmountCents <= 0n) {
      throw new Error("付款申请金额必须为大于 0 的整数分");
    }

    const requested = dbMoneyToBigInt(requestedAmountCents, "付款申请金额");
    const remaining = this.remainingCapacityBigInt(input);

    if (requested > remaining) {
      throw new Error(
        `付款申请金额超过当前可申请余额，当前最多可申请 ${formatMoneyCentsAsYuan(
          remaining > 0n ? remaining : 0n
        )} 元`
      );
    }
  }
}
