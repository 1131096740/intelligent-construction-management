import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessEntryDefinitionModule } from "../business-entry-definition/business-entry-definition.module";
import { ClearingModule } from "../clearing/clearing.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { OperatingTakeoverController } from "./operating-takeover.controller";
import { OperatingTakeoverExcelService } from "./operating-takeover-excel.service";
import { OperatingTakeoverService } from "./operating-takeover.service";
import { ConstructionEnterpriseClearingAdapter } from "./construction-enterprise-clearing.adapter";
import { OperatingTakeoverCoordinatorService } from "./operating-takeover-coordinator.service";
import { HistoricalWageTakeoverController } from "./historical-wage-takeover.controller";
import { HistoricalWageTakeoverSelectionRefService } from "./historical-wage-takeover-selection-ref.service";
import { HistoricalWageTakeoverService } from "./historical-wage-takeover.service";
import { WageStatementModule } from "../wage-statement/wage-statement.module";

@Module({
  imports: [AuthModule, AuditModule, BusinessEntryDefinitionModule, ClearingModule, FileModule, OperatingLedgerModule, WageStatementModule],
  controllers: [OperatingTakeoverController, HistoricalWageTakeoverController],
  providers: [
    OperatingTakeoverService,
    OperatingTakeoverExcelService,
    ConstructionEnterpriseClearingAdapter,
    OperatingTakeoverCoordinatorService,
    HistoricalWageTakeoverSelectionRefService,
    HistoricalWageTakeoverService
  ],
  exports: [OperatingTakeoverService, OperatingTakeoverCoordinatorService, HistoricalWageTakeoverService]
})
export class OperatingTakeoverModule {}
