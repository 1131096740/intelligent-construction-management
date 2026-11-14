import { Module, ServiceUnavailableException } from "@nestjs/common";
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
import { REGISTERED_PAYMENT_IMPACT_READER } from "../payment/registered-payment-impact-reader";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "../payment/registered-payment-notification.service";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { Task16RegistrationErrorFilter } from "./task16-registration-error-diagnostic";
export { Task16RegistrationErrorFilter, armTask16RegistrationError, takeTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { DatabaseModule } from "./database.module";

export const Task16ImpactReaderToken = REGISTERED_PAYMENT_IMPACT_READER;

function missingTask16ImpactReader(): never {
  throw new ServiceUnavailableException("暂时无法核对实付影响，请稍后查询");
}

/** Dedicated Task16 composition. Keep the real AuthModule's six global guards;
 * do not import AppModule/main or background document/approval workers. Source
 * metadata is not evidence of successful Nest DI or actual HTTP acceptance. */
@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, FileModule, FundAccountModule,
    OperatingLedgerModule, ProjectFundingModule, BusinessEntryTransactionModule],
  controllers: [RegisteredPaymentExecutionController],
  providers: [PaymentAmountService, PaymentRequestService, RegisteredPaymentExecutionService,
    RegisteredPaymentNotificationService, ApprovalSmsService,
    Task16RegistrationErrorFilter,
    { provide: APP_FILTER, useExisting: Task16RegistrationErrorFilter },
    { provide: Task16ImpactReaderToken, useValue: missingTask16ImpactReader }]
})
export class Task16RegisteredApplicationModule {}
