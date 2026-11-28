import { SettlementArchiveNotificationService } from "./settlement-archive-notification.service";
import { Module } from "@nestjs/common";
import { BusinessEntryTransactionModule } from "../business-entry-definition/business-entry-transaction.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { MeModule } from "../me/me.module";
import { ContractTakeoverModule } from "../contract-takeover/contract-takeover.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { SettlementController } from "./settlement.controller";
import { SettlementDraftController } from "./settlement-draft.controller";
import { SettlementDraftService } from "./settlement-draft.service";
import { ContractSettlementProcessService } from "./contract-settlement-process.service";
import { SettlementImportController } from "./settlement-import.controller";
import {
  SettlementTemplateGovernanceController,
  SettlementTemplateRecommendationController
} from "./settlement-template.controller";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";
import { SettlementWorkbenchService } from "./settlement-workbench.service";
import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";
import { SettlementReadService } from "./settlement-read.service";
import { SignedSettlementLedgerService } from "./signed-settlement-ledger.service";
import { SettlementImportService } from "./settlement-import.service";
import { SettlementTemplateService } from "./settlement-template.service";
import { SettlementTemplateWorkbenchController } from "./settlement-template-workbench.controller";
import { SettlementService } from "./settlement.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { SettlementSignedDocumentService } from "./settlement-signed-document.service";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";
import { SettlementLineAttachmentService } from "./settlement-line-attachment.service";
import { SettlementRecoveryService } from "./settlement-recovery.service";

import { SignedContractSettlementController } from "./signed-contract-settlement.controller";
import { SignedContractSettlementService } from "./signed-contract-settlement.service";

@Module({
  imports: [
    BusinessEntryTransactionModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    ContractTakeoverModule,
    FileModule,
    MeModule,
    OperatingLedgerModule
  ],
  controllers: [
    SettlementController,
    SignedContractSettlementController,
    SettlementDraftController,
    SettlementWorkbenchController,
    SettlementImportController,
    SettlementTemplateGovernanceController,
    SettlementTemplateWorkbenchController,
    SettlementTemplateRecommendationController
  ],
  providers: [
    SettlementService,
    SignedContractSettlementService,
    SettlementDraftService,
    ContractSettlementProcessService,
    SettlementSubmissionService,
    SettlementReadService,
    SignedSettlementLedgerService,
    SettlementAttachmentTemplateService,
    SettlementWorkbenchService,
    SettlementImportService,
    SettlementTemplateService,
    SettlementCounterpartyDocumentService,
    SettlementFrozenDocumentService,
    SettlementLineAttachmentService,
    SettlementSignedDocumentService,
    SettlementArchiveNotificationService,
    SettlementRecoveryService
  ],
  exports: [
    SettlementService,
    SettlementTemplateService,
    SettlementSubmissionService,
    SettlementReadService,
    SettlementSignedDocumentService
  ]
})
export class SettlementModule {}
