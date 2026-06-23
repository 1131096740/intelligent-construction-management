import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { SettlementController } from "./settlement.controller";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementReadService],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
