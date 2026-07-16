import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { VatRateOptionController } from "./vat-rate-option.controller";
import { VatRateOptionService } from "./vat-rate-option.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [VatRateOptionController],
  providers: [VatRateOptionService],
  exports: [VatRateOptionService]
})
export class InvoiceLedgerModule {}
