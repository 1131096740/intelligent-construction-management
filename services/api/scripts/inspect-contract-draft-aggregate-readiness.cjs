const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const MAX_ROWS = 10_000;
const EDITABLE_STATUSES = new Set([
  "draft",
  "returned",
  "withdrawn",
  "abandoned"
]);

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
  migrationHead: `SELECT coalesce(max(migration_name), 'none') AS "migrationHead" FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  candidateCount: `SELECT count(*)::text AS "count" FROM "ContractVersion" WHERE "status" IN ('draft', 'returned', 'withdrawn', 'abandoned', 'effective')`,
  candidates: `
    SELECT
      cv."id" AS "contractVersionId",
      cv."status" AS "versionStatus",
      cv."draftRevision",
      (SELECT count(*)::text FROM "ContractBill" b WHERE b."contractVersionId" = cv."id") AS "billCount",
      (SELECT count(*)::text
        FROM "ContractBillRow" br
        JOIN "ContractBill" b ON b."id" = br."contractBillId"
        WHERE b."contractVersionId" = cv."id"
          AND br."taxExclusiveUnitPrice" IS NULL) AS "missingTaxExclusiveUnitPriceCount",
      (SELECT count(*)::text
        FROM "ContractBillRow" br
        JOIN "ContractBill" b ON b."id" = br."contractBillId"
        WHERE b."contractVersionId" = cv."id"
          AND br."taxExclusiveUnitPrice" IS NULL
          AND (
            br."taxExclusiveAmountCents" IS NULL
            OR br."quantity" IS NULL
            OR br."quantity" = 0
          )) AS "underivableTaxExclusiveUnitPriceCount",
      (SELECT count(*)::text FROM "ContractPartySnapshot" p WHERE p."contractVersionId" = cv."id") AS "partyCount",
      (SELECT count(*)::text FROM "ContractDraftAttachment" a WHERE a."contractVersionId" = cv."id") AS "attachmentCount",
      (SELECT max(d."sourceRevision") FROM "ContractGeneratedDocument" d
        WHERE d."contractVersionId" = cv."id" AND d."purpose" = 'draft' AND d."status" = 'success') AS "latestGeneratedRevision",
      EXISTS (
        SELECT 1
        FROM "ContractDraftCheckpoint" cp
        WHERE cp."contractVersionId" = cv."id"
          AND cp."sequenceNo" = (
            SELECT max(cp2."sequenceNo")
            FROM "ContractDraftCheckpoint" cp2
            WHERE cp2."contractVersionId" = cv."id"
          )
          AND (
            cv."updatedAt" > cp."createdAt"
            OR EXISTS (
              SELECT 1 FROM "ContractBill" b
              WHERE b."contractVersionId" = cv."id" AND b."updatedAt" > cp."createdAt"
            )
            OR EXISTS (
              SELECT 1
              FROM "ContractBillRow" r
              JOIN "ContractBill" b ON b."id" = r."contractBillId"
              WHERE b."contractVersionId" = cv."id" AND r."updatedAt" > cp."createdAt"
            )
          )
      ) AS "checkpointChangedAfterCreation",
      (SELECT count(*)::text FROM "ApprovalInstance" ai
        WHERE ai."businessType" = 'contract_version'
          AND ai."businessId" = cv."id"
          AND ai."flowType" = 'contract.approve') AS "approvalInstanceCount",
      (SELECT min(ai."createdAt") FROM "ApprovalInstance" ai
        WHERE ai."businessType" = 'contract_version'
          AND ai."businessId" = cv."id"
          AND ai."flowType" = 'contract.approve') AS "earliestApprovalCreatedAt",
      cv."firstSubmittedAt",
      c."code" AS "formalCode",
      cv."abandonedAt",
      t."id" AS "takeoverId",
      t."activatedAt" AS "takeoverActivatedAt",
      t."takeoverStatus",
      t."confirmedAt" AS "oldContractConfirmedAt",
      t."historicalBalanceConfirmedAt" AS "oldFinanceConfirmedAt",
      CASE WHEN cf."takeoverId" IS NULL THEN '0' ELSE '1' END AS "contractFactsCount",
      CASE WHEN ff."takeoverId" IS NULL THEN '0' ELSE '1' END AS "financeFactsCount",
      CASE
        WHEN t."id" IS NULL OR cf."takeoverId" IS NOT NULL THEN true
        ELSE (
          length(btrim(coalesce(c."code", c."temporaryCode", ''))) > 0
          AND length(btrim(c."name")) > 0
          AND length(btrim(coalesce(c."contractTypeKey", ''))) > 0
          AND length(btrim(c."counterparty")) > 0
          AND length(btrim(coalesce(t."evidenceSummary", ''))) > 0
          AND pt."id" IS NOT NULL
          AND length(btrim(pt."originalText")) > 0
          AND EXISTS (
            SELECT 1 FROM "ContractTakeoverSettlementEvidence" se
            WHERE se."takeoverId" = t."id"
          )
        )
      END AS "takeoverContractFactsSourceComplete",
      coalesce(t."historicalPaidCents", 0)::text AS "historicalPaidCents",
      coalesce((SELECT sum(hp."amountCents") FROM "ContractTakeoverHistoricalPayment" hp
        WHERE hp."takeoverId" = t."id"), 0)::text AS "itemizedHistoricalPaidCents",
      (SELECT count(*)::text FROM "ContractTakeoverHistoricalPayment" hp
        WHERE hp."takeoverId" = t."id") AS "historicalPaymentCount",
      (SELECT count(*)::text
        FROM "ContractTakeoverHistoricalPaymentVoucher" hv
        JOIN "ContractTakeoverHistoricalPayment" hp ON hp."id" = hv."historicalPaymentId"
        WHERE hp."takeoverId" = t."id") AS "historicalVoucherCount",
      coalesce(t."historicalApprovalPendingPaymentCents", 0)::text AS "historicalApprovalPendingPaymentCents",
      coalesce(t."historicalApprovedPendingPaymentCents", 0)::text AS "historicalApprovedPendingPaymentCents",
      cf."performanceStatus",
      c."settlementClosedAt",
      c."finalSettlementId"
    FROM "ContractVersion" cv
    JOIN "Contract" c ON c."id" = cv."contractId"
    LEFT JOIN "ContractTakeover" t ON t."contractVersionId" = cv."id"
    LEFT JOIN "PaymentTermsVersion" pt ON pt."id" = t."paymentTermsVersionId"
    LEFT JOIN "ContractTakeoverContractFacts" cf ON cf."takeoverId" = t."id"
    LEFT JOIN "ContractTakeoverFinanceFacts" ff ON ff."takeoverId" = t."id"
    WHERE cv."status" IN ('draft', 'returned', 'withdrawn', 'abandoned', 'effective')
    ORDER BY cv."id"
    LIMIT 10001`
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function databaseFingerprint(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }
  return crypto.createHash("sha256").update(databaseUrl).digest("hex");
}

function countText(value) {
  const text = String(value ?? "0");
  if (!/^\d+$/u.test(text)) throw new Error("readiness count is invalid");
  return text;
}

function centsText(value) {
  const text = String(value ?? "0");
  if (!/^-?\d+$/u.test(text)) throw new Error("readiness amount is invalid");
  return text;
}

function classifyRow(row) {
  const approvalInstanceCount = countText(row.approvalInstanceCount);
  const billCount = countText(row.billCount);
  const missingTaxExclusiveUnitPriceCount = countText(
    row.missingTaxExclusiveUnitPriceCount
  );
  const underivableTaxExclusiveUnitPriceCount = countText(
    row.underivableTaxExclusiveUnitPriceCount
  );
  const partyCount = countText(row.partyCount);
  const attachmentCount = countText(row.attachmentCount);
  const historicalPaidCents = centsText(row.historicalPaidCents);
  const itemizedHistoricalPaidCents = centsText(
    row.itemizedHistoricalPaidCents
  );
  const historicalPaymentCount = countText(row.historicalPaymentCount);
  const historicalVoucherCount = countText(row.historicalVoucherCount);
  const pendingCents = BigInt(
    centsText(row.historicalApprovalPendingPaymentCents)
  );
  const approvedPendingCents = BigInt(
    centsText(row.historicalApprovedPendingPaymentCents)
  );
  const hasPriorSubmissionEvidence =
    row.firstSubmittedAt !== null || approvalInstanceCount !== "0";
  const formalCodeAllocatedWhileDraft =
    EDITABLE_STATUSES.has(String(row.versionStatus)) &&
    Boolean(row.formalCode) &&
    !hasPriorSubmissionEvidence;
  const hasActiveRetentionOrPurgeCandidate =
    row.versionStatus === "abandoned" || row.abandonedAt !== null;
  const takeoverUnactivatedDraft =
    row.takeoverId !== null &&
    row.takeoverActivatedAt === null &&
    ["draft", "needs_supplement", "returned", "withdrawn"].includes(
      String(row.takeoverStatus)
    );
  const hasLegacySingleConfirmation =
    row.takeoverId !== null &&
    (row.oldContractConfirmedAt !== null || row.oldFinanceConfirmedAt !== null) &&
    (countText(row.contractFactsCount) === "0" ||
      countText(row.financeFactsCount) === "0");
  const contractFactsInitializableWithoutGuessing =
    row.takeoverId === null ||
    countText(row.contractFactsCount) === "1" ||
    (takeoverUnactivatedDraft &&
      !hasLegacySingleConfirmation &&
      row.takeoverContractFactsSourceComplete === true);
  const financeFactsInitializableWithoutGuessing =
    row.takeoverId === null ||
    countText(row.financeFactsCount) === "1" ||
    (takeoverUnactivatedDraft &&
      !hasLegacySingleConfirmation &&
      (historicalPaidCents === "0" ||
        (historicalPaidCents === itemizedHistoricalPaidCents &&
          historicalPaymentCount === historicalVoucherCount)));
  const hasPendingOrApprovedUnpaid =
    pendingCents !== 0n || approvedPendingCents !== 0n;
  const reasons = [];
  const blockingReasons = [];

  if (hasActiveRetentionOrPurgeCandidate) {
    blockingReasons.push("ACTIVE_RETENTION_OR_PURGE_CANDIDATE");
  }
  if (formalCodeAllocatedWhileDraft) {
    blockingReasons.push("FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION");
  }
  if (row.checkpointChangedAfterCreation) {
    reasons.push("CHECKPOINT_DIFF_REQUIRES_OWNER_SELECTION");
  }
  if (
    row.versionStatus === "effective" &&
    (row.performanceStatus === null || row.performanceStatus === undefined)
  ) {
    reasons.push("PERFORMANCE_STATUS_REQUIRES_CONFIRMATION");
  }
  if (row.settlementClosedAt !== null && row.finalSettlementId !== null) {
    reasons.push("COMPLETED_STATUS_REQUIRES_CONFIRMATION");
  }
  if (hasLegacySingleConfirmation) {
    reasons.push("LEGACY_SINGLE_CONFIRMATION_REQUIRES_REVIEW");
  }
  if (hasPendingOrApprovedUnpaid) {
    reasons.push("PENDING_UNPAID_CANNOT_BECOME_HISTORICAL_PAYMENT");
  }
  if (underivableTaxExclusiveUnitPriceCount !== "0") {
    reasons.push("TAX_EXCLUSIVE_UNIT_PRICE_NOT_EXACTLY_DERIVABLE");
  }
  if (!contractFactsInitializableWithoutGuessing) {
    reasons.push("CONTRACT_FACTS_REQUIRE_MANUAL_INPUT");
  }
  if (!financeFactsInitializableWithoutGuessing) {
    reasons.push("HISTORICAL_PAYMENT_ITEMIZATION_REQUIRES_MANUAL_INPUT");
  }

  return {
    contractVersionId: String(row.contractVersionId),
    status:
      blockingReasons.length > 0
        ? "blocking"
        : reasons.length > 0
          ? "manual_review"
          : "ready",
    facts: {
      exactVersionReadable: true,
      draftRevision: Number(row.draftRevision),
      billCount: Number(billCount),
      missingTaxExclusiveUnitPriceCount: Number(
        missingTaxExclusiveUnitPriceCount
      ),
      underivableTaxExclusiveUnitPriceCount: Number(
        underivableTaxExclusiveUnitPriceCount
      ),
      partyCount: Number(partyCount),
      attachmentCount: Number(attachmentCount),
      latestGeneratedRevision:
        row.latestGeneratedRevision === null
          ? null
          : Number(row.latestGeneratedRevision),
      hasCheckpointOnlyDifference: Boolean(
        row.checkpointChangedAfterCreation
      ),
      hasPriorSubmissionEvidence,
      formalCodeAllocatedWhileDraft,
      hasActiveRetentionOrPurgeCandidate,
      takeoverUnactivatedDraft,
      hasLegacySingleConfirmation,
      contractFactsInitializableWithoutGuessing,
      takeoverContractFactsSourceComplete:
        row.takeoverContractFactsSourceComplete !== false,
      financeFactsInitializableWithoutGuessing,
      hasPendingOrApprovedUnpaid,
      historicalPaidCents,
      itemizedHistoricalPaidCents,
      historicalPaymentCount: Number(historicalPaymentCount),
      historicalVoucherCount: Number(historicalVoucherCount),
      performanceStatus: row.performanceStatus ?? null,
      completedStatusCandidate:
        row.settlementClosedAt !== null && row.finalSettlementId !== null
    },
    reasons: [...blockingReasons, ...reasons]
  };
}

function createReport({
  databaseFingerprint: fingerprint,
  generatedAt,
  migrationHead,
  totalRows,
  rows,
  maxRows = MAX_ROWS
}) {
  const truncated = totalRows > maxRows || rows.length > maxRows;
  const countChanged = !truncated && totalRows !== rows.length;
  if (truncated || countChanged) {
    const blocked = {
      schemaVersion: 1,
      mode: "read_only",
      status: "blocked",
      databaseFingerprint: fingerprint,
      migrationHead,
      generatedAt,
      page: {
        maxRows,
        totalRows,
        returnedRows: 0,
        truncated
      },
      summary: {
        ready: 0,
        manualReview: 0,
        blocking: totalRows
      },
      blockers: [truncated ? "REPORT_TRUNCATED" : "CANDIDATE_COUNT_CHANGED"],
      records: []
    };
    return { ...blocked, reportSha256: sha256(blocked) };
  }

  const records = rows.map(classifyRow);
  const summary = {
    ready: records.filter((record) => record.status === "ready").length,
    manualReview: records.filter((record) => record.status === "manual_review")
      .length,
    blocking: records.filter((record) => record.status === "blocking").length
  };
  const body = {
    schemaVersion: 1,
    mode: "read_only",
    status:
      summary.blocking > 0
        ? "blocked"
        : summary.manualReview > 0
          ? "manual_review"
          : "ready",
    databaseFingerprint: fingerprint,
    migrationHead,
    generatedAt,
    page: {
      maxRows,
      totalRows,
      returnedRows: records.length,
      truncated: false
    },
    summary,
    blockers: [],
    records
  };
  return { ...body, reportSha256: sha256(body) };
}

function verifyReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("readiness report is invalid");
  }
  const { reportSha256, ...body } = report;
  if (
    typeof report.databaseFingerprint !== "string" ||
    report.databaseFingerprint.length === 0
  ) {
    throw new Error("readiness report database fingerprint is missing");
  }
  if (
    typeof reportSha256 !== "string" ||
    reportSha256 !== sha256(body)
  ) {
    throw new Error("readiness report SHA-256 mismatch");
  }
}

async function inspectWithClient(prisma, now = new Date()) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET default_transaction_read_only = on");
      const report = {};
      for (const [name, query] of Object.entries(checks)) {
        report[name] = await tx.$queryRawUnsafe(query);
      }
      return report;
    },
    { isolationLevel: "RepeatableRead" }
  );
  const totalRows = Number(result.candidateCount?.[0]?.count ?? 0);
  const report = createReport({
    databaseFingerprint: databaseFingerprint(process.env.DATABASE_URL),
    generatedAt: now.toISOString(),
    migrationHead: String(
      result.migrationHead?.[0]?.migrationHead ?? "none"
    ),
    totalRows,
    rows: result.candidates ?? []
  });
  verifyReport(report);
  return report;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await inspectWithClient(prisma);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  MAX_ROWS,
  checks,
  canonicalize,
  sha256,
  databaseFingerprint,
  classifyRow,
  createReport,
  verifyReport,
  inspectWithClient
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "合同草稿聚合只读预检失败，请检查数据库连接、迁移状态和只读权限。\n"
    );
    process.exitCode = 1;
  });
}
