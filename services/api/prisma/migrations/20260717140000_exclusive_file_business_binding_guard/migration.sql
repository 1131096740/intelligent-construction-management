-- 收货照片、零星采购实际付款凭证和退款凭证属于独占文件事实。
-- 旧业务入口此前只在各自事务中写绑定，可能与独占入口的“检查后写入”
-- 并发穿透。本迁移用同一事务级 advisory lock 串行全部正式文件绑定，
-- 并由触发器在锁内重新检查，避免依赖每个历史 service 都正确实现协议。

BEGIN;

CREATE FUNCTION jg_file_business_binding_columns()
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
    ('InvoiceRecord', 'fileId', FALSE),
    ('NoInvoiceConfirmation', 'proofFileId', FALSE),
    ('InvoiceExceptionConfirmation', 'proofFileId', FALSE),
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

-- 迁移期间先阻断所有参与表的写入，等待既有事务完成后再做存量预检。
-- 这些锁与触发器安装位于同一显式事务，避免“预检完成、触发器未生效”
-- 的上线窗口；普通 SELECT 不受影响。
DO $$
DECLARE
  binding_table RECORD;
BEGIN
  FOR binding_table IN
    SELECT "tableName"
    FROM (
      SELECT DISTINCT "tableName"
      FROM jg_file_business_binding_columns()
      UNION
      SELECT 'FileObject'
    ) tables
    ORDER BY "tableName"
  LOOP
    EXECUTE format(
      'LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',
      binding_table."tableName"
    );
  END LOOP;
END;
$$;

CREATE FUNCTION jg_has_exclusive_file_business_binding(candidate_file_id TEXT)
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
    );
$$;

-- 触发器只治理后续写入；安装前先拒绝任何已经存在的独占跨业务冲突，
-- 不能让迁移在带病数据上静默成功。
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
          '检测到既有独占文件跨业务绑定，迁移已停止，请先清理 fileId=%',
          candidate."fileId"
          USING
            ERRCODE = '23514',
            CONSTRAINT = 'exclusive_file_business_binding_guard';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE FUNCTION jg_enforce_exclusive_file_business_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_file_id TEXT;
  previous_file_id TEXT;
  current_binding RECORD;
  binding_exists BOOLEAN;
  current_is_exclusive BOOLEAN := TG_ARGV[1]::BOOLEAN;
BEGIN
  candidate_file_id := NULLIF(BTRIM(to_jsonb(NEW) ->> TG_ARGV[0]), '');
  IF candidate_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_file_id := NULLIF(BTRIM(to_jsonb(OLD) ->> TG_ARGV[0]), '');
    IF previous_file_id IS NOT DISTINCT FROM candidate_file_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 必须与 TypeScript 写路径使用完全相同的两段锁键。
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
      SELECT *
      FROM jg_file_business_binding_columns()
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)',
        current_binding."tableName",
        current_binding."columnName"
      )
      INTO binding_exists
      USING candidate_file_id;

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

CREATE FUNCTION jg_enforce_file_replacement_exclusive_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  replacement_file_id TEXT;
BEGIN
  replacement_file_id := NULLIF(BTRIM(NEW."supersedesFileObjectId"), '');
  IF replacement_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."supersedesFileObjectId" IS NOT DISTINCT FROM
         NEW."supersedesFileObjectId" THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(190731, 13);
  IF jg_has_exclusive_file_business_binding(NEW."id")
     OR jg_has_exclusive_file_business_binding(replacement_file_id) THEN
    RAISE EXCEPTION '独占业务文件不能接入文件替换链'
      USING
        ERRCODE = '23505',
        CONSTRAINT = 'exclusive_file_business_binding_guard';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  current_binding RECORD;
  trigger_sequence INTEGER := 0;
BEGIN
  FOR current_binding IN
    SELECT *
    FROM jg_file_business_binding_columns()
  LOOP
    trigger_sequence := trigger_sequence + 1;
    EXECUTE format(
      'CREATE TRIGGER %I
       BEFORE INSERT OR UPDATE OF %I ON %I
       FOR EACH ROW
       EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(%L, %L)',
      'jg_efb_' || trigger_sequence,
      current_binding."columnName",
      current_binding."tableName",
      current_binding."columnName",
      current_binding."exclusive"
    );
  END LOOP;
END;
$$;

CREATE TRIGGER jg_efb_file_replacement
BEFORE INSERT OR UPDATE OF "supersedesFileObjectId" ON "FileObject"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_file_replacement_exclusive_binding();

COMMIT;
