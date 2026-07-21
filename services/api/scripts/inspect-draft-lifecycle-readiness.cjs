const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function readDatabaseUrl(filePath) {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    return (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    );
  } catch {
    return undefined;
  }
}

if (!process.env.DATABASE_URL) {
  const databaseUrl = readDatabaseUrl(path.resolve(__dirname, "../.env"));
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
}

const checks = Object.freeze({
  migrationCount: `SELECT count(*)::text AS "count" FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  contractCandidates: `
    WITH facts AS (
      SELECT c."id", cv."id" AS "versionId", cv."status", c."ownerUserId", c."createdAt", cv."updatedAt",
        (SELECT count(*) FROM "ApprovalInstance" ai WHERE ai."businessId" IN (c."id", cv."id")) AS approvals,
        (SELECT count(*) FROM "ApprovalActionLog" al JOIN "ApprovalInstance" ai ON ai."id" = al."approvalInstanceId" WHERE ai."businessId" IN (c."id", cv."id")) AS actions,
        (SELECT count(*) FROM "ContractFormalFile" ff WHERE ff."contractVersionId" = cv."id") +
          (SELECT count(*) FROM "ArchiveRecord" ar WHERE ar."businessId" IN (c."id", cv."id")) AS files,
        (SELECT count(*) FROM "Settlement" s WHERE s."contractVersionId" = cv."id") +
          (SELECT count(*) FROM "PaymentRequest" p WHERE p."contractVersionId" = cv."id") AS downstream
      FROM "Contract" c JOIN "ContractVersion" cv ON cv."contractId" = c."id"
      WHERE cv."status" IN ('draft', 'returned', 'withdrawn', 'abandoned')
    )
    SELECT 'contract' AS "domain", left(md5(f."id"), 12) AS "maskedId", left(md5(f."versionId"), 12) AS "maskedVersionId",
      f."status", left(md5(coalesce(f."ownerUserId", 'unassigned')), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", f."createdAt", f."updatedAt",
      f.approvals::text AS "approvalInstanceCount", f.actions::text AS "approvalActionCount", f.files::text AS "fileEvidenceCount",
      '0' AS "occupiedAmountCents", f.downstream::text AS "downstreamFactCount",
      CASE WHEN f.downstream > 0 OR f.files > 0 THEN 'C' WHEN f.approvals > 0 OR f.actions > 0 OR f."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '责任人未启用或未分配' END,
        CASE WHEN f.approvals > 0 OR f.actions > 0 THEN '存在审批历史' END,
        CASE WHEN f.files > 0 THEN '存在正式文件或归档证据' END,
        CASE WHEN f.downstream > 0 THEN '存在结算或付款下游事实' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."ownerUserId" ORDER BY f."updatedAt"`,
  takeoverCandidates: `
    SELECT 'contract_takeover' AS "domain", left(md5(t."id"), 12) AS "maskedId", t."takeoverStatus" AS "status",
      left(md5(coalesce(t."responsibleUserId", t."createdByUserId")), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", t."createdAt", t."updatedAt",
      CASE WHEN t."submittedAt" IS NULL THEN '0' ELSE '1' END AS "approvalInstanceCount", '0' AS "approvalActionCount",
      (SELECT count(*)::text FROM "ArchiveRecord" ar WHERE ar."businessId" IN (t."id", t."contractVersionId")) AS "fileEvidenceCount",
      (t."historicalApprovalPendingPaymentCents" + t."historicalApprovedPendingPaymentCents" + t."historicalPaidCents" + t."otherConfirmedOccupancyCents")::text AS "occupiedAmountCents",
      ((SELECT count(*) FROM "Settlement" s WHERE s."contractVersionId" = t."contractVersionId") +
        (SELECT count(*) FROM "PaymentRequest" p WHERE p."contractVersionId" = t."contractVersionId"))::text AS "downstreamFactCount",
      CASE WHEN t."confirmedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "Settlement" s WHERE s."contractVersionId" = t."contractVersionId") OR EXISTS (SELECT 1 FROM "PaymentRequest" p WHERE p."contractVersionId" = t."contractVersionId") THEN 'C'
        WHEN t."submittedAt" IS NOT NULL OR t."takeoverStatus" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '责任人未启用' END,
        CASE WHEN t."submittedAt" IS NOT NULL THEN '已经提交复核' END,
        CASE WHEN t."confirmedAt" IS NOT NULL THEN '接管事实已经确认' END,
        CASE WHEN t."historicalApprovalPendingPaymentCents" + t."historicalApprovedPendingPaymentCents" + t."historicalPaidCents" + t."otherConfirmedOccupancyCents" > 0 THEN '存在历史金额占用' END
      ]::text[], NULL) AS "blockingReasons"
    FROM "ContractTakeover" t LEFT JOIN "User" u ON u."id" = coalesce(t."responsibleUserId", t."createdByUserId")
    WHERE t."takeoverStatus" IN ('draft', 'returned', 'withdrawn', 'abandoned') ORDER BY t."updatedAt"`,
  taxRevisionCandidates: `
    SELECT 'contract_tax_revision' AS "domain", left(md5(r."id"), 12) AS "maskedId", r."status",
      left(md5(r."createdByUserId"), 12) AS "maskedResponsibleId", coalesce(u."isActive", false) AS "responsibleActive",
      r."createdAt", r."updatedAt", CASE WHEN r."submittedAt" IS NULL THEN '0' ELSE '1' END AS "approvalInstanceCount",
      (CASE WHEN r."financeReviewedAt" IS NULL THEN 0 ELSE 1 END + CASE WHEN r."confirmedAt" IS NULL THEN 0 ELSE 1 END)::text AS "approvalActionCount",
      CASE WHEN r."evidenceFileId" IS NULL THEN '0' ELSE '1' END AS "fileEvidenceCount", '0' AS "occupiedAmountCents", '0' AS "downstreamFactCount",
      CASE WHEN r."confirmedAt" IS NOT NULL THEN 'C' WHEN r."submittedAt" IS NOT NULL OR r."financeReviewedAt" IS NOT NULL OR r."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '责任人未启用' END,
        CASE WHEN r."submittedAt" IS NOT NULL THEN '存在提交历史' END,
        CASE WHEN r."evidenceFileId" IS NOT NULL THEN '存在税务依据文件' END,
        CASE WHEN r."confirmedAt" IS NOT NULL THEN '税务事实已经确认' END
      ]::text[], NULL) AS "blockingReasons"
    FROM "ContractTaxFactRevision" r LEFT JOIN "User" u ON u."id" = r."createdByUserId"
    WHERE r."status" IN ('draft', 'returned', 'withdrawn', 'abandoned') ORDER BY r."updatedAt"`,
  settlementCandidates: `
    SELECT 'settlement_draft' AS "domain", left(md5(d."id"), 12) AS "maskedId", d."status",
      left(md5(d."ownerUserId"), 12) AS "maskedResponsibleId", coalesce(u."isActive", false) AS "responsibleActive",
      d."createdAt", d."updatedAt",
      CASE WHEN d."submittedSettlementId" IS NULL THEN '0' ELSE '1' END AS "approvalInstanceCount",
      (SELECT count(*)::text FROM "ApprovalActionLog" al JOIN "ApprovalInstance" ai ON ai."id" = al."approvalInstanceId" WHERE ai."businessId" = d."submittedSettlementId") AS "approvalActionCount",
      (SELECT count(*)::text FROM "ArchiveRecord" ar WHERE ar."businessId" = d."submittedSettlementId") AS "fileEvidenceCount",
      coalesce(d."finalCumulativeAmountCents", 0)::text AS "occupiedAmountCents",
      CASE WHEN d."submittedSettlementId" IS NULL THEN '0' ELSE '1' END AS "downstreamFactCount",
      CASE WHEN d."submittedSettlementId" IS NOT NULL THEN 'C' WHEN d."submittedAt" IS NOT NULL OR d."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '责任人未启用' END,
        CASE WHEN d."submittedAt" IS NOT NULL THEN '存在提交历史' END,
        CASE WHEN d."submittedSettlementId" IS NOT NULL THEN '已经生成正式结算记录' END
      ]::text[], NULL) AS "blockingReasons"
    FROM "SettlementDraft" d LEFT JOIN "User" u ON u."id" = d."ownerUserId"
    WHERE d."status" IN ('draft', 'returned', 'withdrawn', 'abandoned') ORDER BY d."updatedAt"`,
  paymentCandidates: `
    WITH facts AS (
      SELECT p.*, ai."id" AS "approvalId", ai."applicantUserId",
        (SELECT count(*) FROM "ApprovalActionLog" al WHERE al."approvalInstanceId" = ai."id") AS actions,
        (SELECT count(*) FROM "PaymentExecution" pe WHERE pe."paymentRequestId" = p."id") AS executions,
        (SELECT count(*) FROM "ArchiveRecord" ar WHERE ar."businessId" = p."id") AS files
      FROM "PaymentRequest" p LEFT JOIN LATERAL (
        SELECT x."id", x."applicantUserId" FROM "ApprovalInstance" x WHERE x."businessId" = p."id" ORDER BY x."createdAt" DESC LIMIT 1
      ) ai ON true WHERE p."status" IN ('draft', 'returned', 'withdrawn', 'abandoned')
    )
    SELECT 'payment_request' AS "domain", left(md5(f."id"), 12) AS "maskedId", f."status",
      left(md5(coalesce(f."applicantUserId", 'unassigned')), 12) AS "maskedResponsibleId", coalesce(u."isActive", false) AS "responsibleActive",
      f."createdAt", f."updatedAt", CASE WHEN f."approvalId" IS NULL THEN '0' ELSE '1' END AS "approvalInstanceCount", f.actions::text AS "approvalActionCount",
      f.files::text AS "fileEvidenceCount", greatest(f."requestedAmountCents" - f."paidAmountCents", 0)::text AS "occupiedAmountCents", f.executions::text AS "downstreamFactCount",
      CASE WHEN f.executions > 0 OR f.files > 0 THEN 'C' WHEN f."approvalId" IS NOT NULL OR f.actions > 0 OR f."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '申请人未启用或无法识别' END,
        CASE WHEN f."approvalId" IS NOT NULL OR f.actions > 0 THEN '存在审批历史' END,
        CASE WHEN f.executions > 0 THEN '存在实付记录' END,
        CASE WHEN f.files > 0 THEN '存在归档证据' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."applicantUserId" ORDER BY f."updatedAt"`,
  projectExpenseCandidates: `
    WITH facts AS (
      SELECT e.*, ai."id" AS "approvalId", (SELECT count(*) FROM "ApprovalActionLog" al WHERE al."approvalInstanceId" = ai."id") AS actions,
        (SELECT count(*) FROM "ProjectExpenseExecution" pe WHERE pe."projectExpenseRequestId" = e."id") AS executions,
        coalesce((SELECT sum(o."amountCents") FROM "ProjectExpenseFinancingQuotaUsage" o WHERE o."projectExpenseRequestId" = e."id" AND o."status" = 'occupied'), 0) AS occupancy
      FROM "ProjectExpenseRequest" e LEFT JOIN LATERAL (
        SELECT x."id" FROM "ApprovalInstance" x WHERE x."businessId" = e."id" ORDER BY x."createdAt" DESC LIMIT 1
      ) ai ON true WHERE e."status" IN ('draft', 'returned', 'withdrawn', 'abandoned')
    )
    SELECT 'project_expense' AS "domain", left(md5(f."id"), 12) AS "maskedId", f."status", left(md5(f."handlerUserId"), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", f."createdAt", f."updatedAt",
      CASE WHEN f."approvalId" IS NULL THEN '0' ELSE '1' END AS "approvalInstanceCount", f.actions::text AS "approvalActionCount",
      CASE WHEN f."attachmentFileId" IS NULL THEN '0' ELSE '1' END AS "fileEvidenceCount", f.occupancy::text AS "occupiedAmountCents",
      f.executions::text AS "downstreamFactCount",
      CASE WHEN f.executions > 0 THEN 'C' WHEN f."approvalId" IS NOT NULL OR f.actions > 0 OR f."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '经办人未启用' END,
        CASE WHEN f."approvalId" IS NOT NULL OR f.actions > 0 THEN '存在审批历史' END,
        CASE WHEN f.occupancy > 0 THEN '存在项目资金占用' END,
        CASE WHEN f.executions > 0 THEN '存在实付记录' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."handlerUserId" ORDER BY f."updatedAt"`,
  spotProcurementCandidates: `
    WITH facts AS (
      SELECT p.*, v."submittedAt", v."status" AS "versionStatus",
        (SELECT count(*) FROM "ApprovalInstance" ai WHERE ai."businessId" IN (p."id", v."id")) AS approvals,
        (SELECT count(*) FROM "SpotProcurementAttachment" a WHERE a."versionId" = v."id") AS files,
        (SELECT count(*) FROM "SpotProcurementPayment" pay WHERE pay."procurementId" = p."id") +
          (SELECT count(*) FROM "SpotProcurementReceipt" r WHERE r."procurementId" = p."id") AS downstream
      FROM "SpotProcurement" p JOIN "SpotProcurementVersion" v ON v."id" = p."currentVersionId"
      WHERE p."status" IN ('draft', 'returned', 'withdrawn', 'abandoned', 'voided')
    )
    SELECT 'spot_procurement' AS "domain", left(md5(f."id"), 12) AS "maskedId", f."status", left(md5(f."handlerUserId"), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", f."createdAt", f."updatedAt", f.approvals::text AS "approvalInstanceCount", '0' AS "approvalActionCount",
      f.files::text AS "fileEvidenceCount", '0' AS "occupiedAmountCents", f.downstream::text AS "downstreamFactCount",
      CASE WHEN f.downstream > 0 THEN 'C' WHEN f.approvals > 0 OR f."submittedAt" IS NOT NULL OR f."status" <> 'draft' OR f."versionStatus" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '经办人未启用' END,
        CASE WHEN f.approvals > 0 OR f."submittedAt" IS NOT NULL THEN '存在审批或提交历史' END,
        CASE WHEN f.files > 0 THEN '存在申请附件' END,
        CASE WHEN f.downstream > 0 THEN '存在付款或收货下游事实' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."handlerUserId" ORDER BY f."updatedAt"`,
  spotPaymentCandidates: `
    WITH facts AS (
      SELECT p.*, (SELECT count(*) FROM "ApprovalInstance" ai WHERE ai."businessId" = p."id") AS approvals,
        (SELECT count(*) FROM "SpotProcurementPaymentExecution" e WHERE e."paymentId" = p."id" AND e."voidedAt" IS NULL) AS executions,
        (CASE WHEN p."supportingAttachmentFileId" IS NULL THEN 0 ELSE 1 END + CASE WHEN p."merchantPaymentProofFileId" IS NULL THEN 0 ELSE 1 END) AS files
      FROM "SpotProcurementPayment" p WHERE p."status" IN ('draft', 'returned', 'withdrawn', 'abandoned', 'invalidated')
    )
    SELECT 'spot_payment' AS "domain", left(md5(f."id"), 12) AS "maskedId", f."status", left(md5(f."handlerUserId"), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", f."createdAt", f."updatedAt", f.approvals::text AS "approvalInstanceCount", '0' AS "approvalActionCount",
      f.files::text AS "fileEvidenceCount", greatest(f."approvalAmountCents" - f."paidAmountCents", 0)::text AS "occupiedAmountCents", f.executions::text AS "downstreamFactCount",
      CASE WHEN f.executions > 0 OR f."factsFrozenAt" IS NOT NULL THEN 'C' WHEN f.approvals > 0 OR f."submittedAt" IS NOT NULL OR f."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '经办人未启用' END,
        CASE WHEN f.approvals > 0 OR f."submittedAt" IS NOT NULL THEN '存在审批或提交历史' END,
        CASE WHEN f.files > 0 THEN '存在付款依据文件' END,
        CASE WHEN f.executions > 0 THEN '存在实付记录' END,
        CASE WHEN f."factsFrozenAt" IS NOT NULL THEN '付款事实已经冻结' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."handlerUserId" ORDER BY f."updatedAt"`,
  spotReceiptCandidates: `
    WITH facts AS (
      SELECT r.*, (SELECT count(*) FROM "SpotProcurementReceiptRevision" rr WHERE rr."receiptId" = r."id" AND rr."submittedAt" IS NOT NULL) AS submissions,
        (SELECT count(*) FROM "SpotProcurementReceiptPhoto" rp WHERE rp."receiptId" = r."id") AS files,
        (SELECT count(*) FROM "SpotProcurementReceiptReview" rv WHERE rv."receiptId" = r."id") AS reviews
      FROM "SpotProcurementReceipt" r WHERE r."status" IN ('draft', 'returned', 'withdrawn', 'abandoned', 'cancelled')
    )
    SELECT 'spot_receipt' AS "domain", left(md5(f."id"), 12) AS "maskedId", f."status", left(md5(f."handlerUserId"), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", f."createdAt", f."updatedAt", f.submissions::text AS "approvalInstanceCount", f.reviews::text AS "approvalActionCount",
      f.files::text AS "fileEvidenceCount", f."actualCostCents"::text AS "occupiedAmountCents", f.reviews::text AS "downstreamFactCount",
      CASE WHEN f.reviews > 0 OR f."lockedAt" IS NOT NULL THEN 'C' WHEN f.submissions > 0 OR f."firstSubmittedAt" IS NOT NULL OR f."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '经办人未启用' END,
        CASE WHEN f.submissions > 0 OR f."firstSubmittedAt" IS NOT NULL THEN '存在提交历史' END,
        CASE WHEN f.files > 0 THEN '存在收货照片' END,
        CASE WHEN f.reviews > 0 OR f."lockedAt" IS NOT NULL THEN '存在复核或冻结事实' END
      ]::text[], NULL) AS "blockingReasons"
    FROM facts f LEFT JOIN "User" u ON u."id" = f."handlerUserId" ORDER BY f."updatedAt"`,
  templateVersionCandidates: `
    SELECT x."domain", left(md5(x."id"), 12) AS "maskedId", x."status", left(md5(x."responsibleUserId"), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", x."createdAt", x."updatedAt", CASE WHEN x."submitted" THEN '1' ELSE '0' END AS "approvalInstanceCount",
      '0' AS "approvalActionCount", x."fileCount"::text AS "fileEvidenceCount", '0' AS "occupiedAmountCents", '0' AS "downstreamFactCount",
      CASE WHEN x."published" THEN 'C' WHEN x."submitted" OR x."status" <> 'draft' THEN 'B' ELSE 'A' END AS "classification",
      array_remove(ARRAY[
        CASE WHEN NOT coalesce(u."isActive", false) THEN '创建人未启用' END,
        CASE WHEN x."submitted" THEN '版本已经提交' END,
        CASE WHEN x."published" THEN '版本已经发布' END,
        CASE WHEN x."fileCount" > 0 THEN '版本包含模板文件' END
      ]::text[], NULL) AS "blockingReasons"
    FROM (
      SELECT 'contract_business_template' AS "domain", v."id", v."status", t."createdByUserId" AS "responsibleUserId", v."createdAt", v."updatedAt",
        v."submittedByUserId" IS NOT NULL AS "submitted", v."publishedAt" IS NOT NULL AS "published", 0 AS "fileCount"
      FROM "ContractBusinessTemplateVersion" v JOIN "ContractBusinessTemplate" t ON t."id" = v."templateId" WHERE v."status" IN ('draft', 'submitted', 'discarded')
      UNION ALL
      SELECT 'contract_layout_template', v."id", v."status", t."createdByUserId", v."createdAt", v."updatedAt",
        v."submittedByUserId" IS NOT NULL, v."publishedAt" IS NOT NULL, 1 + CASE WHEN v."previewPdfFileId" IS NULL THEN 0 ELSE 1 END
      FROM "ContractLayoutTemplateVersion" v JOIN "ContractLayoutTemplate" t ON t."id" = v."layoutTemplateId" WHERE v."status" IN ('draft', 'submitted', 'discarded')
      UNION ALL
      SELECT 'standard_clause', v."id", v."status", c."createdByUserId", v."createdAt", v."updatedAt",
        v."submittedByUserId" IS NOT NULL, v."publishedAt" IS NOT NULL, 0
      FROM "StandardClauseVersion" v JOIN "StandardClause" c ON c."id" = v."clauseId" WHERE v."status" IN ('draft', 'submitted', 'discarded')
      UNION ALL
      SELECT 'settlement_template', v."id", v."status", t."createdByUserId", v."createdAt", v."updatedAt",
        v."submittedByUserId" IS NOT NULL, v."publishedAt" IS NOT NULL, 1 + CASE WHEN v."previewXlsxFileId" IS NULL THEN 0 ELSE 1 END + CASE WHEN v."previewPdfFileId" IS NULL THEN 0 ELSE 1 END
      FROM "SettlementTemplateVersion" v JOIN "SettlementTemplate" t ON t."id" = v."settlementTemplateId" WHERE v."status" IN ('draft', 'submitted', 'discarded')
    ) x LEFT JOIN "User" u ON u."id" = x."responsibleUserId" ORDER BY x."updatedAt"`,
  temporaryCandidates: `
    SELECT x."domain", left(md5(x."id"), 12) AS "maskedId", x."status", left(md5(coalesce(x."responsibleUserId", 'system')), 12) AS "maskedResponsibleId",
      coalesce(u."isActive", false) AS "responsibleActive", x."createdAt", x."updatedAt", '0' AS "approvalInstanceCount", '0' AS "approvalActionCount",
      x."fileCount"::text AS "fileEvidenceCount", '0' AS "occupiedAmountCents", '0' AS "downstreamFactCount", 'D' AS "classification",
      ARRAY['技术临时数据只允许按独立保留策略清理']::text[] AS "blockingReasons"
    FROM (
      SELECT 'settlement_import_preview' AS "domain", i."id", i."status", i."createdByUserId" AS "responsibleUserId", i."createdAt", i."updatedAt", 1 AS "fileCount"
      FROM "SettlementImport" i WHERE i."status" = 'preview' AND i."appliedAt" IS NULL
      UNION ALL
      SELECT 'contract_document_comparison', c."id", c."status", NULL, c."createdAt", c."updatedAt", 0
      FROM "ContractDocumentComparison" c WHERE c."status" IN ('queued', 'processing', 'failed')
    ) x LEFT JOIN "User" u ON u."id" = x."responsibleUserId" ORDER BY x."updatedAt"`
});

async function inspect() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET default_transaction_read_only = on");
      const report = {};
      for (const [name, query] of Object.entries(checks)) {
        report[name] = await tx.$queryRawUnsafe(query);
      }
      return report;
    });
  } finally {
    await prisma.$disconnect();
  }
}

inspect()
  .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
  .catch(() => {
    process.stderr.write("草稿生命周期只读盘点失败，请检查数据库连接、迁移状态和只读权限。\n");
    process.exitCode = 1;
  });
