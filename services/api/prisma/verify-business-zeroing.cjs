#!/usr/bin/env node
"use strict";

const { assertCleanNodeRuntime } = require("../scripts/business-zeroing-cli.cjs");
assertCleanNodeRuntime();
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
  inspectDeletedObjectScopes,
  sha256,
  validateWriteFreezeLeaseEnvelope,
  validateExecutionReceipt,
  verifyPostcheck
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
const BILL_ID = "00000000-0000-4000-8000-000000000008";
const MIXED_FILE_ID = "00000000-0000-4000-8000-000000000009";
const OBJECT_KEY = "uploads/pol22-isolated-fixture.txt";
const MIXED_OBJECT_KEY = "uploads/pol22-isolated-preserved-file.txt";
const ENVIRONMENT = "pol22-isolated-postgresql16";

function signed(body) {
  return { ...body, receiptSha256: sha256(body) };
}

function createAuthorization(
  report,
  batchId,
  privateKey,
  issuedAt,
  expiresAt,
  writeFreezeLeaseEnvelope
) {
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
      testProvenanceEnvelopeSha256: report.testProvenanceEnvelopeSha256,
      testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
      trustedTestProvenancePublicKeySha256:
        report.trustedTestProvenancePublicKeySha256,
      trustedWriteFreezePublicKeySha256:
        report.trustedWriteFreezePublicKeySha256,
      writeFreezeLeaseEnvelopeSha256: sha256(writeFreezeLeaseEnvelope),
      objectDeletionManifestSha256: report.objectDeletionManifestSha256,
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

function createWriteFreezeLease(
  report,
  batchId,
  privateKey,
  issuedAt,
  expiresAt
) {
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      leaseId: "pol22-isolated-freeze-001",
      issuer: "POL-22 隔离外部维护窗口控制面",
      status: "active",
      revokedAt: null,
      environment: report.environment,
      batchId,
      reportSha256: report.reportSha256,
      candidateSha256: report.candidateSha256,
      objectDeletionManifestSha256: report.objectDeletionManifestSha256,
      testProvenanceRegistrySha256: report.testProvenanceRegistrySha256,
      holderDeploymentIdentitySha256: report.deploymentIdentitySha256,
      holderExecutorIdentity: report.executorIdentity,
      fenceToken: "8".repeat(64),
      generation: 1,
      scopes: ["database_business_writes", "private_object_writes"],
      issuedAt,
      expiresAt
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

function fixtureRecordKey(table, primaryKey) {
  return `${table}:${sha256(primaryKey)}`;
}

function createTestProvenance(
  sourceInventory,
  decisions,
  trustedFixtureKeys,
  privateKey,
  issuedAt
) {
  const registryRef = "POL-22 isolated dynamic fixture registry v1";
  const records = [];
  for (const table of sourceInventory.tables) {
    for (const row of table.rows) {
      const primaryKey = Object.fromEntries(
        table.primaryKey.map((column) => [column, String(row[column])])
      );
      const key = fixtureRecordKey(table.name, primaryKey);
      if (!trustedFixtureKeys.has(key)) continue;
      assert.equal(
        decisions.records.find(
          (record) =>
            record.table === table.name &&
            fixtureRecordKey(record.table, record.primaryKey) === key
        )?.decision,
        "delete"
      );
      const record = {
        table: table.name,
        primaryKey,
        rowSha256: row.rowSha256,
        sourceKind: "isolated_fixture_registry",
        sourceRef: `dynamic-fixture:${table.name}:${sha256(primaryKey)}`
      };
      records.push({
        ...record,
        evidenceSha256: sha256({
          registryRef,
          environment: ENVIRONMENT,
          databaseFingerprint: sourceInventory.databaseFingerprint,
          sourceKind: record.sourceKind,
          sourceRef: record.sourceRef,
          table: record.table,
          primaryKey: record.primaryKey,
          rowSha256: record.rowSha256
        })
      });
    }
  }
  assert.equal(records.length, trustedFixtureKeys.size);
  const registry = {
    schemaVersion: 1,
    registryRef,
    environment: ENVIRONMENT,
    databaseFingerprint: sourceInventory.databaseFingerprint,
    records
  };
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      registryRef,
      issuer: "POL-22 隔离动态测试来源签发者",
      issuedAt,
      policyId: BUSINESS_ZEROING_POLICY.id,
      environment: ENVIRONMENT,
      databaseFingerprint: sourceInventory.databaseFingerprint,
      records
    }),
    "utf8"
  );
  return {
    registry,
    registrySha256: sha256(registry),
    envelope: {
      schemaVersion: 1,
      algorithm: "Ed25519",
      payload: payload.toString("base64"),
      signature: sign(null, payload, privateKey).toString("base64")
    }
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

async function verifyBusinessZeroing(
  prisma,
  temporaryRoot,
  codeIdentity,
  { trustedRunner = false, createVerifiedBackupRestore } = {}
) {
  assert.equal(trustedRunner, true, "POL-22 动态验证器只能由已清洗的隔离 runner 调用");
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
  const createDecisions = (sourceInventory, trustedFixtureKeys) =>
    signed({
      schemaVersion: 1,
      policyId: BUSINESS_ZEROING_POLICY.id,
      environment: ENVIRONMENT,
      databaseFingerprint: sourceInventory.databaseFingerprint,
      records: sourceInventory.tables.flatMap((table) => {
        const tablePolicy = policyByName.get(table.name);
        if (!["review", "business_review"].includes(tablePolicy?.disposition)) return [];
        return table.rows.map((row) => {
          const primaryKey = Object.fromEntries(
            table.primaryKey.map((column) => [column, String(row[column])])
          );
          const isTrustedFixture = trustedFixtureKeys.has(
            fixtureRecordKey(table.name, primaryKey)
          );
          return {
            businessType: tablePolicy.chineseName,
            table: table.name,
            primaryKey,
            decision:
              tablePolicy.disposition === "business_review" && isTrustedFixture
                ? "delete"
                : "preserve",
            reason:
              tablePolicy.disposition === "business_review" && isTrustedFixture
                ? "独立隔离夹具注册表已逐主键证明是测试业务"
                : "未列入独立隔离夹具注册表，逐主键明确保留"
          };
        });
      })
    });
  const trustedFixtureKeys = new Set([
    fixtureRecordKey("Contract", { id: CONTRACT_ID }),
    fixtureRecordKey("ContractVersion", { id: VERSION_ID }),
    fixtureRecordKey("ContractDraftAttachment", { id: ATTACHMENT_ID })
  ]);
  const decisions = createDecisions(inventory, trustedFixtureKeys);
  assert.equal(
    typeof createVerifiedBackupRestore,
    "function",
    "POL-22 动态验证缺少受信 runner 真实备份恢复端"
  );
  const sourceCounts = await counts(prisma);
  const backupEvidence = await createVerifiedBackupRestore({
    storageRoot,
    sourceCounts,
    migrationCount: inventory.migrationCount,
    migrationHead: inventory.migrationHead
  });
  const capturedAt = backupEvidence.capturedAt;
  const backup = signed({
    schemaVersion: 1,
    environment: ENVIRONMENT,
    databaseFingerprint: inventory.databaseFingerprint,
    databaseBackup: backupEvidence.databaseBackup,
    privateFileBackup: backupEvidence.privateFileBackup
  });
  await verifyBackupArtifacts(backup);
  const restoreVerifiedAt = Math.max(
    new Date(backup.databaseBackup.restoreVerifiedAt).getTime(),
    new Date(backup.privateFileBackup.restoreVerifiedAt).getTime()
  );
  assert.ok(Number.isFinite(restoreVerifiedAt), "隔离恢复时间无效");
  const reportGeneratedAt = new Date(restoreVerifiedAt + 1_000).toISOString();
  const authorizationIssuedAt = new Date(restoreVerifiedAt + 2_000).toISOString();
  const authorizationExpiresAt = new Date(restoreVerifiedAt + 10 * 60_000).toISOString();
  const executionNow = new Date(restoreVerifiedAt + 3_000);
  const testProvenanceKeys = generateKeyPairSync("ed25519");
  const writeFreezeKeys = generateKeyPairSync("ed25519");
  const trustedTestProvenancePublicKeySha256 = createHash("sha256")
    .update(testProvenanceKeys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const trustedWriteFreezePublicKeySha256 = createHash("sha256")
    .update(writeFreezeKeys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const testProvenance = createTestProvenance(
    inventory,
    decisions,
    trustedFixtureKeys,
    testProvenanceKeys.privateKey,
    capturedAt
  );
  const identityBody = {
    schemaVersion: 1,
    environment: ENVIRONMENT,
    deploymentId: "pol22-local-disposable",
    executorIdentity: "pol22-isolated-runner",
    executorUid: process.getuid(),
    executorUsername: userInfo().username,
    testProvenancePublicKeySha256:
      trustedTestProvenancePublicKeySha256,
    testProvenanceRegistrySha256: testProvenance.registrySha256,
    writeFreezePublicKeySha256:
      trustedWriteFreezePublicKeySha256
  };
  const trustedExecutionIdentity = {
    ...identityBody,
    deploymentIdentitySha256: sha256(identityBody)
  };
  const buildReport = async (
    client,
    lockTables = false,
    allowMissingDeletedDecisions = false,
    decisionManifest = decisions,
    provenanceBundle = testProvenance,
    trustedRegistrySha256 = testProvenance.registrySha256
  ) => {
    assert.equal(
      trustedRegistrySha256,
      provenanceBundle?.registrySha256 ?? testProvenance.registrySha256,
      "隔离动态场景变更 provenance registry 时必须同步固定信任摘要"
    );
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
      testProvenance: provenanceBundle?.envelope ?? provenanceBundle,
      testProvenancePublicKey: testProvenanceKeys.publicKey,
      testProvenanceRegistry:
        provenanceBundle?.registry ?? testProvenance.registry,
      testProvenanceRegistrySha256:
        provenanceBundle?.registrySha256 ?? testProvenance.registrySha256,
      trustedTestProvenancePublicKeySha256,
      trustedTestProvenanceRegistrySha256: trustedRegistrySha256,
      trustedWriteFreezePublicKeySha256,
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

  await prisma.$executeRawUnsafe(
    `UPDATE "ContractVersion" SET "status" = 'effective' WHERE "id" = $1`,
    VERSION_ID
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractBill" (
       "id", "contractVersionId", "billKey", "name", "amountRole", "pricingMode",
       "quantityScale", "unitPriceScale", "schemaSnapshot", "updatedAt"
     ) VALUES ($1, $2, 'effective-parent-bill', '正式父聚合测试清单', 'contract_amount',
       'fixed', 2, 2, '{}'::jsonb, NOW())`,
    BILL_ID,
    VERSION_ID
  );
  let formalRecordProtection;
  try {
    const effectiveInventory = await inspectDatabaseInventory(prisma, {
      environment: ENVIRONMENT
    });
    const effectiveFixtureKeys = new Set([
      ...trustedFixtureKeys,
      fixtureRecordKey("ContractBill", { id: BILL_ID })
    ]);
    const effectiveDecisions = createDecisions(
      effectiveInventory,
      effectiveFixtureKeys
    );
    const effectiveProvenance = createTestProvenance(
      effectiveInventory,
      effectiveDecisions,
      effectiveFixtureKeys,
      testProvenanceKeys.privateKey,
      capturedAt
    );
    const effectiveReport = await buildReport(
      prisma,
      false,
      false,
      effectiveDecisions,
      effectiveProvenance,
      effectiveProvenance.registrySha256
    );
    assert.equal(effectiveReport.status, "blocked");
    assert.deepEqual(effectiveReport.deletionCandidates, []);
    assert.ok(
      effectiveReport.blockers.some(
        (item) =>
          item.code === "FORMAL_RECORD_PROTECTED" &&
          item.details?.table === "ContractVersion"
      )
    );
    assert.ok(
      effectiveReport.blockers.some(
        (item) =>
          item.code === "FORMAL_AGGREGATE_CHILD_PROTECTED" &&
          item.details?.childTable === "ContractBill"
      )
    );
    formalRecordProtection = {
      status: effectiveReport.status,
      blockers: effectiveReport.blockers
        .map((item) => item.code)
        .filter((code) =>
          ["FORMAL_RECORD_PROTECTED", "FORMAL_AGGREGATE_CHILD_PROTECTED"].includes(code)
        )
        .sort(),
      candidateCount: effectiveReport.deletionCandidates.length
    };
  } finally {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ContractBill" WHERE "id" = $1`,
      BILL_ID
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "ContractVersion" SET "status" = 'draft' WHERE "id" = $1`,
      VERSION_ID
    );
  }

  const beforeCounts = await counts(prisma);
  const unprovenReport = await buildReport(prisma, false, false, decisions, {
    envelope: null,
    registry: testProvenance.registry,
    registrySha256: testProvenance.registrySha256
  });
  assert.equal(unprovenReport.status, "blocked");
  assert.deepEqual(unprovenReport.deletionCandidates, []);
  assert.ok(
    unprovenReport.blockers.some(
      (item) => item.code === "TEST_PROVENANCE_NOT_VERIFIED"
    )
  );
  const report = await buildReport(prisma);
  assert.equal(report.status, "ready", JSON.stringify(report.blockers));
  assert.deepEqual(
    report.deletionCandidates.map((item) => item.table).sort(),
    ["Contract", "ContractDraftAttachment", "ContractVersion", "FileObject"]
  );
  assert.equal(report.summary.migrationHistoryDeletionCandidates, 0);
  assert.equal(report.summary.databaseDeletionCandidates, 0);

  const { receiptSha256: _decisionReceiptSha256, ...decisionBody } = decisions;
  const unknownDecisions = signed({
    ...decisionBody,
    records: decisions.records.filter(
      (record) => !(record.table === "ContractDraftAttachment" && record.primaryKey.id === ATTACHMENT_ID)
    )
  });
  const unknownFixtureKeys = new Set([
    fixtureRecordKey("Contract", { id: CONTRACT_ID }),
    fixtureRecordKey("ContractVersion", { id: VERSION_ID })
  ]);
  const unknownProvenance = createTestProvenance(
    inventory,
    unknownDecisions,
    unknownFixtureKeys,
    testProvenanceKeys.privateKey,
    capturedAt
  );
  assert.ok(
    inventory.fileBindings.some(
      (binding) =>
        binding.fileId === FILE_ID &&
        binding.ownerTable === "ContractDraftAttachment" &&
        binding.ownerPrimaryKey.id === ATTACHMENT_ID
    ),
    "未知归属动态场景必须来自 PostgreSQL 原始 inventory 绑定"
  );
  const unknownOwnershipReport = await buildReport(
    prisma,
    false,
    false,
    unknownDecisions,
    unknownProvenance,
    unknownProvenance.registrySha256
  );
  assert.equal(unknownOwnershipReport.status, "blocked");
  assert.deepEqual(unknownOwnershipReport.deletionCandidates, []);
  assert.ok(
    unknownOwnershipReport.blockers.some((item) => item.code === "UNKNOWN_FILE_OWNER")
  );
  const unknownOwnershipBlockers = {
    status: unknownOwnershipReport.status,
    blockers: unknownOwnershipReport.blockers
      .map((item) => item.code)
      .filter((code) => code === "UNKNOWN_FILE_OWNER")
      .sort(),
    candidateCount: unknownOwnershipReport.deletionCandidates.length,
    inventoryEvidence: inventory.fileBindings.filter(
      (binding) =>
        binding.fileId === FILE_ID &&
        binding.ownerTable === "ContractDraftAttachment" &&
        binding.ownerPrimaryKey.id === ATTACHMENT_ID
    )
  };

  await prisma.$executeRawUnsafe(
    `INSERT INTO "FileObject" (
       "id", "bucket", "objectKey", "originalName", "mimeType", "sizeBytes",
       "uploadedByUserId", "contentSha256", "storageStatus", "supersedesFileObjectId"
     ) VALUES ($1, 'private-local', $2, '隔离保留文件.txt', 'text/plain', 9, $3, $4, 'active', $5)`,
    MIXED_FILE_ID,
    MIXED_OBJECT_KEY,
    ACTOR_ID,
    sha256("preserved"),
    FILE_ID
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "signatureFileId" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
    MIXED_FILE_ID,
    ACTOR_ID
  );
  await mkdir(path.dirname(path.join(storageRoot, MIXED_OBJECT_KEY)), { recursive: true });
  await writeFile(path.join(storageRoot, MIXED_OBJECT_KEY), "preserved", "utf8");
  let mixedOwnershipReport;
  let mixedInventory;
  try {
    mixedInventory = await inspectDatabaseInventory(prisma, { environment: ENVIRONMENT });
    assert.ok(
      mixedInventory.fileBindings.some(
        (binding) => binding.fileId === MIXED_FILE_ID && binding.ownerTable === "User"
      ) &&
        mixedInventory.fileRelations.some(
          (relation) =>
            relation.fileId === MIXED_FILE_ID && relation.relatedFileId === FILE_ID
        ),
      "混合归属动态场景必须来自 PostgreSQL 原始 inventory 绑定与替换链"
    );
    const mixedDecisions = createDecisions(mixedInventory, trustedFixtureKeys);
    const mixedProvenance = createTestProvenance(
      mixedInventory,
      mixedDecisions,
      trustedFixtureKeys,
      testProvenanceKeys.privateKey,
      capturedAt
    );
    mixedOwnershipReport = await buildReport(
      prisma,
      false,
      false,
      mixedDecisions,
      mixedProvenance,
      mixedProvenance.registrySha256
    );
  } finally {
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "signatureFileId" = NULL, "updatedAt" = NOW() WHERE "id" = $1`,
      ACTOR_ID
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "FileObject" WHERE "id" = $1`, MIXED_FILE_ID);
    await rm(path.join(storageRoot, MIXED_OBJECT_KEY), { force: true });
  }
  assert.equal(mixedOwnershipReport.status, "blocked");
  assert.deepEqual(mixedOwnershipReport.deletionCandidates, []);
  assert.ok(
    mixedOwnershipReport.blockers.some((item) => item.code === "MIXED_FILE_OWNERSHIP")
  );
  const mixedOwnershipBlockers = {
    status: mixedOwnershipReport.status,
    blockers: mixedOwnershipReport.blockers
      .map((item) => item.code)
      .filter((code) => code === "MIXED_FILE_OWNERSHIP")
      .sort(),
    candidateCount: mixedOwnershipReport.deletionCandidates.length,
    inventoryEvidence: {
      fileBindings: mixedInventory.fileBindings.filter(
        (binding) => binding.fileId === MIXED_FILE_ID
      ),
      fileRelations: mixedInventory.fileRelations.filter(
        (relation) =>
          relation.fileId === MIXED_FILE_ID && relation.relatedFileId === FILE_ID
      )
    }
  };

  const dryRun = await createDryRunReceipt({ report, currentReport: await buildReport(prisma) });
  assert.equal(dryRun.executed, false);
  assert.deepEqual(await counts(prisma), beforeCounts);

  const batchId = "pol22-isolated-001";
  const authorizationKeys = generateKeyPairSync("ed25519");
  const writeFreezeLeaseEnvelope = createWriteFreezeLease(
    report,
    batchId,
    writeFreezeKeys.privateKey,
    authorizationIssuedAt,
    authorizationExpiresAt
  );
  const database = createBusinessZeroingDatabase(prisma, BUSINESS_ZEROING_POLICY);
  const exactObjectStorage = createExactObjectStorage();
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
        authorizationExpiresAt,
        writeFreezeLeaseEnvelope
      ),
      authorizationPublicKey: authorizationKeys.publicKey,
      writeFreezeLeaseEnvelope,
      trustedWriteFreezePublicKeySha256,
      confirmation: expectedConfirmation(batchId)
    },
    report,
    database,
    storage: exactObjectStorage,
    buildLockedReport: (tx) => buildReport(tx.client, true),
    buildLockedPostcheckReport: (tx) => buildReport(tx.client, true, true),
    buildPostcheckReport: () => buildReport(prisma, false, true),
    persistReceipt: async (value) => reservedReceipt.write(value),
    verifyWriteFreezeLease: async ({ args, report: currentReport, now }) =>
      validateWriteFreezeLeaseEnvelope(
        writeFreezeLeaseEnvelope,
        currentReport,
        args,
        writeFreezeKeys.publicKey,
        trustedWriteFreezePublicKeySha256,
        now
      ),
    now: executionNow
    });
  } finally {
    reservedReceipt.close();
  }
  assert.equal(receipt.status, "completed");
  assert.deepEqual(
    validateExecutionReceipt(
      receipt,
      report,
      authorizationKeys.publicKey,
      writeFreezeKeys.publicKey
    ),
    {
    status: "passed",
    receiptSha256: receipt.receiptSha256
    }
  );
  assert.deepEqual(await verifyBusinessZeroingExecutionAudit(prisma, receipt), {
    status: "passed"
  });
  const independentAfterReport = await buildReport(prisma, false, true);
  const independentObjectRescan = await inspectDeletedObjectScopes(
    report,
    exactObjectStorage
  );
  assert.deepEqual(
    verifyPostcheck(
      report,
      independentAfterReport,
      receipt,
      authorizationKeys.publicKey,
      {
        phase: "final",
        objectRescan: independentObjectRescan,
        writeFreezePublicKey: writeFreezeKeys.publicKey
      }
    ),
    { status: "passed", objectScopeCount: 1 }
  );
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
  const executionAuditRows = await prisma.$queryRawUnsafe(
    `SELECT "metadata"->>'status' AS "status"
       FROM "AuditLog"
      WHERE "action" = 'test_business_zeroing.controlled_execution'
        AND "businessType" = 'test_business_zeroing'
        AND "businessId" = $1
      ORDER BY "createdAt", "id"`,
    batchId
  );
  assert.deepEqual(
    executionAuditRows.map((row) => row.status),
    [
      "started",
      "object_recovery_planned",
      "object_deletion_progress",
      "completion_pending",
      "completed"
    ]
  );
  const terminalAuditRows = await prisma.$queryRawUnsafe(
    `SELECT "metadata"->>'status' AS "status"
       FROM "AuditLog"
      WHERE "action" = 'test_business_zeroing.terminal_commit'
        AND "businessType" = 'test_business_zeroing'
        AND "businessId" = $1`,
    batchId
  );
  assert.deepEqual(
    terminalAuditRows.map((row) => row.status),
    ["terminal_committed"]
  );
  assert.equal(
    afterCounts.audits,
    beforeCounts.audits + executionAuditRows.length + terminalAuditRows.length
  );
  await assert.rejects(() => readFile(path.join(storageRoot, OBJECT_KEY)), /ENOENT/u);
  const localDisposition = receipt.objectDispositions.find(
    (item) => item.kind === "local_quarantine" && item.objectKey === OBJECT_KEY
  );
  assert.equal(localDisposition.status, "object_key_removed_recovery_artifact_retained");
  assert.equal(
    await readFile(path.join(storageRoot, localDisposition.quarantineObjectKey), "utf8"),
    "fixture"
  );
  await writeFile(path.join(storageRoot, OBJECT_KEY), "resurrected", "utf8");
  await assert.rejects(
    () => inspectDeletedObjectScopes(report, exactObjectStorage),
    /对象最终重扫发现本地精确对象键已重建/u
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
  const guardedTrustedFixtureKeys = new Set([
    fixtureRecordKey("ProjectUpstreamFundFact", { id: GUARDED_FACT_ID })
  ]);
  const guardedDecisions = createDecisions(
    guardedInventory,
    guardedTrustedFixtureKeys
  );
  const guardedProvenance = createTestProvenance(
    guardedInventory,
    guardedDecisions,
    guardedTrustedFixtureKeys,
    testProvenanceKeys.privateKey,
    capturedAt
  );
  const guardedReport = await buildReport(
    prisma,
    false,
    false,
    guardedDecisions,
    guardedProvenance,
    guardedProvenance.registrySha256
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
    executionSteps: {
      databaseRecordDeletes: receipt.deletedRecordCount,
      exactObjectDeletes: receipt.deletedObjectCount,
      numberRuleResets: receipt.resetNumberRuleCount,
      total:
        receipt.deletedRecordCount +
        receipt.deletedObjectCount +
        receipt.resetNumberRuleCount
    },
    unprovenDeletePreflight: {
      status: unprovenReport.status,
      blocker: "TEST_PROVENANCE_NOT_VERIFIED",
      candidateCount: 0
    },
    formalRecordProtection,
    unknownOwnershipBlockers,
    mixedOwnershipBlockers,
    backupRestore: {
      database: {
        status: backup.databaseBackup.restoreStatus,
        format: backup.databaseBackup.format,
        restoreEvidence: backup.databaseBackup.restoreEvidence
      },
      privateFiles: {
        status: backup.privateFileBackup.restoreStatus,
        sourceObjects: backup.privateFileBackup.sourceObjects,
        restoreEvidence: backup.privateFileBackup.restoreEvidence
      },
      artifactsVerified: true
    },
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
      recoveryArtifactRetained: true,
      independentRescanPassed: true,
      sameKeyResurrectionRejected: true
    },
    productionAccessed: false
  };
}

module.exports = { verifyBusinessZeroing };
