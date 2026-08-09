#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * #19 only creates a bounded, read-only receipt for legacy contract cleanup.
 * It intentionally has no apply implementation: a future production execution
 * must re-read a fresh report and receive a separate, exact authorization.
 */

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { Prisma, PrismaClient } = require("@prisma/client");

const PAGE_SIZE = 500;
const POLICY_ID = "contract-ended-retention-v1";
const LEGACY_SCANNED_STATUSES = ["draft", "abandoned", "approval_rejected", "deleting"];
const FORBIDDEN_REPORT_KEYS = new Set([
  "objectKey",
  "bucket",
  "originalName",
  "contractName",
  "counterparty",
  "phone",
  "userName",
  "username",
  "databaseUrl",
  "connectionString",
  "DATABASE_URL",
  "host",
  "password",
  "schemaName",
  "sql"
]);

const checks = Object.freeze({
  migrationHead: `
    SELECT "migration_name" AS "migrationHead"
    FROM "_prisma_migrations"
    ORDER BY "finished_at" DESC NULLS LAST
    LIMIT 1`,
  migrationBaseline: `
    SELECT "migration_name" AS "migrationName", "checksum"
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL
    ORDER BY "migration_name" ASC`,
  policy: () => Prisma.sql`
    SELECT "activatedAt"
    FROM "ContractEndedApplicationRetentionPolicy"
    WHERE "id" = ${POLICY_ID}
    LIMIT 1`,
  candidateCount: `
    SELECT count(*)::text AS "count"
    FROM "ContractVersion"
    WHERE "status" IN ('draft', 'abandoned', 'approval_rejected', 'deleting')`,
  candidates: (afterContractVersionId) => Prisma.sql`
    SELECT
      version."id" AS "contractVersionId",
      version."status",
      contract."source",
      version."changeType",
      version."versionNo",
      version."firstSubmittedAt",
      version."abandonedAt",
      version."abandonedByUserId",
      version."abandonReason",
      version."endedAt",
      version."effectiveAt",
      (SELECT count(*)::text
       FROM "ApprovalInstance" instance
       WHERE instance."businessType" = 'contract_version'
         AND instance."businessId" = version."id") AS "approvalInstanceCount",
      (SELECT count(*)::text
       FROM "ApprovalActionLog" action
       INNER JOIN "ApprovalInstance" instance ON instance."id" = action."approvalInstanceId"
       WHERE instance."businessType" = 'contract_version'
         AND instance."businessId" = version."id") AS "approvalActionCount",
      (SELECT count(*)::text
       FROM "ContractEndedApplicationRetentionHold" hold
       WHERE hold."contractVersionId" = version."id"
         AND hold."releasedAt" IS NULL) AS "holdCount",
      ((CASE WHEN version."effectiveAt" IS NOT NULL THEN 1 ELSE 0 END) +
       (SELECT count(*) FROM "ContractVersion" sibling
        WHERE sibling."contractId" = version."contractId" AND sibling."id" <> version."id") +
       (SELECT count(*) FROM "ContractVersion" copied
        WHERE copied."copiedFromContractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractTakeover" takeover
        WHERE takeover."contractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractSettlementProcess" process
        WHERE process."contractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractArchiveFile" archive
        WHERE archive."contractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractFormalFile" formal
        WHERE formal."contractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractAuthorization" contract_authorization
        WHERE contract_authorization."originContractVersionId" = version."id") +
       (SELECT count(*) FROM "ContractSealTask" seal
        WHERE seal."contractVersionId" = version."id") +
       (SELECT count(*) FROM "SettlementDraft" draft
        WHERE draft."contractVersionId" = version."id") +
       (SELECT count(*) FROM "Settlement" settlement
        WHERE settlement."contractVersionId" = version."id") +
       (SELECT count(*) FROM "PaymentRequest" payment
        WHERE payment."contractVersionId" = version."id"))::text AS "formalBusinessFactCount",
      (CASE
        WHEN contract."id" <> version."contractId"
          OR contract."projectId" IS NULL
          OR version."changeType" IS NULL
          OR version."versionNo" IS NULL
        THEN 1 ELSE 0
      END)::text AS "inconsistentCoordinateCount"
    FROM "ContractVersion" version
    INNER JOIN "Contract" contract ON contract."id" = version."contractId"
    WHERE version."status" IN ('draft', 'abandoned', 'approval_rejected', 'deleting')
      AND version."id" > ${afterContractVersionId}
    ORDER BY version."id" ASC
    LIMIT ${PAGE_SIZE}`
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

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

function databaseFingerprint({
  migrationHead,
  migrationCount,
  migrationDigest,
  candidateStateHash
}) {
  invariant(typeof migrationHead === "string" && migrationHead.length > 0, "migrationHead is required");
  invariant(Number.isInteger(migrationCount) && migrationCount >= 0, "migrationCount is invalid");
  readSha(migrationDigest, "migrationDigest", 64);
  readSha(candidateStateHash, "candidateStateHash", 64);
  return sha256({
    format: "legacy-contract-cleanup-preflight-db-v1",
    migrationHead,
    migrationCount,
    migrationDigest,
    candidateStateHash
  });
}

function count(value, field) {
  const text = String(value ?? "0");
  invariant(/^\d+$/u.test(text), `${field} must be a non-negative integer`);
  return Number(text);
}

function iso(value, field) {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  invariant(!Number.isNaN(parsed.getTime()), `${field} is invalid`);
  return parsed.toISOString();
}

function readSha(value, field, length) {
  invariant(
    typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value),
    `${field} is invalid`
  );
  return value;
}

function isLegacyDeleteAuthorized(row) {
  return row.status === "abandoned" &&
    row.source === "system" &&
    row.changeType === "original" &&
    Number(row.versionNo) === 1 &&
    row.firstSubmittedAt == null &&
    count(row.approvalInstanceCount, "approvalInstanceCount") === 0 &&
    count(row.approvalActionCount, "approvalActionCount") === 0 &&
    row.abandonedAt != null &&
    Boolean(row.abandonedByUserId) &&
    row.abandonReason == null;
}

function retentionStartsAt(row, policyActivatedAt) {
  const terminalAt = iso(row.endedAt, "endedAt");
  if (!terminalAt || terminalAt < policyActivatedAt) return policyActivatedAt;
  return terminalAt;
}

function classifyRow(row, policyActivatedAt) {
  invariant(typeof row.contractVersionId === "string" && row.contractVersionId.length > 0,
    "contractVersionId is required");
  const fileSummary = {
    exclusiveFileCount: count(row.exclusiveFileCount, "exclusiveFileCount"),
    sharedFileCount: count(row.sharedFileCount, "sharedFileCount"),
    objectVersionCount: count(row.versionCount, "versionCount"),
    deleteMarkerCount: count(row.deleteMarkerCount, "deleteMarkerCount")
  };
  const safety = {
    activeHoldCount: count(row.holdCount, "holdCount"),
    formalBusinessFactCount: count(row.formalBusinessFactCount, "formalBusinessFactCount"),
    unknownBindingCount: count(row.unknownBindingCount, "unknownBindingCount"),
    missingFileHashCount: count(row.missingFileHashCount, "missingFileHashCount"),
    inconsistentCoordinateCount: count(
      row.inconsistentCoordinateCount,
      "inconsistentCoordinateCount"
    ),
    versionEnumerationFailureCount: count(
      row.versionEnumerationFailureCount,
      "versionEnumerationFailureCount"
    ),
    bucketMismatchCount: count(row.bucketMismatchCount, "bucketMismatchCount")
  };
  const reasons = [];
  if (safety.activeHoldCount > 0) reasons.push("ACTIVE_RETENTION_HOLD");
  if (safety.formalBusinessFactCount > 0) reasons.push("FORMAL_OR_DOWNSTREAM_FACT");
  if (safety.unknownBindingCount > 0) reasons.push("UNKNOWN_FILE_BINDING");
  if (safety.missingFileHashCount > 0) reasons.push("MISSING_FILE_HASH");
  if (safety.inconsistentCoordinateCount > 0) reasons.push("INCONSISTENT_PROJECT_VERSION_COORDINATE");
  if (safety.versionEnumerationFailureCount > 0) reasons.push("COS_VERSION_ENUMERATION_UNAVAILABLE");
  if (safety.bucketMismatchCount > 0) reasons.push("COS_BUCKET_SCOPE_MISMATCH");

  const legacyAuthorized = isLegacyDeleteAuthorized(row);
  if (legacyAuthorized) {
    return {
      contractVersionId: row.contractVersionId,
      classification: "legacy_abandoned",
      authorization: "legacy_delete_confirmed",
      status: reasons.length ? "blocking" : "candidate",
      retentionStartsAt: null,
      fileSummary,
      objectListHash: readSha(row.objectListHash, "objectListHash", 64),
      reasons
    };
  }

  if (row.status === "abandoned") {
    return {
      contractVersionId: row.contractVersionId,
      classification: "legacy_abandoned",
      authorization: "unverified",
      status: "blocking",
      retentionStartsAt: null,
      fileSummary,
      objectListHash: readSha(row.objectListHash, "objectListHash", 64),
      reasons: [
        ...reasons,
        ...(row.source !== "system" ? ["LEGACY_SOURCE_NOT_SYSTEM"] : []),
        "LEGACY_DELETE_FACT_UNVERIFIABLE"
      ]
    };
  }

  if (row.status === "approval_rejected") {
    return {
      contractVersionId: row.contractVersionId,
      classification: "ended_application",
      authorization: "retention_only",
      status: reasons.length ? "blocking" : "retained",
      retentionStartsAt: retentionStartsAt(row, policyActivatedAt),
      fileSummary,
      objectListHash: readSha(row.objectListHash, "objectListHash", 64),
      reasons
    };
  }

  if (row.status === "draft") {
    return {
      contractVersionId: row.contractVersionId,
      classification: "active_draft",
      authorization: "separate_user_confirmation_required",
      status: reasons.length ? "blocking" : "manual_review",
      retentionStartsAt: null,
      fileSummary,
      objectListHash: readSha(row.objectListHash, "objectListHash", 64),
      reasons: reasons.length ? reasons : ["ACTIVE_DRAFT_IS_NEVER_AUTOMATICALLY_SELECTED"]
    };
  }

  return {
    contractVersionId: row.contractVersionId,
    classification: "cleanup_in_progress",
    authorization: "none",
    status: "blocking",
    retentionStartsAt: null,
    fileSummary,
    objectListHash: readSha(row.objectListHash, "objectListHash", 64),
    reasons: [...reasons, "LIFECYCLE_STATUS_NOT_ELIGIBLE_FOR_LEGACY_AUTHORIZATION"]
  };
}

function createReport({
  codeSha,
  databaseFingerprint: fingerprint,
  generatedAt,
  batchId,
  migrationHead,
  policyActivatedAt,
  totalRows,
  rows
}) {
  readSha(codeSha, "codeSha", 40);
  readSha(fingerprint, "databaseFingerprint", 64);
  invariant(typeof batchId === "string" && /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(batchId),
    "batchId is invalid");
  invariant(typeof migrationHead === "string" && migrationHead.length > 0, "migrationHead is required");
  const generated = iso(generatedAt, "generatedAt");
  const activation = iso(policyActivatedAt, "policyActivatedAt");
  const total = count(totalRows, "totalRows");
  invariant(Array.isArray(rows), "rows must be an array");
  const countChanged = total !== rows.length;
  const base = {
    schemaVersion: 1,
    mode: "read_only",
    executionAllowed: false,
    apply: {
      status: "disabled",
      reason: "issue_19_preflight_only",
      futureRequirements: [
        "fresh_report",
        "exact_report_sha256",
        "exact_database_fingerprint",
        "separate_production_authorization"
      ]
    },
    codeSha,
    databaseFingerprint: fingerprint,
    generatedAt: generated,
    batchId,
    migrationHead,
    policy: activation
      ? {
          activatedAt: activation,
          legacyRetentionStartsAt: activation,
          calendarMonths: 3
        }
      : null,
    page: {
      pageSize: PAGE_SIZE,
      totalRows: total,
      returnedRows: rows.length,
      pageCount: Math.ceil(total / PAGE_SIZE),
      traversal: "internal_keyset_complete"
    }
  };
  if (!activation || countChanged) {
    const blockers = [
      ...(!activation ? ["RETENTION_POLICY_NOT_ACTIVATED"] : []),
      ...(countChanged ? ["CANDIDATE_COUNT_CHANGED"] : [])
    ];
    const report = {
      ...base,
      status: "blocked",
      summary: {
        legacyAuthorizedCandidates: 0,
        retainedRecords: 0,
        manualReviewRecords: 0,
        blockingRecords: total,
        exclusiveFileCount: 0,
        sharedFileCount: 0,
        objectVersionCount: 0,
        deleteMarkerCount: 0
      },
      blockers,
      records: []
    };
    return { ...report, reportSha256: sha256(report) };
  }

  const records = rows.map((row) => classifyRow(row, activation));
  const summary = {
    legacyAuthorizedCandidates: records.filter((record) => record.status === "candidate").length,
    retainedRecords: records.filter((record) => record.status === "retained").length,
    manualReviewRecords: records.filter((record) => record.status === "manual_review").length,
    blockingRecords: records.filter((record) => record.status === "blocking").length,
    exclusiveFileCount: records.reduce((sum, record) => sum + record.fileSummary.exclusiveFileCount, 0),
    sharedFileCount: records.reduce((sum, record) => sum + record.fileSummary.sharedFileCount, 0),
    objectVersionCount: records.reduce((sum, record) => sum + record.fileSummary.objectVersionCount, 0),
    deleteMarkerCount: records.reduce((sum, record) => sum + record.fileSummary.deleteMarkerCount, 0)
  };
  const blockers = [...new Set(records.flatMap((record) => record.reasons))].sort();
  const report = {
    ...base,
    status: summary.blockingRecords > 0
      ? "blocked"
      : summary.manualReviewRecords > 0
        ? "manual_review"
        : "ready",
    summary,
    blockers,
    objectManifestHash: sha256(records.map((record) => ({
      contractVersionId: record.contractVersionId,
      objectListHash: record.objectListHash
    }))),
    records
  };
  assertNoSensitiveReportKeys(report);
  return { ...report, reportSha256: sha256(report) };
}

function assertNoSensitiveReportKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveReportKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(!FORBIDDEN_REPORT_KEYS.has(key), `report must not contain ${key}`);
    assertNoSensitiveReportKeys(child);
  }
}

function verifyReport(report) {
  invariant(report && typeof report === "object", "preflight report is invalid");
  assertNoSensitiveReportKeys(report);
  invariant(report.mode === "read_only", "preflight report mode is invalid");
  invariant(report.executionAllowed === false, "preflight execution must remain disabled");
  invariant(report.apply?.status === "disabled", "preflight apply must remain disabled");
  readSha(report.codeSha, "codeSha", 40);
  readSha(report.databaseFingerprint, "databaseFingerprint", 64);
  const { reportSha256, ...body } = report;
  invariant(typeof reportSha256 === "string" && reportSha256 === sha256(body),
    "preflight report SHA-256 mismatch");
}

function enrichWithManifest(row, manifest, configuredBucket, storageAvailable) {
  const rows = manifest?.rows ?? [];
  const exclusive = rows.filter((item) => item.bindingType === "exclusive");
  const shared = rows.filter((item) => item.bindingType === "shared");
  const objectListHash = sha256(rows.map((item) => ({
    fileId: item.fileId,
    bucket: item.bucket,
    objectKey: item.objectKey,
    contentSha256: item.contentSha256 ?? null
  })).sort((left, right) => left.fileId.localeCompare(right.fileId)));
  const bucketMismatchCount = configuredBucket
    ? exclusive.filter((item) => item.bucket !== configuredBucket).length
    : exclusive.length;
  const enumerationFailures = exclusive.filter((item) => item.versionEnumerationError).length +
    (storageAvailable ? 0 : exclusive.length);
  return {
    ...row,
    exclusiveFileCount: String(exclusive.length),
    sharedFileCount: String(shared.length),
    versionCount: String(exclusive.reduce(
      (sum, item) => sum + (item.storageSnapshot?.versionCount ?? 0),
      0
    )),
    deleteMarkerCount: String(exclusive.reduce(
      (sum, item) => sum + (item.storageSnapshot?.deleteMarkerCount ?? 0),
      0
    )),
    unknownBindingCount: String(exclusive.filter((item) => item.blockedReason).length),
    missingFileHashCount: String(rows.filter((item) => !item.contentSha256).length),
    versionEnumerationFailureCount: String(enumerationFailures),
    bucketMismatchCount: String(bucketMismatchCount),
    objectListHash
  };
}

function resolveCodeSha() {
  const value = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
  return readSha(value, "codeSha", 40);
}

function createConfiguredStorage() {
  const required = ["COS_BUCKET", "COS_REGION", "COS_SECRET_ID", "COS_SECRET_KEY"];
  if (required.some((key) => !process.env[key]?.trim())) return null;
  // The adapter performs only exact-key version enumeration for this script.
  const { CosVersionedObjectStorage } = require("../dist/file/versioned-object-storage");
  return new CosVersionedObjectStorage();
}

function defaultManifestBuilder(tx, target, storage) {
  const { buildContractFileBindingManifest } = require("../dist/file/file-binding-manifest");
  return buildContractFileBindingManifest(tx, target, storage);
}

async function inspectWithClient(prisma, {
  now = new Date(),
  codeSha = resolveCodeSha(),
  storage = createConfiguredStorage(),
  manifestBuilder = defaultManifestBuilder
} = {}) {
  invariant(process.env.DATABASE_URL, "DATABASE_URL is required");
  const raw = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL default_transaction_read_only = on");
    const [migrationHead, migrationBaseline, policy, candidateCount] = await Promise.all([
      tx.$queryRawUnsafe(checks.migrationHead),
      tx.$queryRawUnsafe(checks.migrationBaseline),
      tx.$queryRaw(checks.policy()),
      tx.$queryRawUnsafe(checks.candidateCount)
    ]);
    const policyActivatedAt = policy[0]?.activatedAt ?? null;
    const totalRows = candidateCount[0]?.count ?? "0";
    const total = count(totalRows, "candidateCount");
    const configuredBucket = process.env.COS_BUCKET?.trim() || null;
    const enriched = [];
    let afterContractVersionId = "";
    while (enriched.length < total) {
      const candidates = await tx.$queryRaw(checks.candidates(afterContractVersionId));
      invariant(Array.isArray(candidates), "candidate keyset page is invalid");
      invariant(candidates.length > 0, "candidate keyset enumeration stopped before count");
      invariant(candidates.length <= PAGE_SIZE, "candidate keyset page exceeds page size");
      let previousContractVersionId = afterContractVersionId;
      for (const row of candidates) {
        invariant(
          typeof row.contractVersionId === "string" &&
            row.contractVersionId > previousContractVersionId,
          "candidate keyset order is invalid"
        );
        previousContractVersionId = row.contractVersionId;
        if (!isLegacyDeleteAuthorized(row)) {
          enriched.push({
            ...row,
            exclusiveFileCount: "0",
            sharedFileCount: "0",
            versionCount: "0",
            deleteMarkerCount: "0",
            unknownBindingCount: "0",
            missingFileHashCount: "0",
            versionEnumerationFailureCount: "0",
            bucketMismatchCount: "0",
            objectListHash: sha256([])
          });
          continue;
        }
        const manifest = await manifestBuilder(
          tx,
          { contractVersionIds: [row.contractVersionId] },
          storage ?? undefined
        );
        enriched.push(enrichWithManifest(row, manifest, configuredBucket, storage != null));
      }
      afterContractVersionId = previousContractVersionId;
    }
    invariant(enriched.length === total, "candidate keyset count mismatch");
    return {
      migrationHead: String(migrationHead[0]?.migrationHead ?? "none"),
      migrationBaseline: migrationBaseline.map((row) => ({
        migrationName: String(row.migrationName ?? ""),
        checksum: String(row.checksum ?? "")
      })),
      policyActivatedAt,
      totalRows,
      rows: enriched
    };
  }, { isolationLevel: "RepeatableRead" });
  const migrationDigest = sha256(raw.migrationBaseline);
  const candidateStateHash = sha256(raw.rows.map((row) => ({
    contractVersionId: row.contractVersionId,
    status: row.status,
    source: row.source,
    changeType: row.changeType,
    versionNo: row.versionNo,
    firstSubmittedAt: iso(row.firstSubmittedAt, "firstSubmittedAt"),
    abandonedAt: iso(row.abandonedAt, "abandonedAt"),
    abandonReasonPresent: row.abandonReason != null,
    endedAt: iso(row.endedAt, "endedAt"),
    effectiveAt: iso(row.effectiveAt, "effectiveAt"),
    approvalInstanceCount: row.approvalInstanceCount,
    approvalActionCount: row.approvalActionCount,
    holdCount: row.holdCount,
    formalBusinessFactCount: row.formalBusinessFactCount,
    inconsistentCoordinateCount: row.inconsistentCoordinateCount,
    objectListHash: row.objectListHash
  })));
  const report = createReport({
    codeSha,
    databaseFingerprint: databaseFingerprint({
      migrationHead: raw.migrationHead,
      migrationCount: raw.migrationBaseline.length,
      migrationDigest,
      candidateStateHash
    }),
    generatedAt: now.toISOString(),
    batchId: `legacy-preflight-${crypto.randomUUID()}`,
    migrationHead: raw.migrationHead,
    policyActivatedAt: raw.policyActivatedAt,
    totalRows: raw.totalRows,
    rows: raw.rows
  });
  verifyReport(report);
  return report;
}

function parseArgs(argv) {
  const result = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      throw new Error("Issue #19 only creates a read-only preflight; --apply is disabled");
    }
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("read-only: node inspect-legacy-contract-cleanup-preflight.cjs\napply: disabled in Issue #19\n");
    return;
  }
  const prisma = new PrismaClient();
  try {
    const report = await inspectWithClient(prisma);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  PAGE_SIZE,
  checks,
  canonicalize,
  sha256,
  databaseFingerprint,
  isLegacyDeleteAuthorized,
  classifyRow,
  createReport,
  verifyReport,
  enrichWithManifest,
  defaultManifestBuilder,
  inspectWithClient,
  parseArgs
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Legacy contract cleanup preflight failed safely; no changes were made.\n");
    process.exitCode = 1;
  });
}
