import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ContractNumberingService } from "./contract-numbering.service";
import { ContractReadinessService } from "./contract-readiness.service";
import { ContractWorkbenchController } from "./contract-workbench.controller";
import { ContractWorkbenchService } from "./contract-workbench.service";

@Module({
  imports: [AuditModule],
  controllers: [ContractWorkbenchController],
  providers: [
    ContractWorkbenchService,
    ContractReadinessService,
    ContractNumberingService
  ],
  exports: [
    ContractWorkbenchService,
    ContractReadinessService,
    ContractNumberingService
  ]
})
export class ContractWorkbenchModule {}
