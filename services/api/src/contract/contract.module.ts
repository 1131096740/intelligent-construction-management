import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ContractController } from "./contract.controller";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";

@Module({
  imports: [AuditModule],
  controllers: [ContractController],
  providers: [ContractService, ContractStatusService, ContractReadService],
  exports: [ContractService, ContractStatusService, ContractReadService]
})
export class ContractModule {}
