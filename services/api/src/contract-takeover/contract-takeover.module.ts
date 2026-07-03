import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ContractTakeoverController } from "./contract-takeover.controller";
import { ContractTakeoverService } from "./contract-takeover.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [ContractTakeoverController],
  providers: [ContractTakeoverService],
  exports: [ContractTakeoverService]
})
export class ContractTakeoverModule {}
