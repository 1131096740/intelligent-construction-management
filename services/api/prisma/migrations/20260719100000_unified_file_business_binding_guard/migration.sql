-- 合并合同/结算治理与零星采购后，所有 FileObject 引用必须共用一份清单和
-- 同一把事务级锁。本迁移不改写任何业务数据；若存量独占文件已被跨业务
-- 复用，则在安装新触发器前直接拒绝迁移。

BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);

-- 这是 schema.prisma 中全部正式 FileObject 引用的唯一数据库清单。
-- SpotProcurementPaymentArchiveFile.fileId 是归档索引：它按业务设计复用
-- 原始凭证，因此保留在清单中，但不参与“跨业务独占冲突”计数。
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

-- 归档明细是合法的复用索引，不是第二个文件所有者。
CREATE OR REPLACE FUNCTION jg_file_business_collision_columns()
RETURNS TABLE (
  "tableName" TEXT,
  "columnName" TEXT,
  "exclusive" BOOLEAN
)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT *
  FROM jg_file_business_binding_columns()
  WHERE NOT (
    "tableName" = 'SpotProcurementPaymentArchiveFile'
    AND "columnName" = 'fileId'
  );
$$;

-- 锁表与触发器安装位于同一事务，关闭“预检已完成、新触发器未生效”
-- 的部署窗口。按表名排序取锁，避免迁移间的锁顺序反转。
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

-- 安装前对所有已有独占文件做全域预检。历史主体更正是条件独占：
-- 只有 correctionType=company_entity 才进入独占候选集。
CREATE TEMP TABLE jg_unified_exclusive_file_candidates (
  "fileId" TEXT PRIMARY KEY
) ON COMMIT DROP;

DO $$
DECLARE
  exclusive_binding RECORD;
BEGIN
  FOR exclusive_binding IN
    SELECT *
    FROM jg_file_business_collision_columns()
    WHERE "exclusive"
  LOOP
    EXECUTE format(
      'INSERT INTO jg_unified_exclusive_file_candidates ("fileId")
       SELECT DISTINCT %I
       FROM %I
       WHERE %I IS NOT NULL
       ON CONFLICT ("fileId") DO NOTHING',
      exclusive_binding."columnName",
      exclusive_binding."tableName",
      exclusive_binding."columnName"
    );
  END LOOP;

  INSERT INTO jg_unified_exclusive_file_candidates ("fileId")
  SELECT DISTINCT "attachmentFileId"
  FROM "ContractTakeoverCorrection"
  WHERE "correctionType" = 'company_entity'
    AND "attachmentFileId" IS NOT NULL
  ON CONFLICT ("fileId") DO NOTHING;
END;
$$;

DO $$
DECLARE
  candidate RECORD;
  registered_binding RECORD;
  binding_count BIGINT;
  current_count BIGINT;
BEGIN
  FOR candidate IN
    SELECT "fileId"
    FROM jg_unified_exclusive_file_candidates
    ORDER BY "fileId"
  LOOP
    binding_count := 0;
    FOR registered_binding IN
      SELECT * FROM jg_file_business_collision_columns()
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
END;
$$;

-- 先删除两套父迁移触发器，再替换函数。上方锁表已阻断参与表的并发写，
-- 因此不会暴露无保护窗口。
DO $$
DECLARE
  existing_trigger RECORD;
BEGIN
  FOR existing_trigger IN
    SELECT trigger_name, table_name
    FROM (
      SELECT DISTINCT
        trigger.tgname AS trigger_name,
        relation.relname AS table_name
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
      WHERE NOT trigger.tgisinternal
        AND namespace.nspname = current_schema()
        AND (
          trigger.tgname LIKE 'jg_efb_%'
          OR procedure.proname IN (
            'guard_company_entity_correction_attachment',
            'guard_other_binding_from_company_entity_correction'
          )
        )
    ) registered_triggers
    ORDER BY table_name, trigger_name
  LOOP
    EXECUTE format(
      'DROP TRIGGER %I ON %I',
      existing_trigger.trigger_name,
      existing_trigger.table_name
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS "guard_company_entity_correction_attachment"();
DROP FUNCTION IF EXISTS "guard_other_binding_from_company_entity_correction"();

CREATE OR REPLACE FUNCTION jg_has_exclusive_file_business_binding(candidate_file_id TEXT)
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
      AND "correctionType" = 'company_entity'
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
  candidate_file_id := NULLIF(BTRIM(to_jsonb(NEW) ->> TG_ARGV[0]), '');
  IF candidate_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ContractTakeoverCorrection' THEN
    current_is_exclusive := NEW."correctionType" = 'company_entity';
    IF TG_OP = 'UPDATE' THEN
      previous_is_exclusive := OLD."correctionType" = 'company_entity';
      IF previous_is_exclusive AND NOT current_is_exclusive THEN
        RAISE EXCEPTION '历史主体更正附件绑定类型不能变更'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    previous_file_id := NULLIF(BTRIM(to_jsonb(OLD) ->> TG_ARGV[0]), '');
    IF previous_file_id IS NOT DISTINCT FROM candidate_file_id
       AND previous_is_exclusive = current_is_exclusive THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 所有入口使用零星采购 TypeScript 写路径相同的两段锁键。
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

CREATE OR REPLACE FUNCTION jg_enforce_file_replacement_exclusive_binding()
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

-- 按统一清单重建普通/独占绑定触发器。条件独占的历史主体更正单独
-- 监听 correctionType；归档索引列不安装冲突触发器。
DO $$
DECLARE
  current_binding RECORD;
  trigger_sequence INTEGER := 0;
BEGIN
  FOR current_binding IN
    SELECT *
    FROM jg_file_business_collision_columns()
    WHERE NOT (
      "tableName" = 'ContractTakeoverCorrection'
      AND "columnName" = 'attachmentFileId'
    )
    ORDER BY "tableName", "columnName"
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

CREATE TRIGGER jg_efb_contract_takeover_correction
BEFORE INSERT OR UPDATE OF "attachmentFileId", "correctionType"
ON "ContractTakeoverCorrection"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('attachmentFileId', 'false');

CREATE TRIGGER jg_efb_file_replacement
BEFORE INSERT OR UPDATE OF "supersedesFileObjectId" ON "FileObject"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_file_replacement_exclusive_binding();

COMMIT;
