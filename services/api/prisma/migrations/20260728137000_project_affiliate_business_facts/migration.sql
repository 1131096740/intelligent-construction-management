-- External affiliate downstream contracts, settlements, and payments are
-- immutable business facts. They never create company approval, seal, archive,
-- payment-request, or company-cash execution records.
BEGIN;

CREATE TABLE "ProjectAffiliateContractFact" (
  "id" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL DEFAULT 'original',
  "adjustsFactId" TEXT,
  "effectDirection" TEXT NOT NULL DEFAULT 'increase',
  "contractType" TEXT NOT NULL,
  "externalContractReference" TEXT NOT NULL,
  "counterpartyName" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "amountNature" TEXT NOT NULL,
  "amountCents" BIGINT,
  "advanceAllowed" BOOLEAN NOT NULL DEFAULT false,
  "advanceLimitCents" BIGINT,
  "advanceTermsSummary" TEXT,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "basisType" TEXT NOT NULL,
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

  CONSTRAINT "ProjectAffiliateContractFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliateContractFact_business_check" CHECK (
    "entryKind" IN ('original', 'correction', 'reversal')
    AND "effectDirection" IN ('increase', 'decrease')
    AND "contractType" IN (
      'material_purchase',
      'equipment_rental',
      'labor_subcontract',
      'professional_subcontract',
      'general_settlement',
      'general_direct_payment'
    )
    AND "amountNature" IN ('fixed', 'uncapped')
    AND (
      ("amountNature" = 'fixed' AND "amountCents" IS NOT NULL AND "amountCents" > 0)
      OR ("amountNature" = 'uncapped' AND "amountCents" IS NULL)
    )
    AND (
      ("entryKind" = 'original' AND "adjustsFactId" IS NULL AND "effectDirection" = 'increase')
      OR ("entryKind" <> 'original' AND "adjustsFactId" IS NOT NULL)
    )
    AND (
      ("advanceAllowed" = false
        AND "advanceLimitCents" IS NULL
        AND "advanceTermsSummary" IS NULL)
      OR
      ("advanceAllowed" = true
        AND "contractType" <> 'general_direct_payment'
        AND "advanceLimitCents" IS NOT NULL
        AND "advanceLimitCents" > 0
        AND "advanceTermsSummary" IS NOT NULL
        AND length(btrim("advanceTermsSummary")) > 0)
    )
    AND "basisType" IN ('written', 'oral')
    AND "documentVersion" >= 1
    AND length("requestFingerprint") = 64
    AND (
      ("basisType" = 'written'
        AND "evidenceFileId" IS NOT NULL
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND length("fileContentSha256Snapshot") = 64)
      OR
      ("basisType" = 'oral'
        AND (
          ("evidenceFileId" IS NULL AND "fileContentSha256Snapshot" IS NULL)
          OR ("evidenceFileId" IS NOT NULL
            AND "fileContentSha256Snapshot" IS NOT NULL
            AND length("fileContentSha256Snapshot") = 64)
        ))
    )
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
    )
  )
);

CREATE TABLE "ProjectAffiliateSettlementFact" (
  "id" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractLedgerId" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL DEFAULT 'original',
  "adjustsFactId" TEXT,
  "effectDirection" TEXT NOT NULL DEFAULT 'increase',
  "counterpartyName" TEXT NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "basisType" TEXT NOT NULL,
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

  CONSTRAINT "ProjectAffiliateSettlementFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliateSettlementFact_business_check" CHECK (
    "entryKind" IN ('original', 'correction', 'reversal')
    AND "effectDirection" IN ('increase', 'decrease')
    AND "amountCents" > 0
    AND (
      ("entryKind" = 'original' AND "adjustsFactId" IS NULL AND "effectDirection" = 'increase')
      OR ("entryKind" <> 'original' AND "adjustsFactId" IS NOT NULL)
    )
    AND "basisType" IN ('written', 'oral')
    AND "documentVersion" >= 1
    AND length("requestFingerprint") = 64
    AND (
      ("basisType" = 'written'
        AND "evidenceFileId" IS NOT NULL
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND length("fileContentSha256Snapshot") = 64)
      OR
      ("basisType" = 'oral'
        AND (
          ("evidenceFileId" IS NULL AND "fileContentSha256Snapshot" IS NULL)
          OR ("evidenceFileId" IS NOT NULL
            AND "fileContentSha256Snapshot" IS NOT NULL
            AND length("fileContentSha256Snapshot") = 64)
        ))
    )
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
    )
  )
);

CREATE TABLE "ProjectAffiliatePaymentFact" (
  "id" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractLedgerId" TEXT NOT NULL,
  "settlementLedgerId" TEXT,
  "entryKind" TEXT NOT NULL DEFAULT 'original',
  "adjustsFactId" TEXT,
  "effectDirection" TEXT NOT NULL DEFAULT 'increase',
  "counterpartyName" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "paymentKind" TEXT NOT NULL,
  "externalPaymentReference" TEXT,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "basisType" TEXT NOT NULL,
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

  CONSTRAINT "ProjectAffiliatePaymentFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliatePaymentFact_business_check" CHECK (
    "entryKind" IN ('original', 'correction', 'reversal')
    AND "effectDirection" IN ('increase', 'decrease')
    AND "paymentKind" IN ('normal', 'advance', 'direct_contract')
    AND "amountCents" > 0
    AND (
      ("entryKind" = 'original'
        AND "adjustsFactId" IS NULL
        AND "effectDirection" = 'increase'
        AND "externalPaymentReference" IS NOT NULL
        AND length(btrim("externalPaymentReference")) > 0)
      OR
      ("entryKind" <> 'original'
        AND "adjustsFactId" IS NOT NULL
        AND "externalPaymentReference" IS NULL)
    )
    AND "basisType" IN ('written', 'oral')
    AND "documentVersion" >= 1
    AND length("requestFingerprint") = 64
    AND (
      ("basisType" = 'written'
        AND "evidenceFileId" IS NOT NULL
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND length("fileContentSha256Snapshot") = 64)
      OR
      ("basisType" = 'oral'
        AND (
          ("evidenceFileId" IS NULL AND "fileContentSha256Snapshot" IS NULL)
          OR ("evidenceFileId" IS NOT NULL
            AND "fileContentSha256Snapshot" IS NOT NULL
            AND length("fileContentSha256Snapshot") = 64)
        ))
    )
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
    )
  )
);

CREATE TABLE "ProjectAffiliateBusinessEvidence" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "businessFactId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "documentVersion" INTEGER NOT NULL DEFAULT 1,
  "fileContentSha256Snapshot" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "recordedByRoleKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectAffiliateBusinessEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliateBusinessEvidence_business_check" CHECK (
    "businessType" IN ('contract', 'settlement', 'payment')
    AND "documentVersion" >= 1
    AND length("fileContentSha256Snapshot") = 64
    AND length(btrim("description")) > 0
  )
);

CREATE UNIQUE INDEX "ProjectAffiliateContractFact_idempotencyKey_key"
  ON "ProjectAffiliateContractFact"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectAffiliateContractFact_confirmationActionId_key"
  ON "ProjectAffiliateContractFact"("confirmationActionId");
CREATE UNIQUE INDEX "ProjectAffiliateContractFact_externalReference_original_key"
  ON "ProjectAffiliateContractFact"("projectId", "externalContractReference")
  WHERE "entryKind" = 'original';
CREATE UNIQUE INDEX "ProjectAffiliateContractFact_single_reversal_idx"
  ON "ProjectAffiliateContractFact"("adjustsFactId")
  WHERE "entryKind" = 'reversal';
CREATE INDEX "ProjectAffiliateContractFact_projectId_ledgerId_status_idx"
  ON "ProjectAffiliateContractFact"("projectId", "ledgerId", "status");
CREATE INDEX "ProjectAffiliateContractFact_adjustsFactId_idx"
  ON "ProjectAffiliateContractFact"("adjustsFactId");
CREATE INDEX "ProjectAffiliateContractFact_evidenceFileId_idx"
  ON "ProjectAffiliateContractFact"("evidenceFileId");
CREATE INDEX "ProjectAffiliateContractFact_externalContractReference_idx"
  ON "ProjectAffiliateContractFact"("externalContractReference");

CREATE UNIQUE INDEX "ProjectAffiliateSettlementFact_idempotencyKey_key"
  ON "ProjectAffiliateSettlementFact"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectAffiliateSettlementFact_confirmationActionId_key"
  ON "ProjectAffiliateSettlementFact"("confirmationActionId");
CREATE UNIQUE INDEX "ProjectAffiliateSettlementFact_single_reversal_idx"
  ON "ProjectAffiliateSettlementFact"("adjustsFactId")
  WHERE "entryKind" = 'reversal';
CREATE INDEX "ProjectAffiliateSettlementFact_projectId_ledgerId_status_idx"
  ON "ProjectAffiliateSettlementFact"("projectId", "ledgerId", "status");
CREATE INDEX "ProjectAffiliateSettlementFact_contractLedgerId_idx"
  ON "ProjectAffiliateSettlementFact"("contractLedgerId");
CREATE INDEX "ProjectAffiliateSettlementFact_adjustsFactId_idx"
  ON "ProjectAffiliateSettlementFact"("adjustsFactId");
CREATE INDEX "ProjectAffiliateSettlementFact_evidenceFileId_idx"
  ON "ProjectAffiliateSettlementFact"("evidenceFileId");

CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_idempotencyKey_key"
  ON "ProjectAffiliatePaymentFact"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_confirmationActionId_key"
  ON "ProjectAffiliatePaymentFact"("confirmationActionId");
CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_externalPaymentReference_original_key"
  ON "ProjectAffiliatePaymentFact"("externalPaymentReference")
  WHERE "entryKind" = 'original';
CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_single_reversal_idx"
  ON "ProjectAffiliatePaymentFact"("adjustsFactId")
  WHERE "entryKind" = 'reversal';
CREATE INDEX "ProjectAffiliatePaymentFact_projectId_ledgerId_status_idx"
  ON "ProjectAffiliatePaymentFact"("projectId", "ledgerId", "status");
CREATE INDEX "ProjectAffiliatePaymentFact_contractLedgerId_idx"
  ON "ProjectAffiliatePaymentFact"("contractLedgerId");
CREATE INDEX "ProjectAffiliatePaymentFact_settlementLedgerId_idx"
  ON "ProjectAffiliatePaymentFact"("settlementLedgerId");
CREATE INDEX "ProjectAffiliatePaymentFact_adjustsFactId_idx"
  ON "ProjectAffiliatePaymentFact"("adjustsFactId");
CREATE INDEX "ProjectAffiliatePaymentFact_evidenceFileId_idx"
  ON "ProjectAffiliatePaymentFact"("evidenceFileId");
CREATE INDEX "ProjectAffiliatePaymentFact_externalPaymentReference_idx"
  ON "ProjectAffiliatePaymentFact"("externalPaymentReference");

CREATE UNIQUE INDEX "ProjectAffiliateBusinessEvidence_idempotencyKey_key"
  ON "ProjectAffiliateBusinessEvidence"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectAffiliateBusinessEvidence_fileId_key"
  ON "ProjectAffiliateBusinessEvidence"("fileId");
CREATE INDEX "ProjectAffiliateBusinessEvidence_projectId_businessType_businessFactId_idx"
  ON "ProjectAffiliateBusinessEvidence"("projectId", "businessType", "businessFactId");

CREATE OR REPLACE FUNCTION "guard_project_affiliate_contract_fact_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'affiliate contract facts cannot be deleted';
  END IF;
  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed affiliate contract facts are append-only';
  END IF;
  IF ROW(
    NEW."ledgerId", NEW."projectId", NEW."entryKind", NEW."adjustsFactId",
    NEW."effectDirection", NEW."contractType", NEW."externalContractReference",
    NEW."counterpartyName", NEW."signedAt", NEW."amountNature", NEW."amountCents",
    NEW."advanceAllowed", NEW."advanceLimitCents", NEW."advanceTermsSummary",
    NEW."affiliateAssignmentId", NEW."affiliateBusinessPartyVersionId",
    NEW."affiliateNameSnapshot", NEW."basisType", NEW."description",
    NEW."evidenceFileId", NEW."documentVersion", NEW."fileContentSha256Snapshot",
    NEW."idempotencyKey", NEW."requestFingerprint", NEW."recordedByUserId",
    NEW."recordedByRoleKey"
  ) IS DISTINCT FROM ROW(
    OLD."ledgerId", OLD."projectId", OLD."entryKind", OLD."adjustsFactId",
    OLD."effectDirection", OLD."contractType", OLD."externalContractReference",
    OLD."counterpartyName", OLD."signedAt", OLD."amountNature", OLD."amountCents",
    OLD."advanceAllowed", OLD."advanceLimitCents", OLD."advanceTermsSummary",
    OLD."affiliateAssignmentId", OLD."affiliateBusinessPartyVersionId",
    OLD."affiliateNameSnapshot", OLD."basisType", OLD."description",
    OLD."evidenceFileId", OLD."documentVersion", OLD."fileContentSha256Snapshot",
    OLD."idempotencyKey", OLD."requestFingerprint", OLD."recordedByUserId",
    OLD."recordedByRoleKey"
  ) THEN
    RAISE EXCEPTION 'affiliate contract business fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_project_affiliate_settlement_fact_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'affiliate settlement facts cannot be deleted';
  END IF;
  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed affiliate settlement facts are append-only';
  END IF;
  IF ROW(
    NEW."ledgerId", NEW."projectId", NEW."contractLedgerId", NEW."entryKind",
    NEW."adjustsFactId", NEW."effectDirection", NEW."counterpartyName",
    NEW."settledAt", NEW."periodLabel", NEW."amountCents",
    NEW."affiliateAssignmentId", NEW."affiliateBusinessPartyVersionId",
    NEW."affiliateNameSnapshot", NEW."basisType", NEW."description",
    NEW."evidenceFileId", NEW."documentVersion", NEW."fileContentSha256Snapshot",
    NEW."idempotencyKey", NEW."requestFingerprint", NEW."recordedByUserId",
    NEW."recordedByRoleKey"
  ) IS DISTINCT FROM ROW(
    OLD."ledgerId", OLD."projectId", OLD."contractLedgerId", OLD."entryKind",
    OLD."adjustsFactId", OLD."effectDirection", OLD."counterpartyName",
    OLD."settledAt", OLD."periodLabel", OLD."amountCents",
    OLD."affiliateAssignmentId", OLD."affiliateBusinessPartyVersionId",
    OLD."affiliateNameSnapshot", OLD."basisType", OLD."description",
    OLD."evidenceFileId", OLD."documentVersion", OLD."fileContentSha256Snapshot",
    OLD."idempotencyKey", OLD."requestFingerprint", OLD."recordedByUserId",
    OLD."recordedByRoleKey"
  ) THEN
    RAISE EXCEPTION 'affiliate settlement business fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_project_affiliate_payment_fact_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'affiliate payment facts cannot be deleted';
  END IF;
  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed affiliate payment facts are append-only';
  END IF;
  IF ROW(
    NEW."ledgerId", NEW."projectId", NEW."contractLedgerId",
    NEW."settlementLedgerId", NEW."entryKind", NEW."adjustsFactId",
    NEW."effectDirection", NEW."counterpartyName", NEW."paidAt",
    NEW."amountCents", NEW."paymentKind", NEW."externalPaymentReference",
    NEW."affiliateAssignmentId", NEW."affiliateBusinessPartyVersionId",
    NEW."affiliateNameSnapshot", NEW."basisType", NEW."description",
    NEW."evidenceFileId", NEW."documentVersion", NEW."fileContentSha256Snapshot",
    NEW."idempotencyKey", NEW."requestFingerprint", NEW."recordedByUserId",
    NEW."recordedByRoleKey"
  ) IS DISTINCT FROM ROW(
    OLD."ledgerId", OLD."projectId", OLD."contractLedgerId",
    OLD."settlementLedgerId", OLD."entryKind", OLD."adjustsFactId",
    OLD."effectDirection", OLD."counterpartyName", OLD."paidAt",
    OLD."amountCents", OLD."paymentKind", OLD."externalPaymentReference",
    OLD."affiliateAssignmentId", OLD."affiliateBusinessPartyVersionId",
    OLD."affiliateNameSnapshot", OLD."basisType", OLD."description",
    OLD."evidenceFileId", OLD."documentVersion", OLD."fileContentSha256Snapshot",
    OLD."idempotencyKey", OLD."requestFingerprint", OLD."recordedByUserId",
    OLD."recordedByRoleKey"
  ) THEN
    RAISE EXCEPTION 'affiliate payment business fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_project_affiliate_business_evidence_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'affiliate business evidence is append-only';
END;
$$;

CREATE TRIGGER "ProjectAffiliateContractFact_append_only"
BEFORE UPDATE OR DELETE ON "ProjectAffiliateContractFact"
FOR EACH ROW EXECUTE FUNCTION "guard_project_affiliate_contract_fact_update"();
CREATE TRIGGER "ProjectAffiliateSettlementFact_append_only"
BEFORE UPDATE OR DELETE ON "ProjectAffiliateSettlementFact"
FOR EACH ROW EXECUTE FUNCTION "guard_project_affiliate_settlement_fact_update"();
CREATE TRIGGER "ProjectAffiliatePaymentFact_append_only"
BEFORE UPDATE OR DELETE ON "ProjectAffiliatePaymentFact"
FOR EACH ROW EXECUTE FUNCTION "guard_project_affiliate_payment_fact_update"();
CREATE TRIGGER "ProjectAffiliateBusinessEvidence_append_only"
BEFORE UPDATE OR DELETE ON "ProjectAffiliateBusinessEvidence"
FOR EACH ROW EXECUTE FUNCTION "guard_project_affiliate_business_evidence_update"();

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
    ('ProjectAffiliateContractFact','evidenceFileId',TRUE),
    ('ProjectAffiliateContractFact','confirmationSignatureFileId',FALSE),
    ('ProjectAffiliateSettlementFact','evidenceFileId',TRUE),
    ('ProjectAffiliateSettlementFact','confirmationSignatureFileId',FALSE),
    ('ProjectAffiliatePaymentFact','evidenceFileId',TRUE),
    ('ProjectAffiliatePaymentFact','confirmationSignatureFileId',FALSE),
    ('ProjectAffiliateBusinessEvidence','fileId',TRUE),
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

CREATE TRIGGER jg_efb_project_affiliate_contract_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ProjectAffiliateContractFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId', 'true');
CREATE TRIGGER jg_efb_project_affiliate_contract_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId" ON "ProjectAffiliateContractFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('confirmationSignatureFileId', 'false');
CREATE TRIGGER jg_efb_project_affiliate_settlement_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ProjectAffiliateSettlementFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId', 'true');
CREATE TRIGGER jg_efb_project_affiliate_settlement_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId" ON "ProjectAffiliateSettlementFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('confirmationSignatureFileId', 'false');
CREATE TRIGGER jg_efb_project_affiliate_payment_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ProjectAffiliatePaymentFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId', 'true');
CREATE TRIGGER jg_efb_project_affiliate_payment_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId" ON "ProjectAffiliatePaymentFact"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('confirmationSignatureFileId', 'false');
CREATE TRIGGER jg_efb_project_affiliate_supplemental_evidence
BEFORE INSERT OR UPDATE OF "fileId" ON "ProjectAffiliateBusinessEvidence"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

COMMIT;
