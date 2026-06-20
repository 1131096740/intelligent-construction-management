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
      throw new Error("Payment request amount must be positive cents");
    }

    if (requestedAmountCents > remaining) {
      throw new Error(
        `Payment request exceeds remaining settlement capacity: ${remaining}`
      );
    }
  }
}
