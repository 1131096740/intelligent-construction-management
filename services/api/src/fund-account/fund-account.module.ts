import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundAccountController } from "./fund-account.controller";
import { FundAccountTransferController } from "./fund-account-transfer.controller";
import { FundAccountTransferService } from "./fund-account-transfer.service";
import { FundAccountService } from "./fund-account.service";
import { PublicCashHandoverController } from "./public-cash-handover.controller";
import { PublicCashHandoverService } from "./public-cash-handover.service";
@Module({ imports: [AuthModule, AuditModule], controllers: [FundAccountController, FundAccountTransferController, PublicCashHandoverController], providers: [FundAccountService, FundAccountTransferService, PublicCashHandoverService], exports: [FundAccountService] })
export class FundAccountModule {}
