import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { OperatingLedgerModule } from "../operating-ledger/operating-ledger.module";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { SpotProcurementClosureModule } from "../spot-procurement/spot-procurement-closure.module";
import { InvoiceLedgerController } from "./invoice-ledger.controller";
import { InvoiceLedgerService } from "./invoice-ledger.service";
import { VatRateOptionController } from "./vat-rate-option.controller";
import { VatRateOptionService } from "./vat-rate-option.service";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    FileModule,
    OperatingLedgerModule,
    SpotProcurementClosureModule
  ],
  controllers: [VatRateOptionController, InvoiceLedgerController],
  providers: [
    VatRateOptionService,
    InvoiceLedgerService,
    SpotProcurementPilotService
  ],
  exports: [VatRateOptionService, InvoiceLedgerService]
})
export class InvoiceLedgerModule {}
