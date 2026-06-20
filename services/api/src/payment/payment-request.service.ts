import { Injectable } from "@nestjs/common";
import {
  canCreatePaymentFromSettlementStatus,
  SettlementStatus
} from "@jiangkong/shared-domain";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";

@Injectable()
export class PaymentRequestService {
  constructor(private readonly amount: PaymentAmountService) {}

  assertSettlementEffective(status: SettlementStatus): void {
    if (!canCreatePaymentFromSettlementStatus(status)) {
      throw new Error("Cannot create payment request from a non-effective settlement");
    }
  }

  assertRequestAllowed(
    status: SettlementStatus,
    capacity: PaymentCapacity,
    requestedAmountCents: number
  ): void {
    this.assertSettlementEffective(status);
    this.amount.assertCanRequest(capacity, requestedAmountCents);
  }
}
