import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InvoiceLedgerModule } from "../invoice-ledger/invoice-ledger.module";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementController } from "./spot-procurement.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    InvoiceLedgerModule
  ],
  controllers: [
    SpotProcurementController,
    SpotProcurementPaymentController
  ],
  providers: [
    SpotProcurementApplicationService,
    SpotProcurementBalanceService,
    SpotProcurementPaymentService,
    SpotProcurementPilotService
  ],
  exports: [
    SpotProcurementApplicationService,
    SpotProcurementBalanceService,
    SpotProcurementPaymentService,
    SpotProcurementPilotService
  ]
})
export class SpotProcurementModule {}
