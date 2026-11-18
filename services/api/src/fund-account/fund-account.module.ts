import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundAccountController } from "./fund-account.controller";
import { FundAccountTransferController } from "./fund-account-transfer.controller";
import { FundAccountTransferService } from "./fund-account-transfer.service";
import { FundAccountService } from "./fund-account.service";
@Module({ imports: [AuthModule, AuditModule], controllers: [FundAccountController, FundAccountTransferController], providers: [FundAccountService, FundAccountTransferService], exports: [FundAccountService] })
export class FundAccountModule {}
