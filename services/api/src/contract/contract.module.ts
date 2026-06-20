import { Module } from "@nestjs/common";
import { ContractStatusService } from "./contract-status.service";

@Module({
  providers: [ContractStatusService],
  exports: [ContractStatusService]
})
export class ContractModule {}
