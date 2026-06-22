import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SettlementController } from "./settlement.controller";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Module({
  imports: [AuditModule],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementReadService],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
