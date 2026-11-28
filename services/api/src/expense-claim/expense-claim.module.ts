import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";
import { ActualPurchaseBatchModule } from "../actual-purchase/actual-purchase-batch.module";
import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ExpenseClaimController } from "./expense-claim.controller";
import { ExpenseClaimCorrectionService } from "./expense-claim-correction.service";
import { ExpenseClaimPaymentRefundService } from "./expense-claim-payment-refund.service";
import { ExpenseClaimService } from "./expense-claim.service";
import { OtherProjectPaymentController } from "./other-project-payment.controller";

@Module({
  imports: [
    ActualPurchaseBatchModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    BusinessNumberModule,
    FileModule,
    OperatingLedgerModule,
    ProjectFundingModule
  ],
  controllers: [ExpenseClaimController, OtherProjectPaymentController],
  providers: [
    ExpenseClaimService,
    ExpenseClaimFundingNotificationService,
    ExpenseClaimPaymentRefundService,
    ExpenseClaimCorrectionService
  ]
})
export class ExpenseClaimModule {}
