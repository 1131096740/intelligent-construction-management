-- 新版零星采购沿用纸质 A4/A5 主表，但把价格、商户、付款和票据事实移到付款申请。
-- 生产当前新模型应为零记录；一旦存在记录，宁可停止并制定专门迁移方案，绝不猜测回填。

BEGIN;

SELECT pg_advisory_xact_lock(190731, 18);

DO $$
DECLARE
  existing_count BIGINT;
BEGIN
  SELECT SUM("rowCount")
  INTO existing_count
  FROM (
    SELECT COUNT(*)::BIGINT AS "rowCount" FROM "SpotProcurement"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementVersion"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementLine"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementAttachment"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementPayment"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementPaymentExecution"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceipt"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceiptRevision"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceiptLine"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceiptPhoto"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceiptDelegation"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementReceiptReview"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementDiscrepancy"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SpotProcurementRefund"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SupplierBalanceAccount"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SupplierBalanceReservation"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "SupplierBalanceEntry"
    UNION ALL SELECT COUNT(*)::BIGINT FROM "InvoiceRecord"
  ) AS "spotProcurementRows";

  IF COALESCE(existing_count, 0) <> 0 THEN
    RAISE EXCEPTION
      '零星采购新模型已有记录（% 条），迁移已停止；请先制定并审批单独的数据迁移方案',
      existing_count
      USING ERRCODE = '23514',
      CONSTRAINT = 'spot_procurement_real_form_zero_record_guard';
  END IF;
END;
$$;

-- 旧列只用于历史读取。新流程不再在采购阶段写商户、价格、金额或预计票据。
ALTER TABLE "SpotProcurement"
  ALTER COLUMN "supplierKey" DROP NOT NULL,
  ALTER COLUMN "supplierNameSnapshot" DROP NOT NULL,
  ALTER COLUMN "approvedAmountCents" DROP NOT NULL,
  ALTER COLUMN "approvedAmountCents" DROP DEFAULT;

ALTER TABLE "SpotProcurementVersion"
  ALTER COLUMN "supplierKey" DROP NOT NULL,
  ALTER COLUMN "supplierNameSnapshot" DROP NOT NULL,
  ALTER COLUMN "totalAmountCents" DROP NOT NULL,
  ADD COLUMN "applicationDepartmentSnapshot" TEXT NOT NULL,
  ADD COLUMN "applicationNameSnapshot" TEXT NOT NULL,
  ADD COLUMN "purchaserNameSnapshot" TEXT NOT NULL,
  ADD COLUMN "purchaserDepartmentId" TEXT,
  ADD COLUMN "purchaserDepartmentNameSnapshot" TEXT NOT NULL,
  ADD COLUMN "requestedArrivalAt" TIMESTAMP(3) NOT NULL;

ALTER TABLE "SpotProcurementLine"
  ALTER COLUMN "invoiceMode" DROP NOT NULL,
  ALTER COLUMN "unitPrice" DROP NOT NULL,
  ALTER COLUMN "amountCents" DROP NOT NULL;

ALTER TABLE "SpotProcurementPayment"
  ALTER COLUMN "payeeNameSnapshot" DROP NOT NULL,
  ADD COLUMN "paymentType" TEXT,
  ADD COLUMN "merchantNameSnapshot" TEXT,
  ADD COLUMN "merchantPayeeMismatchNote" TEXT,
  ADD COLUMN "payerCompanyEntityId" TEXT,
  ADD COLUMN "payerCompanyNameSnapshot" TEXT,
  ADD COLUMN "payerUnifiedSocialCreditCodeSnapshot" TEXT,
  ADD COLUMN "approvalAmountCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "primaryPaymentChannelId" TEXT,
  ADD COLUMN "submittedVersionNo" INTEGER,
  ADD COLUMN "factsFrozenAt" TIMESTAMP(3);

ALTER TABLE "SpotProcurementPaymentExecution"
  ALTER COLUMN "voucherFileId" DROP NOT NULL;

-- 付款材料行用该复合键校验自身只能引用付款冻结的采购版本。
CREATE UNIQUE INDEX "SpotProcurementPayment_id_procurementVersionId_key"
  ON "SpotProcurementPayment"("id", "procurementVersionId");

ALTER TABLE "SpotProcurementDiscrepancy"
  ADD COLUMN "unexecutedAmountClosedCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "refundExpectedAmountCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "replenishedAt" TIMESTAMP(3),
  ADD COLUMN "replenishedByUserId" TEXT,
  ADD COLUMN "replenishmentNote" TEXT,
  ADD CONSTRAINT "SpotProcurementDiscrepancy_real_form_amounts_nonnegative_check"
    CHECK (
      "unexecutedAmountClosedCents" >= 0
      AND "refundExpectedAmountCents" >= 0
    ),
  ADD CONSTRAINT "SpotProcurementDiscrepancy_replenishment_tuple_check"
    CHECK (
      "replenishedAt" IS NULL
      OR "replenishedByUserId" IS NOT NULL
    ),
  ADD CONSTRAINT "SpotProcurementDiscrepancy_replenishedByUserId_fkey"
    FOREIGN KEY ("replenishedByUserId") REFERENCES "User"("id");

ALTER TABLE "SpotProcurementRefund"
  ADD COLUMN "paymentId" TEXT,
  ADD CONSTRAINT "SpotProcurementRefund_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id");

CREATE TABLE "SpotProcurementPaymentLine" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "procurementLineId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "approvedQuantitySnapshot" DECIMAL(24, 6) NOT NULL,
  "paymentQuantity" DECIMAL(24, 6) NOT NULL,
  "unitPrice" DECIMAL(24, 6) NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "expectedInvoiceCondition" TEXT NOT NULL,
  "vatRateOptionId" TEXT,
  "vatRateValueSnapshot" DECIMAL(9, 6),
  "vatRateLabelSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementPaymentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentLine_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementPaymentLine_quantities_nonnegative_check"
    CHECK (
      "approvedQuantitySnapshot" >= 0
      AND "paymentQuantity" >= 0
      AND "unitPrice" >= 0
      AND "amountCents" >= 0
    ),
  CONSTRAINT "SpotProcurementPaymentLine_payment_version_fkey"
    FOREIGN KEY ("paymentId", "procurementVersionId")
    REFERENCES "SpotProcurementPayment"("id", "procurementVersionId"),
  CONSTRAINT "SpotProcurementPaymentLine_procurement_line_fkey"
    FOREIGN KEY ("procurementVersionId", "procurementLineId")
    REFERENCES "SpotProcurementLine"("versionId", "id"),
  CONSTRAINT "SpotProcurementPaymentLine_vatRateOptionId_fkey"
    FOREIGN KEY ("vatRateOptionId") REFERENCES "VatRateOption"("id")
);

CREATE TABLE "SpotProcurementPaymentChannel" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "channelType" TEXT NOT NULL,
  "accountNameSnapshot" TEXT,
  "accountNumberSnapshot" TEXT,
  "bankNameSnapshot" TEXT,
  "channelNote" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementPaymentChannel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentChannel_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementPaymentChannel_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id")
);

CREATE TABLE "SpotProcurementPaymentMethodOption" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentMethodOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentMethodOption_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementPaymentMethodOption_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id")
);

CREATE TABLE "SpotProcurementPaymentAttachment" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentAttachment_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SpotProcurementPaymentAttachment_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPaymentAttachment_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPaymentExecutionVoucher" (
  "id" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentExecutionVoucher_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentExecutionVoucher_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementPaymentExecutionVoucher_executionId_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "SpotProcurementPaymentExecution"("id"),
  CONSTRAINT "SpotProcurementPaymentExecutionVoucher_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPaymentExecutionVoucher_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPaymentInvoice" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "uploadedByUserId" TEXT NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedByUserId" TEXT,
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentInvoice_invalidation_tuple_check"
    CHECK (
      (
        "invalidatedAt" IS NULL
        AND "invalidatedByUserId" IS NULL
        AND "invalidationReason" IS NULL
      )
      OR (
        "invalidatedAt" IS NOT NULL
        AND "invalidatedByUserId" IS NOT NULL
        AND "invalidationReason" IS NOT NULL
        AND btrim("invalidationReason") <> ''
      )
    ),
  CONSTRAINT "SpotProcurementPaymentInvoice_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SpotProcurementPaymentInvoice_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPaymentInvoice_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementPaymentInvoice_invalidatedByUserId_fkey"
    FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPaymentArchive" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "archiveTrigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'generated',
  "generatedPackageFileId" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentArchive_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentArchive_versionNo_positive_check"
    CHECK ("versionNo" > 0),
  CONSTRAINT "SpotProcurementPaymentArchive_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SpotProcurementPaymentArchive_generatedPackageFileId_fkey"
    FOREIGN KEY ("generatedPackageFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPaymentArchive_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPaymentArchiveFile" (
  "id" TEXT NOT NULL,
  "archiveId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "fileRole" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentArchiveFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentArchiveFile_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementPaymentArchiveFile_archiveId_fkey"
    FOREIGN KEY ("archiveId") REFERENCES "SpotProcurementPaymentArchive"("id"),
  CONSTRAINT "SpotProcurementPaymentArchiveFile_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
);

CREATE TABLE "SpotProcurementAbnormalTermination" (
  "id" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "reason" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementAbnormalTermination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementAbnormalTermination_reason_nonblank_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "SpotProcurementAbnormalTermination_confirmation_tuple_check"
    CHECK (
      (
        "confirmedAt" IS NULL
        AND "confirmedByUserId" IS NULL
      )
      OR (
        "confirmedAt" IS NOT NULL
        AND "confirmedByUserId" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementAbnormalTermination_rejection_tuple_check"
    CHECK (
      (
        "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
        AND "rejectionReason" IS NULL
      )
      OR (
        "rejectedAt" IS NOT NULL
        AND "rejectedByUserId" IS NOT NULL
        AND "rejectionReason" IS NOT NULL
        AND btrim("rejectionReason") <> ''
      )
    ),
  CONSTRAINT "SpotProcurementAbnormalTermination_procurementId_fkey"
    FOREIGN KEY ("procurementId") REFERENCES "SpotProcurement"("id"),
  CONSTRAINT "SpotProcurementAbnormalTermination_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementAbnormalTermination_confirmedByUserId_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementAbnormalTermination_rejectedByUserId_fkey"
    FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurementPaymentLine_paymentId_procurementLineId_key"
  ON "SpotProcurementPaymentLine"("paymentId", "procurementLineId");
CREATE UNIQUE INDEX "SpotProcurementPaymentLine_paymentId_sortOrder_key"
  ON "SpotProcurementPaymentLine"("paymentId", "sortOrder");
CREATE INDEX "SpotProcurementPaymentLine_procurementVersionId_procurementLineId_idx"
  ON "SpotProcurementPaymentLine"("procurementVersionId", "procurementLineId");

CREATE UNIQUE INDEX "SpotProcurementPaymentChannel_paymentId_sortOrder_key"
  ON "SpotProcurementPaymentChannel"("paymentId", "sortOrder");
CREATE UNIQUE INDEX "SpotProcurementPaymentChannel_paymentId_id_key"
  ON "SpotProcurementPaymentChannel"("paymentId", "id");
CREATE INDEX "SpotProcurementPaymentChannel_paymentId_isPrimary_idx"
  ON "SpotProcurementPaymentChannel"("paymentId", "isPrimary");

CREATE UNIQUE INDEX "SpotProcurementPaymentMethodOption_paymentId_paymentMethod_key"
  ON "SpotProcurementPaymentMethodOption"("paymentId", "paymentMethod");
CREATE UNIQUE INDEX "SpotProcurementPaymentMethodOption_paymentId_sortOrder_key"
  ON "SpotProcurementPaymentMethodOption"("paymentId", "sortOrder");

CREATE UNIQUE INDEX "SpotProcurementPaymentAttachment_fileId_key"
  ON "SpotProcurementPaymentAttachment"("fileId");
CREATE UNIQUE INDEX "SpotProcurementPaymentAttachment_paymentId_fileId_key"
  ON "SpotProcurementPaymentAttachment"("paymentId", "fileId");
CREATE INDEX "SpotProcurementPaymentAttachment_paymentId_category_idx"
  ON "SpotProcurementPaymentAttachment"("paymentId", "category");

CREATE UNIQUE INDEX "SpotProcurementPaymentExecutionVoucher_fileId_key"
  ON "SpotProcurementPaymentExecutionVoucher"("fileId");
CREATE UNIQUE INDEX "SpotProcurementPaymentExecutionVoucher_executionId_sortOrder_key"
  ON "SpotProcurementPaymentExecutionVoucher"("paymentExecutionId", "sortOrder");
CREATE INDEX "SpotProcurementPaymentExecutionVoucher_paymentExecutionId_idx"
  ON "SpotProcurementPaymentExecutionVoucher"("paymentExecutionId");

CREATE UNIQUE INDEX "SpotProcurementPaymentInvoice_fileId_key"
  ON "SpotProcurementPaymentInvoice"("fileId");
CREATE INDEX "SpotProcurementPaymentInvoice_paymentId_status_idx"
  ON "SpotProcurementPaymentInvoice"("paymentId", "status");

CREATE UNIQUE INDEX "SpotProcurementPaymentArchive_paymentId_versionNo_key"
  ON "SpotProcurementPaymentArchive"("paymentId", "versionNo");
CREATE UNIQUE INDEX "SpotProcurementPaymentArchive_generatedPackageFileId_key"
  ON "SpotProcurementPaymentArchive"("generatedPackageFileId");
CREATE INDEX "SpotProcurementPaymentArchive_paymentId_createdAt_idx"
  ON "SpotProcurementPaymentArchive"("paymentId", "createdAt");

CREATE UNIQUE INDEX "SpotProcurementPaymentArchiveFile_archiveId_fileRole_sortOrder_key"
  ON "SpotProcurementPaymentArchiveFile"("archiveId", "fileRole", "sortOrder");
CREATE INDEX "SpotProcurementPaymentArchiveFile_archiveId_idx"
  ON "SpotProcurementPaymentArchiveFile"("archiveId");
CREATE INDEX "SpotProcurementPaymentArchiveFile_fileId_idx"
  ON "SpotProcurementPaymentArchiveFile"("fileId");

CREATE UNIQUE INDEX "SpotProcurementAbnormalTermination_procurementId_key"
  ON "SpotProcurementAbnormalTermination"("procurementId");
CREATE INDEX "SpotProcurementAbnormalTermination_status_requestedAt_idx"
  ON "SpotProcurementAbnormalTermination"("status", "requestedAt");

CREATE INDEX "SpotProcurementPayment_payerCompanyEntityId_idx"
  ON "SpotProcurementPayment"("payerCompanyEntityId");
CREATE INDEX "SpotProcurementRefund_paymentId_idx"
  ON "SpotProcurementRefund"("paymentId");

CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement"
  ON "SpotProcurementPayment"("procurementId")
  WHERE "status" NOT IN ('invalidated', 'voided', 'withdrawn', 'rejected');

ALTER TABLE "SpotProcurementPayment"
  ADD CONSTRAINT "SpotProcurementPayment_payerCompanyEntityId_fkey"
    FOREIGN KEY ("payerCompanyEntityId") REFERENCES "CompanyEntity"("id"),
  ADD CONSTRAINT "SpotProcurementPayment_primaryPaymentChannelId_fkey"
    FOREIGN KEY ("id", "primaryPaymentChannelId")
    REFERENCES "SpotProcurementPaymentChannel"("paymentId", "id");

-- 新增独占文件事实。归档包文件可以引用已存在的业务证据，故不加入独占绑定表。
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
    ('SpotProcurementReceiptPhoto', 'watermarkedFileId', TRUE),
    ('SpotProcurementPaymentAttachment', 'fileId', TRUE),
    ('SpotProcurementPaymentExecutionVoucher', 'fileId', TRUE),
    ('SpotProcurementPaymentInvoice', 'fileId', TRUE);
$$;

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
    FROM jg_file_business_binding_columns()
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
  RETURN FALSE;
END;
$$;

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

DROP TRIGGER IF EXISTS jg_efb_spot_payment_attachment ON "SpotProcurementPaymentAttachment";
CREATE TRIGGER jg_efb_spot_payment_attachment
BEFORE INSERT OR UPDATE OF "fileId" ON "SpotProcurementPaymentAttachment"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

DROP TRIGGER IF EXISTS jg_efb_spot_payment_execution_voucher ON "SpotProcurementPaymentExecutionVoucher";
CREATE TRIGGER jg_efb_spot_payment_execution_voucher
BEFORE INSERT OR UPDATE OF "fileId" ON "SpotProcurementPaymentExecutionVoucher"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

DROP TRIGGER IF EXISTS jg_efb_spot_payment_invoice ON "SpotProcurementPaymentInvoice";
CREATE TRIGGER jg_efb_spot_payment_invoice
BEFORE INSERT OR UPDATE OF "fileId" ON "SpotProcurementPaymentInvoice"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

COMMIT;
