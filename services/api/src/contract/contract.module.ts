import { Module } from "@nestjs/common";
import { ContractController } from "./contract.controller";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";

@Module({
  controllers: [ContractController],
  providers: [ContractService, ContractStatusService],
  exports: [ContractService, ContractStatusService]
})
export class ContractModule {}
