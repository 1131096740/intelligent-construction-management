import { Module } from "@nestjs/common";
import { PaymentController } from "./payment.controller";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Module({
  controllers: [PaymentController],
  providers: [PaymentAmountService, PaymentRequestService, PaymentReadService],
  exports: [PaymentAmountService, PaymentRequestService, PaymentReadService]
})
export class PaymentModule {}
