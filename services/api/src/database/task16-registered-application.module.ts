import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessEntryTransactionModule } from "../business-entry-definition/business-entry-transaction.module";
import { FileModule } from "../file/file.module";
import { FundAccountModule } from "../fund-account/fund-account.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { PaymentAmountService } from "../payment/payment-amount.service";
import { PaymentRequestService } from "../payment/payment-request.service";
import { RegisteredPaymentExecutionController } from "../payment/registered-payment-execution.controller";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "../payment/registered-payment-notification.service";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { DatabaseModule } from "./database.module";

/** Dedicated Task16 composition. Keep the real AuthModule's six global guards;
 * do not import AppModule/main or background document/approval workers. Source
 * metadata is not evidence of successful Nest DI or actual HTTP acceptance. */
@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, FileModule, FundAccountModule,
    OperatingLedgerModule, ProjectFundingModule, BusinessEntryTransactionModule],
  controllers: [RegisteredPaymentExecutionController],
  providers: [PaymentAmountService, PaymentRequestService, RegisteredPaymentExecutionService,
    RegisteredPaymentNotificationService, ApprovalSmsService,
    { provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]
})
export class Task16RegisteredApplicationModule {}
