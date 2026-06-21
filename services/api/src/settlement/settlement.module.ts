import { Module } from "@nestjs/common";
import { SettlementController } from "./settlement.controller";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Module({
  controllers: [SettlementController],
  providers: [SettlementService, SettlementReadService],
  exports: [SettlementService, SettlementReadService]
})
export class SettlementModule {}
