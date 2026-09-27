"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID, sign } = require("node:crypto");
const { test } = require("node:test");
const { sha256 } = require("./business-zeroing-core.cjs");
const { validateProductionApplyAuthorization } = require("./isolated-file-cleanup-production-contract.cjs");

test("正式两文件 apply 授权精确绑定前序、计划、冻结和版本集合", async t => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const files = [randomUUID(), randomUUID()].sort().map(id => ({ id, rowSha256: "a".repeat(64) }));
  const continuity = { envelopeSha256: "b".repeat(64), predecessorReceiptSha256: "c".repeat(64),
    candidateSha: "d".repeat(40), expiresAt: new Date(Date.now() + 120000).toISOString() };
  const source = { environment: "production", reportSha256: "e".repeat(64), codeSha: continuity.candidateSha,
    executionCodeSha256: "f".repeat(64), databaseFingerprint: "1".repeat(64),
    schemaDigest: "2".repeat(64), migrationCount: 171, migrationHead: "20260918170000_pol109_project_close_stages" };
  const scope = { files, sourceReportSha256: source.reportSha256,
    schemaContinuitySha256: continuity.envelopeSha256 };
  const generatedAt = new Date(Date.now() - 2000).toISOString();
  const operations = files.map(file => ({ database: { table: "FileObject", primaryKey: { id: file.id }, rowSha256: file.rowSha256 },
    object: { kind: "cos_versions", bucket: "private-prod-123", objectKey: `${file.id}.pdf`,
      versions: [{ versionId: `v-${file.id}`, isDeleteMarker: false, isLatest: true,
        lastModified: generatedAt, sizeBytes: 7 }] } }));
  const objectSnapshots = operations.map(item => {
    const body = { kind: item.object.kind, versions: item.object.versions };
    const snapshot = { ...body, snapshotSha256: sha256(body) };
    item.object.snapshotSha256 = snapshot.snapshotSha256;
    return { fileId: item.database.primaryKey.id, bucket: item.object.bucket,
      objectKey: item.object.objectKey, snapshot };
  });
  const planBody = { schemaVersion: 1, mode: "isolated_file_cleanup_dry_run", status: "verified", executed: false,
    eligibleForExecution: false, eligibleForIsolatedExecution: false, generatedAt,
    sourceReportSha256: source.reportSha256, scopeSha256: sha256(scope), targets: files,
    productionContinuity: continuity, databaseFingerprint: source.databaseFingerprint,
    schemaDigest: source.schemaDigest, migrationCount: 171, migrationHead: source.migrationHead,
    executionCodeIdentity: { codeSha: source.codeSha, executionCodeSha256: source.executionCodeSha256 },
    executionIdentity: { deploymentIdentitySha256: "3".repeat(64), executorIdentity: "production-executor" },
    scopeAuthorization: { envelopeSha256: "4".repeat(64), expiresAt: continuity.expiresAt },
    writeFreezeLease: { envelopeSha256: "5".repeat(64), generation: 7, fenceToken: "6".repeat(64),
      expiresAt: continuity.expiresAt },
    executionAuthorization: { envelopeSha256: "7".repeat(64), expiresAt: continuity.expiresAt },
    batchId: "two-orphans-001", backupReceiptSha256: "8".repeat(64), versionBackupReceiptSha256: "9".repeat(64),
    databaseRestoreProof: { status: "passed", verifiedAt: new Date(Date.now() - 3000).toISOString(),
      backupReceiptSha256: "8".repeat(64), targetRowsSha256: sha256(files),
      restoredDatabaseFingerprint: "0".repeat(64), retainedRowsSha256: "a".repeat(64) },
    objectSnapshots, objectSnapshotsSha256: sha256(objectSnapshots), approvedInspectionSha256: "0".repeat(64),
    operations,
    recovery: { databaseBackupReceiptSha256: "8".repeat(64), versionBackupReceiptSha256: "9".repeat(64),
      retainedRowsSha256: "a".repeat(64) }, blockers: ["PRODUCTION_EXECUTION_NOT_ENABLED"] };
  const seal = body => ({ ...body, reportSha256: sha256(body) });
  const plan = seal(planBody);
  const journalRoot = "/var/lib/jiangkong/pol122-two-file-journals";
  const payloadFor = selected => ({ schemaVersion: 1, purpose: "pol122-two-orphan-production-apply-v1",
    predecessorReceiptSha256: continuity.predecessorReceiptSha256,
    schemaContinuitySha256: continuity.envelopeSha256, candidateSha: source.codeSha,
    databaseFingerprint: source.databaseFingerprint, planSha256: selected.reportSha256,
    exactTargetsSha256: sha256(files), objectOperationsSha256: sha256(selected.operations),
    inspectionAuthorizationSha256: selected.executionAuthorization.envelopeSha256,
    versionBackupReceiptSha256: selected.versionBackupReceiptSha256,
    databaseBackupReceiptSha256: selected.backupReceiptSha256,
    batchId: selected.batchId, scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256,
    executionCodeSha256: source.executionCodeSha256,
    deploymentIdentitySha256: selected.executionIdentity.deploymentIdentitySha256,
    executorIdentity: selected.executionIdentity.executorIdentity,
    generation: selected.writeFreezeLease.generation, fenceToken: selected.writeFreezeLease.fenceToken,
    journalRoot, authorizationRef: "approved-window-001", issuer: "independent-approver",
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  const signPayload = payload => {
    const bytes = Buffer.from(JSON.stringify(payload));
    return { schemaVersion: 1, algorithm: "Ed25519", payload: bytes.toString("base64"),
      signature: sign(null, bytes, keys.privateKey).toString("base64") };
  };
  const envelope = signPayload(payloadFor(plan));
  const verify = (options = {}) => validateProductionApplyAuthorization(
    options.envelope ?? envelope, options.plan ?? plan, options.scope ?? scope,
    options.source ?? source, options.continuity ?? continuity, options.journalRoot ?? journalRoot,
    options.publicKey ?? publicKey);
  assert.deepEqual(verify(), { envelopeSha256: sha256(envelope), planSha256: plan.reportSha256,
    expiresAt: JSON.parse(Buffer.from(envelope.payload, "base64").toString()).expiresAt });

  await t.test("改签扩大目标、版本或保留行绑定仍失败", () => {
    for (const changed of [
      { ...planBody, targets: [files[0], { ...files[1], id: randomUUID() }] },
      { ...planBody, operations: [...planBody.operations, planBody.operations[0]] },
      { ...planBody, operations: planBody.operations.map((item, index) => index ? item :
        { ...item, object: { ...item.object, versions: [...item.object.versions, { ...item.object.versions[0], versionId: "extra" }] } }) },
      { ...planBody, operations: planBody.operations.map((item, index) => index ? item :
        { ...item, object: { ...item.object, versions: [...item.object.versions, item.object.versions[0]] } }) },
      { ...planBody, recovery: { ...planBody.recovery, retainedRowsSha256: "b".repeat(64) } }
    ]) {
      const selected = seal(changed);
      assert.throws(() => verify({ plan: selected, envelope: signPayload(payloadFor(selected)) }),
        /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
    }
  });
  await t.test("前序、连续性、签名人、有效期与日志目录不可替换", () => {
    const base = payloadFor(plan);
    for (const change of [
      { predecessorReceiptSha256: "0".repeat(64) }, { schemaContinuitySha256: "0".repeat(64) },
      { purpose: "isolated-orphan-file-apply-v1" }, { extra: true },
      { expiresAt: new Date(Date.now() + 3600000).toISOString() }
    ]) assert.throws(() => verify({ envelope: signPayload({ ...base, ...change }) }),
      /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
    assert.throws(() => verify({ journalRoot: "/var/lib/jiangkong/other" }), /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
    assert.throws(() => verify({ publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) }),
      /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
  });
  await t.test("过期控制材料、快照漂移和非规范签名均拒绝", () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    for (const changed of [
      { ...planBody, writeFreezeLease: { ...planBody.writeFreezeLease, expiresAt: expired } },
      { ...planBody, objectSnapshotsSha256: "f".repeat(64) },
      { ...planBody, databaseRestoreProof: { ...planBody.databaseRestoreProof,
        retainedRowsSha256: "0".repeat(64) } }
    ]) {
      const selected = seal(changed);
      assert.throws(() => verify({ plan: selected, envelope: signPayload(payloadFor(selected)) }),
        /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
    }
    assert.throws(() => verify({ envelope: { ...envelope, signature: `${envelope.signature}=` } }),
      /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
  });
  await t.test("即使重签并同步快照摘要，重复版本仍失败", () => {
    const versions = [...operations[0].object.versions, operations[0].object.versions[0]];
    const snapshotBody = { kind: "cos_versions", versions };
    const snapshot = { ...snapshotBody, snapshotSha256: sha256(snapshotBody) };
    const changed = { ...planBody,
      objectSnapshots: [{ ...objectSnapshots[0], snapshot }, objectSnapshots[1]],
      operations: [{ ...operations[0], object: { ...operations[0].object, versions,
        snapshotSha256: snapshot.snapshotSha256 } }, operations[1]] };
    changed.objectSnapshotsSha256 = sha256(changed.objectSnapshots);
    const selected = seal(changed);
    assert.throws(() => verify({ plan: selected, envelope: signPayload(payloadFor(selected)) }),
      /PRODUCTION_APPLY_AUTHORIZATION_INVALID/u);
  });
});
