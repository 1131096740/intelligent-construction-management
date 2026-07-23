-- 员工还款凭证是新的非独占 FileObject 事实。它必须接入已部署的统一绑定守卫，
-- 不改写任何存量文件或业务数据。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "EmployeeLoanRepayment" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE (
  "tableName" TEXT,
  "columnName" TEXT,
  "exclusive" BOOLEAN
)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  VALUES
    ('User', 'signatureFileId', FALSE),
    ('HandwrittenSignatureVersion', 'fileId', FALSE),
    ('ContractVersion', 'taxFactEvidenceFileId', FALSE),
    ('ContractTaxFactRevision', 'evidenceFileId', FALSE),
    ('ContractTakeoverCorrection', 'attachmentFileId', FALSE),
    ('ContractArchiveFile', 'fileId', FALSE),
    ('ContractFormalFile', 'fileId', FALSE),
    ('ContractAuthorization', 'fileId', FALSE),
    ('Settlement', 'preparerSignatureFileId', FALSE),
    ('SettlementSignedDocument', 'fileId', FALSE),
    ('SettlementSignedDocumentGenerationClaim', 'uploadedFileId', FALSE),
    ('SettlementImport', 'fileId', FALSE),
    ('SettlementTemplateVersion', 'xlsxFileId', FALSE),
    ('SettlementTemplateVersion', 'previewXlsxFileId', FALSE),
    ('SettlementTemplateVersion', 'previewPdfFileId', FALSE),
    ('SettlementTemplatePreviewJob', 'previewXlsxFileId', FALSE),
    ('SettlementTemplatePreviewJob', 'previewPdfFileId', FALSE),
    ('SettlementArchiveFile', 'fileId', FALSE),
    ('PaymentExecution', 'voucherFileId', FALSE),
    ('SpotProcurementAttachment', 'fileId', FALSE),
    ('SpotProcurementPayment', 'supportingAttachmentFileId', FALSE),
    ('SpotProcurementPayment', 'merchantPaymentProofFileId', FALSE),
    ('SpotProcurementPaymentExecution', 'voucherFileId', TRUE),
    ('SpotProcurementPaymentAttachment', 'fileId', TRUE),
    ('SpotProcurementPaymentExecutionVoucher', 'fileId', TRUE),
    ('SpotProcurementPaymentInvoice', 'fileId', TRUE),
    ('SpotProcurementPaymentArchive', 'generatedPackageFileId', FALSE),
    ('SpotProcurementPaymentArchiveFile', 'fileId', FALSE),
    ('SpotProcurementReceiptPhoto', 'originalFileId', TRUE),
    ('SpotProcurementReceiptPhoto', 'watermarkedFileId', TRUE),
    ('SpotProcurementRefund', 'voucherFileId', TRUE),
    ('InvoiceRecord', 'fileId', TRUE),
    ('NoInvoiceConfirmation', 'proofFileId', TRUE),
    ('InvoiceExceptionConfirmation', 'proofFileId', TRUE),
    ('ProjectExpenseRequest', 'attachmentFileId', FALSE),
    ('ProjectExpenseExecution', 'voucherFileId', FALSE),
    ('ProjectReceipt', 'voucherFileId', FALSE),
    ('ProjectProxyPayment', 'voucherFileId', FALSE),
    ('ProjectUpstreamSettlement', 'voucherFileId', FALSE),
    ('ProjectOwnerContract', 'fileId', FALSE),
    ('ProjectSettlementExceptionQuota', 'attachmentFileId', FALSE),
    ('ProjectFinancingQuota', 'attachmentFileId', FALSE),
    ('EmployeeLoanRepayment', 'voucherFileId', FALSE),
    ('ApprovalActionLog', 'signatureFileIdSnapshot', FALSE),
    ('ArchiveRecord', 'fileId', FALSE),
    ('PdfDocument', 'fileId', FALSE),
    ('ApprovalFormGenerationClaim', 'uploadedFileId', FALSE),
    ('ContractLayoutTemplateVersion', 'docxFileId', FALSE),
    ('ContractLayoutTemplateVersion', 'previewPdfFileId', FALSE),
    ('ContractLayoutPreviewJob', 'previewPdfFileId', FALSE),
    ('ContractBill', 'sourceExcelFileId', FALSE),
    ('ContractBillImport', 'fileId', FALSE),
    ('ContractGeneratedDocument', 'docxFileId', FALSE),
    ('ContractGeneratedDocument', 'pdfFileId', FALSE),
    ('ContractOfflineRevision', 'fileId', FALSE),
    ('ContractOfflineRevision', 'previewPdfFileId', FALSE);
$$;

DROP TRIGGER IF EXISTS jg_efb_employee_loan_repayment_voucher ON "EmployeeLoanRepayment";
CREATE TRIGGER jg_efb_employee_loan_repayment_voucher
BEFORE INSERT OR UPDATE OF "voucherFileId" ON "EmployeeLoanRepayment"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('voucherFileId', 'false');

COMMIT;
