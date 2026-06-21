import { Module } from "@nestjs/common";
import { ContractController } from "./contract.controller";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";

@Module({
  controllers: [ContractController],
  providers: [ContractService, ContractStatusService, ContractReadService],
  exports: [ContractService, ContractStatusService, ContractReadService]
})
export class ContractModule {}
