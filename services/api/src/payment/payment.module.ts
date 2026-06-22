import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PaymentController } from "./payment.controller";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Module({
  imports: [AuditModule],
  controllers: [PaymentController],
  providers: [PaymentAmountService, PaymentRequestService, PaymentReadService],
  exports: [PaymentAmountService, PaymentRequestService, PaymentReadService]
})
export class PaymentModule {}
