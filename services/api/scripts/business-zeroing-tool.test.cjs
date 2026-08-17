#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildPreflightReport: buildPreflightReportRaw,
  WRITE_FREEZE_LEASE_PAYLOAD_FIELDS,
  createDryRunReceipt,
  executeBusinessZeroing,
  expectedConfirmation,
  parsePrismaNullableLifecycleFields,
  parsePrismaNullableLifecycleRegistry,
  selectFormalObservationFields,
  sha256,
  validateAuthorizationEnvelope,
  validateApplyArguments,
  validateBackupReceipt,
  validateDecisionManifest,
  validateExecutionReceipt,
  validateWriteFreezeLeaseEnvelope,
  verifyPostcheck
} = require("./business-zeroing-core.cjs");
const {
  assertCleanNodeRuntime,
  assertCleanRepositoryStatus,
  hashRuntimeExecutionFiles,
  hashExecutionFiles,
  locateRuntimePackage,
  reserveJsonOutput,
  resolveRuntimeDependencyClosure,
  resolveRuntimeExecutionFiles,
  validateTrustedExecutionIdentity
} = require("./business-zeroing-cli.cjs");
const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");
const { verifyBackupArtifacts } = require("./inspect-test-business-zeroing.cjs");
const {
  createPinnedDockerEnvironment,
  waitForPostgres,
  writeFinalDynamicReceipt
} = require("../prisma/run-business-zeroing-local.cjs");
const {
  setFixtureSignatureBinding
} = require("../prisma/verify-business-zeroing.cjs");
const {
  BUSINESS_ZEROING_LOGICAL_RELATIONS,
  BUSINESS_ZEROING_POLICY
} = require("./business-zeroing-policy.cjs");
const {
  assertCandidateRowFingerprint,
  buildExactDeleteStatement,
  buildExactRowSnapshotStatement,
  buildExactSequenceResetStatement,
  classifyBusinessAggregateForeignKey,
  computeDeletionOrder,
  computeSchemaDigest,
  createBusinessZeroingDatabase,
  verifyBusinessZeroingExecutionAudit
} = require("./business-zeroing-database.cjs");

const SHA_40 = "a".repeat(40);
const SHA_64 = "b".repeat(64);
const EXECUTION_SHA_64 = "f".repeat(64);
const DEPLOYMENT_SHA_64 = "9".repeat(64);
const EXECUTOR_IDENTITY = "pol22-isolated-runner";
const FILE_SNAPSHOT_BODY = {
  kind: "local_file",
  contentSha256: "7".repeat(64),
  sizeBytes: 7,
  lastModified: "2026-08-13T00:00:00.000Z",
  deviceId: 1,
  inodeId: 2
};
const FILE_SNAPSHOT = {
  ...FILE_SNAPSHOT_BODY,
  snapshotSha256: sha256(FILE_SNAPSHOT_BODY)
};
const AUTHORIZATION_KEYS = generateKeyPairSync("ed25519");
const TEST_PROVENANCE_KEYS = generateKeyPairSync("ed25519");
const WRITE_FREEZE_KEYS = generateKeyPairSync("ed25519");
const TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256 = createHash("sha256")
  .update(WRITE_FREEZE_KEYS.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256 = createHash("sha256")
  .update(TEST_PROVENANCE_KEYS.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");

function fixtureEvidence(registryRef, currentInventory, record) {
  return sha256({
    registryRef,
    environment: currentInventory.environment,
    databaseFingerprint: currentInventory.databaseFingerprint,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    table: record.table,
    primaryKey: record.primaryKey,
    rowSha256: record.rowSha256
  });
}

function createTestProvenanceRegistry(currentInventory, decisions) {
  const registryRef = "POL-22 unit fixture registry v1";
  const fallbackInventory = inventory();
  const findRow = (tableName, primaryKey) => {
    for (const source of [currentInventory, fallbackInventory]) {
      const table = source.tables.find((item) => item.name === tableName);
      const row = table?.rows.find((item) =>
        table.primaryKey.every(
          (column) => String(item[column]) === String(primaryKey[column])
        )
      );
      if (row) return row;
    }
    return undefined;
  };
  const records = (decisions?.records ?? [])
    .filter((record) => record.decision === "delete")
    .map((record) => {
      const row = findRow(record.table, record.primaryKey);
      assert.ok(row, `test provenance fixture missing ${record.table}`);
      const body = {
        sourceKind: "isolated_fixture_registry",
        sourceRef: `unit-fixture:${record.table}:${sha256(record.primaryKey)}`,
        table: record.table,
        primaryKey: record.primaryKey,
        rowSha256: row.rowSha256
      };
      return {
        ...body,
        evidenceSha256: fixtureEvidence(registryRef, currentInventory, body)
      };
    });
  return {
    schemaVersion: 1,
    registryRef,
    environment: currentInventory.environment,
    databaseFingerprint: currentInventory.databaseFingerprint,
    records
  };
}

function createTestProvenance(currentInventory, decisions, options = {}) {
  const registry = createTestProvenanceRegistry(currentInventory, decisions);
  const payload = {
    schemaVersion: 1,
    registryRef: registry.registryRef,
    issuer: "POL-22 隔离测试来源签发者",
    issuedAt: "2026-08-13T00:59:00.000Z",
    policyId: "pol-22-business-zeroing-v1",
    environment: currentInventory.environment,
    databaseFingerprint: currentInventory.databaseFingerprint,
    records: registry.records,
    ...options.payload
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    schemaVersion: 1,
    algorithm: "Ed25519",
    payload: payloadBytes.toString("base64"),
    signature: sign(
      null,
      payloadBytes,
      options.privateKey ?? TEST_PROVENANCE_KEYS.privateKey
    ).toString("base64")
  };
}

function testProvenanceRegistryArgs(currentInventory, decisions) {
  const testProvenanceRegistry = createTestProvenanceRegistry(
    currentInventory,
    decisions
  );
  const registrySha256 = sha256(testProvenanceRegistry);
  return {
    testProvenanceRegistry,
    testProvenanceRegistrySha256: registrySha256,
    trustedTestProvenanceRegistrySha256: registrySha256
  };
}

const buildPreflightReport = (options) => {
  const registryArgs = testProvenanceRegistryArgs(
    options.inventory,
    options.decisions
  );
  const testProvenance =
    options.testProvenance === undefined
      ? createTestProvenance(options.inventory, options.decisions)
      : options.testProvenance;
  return buildPreflightReportRaw({
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    testProvenance,
    testProvenancePublicKey:
      options.testProvenancePublicKey === undefined
        ? TEST_PROVENANCE_KEYS.publicKey
        : options.testProvenancePublicKey,
    trustedTestProvenancePublicKeySha256:
      options.trustedTestProvenancePublicKeySha256 === undefined
        ? TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256
        : options.trustedTestProvenancePublicKeySha256,
    ...registryArgs,
    trustedWriteFreezePublicKeySha256:
      options.trustedWriteFreezePublicKeySha256 === undefined
        ? TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256
        : options.trustedWriteFreezePublicKeySha256,
    ...options
  });
};

function signedBody(body) {
  return { ...body, receiptSha256: sha256(body) };
}

function resignReport(report) {
  const withoutReportSha = Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== "reportSha256")
  );
  const body = {
    ...withoutReportSha,
    stateFingerprint: sha256({
      migrationHead: withoutReportSha.migrationHead,
      migrationCount: withoutReportSha.migrationCount,
      schemaDigest: withoutReportSha.schemaDigest,
      executionCodeSha256: withoutReportSha.executionCodeSha256,
      deploymentIdentitySha256: withoutReportSha.deploymentIdentitySha256,
      executorIdentity: withoutReportSha.executorIdentity,
      testProvenanceEnvelopeSha256: withoutReportSha.testProvenanceEnvelopeSha256,
      testProvenanceVerification: withoutReportSha.testProvenanceVerification,
      testProvenanceRegistrySha256:
        withoutReportSha.testProvenanceRegistrySha256,
      trustedTestProvenancePublicKeySha256:
        withoutReportSha.trustedTestProvenancePublicKeySha256,
      trustedWriteFreezePublicKeySha256:
        withoutReportSha.trustedWriteFreezePublicKeySha256,
      objectDeletionManifest: withoutReportSha.objectDeletionManifest,
      objectDeletionManifestSha256: withoutReportSha.objectDeletionManifestSha256,
      preservationWhitelist: withoutReportSha.preservationWhitelist,
      preservationAnchors: withoutReportSha.preservationAnchors,
      preservationCounts: withoutReportSha.preservationCounts,
      preservationCountsByBusinessType: withoutReportSha.preservationCountsByBusinessType,
      deletionCandidates: withoutReportSha.deletionCandidates,
      deletionCountsByBusinessType: withoutReportSha.deletionCountsByBusinessType,
      numberResets: withoutReportSha.numberResets,
      expectedReleasedNumbers: withoutReportSha.expectedReleasedNumbers,
      deletionOrder: withoutReportSha.deletionOrder,
      fileBindings: withoutReportSha.fileBindings,
      blockers: withoutReportSha.blockers
    })
  };
  return { ...body, reportSha256: sha256(body) };
}

function authorizationEnvelope(report, batchId = "pol22-isolated-001", overrides = {}) {
  const payload = {
    schemaVersion: 1,
    authorizationRef: "Issue #122 independent authorization",
    issuer: "POL-24 独立授权人",
    issuedAt: "2026-08-13T01:01:00.000Z",
    expiresAt: "2026-08-13T01:15:00.000Z",
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
    objectDeletionManifestSha256: report.objectDeletionManifestSha256,
    writeFreezeLeaseEnvelopeSha256:
      overrides.writeFreezeLeaseEnvelopeSha256 ?? "0".repeat(64),
    trustedWriteFreezePublicKeySha256:
      TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
    backupReceiptSha256: report.backupReceiptSha256,
    batchId,
    confirmation: expectedConfirmation(batchId),
    ...overrides
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    schemaVersion: 1,
    algorithm: "Ed25519",
    payload: payloadBytes.toString("base64"),
    signature: sign(null, payloadBytes, AUTHORIZATION_KEYS.privateKey).toString("base64")
  };
}

function controlledArgs(report, batchId = "pol22-isolated-001") {
  const writeFreezeLeaseEnvelope = writeFreezeLeaseEnvelopeFor(report, batchId);
  return {
    apply: true,
    environment: report.environment,
    batchId,
    expectedDatabaseFingerprint: report.databaseFingerprint,
    expectedCodeSha: report.codeSha,
    expectedExecutionCodeSha256: report.executionCodeSha256,
    deploymentIdentitySha256: report.deploymentIdentitySha256,
    executorIdentity: report.executorIdentity,
    expectedReportSha256: report.reportSha256,
    expectedCandidateSha256: report.candidateSha256,
    confirmation: expectedConfirmation(batchId),
    writeFreezeLeaseEnvelope,
    trustedWriteFreezePublicKeySha256:
      TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
    authorizationEnvelope: authorizationEnvelope(report, batchId, {
      writeFreezeLeaseEnvelopeSha256: sha256(writeFreezeLeaseEnvelope)
    }),
    authorizationPublicKey: AUTHORIZATION_KEYS.publicKey
  };
}

function writeFreezeLeaseEnvelopeFor(report, batchId = "pol22-isolated-001", overrides = {}) {
  const payload = {
    schemaVersion: 1,
    leaseId: "pol22-isolated-freeze-001",
    issuer: "POL-24 外部维护窗口控制面",
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
    issuedAt: "2026-08-13T01:02:00.000Z",
    expiresAt: "2026-08-13T01:14:00.000Z",
    ...overrides
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    schemaVersion: 1,
    algorithm: "Ed25519",
    payload: payloadBytes.toString("base64"),
    signature: sign(null, payloadBytes, WRITE_FREEZE_KEYS.privateKey).toString("base64")
  };
}

function createWriteFreezeVerifier() {
  return async ({ args, report, now }) =>
    validateWriteFreezeLeaseEnvelope(
      args.writeFreezeLeaseEnvelope,
      report,
      args,
      WRITE_FREEZE_KEYS.publicKey,
      args.trustedWriteFreezePublicKeySha256,
      now
    );
}

function backupReceipt(overrides = {}) {
  return signedBody({
    schemaVersion: 1,
    environment: "isolated-pol22",
    databaseFingerprint: SHA_64,
    databaseBackup: {
      location: "/isolated/backups/database.dump",
      sha256: "c".repeat(64),
      capturedAt: "2026-08-13T00:00:00.000Z",
      restoreVerifiedAt: "2026-08-13T00:00:00.000Z",
      restoreTarget: "isolated-restore",
      restoreStatus: "passed"
    },
    privateFileBackup: {
      location: "/isolated/backups/private-files.tar",
      sha256: "d".repeat(64),
      capturedAt: "2026-08-13T00:00:00.000Z",
      restoreVerifiedAt: "2026-08-13T00:05:00.000Z",
      restoreTarget: "isolated-file-restore",
      restoreStatus: "passed"
    },
    ...overrides
  });
}

function decisionManifest(records = []) {
  const explicitRecords = [...records];
  if (!explicitRecords.some((record) => record.table === "Contract")) {
    explicitRecords.push({
      businessType: "合同业务",
      table: "Contract",
      primaryKey: { id: "c1" },
      decision: "delete",
      reason: "隔离夹具中已逐主键确认是测试合同"
    });
  }
  return signedBody({
    schemaVersion: 1,
    policyId: "pol-22-business-zeroing-v1",
    environment: "isolated-pol22",
    databaseFingerprint: SHA_64,
    records: explicitRecords
  });
}

function fingerprintedRow(tableName, row) {
  const source = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !["rowSha256", "preservationSha256"].includes(key)
    )
  );
  const preservationSource = { ...source };
  if (tableName === "ContractNumberRule") {
    delete preservationSource.nextSequence;
    delete preservationSource.updatedAt;
  }
  return {
    ...source,
    rowSha256: sha256(source),
    preservationSha256: sha256(preservationSource)
  };
}

function inventory(overrides = {}) {
  const result = {
    environment: "isolated-pol22",
    databaseFingerprint: SHA_64,
    migrationHead: "20260811090000_contract_document_content_revision",
    migrationCount: 125,
    schemaDigest: "e".repeat(64),
    tables: [
      { name: "_prisma_migrations", primaryKey: ["id"], rows: [{ id: "m1" }] },
      { name: "Project", primaryKey: ["id"], rows: [{ id: "p1" }] },
      { name: "Contract", primaryKey: ["id"], rows: [{ id: "c1" }] },
      {
        name: "FileObject",
        primaryKey: ["id"],
        rows: [{ id: "f1", objectKey: "uploads/f1.pdf", bucket: "private" }]
      },
      { name: "AuditLog", primaryKey: ["id"], rows: [{ id: "a1" }] }
    ],
    fileBindings: [
      {
        fileId: "f1",
        ownerTable: "Contract",
        ownerPrimaryKey: { id: "c1" },
        ownerColumn: "archiveFileId"
      }
    ],
    objectSnapshots: [{ fileId: "f1", status: "ready", snapshot: FILE_SNAPSHOT }],
    foreignKeys: [],
    danglingForeignKeys: [],
    deletionOrder: ["Contract", "FileObject"],
    ...overrides
  };
  return {
    ...result,
    tables: result.tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => fingerprintedRow(table.name, row))
    }))
  };
}

const smallPolicy = Object.freeze({
  id: "pol-22-business-zeroing-v1",
  tables: [
    { name: "_prisma_migrations", chineseName: "数据库迁移历史", disposition: "protected" },
    { name: "Project", chineseName: "项目基本资料", disposition: "review" },
    { name: "Contract", chineseName: "合同业务", disposition: "business_review" },
    { name: "FileObject", chineseName: "私有业务文件", disposition: "file" },
    { name: "AuditLog", chineseName: "系统与安全审计", disposition: "protected" }
  ]
});

function withTerminalAuditCommit(database) {
  return {
    ...database,
    async commitTerminalAudit({ event, verifyLease }) {
      await verifyLease();
      await database.appendAudit({
        ...event,
        status: "terminal_committed"
      });
    }
  };
}

test("已签名删除决定与执行授权不能替代逐主键独立测试来源证明", () => {
  const effectiveInventory = inventory({
    tables: inventory().tables.map((table) =>
      table.name === "Contract"
        ? { ...table, rows: [{ id: "c1", status: "effective" }] }
        : table
    )
  });
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const build = (testProvenance, testProvenancePublicKey) =>
    buildPreflightReportRaw({
      policy: smallPolicy,
      inventory: effectiveInventory,
      decisions,
      testProvenance,
      testProvenancePublicKey,
      ...testProvenanceRegistryArgs(effectiveInventory, decisions),
      trustedTestProvenancePublicKeySha256:
        TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256,
      trustedWriteFreezePublicKeySha256:
        TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
      backup: backupReceipt(),
      codeSha: SHA_40,
      executionCodeSha256: EXECUTION_SHA_64,
      deploymentIdentitySha256: DEPLOYMENT_SHA_64,
      executorIdentity: EXECUTOR_IDENTITY,
      generatedAt: "2026-08-13T01:00:00.000Z"
    });

  const unproven = build(undefined, TEST_PROVENANCE_KEYS.publicKey);
  assert.equal(unproven.status, "blocked");
  assert.deepEqual(unproven.deletionCandidates, []);
  assert.ok(
    unproven.blockers.some((item) => item.code === "TEST_PROVENANCE_NOT_VERIFIED")
  );
  assert.throws(
    () =>
      validateApplyArguments(
        controlledArgs(unproven),
        unproven,
        new Date("2026-08-13T01:05:00.000Z")
      ),
    /预检报告未就绪/u
  );

  const forged = build(
    createTestProvenance(effectiveInventory, decisions, {
      privateKey: AUTHORIZATION_KEYS.privateKey,
      payload: { registryRef: "伪造的本次请求内注册表" }
    }),
    AUTHORIZATION_KEYS.publicKey
  );
  assert.equal(forged.status, "blocked");
  assert.deepEqual(forged.deletionCandidates, []);
  assert.ok(
    forged.blockers.some((item) => item.code === "TEST_PROVENANCE_NOT_VERIFIED")
  );

  const trustedEffective = build(
    createTestProvenance(effectiveInventory, decisions),
    TEST_PROVENANCE_KEYS.publicKey
  );
  assert.equal(trustedEffective.status, "blocked");
  assert.deepEqual(trustedEffective.deletionCandidates, []);
  assert.ok(
    trustedEffective.blockers.some(
      (item) =>
        item.code === "FORMAL_RECORD_PROTECTED" &&
        item.details?.field === "status"
    )
  );
  assert.throws(
    () =>
      validateApplyArguments(
        controlledArgs(trustedEffective),
        trustedEffective,
        new Date("2026-08-13T01:05:00.000Z")
      ),
    /预检报告未就绪/u
  );

  const forgedRegistryInventory = inventory();
  const draftDecisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const forgedPayload = JSON.parse(
    Buffer.from(
      createTestProvenance(forgedRegistryInventory, draftDecisions).payload,
      "base64"
    ).toString("utf8")
  );
  forgedPayload.registryRef = "FORGED-REGISTRY-REF";
  forgedPayload.records[0].sourceRef = "FORGED-SOURCE-REF";
  forgedPayload.records[0].evidenceSha256 = "e".repeat(64);
  const forgedPayloadBytes = Buffer.from(JSON.stringify(forgedPayload), "utf8");
  const trustedKeyForgedEnvelope = {
    schemaVersion: 1,
    algorithm: "Ed25519",
    payload: forgedPayloadBytes.toString("base64"),
    signature: sign(
      null,
      forgedPayloadBytes,
      TEST_PROVENANCE_KEYS.privateKey
    ).toString("base64")
  };
  const trustedKeyForged = buildPreflightReport({
    policy: smallPolicy,
    inventory: forgedRegistryInventory,
    decisions: draftDecisions,
    testProvenance: trustedKeyForgedEnvelope,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(trustedKeyForged.status, "blocked");
  assert.deepEqual(trustedKeyForged.deletionCandidates, []);
  assert.ok(
    trustedKeyForged.blockers.some(
      (item) => item.code === "TEST_PROVENANCE_NOT_VERIFIED"
    )
  );

  for (const protectedRow of [
    { id: "c1", status: "unknown_future_state" },
    { id: "c1", code: "HT-2026-001" },
    { id: "c1", formalCode: "HT-2026-001" },
    { id: "c1", status: "draft", isActive: true },
    { id: "c1", status: "draft", enabled: true },
    { id: "c1", status: "draft", effectiveFrom: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", lifecycleStatus: "effective" },
    { id: "c1", status: "draft", workflowState: "approved" },
    { id: "c1", status: "draft", unknownLifecycleAt: null },
    { id: "c1", status: "draft", endedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", archivedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", firstSubmittedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", revokedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", rejectedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", appliedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", abandonedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", terminatedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", reversedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", discardedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", disposedAt: "2026-08-13T00:30:00.000Z" },
    { id: "c1", status: "draft", resolvedAt: "2026-08-13T00:30:00.000Z" }
  ]) {
    const protectedInventory = inventory({
      tables: inventory().tables.map((table) =>
        table.name === "Contract" ? { ...table, rows: [protectedRow] } : table
      )
    });
    const protectedReport = buildPreflightReportRaw({
      policy: smallPolicy,
      inventory: protectedInventory,
      decisions,
      testProvenance: createTestProvenance(protectedInventory, decisions),
      testProvenancePublicKey: TEST_PROVENANCE_KEYS.publicKey,
      ...testProvenanceRegistryArgs(protectedInventory, decisions),
      trustedTestProvenancePublicKeySha256:
        TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256,
      trustedWriteFreezePublicKeySha256:
        TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
      backup: backupReceipt(),
      codeSha: SHA_40,
      executionCodeSha256: EXECUTION_SHA_64,
      deploymentIdentitySha256: DEPLOYMENT_SHA_64,
      executorIdentity: EXECUTOR_IDENTITY,
      generatedAt: "2026-08-13T01:00:00.000Z"
    });
    assert.equal(protectedReport.status, "blocked");
    assert.deepEqual(protectedReport.deletionCandidates, []);
    assert.ok(
      protectedReport.blockers.some(
        (item) => item.code === "FORMAL_RECORD_PROTECTED"
      )
    );
  }
  assert.deepEqual(
    selectFormalObservationFields({
      id: "c1",
      lifecycleStatus: "effective",
      workflowState: "approved",
      unrelatedText: "ignored"
    }),
    { lifecycleStatus: "effective", workflowState: "approved" }
  );

  const schemaSource = readFileSync(
    path.resolve(__dirname, "../prisma/schema.prisma"),
    "utf8"
  );
  const nullableLifecycleFields = parsePrismaNullableLifecycleFields(schemaSource);
  const nullableLifecycleRegistry = parsePrismaNullableLifecycleRegistry(schemaSource);
  assert.ok(nullableLifecycleFields.has("endedAt"));
  assert.ok(nullableLifecycleFields.has("settlementModeConfirmedByUserId"));
  for (const [model, field] of [
    ["RefreshToken", "revokedAt"],
    ["SpotProcurementAbnormalTermination", "rejectedAt"],
    ["ContractTakeoverCorrection", "appliedAt"],
    ["ContractVersion", "abandonedAt"],
    ["ProjectFinancingQuota", "terminatedAt"],
    ["NoInvoiceConfirmation", "reversedAt"],
    ["SettlementTemplateVersion", "discardedAt"],
    ["ContractDocumentDifference", "disposedAt"],
    ["SpotProcurementDiscrepancy", "resolvedAt"]
  ]) {
    assert.ok(
      nullableLifecycleRegistry.get(model)?.has(field),
      `${model}.${field} 必须在按表绑定的 Schema 生命周期注册表中`
    );
  }

  const draftInventory = inventory({
    tables: inventory().tables.map((table) =>
      table.name === "Contract"
        ? {
            ...table,
            rows: [
              {
                id: "c1",
                status: "draft",
                signingSubjectType: "our_company",
                ...Object.fromEntries(
                  [...nullableLifecycleRegistry.get("Contract")].map(
                    (field) => [field, null]
                  )
                )
              }
            ]
          }
        : table
    )
  });
  const draftReport = buildPreflightReportRaw({
    policy: smallPolicy,
    inventory: draftInventory,
    decisions,
    testProvenance: createTestProvenance(draftInventory, decisions),
    testProvenancePublicKey: TEST_PROVENANCE_KEYS.publicKey,
    ...testProvenanceRegistryArgs(draftInventory, decisions),
    trustedTestProvenancePublicKeySha256:
      TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256,
    trustedWriteFreezePublicKeySha256:
      TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
    backup: backupReceipt(),
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(draftReport.status, "ready");
});

test("正式聚合父记录的生命周期保护传播到无状态清单子记录", () => {
  const policy = {
    id: "pol-22-business-zeroing-v1",
    tables: [
      { name: "_prisma_migrations", chineseName: "数据库迁移历史", disposition: "protected" },
      { name: "ContractVersion", chineseName: "合同版本", disposition: "business_review" },
      { name: "ContractBill", chineseName: "合同业务清单", disposition: "business_review" },
      { name: "ContractBillRow", chineseName: "合同业务清单行", disposition: "business_review" },
      { name: "FileObject", chineseName: "私有业务文件", disposition: "file" },
      { name: "AuditLog", chineseName: "系统与安全审计", disposition: "protected" }
    ]
  };
  const currentInventory = inventory({
    tables: [
      { name: "_prisma_migrations", primaryKey: ["id"], rows: [{ id: "m1" }] },
      {
        name: "ContractVersion",
        primaryKey: ["id"],
        rows: [{ id: "cv-effective", status: "effective" }]
      },
      {
        name: "ContractBill",
        primaryKey: ["id"],
        rows: [{ id: "bill-1", contractVersionId: "cv-effective" }]
      },
      {
        name: "ContractBillRow",
        primaryKey: ["id"],
        rows: [{ id: "row-1", contractBillId: "bill-1" }]
      },
      { name: "FileObject", primaryKey: ["id"], rows: [] },
      { name: "AuditLog", primaryKey: ["id"], rows: [{ id: "a1" }] }
    ],
    fileBindings: [],
    objectSnapshots: [],
    foreignKeyReferences: [
      {
        name: "logical:ContractBill.contractVersionId->ContractVersion.id",
        childTable: "ContractBill",
        childPrimaryKey: { id: "bill-1" },
        parentTable: "ContractVersion",
        parentPrimaryKey: { id: "cv-effective" },
        protectsChildLifecycle: true
      },
      {
        name: "logical:ContractBillRow.contractBillId->ContractBill.id",
        childTable: "ContractBillRow",
        childPrimaryKey: { id: "row-1" },
        parentTable: "ContractBill",
        parentPrimaryKey: { id: "bill-1" },
        protectsChildLifecycle: true
      }
    ],
    deletionOrder: ["ContractBillRow", "ContractBill", "ContractVersion"]
  });
  const decisions = signedBody({
    schemaVersion: 1,
    policyId: policy.id,
    environment: currentInventory.environment,
    databaseFingerprint: currentInventory.databaseFingerprint,
    records: [
      {
        businessType: "合同版本",
        table: "ContractVersion",
        primaryKey: { id: "cv-effective" },
        decision: "preserve",
        reason: "已生效合同版本必须保留"
      },
      ...[
        ["ContractBill", "合同业务清单", { id: "bill-1" }],
        ["ContractBillRow", "合同业务清单行", { id: "row-1" }]
      ].map(([table, businessType, primaryKey]) => ({
        businessType,
        table,
        primaryKey,
        decision: "delete",
        reason: "独立夹具注册表声称是测试子记录"
      }))
    ]
  });
  const report = buildPreflightReportRaw({
    policy,
    inventory: currentInventory,
    decisions,
    testProvenance: createTestProvenance(currentInventory, decisions),
    testProvenancePublicKey: TEST_PROVENANCE_KEYS.publicKey,
    ...testProvenanceRegistryArgs(currentInventory, decisions),
    trustedTestProvenancePublicKeySha256:
      TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256,
    trustedWriteFreezePublicKeySha256:
      TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256,
    backup: backupReceipt(),
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.deletionCandidates, []);
  assert.ok(
    report.blockers.some(
      (item) =>
        item.code === "FORMAL_AGGREGATE_CHILD_PROTECTED" &&
        item.details?.childTable === "ContractBill"
    )
  );
});

const ISSUE_151_UNREGISTERED_BUSINESS_FOREIGN_KEYS = Object.freeze([
  "ApprovalFormGenerationClaim_approval_instance_fk",
  "ApprovalFormGenerationClaim_pdf_document_fk",
  "Contract_finalSettlementId_fkey",
  "ContractArchiveFile_contract_version_fk",
  "ContractAuthorization_origin_version_fk",
  "ContractAuthorization_supersedes_fk",
  "ContractBillImport_sourceContractVersionId_fkey",
  "ContractBillImport_targetContractVersionId_fkey",
  "ContractBillRow_lineageId_fkey",
  "ContractBillRowCarryForward_contractBillRowId_fkey",
  "ContractBillRowCarryForward_contractVersionId_fkey",
  "ContractBillRowCarryForward_lineageId_fkey",
  "ContractBillRowLineage_contractId_fkey",
  "ContractBillRowLineage_createdInContractVersionId_fkey",
  "ContractBillRowTransition_contractId_fkey",
  "ContractBillRowTransition_fromContractVersionId_fkey",
  "ContractBillRowTransition_sourceContractBillRowId_fkey",
  "ContractBillRowTransition_targetContractBillRowId_fkey",
  "ContractBillRowTransition_toContractVersionId_fkey",
  "ContractDocumentComparison_revision_fk",
  "ContractDocumentComparison_round_fk",
  "ContractDocumentDifference_comparison_fk",
  "ContractDraftAttachment_contractVersion_fk",
  "ContractDraftEditLease_contractVersion_fk",
  "ContractDraftSaveRequest_contractVersion_fk",
  "ContractDraftSubmissionRequest_approval_instance_fk",
  "ContractDraftSubmissionRequest_contractVersion_fk",
  "ContractEndedApplicationRetentionHold_contractVersionId_fkey",
  "ContractFormalFile_contract_version_fk",
  "ContractFormalFile_supersedes_fk",
  "ContractNegotiationRound_source_document_fk",
  "ContractNegotiationRound_version_fk",
  "ContractOfflineRevision_round_fk",
  "ContractOfflineRevision_source_document_fk",
  "ContractSealTask_approval_instance_fk",
  "ContractSealTask_contract_version_fk",
  "ContractSettlementProcess_contractId_fkey",
  "ContractSettlementProcess_contractVersionId_fkey",
  "ContractSettlementProcess_invalidatedByContractVersionId_fkey",
  "ContractSettlementProcess_settlementDraftId_fkey",
  "ContractSettlementProcess_settlementId_fkey",
  "ContractTakeover_historicalInitialSettlementId_fkey",
  "ContractTakeover_takeoverBatchId_fkey",
  "ContractTakeoverBalanceAccount_takeoverId_fkey",
  "ContractTakeoverBalanceEntry_accountId_fkey",
  "ContractTakeoverBalanceEntry_correctionId_fkey",
  "ContractTakeoverBalanceEntry_historicalPaymentId_fkey",
  "ContractTakeoverBalanceEntry_reversesEntryId_fkey",
  "ContractTakeoverBalanceEntry_settlementId_fkey",
  "ContractTakeoverConfirmationEvent_takeoverId_fkey",
  "ContractTakeoverContractFacts_takeoverId_fkey",
  "ContractTakeoverCorrection_targetAllocationId_fkey",
  "ContractTakeoverCorrection_targetBalanceEntryId_fkey",
  "ContractTakeoverCorrection_targetHistoricalPaymentId_fkey",
  "ContractTakeoverExcessEvidence_takeoverId_fkey",
  "ContractTakeoverFinanceFacts_takeoverId_fkey",
  "ContractTakeoverHistoricalPayment_takeoverId_fkey",
  "ContractTakeoverHistoricalPaymentAllocation_paymentId_fkey",
  "ContractTakeoverHistoricalPaymentVoucher_paymentId_fkey",
  "ContractTakeoverSettlementEvidence_takeoverId_fkey",
  "ContractTakeoverSideSaveRequest_takeoverId_fkey",
  "ContractTaxFactRevision_contract_fk",
  "ContractTaxFactRevision_contract_version_fk",
  "ContractVersion_baseVersionId_fkey",
  "ContractVersion_latest_draft_preview_document_fk",
  "ContractVersion_supersedesVersionId_fkey",
  "ContractVersionAuthorizationLink_authorization_fk",
  "ContractVersionAuthorizationLink_contract_version_fk",
  "ContractVersionAuthorizationLink_reused_from_version_fk",
  "EmployeeLoanRepayment_loanAccountId_fkey",
  "EmployeeProjectLoanEntry_loanAccountId_fkey",
  "EmployeeProjectLoanEntry_reversalOfEntryId_fkey",
  "EmployeeProjectLoanEntry_sourceExpenseClaimId_fkey",
  "EmployeeProjectLoanEntry_sourceRepaymentId_fkey",
  "EmployeeProjectLoanEntry_sourceReservationId_fkey",
  "ExpenseClaim_approvalInstanceId_fkey",
  "ExpenseLoanOffsetReservation_expenseClaimId_fkey",
  "ExpenseLoanOffsetReservation_loanAccountId_fkey",
  "ExpenseLoanOffsetReservation_loanEntryId_fkey",
  "FinanceRecord_payment_request_fk",
  "FinanceRecord_project_expense_fk",
  "FinanceRecord_project_expense_owner_fk",
  "FinanceRecord_settlement_fk",
  "InvoiceAllocation_payment_coordinates_fkey",
  "InvoiceAllocation_procurement_coordinates_fkey",
  "InvoiceAllocation_procurement_line_coordinates_fkey",
  "InvoiceAllocation_receipt_line_coordinates_fkey",
  "InvoiceAllocation_receiptId_fkey",
  "InvoiceAllocation_version_coordinates_fkey",
  "InvoiceExceptionConfirmation_invoice_line_coordinates_fkey",
  "InvoiceExceptionConfirmation_payment_coordinates_fkey",
  "InvoiceExceptionConfirmation_procurement_coordinates_fkey",
  "InvoiceExceptionConfirmation_procurement_line_coordinates_fkey",
  "InvoiceExceptionConfirmation_receipt_line_coordinates_fkey",
  "InvoiceExceptionConfirmation_receiptId_fkey",
  "InvoiceExceptionConfirmation_version_coordinates_fkey",
  "InvoiceRecord_source_procurement_coordinates_fkey",
  "NoInvoiceConfirmation_payment_coordinates_fkey",
  "NoInvoiceConfirmation_procurement_coordinates_fkey",
  "NoInvoiceConfirmation_procurement_line_coordinates_fkey",
  "NoInvoiceConfirmation_receipt_line_coordinates_fkey",
  "NoInvoiceConfirmation_receiptId_fkey",
  "NoInvoiceConfirmation_version_coordinates_fkey",
  "OperatingFact_adjustsFactId_fkey",
  "OperatingImpactEntry_fact_project_fkey",
  "OperatingTakeoverActivation_batchId_fkey",
  "OperatingTakeoverAttachmentGroup_batchId_fkey",
  "OperatingTakeoverAttachmentGroup_rowId_fkey",
  "OperatingTakeoverAttachmentLink_groupId_fkey",
  "OperatingTakeoverConfirmation_batchId_fkey",
  "OperatingTakeoverIssue_batchId_fkey",
  "OperatingTakeoverIssue_rowId_fkey",
  "OperatingTakeoverRow_batchId_fkey",
  "PaymentExecution_request_fk",
  "PaymentExecution_settlement_fk",
  "PaymentExecutionAllocation_request_fk",
  "PaymentRequest_contract_fk",
  "PaymentRequest_contract_version_fk",
  "PaymentRequest_paymentTermsStage_terms_fkey",
  "PaymentRequest_settlement_fk",
  "PaymentRequest_terms_version_fk",
  "PaymentTermsVersion_contract_fk",
  "PdfDocument_approval_instance_fk",
  "ProjectExpenseExecution_request_fk",
  "ProjectFundingAllocation_quota_project_fk",
  "ProjectFundingAllocation_reversalOfAllocationId_fkey",
  "ProjectFundingAllocation_sourceId_fkey",
  "Settlement_contract_fk",
  "Settlement_contract_version_fk",
  "Settlement_processId_fkey",
  "Settlement_terms_version_fk",
  "SettlementArchiveFile_settlement_fk",
  "SettlementDraft_contract_fk",
  "SettlementDraft_contract_version_fk",
  "SettlementDraft_payment_terms_version_fk",
  "SettlementDraft_processId_fkey",
  "SettlementDraft_submitted_settlement_fk",
  "SettlementDraftLine_contractBillRowId_fkey",
  "SettlementDraftLine_contractBillRowLineageId_fkey",
  "SettlementDraftLine_relatedSettlementLineId_fkey",
  "SettlementDraftLine_settlementDraftId_fkey",
  "SettlementImport_contract_version_fk",
  "SettlementImport_settlementDraftId_fkey",
  "SettlementLine_contract_bill_row_fk",
  "SettlementLine_contractBillRowLineageId_fkey",
  "SettlementLine_relatedSettlementLineId_fkey",
  "SettlementLine_sourceContractVersionId_fkey",
  "SettlementLineAttachment_settlementDraftLineId_fkey",
  "SettlementRecoveryBalance_contractId_fkey",
  "SettlementRecoveryBalance_settlementId_fkey",
  "SettlementRecoveryEntry_balanceId_fkey",
  "SettlementRecoveryEntry_relatedPaymentId_fkey",
  "SettlementRecoveryEntry_reversalOfEntryId_fkey",
  "SettlementSignedDocument_derivedFromDocumentId_fkey",
  "SettlementSignedDocument_settlement_draft_fk",
  "SettlementSignedDocument_settlement_fk",
  "SettlementSignedDocument_supersedes_fk",
  "SettlementSignedDocumentGenerationClaim_final_document_fk",
  "SettlementSignedDocumentGenerationClaim_original_document_fk",
  "SettlementSignedDocumentGenerationClaim_settlement_fk",
  "SpotProcurement_currentVersion_coordinates_fkey",
  "SpotProcurementAbnormalTermination_procurementId_fkey",
  "SpotProcurementAttachment_versionId_fkey",
  "SpotProcurementDiscrepancy_procurement_coordinates_fkey",
  "SpotProcurementDiscrepancy_receiptId_fkey",
  "SpotProcurementDiscrepancy_review_coordinates_fkey",
  "SpotProcurementDiscrepancy_supplier_balance_coordinates_fkey",
  "SpotProcurementDiscrepancy_version_coordinates_fkey",
  "SpotProcurementLine_versionId_fkey",
  "SpotProcurementPayment_primaryPaymentChannelId_fkey",
  "SpotProcurementPayment_procurement_coordinates_fkey",
  "SpotProcurementPayment_sourcePaymentId_fkey",
  "SpotProcurementPayment_version_coordinates_fkey",
  "SpotProcurementPaymentArchive_paymentId_fkey",
  "SpotProcurementPaymentArchiveFile_archiveId_fkey",
  "SpotProcurementPaymentAttachment_paymentId_fkey",
  "SpotProcurementPaymentChannel_paymentId_fkey",
  "SpotProcurementPaymentExecution_paymentId_fkey",
  "SpotProcurementPaymentExecutionVoucher_executionId_fkey",
  "SpotProcurementPaymentInvoice_paymentId_fkey",
  "SpotProcurementPaymentLine_payment_version_fkey",
  "SpotProcurementPaymentLine_procurement_line_fkey",
  "SpotProcurementPaymentMethodOption_paymentId_fkey",
  "SpotProcurementReceipt_current_revision_coordinates_fkey",
  "SpotProcurementReceipt_procurement_coordinates_fkey",
  "SpotProcurementReceipt_submissionDelegation_coordinates_fkey",
  "SpotProcurementReceipt_version_coordinates_fkey",
  "SpotProcurementReceiptDelegation_receiptId_fkey",
  "SpotProcurementReceiptLine_procurement_line_coordinates_fkey",
  "SpotProcurementReceiptLine_receiptId_fkey",
  "SpotProcurementReceiptLine_revision_coordinates_fkey",
  "SpotProcurementReceiptPhoto_receiptId_fkey",
  "SpotProcurementReceiptPhoto_revision_coordinates_fkey",
  "SpotProcurementReceiptReview_receiptId_fkey",
  "SpotProcurementReceiptReview_revision_coordinates_fkey",
  "SpotProcurementReceiptReview_submissionDelegation_coordinates_f",
  "SpotProcurementReceiptReview_target_coordinates_fkey",
  "SpotProcurementReceiptRevision_receipt_procurement_coordinates_",
  "SpotProcurementReceiptRevision_submissionDelegation_coordinates",
  "SpotProcurementReceiptRevision_version_coordinates_fkey",
  "SpotProcurementRefund_discrepancy_coordinates_fkey",
  "SpotProcurementRefund_paymentId_fkey",
  "SpotProcurementRefund_procurementId_fkey",
  "SpotProcurementVersion_procurementId_fkey",
  "SupplierBalanceEntry_accountId_fkey",
  "SupplierBalanceEntry_paymentId_fkey",
  "SupplierBalanceEntry_procurementId_fkey",
  "SupplierBalanceEntry_reservationId_fkey",
  "SupplierBalanceReservation_accountId_fkey",
  "SupplierBalanceReservation_paymentId_fkey"
]);

test("#151 完整扫描所得业务外键均按稳定坐标逐条登记", () => {
  const registered = BUSINESS_ZEROING_LOGICAL_RELATIONS
    .filter((relation) => relation.sourceIssue === 151)
    .sort((left, right) => left.sourceForeignKey.localeCompare(right.sourceForeignKey));

  assert.equal(registered.length, 210);
  assert.deepEqual(
    registered.map((relation) => relation.sourceForeignKey),
    ISSUE_151_UNREGISTERED_BUSINESS_FOREIGN_KEYS
  );
  assert.equal(new Set(registered.map((relation) => relation.sourceForeignKey)).size, 210);
  assert.equal(
    registered.filter((relation) => relation.protectsChildLifecycle).length,
    91
  );
  assert.equal(
    registered.find(
      (relation) =>
        relation.sourceForeignKey === "ContractTakeover_takeoverBatchId_fkey"
    ).protectsChildLifecycle,
    true
  );
  assert.equal(
    registered.find(
      (relation) =>
        relation.sourceForeignKey ===
        "PaymentRequest_paymentTermsStage_terms_fkey"
    ).protectsChildLifecycle,
    true
  );
  assert.equal(
    registered.find(
      (relation) =>
        relation.sourceForeignKey ===
        "SpotProcurementPayment_sourcePaymentId_fkey"
    ).protectsChildLifecycle,
    false
  );
  for (const relation of registered) {
    assert.ok(Array.isArray(relation.childColumns) && relation.childColumns.length > 0);
    assert.ok(Array.isArray(relation.parentColumns) && relation.parentColumns.length > 0);
    assert.equal(typeof relation.protectsChildLifecycle, "boolean");
    assert.match(relation.dispositionReason, /[\u3400-\u9fff]/u);
  }
});

test("真实 Prisma 正式聚合关系必须全部登记父生命周期保护", () => {
  const schemaSource = readFileSync(
    path.join(__dirname, "../prisma/schema.prisma"),
    "utf8"
  );
  for (const [childTable, childColumn, parentTable] of [
    ["ContractVersion", "contractId", "Contract"],
    ["PaymentTermsVersion", "contractVersionId", "ContractVersion"],
    ["PaymentTermsStage", "paymentTermsVersionId", "PaymentTermsVersion"],
    ["SettlementLine", "settlementId", "Settlement"],
    ["PaymentExecutionAllocation", "paymentExecutionId", "PaymentExecution"],
    ["InvoiceLine", "invoiceRecordId", "InvoiceRecord"],
    ["ExpenseClaimLine", "expenseClaimId", "ExpenseClaim"],
    ["InvoiceAllocation", "invoiceLineId", "InvoiceLine"],
    ["ExpenseClaimAttachment", "expenseClaimId", "ExpenseClaim"],
    ["ExpenseClaimPaymentExecution", "expenseClaimId", "ExpenseClaim"],
    ["SettlementLineAttachment", "settlementLineId", "SettlementLine"]
  ]) {
    assert.match(schemaSource, new RegExp(`model ${childTable} \\{[\\s\\S]*?\\n  ${childColumn}\\s`, "u"));
    assert.ok(
      BUSINESS_ZEROING_LOGICAL_RELATIONS.some(
        (relation) =>
          relation.childTable === childTable &&
          relation.childColumn === childColumn &&
          relation.parentTable === parentTable &&
          relation.protectsChildLifecycle === true
      ),
      `${childTable}.${childColumn}->${parentTable} 未登记正式聚合保护`
    );
  }

  assert.deepEqual(
    classifyBusinessAggregateForeignKey({
      name: "future_formal_child_parent_fkey",
      childTable: "SettlementLineAttachment",
      childColumns: ["futureParentId"],
      parentTable: "SettlementLine",
      parentColumns: ["id"]
    }),
    {
      protectsChildLifecycle: false,
      schemaBlocker: {
        code: "UNREGISTERED_BUSINESS_AGGREGATE_RELATION",
        foreignKey: "future_formal_child_parent_fkey",
        childTable: "SettlementLineAttachment",
        childColumns: ["futureParentId"],
        parentTable: "SettlementLine",
        parentColumns: ["id"]
      }
    }
  );
});

test("当前 Prisma 全部表均有唯一中文归类且迁移历史受保护", () => {
  const runtimeControlTables = [
    "OperatingLedgerWriteContext",
    "OperatingLedgerWriteSecret"
  ];
  const schema = readFileSync(
    path.resolve(__dirname, "../prisma/schema.prisma"),
    "utf8"
  );
  const schemaTables = [...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)]
    .map((match) => match[1])
    .sort();
  const policyTables = BUSINESS_ZEROING_POLICY.tables
    .map((item) => item.name)
    .filter(
      (name) =>
        name !== "_prisma_migrations" && !runtimeControlTables.includes(name)
    )
    .sort();

  assert.deepEqual(policyTables, schemaTables);
  assert.deepEqual(
    BUSINESS_ZEROING_POLICY.tables
      .map((item) => item.name)
      .filter((name) => runtimeControlTables.includes(name))
      .sort(),
    runtimeControlTables
  );
  assert.equal(
    BUSINESS_ZEROING_POLICY.tables.find(
      (item) => item.name === "_prisma_migrations"
    ).disposition,
    "protected"
  );
  assert.ok(
    BUSINESS_ZEROING_POLICY.tables.every((item) =>
      /[\u3400-\u9fff]/u.test(item.chineseName)
    )
  );
});

test("新增主线 Prisma 模型均有唯一显式中文归类", () => {
  const policyByName = new Map(
    BUSINESS_ZEROING_POLICY.tables.map((item) => [item.name, item])
  );
  const expected = {
    BusinessEntrySubmissionSnapshot: ["business_review", "统一业务录入提交快照"],
    OperatingFact: ["business_review", "经营事实"],
    OperatingImpactEntry: ["business_review", "经营影响分录"],
    OperatingTakeoverActivation: ["business_review", "历史经营接管激活记录"],
    OperatingTakeoverAttachmentGroup: ["business_review", "历史经营接管附件组"],
    OperatingTakeoverAttachmentLink: ["business_review", "历史经营接管附件绑定"],
    OperatingTakeoverBatch: ["business_review", "历史经营接管批次"],
    OperatingTakeoverConfirmation: ["business_review", "历史经营接管专业确认"],
    OperatingTakeoverIssue: ["business_review", "历史经营接管问题"],
    OperatingTakeoverRow: ["business_review", "历史经营接管明细"],
    ProjectParticipatingCompany: ["review", "项目我方参与公司"]
  };

  for (const [name, [disposition, chineseName]] of Object.entries(expected)) {
    assert.deepEqual(policyByName.get(name), { name, chineseName, disposition });
  }
});

test("经营账写入运行控制表有唯一中文保护策略且其他未知表继续阻断", () => {
  const runtimeControlTables = [
    {
      name: "OperatingLedgerWriteContext",
      primaryKey: ["backendPid", "transactionId"],
      rows: []
    },
    {
      name: "OperatingLedgerWriteSecret",
      primaryKey: ["id"],
      rows: []
    }
  ];
  const policyTableNames = new Set([
    ...smallPolicy.tables.map((item) => item.name),
    ...runtimeControlTables.map((item) => item.name)
  ]);
  const policy = {
    ...smallPolicy,
    tables: BUSINESS_ZEROING_POLICY.tables.filter((item) =>
      policyTableNames.has(item.name)
    )
  };
  const report = buildPreflightReport({
    policy,
    inventory: inventory({
      tables: [
        ...inventory().tables,
        ...runtimeControlTables,
        {
          name: "FutureOperatingLedgerRuntimeControl",
          primaryKey: ["id"],
          rows: []
        }
      ]
    }),
    decisions: decisionManifest([]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.deepEqual(
    report.blockers
      .filter((item) => item.code === "UNKNOWN_TABLE")
      .map((item) => item.details.table),
    ["FutureOperatingLedgerRuntimeControl"]
  );

  const policyByName = new Map(policy.tables.map((item) => [item.name, item]));
  assert.deepEqual(policyByName.get("OperatingLedgerWriteContext"), {
    name: "OperatingLedgerWriteContext",
    chineseName: "经营账事务写入授权上下文",
    disposition: "protected"
  });
  assert.deepEqual(policyByName.get("OperatingLedgerWriteSecret"), {
    name: "OperatingLedgerWriteSecret",
    chineseName: "经营账写入授权密钥摘要",
    disposition: "protected"
  });
});

test("基础资料无外键逻辑关联有显式注册且触发器函数进入 Schema 指纹", () => {
  for (const expected of [
    ["UserPosition", "userId", "User"],
    ["UserPosition", "projectId", "Project"],
    ["ProjectMember", "userId", "User"],
    ["ProjectMember", "projectId", "Project"],
    ["ProjectRosterMember", "projectId", "Project"],
    ["ContractNumberRule", "projectId", "Project"]
  ]) {
    assert.ok(
      BUSINESS_ZEROING_LOGICAL_RELATIONS.some(
        (relation) =>
          relation.childTable === expected[0] &&
          relation.childColumn === expected[1] &&
          relation.parentTable === expected[2]
      )
    );
  }
  assert.ok(
    BUSINESS_ZEROING_LOGICAL_RELATIONS.some(
      (relation) =>
        relation.childTable === "CompanyEntity" &&
        JSON.stringify(relation.childColumns) === JSON.stringify(["id", "currentVersionNo"]) &&
        relation.parentTable === "CompanyEntityVersion" &&
        JSON.stringify(relation.parentColumns) === JSON.stringify(["companyEntityId", "versionNo"])
    )
  );
  const schema = {
    tables: ["Contract"],
    columns: [{ tableName: "Contract", columnName: "id" }],
    primaryKeys: new Map([["Contract", ["id"]]]),
    foreignKeys: [],
    triggers: [],
    functions: []
  };
  assert.notEqual(
    computeSchemaDigest(schema),
    computeSchemaDigest({
      ...schema,
      triggers: [
        {
          tableName: "Contract",
          triggerName: "unexpected_delete",
          triggerDefinition: "AFTER DELETE",
          functionSchema: "public",
          functionName: "delete_preserved_project",
          functionDefinition: "DELETE FROM Project"
        }
      ],
      functions: []
    })
  );
  assert.notEqual(
    computeSchemaDigest(schema),
    computeSchemaDigest({
      ...schema,
      functions: [
        {
          functionSchema: "public",
          functionName: "indirect_delete",
          identityArguments: "",
          functionKind: "f",
          functionDefinition: "DELETE FROM Project"
        }
      ]
    })
  );
});

test("保留合同编号规则生成逐主键 CAS 正式序号复位", () => {
  const policy = {
    ...smallPolicy,
    tables: [
      ...smallPolicy.tables,
      { name: "ContractNumberRule", chineseName: "合同编号规则", disposition: "review" }
    ]
  };
  const currentInventory = inventory({
    tables: [
      ...inventory().tables,
      {
        name: "ContractNumberRule",
        primaryKey: ["id"],
        rows: [{ id: "rule-1", nextSequence: 8 }]
      }
    ]
  });
  const report = buildPreflightReport({
    policy,
    inventory: currentInventory,
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      },
      {
        businessType: "合同编号规则",
        table: "ContractNumberRule",
        primaryKey: { id: "rule-1" },
        decision: "preserve",
        reason: "正式编号规则保留并从一开始"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.numberResets, [
    {
      businessType: "合同编号规则正式启用序号",
      table: "ContractNumberRule",
      primaryKey: { id: "rule-1" },
      field: "nextSequence",
      expectedValue: 8,
      targetValue: 1,
      action: "reset_exact_field_compare_and_set"
    }
  ]);
  assert.deepEqual(
    buildExactSequenceResetStatement(
      report.numberResets[0],
      new Map([["ContractNumberRule", ["id"]]])
    ),
    {
      sql:
        'UPDATE "ContractNumberRule" SET "nextSequence" = $1, "updatedAt" = NOW() ' +
        'WHERE "id" = $2 AND "nextSequence" = $3',
      values: [1, "rule-1", 8]
    }
  );
});

test("预检显式输出预计释放的正式编号、日序列和规则序号", () => {
  const policy = {
    ...smallPolicy,
    tables: [
      ...smallPolicy.tables,
      { name: "BusinessDailySequence", chineseName: "业务编号序列", disposition: "business_review" },
      { name: "ContractNumberTombstone", chineseName: "合同编号占用", disposition: "business_review" },
      { name: "ContractNumberRule", chineseName: "合同编号规则", disposition: "review" }
    ]
  };
  const report = buildPreflightReport({
    policy,
    inventory: inventory({
      tables: [
        ...inventory().tables,
        {
          name: "BusinessDailySequence",
          primaryKey: ["prefix", "businessDate"],
          rows: [{ prefix: "HT", businessDate: "2026-08-13", nextSequence: 12 }]
        },
        {
          name: "ContractNumberTombstone",
          primaryKey: ["id"],
          rows: [{ id: "tombstone-1", formalCode: "HT-2026-001" }]
        },
        {
          name: "ContractNumberRule",
          primaryKey: ["id"],
          rows: [{ id: "rule-1", nextSequence: 8 }]
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      },
      {
        businessType: "合同编号规则",
        table: "ContractNumberRule",
        primaryKey: { id: "rule-1" },
        decision: "preserve",
        reason: "正式规则保留并复位"
      },
      {
        businessType: "业务编号序列",
        table: "BusinessDailySequence",
        primaryKey: { prefix: "HT", businessDate: "2026-08-13" },
        decision: "delete",
        reason: "已逐主键确认是测试业务序列"
      },
      {
        businessType: "合同编号占用",
        table: "ContractNumberTombstone",
        primaryKey: { id: "tombstone-1" },
        decision: "delete",
        reason: "已逐主键确认是测试合同编号占用"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.expectedReleasedNumbers, [
    {
      businessType: "业务编号序列中的测试资料",
      table: "BusinessDailySequence",
      primaryKey: { businessDate: "2026-08-13", prefix: "HT" },
      kind: "daily_sequence",
      prefix: "HT",
      businessDate: "2026-08-13",
      currentNextSequence: 12,
      action: "release_by_exact_record_deletion"
    },
    {
      businessType: "合同编号规则正式启用序号",
      table: "ContractNumberRule",
      primaryKey: { id: "rule-1" },
      kind: "number_rule_sequence",
      currentNextSequence: 8,
      targetNextSequence: 1,
      action: "release_by_exact_compare_and_set"
    },
    {
      businessType: "合同编号占用中的测试资料",
      table: "ContractNumberTombstone",
      primaryKey: { id: "tombstone-1" },
      kind: "formal_code_tombstone",
      formalCode: "HT-2026-001",
      action: "release_by_exact_record_deletion"
    }
  ]);
});

test("业务日序列与合同编号占用不得通过 preserve 绕过正式编号释放", () => {
  const policy = {
    ...smallPolicy,
    tables: [
      ...smallPolicy.tables,
      { name: "BusinessDailySequence", chineseName: "业务编号序列", disposition: "business_review" },
      { name: "ContractNumberTombstone", chineseName: "合同编号占用", disposition: "business_review" }
    ]
  };
  const report = buildPreflightReport({
    policy,
    inventory: inventory({
      tables: [
        ...inventory().tables,
        {
          name: "BusinessDailySequence",
          primaryKey: ["prefix", "businessDate"],
          rows: [{ prefix: "HT", businessDate: "2026-08-13", nextSequence: 12 }]
        },
        {
          name: "ContractNumberTombstone",
          primaryKey: ["id"],
          rows: [{ id: "tombstone-1", formalCode: "HT-2026-001" }]
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      },
      {
        businessType: "业务编号序列",
        table: "BusinessDailySequence",
        primaryKey: { prefix: "HT", businessDate: "2026-08-13" },
        decision: "preserve",
        reason: "尝试保留测试业务序列"
      },
      {
        businessType: "合同编号占用",
        table: "ContractNumberTombstone",
        primaryKey: { id: "tombstone-1" },
        decision: "preserve",
        reason: "尝试保留测试合同编号占用"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.deepEqual(
    report.blockers
      .filter((item) => item.code === "NUMBER_RELEASE_REQUIRES_DELETE")
      .map((item) => item.details?.table)
      .sort(),
    ["BusinessDailySequence", "ContractNumberTombstone"]
  );
  assert.deepEqual(report.deletionCandidates, []);
  assert.deepEqual(report.expectedReleasedNumbers, []);
});

test("显式中文保留决定与已知业务表生成逐主键删除候选", () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(report.status, "ready");
  assert.deepEqual(report.preservationWhitelist, [
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      reason: "已由负责人核实"
    }
  ]);
  assert.deepEqual(
    report.deletionCandidates.map(({ businessType, table, primaryKey }) => ({
      businessType,
      table,
      primaryKey
    })),
    [
      { businessType: "合同业务中的测试资料", table: "Contract", primaryKey: { id: "c1" } },
      { businessType: "测试业务绑定文件", table: "FileObject", primaryKey: { id: "f1" } }
    ]
  );
  assert.equal(report.fileBindings[0].objectKey, "uploads/f1.pdf");
  assert.deepEqual(report.preservationCountsByBusinessType, { 项目基本资料: 1 });
  assert.deepEqual(report.deletionCountsByBusinessType, {
    测试业务绑定文件: 1,
    合同业务中的测试资料: 1
  });
  assert.equal(report.summary.migrationHistoryDeletionCandidates, 0);
  assert.equal(report.summary.databaseDeletionCandidates, 0);
});

test("正式业务记录可逐主键显式保留且未分类业务默认阻断", () => {
  const formalReport = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      },
      {
        businessType: "合同业务",
        table: "Contract",
        primaryKey: { id: "c1" },
        decision: "preserve",
        reason: "已逐主键确认是正式合同"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(formalReport.status, "ready");
  assert.deepEqual(formalReport.deletionCandidates, []);
  assert.ok(
    formalReport.preservationWhitelist.some(
      (item) => item.table === "Contract" && item.reason === "已逐主键确认是正式合同"
    )
  );

  const unclassifiedManifest = signedBody({
    schemaVersion: 1,
    policyId: "pol-22-business-zeroing-v1",
    environment: "isolated-pol22",
    databaseFingerprint: SHA_64,
    records: [
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      }
    ]
  });
  const blocked = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: unclassifiedManifest,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(
    blocked.blockers.some(
      (item) =>
        item.code === "UNCLASSIFIED_REVIEW_RECORD" && item.details?.table === "Contract"
    )
  );
  assert.deepEqual(blocked.deletionCandidates, []);
});

test("删除顺序只由本批实际候选的逐主键外键关系决定", () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      deletionOrder: ["Contract", "FileObject"],
      foreignKeyReferences: [
        {
          name: "FileObject_contract_fk",
          childTable: "FileObject",
          childPrimaryKey: { id: "f1" },
          parentTable: "Contract",
          parentPrimaryKey: { id: "c1" }
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(report.status, "ready");
  assert.deepEqual(report.deletionOrder, [
    { table: "FileObject", primaryKey: { id: "f1" } },
    { table: "Contract", primaryKey: { id: "c1" } }
  ]);
});

test("未知表和未逐条决定的基础资料一律阻断", () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: [
        ...inventory().tables,
        { name: "FutureOperatingFact", primaryKey: ["id"], rows: [{ id: "new1" }] }
      ]
    }),
    decisions: decisionManifest([]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((item) => item.code === "UNKNOWN_TABLE"));
  assert.ok(report.blockers.some((item) => item.code === "UNCLASSIFIED_REVIEW_RECORD"));
  assert.deepEqual(report.deletionCandidates, []);
});

test("候选表存在启用的拒绝删除触发器时预检提前阻断", () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      deleteGuardTriggers: [
        {
          tableName: "Contract",
          triggerName: "Contract_immutable",
          enabledState: "O"
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((item) => item.code === "DELETE_GUARD_TRIGGER"));
  assert.deepEqual(report.deletionCandidates, []);
});

test("保留基础资料逻辑依赖待删除父资料时 fail-closed", () => {
  const policy = {
    ...smallPolicy,
    tables: [
      ...smallPolicy.tables,
      { name: "ProjectMember", chineseName: "项目业务岗位分配", disposition: "review" }
    ]
  };
  const report = buildPreflightReport({
    policy,
    inventory: inventory({
      tables: [
        ...inventory().tables,
        { name: "ProjectMember", primaryKey: ["id"], rows: [{ id: "member-1" }] }
      ],
      foreignKeyReferences: [
        {
          name: "logical:ProjectMember.projectId->Project.id",
          childTable: "ProjectMember",
          childPrimaryKey: { id: "member-1" },
          parentTable: "Project",
          parentPrimaryKey: { id: "p1" }
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "delete",
        reason: "已确认是测试项目"
      },
      {
        businessType: "项目业务岗位分配",
        table: "ProjectMember",
        primaryKey: { id: "member-1" },
        decision: "preserve",
        reason: "已确认需要保留"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((item) => item.code === "MIXED_RECORD_OWNERSHIP"));
  assert.deepEqual(report.deletionCandidates, []);
});

test("未知、孤儿和同时绑定保留与删除记录的文件都 fail-closed", () => {
  const base = inventory();
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: base.tables.map((table) =>
        table.name === "FileObject"
          ? {
              ...table,
              rows: [
                ...table.rows,
                { id: "f-orphan", objectKey: "uploads/orphan.pdf", bucket: "private" },
                { id: "f-mixed", objectKey: "uploads/mixed.pdf", bucket: "private" },
                { id: "f-unknown", objectKey: "uploads/unknown.pdf", bucket: "private" }
              ]
            }
          : table
      ),
      fileBindings: [
        ...base.fileBindings,
        {
          fileId: "f-mixed",
          ownerTable: "Project",
          ownerPrimaryKey: { id: "p1" },
          ownerColumn: "fileId"
        },
        {
          fileId: "f-mixed",
          ownerTable: "Contract",
          ownerPrimaryKey: { id: "c1" },
          ownerColumn: "fileId"
        },
        {
          fileId: "f-unknown",
          ownerTable: "UnknownOwner",
          ownerPrimaryKey: { id: "u1" },
          ownerColumn: "fileId"
        }
      ]
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some((item) => item.code === "ORPHAN_FILE"));
  assert.ok(report.blockers.some((item) => item.code === "MIXED_FILE_OWNERSHIP"));
  assert.ok(report.blockers.some((item) => item.code === "UNKNOWN_FILE_OWNER"));
  assert.deepEqual(report.deletionCandidates, []);
});

test("备份或隔离恢复验证失败会阻断", () => {
  const failed = backupReceipt({
    databaseBackup: {
      ...backupReceipt().databaseBackup,
      restoreStatus: "failed"
    }
  });
  assert.throws(
    () =>
      validateBackupReceipt(
        failed,
        "isolated-pol22",
        SHA_64,
        "2026-08-13T01:00:00.000Z"
      ),
    /数据库备份恢复验证未通过/u
  );
});

test("备份捕获与恢复验证时间不得晚于本次预检", () => {
  for (const [backupKey, chineseName] of [
    ["databaseBackup", "数据库备份"],
    ["privateFileBackup", "私有文件备份"]
  ]) {
    const currentBackup = backupReceipt();
    const futureBackup = backupReceipt({
      [backupKey]: {
        ...currentBackup[backupKey],
        capturedAt: "2099-01-01T00:00:00.000Z",
        restoreVerifiedAt: "2099-01-01T00:01:00.000Z"
      }
    });
    const report = buildPreflightReport({
      policy: smallPolicy,
      inventory: inventory(),
      decisions: decisionManifest([
        {
          businessType: "项目基本资料",
          table: "Project",
          primaryKey: { id: "p1" },
          decision: "preserve",
          reason: "正式项目保留"
        }
      ]),
      backup: futureBackup,
      codeSha: SHA_40,
      generatedAt: "2026-08-13T01:00:00.000Z"
    });

    assert.equal(report.status, "blocked");
    assert.ok(
      report.blockers.some(
        (item) =>
          item.code === "BACKUP_NOT_VERIFIED" &&
          item.message === `${chineseName}捕获或恢复验证时间晚于本次预检`
      )
    );
    assert.deepEqual(report.deletionCandidates, []);
  }
});

test("保留决定必须逐主键、中文业务类型、精确环境且收据完整", () => {
  const invalid = decisionManifest([
    {
      businessType: "Project",
      table: "Project",
      primaryKey: {},
      decision: "preserve",
      reason: "ok"
    }
  ]);
  assert.throws(
    () => validateDecisionManifest(invalid, smallPolicy, inventory()),
    /中文业务类型|主键/u
  );
});

test("执行门要求 apply、精确绑定、外部签名授权与二次确认", () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const args = controlledArgs(report);
  assert.doesNotThrow(() =>
    validateApplyArguments(args, report, new Date("2026-08-13T01:05:00.000Z"))
  );
  for (const changed of [
    { apply: false },
    { environment: "other" },
    { expectedCandidateSha256: "0".repeat(64) },
    { expectedExecutionCodeSha256: "0".repeat(64) },
    { deploymentIdentitySha256: "0".repeat(64) },
    { executorIdentity: "different-executor" },
    { confirmation: "yes" }
  ]) {
    assert.throws(() =>
      validateApplyArguments(
        { ...args, ...changed },
        report,
        new Date("2026-08-13T01:05:00.000Z")
      )
    );
  }
  const forged = {
    ...args.authorizationEnvelope,
    signature: Buffer.alloc(64).toString("base64")
  };
  assert.throws(
    () =>
      validateAuthorizationEnvelope(
        forged,
        report,
        args,
        AUTHORIZATION_KEYS.publicKey,
        new Date("2026-08-13T01:05:00.000Z")
      ),
    /独立授权签名/u
  );
});

test("写冻结租约实现与 runbook 共享精确字段契约", () => {
  const runbook = readFileSync(
    path.resolve(__dirname, "../../../docs/runbooks/test-business-zeroing-controlled-tool.md"),
    "utf8"
  );
  for (const field of WRITE_FREEZE_LEASE_PAYLOAD_FIELDS) {
    assert.match(runbook, new RegExp(`租约 payload 字段必须精确为[^\\n]*${field}`, "u"));
  }
});

test("后置核验要求候选清零、保留数量不漂移且无孤儿或悬空关联", () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "已由负责人核实"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table.name === "AuditLog"
            ? { ...table, rows: [...table.rows, { id: "a2" }] }
            : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  assert.deepEqual(verifyPostcheck(before, after), { status: "passed" });
  assert.throws(
    () => verifyPostcheck(before, resignReport({ ...after, preservationCounts: { ...after.preservationCounts, Project: 0 } })),
    /后置核验失败/u
  );
  assert.throws(
    () => verifyPostcheck(before, resignReport({ ...after, schemaDigest: "0".repeat(64) })),
    /Schema digest/u
  );
  assert.throws(() => verifyPostcheck({}, after), /归零预检报告 SHA-256/u);
});

test("独立最终后置核验按执行前冻结对象代际清单拒绝同 key 复活", () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });

  assert.equal(before.objectDeletionManifest.length, 1);
  const frozen = before.objectDeletionManifest[0];
  assert.equal(frozen.objectKey, "uploads/f1.pdf");
  assert.equal(frozen.objectSnapshot.snapshotSha256, FILE_SNAPSHOT.snapshotSha256);
  assert.throws(
    () =>
      verifyPostcheck(before, after, undefined, undefined, {
        phase: "final",
        objectRescan: [
          {
            bucket: frozen.bucket,
            objectKey: frozen.objectKey,
            scopeSha256: frozen.scopeSha256,
            frozenSnapshotSha256: frozen.objectSnapshot.snapshotSha256,
            status: "present",
            observedGenerationCount: 1
          }
        ]
      }),
    /对象.*仍存在|对象.*重扫/u
  );
  assert.throws(
    () =>
      verifyPostcheck(before, after, undefined, undefined, { phase: "final" }),
    /对象.*重扫/u
  );
});

test("候选与保留记录绑定完整行哈希且同数量替换审计会失败关闭", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目必须原样保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  assert.match(
    before.deletionCandidates.find((item) => item.table === "Contract").rowSha256,
    /^[0-9a-f]{64}$/u
  );
  assert.ok(
    before.preservationAnchors.some(
      (item) => item.table === "AuditLog" && item.primaryKey.id === "a1"
    )
  );

  const replacedAudit = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table.name === "AuditLog"
            ? { ...table, rows: [{ id: "a2", action: "replacement" }] }
            : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  assert.throws(() => verifyPostcheck(before, replacedAudit), /保留记录/u);

  const driftedCandidate = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        table.name === "Contract"
          ? { ...table, rows: [{ id: "c1", status: "effective" }] }
          : table
      )
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:01:00.000Z"
  });
  await assert.rejects(
    () =>
      createDryRunReceipt({
        report: before,
        currentReport: driftedCandidate,
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /独立测试来源工件已漂移|状态指纹已漂移/u
  );
});

test("伪造文本 dump 与 tar 即使自报恢复通过也必须阻断", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-backup-test-"));
  try {
    const databasePath = path.join(temporaryRoot, "database.dump");
    const filesPath = path.join(temporaryRoot, "private-files.tar");
    const databaseContent = Buffer.from("database fixture", "utf8");
    const filesContent = Buffer.from("private files fixture", "utf8");
    await writeFile(databasePath, databaseContent);
    await writeFile(filesPath, filesContent);
    const receipt = backupReceipt({
      databaseBackup: {
        ...backupReceipt().databaseBackup,
        location: databasePath,
        sha256: createHash("sha256").update(databaseContent).digest("hex"),
        format: "postgresql_custom",
        restoreEvidence: {
          status: "passed",
          migrationCount: 125,
          migrationHead: "M125"
        }
      },
      privateFileBackup: {
        ...backupReceipt().privateFileBackup,
        location: filesPath,
        sha256: createHash("sha256").update(filesContent).digest("hex"),
        sourceObjects: [{ objectKey: "uploads/fixture", sha256: "1".repeat(64), sizeBytes: 7 }],
        restoreEvidence: {
          status: "passed",
          objects: [{ objectKey: "uploads/fixture", sha256: "1".repeat(64), sizeBytes: 7 }]
        }
      }
    });
    await assert.rejects(() => verifyBackupArtifacts(receipt), /PostgreSQL custom/u);
    const customHeader = Buffer.from("PGDMP fake payload", "utf8");
    await writeFile(databasePath, customHeader);
    receipt.databaseBackup.sha256 = createHash("sha256").update(customHeader).digest("hex");
    await assert.rejects(() => verifyBackupArtifacts(receipt), /tar 归档/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("运行身份拒绝脏工作树且 Docker 子进程只绑定已核验本机 endpoint", () => {
  assert.doesNotThrow(() => assertCleanNodeRuntime({ env: {}, execArgv: [] }));
  assert.throws(
    () => assertCleanNodeRuntime({ env: { NODE_OPTIONS: "--require=/tmp/forged.cjs" }, execArgv: [] }),
    /NODE_OPTIONS/u
  );
  assert.throws(
    () => assertCleanNodeRuntime({ env: { NODE_PATH: "/tmp/forged-modules" }, execArgv: [] }),
    /NODE_PATH/u
  );
  assert.throws(
    () => assertCleanNodeRuntime({ env: {}, execArgv: ["--loader=/tmp/forged.mjs"] }),
    /启动参数/u
  );
  assert.doesNotThrow(() => assertCleanRepositoryStatus(""));
  assert.throws(
    () => assertCleanRepositoryStatus(" M services/api/scripts/business-zeroing-core.cjs"),
    /未提交或未跟踪改动/u
  );
  const environment = createPinnedDockerEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/pol22-home",
      DOCKER_HOST: "tcp://remote.example:2375",
      DOCKER_CONTEXT: "remote-production",
      DATABASE_URL: "postgresql://production",
      COS_SECRET_KEY: "must-not-propagate"
    },
    "/tmp/pol22-runtime",
    "unix:///var/run/docker.sock"
  );
  assert.equal(environment.DOCKER_HOST, "unix:///var/run/docker.sock");
  assert.equal(environment.DOCKER_CONTEXT, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.COS_SECRET_KEY, undefined);
  const trustedIdentity = {
    schemaVersion: 1,
    environment: "isolated-pol22",
    deploymentId: "pol22-local-disposable",
    executorIdentity: "pol22-isolated-runner",
    executorUid: 501,
    executorUsername: "pol22",
    testProvenancePublicKeySha256:
      TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_SHA256,
    testProvenanceRegistrySha256: "6".repeat(64),
    writeFreezePublicKeySha256:
      TRUSTED_WRITE_FREEZE_PUBLIC_KEY_SHA256
  };
  assert.equal(
    validateTrustedExecutionIdentity(trustedIdentity, { uid: 501, username: "pol22" })
      .executorIdentity,
    "pol22-isolated-runner"
  );
  assert.throws(
    () => validateTrustedExecutionIdentity(trustedIdentity, { uid: 502, username: "pol22" }),
    /进程 UID/u
  );
});

test("隔离 PostgreSQL 必须同时通过容器内和宿主 Prisma 协议 readiness", async () => {
  const events = [];
  let hostAttempts = 0;
  await waitForPostgres("pol22-test-container", { DOCKER_HOST: "unix:///tmp/test.sock" }, {
    command: async (_binary, args) => {
      events.push(`container:${args.join(" ")}`);
    },
    connectFromHost: async (databaseUrl) => {
      hostAttempts += 1;
      events.push(`host:${databaseUrl}`);
      if (hostAttempts === 1) throw new Error("P1001");
    },
    databaseUrl: "postgresql://jiangkong:test@127.0.0.1:54321/jiangkong_pol22_zeroing_local",
    delay: async () => events.push("delay"),
    attempts: 2
  });
  assert.equal(hostAttempts, 2);
  assert.deepEqual(events, [
    "container:exec pol22-test-container pg_isready -U jiangkong -d jiangkong_pol22_zeroing_local",
    "host:postgresql://jiangkong:test@127.0.0.1:54321/jiangkong_pol22_zeroing_local",
    "delay",
    "container:exec pol22-test-container pg_isready -U jiangkong -d jiangkong_pol22_zeroing_local",
    "host:postgresql://jiangkong:test@127.0.0.1:54321/jiangkong_pol22_zeroing_local"
  ]);
});

test("动态 JSON 收据必须覆盖归属阻断且只在 cleanup 成功后输出", async () => {
  const completeReceipt = {
    mode: "isolated_postgresql16_and_local_private_files",
    status: "passed",
    migrationCount: 125,
    migrationHead: "20260811090000_contract_document_content_revision",
    productionAccessed: false,
    dryRunSteps: 4,
    executionSteps: {
      databaseRecordDeletes: 4,
      exactObjectDeletes: 1,
      numberRuleResets: 0,
      total: 5
    },
    formalRecordProtection: {
      status: "blocked",
      blockers: ["FORMAL_RECORD_PROTECTED", "FORMAL_AGGREGATE_CHILD_PROTECTED"],
      candidateCount: 0
    },
    unknownOwnershipBlockers: {
      status: "blocked",
      blockers: ["UNKNOWN_FILE_OWNER"],
      candidateCount: 0
    },
    mixedOwnershipBlockers: {
      status: "blocked",
      blockers: ["MIXED_FILE_OWNERSHIP"],
      candidateCount: 0
    },
    backupRestore: {
      database: {
        status: "passed",
        format: "postgresql_custom",
        restoreEvidence: {
          status: "passed",
          migrationCount: 125,
          migrationHead: "20260811090000_contract_document_content_revision"
        }
      },
      privateFiles: {
        status: "passed",
        sourceObjects: [
          { objectKey: "uploads/fixture", sha256: "1".repeat(64), sizeBytes: 7 }
        ],
        restoreEvidence: {
          status: "passed",
          objects: [
            { objectKey: "uploads/fixture", sha256: "1".repeat(64), sizeBytes: 7 }
          ]
        }
      },
      artifactsVerified: true
    }
  };
  await assert.rejects(
    () =>
      writeFinalDynamicReceipt(
        { ...completeReceipt, unknownOwnershipBlockers: undefined },
        { cleanup: async () => {}, write: () => {} }
      ),
    /unknown ownership/u
  );

  let cleanupCompleted = false;
  let output = "";
  await writeFinalDynamicReceipt(completeReceipt, {
    cleanup: async () => {
      cleanupCompleted = true;
    },
    write: (chunk) => {
      assert.equal(cleanupCompleted, true);
      output += chunk;
    }
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.containerRemoved, true);
  assert.equal(parsed.temporaryFilesRemoved, true);
  assert.deepEqual(parsed.unknownOwnershipBlockers.blockers, ["UNKNOWN_FILE_OWNER"]);
  assert.deepEqual(parsed.mixedOwnershipBlockers.blockers, ["MIXED_FILE_OWNERSHIP"]);

  let wroteAfterCleanupFailure = false;
  await assert.rejects(
    () =>
      writeFinalDynamicReceipt(completeReceipt, {
        cleanup: async () => {
          throw new Error("cleanup failed");
        },
        write: () => {
          wroteAfterCleanupFailure = true;
        }
      }),
    /cleanup failed/u
  );
  assert.equal(wroteAfterCleanupFailure, false);
});

test("动态混合归属夹具清理后保留行完整指纹不漂移", async () => {
  const preservedUser = {
    id: "00000000-0000-4000-8000-000000000001",
    signatureFileId: null,
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
  const before = sha256(preservedUser);
  const prisma = {
    async $executeRawUnsafe(sql, fileId, userId) {
      assert.match(sql, /SET "signatureFileId" = \$1 WHERE "id" = \$2/u);
      assert.doesNotMatch(sql, /updatedAt/u);
      assert.equal(userId, preservedUser.id);
      preservedUser.signatureFileId = fileId;
    }
  };
  await setFixtureSignatureBinding(
    prisma,
    "00000000-0000-4000-8000-000000000009"
  );
  await setFixtureSignatureBinding(prisma, null);
  assert.equal(sha256(preservedUser), before);
});

test("受信启动器在 Node preload 执行前拒绝污染且直接 CLI 入口保守阻断", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-launcher-"));
  const marker = path.join(temporaryRoot, "preload-executed");
  const preload = path.join(temporaryRoot, "preload.cjs");
  const sanitizedMarker = path.join(temporaryRoot, "sanitizing-preload-executed");
  const sanitizingPreload = path.join(temporaryRoot, "sanitizing-preload.cjs");
  const launcher = path.join(__dirname, "run-business-zeroing-cli.sh");
  const directEntries = [
    path.join(__dirname, "inspect-test-business-zeroing.cjs"),
    path.join(__dirname, "execute-test-business-zeroing.cjs"),
    path.join(__dirname, "verify-test-business-zeroing.cjs"),
    path.join(__dirname, "sign-business-zeroing-input.cjs"),
    path.join(__dirname, "../prisma/run-business-zeroing-local.cjs")
  ];
  try {
    assert.notEqual((await stat(launcher)).mode & 0o111, 0, "受信启动器必须可执行");
    await writeFile(
      preload,
      "require('node:fs').writeFileSync(process.env.POL22_PRELOAD_MARKER, 'executed');\n",
      "utf8"
    );
    await writeFile(
      sanitizingPreload,
      [
        "require('node:fs').writeFileSync(process.env.POL22_PRELOAD_MARKER, 'executed');",
        "delete process.env.NODE_OPTIONS;",
        "delete process.env.NODE_PATH;",
        "process.execArgv.length = 0;",
        "process.env.POL22_CLEAN_NODE_LAUNCH = '1';"
      ].join("\n"),
      "utf8"
    );
    for (const command of ["inspect", "execute", "verify", "sign", "dynamic"]) {
      const rejected = spawnSync(
        "/bin/sh",
        [launcher, command, "--help"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preload}`,
            POL22_PRELOAD_MARKER: marker
          }
        }
      );
      assert.equal(rejected.status, 64, `${command}: ${rejected.stderr}`);
      assert.match(rejected.stderr, /NODE_OPTIONS/u);
      await assert.rejects(() => stat(marker), /ENOENT/u);
    }

    const forgedLauncherMarker = spawnSync(
      process.execPath,
      ["--", directEntries[3], "--help"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${sanitizingPreload}`,
          POL22_PRELOAD_MARKER: sanitizedMarker
        }
      }
    );
    assert.notEqual(forgedLauncherMarker.status, 0);
    assert.match(forgedLauncherMarker.stderr, /直接 Node 入口已禁用/u);
    assert.equal(await readFile(sanitizedMarker, "utf8"), "executed");

    const cleanEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !["NODE_OPTIONS", "NODE_PATH", "POL22_CLEAN_NODE_LAUNCH"].includes(key)
      )
    );
    for (const directEntry of directEntries) {
      const direct = spawnSync(process.execPath, ["--", directEntry, "--help"], {
        encoding: "utf8",
        env: cleanEnvironment
      });
      assert.equal(direct.status, 1, directEntry);
      assert.match(direct.stderr, /直接 Node 入口已禁用/u);

      const required = spawnSync(
        process.execPath,
        [
          "-e",
          "delete process.env.NODE_OPTIONS;delete process.env.NODE_PATH;" +
            "process.execArgv.length=0;" +
            `const command=require(${JSON.stringify(directEntry)});` +
            "Promise.resolve(command.runMain()).catch((error)=>{" +
            "process.stderr.write(String(error && error.message || error));process.exitCode=1;});"
        ],
        { encoding: "utf8", env: cleanEnvironment }
      );
      assert.notEqual(required.status, 0, directEntry);
      assert.match(required.stderr, /受信启动器 capability|启动参数/u);
    }
    for (const [command, outputPattern] of [
      ["inspect", /默认只读预检/u],
      ["execute", /dry-run/u],
      ["verify", /只读后置核验/u],
      ["sign", /run-business-zeroing-cli\.sh sign/u],
      ["dynamic", /run-business-zeroing-cli\.sh dynamic/u]
    ]) {
      const accepted = spawnSync("/bin/sh", [launcher, command, "--help"], {
        encoding: "utf8",
        env: cleanEnvironment
      });
      assert.equal(accepted.status, 0, `${command}: ${accepted.stderr}`);
      assert.match(accepted.stdout, outputPattern);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("未指纹 node -e 不得伪造受信 launcher capability", () => {
  const cliLibrary = path.join(__dirname, "business-zeroing-cli.cjs");
  const signEntry = path.join(__dirname, "sign-business-zeroing-input.cjs");
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH"].includes(key))
  );
  const forged = spawnSync(
    process.execPath,
    [
      "-e",
      [
        "process.execArgv=[];",
        "process.argv[1]='-';",
        `const command=require(${JSON.stringify(signEntry)});`,
        `const {runTrustedCommand}=require(${JSON.stringify(cliLibrary)});`,
        "Promise.resolve(runTrustedCommand(command,{entrypoint:'synthetic',argv:['--help']}))",
        ".catch((error)=>{process.stderr.write(String(error&&error.message||error));process.exitCode=1;});"
      ].join("")
    ],
    { encoding: "utf8", env: cleanEnvironment }
  );
  assert.notEqual(forged.status, 0, forged.stdout);
  assert.doesNotMatch(forged.stdout, /run-business-zeroing-cli\.sh sign/u);

  const directCli = spawnSync(
    process.execPath,
    [cliLibrary, "sign", "--help"],
    { encoding: "utf8", env: cleanEnvironment }
  );
  assert.notEqual(directCli.status, 0, directCli.stdout);
  assert.doesNotMatch(directCli.stdout, /run-business-zeroing-cli\.sh sign/u);

  for (const forgedEnvironment of [
    {
      POL22_LAUNCHER_PARENT_PID: String(process.pid),
      POL22_LAUNCHER_CAPABILITY_FD: "9"
    },
    {
      POL22_LAUNCHER_PARENT_PID: "1",
      POL22_LAUNCHER_CAPABILITY_FD: "9"
    }
  ]) {
    const forgedFd = spawnSync(
      process.execPath,
      [cliLibrary, "sign", "--help"],
      {
        encoding: "utf8",
        env: { ...cleanEnvironment, ...forgedEnvironment },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    assert.notEqual(forgedFd.status, 0, forgedFd.stdout);
    assert.doesNotMatch(forgedFd.stdout, /run-business-zeroing-cli\.sh sign/u);
  }
});

test("require-cache monkeypatch 不得绕过受信 launcher capability", () => {
  for (const mutation of [
    "require(cliPath).assertTrustedLauncherCapability = () => {};",
    "require(cliPath); require.cache[cliPath].exports = {createTrustedEntrypoint:(main)=>main};"
  ]) {
    const script = [
      `const cliPath = require.resolve(${JSON.stringify(path.join(__dirname, "business-zeroing-cli.cjs"))});`,
      `const signPath = require.resolve(${JSON.stringify(path.join(__dirname, "sign-business-zeroing-input.cjs"))});`,
      mutation,
      "delete require.cache[signPath];",
      "const sign = require(signPath);",
      "Promise.resolve(sign.runMain()).catch((error) => {",
      "  process.stderr.write(String(error && error.message || error));",
      "  process.exitCode = 1;",
      "});"
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", script, "--", "--help"], {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !["NODE_OPTIONS", "NODE_PATH"].includes(key))
      )
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /受信启动器 capability/u);
    assert.doesNotMatch(result.stdout, /签发/u);
  }
});

test("受信启动器 capability 工件为 0600 且命令结束后无残留", async () => {
  const capabilityRoot = await mkdtemp(path.join(tmpdir(), "pol22-capability-root-"));
  try {
    const fakeBin = path.join(capabilityRoot, "bin");
    const modeOutput = path.join(tmpdir(), `pol22-capability-mode-${process.pid}`);
    await mkdir(fakeBin);
    const fakeNode = path.join(fakeBin, "node");
    await writeFile(
      fakeNode,
      "#!/bin/sh\nstat -f '%Lp' \"$POL22_LAUNCHER_CAPABILITY_PATH\" >\"$POL22_CAPABILITY_MODE_OUTPUT\"\n",
      "utf8"
    );
    await chmod(fakeNode, 0o700);
    const accepted = spawnSync(
      "/bin/sh",
      [path.join(__dirname, "run-business-zeroing-cli.sh"), "sign", "--help"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          TMPDIR: capabilityRoot,
          POL22_CAPABILITY_MODE_OUTPUT: modeOutput,
          NODE_OPTIONS: undefined,
          NODE_PATH: undefined
        }
      }
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal((await readFile(modeOutput, "utf8")).trim(), "600");
    assert.deepEqual(await readdir(capabilityRoot), ["bin"]);
    await rm(modeOutput, { force: true });
  } finally {
    await rm(capabilityRoot, { recursive: true, force: true });
  }
});

test("实际执行代码指纹拒绝 dist 符号链接与仓库外运行内容", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-code-hash-"));
  try {
    const dist = path.join(temporaryRoot, "dist");
    const outside = path.join(tmpdir(), `pol22-outside-${process.pid}.js`);
    await mkdir(dist, { recursive: true });
    await writeFile(outside, "module.exports = 'forged-success';\n", "utf8");
    await symlink(outside, path.join(dist, "adapter.js"));
    assert.throws(
      () => hashExecutionFiles(temporaryRoot, [], ["dist"]),
      /符号链接|普通文件|仓库内/u
    );
    await rm(path.join(dist, "adapter.js"));
    await rm(dist, { recursive: true });
    const outsideDirectory = path.join(temporaryRoot, "outside-dist");
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, dist, "dir");
    assert.throws(
      () => hashExecutionFiles(temporaryRoot, [], ["dist"]),
      /符号链接|普通目录|仓库内/u
    );
    await rm(outside, { force: true });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("实际执行指纹绑定 Node、Prisma generated client、query engine 与依赖字节", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-runtime-hash-"));
  try {
    const nodeExecutable = path.join(temporaryRoot, "node");
    const prismaClient = path.join(temporaryRoot, "@prisma-client");
    const generatedClient = path.join(temporaryRoot, "generated-client");
    const runtimeDependency = path.join(temporaryRoot, "@nestjs-common");
    await writeFile(nodeExecutable, "node-runtime-v1", "utf8");
    await mkdir(path.join(prismaClient, "runtime"), { recursive: true });
    await mkdir(generatedClient, { recursive: true });
    await mkdir(runtimeDependency, { recursive: true });
    await writeFile(path.join(prismaClient, "runtime", "library.js"), "runtime-v1", "utf8");
    await writeFile(path.join(generatedClient, "index.js"), "generated-v1", "utf8");
    const dependencyEntrypoint = path.join(runtimeDependency, "index.js");
    await writeFile(dependencyEntrypoint, "dependency-v1", "utf8");
    const engine = path.join(generatedClient, "libquery_engine.fixture.node");
    await writeFile(engine, "engine-v1", "utf8");
    const inputs = {
      nodeExecutable,
      prismaClientDirectory: prismaClient,
      generatedClientDirectory: generatedClient,
      dependencyDirectories: [runtimeDependency]
    };
    const before = hashRuntimeExecutionFiles(inputs);
    await writeFile(dependencyEntrypoint, "dependency-tampered", "utf8");
    assert.notEqual(hashRuntimeExecutionFiles(inputs), before);
    await writeFile(dependencyEntrypoint, "dependency-v1", "utf8");
    await writeFile(engine, "engine-tampered", "utf8");
    assert.notEqual(hashRuntimeExecutionFiles(inputs), before);
    await rm(nodeExecutable);
    await symlink(path.join(prismaClient, "runtime", "library.js"), nodeExecutable);
    assert.throws(() => hashRuntimeExecutionFiles(inputs), /Node.*符号链接/u);
    assert.throws(
      () =>
        hashRuntimeExecutionFiles({
          ...inputs,
          nodeExecutable: path.join(temporaryRoot, "missing-required-runtime")
        }),
      /ENOENT|缺失/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("真实加载依赖闭包不包含 manifest-only 包且递归依赖仍纳入", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-runtime-closure-"));
  try {
    const entrypoint = path.join(temporaryRoot, "entry.cjs");
    const loadedDirectory = path.join(temporaryRoot, "node_modules", "loaded-package");
    const childDirectory = path.join(temporaryRoot, "node_modules", "child-package");
    const unusedDirectory = path.join(temporaryRoot, "node_modules", "manifest-only");
    for (const [directory, name, source] of [
      [loadedDirectory, "loaded-package", "module.exports = require('child-package');\n"],
      [childDirectory, "child-package", "module.exports = 'child';\n"],
      [unusedDirectory, "manifest-only", "module.exports = 'unused';\n"]
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          main: "index.js",
          ...(name === "loaded-package"
            ? { dependencies: { "child-package": "1.0.0" } }
            : {})
        }),
        "utf8"
      );
      await writeFile(path.join(directory, "index.js"), source, "utf8");
    }
    await writeFile(entrypoint, "require('loaded-package');\n", "utf8");

    const closure = resolveRuntimeDependencyClosure([entrypoint], [temporaryRoot]);
    assert.deepEqual(
      closure.map((directory) => path.basename(directory)).sort(),
      ["child-package", "loaded-package"]
    );
    const runtimeInputs = {
      nodeExecutable: process.execPath,
      prismaClientDirectory: loadedDirectory,
      generatedClientDirectory: childDirectory,
      dependencyDirectories: closure
    };
    const before = hashRuntimeExecutionFiles(runtimeInputs);
    await writeFile(path.join(unusedDirectory, "index.js"), "module.exports='changed';\n", "utf8");
    assert.equal(hashRuntimeExecutionFiles(runtimeInputs), before);
    await writeFile(path.join(childDirectory, "index.js"), "module.exports='changed';\n", "utf8");
    assert.notEqual(hashRuntimeExecutionFiles(runtimeInputs), before);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("当前真实运行依赖闭包可生成不可变指纹", () => {
  const actual = resolveRuntimeExecutionFiles();
  assert.ok(
    actual.dependencyDirectories.some((directory) =>
      /(?:^|\/)@nestjs\/common$/u.test(directory)
    )
  );
  assert.ok(
    actual.dependencyDirectories.some((directory) =>
      /(?:^|\/)@jiangkong\/shared-domain$/u.test(directory) ||
      /(?:^|\/)packages\/shared-domain$/u.test(directory)
    )
  );
  assert.match(hashRuntimeExecutionFiles(), /^[0-9a-f]{64}$/u);
});

test("manifest-only 包可按真实依赖目录定位，必需依赖缺失仍失败关闭", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-manifest-only-"));
  const parentDirectory = path.join(temporaryRoot, "node_modules", "parent-package");
  const manifestOnlyDirectory = path.join(
    temporaryRoot,
    "node_modules",
    "manifest-only"
  );
  try {
    await mkdir(parentDirectory, { recursive: true });
    await mkdir(manifestOnlyDirectory, { recursive: true });
    await writeFile(
      path.join(manifestOnlyDirectory, "package.json"),
      JSON.stringify({ name: "manifest-only", version: "1.0.0" }),
      "utf8"
    );
    assert.equal(
      locateRuntimePackage("manifest-only", [parentDirectory], true).directory,
      await realpath(manifestOnlyDirectory)
    );
    assert.throws(
      () => locateRuntimePackage("missing-required-runtime", [parentDirectory], true),
      /必需实际运行依赖缺失/u
    );
    assert.equal(
      locateRuntimePackage("missing-optional-runtime", [parentDirectory], false),
      null
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("独立后置核验要求数据库存在与执行收据精确绑定的完成审计", async () => {
  const receipt = {
    batchId: "pol22-isolated-001",
    environment: "isolated-pol22",
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    reportSha256: "1".repeat(64),
    candidateSha256: "2".repeat(64),
    authorization: {
      authorizationRef: "Issue #122 independent authorization",
      publicKeySha256: "3".repeat(64),
      payloadSha256: "4".repeat(64)
    },
    receiptSha256: "5".repeat(64)
  };
  const metadata = {
    status: "terminal_committed",
    postcheck: { status: "passed" },
    environment: receipt.environment,
    codeSha: receipt.codeSha,
    executionCodeSha256: receipt.executionCodeSha256,
    deploymentIdentitySha256: receipt.deploymentIdentitySha256,
    executorIdentity: receipt.executorIdentity,
    reportSha256: receipt.reportSha256,
    candidateSha256: receipt.candidateSha256,
    authorizationRef: receipt.authorization.authorizationRef,
    authorizationPublicKeySha256: receipt.authorization.publicKeySha256,
    authorizationPayloadSha256: receipt.authorization.payloadSha256,
    receiptSha256: receipt.receiptSha256,
    executionReceipt: receipt,
    terminalCommitSha256: sha256({
      batchId: receipt.batchId,
      reportSha256: receipt.reportSha256,
      candidateSha256: receipt.candidateSha256,
      receiptSha256: receipt.receiptSha256,
      writeFreezeLeaseEnvelopeSha256:
        receipt.writeFreezeLeaseEnvelopeSha256,
      fenceToken: receipt.writeFreezeLease?.fenceToken,
      generation: receipt.writeFreezeLease?.generation
    })
  };
  const completedMetadata = { ...metadata, status: "completed" };
  const client = {
    async $queryRawUnsafe(_sql, action) {
      return [{
        metadata:
          action === "test_business_zeroing.controlled_execution"
            ? completedMetadata
            : metadata
      }];
    }
  };
  assert.deepEqual(await verifyBusinessZeroingExecutionAudit(client, receipt), {
    status: "passed"
  });
  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        { async $queryRawUnsafe() { return []; } },
        receipt
      ),
    /completed 审计必须精确一条/u
  );
  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        {
          async $queryRawUnsafe(_sql, action) {
            return [{
              metadata: {
                ...(action === "test_business_zeroing.controlled_execution"
                  ? completedMetadata
                  : metadata),
                executionReceipt: { ...receipt, status: "forged" }
              }
            }];
          }
        },
        receipt
    ),
    /完整最终执行收据/u
  );
  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        {
          async $queryRawUnsafe(_sql, action) {
            return [{
              metadata:
                action === "test_business_zeroing.controlled_execution"
                  ? completedMetadata
                  : { status: "failed_after_database_commit" }
            }];
          }
        },
        receipt
      ),
    /权威终态完成标记/u
  );
});

test("后置审计要求 completed 与 terminal marker 各精确一条", async () => {
  const receipt = {
    batchId: "pol22-isolated-unique",
    environment: "isolated-pol22",
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    reportSha256: "1".repeat(64),
    candidateSha256: "2".repeat(64),
    authorization: {
      authorizationRef: "Issue #122 independent authorization",
      publicKeySha256: "3".repeat(64),
      payloadSha256: "4".repeat(64)
    },
    receiptSha256: "5".repeat(64)
  };
  const queries = [];
  const client = {
    $queryRawUnsafe: async (sql, action, businessType, businessId, status) => {
      queries.push({ sql, action, businessType, businessId, status });
      return [];
    }
  };
  await assert.rejects(
    () => verifyBusinessZeroingExecutionAudit(client, receipt),
    /completed/u
  );
  assert.equal(queries.length, 2);
  assert.ok(
    queries.every(
      ({ sql, businessType, businessId }) =>
        !/LIMIT 1/u.test(sql) &&
        /"metadata"->>'status' = \$4/u.test(sql) &&
        businessType === "test_business_zeroing" &&
        businessId === receipt.batchId
    )
  );
  assert.deepEqual(
    queries.map(({ action, status }) => ({ action, status })),
    [
      {
        action: "test_business_zeroing.controlled_execution",
        status: "completed"
      },
      {
        action: "test_business_zeroing.terminal_commit",
        status: "terminal_committed"
      }
    ]
  );
});

test("终态提交不把合法阶段审计误判为 completed 或 terminal_committed", async () => {
  const batchId = "pol22-stage-audits-only";
  const existingEvents = [
    "started",
    "object_recovery_planned",
    "object_deletion_progress",
    "completion_pending"
  ].map((status, index) => ({
    id: `stage-${index}`,
    action: "test_business_zeroing.controlled_execution",
    businessType: "test_business_zeroing",
    businessId: batchId,
    status
  }));
  existingEvents.push({
    id: "non-terminal-marker",
    action: "test_business_zeroing.terminal_commit",
    businessType: "test_business_zeroing",
    businessId: batchId,
    status: "completion_pending"
  });
  assert.equal(
    existingEvents.filter(
      (event) =>
        event.action === "test_business_zeroing.controlled_execution" &&
        event.status === "completed"
    ).length,
    0
  );
  assert.equal(
    existingEvents.filter(
      (event) =>
        event.action === "test_business_zeroing.terminal_commit" &&
        event.status === "terminal_committed"
    ).length,
    0
  );

  const calls = [];
  const insertedEvents = [];
  const transactionClient = {
    async $queryRawUnsafe(sql, ...values) {
      if (/pg_advisory_xact_lock/u.test(sql)) {
        calls.push("lock");
        return [{ locked: true }];
      }
      if (/SELECT "id" FROM "AuditLog"/u.test(sql)) {
        const [action, businessType, businessId, status] = values;
        calls.push(["guard", action, status ?? null]);
        return existingEvents
          .filter(
            (event) =>
              event.action === action &&
              event.businessType === businessType &&
              event.businessId === businessId &&
              (!/"metadata"->>'status' = \$4/u.test(sql) || event.status === status)
          )
          .map((event) => ({ id: event.id }));
      }
      if (/INSERT INTO "AuditLog"/u.test(sql)) {
        const event = JSON.parse(values[4]);
        insertedEvents.push(event);
        calls.push(["insert", event.status]);
        return [];
      }
      throw new Error(`未处理 SQL：${sql}`);
    }
  };
  const database = createBusinessZeroingDatabase(
    {
      async $transaction(work) {
        return work(transactionClient);
      }
    },
    BUSINESS_ZEROING_POLICY
  );

  await database.commitTerminalAudit({
    event: { batchId, status: "completed" },
    verifyLease: async () => calls.push("lease")
  });

  assert.deepEqual(
    insertedEvents.map((event) => event.status),
    ["completed", "terminal_committed"]
  );
  assert.deepEqual(calls, [
    "lock",
    ["guard", "test_business_zeroing.controlled_execution", "completed"],
    ["guard", "test_business_zeroing.terminal_commit", "terminal_committed"],
    ["insert", "completed"],
    ["insert", "terminal_committed"],
    "lease"
  ]);
});

test("终态提交遇到预存 completed 且无 terminal 时必须回滚", async () => {
  const insertedEvents = [];
  const transactionClient = {
    async $queryRawUnsafe(sql, ...values) {
      if (/pg_advisory_xact_lock/u.test(sql)) return [{ locked: true }];
      if (/SELECT "id" FROM "AuditLog"/u.test(sql)) {
        return values[0] === "test_business_zeroing.controlled_execution"
          ? [{ id: "existing-completed" }]
          : [];
      }
      if (/INSERT INTO "AuditLog"/u.test(sql)) {
        insertedEvents.push(JSON.parse(values[4]));
        return [];
      }
      throw new Error(`未处理 SQL：${sql}`);
    }
  };
  const database = createBusinessZeroingDatabase(
    {
      async $transaction(work) {
        return work(transactionClient);
      }
    },
    BUSINESS_ZEROING_POLICY
  );

  await assert.rejects(
    () =>
      database.commitTerminalAudit({
        event: { batchId: "pol22-existing-completed", status: "completed" },
        verifyLease: async () => undefined
      }),
    /completed.*已存在/u
  );
  assert.deepEqual(insertedEvents, []);
});

test("终态提交遇到预存 terminal_committed 且无 completed 时必须回滚", async () => {
  const insertedEvents = [];
  const transactionClient = {
    async $queryRawUnsafe(sql, ...values) {
      if (/pg_advisory_xact_lock/u.test(sql)) return [{ locked: true }];
      if (/SELECT "id" FROM "AuditLog"/u.test(sql)) {
        return values[0] === "test_business_zeroing.terminal_commit" &&
          values[3] === "terminal_committed"
          ? [{ id: "existing-terminal" }]
          : [];
      }
      if (/INSERT INTO "AuditLog"/u.test(sql)) {
        insertedEvents.push(JSON.parse(values[4]));
        return [];
      }
      throw new Error(`未处理 SQL：${sql}`);
    }
  };
  const database = createBusinessZeroingDatabase(
    {
      async $transaction(work) {
        return work(transactionClient);
      }
    },
    BUSINESS_ZEROING_POLICY
  );

  await assert.rejects(
    () =>
      database.commitTerminalAudit({
        event: { batchId: "pol22-existing-terminal", status: "completed" },
        verifyLease: async () => undefined
      }),
    /权威终态.*已存在/u
  );
  assert.deepEqual(insertedEvents, []);
});

test("受控输出必须预先独占预留且以 0600 落盘", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-output-test-"));
  try {
    const outputPath = path.join(temporaryRoot, "execution-receipt.json");
    const reserved = reserveJsonOutput(outputPath);
    assert.throws(() => reserveJsonOutput(outputPath), /无法安全独占预留/u);
    reserved.write({ status: "completed" });
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), { status: "completed" });
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("本地精确对象在内容或时间漂移后拒绝删除", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-object-test-"));
  const previous = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    FILE_STORAGE_DRIVER: process.env.FILE_STORAGE_DRIVER,
    COS_BUCKET: process.env.COS_BUCKET
  };
  try {
    process.env.FILE_STORAGE_ROOT = temporaryRoot;
    delete process.env.FILE_STORAGE_DRIVER;
    delete process.env.COS_BUCKET;
    const objectKey = "uploads/exact-fixture.pdf";
    const target = path.join(temporaryRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "fixture", "utf8");
    const storage = createExactObjectStorage();
    const snapshot = await storage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const changedTime = new Date(new Date(snapshot.lastModified).getTime() + 2_000);
    await utimes(target, changedTime, changedTime);
    await assert.rejects(
      () => storage.deleteExactObject({ bucket: "private-local", objectKey, expectedSnapshot: snapshot }),
      /内容已漂移/u
    );
    assert.equal((await stat(target)).isFile(), true);
    const freshSnapshot = await storage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const result = await storage.deleteExactObject({
      bucket: "private-local",
      objectKey,
      expectedSnapshot: freshSnapshot,
      persistRecoveryDisposition: async () => {}
    });
    await assert.rejects(() => stat(target), /ENOENT/u);
    assert.equal(result.status, "object_key_removed_recovery_artifact_retained");
    assert.equal(
      readFileSync(path.join(temporaryRoot, result.quarantineObjectKey), "utf8"),
      "fixture"
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("本地精确对象比较后被替换时原子隔离验证拒绝误删新内容", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-object-race-test-"));
  const previous = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    FILE_STORAGE_DRIVER: process.env.FILE_STORAGE_DRIVER,
    COS_BUCKET: process.env.COS_BUCKET
  };
  try {
    process.env.FILE_STORAGE_ROOT = temporaryRoot;
    delete process.env.FILE_STORAGE_DRIVER;
    delete process.env.COS_BUCKET;
    const objectKey = "uploads/race-fixture.pdf";
    const target = path.join(temporaryRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "approved", "utf8");
    const inspectingStorage = createExactObjectStorage();
    const snapshot = await inspectingStorage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const deletingStorage = createExactObjectStorage({
      beforeLocalQuarantine: async () => writeFile(target, "new-content", "utf8")
    });
    await assert.rejects(
      () =>
        deletingStorage.deleteExactObject({
          bucket: "private-local",
          objectKey,
          expectedSnapshot: snapshot,
          persistRecoveryDisposition: async () => {}
        }),
      /原子隔离对象.*漂移/u
    );
    assert.equal(readFileSync(target, "utf8"), "new-content");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("本地精确对象被同内容同时间的新 inode 替换时仍拒绝删除", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-object-inode-race-test-"));
  const previous = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    FILE_STORAGE_DRIVER: process.env.FILE_STORAGE_DRIVER,
    COS_BUCKET: process.env.COS_BUCKET
  };
  try {
    process.env.FILE_STORAGE_ROOT = temporaryRoot;
    delete process.env.FILE_STORAGE_DRIVER;
    delete process.env.COS_BUCKET;
    const objectKey = "uploads/inode-race-fixture.pdf";
    const target = path.join(temporaryRoot, objectKey);
    const displaced = `${target}.displaced`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "approved", "utf8");
    const inspectingStorage = createExactObjectStorage();
    const snapshot = await inspectingStorage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const deletingStorage = createExactObjectStorage({
      beforeLocalQuarantine: async () => {
        await rename(target, displaced);
        await writeFile(target, "approved", "utf8");
        const approvedTime = new Date(snapshot.lastModified);
        await utimes(target, approvedTime, approvedTime);
      }
    });
    await assert.rejects(
      () =>
        deletingStorage.deleteExactObject({
          bucket: "private-local",
          objectKey,
          expectedSnapshot: snapshot,
          persistRecoveryDisposition: async () => {}
        }),
      /原子隔离对象.*漂移/u
    );
    assert.equal(readFileSync(target, "utf8"), "approved");
    assert.equal(readFileSync(displaced, "utf8"), "approved");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("本地对象旧 FD 在隔离后写入时不会被物理删除", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-object-fd-race-test-"));
  const previous = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    FILE_STORAGE_DRIVER: process.env.FILE_STORAGE_DRIVER,
    COS_BUCKET: process.env.COS_BUCKET
  };
  let writer;
  try {
    process.env.FILE_STORAGE_ROOT = temporaryRoot;
    delete process.env.FILE_STORAGE_DRIVER;
    delete process.env.COS_BUCKET;
    const objectKey = "uploads/fd-race-fixture.pdf";
    const target = path.join(temporaryRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "approved", "utf8");
    writer = await open(target, "r+");
    const storage = createExactObjectStorage();
    const snapshot = await storage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const result = await storage.deleteExactObject({
      bucket: "private-local",
      objectKey,
      expectedSnapshot: snapshot,
      persistRecoveryDisposition: async () => {}
    });
    await writer.truncate(0);
    await writer.writeFile("written-after-quarantine", "utf8");
    await writer.sync();
    await writer.close();
    writer = undefined;
    assert.equal(result.status, "object_key_removed_recovery_artifact_retained");
    await assert.rejects(() => stat(target), /ENOENT/u);
    assert.equal(
      readFileSync(path.join(temporaryRoot, result.quarantineObjectKey), "utf8"),
      "written-after-quarantine"
    );
    assert.deepEqual(
      (await readdir(path.dirname(target))).filter((name) => name.includes(".quarantine")),
      [path.basename(result.quarantineObjectKey)]
    );
  } finally {
    await writer?.close().catch(() => undefined);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("本地 quarantine rename 后异常仍保留预写的 typed recovery disposition", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pol22-quarantine-recovery-"));
  const previous = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    FILE_STORAGE_DRIVER: process.env.FILE_STORAGE_DRIVER,
    COS_BUCKET: process.env.COS_BUCKET
  };
  try {
    process.env.FILE_STORAGE_ROOT = temporaryRoot;
    delete process.env.FILE_STORAGE_DRIVER;
    delete process.env.COS_BUCKET;
    const objectKey = "uploads/recovery-fixture.pdf";
    const target = path.join(temporaryRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "approved", "utf8");
    const storage = createExactObjectStorage({
      afterLocalQuarantineVerified: async () => {
        throw new Error("isolated crash after rename");
      }
    });
    const snapshot = await storage.inspectExactObject({
      bucket: "private-local",
      objectKey,
      maxModifiedAt: new Date(Date.now() + 60_000).toISOString()
    });
    const recovery = [];

    await assert.rejects(
      () =>
        storage.deleteExactObject({
          bucket: "private-local",
          objectKey,
          expectedSnapshot: snapshot,
          persistRecoveryDisposition: async (disposition) => {
            recovery.push(disposition);
          }
        }),
      /isolated crash after rename/u
    );
    assert.equal(recovery.length, 1);
    assert.deepEqual(
      Object.keys(recovery[0]).sort(),
      ["kind", "objectKey", "quarantineObjectKey", "status"].sort()
    );
    assert.equal(recovery[0].status, "quarantine_planned");
    assert.equal(
      readFileSync(path.join(temporaryRoot, recovery[0].quarantineObjectKey), "utf8"),
      "approved"
    );
    await assert.rejects(() => stat(target), /ENOENT/u);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("COS 最终精确重扫拒绝删除后出现的新版本或删除标记", async () => {
  const previousBucket = process.env.COS_BUCKET;
  process.env.COS_BUCKET = "isolated-private-cos";
  const frozenBody = {
    kind: "cos_versions",
    versions: [
      {
        versionId: "fixture-v1",
        isDeleteMarker: false,
        isLatest: true,
        lastModified: "2026-08-13T00:00:00.000Z",
        sizeBytes: 7
      }
    ]
  };
  try {
    const storage = createExactObjectStorage({
      versionedStorage: {
        async retry(operation) { return operation(); },
        client: {
          async listObjectVersions() {
            return [
              {
                versionId: "resurrected-v2",
                isDeleteMarker: false,
                isLatest: true,
                lastModified: "2026-08-13T01:20:00.000Z",
                sizeBytes: 9
              }
            ];
          },
          async isConverged() { return false; }
        }
      }
    });
    await assert.rejects(
      () =>
        storage.inspectExactObjectAbsence({
          bucket: "isolated-private-cos",
          objectKey: "uploads/resurrected.pdf",
          expectedSnapshot: {
            ...frozenBody,
            snapshotSha256: sha256(frozenBody)
          }
        }),
      /新版本或删除标记/u
    );
  } finally {
    if (previousBucket === undefined) delete process.env.COS_BUCKET;
    else process.env.COS_BUCKET = previousBucket;
  }
});

test("只有后置核验可接受已明确删除的基础资料主键消失", () => {
  const manifest = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "delete",
      reason: "已确认为隔离测试基础资料"
    }
  ]);
  const emptied = inventory({
    tables: inventory().tables.map((table) =>
      ["Project", "Contract", "FileObject"].includes(table.name)
        ? { ...table, rows: [] }
        : table
    ),
    fileBindings: []
  });
  const regular = buildPreflightReport({
    policy: smallPolicy,
    inventory: emptied,
    decisions: manifest,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z"
  });
  const postcheck = buildPreflightReport({
    policy: smallPolicy,
    inventory: emptied,
    decisions: manifest,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });

  assert.equal(regular.status, "blocked");
  assert.ok(regular.blockers.some((item) => item.code === "INVALID_DECISION_MANIFEST"));
  assert.equal(postcheck.status, "ready");
  assert.deepEqual(postcheck.deletionCandidates, []);
});

test("dry-run 只返回逐主键步骤且不调用数据库或文件写接口", async () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const calls = [];
  const receipt = await createDryRunReceipt({
    report,
    currentReport: report,
    now: new Date("2026-08-13T01:05:00.000Z"),
    onWrite: () => calls.push("write")
  });

  assert.equal(receipt.mode, "dry_run");
  assert.equal(receipt.executed, false);
  assert.deepEqual(
    receipt.steps.map((step) => [step.table, step.primaryKey]),
    [
      ["Contract", { id: "c1" }],
      ["FileObject", { id: "f1" }]
    ]
  );
  assert.deepEqual(calls, []);
});

test("dry-run 对已过期的预检报告 fail-closed", async () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });

  await assert.rejects(
    () =>
      createDryRunReceipt({
        report,
        currentReport: report,
        now: new Date("2026-08-13T01:31:00.000Z")
      }),
    /预检报告已过期/u
  );
});

test("受控执行只向适配器传递锁内复核过的逐主键和精确对象键", async () => {
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table
      ),
      fileBindings: []
    }),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  const calls = [];
  const database = {
    async transaction(work) {
      calls.push("transaction:start");
      const result = await work({
        async appendAudit(event) {
          calls.push(["audit", event.status]);
        },
        async deleteExactRecord(item) {
          calls.push(["delete", item.table, item.primaryKey]);
          return 1;
        }
      });
      calls.push("transaction:commit");
      return result;
    },
    async appendAudit(event) {
      calls.push(["audit", event.status]);
    }
  };
  const storage = {
    async deleteExactObject(input) {
      calls.push(["object", input.bucket, input.objectKey]);
      return {
        kind: "local_quarantine",
        status: "object_key_removed_recovery_artifact_retained",
        objectKey: input.objectKey,
        quarantineObjectKey: "uploads/.f1.pol22-fixture.quarantine"
      };
    },
    async inspectExactObjectAbsence(input) {
      calls.push(["object-rescan", input.bucket, input.objectKey]);
      return { status: "absent", observedGenerationCount: 0 };
    }
  };
  const args = controlledArgs(before);
  const receipt = await executeBusinessZeroing({
    args,
    report: before,
    database: withTerminalAuditCommit(database),
    storage,
    buildLockedReport: async () => before,
    buildLockedPostcheckReport: async () => after,
    buildPostcheckReport: async () => after,
    persistReceipt: async () => {},
    verifyWriteFreezeLease: createWriteFreezeVerifier(),
    now: new Date("2026-08-13T01:05:00.000Z")
  });

  assert.equal(receipt.status, "completed");
  assert.deepEqual(validateExecutionReceipt(receipt, before, AUTHORIZATION_KEYS.publicKey, WRITE_FREEZE_KEYS.publicKey), {
    status: "passed",
    receiptSha256: receipt.receiptSha256
  });
  const reorderedAuthorization = Object.fromEntries(
    Object.entries(receipt.authorization).reverse()
  );
  const reorderedReceiptBody = {
    ...Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256")),
    authorization: reorderedAuthorization
  };
  assert.deepEqual(
    validateExecutionReceipt(
      { ...reorderedReceiptBody, receiptSha256: sha256(reorderedReceiptBody) },
      before,
      AUTHORIZATION_KEYS.publicKey,
      WRITE_FREEZE_KEYS.publicKey
    ),
    { status: "passed", receiptSha256: sha256(reorderedReceiptBody) }
  );
  assert.throws(
    () =>
      validateExecutionReceipt(
        { ...receipt, candidateSha256: "0".repeat(64) },
        before,
        AUTHORIZATION_KEYS.publicKey,
        WRITE_FREEZE_KEYS.publicKey
      ),
    /执行收据 SHA-256/u
  );
  const forgedReceiptBody = {
    ...Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256")),
    authorizationEnvelope: {
      ...receipt.authorizationEnvelope,
      signature: Buffer.alloc(64).toString("base64")
    }
  };
  assert.throws(
    () =>
      validateExecutionReceipt(
        { ...forgedReceiptBody, receiptSha256: sha256(forgedReceiptBody) },
        before,
        AUTHORIZATION_KEYS.publicKey,
        WRITE_FREEZE_KEYS.publicKey
      ),
    /独立授权签名/u
  );
  const forgedLeaseBody = {
    ...Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256")),
    writeFreezeLeaseEnvelope: {
      ...receipt.writeFreezeLeaseEnvelope,
      signature: Buffer.alloc(64).toString("base64")
    }
  };
  assert.throws(
    () =>
      validateExecutionReceipt(
        { ...forgedLeaseBody, receiptSha256: sha256(forgedLeaseBody) },
        before,
        AUTHORIZATION_KEYS.publicKey,
        WRITE_FREEZE_KEYS.publicKey
      ),
    /写冻结租约签名/u
  );
  const semanticallyForgedBody = {
    ...Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256")),
    deletedRecordCount: 0,
    deletedObjectCount: 0,
    resetNumberRuleCount: 999,
    objectDispositions: []
  };
  assert.throws(
    () =>
      validateExecutionReceipt(
        {
          ...semanticallyForgedBody,
          receiptSha256: sha256(semanticallyForgedBody)
        },
        before,
        AUTHORIZATION_KEYS.publicKey,
        WRITE_FREEZE_KEYS.publicKey
      ),
    /删除记录数量|对象删除数量|编号复位数量|disposition/u
  );
  assert.deepEqual(calls, [
    "transaction:start",
    ["audit", "started"],
    ["delete", "Contract", { id: "c1" }],
    ["delete", "FileObject", { id: "f1" }],
    "transaction:commit",
    ["object", "private", "uploads/f1.pdf"],
    ["audit", "object_deletion_progress"],
    ["object-rescan", "private", "uploads/f1.pdf"],
    ["audit", "completion_pending"],
    ["audit", "terminal_committed"]
  ]);

  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args,
        report: before,
        database: withTerminalAuditCommit({
          async transaction(work) {
            return work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit() {}
        }),
        storage: { async deleteExactObject() {} },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => after,
        buildPostcheckReport: async () => after,
        persistReceipt: async () => {},
        verifyWriteFreezeLease: createWriteFreezeVerifier(),
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /未返回明确成功结果/u
  );
});

test("完成审计写失败时完整收据仍先落已预留介质", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table.name === "AuditLog"
            ? { ...table, rows: [...table.rows, { id: "started-audit" }] }
            : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  let persistedReceipt;
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(before),
        report: before,
        database: withTerminalAuditCommit({
          async transaction(work) {
            return work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit(event) {
            if (event.status === "terminal_committed") {
              throw new Error("isolated completed audit failure");
            }
          }
        }),
        storage: {
          async deleteExactObject(input) {
            return {
              kind: "local_quarantine",
              status: "object_key_removed_recovery_artifact_retained",
              objectKey: input.objectKey,
              quarantineObjectKey: "uploads/.f1.pol22-fixture.quarantine"
            };
          },
          async inspectExactObjectAbsence() {
            return { status: "absent", observedGenerationCount: 0 };
          }
        },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => after,
        buildPostcheckReport: async () => after,
        persistReceipt: async (receipt) => { persistedReceipt = receipt; },
        verifyWriteFreezeLease: createWriteFreezeVerifier(),
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /completed audit failure/u
  );
  assert.equal(persistedReceipt.status, "failed_after_database_commit");
  assert.equal(persistedReceipt.completed, false);
  assert.throws(
    () =>
      validateExecutionReceipt(
        persistedReceipt,
        before,
        AUTHORIZATION_KEYS.publicKey,
        WRITE_FREEZE_KEYS.publicKey
      ),
    /未证明受控执行完成|完整字段|未完成/u
  );
});

test("终态 lease 失败且降级写失败时未权威提交的 completed 不可验收", async () => {
  const receipt = {
    batchId: "pol22-isolated-terminal-failure",
    environment: "isolated-pol22",
    codeSha: SHA_40,
    executionCodeSha256: EXECUTION_SHA_64,
    deploymentIdentitySha256: DEPLOYMENT_SHA_64,
    executorIdentity: EXECUTOR_IDENTITY,
    reportSha256: "1".repeat(64),
    candidateSha256: "2".repeat(64),
    authorization: {
      authorizationRef: "Issue #122 independent authorization",
      publicKeySha256: "3".repeat(64),
      payloadSha256: "4".repeat(64)
    },
    receiptSha256: "5".repeat(64)
  };
  const uncommittedCompleted = {
    status: "completed",
    postcheck: { status: "passed" },
    environment: receipt.environment,
    codeSha: receipt.codeSha,
    executionCodeSha256: receipt.executionCodeSha256,
    deploymentIdentitySha256: receipt.deploymentIdentitySha256,
    executorIdentity: receipt.executorIdentity,
    reportSha256: receipt.reportSha256,
    candidateSha256: receipt.candidateSha256,
    authorizationRef: receipt.authorization.authorizationRef,
    authorizationPublicKeySha256: receipt.authorization.publicKeySha256,
    authorizationPayloadSha256: receipt.authorization.payloadSha256,
    receiptSha256: receipt.receiptSha256,
    executionReceipt: receipt
  };

  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        { async $queryRawUnsafe() { return [{ metadata: uncommittedCompleted }]; } },
        receipt
      ),
    /权威终态|完成标记/u
  );
});

test("对象部分删除后失败会耐久记录已完成 disposition 与未完成范围", async () => {
  const secondSnapshotBody = { ...FILE_SNAPSHOT_BODY, inodeId: 3 };
  const secondSnapshot = {
    ...secondSnapshotBody,
    snapshotSha256: sha256(secondSnapshotBody)
  };
  const sourceInventory = inventory({
    tables: inventory().tables.map((table) =>
      table.name === "FileObject"
        ? {
            ...table,
            rows: [
              { id: "f1", objectKey: "uploads/f1.pdf", bucket: "private" },
              { id: "f2", objectKey: "uploads/f2.pdf", bucket: "private" }
            ]
          }
        : table
    ),
    fileBindings: [
      {
        fileId: "f1",
        ownerTable: "Contract",
        ownerPrimaryKey: { id: "c1" },
        ownerColumn: "archiveFileId"
      },
      {
        fileId: "f2",
        ownerTable: "Contract",
        ownerPrimaryKey: { id: "c1" },
        ownerColumn: "formalFileId"
      }
    ],
    objectSnapshots: [
      { fileId: "f1", status: "ready", snapshot: FILE_SNAPSHOT },
      { fileId: "f2", status: "ready", snapshot: secondSnapshot }
    ]
  });
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: sourceInventory,
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table
      ),
      fileBindings: [],
      objectSnapshots: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  const audits = [];
  let persistedFailureReceipt;
  let deletionCount = 0;
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(before),
        report: before,
        database: {
          async transaction(work) {
            return work({
              async appendAudit(event) { audits.push(event); },
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit(event) { audits.push(event); }
        },
        storage: {
          async deleteExactObject(input) {
            deletionCount += 1;
            if (deletionCount === 2) throw new Error("isolated second object failure");
            return {
              kind: "local_quarantine",
              status: "object_key_removed_recovery_artifact_retained",
              objectKey: input.objectKey,
              quarantineObjectKey: "uploads/.f1.pol22-fixture.quarantine"
            };
          }
        },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => after,
        buildPostcheckReport: async () => after,
        persistReceipt: async (receipt) => { persistedFailureReceipt = receipt; },
        verifyWriteFreezeLease: createWriteFreezeVerifier(),
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /second object failure/u
  );
  const progress = audits.find((event) => event.status === "object_deletion_progress");
  assert.equal(progress.executionReceipt.completedObjectDispositions.length, 1);
  assert.equal(
    progress.executionReceipt.completedObjectDispositions[0].quarantineObjectKey,
    "uploads/.f1.pol22-fixture.quarantine"
  );
  assert.deepEqual(
    progress.executionReceipt.remainingObjectScopes.map((scope) => scope.objectKey),
    ["uploads/f2.pdf"]
  );
  assert.equal(persistedFailureReceipt.status, "failed_after_database_commit");
  assert.equal(persistedFailureReceipt.executed, true);
  assert.equal(persistedFailureReceipt.completed, false);
  assert.equal(persistedFailureReceipt.completedObjectDispositions.length, 1);
  assert.deepEqual(
    persistedFailureReceipt.remainingObjectScopes.map((scope) => scope.objectKey),
    ["uploads/f2.pdf"]
  );
  assert.equal(
    persistedFailureReceipt.receiptSha256,
    sha256(
      Object.fromEntries(
        Object.entries(persistedFailureReceipt).filter(
          ([key]) => key !== "receiptSha256"
        )
      )
    )
  );
  assert.ok(
    audits.some(
      (event) =>
        event.status === "failed_after_database_commit" &&
        event.executionReceipt?.receiptSha256 ===
          persistedFailureReceipt.receiptSha256
    )
  );
});

test("final inspect 后租约失效或对象复活不得签发 completed 收据", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name) ? { ...table, rows: [] } : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  let leaseRevoked = false;
  let persistedReceipt;
  const persistedStatuses = [];
  let completedAudit = false;
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(before),
        report: before,
        database: {
          async transaction(work) {
            return work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit(event) {
            if (event.status === "completed") completedAudit = true;
          }
        },
        storage: {
          async deleteExactObject(input) {
            return {
              kind: "local_quarantine",
              status: "object_key_removed_recovery_artifact_retained",
              objectKey: input.objectKey,
              quarantineObjectKey: "uploads/.f1.pol22-fixture.quarantine"
            };
          },
          async inspectExactObjectAbsence() {
            return { status: "absent", observedGenerationCount: 0 };
          }
        },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => after,
        buildPostcheckReport: async () => after,
        persistReceipt: async (receipt) => {
          persistedReceipt = receipt;
          persistedStatuses.push(receipt.status);
          if (["completion_pending", "completed"].includes(receipt.status)) {
            leaseRevoked = true;
          }
        },
        verifyWriteFreezeLease: async (input) => {
          if (leaseRevoked) throw new Error("外部写冻结租约已撤销");
          return createWriteFreezeVerifier()(input);
        },
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /写冻结租约已撤销/u
  );
  assert.equal(persistedReceipt.status, "failed_after_database_commit");
  assert.equal(persistedReceipt.completed, false);
  assert.equal(persistedStatuses.includes("completed"), false);
  assert.equal(completedAudit, false);
});

test("缺失外部写冻结验证端时任何数据库写入前 fail-closed", async () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "正式项目保留"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  let transactionStarted = false;
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(report),
        report,
        database: {
          async transaction() { transactionStarted = true; }
        },
        storage: {},
        buildLockedReport: async () => report,
        buildLockedPostcheckReport: async () => report,
        buildPostcheckReport: async () => report,
        persistReceipt: async () => {}
      }),
    /写冻结租约实时验证端/u
  );
  assert.equal(transactionStarted, false);
});

test("执行收据分别记录真实开始与完成时间", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name) ? { ...table, rows: [] } : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  let clockCalls = 0;
  const receipt = await executeBusinessZeroing({
    args: controlledArgs(before),
    report: before,
    database: withTerminalAuditCommit({
      async transaction(work) {
        return work({
          async appendAudit() {},
          async deleteExactRecord() { return 1; },
          async resetExactSequence() { return 1; }
        });
      },
      async appendAudit() {}
    }),
    storage: {
      async deleteExactObject(input) {
        return {
          kind: "local_quarantine",
          status: "object_key_removed_recovery_artifact_retained",
          objectKey: input.objectKey,
          quarantineObjectKey: "uploads/.f1.pol22-fixture.quarantine"
        };
      },
      async inspectExactObjectAbsence() {
        return { status: "absent", observedGenerationCount: 0 };
      }
    },
    buildLockedReport: async () => before,
    buildLockedPostcheckReport: async () => after,
    buildPostcheckReport: async () => after,
    persistReceipt: async () => {},
    verifyWriteFreezeLease: createWriteFreezeVerifier(),
    clock: () =>
      new Date(
        clockCalls++ === 0
          ? "2026-08-13T01:05:00.000Z"
          : "2026-08-13T01:06:00.000Z"
      )
  });
  assert.equal(receipt.startedAt, "2026-08-13T01:05:00.000Z");
  assert.equal(receipt.completedAt, "2026-08-13T01:06:00.000Z");
});

test("候选删除若经触发器伤及保留资料会在同一事务提交前回滚", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目必须保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const damaged = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Project", "Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  const calls = [];
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(before),
        report: before,
        database: {
          async transaction(work) {
            const result = await work({
              async appendAudit() { calls.push("audit-started"); },
              async deleteExactRecord(item) { calls.push(`delete:${item.table}`); return 1; },
              async resetExactSequence() { return 1; }
            });
            calls.push("commit");
            return result;
          }
        },
        storage: { async deleteExactObject() { calls.push("object"); } },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => damaged,
        buildPostcheckReport: async () => damaged,
        persistReceipt: async () => {},
        verifyWriteFreezeLease: createWriteFreezeVerifier(),
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /后置核验失败/u
  );
  assert.ok(calls.includes("delete:Contract"));
  assert.ok(!calls.includes("commit"));
  assert.ok(!calls.includes("object"));
});

test("锁内删除后 lease 撤销会在事务提交前回滚且不进入对象操作", async () => {
  const decisions = decisionManifest([
    {
      businessType: "项目基本资料",
      table: "Project",
      primaryKey: { id: "p1" },
      decision: "preserve",
      reason: "正式项目保留"
    }
  ]);
  const before = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const after = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory({
      tables: inventory().tables.map((table) =>
        ["Contract", "FileObject"].includes(table.name)
          ? { ...table, rows: [] }
          : table
      ),
      fileBindings: []
    }),
    decisions,
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:10:00.000Z",
    allowMissingDeletedDecisions: true
  });
  let leaseChecks = 0;
  let committed = false;
  let objectCalls = 0;

  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(before),
        report: before,
        database: {
          async transaction(work) {
            await work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
            committed = true;
          },
          async appendAudit() {}
        },
        storage: {
          async deleteExactObject() { objectCalls += 1; }
        },
        buildLockedReport: async () => before,
        buildLockedPostcheckReport: async () => after,
        buildPostcheckReport: async () => after,
        persistReceipt: async () => {},
        verifyWriteFreezeLease: async (input) => {
          leaseChecks += 1;
          if (leaseChecks === 3) throw new Error("锁内 lease 已撤销");
          return createWriteFreezeVerifier()(input);
        },
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /锁内 lease 已撤销/u
  );
  assert.equal(committed, false);
  assert.equal(objectCalls, 0);
});

test("锁内状态漂移、空主键和 broad object key 都会在任何写入前阻断", async () => {
  const report = buildPreflightReport({
    policy: smallPolicy,
    inventory: inventory(),
    decisions: decisionManifest([
      {
        businessType: "项目基本资料",
        table: "Project",
        primaryKey: { id: "p1" },
        decision: "preserve",
        reason: "已由负责人核实"
      }
    ]),
    backup: backupReceipt(),
    codeSha: SHA_40,
    generatedAt: "2026-08-13T01:00:00.000Z"
  });
  const drifted = resignReport({
    ...report,
    preservationCounts: { ...report.preservationCounts, Project: 2 }
  });
  const calls = [];
  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args: controlledArgs(report),
        report,
        database: {
          async transaction(work) {
            return work({
              async appendAudit() {
                calls.push("audit");
              },
              async deleteExactRecord() {
                calls.push("delete");
              }
            });
          }
        },
        storage: { async deleteExactObject() { calls.push("object"); } },
        buildLockedReport: async () => drifted,
        buildLockedPostcheckReport: async () => report,
        buildPostcheckReport: async () => report,
        persistReceipt: async () => {},
        verifyWriteFreezeLease: createWriteFreezeVerifier(),
        now: new Date("2026-08-13T01:05:00.000Z")
      }),
    /锁内状态指纹已漂移/u
  );
  assert.deepEqual(calls, []);
});

test("数据库删除语句只能由策略内表和完整主键生成", () => {
  const primaryKeys = new Map([
    ["Contract", ["id"]],
    ["BusinessDailySequence", ["prefix", "businessDate"]]
  ]);
  const allowed = new Set(primaryKeys.keys());
  assert.deepEqual(
    buildExactDeleteStatement(
      { table: "Contract", primaryKey: { id: "c1" } },
      primaryKeys,
      allowed
    ),
    { sql: 'DELETE FROM "Contract" WHERE "id"::text = $1', values: ["c1"] }
  );
  assert.deepEqual(
    buildExactDeleteStatement(
      {
        table: "BusinessDailySequence",
        primaryKey: { prefix: "HT", businessDate: "2026-08-13" }
      },
      primaryKeys,
      allowed
    ),
    {
      sql:
        'DELETE FROM "BusinessDailySequence" WHERE "prefix"::text = $1 AND "businessDate"::text = $2',
      values: ["HT", "2026-08-13"]
    }
  );
  assert.throws(
    () => buildExactDeleteStatement({ table: "Unknown", primaryKey: { id: "1" } }, primaryKeys, allowed),
    /显式归零策略/u
  );
  assert.throws(
    () => buildExactDeleteStatement({ table: "Contract", primaryKey: {} }, primaryKeys, allowed),
    /主键/u
  );
});

test("每个数据库删除候选都必须在当前事务内按完整行指纹重新断言", () => {
  const primaryKeys = new Map([["Contract", ["id"]]]);
  const allowed = new Set(primaryKeys.keys());
  const candidate = {
    table: "Contract",
    primaryKey: { id: "c1" },
    rowSha256: sha256({ id: "c1", name: "已批准内容" })
  };
  assert.deepEqual(
    buildExactRowSnapshotStatement(candidate, primaryKeys, allowed),
    {
      sql:
        'SELECT to_jsonb(source)::text AS "rowCanonicalJson" FROM "Contract" source WHERE source."id"::text = $1 FOR UPDATE',
      values: ["c1"]
    }
  );
  assert.doesNotThrow(() =>
    assertCandidateRowFingerprint(
      candidate,
      JSON.stringify({ id: "c1", name: "已批准内容" })
    )
  );
  assert.throws(
    () =>
      assertCandidateRowFingerprint(
        candidate,
        JSON.stringify({ id: "c1", name: "被触发器修改" })
      ),
    /完整行指纹已漂移/u
  );
});

test("外键删除顺序严格为子记录先于父记录且循环依赖阻断", () => {
  assert.deepEqual(
    computeDeletionOrder(["Parent", "Child", "Grandchild"], [
      { childTable: "Child", parentTable: "Parent" },
      { childTable: "Grandchild", parentTable: "Child" }
    ]),
    { order: ["Grandchild", "Child", "Parent"], cycles: [] }
  );
  assert.deepEqual(
    computeDeletionOrder(["A", "B"], [
      { childTable: "A", parentTable: "B" },
      { childTable: "B", parentTable: "A" }
    ]),
    { order: [], cycles: ["A", "B"] }
  );
});
