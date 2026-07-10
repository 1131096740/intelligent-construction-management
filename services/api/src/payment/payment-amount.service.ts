import { Injectable } from "@nestjs/common";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  moneyCentsToLegacyApiNumber
} from "../money/decimal-money";

export interface PaymentCapacity {
  payableAmountCents: number | bigint;
  approvedPendingPaymentCents: number | bigint;
  paidAmountCents: number | bigint;
}

@Injectable()
export class PaymentAmountService {
  remainingCapacity(input: PaymentCapacity): number {
    return moneyCentsToLegacyApiNumber(
      this.remainingCapacityBigInt(input),
      "当前可申请余额"
    );
  }

  remainingCapacityBigInt(input: PaymentCapacity): bigint {
    return (
      dbMoneyToBigInt(input.payableAmountCents, "应付金额") -
      dbMoneyToBigInt(input.approvedPendingPaymentCents, "已批待付金额") -
      dbMoneyToBigInt(input.paidAmountCents, "已付金额")
    );
  }

  assertCanRequest(input: PaymentCapacity, requestedAmountCents: number | bigint): void {
    if (
      (typeof requestedAmountCents === "number" &&
        (!Number.isSafeInteger(requestedAmountCents) || requestedAmountCents <= 0)) ||
      (typeof requestedAmountCents === "bigint" && requestedAmountCents <= 0n)
    ) {
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
