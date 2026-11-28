import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FundFlowController } from "./fund-flow.controller";
import { FundFlowService } from "./fund-flow.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [FundFlowController],
  providers: [FundFlowService],
  exports: [FundFlowService]
})
export class FundFlowModule {}
