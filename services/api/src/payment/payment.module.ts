import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { PaymentController } from "./payment.controller";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule, FileModule],
  controllers: [PaymentController],
  providers: [PaymentAmountService, PaymentRequestService, PaymentReadService],
  exports: [PaymentAmountService, PaymentRequestService, PaymentReadService]
})
export class PaymentModule {}
