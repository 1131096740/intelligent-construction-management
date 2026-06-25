import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ContractWorkbenchController } from "./contract-workbench.controller";
import { ContractWorkbenchService } from "./contract-workbench.service";

@Module({
  imports: [AuditModule],
  controllers: [ContractWorkbenchController],
  providers: [ContractWorkbenchService],
  exports: [ContractWorkbenchService]
})
export class ContractWorkbenchModule {}
