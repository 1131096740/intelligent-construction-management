import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { MeModule } from "../me/me.module";
import { SettlementController } from "./settlement.controller";
import { SettlementDraftController } from "./settlement-draft.controller";
import { SettlementDraftService } from "./settlement-draft.service";
import { SettlementImportController } from "./settlement-import.controller";
import {
  SettlementTemplateGovernanceController,
  SettlementTemplateRecommendationController
} from "./settlement-template.controller";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";
import { SettlementWorkbenchService } from "./settlement-workbench.service";
import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementImportService } from "./settlement-import.service";
import { SettlementTemplateService } from "./settlement-template.service";
import { SettlementService } from "./settlement.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { SettlementSignedDocumentService } from "./settlement-signed-document.service";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule, FileModule, MeModule],
  controllers: [
    SettlementController,
    SettlementDraftController,
    SettlementWorkbenchController,
    SettlementImportController,
    SettlementTemplateGovernanceController,
    SettlementTemplateRecommendationController
  ],
  providers: [
    SettlementService,
    SettlementDraftService,
    SettlementSubmissionService,
    SettlementReadService,
    SettlementAttachmentTemplateService,
    SettlementWorkbenchService,
    SettlementImportService,
    SettlementTemplateService,
    SettlementCounterpartyDocumentService,
    SettlementFrozenDocumentService,
    SettlementSignedDocumentService
  ],
  exports: [
    SettlementService,
    SettlementSubmissionService,
    SettlementReadService,
    SettlementSignedDocumentService
  ]
})
export class SettlementModule {}
