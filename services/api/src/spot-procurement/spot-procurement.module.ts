import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { InvoiceLedgerModule } from "../invoice-ledger/invoice-ledger.module";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementController } from "./spot-procurement.controller";

@Module({
  imports: [DatabaseModule, AuditModule, InvoiceLedgerModule],
  controllers: [SpotProcurementController],
  providers: [
    SpotProcurementApplicationService,
    SpotProcurementPilotService
  ],
  exports: [SpotProcurementApplicationService, SpotProcurementPilotService]
})
export class SpotProcurementModule {}
