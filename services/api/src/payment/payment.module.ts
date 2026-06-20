import { Module } from "@nestjs/common";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentRequestService } from "./payment-request.service";

@Module({
  providers: [PaymentAmountService, PaymentRequestService],
  exports: [PaymentAmountService, PaymentRequestService]
})
export class PaymentModule {}
