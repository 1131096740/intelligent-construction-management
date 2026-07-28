import { forwardRef, Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessPartyModule } from "../business-party/business-party.module";
import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractDocumentModule } from "../contract-document/contract-document.module";
import { FileModule } from "../file/file.module";
import { ContractModule } from "../contract/contract.module";
import { ContractNumberingService } from "./contract-numbering.service";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftController } from "./contract-draft.controller";
import { ContractDraftEditLeaseService } from "./contract-draft-edit-lease.service";
import { ContractReadinessService } from "./contract-readiness.service";
import { ContractWorkbenchController } from "./contract-workbench.controller";
import { ContractWorkbenchService } from "./contract-workbench.service";

@Module({
  imports: [
    AuditModule,
    AuthModule,
    BusinessPartyModule,
    ContractBillModule,
    ContractDocumentModule,
    forwardRef(() => ContractModule),
    FileModule
  ],
  controllers: [ContractWorkbenchController, ContractDraftController],
  providers: [
    ContractWorkbenchService,
    ContractDraftAggregateService,
    ContractDraftEditLeaseService,
    ContractReadinessService,
    ContractNumberingService
  ],
  exports: [
    ContractWorkbenchService,
    ContractDraftAggregateService,
    ContractDraftEditLeaseService,
    ContractReadinessService,
    ContractNumberingService
  ]
})
export class ContractWorkbenchModule {}
