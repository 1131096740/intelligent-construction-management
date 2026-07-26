-- T03 foundation only: append the V2 lineage/process structures without reading,
-- backfilling, rewriting, or deleting any existing contract or settlement facts.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 27);

ALTER TABLE "Contract"
  ADD COLUMN "settlementClosedAt" TIMESTAMP(3),
  ADD COLUMN "finalSettlementId" TEXT;

ALTER TABLE "ContractBillRow"
  ADD COLUMN "lineageId" TEXT,
  ADD COLUMN "remainderDisposition" TEXT,
  ADD COLUMN "remainderDispositionReason" TEXT,
  ADD COLUMN "remainderDispositionByUserId" TEXT,
  ADD COLUMN "remainderDispositionAt" TIMESTAMP(3);

ALTER TABLE "SettlementDraft"
  ADD COLUMN "processId" TEXT,
  ADD COLUMN "periodStart" DATE,
  ADD COLUMN "periodEnd" DATE,
  ADD COLUMN "finalDeclarationVersion" INTEGER,
  ADD COLUMN "finalDeclarationSnapshot" JSONB,
  ADD COLUMN "calculationVersion" INTEGER,
  ADD COLUMN "sourceSnapshotToken" TEXT;

ALTER TABLE "Settlement"
  ADD COLUMN "processId" TEXT,
  ADD COLUMN "periodStart" DATE,
  ADD COLUMN "periodEnd" DATE,
  ADD COLUMN "finalDeclarationVersion" INTEGER,
  ADD COLUMN "finalDeclarationSnapshot" JSONB,
  ADD COLUMN "calculationVersion" INTEGER,
  ADD COLUMN "sourceSnapshotToken" TEXT;

ALTER TABLE "SettlementLine"
  ADD COLUMN "lineKey" TEXT,
  ADD COLUMN "contractBillRowLineageId" TEXT,
  ADD COLUMN "sourceContractVersionId" TEXT,
  ADD COLUMN "sourceItemType" TEXT,
  ADD COLUMN "occurredOn" DATE,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "pricingBasis" TEXT,
  ADD COLUMN "relatedSettlementLineId" TEXT,
  ADD COLUMN "overageReason" TEXT;

ALTER TABLE "ContractBillImport"
  ADD COLUMN "fileSha256" TEXT,
  ADD COLUMN "sourceContractVersionId" TEXT,
  ADD COLUMN "targetContractVersionId" TEXT,
  ADD COLUMN "expectedBillRevision" INTEGER,
  ADD COLUMN "mappingStatus" TEXT,
  ADD COLUMN "idempotencyKeyDigest" TEXT;

ALTER TABLE "SettlementImport"
  ADD COLUMN "settlementDraftId" TEXT,
  ADD COLUMN "expectedDraftRevision" INTEGER,
  ADD COLUMN "idempotencyKeyDigest" TEXT;

ALTER TABLE "SettlementSignedDocument"
  ADD COLUMN "fileFactsSnapshot" JSONB,
  ADD COLUMN "reviewSnapshot" JSONB,
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "derivedFromDocumentId" TEXT,
  ADD COLUMN "normalizationStatus" TEXT;

CREATE TABLE "ContractBillRowLineage" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "createdInContractVersionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractBillRowLineage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractBillRowTransition" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "fromContractVersionId" TEXT NOT NULL,
  "toContractVersionId" TEXT NOT NULL,
  "sourceContractBillRowId" TEXT NOT NULL,
  "targetContractBillRowId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "matchBasis" TEXT NOT NULL,
  "sourceSettledQuantityAllocated" DECIMAL(24,6),
  "targetOpeningQuantity" DECIMAL(24,6),
  "settledAmountAllocatedCents" BIGINT,
  "quantityConversionBasis" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractBillRowTransition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractBillRowCarryForward" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "contractBillRowId" TEXT NOT NULL,
  "lineageId" TEXT NOT NULL,
  "priorSettledQuantity" DECIMAL(24,6),
  "priorSettledAmountCents" BIGINT NOT NULL DEFAULT 0,
  "sourceSnapshotHash" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractBillRowCarryForward_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractBillRowCarryForward_contractBillRowId_key" UNIQUE ("contractBillRowId")
);

CREATE TABLE "ContractSettlementProcess" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "settlementDraftId" TEXT,
  "settlementId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "periodStart" DATE,
  "periodEnd" DATE,
  "isFinal" BOOLEAN NOT NULL DEFAULT FALSE,
  "endedAt" TIMESTAMP(3),
  "endedByUserId" TEXT,
  "endedReason" TEXT,
  "invalidatedByContractVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractSettlementProcess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractSettlementProcess_contract_sequence_key" UNIQUE ("contractId", "sequenceNo"),
  CONSTRAINT "ContractSettlementProcess_settlementDraftId_key" UNIQUE ("settlementDraftId"),
  CONSTRAINT "ContractSettlementProcess_settlementId_key" UNIQUE ("settlementId")
);

CREATE TABLE "SettlementDraftLine" (
  "id" TEXT NOT NULL,
  "settlementDraftId" TEXT NOT NULL,
  "lineKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "contractBillRowId" TEXT,
  "contractBillRowLineageId" TEXT,
  "relatedSettlementLineId" TEXT,
  "sourceItemType" TEXT,
  "occurredOn" DATE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "unit" TEXT,
  "quantity" DECIMAL(24,6),
  "unitPriceCents" BIGINT,
  "directAmountCents" BIGINT,
  "calculationMode" TEXT NOT NULL,
  "pricingBasis" TEXT,
  "overageReason" TEXT,
  "reason" TEXT,
  "remark" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementDraftLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementDraftLine_draft_line_key" UNIQUE ("settlementDraftId", "lineKey")
);

CREATE TABLE "SettlementLineAttachment" (
  "id" TEXT NOT NULL,
  "settlementDraftLineId" TEXT,
  "settlementLineId" TEXT,
  "fileId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementLineAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contract_finalSettlementId_key" ON "Contract"("finalSettlementId");
CREATE UNIQUE INDEX "SettlementDraft_processId_key" ON "SettlementDraft"("processId");
CREATE UNIQUE INDEX "Settlement_processId_key" ON "Settlement"("processId");
CREATE UNIQUE INDEX "ContractBillRowTransition_version_source_target_key"
  ON "ContractBillRowTransition"("fromContractVersionId", "toContractVersionId", "sourceContractBillRowId", "targetContractBillRowId");
CREATE UNIQUE INDEX "ContractSettlementProcess_one_open_per_contract_idx"
  ON "ContractSettlementProcess"("contractId") WHERE "status" = 'open';
CREATE INDEX "ContractBillRowLineage_contractId_status_idx" ON "ContractBillRowLineage"("contractId", "status");
CREATE INDEX "ContractBillRowLineage_createdInContractVersionId_idx" ON "ContractBillRowLineage"("createdInContractVersionId");
CREATE INDEX "ContractBillRowTransition_contractId_status_idx" ON "ContractBillRowTransition"("contractId", "status");
CREATE INDEX "ContractBillRowTransition_toContractVersionId_status_idx" ON "ContractBillRowTransition"("toContractVersionId", "status");
CREATE INDEX "ContractBillRowCarryForward_contractVersionId_idx" ON "ContractBillRowCarryForward"("contractVersionId");
CREATE INDEX "ContractBillRowCarryForward_lineageId_idx" ON "ContractBillRowCarryForward"("lineageId");
CREATE INDEX "ContractSettlementProcess_contractId_status_idx" ON "ContractSettlementProcess"("contractId", "status");
CREATE INDEX "ContractSettlementProcess_contractVersionId_status_idx" ON "ContractSettlementProcess"("contractVersionId", "status");
CREATE INDEX "SettlementDraftLine_contractBillRowId_idx" ON "SettlementDraftLine"("contractBillRowId");
CREATE INDEX "SettlementDraftLine_contractBillRowLineageId_idx" ON "SettlementDraftLine"("contractBillRowLineageId");
CREATE INDEX "SettlementDraftLine_relatedSettlementLineId_idx" ON "SettlementDraftLine"("relatedSettlementLineId");
CREATE INDEX "SettlementLineAttachment_settlementDraftLineId_idx" ON "SettlementLineAttachment"("settlementDraftLineId");
CREATE INDEX "SettlementLineAttachment_settlementLineId_idx" ON "SettlementLineAttachment"("settlementLineId");
CREATE INDEX "SettlementLineAttachment_fileId_idx" ON "SettlementLineAttachment"("fileId");
CREATE INDEX "ContractBillRow_lineageId_idx" ON "ContractBillRow"("lineageId");
CREATE INDEX "Settlement_contractId_status_idx" ON "Settlement"("contractId", "status");
CREATE INDEX "Settlement_contractId_periodEnd_idx" ON "Settlement"("contractId", "periodEnd");
CREATE INDEX "SettlementDraft_contractId_status_idx" ON "SettlementDraft"("contractId", "status");
CREATE INDEX "SettlementLine_contractBillRowLineageId_idx" ON "SettlementLine"("contractBillRowLineageId");
CREATE INDEX "SettlementLine_relatedSettlementLineId_idx" ON "SettlementLine"("relatedSettlementLineId");
CREATE INDEX "SettlementImport_settlementDraftId_idx" ON "SettlementImport"("settlementDraftId");

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_finalSettlementId_fkey" FOREIGN KEY ("finalSettlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Contract_final_settlement_closure_check" CHECK (("settlementClosedAt" IS NULL) = ("finalSettlementId" IS NULL)) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "ContractBillRowLineage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRow_remainderDispositionByUserId_fkey" FOREIGN KEY ("remainderDispositionByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRow_remainder_disposition_check" CHECK (
    "remainderDisposition" IS NULL OR "remainderDisposition" IN ('active', 'cancelled')
  ) NOT VALID,
  ADD CONSTRAINT "ContractBillRow_remainder_cancellation_check" CHECK (
    "remainderDisposition" <> 'cancelled' OR ("remainderDispositionReason" IS NOT NULL AND "remainderDispositionByUserId" IS NOT NULL AND "remainderDispositionAt" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ContractSettlementProcess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementDraft_period_check" CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" >= "periodStart") NOT VALID;
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ContractSettlementProcess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Settlement_period_check" CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" >= "periodStart") NOT VALID;
ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_contractBillRowLineageId_fkey" FOREIGN KEY ("contractBillRowLineageId") REFERENCES "ContractBillRowLineage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLine_sourceContractVersionId_fkey" FOREIGN KEY ("sourceContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLine_relatedSettlementLineId_fkey" FOREIGN KEY ("relatedSettlementLineId") REFERENCES "SettlementLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ContractBillImport"
  ADD CONSTRAINT "ContractBillImport_sourceContractVersionId_fkey" FOREIGN KEY ("sourceContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillImport_targetContractVersionId_fkey" FOREIGN KEY ("targetContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillImport_mappingStatus_check" CHECK ("mappingStatus" IS NULL OR "mappingStatus" IN ('resolved', 'pending', 'rejected')) NOT VALID;
ALTER TABLE "SettlementImport"
  ADD CONSTRAINT "SettlementImport_settlementDraftId_fkey" FOREIGN KEY ("settlementDraftId") REFERENCES "SettlementDraft"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SettlementSignedDocument"
  ADD CONSTRAINT "SettlementSignedDocument_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementSignedDocument_derivedFromDocumentId_fkey" FOREIGN KEY ("derivedFromDocumentId") REFERENCES "SettlementSignedDocument"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ContractBillRowLineage"
  ADD CONSTRAINT "ContractBillRowLineage_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowLineage_createdInContractVersionId_fkey" FOREIGN KEY ("createdInContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowLineage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowLineage_status_check" CHECK ("status" IN ('active', 'retired')) NOT VALID;
ALTER TABLE "ContractBillRowTransition"
  ADD CONSTRAINT "ContractBillRowTransition_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_fromContractVersionId_fkey" FOREIGN KEY ("fromContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_toContractVersionId_fkey" FOREIGN KEY ("toContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_sourceContractBillRowId_fkey" FOREIGN KEY ("sourceContractBillRowId") REFERENCES "ContractBillRow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_targetContractBillRowId_fkey" FOREIGN KEY ("targetContractBillRowId") REFERENCES "ContractBillRow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowTransition_relationType_check" CHECK ("relationType" IN ('one_to_one', 'split', 'merge')) NOT VALID,
  ADD CONSTRAINT "ContractBillRowTransition_matchBasis_check" CHECK ("matchBasis" IN ('clone_row_key', 'manual', 'excel_mapping', 'backfill_row_key')) NOT VALID,
  ADD CONSTRAINT "ContractBillRowTransition_status_check" CHECK ("status" IN ('draft', 'confirmed', 'invalidated')) NOT VALID,
  ADD CONSTRAINT "ContractBillRowTransition_confirmation_check" CHECK ("status" <> 'confirmed' OR ("confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT "ContractBillRowTransition_revision_check" CHECK ("revision" > 0) NOT VALID;
ALTER TABLE "ContractBillRowCarryForward"
  ADD CONSTRAINT "ContractBillRowCarryForward_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowCarryForward_contractBillRowId_fkey" FOREIGN KEY ("contractBillRowId") REFERENCES "ContractBillRow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowCarryForward_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "ContractBillRowLineage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowCarryForward_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractBillRowCarryForward_amount_check" CHECK ("priorSettledAmountCents" >= 0) NOT VALID,
  ADD CONSTRAINT "ContractBillRowCarryForward_confirmation_check" CHECK ("confirmedAt" IS NULL OR "confirmedByUserId" IS NOT NULL) NOT VALID;
ALTER TABLE "ContractSettlementProcess"
  ADD CONSTRAINT "ContractSettlementProcess_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_settlementDraftId_fkey" FOREIGN KEY ("settlementDraftId") REFERENCES "SettlementDraft"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_invalidatedByContractVersionId_fkey" FOREIGN KEY ("invalidatedByContractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ContractSettlementProcess_status_check" CHECK ("status" IN ('open', 'effective', 'voided', 'invalidated')) NOT VALID,
  ADD CONSTRAINT "ContractSettlementProcess_period_check" CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" >= "periodStart") NOT VALID;
ALTER TABLE "SettlementDraftLine"
  ADD CONSTRAINT "SettlementDraftLine_settlementDraftId_fkey" FOREIGN KEY ("settlementDraftId") REFERENCES "SettlementDraft"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementDraftLine_contractBillRowId_fkey" FOREIGN KEY ("contractBillRowId") REFERENCES "ContractBillRow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementDraftLine_contractBillRowLineageId_fkey" FOREIGN KEY ("contractBillRowLineageId") REFERENCES "ContractBillRowLineage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementDraftLine_relatedSettlementLineId_fkey" FOREIGN KEY ("relatedSettlementLineId") REFERENCES "SettlementLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementDraftLine_sourceType_check" CHECK ("sourceType" IN ('contract_bill_row', 'signature_change', 'adjustment')) NOT VALID,
  ADD CONSTRAINT "SettlementDraftLine_calculationMode_check" CHECK ("calculationMode" IN ('quantity_price', 'direct_amount')) NOT VALID,
  ADD CONSTRAINT "SettlementDraftLine_calculation_fields_check" CHECK (
    ("calculationMode" = 'quantity_price' AND "quantity" IS NOT NULL AND "unitPriceCents" IS NOT NULL AND "directAmountCents" IS NULL)
    OR ("calculationMode" = 'direct_amount' AND "directAmountCents" IS NOT NULL AND "quantity" IS NULL AND "unitPriceCents" IS NULL)
  ) NOT VALID;
ALTER TABLE "SettlementLineAttachment"
  ADD CONSTRAINT "SettlementLineAttachment_settlementDraftLineId_fkey" FOREIGN KEY ("settlementDraftLineId") REFERENCES "SettlementDraftLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLineAttachment_settlementLineId_fkey" FOREIGN KEY ("settlementLineId") REFERENCES "SettlementLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLineAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLineAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "SettlementLineAttachment_parent_check" CHECK (("settlementDraftLineId" IS NULL) <> ("settlementLineId" IS NULL)) NOT VALID,
  ADD CONSTRAINT "SettlementLineAttachment_purpose_check" CHECK (btrim("purpose") <> '') NOT VALID,
  ADD CONSTRAINT "SettlementLineAttachment_status_check" CHECK ("status" IN ('active', 'invalidated')) NOT VALID;

-- Keep the unified private-file binding catalog complete. Attachments are non-exclusive:
-- the same source evidence may be referenced by both the draft and submitted line facts.
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
    ('SettlementLineAttachment','fileId',FALSE),
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

COMMIT;
