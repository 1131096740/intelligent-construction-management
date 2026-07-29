-- Separate owner payments, affiliate remittances, affiliate deductions, and
-- unresolved receipt differences. New facts are append-only and never share
-- the legacy ProjectReceipt cash bucket.
BEGIN;

CREATE TABLE "ProjectUpstreamFundFact" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "factType" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL DEFAULT 'original',
  "adjustsFactId" TEXT,
  "effectDirection" TEXT NOT NULL DEFAULT 'increase',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "counterpartyName" TEXT NOT NULL,
  "basisType" TEXT NOT NULL,
  "deductionCategory" TEXT,
  "upstreamSettlementId" TEXT,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "description" TEXT,
  "evidenceFileId" TEXT,
  "documentVersion" INTEGER NOT NULL DEFAULT 1,
  "fileContentSha256Snapshot" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "recordedByRoleKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_confirm',
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationActionId" TEXT,
  "confirmationSignatureVersionId" TEXT,
  "confirmationSignatureFileId" TEXT,
  "confirmationSignatureSha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectUpstreamFundFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectUpstreamFundFact_business_check" CHECK (
    "factType" IN (
      'owner_payment_to_affiliate',
      'affiliate_remittance_to_company',
      'affiliate_deduction',
      'unreconciled_receipt_difference'
    )
    AND "entryKind" IN ('original', 'correction', 'reversal', 'reclassification')
    AND "effectDirection" IN ('increase', 'decrease')
    AND "amountCents" > 0
    AND "basisType" IN ('written', 'oral')
    AND "documentVersion" >= 1
    AND length("requestFingerprint") = 64
    AND (
      ("entryKind" = 'original' AND "adjustsFactId" IS NULL)
      OR
      ("entryKind" <> 'original' AND "adjustsFactId" IS NOT NULL)
    )
    AND (
      ("factType" = 'affiliate_deduction' AND "deductionCategory" IN (
        'management_fee',
        'tax',
        'deposit',
        'insurance',
        'other'
      ))
      OR
      ("factType" <> 'affiliate_deduction' AND "deductionCategory" IS NULL)
    )
    AND (
      ("basisType" = 'written'
        AND "evidenceFileId" IS NOT NULL
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND length("fileContentSha256Snapshot") = 64)
      OR
      ("basisType" = 'oral'
        AND (
          ("evidenceFileId" IS NULL AND "fileContentSha256Snapshot" IS NULL)
          OR
          ("evidenceFileId" IS NOT NULL
            AND "fileContentSha256Snapshot" IS NOT NULL
            AND length("fileContentSha256Snapshot") = 64)
        ))
    )
    AND (
      ("factType" = 'unreconciled_receipt_difference'
        AND "status" = 'pending_reconciliation'
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
        AND "confirmationActionId" IS NULL
        AND "confirmationSignatureVersionId" IS NULL
        AND "confirmationSignatureFileId" IS NULL
        AND "confirmationSignatureSha256" IS NULL)
      OR
      ("factType" <> 'unreconciled_receipt_difference'
        AND (
          ("status" = 'pending_confirm'
            AND "confirmedByUserId" IS NULL
            AND "confirmedAt" IS NULL
            AND "confirmationActionId" IS NULL
            AND "confirmationSignatureVersionId" IS NULL
            AND "confirmationSignatureFileId" IS NULL
            AND "confirmationSignatureSha256" IS NULL)
          OR
          ("status" = 'confirmed'
            AND "confirmedByUserId" IS NOT NULL
            AND "confirmedAt" IS NOT NULL
            AND "confirmationActionId" IS NOT NULL
            AND "confirmationSignatureVersionId" IS NOT NULL
            AND "confirmationSignatureFileId" IS NOT NULL
            AND length("confirmationSignatureSha256") = 64)
        ))
    )
  )
);

CREATE UNIQUE INDEX "ProjectUpstreamFundFact_idempotencyKey_key"
  ON "ProjectUpstreamFundFact"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectUpstreamFundFact_confirmationActionId_key"
  ON "ProjectUpstreamFundFact"("confirmationActionId");
CREATE UNIQUE INDEX "ProjectUpstreamFundFact_single_reversal_idx"
  ON "ProjectUpstreamFundFact"("adjustsFactId")
  WHERE "entryKind" = 'reversal';
CREATE INDEX "ProjectUpstreamFundFact_projectId_factType_status_occurredAt_idx"
  ON "ProjectUpstreamFundFact"("projectId", "factType", "status", "occurredAt");
CREATE INDEX "ProjectUpstreamFundFact_adjustsFactId_idx"
  ON "ProjectUpstreamFundFact"("adjustsFactId");
CREATE INDEX "ProjectUpstreamFundFact_upstreamSettlementId_idx"
  ON "ProjectUpstreamFundFact"("upstreamSettlementId");
CREATE INDEX "ProjectUpstreamFundFact_evidenceFileId_idx"
  ON "ProjectUpstreamFundFact"("evidenceFileId");

CREATE OR REPLACE FUNCTION "guard_project_upstream_fund_fact_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'upstream fund facts cannot be deleted';
  END IF;

  IF OLD."status" IN ('confirmed', 'pending_reconciliation') THEN
    RAISE EXCEPTION 'confirmed upstream fund facts are append-only';
  END IF;

  IF ROW(
    NEW."projectId", NEW."factType", NEW."entryKind", NEW."adjustsFactId",
    NEW."effectDirection", NEW."occurredAt", NEW."amountCents",
    NEW."counterpartyName", NEW."basisType", NEW."deductionCategory",
    NEW."upstreamSettlementId", NEW."affiliateAssignmentId",
    NEW."affiliateBusinessPartyVersionId", NEW."affiliateNameSnapshot",
    NEW."description", NEW."evidenceFileId", NEW."documentVersion",
    NEW."fileContentSha256Snapshot", NEW."idempotencyKey",
    NEW."requestFingerprint",
    NEW."recordedByUserId", NEW."recordedByRoleKey"
  ) IS DISTINCT FROM ROW(
    OLD."projectId", OLD."factType", OLD."entryKind", OLD."adjustsFactId",
    OLD."effectDirection", OLD."occurredAt", OLD."amountCents",
    OLD."counterpartyName", OLD."basisType", OLD."deductionCategory",
    OLD."upstreamSettlementId", OLD."affiliateAssignmentId",
    OLD."affiliateBusinessPartyVersionId", OLD."affiliateNameSnapshot",
    OLD."description", OLD."evidenceFileId", OLD."documentVersion",
    OLD."fileContentSha256Snapshot", OLD."idempotencyKey",
    OLD."requestFingerprint",
    OLD."recordedByUserId", OLD."recordedByRoleKey"
  ) THEN
    RAISE EXCEPTION 'upstream fund business facts are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectUpstreamFundFact_append_only"
BEFORE UPDATE OR DELETE ON "ProjectUpstreamFundFact"
FOR EACH ROW
EXECUTE FUNCTION "guard_project_upstream_fund_fact_update"();

-- Keep both the uploaded evidence and the frozen confirmation signature in the
-- shared private-file binding manifest. Both are non-exclusive references, but
-- neither may reuse a file already owned by an exclusive business fact.
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
    ('ProjectUpstreamSettlement','voucherFileId',FALSE),
    ('ProjectUpstreamSettlement','confirmationSignatureFileId',FALSE),
    ('ProjectUpstreamFundFact','evidenceFileId',FALSE),
    ('ProjectUpstreamFundFact','confirmationSignatureFileId',FALSE),
    ('ProjectOwnerContract','fileId',FALSE),
    ('ProjectSettlementExceptionQuota','attachmentFileId',FALSE), ('ProjectFinancingQuota','attachmentFileId',FALSE),
    ('ProjectFinancingQuota','terminationSignatureFileId',FALSE),
    ('EmployeeLoanRepayment','voucherFileId',FALSE), ('EmployeeProjectLoanEntry','voucherFileId',FALSE),
    ('ApprovalActionLog','signatureFileIdSnapshot',FALSE), ('ArchiveRecord','fileId',FALSE), ('PdfDocument','fileId',FALSE),
    ('ApprovalFormGenerationClaim','uploadedFileId',FALSE), ('ContractLayoutTemplateVersion','docxFileId',FALSE),
    ('ContractLayoutTemplateVersion','previewPdfFileId',FALSE), ('ContractLayoutPreviewJob','previewPdfFileId',FALSE),
    ('ContractBill','sourceExcelFileId',FALSE), ('ContractBillImport','fileId',FALSE),
    ('ContractDraftAttachment','fileId',FALSE),
    ('ContractGeneratedDocument','docxFileId',FALSE), ('ContractGeneratedDocument','pdfFileId',FALSE),
    ('ContractOfflineRevision','fileId',FALSE), ('ContractOfflineRevision','previewPdfFileId',FALSE),
    ('ContractTakeoverSettlementEvidence','fileId',TRUE),
    ('ContractTakeoverExcessEvidence','fileId',TRUE),
    ('ContractTakeoverHistoricalPaymentVoucher','fileId',TRUE);
$$;

CREATE TRIGGER jg_efb_project_upstream_fund_fact_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId"
ON "ProjectUpstreamFundFact"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'evidenceFileId',
  'false'
);

CREATE TRIGGER jg_efb_project_upstream_fund_fact_confirmation_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId"
ON "ProjectUpstreamFundFact"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'confirmationSignatureFileId',
  'false'
);

CREATE TRIGGER jg_efb_project_upstream_settlement_confirmation_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId"
ON "ProjectUpstreamSettlement"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'confirmationSignatureFileId',
  'false'
);

COMMIT;
