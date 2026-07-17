import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { InvoiceLedgerModule } from "../invoice-ledger/invoice-ledger.module";
import { ReceiptWatermarkService } from "./receipt-watermark.service";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { SpotProcurementAccessModule } from "./spot-procurement-access.module";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementReadService } from "./spot-procurement-read.service";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { SpotProcurementReceiptPdfService } from "./spot-procurement-receipt-pdf.service";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";
import { SpotProcurementController } from "./spot-procurement.controller";

@Module({
  imports: [
    DatabaseModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    FileModule,
    InvoiceLedgerModule,
    SpotProcurementAccessModule
  ],
  controllers: [
    SpotProcurementController,
    SpotProcurementPaymentController,
    SpotProcurementReceiptController
  ],
  providers: [
    ReceiptWatermarkService,
    SpotProcurementApplicationService,
    SpotProcurementBalanceService,
    SpotProcurementPaymentService,
    SpotProcurementPilotService,
    SpotProcurementReadService,
    SpotProcurementReceiptPdfService,
    SpotProcurementReceiptService,
    SpotProcurementSettlementService
  ],
  exports: [
    SpotProcurementApplicationService,
    SpotProcurementBalanceService,
    SpotProcurementPaymentService,
    SpotProcurementPilotService,
    SpotProcurementReadService,
    SpotProcurementReceiptPdfService,
    SpotProcurementReceiptService,
    SpotProcurementSettlementService
  ]
})
export class SpotProcurementModule {}
