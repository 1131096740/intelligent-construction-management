import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractNumberingService } from "./contract-numbering.service";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftController } from "./contract-draft.controller";
import { ContractReadinessService } from "./contract-readiness.service";
import { ContractWorkbenchController } from "./contract-workbench.controller";
import { ContractWorkbenchService } from "./contract-workbench.service";

@Module({
  imports: [AuditModule, BusinessNumberModule, ContractBillModule],
  controllers: [ContractWorkbenchController, ContractDraftController],
  providers: [
    ContractWorkbenchService,
    ContractDraftAggregateService,
    ContractReadinessService,
    ContractNumberingService
  ],
  exports: [
    ContractWorkbenchService,
    ContractDraftAggregateService,
    ContractReadinessService,
    ContractNumberingService
  ]
})
export class ContractWorkbenchModule {}
