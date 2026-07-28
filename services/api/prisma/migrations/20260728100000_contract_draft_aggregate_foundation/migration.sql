BEGIN;

ALTER TABLE "ContractVersion"
  ADD COLUMN "firstSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "latestDraftPreviewDocumentId" TEXT;

CREATE TABLE "ContractDraftEditLease" (
  "contractVersionId" TEXT NOT NULL,
  "holderUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "leaseRevision" INTEGER NOT NULL DEFAULT 1,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractDraftEditLease_pkey" PRIMARY KEY ("contractVersionId"),
  CONSTRAINT "ContractDraftEditLease_revision_check" CHECK ("leaseRevision" > 0),
  CONSTRAINT "ContractDraftEditLease_expiry_check" CHECK ("expiresAt" > "acquiredAt")
);

CREATE TABLE "ContractDraftAttachment" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "slotKey" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractDraftAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractDraftAttachment_slot_check" CHECK (length(btrim("slotKey")) > 0),
  CONSTRAINT "ContractDraftAttachment_order_check" CHECK ("displayOrder" >= 0)
);

CREATE TABLE "ContractDraftSaveRequest" (
  "idempotencyKey" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "resultRevision" INTEGER NOT NULL,
  "saveKind" TEXT NOT NULL,
  "requestSha256" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractDraftSaveRequest_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "ContractDraftSaveRequest_revision_check"
    CHECK ("expectedRevision" > 0 AND "resultRevision" >= "expectedRevision"),
  CONSTRAINT "ContractDraftSaveRequest_save_kind_check"
    CHECK ("saveKind" IN ('auto', 'manual')),
  CONSTRAINT "ContractDraftSaveRequest_sha256_check"
    CHECK ("requestSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContractDraftSaveRequest_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "ContractDraftSubmissionRequest" (
  "idempotencyKey" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "applicantUserId" TEXT NOT NULL,
  "requestSha256" TEXT NOT NULL,
  "approvalInstanceId" TEXT NOT NULL,
  "formalCode" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractDraftSubmissionRequest_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "ContractDraftSubmissionRequest_revision_check" CHECK ("expectedRevision" > 0),
  CONSTRAINT "ContractDraftSubmissionRequest_sha256_check"
    CHECK ("requestSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContractDraftSubmissionRequest_formal_code_check"
    CHECK (length(btrim("formalCode")) > 0)
);

CREATE UNIQUE INDEX "ContractDraftEditLease_tokenHash_key"
  ON "ContractDraftEditLease"("tokenHash");
CREATE INDEX "ContractDraftEditLease_holderUserId_idx"
  ON "ContractDraftEditLease"("holderUserId");
CREATE INDEX "ContractDraftEditLease_expiresAt_idx"
  ON "ContractDraftEditLease"("expiresAt");

CREATE UNIQUE INDEX "ContractDraftAttachment_contractVersionId_slotKey_displayOrder_key"
  ON "ContractDraftAttachment"("contractVersionId", "slotKey", "displayOrder");
CREATE UNIQUE INDEX "ContractDraftAttachment_contractVersionId_slotKey_fileId_key"
  ON "ContractDraftAttachment"("contractVersionId", "slotKey", "fileId");
CREATE INDEX "ContractDraftAttachment_fileId_idx"
  ON "ContractDraftAttachment"("fileId");
CREATE INDEX "ContractDraftAttachment_createdByUserId_idx"
  ON "ContractDraftAttachment"("createdByUserId");

CREATE INDEX "ContractDraftSaveRequest_contractVersionId_createdAt_idx"
  ON "ContractDraftSaveRequest"("contractVersionId", "createdAt");
CREATE INDEX "ContractDraftSaveRequest_createdByUserId_idx"
  ON "ContractDraftSaveRequest"("createdByUserId");
CREATE INDEX "ContractDraftSaveRequest_expiresAt_idx"
  ON "ContractDraftSaveRequest"("expiresAt");

CREATE UNIQUE INDEX "ContractDraftSubmissionRequest_approvalInstanceId_key"
  ON "ContractDraftSubmissionRequest"("approvalInstanceId");
CREATE INDEX "ContractDraftSubmissionRequest_contractVersionId_createdAt_idx"
  ON "ContractDraftSubmissionRequest"("contractVersionId", "createdAt");
CREATE INDEX "ContractDraftSubmissionRequest_applicantUserId_idx"
  ON "ContractDraftSubmissionRequest"("applicantUserId");

ALTER TABLE "ContractDraftEditLease"
  ADD CONSTRAINT "ContractDraftEditLease_contractVersion_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftEditLease_holder_fk"
  FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractDraftAttachment"
  ADD CONSTRAINT "ContractDraftAttachment_contractVersion_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftAttachment_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftAttachment_created_by_fk"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractDraftSaveRequest"
  ADD CONSTRAINT "ContractDraftSaveRequest_contractVersion_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftSaveRequest_created_by_fk"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractDraftSubmissionRequest"
  ADD CONSTRAINT "ContractDraftSubmissionRequest_contractVersion_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftSubmissionRequest_applicant_fk"
  FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractDraftSubmissionRequest_approval_instance_fk"
  FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_latest_draft_preview_document_fk"
  FOREIGN KEY ("latestDraftPreviewDocumentId") REFERENCES "ContractGeneratedDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 草稿附件与所有正式 FileObject 引用共用统一冲突清单和事务级锁。
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
    ('ContractDraftAttachment','fileId',FALSE),
    ('ContractGeneratedDocument','docxFileId',FALSE), ('ContractGeneratedDocument','pdfFileId',FALSE),
    ('ContractOfflineRevision','fileId',FALSE), ('ContractOfflineRevision','previewPdfFileId',FALSE);
$$;

CREATE TRIGGER jg_efb_contract_draft_attachment
BEFORE INSERT OR UPDATE OF "fileId" ON "ContractDraftAttachment"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'false');

COMMIT;
