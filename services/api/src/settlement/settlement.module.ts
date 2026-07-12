import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { SettlementController } from "./settlement.controller";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";
import { SettlementWorkbenchService } from "./settlement-workbench.service";
import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule, FileModule],
  controllers: [SettlementController, SettlementWorkbenchController],
  providers: [
    SettlementService,
    SettlementReadService,
    SettlementAttachmentTemplateService,
    SettlementWorkbenchService
  ],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
