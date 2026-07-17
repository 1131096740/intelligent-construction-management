-- 发票原件、无票替代证明和票据异常证明一经形成正式事实后不可复用。
-- 先复用上一迁移的全局文件绑定 advisory lock，完成存量预检后再把
-- 三个既有触发器由普通绑定提升为独占绑定，避免部署切换窗口。

BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);

LOCK TABLE "FileObject" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "InvoiceRecord" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "NoInvoiceConfirmation" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "InvoiceExceptionConfirmation" IN SHARE ROW EXCLUSIVE MODE;

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
    ('ContractTakeoverCorrection', 'attachmentFileId', FALSE),
    ('ContractArchiveFile', 'fileId', FALSE),
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
    ('ArchiveRecord', 'fileId', FALSE),
    ('PdfDocument', 'fileId', FALSE),
    ('ContractLayoutTemplateVersion', 'docxFileId', FALSE),
    ('ContractLayoutTemplateVersion', 'previewPdfFileId', FALSE),
    ('ContractLayoutPreviewJob', 'previewPdfFileId', FALSE),
    ('ContractBill', 'sourceExcelFileId', FALSE),
    ('ContractBillImport', 'fileId', FALSE),
    ('ContractGeneratedDocument', 'docxFileId', FALSE),
    ('ContractGeneratedDocument', 'pdfFileId', FALSE),
    ('ContractOfflineRevision', 'fileId', FALSE),
    ('ContractOfflineRevision', 'previewPdfFileId', FALSE),
    ('SpotProcurementReceiptPhoto', 'originalFileId', TRUE),
    ('SpotProcurementReceiptPhoto', 'watermarkedFileId', TRUE);
$$;

CREATE OR REPLACE FUNCTION jg_has_exclusive_file_business_binding(candidate_file_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM "SpotProcurementReceiptPhoto"
      WHERE "originalFileId" = candidate_file_id
         OR "watermarkedFileId" = candidate_file_id
    )
    OR EXISTS (
      SELECT 1
      FROM "SpotProcurementPaymentExecution"
      WHERE "voucherFileId" = candidate_file_id
    )
    OR EXISTS (
      SELECT 1
      FROM "SpotProcurementRefund"
      WHERE "voucherFileId" = candidate_file_id
    )
    OR EXISTS (
      SELECT 1
      FROM "InvoiceRecord"
      WHERE "fileId" = candidate_file_id
    )
    OR EXISTS (
      SELECT 1
      FROM "NoInvoiceConfirmation"
      WHERE "proofFileId" = candidate_file_id
    )
    OR EXISTS (
      SELECT 1
      FROM "InvoiceExceptionConfirmation"
      WHERE "proofFileId" = candidate_file_id
    );
$$;

-- 提升为独占前先拒绝任何存量跨业务、重复或替换链冲突。
DO $$
DECLARE
  exclusive_binding RECORD;
  registered_binding RECORD;
  candidate RECORD;
  binding_count BIGINT;
  current_count BIGINT;
BEGIN
  FOR exclusive_binding IN
    SELECT *
    FROM jg_file_business_binding_columns()
    WHERE "exclusive"
      AND (
        ("tableName" = 'InvoiceRecord' AND "columnName" = 'fileId')
        OR (
          "tableName" = 'NoInvoiceConfirmation'
          AND "columnName" = 'proofFileId'
        )
        OR (
          "tableName" = 'InvoiceExceptionConfirmation'
          AND "columnName" = 'proofFileId'
        )
      )
  LOOP
    FOR candidate IN
      EXECUTE format(
        'SELECT %I AS "fileId"
         FROM %I
         WHERE %I IS NOT NULL',
        exclusive_binding."columnName",
        exclusive_binding."tableName",
        exclusive_binding."columnName"
      )
    LOOP
      binding_count := 0;
      FOR registered_binding IN
        SELECT *
        FROM jg_file_business_binding_columns()
      LOOP
        EXECUTE format(
          'SELECT COUNT(*) FROM %I WHERE %I = $1',
          registered_binding."tableName",
          registered_binding."columnName"
        )
        INTO current_count
        USING candidate."fileId";
        binding_count := binding_count + current_count;
      END LOOP;

      SELECT COUNT(*)
      INTO current_count
      FROM "FileObject"
      WHERE (
          "id" = candidate."fileId"
          AND "supersedesFileObjectId" IS NOT NULL
        )
        OR "supersedesFileObjectId" = candidate."fileId";
      binding_count := binding_count + current_count;

      IF binding_count > 1 THEN
        RAISE EXCEPTION
          '检测到既有票据证据文件跨业务绑定，迁移已停止，请先清理 fileId=%',
          candidate."fileId"
          USING
            ERRCODE = '23514',
            CONSTRAINT = 'exclusive_file_business_binding_guard';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS jg_efb_17 ON "InvoiceRecord";
CREATE TRIGGER jg_efb_17
BEFORE INSERT OR UPDATE OF "fileId" ON "InvoiceRecord"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

DROP TRIGGER IF EXISTS jg_efb_18 ON "NoInvoiceConfirmation";
CREATE TRIGGER jg_efb_18
BEFORE INSERT OR UPDATE OF "proofFileId" ON "NoInvoiceConfirmation"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('proofFileId', 'true');

DROP TRIGGER IF EXISTS jg_efb_19 ON "InvoiceExceptionConfirmation";
CREATE TRIGGER jg_efb_19
BEFORE INSERT OR UPDATE OF "proofFileId" ON "InvoiceExceptionConfirmation"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('proofFileId', 'true');

COMMIT;
