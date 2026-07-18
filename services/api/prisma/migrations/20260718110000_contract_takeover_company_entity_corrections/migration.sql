ALTER TABLE "ContractTakeoverCorrection"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "targetCompanyEntityId" TEXT,
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewComment" TEXT;

CREATE INDEX "ContractTakeoverCorrection_takeoverId_correctionType_status_idx"
  ON "ContractTakeoverCorrection"("takeoverId", "correctionType", "status");

CREATE UNIQUE INDEX "ContractTakeoverCorrection_pending_company_entity_key"
  ON "ContractTakeoverCorrection"("takeoverId")
  WHERE "correctionType" = 'company_entity' AND "status" = 'submitted';

ALTER TABLE "ContractTakeoverCorrection"
  ADD CONSTRAINT "ContractTakeoverCorrection_status_check"
  CHECK ("status" IN ('submitted', 'confirmed', 'rejected')),
  ADD CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check"
  CHECK (
    "correctionType" <> 'company_entity'
    OR (
      "targetCompanyEntityId" IS NOT NULL
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
  );

-- A company-entity correction attachment is an exclusive business file. The two
-- trigger directions take the same transaction advisory lock, closing the race
-- between correction submission and any other business binding without changing
-- the upload API or pre-existing bindings.
CREATE FUNCTION "guard_company_entity_correction_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_file_id TEXT;
BEGIN
  candidate_file_id := NEW."attachmentFileId";
  IF candidate_file_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(candidate_file_id, 74289103));
  IF NEW."correctionType" <> 'company_entity' THEN
    IF TG_OP = 'UPDATE' AND OLD."correctionType" = 'company_entity' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = '历史主体更正附件绑定类型不能变更';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "ContractTakeoverCorrection"
      WHERE "attachmentFileId" = candidate_file_id
        AND "correctionType" = 'company_entity'
        AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = '该文件已绑定历史主体更正，不能用于其他业务';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "User" WHERE "signatureFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractVersion" WHERE "taxFactEvidenceFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractTaxFactRevision" WHERE "evidenceFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractTakeoverCorrection" WHERE "attachmentFileId" = candidate_file_id AND "id" <> NEW."id"
    UNION ALL SELECT 1 FROM "ContractArchiveFile" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractFormalFile" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractAuthorization" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "Settlement" WHERE "preparerSignatureFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementSignedDocument" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementSignedDocumentGenerationClaim" WHERE "uploadedFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementImport" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementTemplateVersion" WHERE "xlsxFileId" = candidate_file_id OR "previewXlsxFileId" = candidate_file_id OR "previewPdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementTemplatePreviewJob" WHERE "previewXlsxFileId" = candidate_file_id OR "previewPdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "SettlementArchiveFile" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "PaymentExecution" WHERE "voucherFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectExpenseRequest" WHERE "attachmentFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectExpenseExecution" WHERE "voucherFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectReceipt" WHERE "voucherFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectProxyPayment" WHERE "voucherFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectUpstreamSettlement" WHERE "voucherFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectOwnerContract" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectSettlementExceptionQuota" WHERE "attachmentFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ProjectFinancingQuota" WHERE "attachmentFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ApprovalActionLog" WHERE "signatureFileIdSnapshot" = candidate_file_id
    UNION ALL SELECT 1 FROM "ArchiveRecord" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "PdfDocument" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ApprovalFormGenerationClaim" WHERE "uploadedFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractLayoutTemplateVersion" WHERE "docxFileId" = candidate_file_id OR "previewPdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractLayoutPreviewJob" WHERE "previewPdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractBill" WHERE "sourceExcelFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractBillImport" WHERE "fileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractGeneratedDocument" WHERE "docxFileId" = candidate_file_id OR "pdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "ContractOfflineRevision" WHERE "fileId" = candidate_file_id OR "previewPdfFileId" = candidate_file_id
    UNION ALL SELECT 1 FROM "FileObject" WHERE "id" = candidate_file_id AND "supersedesFileObjectId" IS NOT NULL
    UNION ALL SELECT 1 FROM "FileObject" WHERE "supersedesFileObjectId" = candidate_file_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = '该文件已用于其他业务，请重新上传专用的更正依据附件';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_other_binding_from_company_entity_correction"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_file_id TEXT;
BEGIN
  -- Sort every candidate before locking so multi-file rows and replacement
  -- chains cannot acquire the same pair of advisory locks in opposite order.
  FOR candidate_file_id IN
    SELECT DISTINCT entry.value
    FROM jsonb_each_text(to_jsonb(NEW)) AS entry(key, value)
    WHERE entry.key = ANY(TG_ARGV)
      AND entry.value <> ''
    ORDER BY entry.value
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(candidate_file_id, 74289103));
    IF EXISTS (
      SELECT 1
      FROM "ContractTakeoverCorrection"
      WHERE "attachmentFileId" = candidate_file_id
        AND "correctionType" = 'company_entity'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = '该文件已绑定历史主体更正，不能用于其他业务';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContractTakeoverCorrection_company_entity_file_guard"
BEFORE INSERT OR UPDATE OF "attachmentFileId", "correctionType"
ON "ContractTakeoverCorrection"
FOR EACH ROW EXECUTE FUNCTION "guard_company_entity_correction_attachment"();

-- Keep this manifest synchronized with every FileObject reference in schema.prisma.
CREATE TRIGGER "User_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "signatureFileId" ON "User" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('signatureFileId');
CREATE TRIGGER "ContractVersion_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "taxFactEvidenceFileId" ON "ContractVersion" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('taxFactEvidenceFileId');
CREATE TRIGGER "ContractTaxFactRevision_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ContractTaxFactRevision" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('evidenceFileId');
CREATE TRIGGER "ContractArchiveFile_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ContractArchiveFile" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "ContractFormalFile_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ContractFormalFile" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "ContractAuthorization_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ContractAuthorization" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "Settlement_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "preparerSignatureFileId" ON "Settlement" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('preparerSignatureFileId');
CREATE TRIGGER "SettlementSignedDocument_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "SettlementSignedDocument" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "SettlementSignedDocumentGenerationClaim_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "uploadedFileId" ON "SettlementSignedDocumentGenerationClaim" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('uploadedFileId');
CREATE TRIGGER "SettlementImport_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "SettlementImport" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "SettlementTemplateVersion_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "xlsxFileId", "previewXlsxFileId", "previewPdfFileId" ON "SettlementTemplateVersion" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('xlsxFileId', 'previewXlsxFileId', 'previewPdfFileId');
CREATE TRIGGER "SettlementTemplatePreviewJob_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "previewXlsxFileId", "previewPdfFileId" ON "SettlementTemplatePreviewJob" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('previewXlsxFileId', 'previewPdfFileId');
CREATE TRIGGER "SettlementArchiveFile_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "SettlementArchiveFile" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "PaymentExecution_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId" ON "PaymentExecution" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('voucherFileId');
CREATE TRIGGER "ProjectExpenseRequest_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "attachmentFileId" ON "ProjectExpenseRequest" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('attachmentFileId');
CREATE TRIGGER "ProjectExpenseExecution_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ProjectExpenseExecution" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('voucherFileId');
CREATE TRIGGER "ProjectReceipt_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ProjectReceipt" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('voucherFileId');
CREATE TRIGGER "ProjectProxyPayment_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ProjectProxyPayment" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('voucherFileId');
CREATE TRIGGER "ProjectUpstreamSettlement_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ProjectUpstreamSettlement" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('voucherFileId');
CREATE TRIGGER "ProjectOwnerContract_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ProjectOwnerContract" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "ProjectSettlementExceptionQuota_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "attachmentFileId" ON "ProjectSettlementExceptionQuota" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('attachmentFileId');
CREATE TRIGGER "ProjectFinancingQuota_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "attachmentFileId" ON "ProjectFinancingQuota" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('attachmentFileId');
CREATE TRIGGER "ApprovalActionLog_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "signatureFileIdSnapshot" ON "ApprovalActionLog" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('signatureFileIdSnapshot');
CREATE TRIGGER "ArchiveRecord_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ArchiveRecord" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "PdfDocument_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "PdfDocument" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "ApprovalFormGenerationClaim_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "uploadedFileId" ON "ApprovalFormGenerationClaim" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('uploadedFileId');
CREATE TRIGGER "ContractLayoutTemplateVersion_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "docxFileId", "previewPdfFileId" ON "ContractLayoutTemplateVersion" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('docxFileId', 'previewPdfFileId');
CREATE TRIGGER "ContractLayoutPreviewJob_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "previewPdfFileId" ON "ContractLayoutPreviewJob" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('previewPdfFileId');
CREATE TRIGGER "ContractBill_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "sourceExcelFileId" ON "ContractBill" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('sourceExcelFileId');
CREATE TRIGGER "ContractBillImport_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId" ON "ContractBillImport" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId');
CREATE TRIGGER "ContractGeneratedDocument_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "docxFileId", "pdfFileId" ON "ContractGeneratedDocument" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('docxFileId', 'pdfFileId');
CREATE TRIGGER "ContractOfflineRevision_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "fileId", "previewPdfFileId" ON "ContractOfflineRevision" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('fileId', 'previewPdfFileId');
CREATE TRIGGER "FileObject_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "supersedesFileObjectId" ON "FileObject" FOR EACH ROW EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('id', 'supersedesFileObjectId');
