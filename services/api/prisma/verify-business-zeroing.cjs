#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { userInfo } = require("node:os");
const path = require("node:path");
const {
  buildPreflightReport,
  createDryRunReceipt,
  executeBusinessZeroing,
  expectedConfirmation,
  sha256,
  validateExecutionReceipt
} = require("../scripts/business-zeroing-core.cjs");
const { verifyBackupArtifacts } = require("../scripts/inspect-test-business-zeroing.cjs");
const {
  createBusinessZeroingDatabase,
  inspectDatabaseInventory,
  verifyBusinessZeroingExecutionAudit
} = require("../scripts/business-zeroing-database.cjs");
const {
  BUSINESS_ZEROING_POLICY
} = require("../scripts/business-zeroing-policy.cjs");
const {
  createExactObjectStorage,
  inspectInventoryObjectSnapshots
} = require("../scripts/business-zeroing-storage.cjs");
const { reserveJsonOutput } = require("../scripts/business-zeroing-cli.cjs");

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const CONTRACT_ID = "00000000-0000-4000-8000-000000000003";
const VERSION_ID = "00000000-0000-4000-8000-000000000004";
const FILE_ID = "00000000-0000-4000-8000-000000000005";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000006";
const GUARDED_FACT_ID = "00000000-0000-4000-8000-000000000007";
const OBJECT_KEY = "uploads/pol22-isolated-fixture.txt";
const ENVIRONMENT = "pol22-isolated-postgresql16";

function signed(body) {
  return { ...body, receiptSha256: sha256(body) };
}

function fileSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function createAuthorization(report, batchId, privateKey, issuedAt, expiresAt) {
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      authorizationRef: "POL-22 isolated dynamic fixture authorization",
      issuer: "POL-22 隔离动态测试签发者",
      issuedAt,
      expiresAt,
      policyId: report.policyId,
      environment: report.environment,
      databaseFingerprint: report.databaseFingerprint,
      codeSha: report.codeSha,
      executionCodeSha256: report.executionCodeSha256,
      deploymentIdentitySha256: report.deploymentIdentitySha256,
      executorIdentity: report.executorIdentity,
      reportSha256: report.reportSha256,
      candidateSha256: report.candidateSha256,
      decisionManifestSha256: report.decisionManifestSha256,
      backupReceiptSha256: report.backupReceiptSha256,
      batchId,
      confirmation: expectedConfirmation(batchId)
    }),
    "utf8"
  );
  return {
    schemaVersion: 1,
    algorithm: "Ed25519",
    payload: payload.toString("base64"),
    signature: sign(null, payload, privateKey).toString("base64")
  };
}

async function insertFixture(prisma, storageRoot) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
     VALUES ($1, '归零工具隔离测试人员', false, true, NOW())`,
    ACTOR_ID
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Project" ("id", "code", "name", "isActive", "updatedAt")
     VALUES ($1, 'POL22-ISOLATED', '归零工具隔离测试项目', true, NOW())`,
    PROJECT_ID
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Contract" (
       "id", "projectId", "source", "name", "counterparty", "temporaryCode", "updatedAt"
     ) VALUES ($1, $2, 'system', '待归零测试合同', '隔离测试相对方', 'POL22-TMP-001', NOW())`,
    CONTRACT_ID,
    PROJECT_ID
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractVersion" (
       "id", "contractId", "versionNo", "changeType", "status", "amountCents",
       "draftData", "templateSnapshot", "clauseSnapshot", "updatedAt"
     ) VALUES ($1, $2, 1, 'original', 'draft', 100, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, NOW())`,
    VERSION_ID,
    CONTRACT_ID
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FileObject" (
       "id", "bucket", "objectKey", "originalName", "mimeType", "sizeBytes",
       "uploadedByUserId", "contentSha256", "storageStatus"
     ) VALUES ($1, 'private-local', $2, '隔离测试附件.txt', 'text/plain', 7, $3, $4, 'active')`,
    FILE_ID,
    OBJECT_KEY,
    ACTOR_ID,
    sha256("fixture")
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractDraftAttachment" (
       "id", "contractVersionId", "slotKey", "fileId", "displayOrder", "createdByUserId"
     ) VALUES ($1, $2, 'other', $3, 0, $4)`,
    ATTACHMENT_ID,
    VERSION_ID,
    FILE_ID,
    ACTOR_ID
  );
  const target = path.join(storageRoot, OBJECT_KEY);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "fixture", "utf8");
}

async function counts(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM "User") AS "users",
       (SELECT COUNT(*)::int FROM "Project") AS "projects",
       (SELECT COUNT(*)::int FROM "Contract") AS "contracts",
       (SELECT COUNT(*)::int FROM "ContractVersion") AS "versions",
       (SELECT COUNT(*)::int FROM "ContractDraftAttachment") AS "attachments",
       (SELECT COUNT(*)::int FROM "FileObject") AS "files",
       (SELECT COUNT(*)::int FROM "AuditLog") AS "audits",
       (SELECT COUNT(*)::int FROM "_prisma_migrations") AS "migrations"`
  );
  return rows[0];
}

async function verifyCandidateCasTriggerRollback(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 'ContractDraftAttachment' AS "table", to_jsonb(source)::text AS "rowCanonicalJson"
     FROM "ContractDraftAttachment" source WHERE "id" = $1
     UNION ALL
     SELECT 'ContractVersion' AS "table", to_jsonb(source)::text AS "rowCanonicalJson"
     FROM "ContractVersion" source WHERE "id" = $2`,
    ATTACHMENT_ID,
    VERSION_ID
  );
  const rowShaByTable = new Map(
    rows.map((row) => [row.table, createHash("sha256").update(row.rowCanonicalJson).digest("hex")])
  );
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION pol22_mutate_later_candidate() RETURNS trigger AS $$
       BEGIN
         UPDATE "ContractVersion" SET "amountCents" = 101, "updatedAt" = NOW()
         WHERE "id" = '${VERSION_ID}';
         RETURN OLD;
       END;
     $$ LANGUAGE plpgsql`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER pol22_mutate_later_candidate_after_delete
     AFTER DELETE ON "ContractDraftAttachment"
     FOR EACH ROW EXECUTE FUNCTION pol22_mutate_later_candidate()`
  );
  try {
    const database = createBusinessZeroingDatabase(prisma, BUSINESS_ZEROING_POLICY);
    await assert.rejects(
      () =>
        database.transaction(async (tx) => {
          assert.equal(
            await tx.deleteExactRecord({
              table: "ContractDraftAttachment",
              primaryKey: { id: ATTACHMENT_ID },
              rowSha256: rowShaByTable.get("ContractDraftAttachment")
            }),
            1
          );
          await tx.deleteExactRecord({
            table: "ContractVersion",
            primaryKey: { id: VERSION_ID },
            rowSha256: rowShaByTable.get("ContractVersion")
          });
        }),
      /候选完整行指纹已漂移/u
    );
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS pol22_mutate_later_candidate_after_delete
       ON "ContractDraftAttachment"`
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS pol22_mutate_later_candidate() ");
  }
  const rollbackRows = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM "ContractDraftAttachment" WHERE "id" = $1) AS "attachments",
       (SELECT "amountCents"::int FROM "ContractVersion" WHERE "id" = $2) AS "versionAmount"`,
    ATTACHMENT_ID,
    VERSION_ID
  );
  assert.deepEqual(rollbackRows[0], {
    attachments: 1,
    versionAmount: 100
  });
}

async function verifyBusinessZeroing(prisma, temporaryRoot, codeIdentity) {
  assert.match(codeIdentity?.codeSha ?? "", /^[0-9a-f]{40}$/u);
  assert.match(codeIdentity?.executionCodeSha256 ?? "", /^[0-9a-f]{64}$/u);
  const storageRoot = path.join(temporaryRoot, "private-files");
  process.env.FILE_STORAGE_ROOT = storageRoot;
  delete process.env.COS_BUCKET;
  await insertFixture(prisma, storageRoot);
  await verifyCandidateCasTriggerRollback(prisma);

  const inventory = await inspectDatabaseInventory(prisma, {
    environment: ENVIRONMENT
  });
  const policyByName = new Map(
    BUSINESS_ZEROING_POLICY.tables.map((table) => [table.name, table])
  );
  const createDecisions = (sourceInventory) =>
    signed({
      schemaVersion: 1,
      policyId: BUSINESS_ZEROING_POLICY.id,
      environment: ENVIRONMENT,
      databaseFingerprint: sourceInventory.databaseFingerprint,
      records: sourceInventory.tables.flatMap((table) => {
        const tablePolicy = policyByName.get(table.name);
        if (!["review", "business_review"].includes(tablePolicy?.disposition)) return [];
        return table.rows.map((row) => ({
          businessType: tablePolicy.chineseName,
          table: table.name,
          primaryKey: Object.fromEntries(
            table.primaryKey.map((column) => [column, String(row[column])])
          ),
          decision: tablePolicy.disposition === "review" ? "preserve" : "delete",
          reason:
            tablePolicy.disposition === "review"
              ? "隔离夹具中已存基础资料逐主键明确保留"
              : "隔离夹具中已逐主键明确判定为测试业务"
        }));
      })
    });
  const decisions = createDecisions(inventory);
  const databaseBackupPath = path.join(temporaryRoot, "database.dump.fixture");
  const fileBackupPath = path.join(temporaryRoot, "private-files.tar.fixture");
  const databaseBackupContent = Buffer.from("isolated database backup fixture", "utf8");
  const fileBackupContent = Buffer.from("isolated file backup fixture", "utf8");
  await writeFile(databaseBackupPath, databaseBackupContent);
  await writeFile(fileBackupPath, fileBackupContent);
  const capturedAt = new Date().toISOString();
  const backup = signed({
    schemaVersion: 1,
    environment: ENVIRONMENT,
    databaseFingerprint: inventory.databaseFingerprint,
    databaseBackup: {
      location: databaseBackupPath,
      sha256: fileSha256(databaseBackupContent),
      capturedAt,
      restoreVerifiedAt: capturedAt,
      restoreTarget: "pol22-isolated-restored-database",
      restoreStatus: "passed"
    },
    privateFileBackup: {
      location: fileBackupPath,
      sha256: fileSha256(fileBackupContent),
      capturedAt,
      restoreVerifiedAt: capturedAt,
      restoreTarget: "pol22-isolated-restored-files",
      restoreStatus: "passed"
    }
  });
  await verifyBackupArtifacts(backup);
  const reportGeneratedAt = new Date(new Date(capturedAt).getTime() + 1_000).toISOString();
  const authorizationIssuedAt = new Date(new Date(capturedAt).getTime() + 2_000).toISOString();
  const authorizationExpiresAt = new Date(new Date(capturedAt).getTime() + 10 * 60_000).toISOString();
  const executionNow = new Date(new Date(capturedAt).getTime() + 3_000);
  const identityBody = {
    schemaVersion: 1,
    environment: ENVIRONMENT,
    deploymentId: "pol22-local-disposable",
    executorIdentity: "pol22-isolated-runner",
    executorUid: process.getuid(),
    executorUsername: userInfo().username
  };
  const trustedExecutionIdentity = {
    ...identityBody,
    deploymentIdentitySha256: sha256(identityBody)
  };
  const buildReport = async (
    client,
    lockTables = false,
    allowMissingDeletedDecisions = false,
    decisionManifest = decisions
  ) => {
    const currentInventory = await inspectDatabaseInventory(client, {
      environment: ENVIRONMENT,
      lockTables
    });
    currentInventory.objectSnapshots = await inspectInventoryObjectSnapshots(
      currentInventory,
      backup.privateFileBackup.capturedAt
    );
    return buildPreflightReport({
      policy: BUSINESS_ZEROING_POLICY,
      inventory: currentInventory,
      decisions: decisionManifest,
      backup,
      codeSha: codeIdentity.codeSha,
      executionCodeSha256: codeIdentity.executionCodeSha256,
      deploymentIdentitySha256:
        trustedExecutionIdentity.deploymentIdentitySha256,
      executorIdentity: trustedExecutionIdentity.executorIdentity,
      generatedAt: reportGeneratedAt,
      allowMissingDeletedDecisions
    });
  };

  const beforeCounts = await counts(prisma);
  const report = await buildReport(prisma);
  assert.equal(report.status, "ready", JSON.stringify(report.blockers));
  assert.deepEqual(
    report.deletionCandidates.map((item) => item.table).sort(),
    ["Contract", "ContractDraftAttachment", "ContractVersion", "FileObject"]
  );
  assert.equal(report.summary.migrationHistoryDeletionCandidates, 0);
  assert.equal(report.summary.databaseDeletionCandidates, 0);

  const dryRun = await createDryRunReceipt({ report, currentReport: await buildReport(prisma) });
  assert.equal(dryRun.executed, false);
  assert.deepEqual(await counts(prisma), beforeCounts);

  const batchId = "pol22-isolated-001";
  const authorizationKeys = generateKeyPairSync("ed25519");
  const database = createBusinessZeroingDatabase(prisma, BUSINESS_ZEROING_POLICY);
  const reservedReceipt = reserveJsonOutput(
    path.join(temporaryRoot, "execution-receipt.json")
  );
  let receipt;
  try {
    receipt = await executeBusinessZeroing({
    args: {
      apply: true,
      environment: ENVIRONMENT,
      batchId,
      expectedDatabaseFingerprint: report.databaseFingerprint,
      expectedCodeSha: codeIdentity.codeSha,
      expectedExecutionCodeSha256: codeIdentity.executionCodeSha256,
      deploymentIdentitySha256:
        trustedExecutionIdentity.deploymentIdentitySha256,
      executorIdentity: trustedExecutionIdentity.executorIdentity,
      expectedReportSha256: report.reportSha256,
      expectedCandidateSha256: report.candidateSha256,
      authorizationEnvelope: createAuthorization(
        report,
        batchId,
        authorizationKeys.privateKey,
        authorizationIssuedAt,
        authorizationExpiresAt
      ),
      authorizationPublicKey: authorizationKeys.publicKey,
      confirmation: expectedConfirmation(batchId)
    },
    report,
    database,
    storage: createExactObjectStorage(),
    buildLockedReport: (tx) => buildReport(tx.client, true),
    buildLockedPostcheckReport: (tx) => buildReport(tx.client, true, true),
    buildPostcheckReport: () => buildReport(prisma, false, true),
    persistReceipt: async (value) => reservedReceipt.write(value),
    now: executionNow
    });
  } finally {
    reservedReceipt.close();
  }
  assert.equal(receipt.status, "completed");
  assert.deepEqual(
    validateExecutionReceipt(receipt, report, authorizationKeys.publicKey),
    {
    status: "passed",
    receiptSha256: receipt.receiptSha256
    }
  );
  assert.deepEqual(await verifyBusinessZeroingExecutionAudit(prisma, receipt), {
    status: "passed"
  });
  const afterCounts = await counts(prisma);
  assert.deepEqual(
    { users: afterCounts.users, projects: afterCounts.projects },
    { users: 1, projects: 1 }
  );
  assert.deepEqual(
    {
      contracts: afterCounts.contracts,
      versions: afterCounts.versions,
      attachments: afterCounts.attachments,
      files: afterCounts.files
    },
    { contracts: 0, versions: 0, attachments: 0, files: 0 }
  );
  assert.equal(afterCounts.migrations, beforeCounts.migrations);
  assert.equal(afterCounts.audits, beforeCounts.audits + 2);
  await assert.rejects(() => readFile(path.join(storageRoot, OBJECT_KEY)), /ENOENT/u);
  const localDisposition = receipt.objectDispositions.find(
    (item) => item.kind === "local_quarantine" && item.objectKey === OBJECT_KEY
  );
  assert.equal(localDisposition.status, "object_key_removed_recovery_artifact_retained");
  assert.equal(
    await readFile(path.join(storageRoot, localDisposition.quarantineObjectKey), "utf8"),
    "fixture"
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProjectUpstreamFundFact" (
       "id", "projectId", "factType", "occurredAt", "amountCents",
       "counterpartyName", "basisType", "affiliateAssignmentId",
       "affiliateBusinessPartyVersionId", "affiliateNameSnapshot",
       "idempotencyKey", "requestFingerprint", "recordedByUserId",
       "recordedByRoleKey", "updatedAt"
     ) VALUES (
       $1, $2, 'owner_payment_to_affiliate', NOW(), 100,
       '隔离触发器测试相对方', 'oral', 'isolated-assignment',
       'isolated-party-version', '隔离施工企业',
       'pol22-guarded-fact', $3, $4, 'super_admin', NOW()
     )`,
    GUARDED_FACT_ID,
    PROJECT_ID,
    "1".repeat(64),
    ACTOR_ID
  );
  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(
        `DELETE FROM "ProjectUpstreamFundFact" WHERE "id" = $1`,
        GUARDED_FACT_ID
      ),
    /upstream fund facts cannot be deleted/u
  );
  const guardedInventory = await inspectDatabaseInventory(prisma, {
    environment: ENVIRONMENT
  });
  const guardedReport = await buildReport(
    prisma,
    false,
    false,
    createDecisions(guardedInventory)
  );
  assert.equal(guardedReport.status, "blocked");
  assert.ok(
    guardedReport.blockers.some(
      (item) =>
        item.code === "DELETE_GUARD_TRIGGER" &&
        item.details?.table === "ProjectUpstreamFundFact"
    )
  );
  assert.deepEqual(guardedReport.deletionCandidates, []);

  return {
    mode: "isolated_postgresql16_and_local_private_files",
    status: "passed",
    environment: ENVIRONMENT,
    databaseFingerprint: report.databaseFingerprint,
    codeSha: codeIdentity.codeSha,
    executionCodeSha256: codeIdentity.executionCodeSha256,
    migrationHead: report.migrationHead,
    migrationCount: beforeCounts.migrations,
    reportSha256: report.reportSha256,
    candidateSha256: report.candidateSha256,
    dryRunSteps: dryRun.steps.length,
    receipt,
    preserved: { users: afterCounts.users, projects: afterCounts.projects },
    deleted: { contracts: 1, versions: 1, attachments: 1, files: 1 },
    guardedDeletePreflight: {
      table: "ProjectUpstreamFundFact",
      status: guardedReport.status,
      blocker: "DELETE_GUARD_TRIGGER",
      rowPreserved: true
    },
    candidateCasTriggerRollback: {
      status: "passed",
      changedLaterCandidateRejected: true,
      transactionRolledBack: true
    },
    localObjectDisposition: {
      status: localDisposition.status,
      recoveryArtifactRetained: true
    },
    productionAccessed: false
  };
}

module.exports = { verifyBusinessZeroing };
