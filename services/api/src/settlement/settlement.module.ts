import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { SettlementController } from "./settlement.controller";
import { SettlementImportController } from "./settlement-import.controller";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";
import { SettlementWorkbenchService } from "./settlement-workbench.service";
import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementImportService } from "./settlement-import.service";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule, FileModule],
  controllers: [SettlementController, SettlementWorkbenchController, SettlementImportController],
  providers: [
    SettlementService,
    SettlementReadService,
    SettlementAttachmentTemplateService,
    SettlementWorkbenchService,
    SettlementImportService
  ],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
