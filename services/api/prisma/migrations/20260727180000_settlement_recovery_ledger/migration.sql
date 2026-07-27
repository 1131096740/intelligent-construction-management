CREATE TABLE "SettlementRecoveryBalance" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "originalAmountCents" BIGINT NOT NULL,
  "resolvedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "outstandingAmountCents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementRecoveryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementRecoveryEntry" (
  "id" TEXT NOT NULL,
  "balanceId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "occurredAt" DATE NOT NULL,
  "relatedPaymentId" TEXT,
  "evidenceFileId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reversalOfEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementRecoveryEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementRecoveryBalance_settlementId_key" ON "SettlementRecoveryBalance"("settlementId");
CREATE INDEX "SettlementRecoveryBalance_projectId_status_idx" ON "SettlementRecoveryBalance"("projectId", "status");
CREATE INDEX "SettlementRecoveryBalance_contractId_status_idx" ON "SettlementRecoveryBalance"("contractId", "status");
CREATE UNIQUE INDEX "SettlementRecoveryEntry_idempotencyKey_key" ON "SettlementRecoveryEntry"("idempotencyKey");
CREATE UNIQUE INDEX "SettlementRecoveryEntry_reversalOfEntryId_key" ON "SettlementRecoveryEntry"("reversalOfEntryId");
CREATE INDEX "SettlementRecoveryEntry_balanceId_createdAt_idx" ON "SettlementRecoveryEntry"("balanceId", "createdAt");
CREATE INDEX "SettlementRecoveryEntry_relatedPaymentId_idx" ON "SettlementRecoveryEntry"("relatedPaymentId");
CREATE INDEX "SettlementRecoveryEntry_evidenceFileId_idx" ON "SettlementRecoveryEntry"("evidenceFileId");

ALTER TABLE "SettlementRecoveryBalance"
  ADD CONSTRAINT "SettlementRecoveryBalance_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryBalance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryBalance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryBalance_amount_check" CHECK (
    "originalAmountCents" >= 0 AND "resolvedAmountCents" >= 0 AND "outstandingAmountCents" >= 0
    AND "resolvedAmountCents" + "outstandingAmountCents" = "originalAmountCents"
  ),
  ADD CONSTRAINT "SettlementRecoveryBalance_status_check" CHECK ("status" IN ('open', 'partially_resolved', 'resolved'));

ALTER TABLE "SettlementRecoveryEntry"
  ADD CONSTRAINT "SettlementRecoveryEntry_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "SettlementRecoveryBalance"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryEntry_relatedPaymentId_fkey" FOREIGN KEY ("relatedPaymentId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryEntry_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryEntry_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryEntry_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "SettlementRecoveryEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementRecoveryEntry_type_check" CHECK ("entryType" IN ('refund', 'offset', 'reversal')),
  ADD CONSTRAINT "SettlementRecoveryEntry_amount_check" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "SettlementRecoveryEntry_reason_check" CHECK (btrim("reason") <> '');

CREATE OR REPLACE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  VALUES
    ('User','signatureFileId',FALSE), ('HandwrittenSignatureVersion','fileId',FALSE),
    ('ContractVersion','taxFactEvidenceFileId',FALSE), ('ContractTaxFactRevision','evidenceFileId',FALSE),
    ('ContractTakeoverCorrection','attachmentFileId',FALSE), ('ContractArchiveFile','fileId',FALSE),
    ('ContractFormalFile','fileId',FALSE), ('ContractAuthorization','fileId',FALSE),
    ('Settlement','preparerSignatureFileId',FALSE), ('SettlementSignedDocument','fileId',FALSE),
    ('SettlementSignedDocumentGenerationClaim','uploadedFileId',FALSE), ('SettlementImport','fileId',FALSE),
    ('SettlementTemplateVersion','xlsxFileId',FALSE), ('SettlementTemplateVersion','previewXlsxFileId',FALSE),
    ('SettlementTemplateVersion','previewPdfFileId',FALSE), ('SettlementTemplatePreviewJob','previewXlsxFileId',FALSE),
    ('SettlementTemplatePreviewJob','previewPdfFileId',FALSE), ('SettlementArchiveFile','fileId',FALSE),
    ('SettlementLineAttachment','fileId',FALSE), ('SettlementRecoveryEntry','evidenceFileId',TRUE),
    ('PaymentExecution','voucherFileId',FALSE), ('SpotProcurementAttachment','fileId',FALSE),
    ('SpotProcurementPayment','supportingAttachmentFileId',FALSE), ('SpotProcurementPayment','merchantPaymentProofFileId',FALSE),
    ('SpotProcurementPaymentExecution','voucherFileId',TRUE), ('SpotProcurementPaymentAttachment','fileId',TRUE),
    ('SpotProcurementPaymentExecutionVoucher','fileId',TRUE), ('SpotProcurementPaymentInvoice','fileId',TRUE),
    ('SpotProcurementPaymentArchive','generatedPackageFileId',FALSE), ('SpotProcurementPaymentArchiveFile','fileId',FALSE),
    ('SpotProcurementReceiptPhoto','originalFileId',TRUE), ('SpotProcurementReceiptPhoto','watermarkedFileId',TRUE),
    ('SpotProcurementRefund','voucherFileId',TRUE), ('InvoiceRecord','fileId',TRUE),
    ('NoInvoiceConfirmation','proofFileId',TRUE), ('InvoiceExceptionConfirmation','proofFileId',TRUE),
    ('ProjectExpenseRequest','attachmentFileId',FALSE), ('ExpenseClaimAttachment','fileId',TRUE),
    ('ExpenseClaimPaymentExecution','voucherFileId',TRUE), ('ProjectExpenseExecution','voucherFileId',FALSE),
    ('ProjectReceipt','voucherFileId',FALSE), ('ProjectProxyPayment','voucherFileId',FALSE),
    ('ProjectUpstreamSettlement','voucherFileId',FALSE), ('ProjectOwnerContract','fileId',FALSE),
    ('ProjectSettlementExceptionQuota','attachmentFileId',FALSE), ('ProjectFinancingQuota','attachmentFileId',FALSE),
    ('EmployeeLoanRepayment','voucherFileId',FALSE), ('EmployeeProjectLoanEntry','voucherFileId',FALSE),
    ('ApprovalActionLog','signatureFileIdSnapshot',FALSE), ('ArchiveRecord','fileId',FALSE), ('PdfDocument','fileId',FALSE),
    ('ApprovalFormGenerationClaim','uploadedFileId',FALSE), ('ContractLayoutTemplateVersion','docxFileId',FALSE),
    ('ContractLayoutTemplateVersion','previewPdfFileId',FALSE), ('ContractLayoutPreviewJob','previewPdfFileId',FALSE),
    ('ContractBill','sourceExcelFileId',FALSE), ('ContractBillImport','fileId',FALSE),
    ('ContractGeneratedDocument','docxFileId',FALSE), ('ContractGeneratedDocument','pdfFileId',FALSE),
    ('ContractOfflineRevision','fileId',FALSE), ('ContractOfflineRevision','previewPdfFileId',FALSE);
$$;

CREATE TRIGGER jg_efb_settlement_recovery_entry_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "SettlementRecoveryEntry"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId', 'true');
