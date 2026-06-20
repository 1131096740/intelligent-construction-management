import { Module } from "@nestjs/common";
import { PaymentAmountService } from "./payment-amount.service";

@Module({
  providers: [PaymentAmountService],
  exports: [PaymentAmountService]
})
export class PaymentModule {}
