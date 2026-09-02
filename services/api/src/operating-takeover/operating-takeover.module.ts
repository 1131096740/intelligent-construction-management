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

@Module({
  imports: [AuthModule, AuditModule, BusinessEntryDefinitionModule, ClearingModule, FileModule, OperatingLedgerModule],
  controllers: [OperatingTakeoverController],
  providers: [OperatingTakeoverService, OperatingTakeoverExcelService, ConstructionEnterpriseClearingAdapter, OperatingTakeoverCoordinatorService],
  exports: [OperatingTakeoverService, OperatingTakeoverCoordinatorService]
})
export class OperatingTakeoverModule {}
