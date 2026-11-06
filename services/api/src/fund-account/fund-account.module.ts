import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundAccountController } from "./fund-account.controller";
import { FundAccountService } from "./fund-account.service";
@Module({ imports: [AuthModule, AuditModule], controllers: [FundAccountController], providers: [FundAccountService], exports: [FundAccountService] })
export class FundAccountModule {}
