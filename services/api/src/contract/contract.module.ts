import { GENERATED_ARCHIVE_PREPARATION_READER } from "./contract-generated-archive-preparation";
import { ContractV2ArchiveService } from "./contract-v2-archive.service";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY } from "./contract-version-file-read-authority";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { forwardRef, Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { BusinessEntryTransactionModule } from "../business-entry-definition/business-entry-transaction.module";
import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractWorkbenchModule } from "../contract-workbench/contract-workbench.module";
import { FileModule } from "../file/file.module";
import { PrivateFileStorage } from "../file/file.service";
import { MeModule } from "../me/me.module";
import {
  ContractController,
  ContractNumberRuleController
} from "./contract.controller";
import { ContractReadService } from "./contract-read.service";
import { ContractV2SubmissionService } from "./contract-v2-submission.service";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";
import { ContractApprovalRouteService } from "./contract-approval-route.service";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractSealService } from "./contract-seal.service";
import { ContractVersionActivationService } from "./contract-version-activation.service";

@Module({
  imports: [
    OperatingLedgerModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    BusinessNumberModule,
    BusinessEntryTransactionModule,
    ContractBillModule,
    forwardRef(() => ContractWorkbenchModule),
    FileModule,
    MeModule
  ],
  controllers: [ContractController, ContractNumberRuleController],
  providers: [
    ContractService,
    ContractV2SubmissionService,
    ContractV2ArchiveService,
    { provide: GENERATED_ARCHIVE_PREPARATION_READER, useExisting: PrivateFileStorage },
    ContractStatusService,
    ContractReadService,
    { provide: CONTRACT_VERSION_FILE_READ_AUTHORITY, useExisting: ContractReadService },
    ContractApprovalRouteService,
    ContractFormalFileService,
    ContractAuthorizationService,
    ContractSealService,
    ContractVersionActivationService
  ],
  exports: [
    ContractService,
    ContractV2SubmissionService,
    ContractV2ArchiveService,
    ContractStatusService,
    ContractReadService,
    CONTRACT_VERSION_FILE_READ_AUTHORITY,
    ContractFormalFileService,
    ContractAuthorizationService,
    ContractSealService,
    ContractVersionActivationService
  ]
})
export class ContractModule {}
