import { FundBalanceNoticeWorker } from "./fund-balance-notice-worker";
import { ApprovalModule } from "../approval/approval.module";
import { FundBalanceReviewNotificationService } from "./fund-balance-review-notification.service";
import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundAccountAdvanceController } from "./fund-account-advance.controller";
import { FundAccountAdvanceService } from "./fund-account-advance.service";
import { FundAccountController } from "./fund-account.controller";
import { FundAccountTransferController } from "./fund-account-transfer.controller";
import { FundAccountTransferNotificationService } from "./fund-account-transfer-notification.service";
import { FundAccountTransferService } from "./fund-account-transfer.service";
import { FundPrincipalReturnController } from "./fund-principal-return.controller";
import { FundPrincipalReturnNotificationService } from "./fund-principal-return-notification.service";
import { FundPrincipalReturnService } from "./fund-principal-return.service";
import { FundAccountService } from "./fund-account.service";
import { PublicCashHandoverController } from "./public-cash-handover.controller";
import { PublicCashHandoverService } from "./public-cash-handover.service";

@Module({
  imports: [AuthModule, AuditModule, ApprovalModule],
  controllers: [FundPrincipalReturnController, FundAccountController, FundAccountTransferController, FundAccountAdvanceController, PublicCashHandoverController],
  providers: [FundBalanceNoticeWorker, FundBalanceReviewNotificationService, FundAccountTransferNotificationService, FundAccountService, FundAccountTransferService, FundAccountAdvanceService, PublicCashHandoverService, FundPrincipalReturnService, FundPrincipalReturnNotificationService],
  exports: [FundAccountService],
})
export class FundAccountModule {}
