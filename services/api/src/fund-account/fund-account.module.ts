import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundAccountAdvanceController } from "./fund-account-advance.controller";
import { FundAccountAdvanceService } from "./fund-account-advance.service";
import { FundAccountController } from "./fund-account.controller";
import { FundAccountTransferController } from "./fund-account-transfer.controller";
import { FundAccountTransferService } from "./fund-account-transfer.service";
import { FundPrincipalReturnController } from "./fund-principal-return.controller";
import { FundPrincipalReturnService } from "./fund-principal-return.service";
import { FundAccountService } from "./fund-account.service";
import { PublicCashHandoverController } from "./public-cash-handover.controller";
import { PublicCashHandoverService } from "./public-cash-handover.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [FundPrincipalReturnController, FundAccountController, FundAccountTransferController, FundAccountAdvanceController, PublicCashHandoverController],
  providers: [FundAccountService, FundAccountTransferService, FundAccountAdvanceService, PublicCashHandoverService, FundPrincipalReturnService],
  exports: [FundAccountService],
})
export class FundAccountModule {}
