-- 新费用附件独占绑定，不改写任何存量费用、项目支出或文件事实。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
CREATE TABLE "ExpenseClaimAttachment" (
  "id" TEXT NOT NULL,
  "expenseClaimId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "expenseCategory" TEXT,
  "stage" TEXT NOT NULL DEFAULT 'draft',
  "attachedByUserId" TEXT NOT NULL,
  "frozenAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "removedByUserId" TEXT,
  "removalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseClaimAttachment_fileId_key" UNIQUE ("fileId"),
  CONSTRAINT "ExpenseClaimAttachment_stage_check" CHECK ("stage" IN ('draft', 'approval_frozen', 'appended')),
  CONSTRAINT "ExpenseClaimAttachment_removal_check" CHECK (
    ("removedAt" IS NULL AND "removedByUserId" IS NULL AND "removalReason" IS NULL)
    OR ("removedAt" IS NOT NULL AND "removedByUserId" IS NOT NULL)
  ),
  CONSTRAINT "ExpenseClaimAttachment_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "ExpenseClaim"("id")
);
CREATE INDEX "ExpenseClaimAttachment_expenseClaimId_removedAt_createdAt_idx"
  ON "ExpenseClaimAttachment"("expenseClaimId", "removedAt", "createdAt");
CREATE INDEX "ExpenseClaimAttachment_fileId_idx" ON "ExpenseClaimAttachment"("fileId");
LOCK TABLE "ExpenseClaimAttachment" IN SHARE ROW EXCLUSIVE MODE;

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
    ('PaymentExecution','voucherFileId',FALSE), ('SpotProcurementAttachment','fileId',FALSE),
    ('SpotProcurementPayment','supportingAttachmentFileId',FALSE), ('SpotProcurementPayment','merchantPaymentProofFileId',FALSE),
    ('SpotProcurementPaymentExecution','voucherFileId',TRUE), ('SpotProcurementPaymentAttachment','fileId',TRUE),
    ('SpotProcurementPaymentExecutionVoucher','fileId',TRUE), ('SpotProcurementPaymentInvoice','fileId',TRUE),
    ('SpotProcurementPaymentArchive','generatedPackageFileId',FALSE), ('SpotProcurementPaymentArchiveFile','fileId',FALSE),
    ('SpotProcurementReceiptPhoto','originalFileId',TRUE), ('SpotProcurementReceiptPhoto','watermarkedFileId',TRUE),
    ('SpotProcurementRefund','voucherFileId',TRUE), ('InvoiceRecord','fileId',TRUE),
    ('NoInvoiceConfirmation','proofFileId',TRUE), ('InvoiceExceptionConfirmation','proofFileId',TRUE),
    ('ProjectExpenseRequest','attachmentFileId',FALSE), ('ExpenseClaimAttachment','fileId',TRUE),
    ('ProjectExpenseExecution','voucherFileId',FALSE), ('ProjectReceipt','voucherFileId',FALSE),
    ('ProjectProxyPayment','voucherFileId',FALSE), ('ProjectUpstreamSettlement','voucherFileId',FALSE),
    ('ProjectOwnerContract','fileId',FALSE), ('ProjectSettlementExceptionQuota','attachmentFileId',FALSE),
    ('ProjectFinancingQuota','attachmentFileId',FALSE), ('EmployeeLoanRepayment','voucherFileId',FALSE),
    ('EmployeeProjectLoanEntry','voucherFileId',FALSE), ('ApprovalActionLog','signatureFileIdSnapshot',FALSE),
    ('ArchiveRecord','fileId',FALSE), ('PdfDocument','fileId',FALSE),
    ('ApprovalFormGenerationClaim','uploadedFileId',FALSE), ('ContractLayoutTemplateVersion','docxFileId',FALSE),
    ('ContractLayoutTemplateVersion','previewPdfFileId',FALSE), ('ContractLayoutPreviewJob','previewPdfFileId',FALSE),
    ('ContractBill','sourceExcelFileId',FALSE), ('ContractBillImport','fileId',FALSE),
    ('ContractGeneratedDocument','docxFileId',FALSE), ('ContractGeneratedDocument','pdfFileId',FALSE),
    ('ContractOfflineRevision','fileId',FALSE), ('ContractOfflineRevision','previewPdfFileId',FALSE);
$$;

DROP TRIGGER IF EXISTS jg_efb_expense_claim_attachment ON "ExpenseClaimAttachment";
CREATE TRIGGER jg_efb_expense_claim_attachment
BEFORE INSERT OR UPDATE OF "fileId" ON "ExpenseClaimAttachment"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

COMMIT;
