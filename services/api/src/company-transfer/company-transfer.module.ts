import { ApprovalModule } from "../approval/approval.module";
import { CompanyTransferNotificationService } from "./company-transfer-notification.service";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { CompanyTransferService } from "./company-transfer.service";
import { CompanyTransferReadService } from "./company-transfer-read.service";
import { CompanyTransferCorrectionService } from "./company-transfer-correction.service";
import { CompanyTransferController } from "./company-transfer.controller";
@Module({ imports: [DatabaseModule, AuthModule, AuditModule, OperatingLedgerModule, ProjectFundingModule, ApprovalModule], controllers: [CompanyTransferController], providers: [CompanyTransferNotificationService, CompanyTransferService, CompanyTransferReadService, CompanyTransferCorrectionService] })
export class CompanyTransferModule { }
