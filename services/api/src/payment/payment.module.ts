import { PaymentApprovalNotificationService } from "./payment-approval-notification.service";
import { Module } from "@nestjs/common";
import { BusinessEntryTransactionModule } from "../business-entry-definition/business-entry-transaction.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { FundExecutionModule } from "../fund-execution/fund-execution.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ContractTakeoverModule } from "../contract-takeover/contract-takeover.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { PaymentController } from "./payment.controller";
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";
import { RegisteredPaymentExecutionController } from "./registered-payment-execution.controller";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "./registered-payment-notification.service";
import { PaymentRefundService } from "./payment-refund.service";
import { PaymentCorrectionService } from "./payment-correction.service";
import { FinancialCorrectionEntryService } from "./financial-correction-entry.service";
import { PaymentFinancialController } from "./payment-financial.controller";

@Module({
  imports: [
    BusinessEntryTransactionModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    ContractTakeoverModule,
    FileModule,
    FundExecutionModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [PaymentController, RegisteredPaymentExecutionController, PaymentFinancialController],
  providers: [PaymentAmountService, PaymentRequestService, PaymentReadService, RegisteredPaymentExecutionService, RegisteredPaymentNotificationService, PaymentApprovalNotificationService, PaymentRefundService, PaymentCorrectionService, FinancialCorrectionEntryService],
  exports: [PaymentAmountService, PaymentRequestService, PaymentReadService, PaymentRefundService, PaymentCorrectionService]
})
export class PaymentModule {}
