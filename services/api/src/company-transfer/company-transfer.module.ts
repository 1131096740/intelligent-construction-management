import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { CompanyTransferService } from "./company-transfer.service";
import { CompanyTransferReadService } from "./company-transfer-read.service";
import { CompanyTransferController } from "./company-transfer.controller";
@Module({ imports: [DatabaseModule, AuthModule, AuditModule, OperatingLedgerModule, ProjectFundingModule], controllers: [CompanyTransferController], providers: [CompanyTransferService, CompanyTransferReadService] })
export class CompanyTransferModule { }
