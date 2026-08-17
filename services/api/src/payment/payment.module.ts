import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ContractTakeoverModule } from "../contract-takeover/contract-takeover.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { PaymentController } from "./payment.controller";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Module({
  imports: [
    ApprovalModule,
    AuditModule,
    AuthModule,
    ContractTakeoverModule,
    FileModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [PaymentController],
  providers: [PaymentAmountService, PaymentRequestService, PaymentReadService],
  exports: [PaymentAmountService, PaymentRequestService, PaymentReadService]
})
export class PaymentModule {}
