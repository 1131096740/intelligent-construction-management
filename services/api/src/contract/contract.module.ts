import { DIRECT_ARCHIVE_EXECUTOR, DIRECT_ARCHIVE_ISSUER_CLIENT, DIRECT_ARCHIVE_RUNTIME_CLIENT,
  nativeDirectArchiveExecutor, type DirectArchiveRuntimeClient, type DirectArchiveSqlClient } from "./contract-direct-archive-executor";
import { GENERATED_UPWARD_OPERATING_ACTIVATION } from "./contract-generated-upward-operating";
import { nativeGeneratedUpwardOperatingActivation } from "./contract-generated-upward-operating-installation";
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
    {
      provide: DIRECT_ARCHIVE_EXECUTOR,
      inject: [PrivateFileStorage, { token: DIRECT_ARCHIVE_ISSUER_CLIENT, optional: true },
        { token: DIRECT_ARCHIVE_RUNTIME_CLIENT, optional: true }],
      useFactory: (storage: PrivateFileStorage, issuer?: DirectArchiveSqlClient, runtime?: DirectArchiveRuntimeClient) =>
        issuer && runtime && !Object.is(issuer, runtime) ? nativeDirectArchiveExecutor(storage, issuer, runtime) : undefined
    },
    ContractStatusService,
    ContractReadService,
    { provide: CONTRACT_VERSION_FILE_READ_AUTHORITY, useExisting: ContractReadService },
    ContractApprovalRouteService,
    ContractFormalFileService,
    ContractAuthorizationService,
    ContractSealService,
    ContractVersionActivationService,
    { provide: GENERATED_UPWARD_OPERATING_ACTIVATION, useValue: nativeGeneratedUpwardOperatingActivation }
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
