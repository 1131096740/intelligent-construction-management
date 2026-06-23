import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ContractController } from "./contract.controller";
import { ContractReadService } from "./contract-read.service";
import { ContractService } from "./contract.service";
import { ContractStatusService } from "./contract-status.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule],
  controllers: [ContractController],
  providers: [ContractService, ContractStatusService, ContractReadService],
  exports: [ContractService, ContractStatusService, ContractReadService]
})
export class ContractModule {}
