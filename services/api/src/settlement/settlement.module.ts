import { Module } from "@nestjs/common";
import { ApprovalModule } from "../approval/approval.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { SettlementController } from "./settlement.controller";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [ApprovalModule, AuditModule, AuthModule, FileModule],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementReadService],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
