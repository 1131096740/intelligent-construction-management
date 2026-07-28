import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApprovalModule } from "../approval/approval.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { InvoiceLedgerModule } from "../invoice-ledger/invoice-ledger.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ReceiptWatermarkService } from "./receipt-watermark.service";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { SpotProcurementAccessModule } from "./spot-procurement-access.module";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SpotProcurementClosureModule } from "./spot-procurement-closure.module";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementReadService } from "./spot-procurement-read.service";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { SpotProcurementReceiptPdfService } from "./spot-procurement-receipt-pdf.service";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";
import { SpotProcurementController } from "./spot-procurement.controller";
import { SpotProcurementInvoiceController } from "./spot-procurement-invoice.controller";
import { SpotProcurementInvoiceService } from "./spot-procurement-invoice.service";
import { SpotProcurementPaymentArchiveService } from "./spot-procurement-payment-archive.service";

@Module({
  imports: [
    DatabaseModule,
    ApprovalModule,
    AuditModule,
    AuthModule,
    FileModule,
    InvoiceLedgerModule,
    ProjectFundingModule,
    SpotProcurementClosureModule,
    SpotProcurementAccessModule
  ],
  controllers: [
    SpotProcurementController,
    SpotProcurementInvoiceController,
    SpotProcurementPaymentController,
    SpotProcurementReceiptController
  ],
  providers: [
    ReceiptWatermarkService,
    SpotProcurementApplicationService,
    SpotProcurementInvoiceService,
    SpotProcurementPaymentArchiveService,
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
    SpotProcurementInvoiceService,
    SpotProcurementPaymentArchiveService,
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
