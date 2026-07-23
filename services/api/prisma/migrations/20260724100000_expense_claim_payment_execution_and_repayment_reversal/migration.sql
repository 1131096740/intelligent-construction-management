-- 阶段 2 收口：公司补付实际付款与员工还款反向更正均为只追加事实。
-- 不读取、回填、改写或删除旧 ProjectExpenseRequest / 历史付款数据。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 25);

CREATE TABLE "ExpenseClaimPaymentExecution" (
  "id" TEXT NOT NULL,
  "expenseClaimId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "voucherFileId" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExpenseClaimPaymentExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseClaimPaymentExecution_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ExpenseClaimPaymentExecution_paymentMethod_check" CHECK (btrim("paymentMethod") <> ''),
  CONSTRAINT "ExpenseClaimPaymentExecution_voucherFileId_key" UNIQUE ("voucherFileId"),
  CONSTRAINT "ExpenseClaimPaymentExecution_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "ExpenseClaim"("id"),
  CONSTRAINT "ExpenseClaimPaymentExecution_voucherFileId_fkey" FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "ExpenseClaimPaymentExecution_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
);

CREATE INDEX "ExpenseClaimPaymentExecution_expenseClaimId_paidAt_idx"
  ON "ExpenseClaimPaymentExecution"("expenseClaimId", "paidAt");

ALTER TABLE "ExpenseClaim"
  DROP CONSTRAINT "ExpenseClaim_status_check",
  ADD CONSTRAINT "ExpenseClaim_status_check" CHECK ("status" IN (
    'draft', 'approval_pending', 'approved_pending_payment', 'partially_paid',
    'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
    'offset_completed', 'paid', 'withdrawn', 'rejected', 'voided'
  ));

-- 将新凭证加入统一文件绑定目录，并独占绑定，防止同一凭证重复挂到其他业务事实。
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

CREATE TRIGGER jg_efb_expense_claim_payment_execution_voucher
BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ExpenseClaimPaymentExecution"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('voucherFileId', 'true');

COMMIT;
