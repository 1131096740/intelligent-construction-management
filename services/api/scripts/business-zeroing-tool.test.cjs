#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
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
  createDryRunReceipt,
  executeBusinessZeroing,
  expectedConfirmation,
  parsePrismaNullableLifecycleFields,
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
  hashExecutionFiles,
  reserveJsonOutput,
  validateTrustedExecutionIdentity
} = require("./business-zeroing-cli.cjs");
const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");
const { verifyBackupArtifacts } = require("./inspect-test-business-zeroing.cjs");
const {
  createPinnedDockerEnvironment
} = require("../prisma/run-business-zeroing-local.cjs");
const {
  BUSINESS_ZEROING_LOGICAL_RELATIONS,
  BUSINESS_ZEROING_POLICY
} = require("./business-zeroing-policy.cjs");
const {
  assertCandidateRowFingerprint,
  buildExactDeleteStatement,
  buildExactRowSnapshotStatement,
  buildExactSequenceResetStatement,
  computeDeletionOrder,
  computeSchemaDigest,
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
    { id: "c1", status: "draft", firstSubmittedAt: "2026-08-13T00:30:00.000Z" }
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

  const nullableLifecycleFields = parsePrismaNullableLifecycleFields(
    readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8")
  );
  assert.ok(nullableLifecycleFields.has("endedAt"));
  assert.ok(nullableLifecycleFields.has("settlementModeConfirmedByUserId"));

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
                  [...nullableLifecycleFields].map((field) => [field, null])
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

test("当前 Prisma 全部表均有唯一中文归类且迁移历史受保护", () => {
  const schema = readFileSync(
    path.resolve(__dirname, "../prisma/schema.prisma"),
    "utf8"
  );
  const schemaTables = [...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)]
    .map((match) => match[1])
    .sort();
  const policyTables = BUSINESS_ZEROING_POLICY.tables
    .map((item) => item.name)
    .filter((name) => name !== "_prisma_migrations")
    .sort();

  assert.deepEqual(policyTables, schemaTables);
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
    () => createDryRunReceipt({ report: before, currentReport: driftedCandidate }),
    /独立测试来源工件已漂移|状态指纹已漂移/u
  );
});

test("备份工件必须真实存在且字节校验和匹配", async () => {
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
        sha256: createHash("sha256").update(databaseContent).digest("hex")
      },
      privateFileBackup: {
        ...backupReceipt().privateFileBackup,
        location: filesPath,
        sha256: createHash("sha256").update(filesContent).digest("hex")
      }
    });
    await assert.doesNotReject(() => verifyBackupArtifacts(receipt));
    await writeFile(databasePath, "tampered", "utf8");
    await assert.rejects(() => verifyBackupArtifacts(receipt), /SHA-256 校验失败/u);
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
  const client = { async $queryRawUnsafe() { return [{ metadata }]; } };
  assert.deepEqual(await verifyBusinessZeroingExecutionAudit(client, receipt), {
    status: "passed"
  });
  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        { async $queryRawUnsafe() { return []; } },
        receipt
      ),
    /缺少本批次已完成/u
  );
  await assert.rejects(
    () =>
      verifyBusinessZeroingExecutionAudit(
        {
          async $queryRawUnsafe() {
            return [{ metadata: { ...metadata, executionReceipt: { ...receipt, status: "forged" } } }];
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
          async $queryRawUnsafe() {
            return [{ metadata: { status: "failed_after_database_commit" } }];
          }
        },
        receipt
      ),
    /最新受控执行审计未完成|已被失败事件作废/u
  );
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
      expectedSnapshot: freshSnapshot
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
          expectedSnapshot: snapshot
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
          expectedSnapshot: snapshot
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
      expectedSnapshot: snapshot
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
    database,
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
    ["audit", "completed"]
  ]);

  await assert.rejects(
    () =>
      executeBusinessZeroing({
        args,
        report: before,
        database: {
          async transaction(work) {
            return work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit() {}
        },
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
        database: {
          async transaction(work) {
            return work({
              async appendAudit() {},
              async deleteExactRecord() { return 1; },
              async resetExactSequence() { return 1; }
            });
          },
          async appendAudit(event) {
            if (event.status === "completed") throw new Error("isolated completed audit failure");
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
    database: {
      async transaction(work) {
        return work({
          async appendAudit() {},
          async deleteExactRecord() { return 1; },
          async resetExactSequence() { return 1; }
        });
      },
      async appendAudit() {}
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
