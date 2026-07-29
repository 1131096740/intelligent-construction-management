BEGIN;

SELECT pg_advisory_xact_lock(190731, 28);
SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "ProjectFinancingQuota" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ContractTakeoverCorrection"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "correctionScope" TEXT,
  ADD COLUMN "correctionOperation" TEXT,
  ADD COLUMN "targetRevision" INTEGER,
  ADD COLUMN "targetBalanceRevision" INTEGER,
  ADD COLUMN "deltaSnapshot" JSONB,
  ADD COLUMN "targetHistoricalPaymentId" TEXT,
  ADD COLUMN "targetAllocationId" TEXT,
  ADD COLUMN "targetBalanceEntryId" TEXT,
  ADD COLUMN "applicationIdempotencyKey" TEXT,
  ADD COLUMN "appliedByUserId" TEXT,
  ADD COLUMN "appliedAt" TIMESTAMP(3);

-- Every pre-existing row remains the historical informational/company-entity
-- contract. No old row is inferred into a monetary correction.
UPDATE "ContractTakeoverCorrection"
SET "schemaVersion" = 1
WHERE "schemaVersion" <> 1;

ALTER TABLE "ContractTakeoverCorrection"
  DROP CONSTRAINT "ContractTakeoverCorrection_status_check",
  DROP CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check";

ALTER TABLE "ContractTakeoverCorrection"
  ADD CONSTRAINT "ContractTakeoverCorrection_schema_version_check"
    CHECK ("schemaVersion" IN (1, 2)),
  ADD CONSTRAINT "ContractTakeoverCorrection_status_check"
    CHECK (
      (
        "schemaVersion" = 1
        AND "status" IN ('submitted', 'confirmed', 'rejected')
      )
      OR (
        "schemaVersion" = 2
        AND "status" IN ('draft', 'submitted', 'applied', 'rejected')
      )
    ),
  ADD CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check"
    CHECK (
      "correctionType" <> 'company_entity'
      OR (
        "schemaVersion" = 1
        AND "targetCompanyEntityId" IS NOT NULL
        AND "submittedByUserId" IS NOT NULL
        AND "submittedByUserId" = "createdByUserId"
        AND "submittedAt" IS NOT NULL
        AND (
          "status" = 'submitted'
          OR (
            "reviewedByUserId" IS NOT NULL
            AND "reviewedByUserId" <> "createdByUserId"
            AND "reviewedAt" IS NOT NULL
          )
        )
      )
    ),
  ADD CONSTRAINT "ContractTakeoverCorrection_v2_shape_check"
    CHECK (
      "schemaVersion" <> 2
      OR (
        "correctionScope" IN (
          'historical_settlement',
          'historical_payment',
          'historical_advance',
          'abnormal_overpay'
        )
        AND "correctionOperation" IN (
          'correction',
          'reclassification',
          'reversal'
        )
        AND "targetRevision" > 0
        AND "applicationIdempotencyKey" IS NOT NULL
        AND NULLIF(BTRIM("applicationIdempotencyKey"), '') IS NOT NULL
        AND "deltaSnapshot" IS NOT NULL
        AND (
          (
            "status" = 'draft'
            AND "submittedByUserId" IS NULL
            AND "submittedAt" IS NULL
            AND "reviewedByUserId" IS NULL
            AND "reviewedAt" IS NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
          OR
          (
            "status" = 'submitted'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NULL
            AND "reviewedAt" IS NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
          OR (
            "status" = 'applied'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NOT NULL
            AND "reviewedByUserId" <> "createdByUserId"
            AND "reviewedAt" IS NOT NULL
            AND "appliedByUserId" = "reviewedByUserId"
            AND "appliedAt" = "reviewedAt"
          )
          OR (
            "status" = 'rejected'
            AND "submittedByUserId" = "createdByUserId"
            AND "submittedAt" IS NOT NULL
            AND "reviewedByUserId" IS NOT NULL
            AND "reviewedByUserId" <> "createdByUserId"
            AND "reviewedAt" IS NOT NULL
            AND "appliedByUserId" IS NULL
            AND "appliedAt" IS NULL
          )
        )
      )
    ),
  ADD CONSTRAINT "ContractTakeoverCorrection_v2_target_check"
    CHECK (
      "schemaVersion" <> 2
      OR (
        (
          "correctionOperation" = 'correction'
          AND (
            (
              "correctionScope" = 'historical_settlement'
              AND "targetBalanceRevision" IS NULL
              AND "targetHistoricalPaymentId" IS NULL
              AND "targetAllocationId" IS NULL
              AND "targetBalanceEntryId" IS NULL
            )
            OR (
              "correctionScope" = 'historical_payment'
              AND "targetHistoricalPaymentId" IS NOT NULL
              AND "targetAllocationId" IS NOT NULL
              AND "targetBalanceEntryId" IS NULL
            )
            OR (
              "correctionScope" IN ('historical_advance', 'abnormal_overpay')
              AND "targetBalanceRevision" > 0
              AND "targetHistoricalPaymentId" IS NULL
              AND "targetAllocationId" IS NULL
              AND "targetBalanceEntryId" IS NULL
            )
          )
        )
        OR (
          "correctionOperation" = 'reclassification'
          AND "correctionScope" IN ('historical_advance', 'abnormal_overpay')
          AND "targetBalanceRevision" > 0
          AND "targetAllocationId" IS NOT NULL
          AND "targetBalanceEntryId" IS NULL
        )
        OR (
          "correctionOperation" = 'reversal'
          AND "correctionScope" IN ('historical_advance', 'abnormal_overpay')
          AND "targetBalanceRevision" > 0
          AND "targetBalanceEntryId" IS NOT NULL
        )
      )
    );

CREATE UNIQUE INDEX "ContractTakeoverCorrection_applicationIdempotencyKey_key"
  ON "ContractTakeoverCorrection"("applicationIdempotencyKey");
CREATE INDEX "ContractTakeoverCorrection_takeover_schema_status_idx"
  ON "ContractTakeoverCorrection"("takeoverId", "schemaVersion", "status");
CREATE INDEX "ContractTakeoverCorrection_targetHistoricalPaymentId_idx"
  ON "ContractTakeoverCorrection"("targetHistoricalPaymentId");
CREATE INDEX "ContractTakeoverCorrection_targetAllocationId_idx"
  ON "ContractTakeoverCorrection"("targetAllocationId");
CREATE INDEX "ContractTakeoverCorrection_targetBalanceEntryId_idx"
  ON "ContractTakeoverCorrection"("targetBalanceEntryId");

ALTER TABLE "ContractTakeoverCorrection"
  ADD CONSTRAINT "ContractTakeoverCorrection_targetHistoricalPaymentId_fkey"
  FOREIGN KEY ("targetHistoricalPaymentId")
  REFERENCES "ContractTakeoverHistoricalPayment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverCorrection_targetAllocationId_fkey"
  FOREIGN KEY ("targetAllocationId")
  REFERENCES "ContractTakeoverHistoricalPaymentAllocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverCorrection_targetBalanceEntryId_fkey"
  FOREIGN KEY ("targetBalanceEntryId")
  REFERENCES "ContractTakeoverBalanceEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractTakeoverCorrection_appliedByUserId_fkey"
  FOREIGN KEY ("appliedByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- New schemaVersion=2 corrections always use a dedicated file. Existing
-- informational rows are left untouched; this trigger governs all new writes.
CREATE OR REPLACE FUNCTION jg_has_exclusive_file_business_binding(
  candidate_file_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
PARALLEL RESTRICTED
AS $$
DECLARE
  binding RECORD;
  binding_exists BOOLEAN;
BEGIN
  FOR binding IN
    SELECT *
    FROM jg_file_business_collision_columns()
    WHERE "exclusive"
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)',
      binding."tableName",
      binding."columnName"
    )
    INTO binding_exists
    USING candidate_file_id;
    IF binding_exists THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN EXISTS (
    SELECT 1
    FROM "ContractTakeoverCorrection"
    WHERE "attachmentFileId" = candidate_file_id
      AND (
        "correctionType" = 'company_entity'
        OR "schemaVersion" = 2
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION jg_enforce_exclusive_file_business_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_file_id TEXT;
  previous_file_id TEXT;
  current_binding RECORD;
  binding_exists BOOLEAN;
  current_is_exclusive BOOLEAN := TG_ARGV[1]::BOOLEAN;
  previous_is_exclusive BOOLEAN := TG_ARGV[1]::BOOLEAN;
BEGIN
  candidate_file_id := NULLIF(
    BTRIM(to_jsonb(NEW) ->> TG_ARGV[0]),
    ''
  );
  IF candidate_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ContractTakeoverCorrection' THEN
    current_is_exclusive :=
      NEW."correctionType" = 'company_entity'
      OR NEW."schemaVersion" = 2;
    IF TG_OP = 'UPDATE' THEN
      previous_is_exclusive :=
        OLD."correctionType" = 'company_entity'
        OR OLD."schemaVersion" = 2;
      IF previous_is_exclusive AND NOT current_is_exclusive THEN
        RAISE EXCEPTION '历史更正附件绑定类型不能变更'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_file_id := NULLIF(
      BTRIM(to_jsonb(OLD) ->> TG_ARGV[0]),
      ''
    );
    IF previous_file_id IS NOT DISTINCT FROM candidate_file_id
       AND previous_is_exclusive = current_is_exclusive THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(190731, 13);

  IF current_is_exclusive THEN
    IF TG_TABLE_NAME = 'SpotProcurementReceiptPhoto'
       AND NULLIF(BTRIM(to_jsonb(NEW) ->> 'originalFileId'), '')
           IS NOT DISTINCT FROM
           NULLIF(BTRIM(to_jsonb(NEW) ->> 'watermarkedFileId'), '') THEN
      RAISE EXCEPTION '该文件已绑定其他业务记录，不能重复使用'
        USING
          ERRCODE = '23505',
          CONSTRAINT = 'exclusive_file_business_binding_guard';
    END IF;

    FOR current_binding IN
      SELECT * FROM jg_file_business_collision_columns()
    LOOP
      IF TG_TABLE_NAME = 'ContractTakeoverCorrection'
         AND current_binding."tableName" = 'ContractTakeoverCorrection'
         AND current_binding."columnName" = 'attachmentFileId' THEN
        SELECT EXISTS (
          SELECT 1
          FROM "ContractTakeoverCorrection"
          WHERE "attachmentFileId" = candidate_file_id
            AND "id" <> NEW."id"
        )
        INTO binding_exists;
      ELSE
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)',
          current_binding."tableName",
          current_binding."columnName"
        )
        INTO binding_exists
        USING candidate_file_id;
      END IF;

      IF binding_exists THEN
        RAISE EXCEPTION '该文件已绑定其他业务记录，不能重复使用'
          USING
            ERRCODE = '23505',
            CONSTRAINT = 'exclusive_file_business_binding_guard';
      END IF;
    END LOOP;

    SELECT EXISTS (
      SELECT 1
      FROM "FileObject"
      WHERE (
          "id" = candidate_file_id
          AND "supersedesFileObjectId" IS NOT NULL
        )
        OR "supersedesFileObjectId" = candidate_file_id
    )
    INTO binding_exists;

    IF binding_exists THEN
      RAISE EXCEPTION '该文件已接入文件替换链，不能再绑定独占业务事实'
        USING
          ERRCODE = '23505',
          CONSTRAINT = 'exclusive_file_business_binding_guard';
    END IF;
  ELSIF jg_has_exclusive_file_business_binding(candidate_file_id) THEN
    RAISE EXCEPTION '该文件已绑定独占业务事实，不能再用于其他业务'
      USING
        ERRCODE = '23505',
        CONSTRAINT = 'exclusive_file_business_binding_guard';
  END IF;

  RETURN NEW;
END;
$$;

-- Publish the complete current FileObject binding manifest. The financing
-- quota termination signature was added after the previous full manifest and
-- must participate in the same non-exclusive-versus-exclusive collision guard.
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

DO $$
DECLARE
  conflicting_file_id TEXT;
BEGIN
  SELECT quota."terminationSignatureFileId"
  INTO conflicting_file_id
  FROM "ProjectFinancingQuota" quota
  WHERE quota."terminationSignatureFileId" IS NOT NULL
    AND jg_has_exclusive_file_business_binding(
      quota."terminationSignatureFileId"
    )
  LIMIT 1;

  IF conflicting_file_id IS NOT NULL THEN
    RAISE EXCEPTION
      'ProjectFinancingQuota.terminationSignatureFileId has an existing exclusive business binding'
      USING
        ERRCODE = '23505',
        CONSTRAINT = 'exclusive_file_business_binding_guard';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS jg_efb_project_financing_quota_termination_signature
  ON "ProjectFinancingQuota";
CREATE TRIGGER jg_efb_project_financing_quota_termination_signature
BEFORE INSERT OR UPDATE OF "terminationSignatureFileId"
ON "ProjectFinancingQuota"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'terminationSignatureFileId',
  'false'
);

DROP TRIGGER IF EXISTS jg_efb_contract_takeover_correction
  ON "ContractTakeoverCorrection";
CREATE TRIGGER jg_efb_contract_takeover_correction
BEFORE INSERT OR UPDATE OF "attachmentFileId", "correctionType", "schemaVersion"
ON "ContractTakeoverCorrection"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'attachmentFileId',
  'true'
);

COMMIT;
