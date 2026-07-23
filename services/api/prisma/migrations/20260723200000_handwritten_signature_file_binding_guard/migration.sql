-- Canvas 签名版本是新的非独占 FileObject 事实；必须纳入统一文件绑定清单，
-- 防止它复用任何独占凭证文件，同时不改写既有签名或业务数据。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "HandwrittenSignatureVersion" IN SHARE ROW EXCLUSIVE MODE;

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

DROP TRIGGER IF EXISTS jg_efb_handwritten_signature_version_file ON "HandwrittenSignatureVersion";
CREATE TRIGGER jg_efb_handwritten_signature_version_file
BEFORE INSERT OR UPDATE OF "fileId" ON "HandwrittenSignatureVersion"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'false');

COMMIT;
