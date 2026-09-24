"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { createPublicKey, verify } = require("node:crypto");
const { sha256 } = require("./business-zeroing-core.cjs");
const { readTrustedAuthorizationPublicKey } = require("./business-zeroing-cli.cjs");

// A disposition decision is not a POL-22 test-provenance attestation and is not
// final execution authority. The independent execution gates remain mandatory.
function validateScopeAuthorization(envelope, scope, source) {
  const reject = () => { throw new Error("SCOPE_AUTHORIZATION_INVALID"); };
  if (!envelope || Object.keys(envelope).sort().join(",") !== "algorithm,payload,schemaVersion,signature" ||
      envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519") reject();
  const decode = value => {
    if (typeof value !== "string" || !value) reject();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) reject();
    return bytes;
  };
  const bytes = decode(envelope.payload);
  const signature = decode(envelope.signature);
  const key = createPublicKey(readTrustedAuthorizationPublicKey());
  if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, bytes, key, signature)) reject();
  const payload = JSON.parse(bytes.toString("utf8"));
  const fields = ["authorizationRef", "databaseFingerprint", "environment", "expiresAt", "issuedAt", "issuer",
    "purpose", "schemaVersion", "scopeSha256", "sourceReportSha256"];
  if (!payload || Object.keys(payload).sort().join(",") !== fields.join(",") || payload.schemaVersion !== 1 ||
      payload.purpose !== "isolated-orphan-file-disposition-v1" ||
      typeof payload.authorizationRef !== "string" || payload.authorizationRef.trim().length < 8 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim()) reject();
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      new Date(issued).toISOString() !== payload.issuedAt || new Date(expires).toISOString() !== payload.expiresAt ||
      issued > now || expires <= now || expires <= issued) reject();
  if (payload.scopeSha256 !== sha256(scope) || payload.sourceReportSha256 !== source.reportSha256 ||
      payload.environment !== source.environment || payload.databaseFingerprint !== source.databaseFingerprint) reject();
  return { envelopeSha256: sha256(envelope), authorizationRef: payload.authorizationRef, expiresAt: payload.expiresAt };
}

// Independent purpose: never interpret a POL-22 zeroing lease as permission for
// orphan disposition. Read the fixed lease afresh on every call, not from argv.
function validateWriteFreeze(scope, source, identity, batchId, scopeAuthorization) {
  const reject = () => { throw new Error("WRITE_FREEZE_INVALID"); };
  const { readTrustedWriteFreezePublicKey, readTrustedWriteFreezeLease } = require("./business-zeroing-cli.cjs");
  const key = createPublicKey(readTrustedWriteFreezePublicKey(identity.writeFreezePublicKeySha256));
  const envelope = readTrustedWriteFreezeLease();
  if (!envelope || Object.keys(envelope).sort().join(",") !== "algorithm,payload,schemaVersion,signature" ||
      envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519") reject();
  const decode = value => {
    if (typeof value !== "string" || !value) reject();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) reject();
    return bytes;
  };
  const bytes = decode(envelope.payload);
  const signature = decode(envelope.signature);
  if (signature.length !== 64 || !verify(null, bytes, key, signature)) reject();
  const payload = JSON.parse(bytes.toString("utf8"));
  const fields = ["batchId", "codeSha", "databaseFingerprint", "deploymentIdentitySha256", "environment",
    "executionCodeSha256", "executorIdentity", "expiresAt", "fenceToken", "generation", "issuedAt", "issuer",
    "leaseId", "purpose", "revokedAt", "schemaVersion", "scopeSha256", "scopes", "sourceReportSha256", "status"];
  if (!payload || Object.keys(payload).sort().join(",") !== fields.join(",") || payload.schemaVersion !== 1 ||
      payload.purpose !== "isolated-orphan-file-write-freeze-v1" || payload.status !== "active" || payload.revokedAt !== null ||
      !Number.isSafeInteger(payload.generation) || payload.generation < 1 || !/^[0-9a-f]{64}$/u.test(payload.fenceToken) ||
      typeof payload.leaseId !== "string" || payload.leaseId.trim().length < 8 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim() ||
      JSON.stringify(payload.scopes) !== JSON.stringify(["database_business_writes", "private_object_writes"])) reject();
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      new Date(issued).toISOString() !== payload.issuedAt || new Date(expires).toISOString() !== payload.expiresAt ||
      issued > now || expires <= now || expires <= issued || expires > Date.parse(scopeAuthorization.expiresAt)) reject();
  const expected = { batchId, scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256,
    codeSha: source.codeSha, executionCodeSha256: source.executionCodeSha256, databaseFingerprint: source.databaseFingerprint,
    environment: identity.environment, deploymentIdentitySha256: identity.deploymentIdentitySha256,
    executorIdentity: identity.executorIdentity };
  if (Object.entries(expected).some(([field, value]) => payload[field] !== value)) reject();
  return { envelopeSha256: sha256(envelope), expiresAt: payload.expiresAt, generation: payload.generation,
    fenceToken: payload.fenceToken, leaseId: payload.leaseId };
}

// Cryptographic binding only. Callers must still re-inspect the database,
// backups and objects, and enforce the same fence before every mutation.
function validateExecutionAuthorization(envelope, report, scope, source, identity, batchId, scopeAuthorization, freeze) {
  const reject = () => { throw new Error("EXECUTION_AUTHORIZATION_INVALID"); };
  if (!envelope || Object.keys(envelope).sort().join(",") !== "algorithm,payload,schemaVersion,signature" ||
      envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519") reject();
  const decode = value => {
    if (typeof value !== "string" || !value) reject();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) reject();
    return bytes;
  };
  const bytes = decode(envelope.payload);
  const signature = decode(envelope.signature);
  const key = createPublicKey(readTrustedAuthorizationPublicKey());
  if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, bytes, key, signature)) reject();
  const payload = JSON.parse(bytes.toString("utf8"));
  const { reportSha256, ...body } = report;
  if (!/^[0-9a-f]{64}$/u.test(reportSha256) || sha256(body) !== reportSha256 ||
      report.schemaVersion !== 1 || report.mode !== "isolated_file_cleanup_inspection" || report.status !== "blocked" ||
      report.executed !== false || report.eligibleForExecution !== false || report.eligibleForIsolatedExecution !== false ||
      JSON.stringify(report.blockers) !== JSON.stringify(["EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"]) ||
      report.sourceReportSha256 !== source.reportSha256 || report.scopeSha256 !== sha256(scope) ||
      sha256(report.targets) !== sha256(scope.files) || report.databaseFingerprint !== source.databaseFingerprint ||
      report.batchId !== batchId || sha256(report.scopeAuthorization) !== sha256(scopeAuthorization) ||
      sha256(report.writeFreezeLease) !== sha256(freeze) || report.databaseRestoreProof?.status !== "passed" ||
      report.databaseRestoreProof.backupReceiptSha256 !== report.backupReceiptSha256 ||
      report.databaseRestoreProof.targetRowsSha256 !== sha256(scope.files) ||
      !Array.isArray(report.objectSnapshots) || report.objectSnapshots.length !== 2 ||
      sha256(report.objectSnapshots) !== report.objectSnapshotsSha256) reject();
  const { verifyObjectSnapshot } = require("./business-zeroing-core.cjs");
  if (new Set(report.objectSnapshots.map(item => item.fileId)).size !== 2 ||
      report.objectSnapshots.some(item => !scope.files.some(file => file.id === item.fileId) ||
        typeof item.bucket !== "string" || !item.bucket || typeof item.objectKey !== "string" || !item.objectKey)) reject();
  for (const item of report.objectSnapshots) verifyObjectSnapshot(item.snapshot);
  if (report.objectSnapshots.some(item => item.snapshot.kind === "cos_versions") &&
      !/^[0-9a-f]{64}$/u.test(report.versionBackupReceiptSha256)) reject();
  for (const field of ["restoredDatabaseFingerprint", "targetRowsSha256", "retainedRowsSha256"]) {
    if (!/^[0-9a-f]{64}$/u.test(report.databaseRestoreProof[field])) reject();
  }
  const expected = { schemaVersion: 1, purpose: "isolated-orphan-file-execution-v1",
    environment: identity.environment, databaseFingerprint: source.databaseFingerprint,
    codeSha: source.codeSha, executionCodeSha256: source.executionCodeSha256,
    deploymentIdentitySha256: identity.deploymentIdentitySha256, executorIdentity: identity.executorIdentity,
    batchId, scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256, inspectionReportSha256: reportSha256,
    backupReceiptSha256: report.backupReceiptSha256, versionBackupReceiptSha256: report.versionBackupReceiptSha256,
    databaseRestoreProofSha256: sha256(report.databaseRestoreProof), objectSnapshotsSha256: report.objectSnapshotsSha256,
    scopeAuthorizationSha256: scopeAuthorization.envelopeSha256, writeFreezeLeaseSha256: freeze.envelopeSha256,
    generation: freeze.generation, fenceToken: freeze.fenceToken };
  if (!payload || Object.keys(payload).sort().join(",") !==
      [...Object.keys(expected), "authorizationRef", "issuer", "issuedAt", "expiresAt"].sort().join(",") ||
      Object.entries(expected).some(([field, value]) => payload[field] !== value) ||
      typeof payload.authorizationRef !== "string" || payload.authorizationRef.trim().length < 8 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim()) reject();
  for (const field of ["environment", "deploymentIdentitySha256", "executorIdentity"]) {
    if (report.executionIdentity?.[field] !== identity[field]) reject();
  }
  for (const field of ["codeSha", "executionCodeSha256"]) {
    if (report.executionCodeIdentity?.[field] !== source[field]) reject();
  }
  const canonicalTime = value => {
    const time = Date.parse(value);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== value) reject();
    return time;
  };
  const issued = canonicalTime(payload.issuedAt);
  const expires = canonicalTime(payload.expiresAt);
  const generated = canonicalTime(report.generatedAt);
  const restored = canonicalTime(report.databaseRestoreProof.verifiedAt);
  if (restored > generated || issued < generated || issued > Date.now() || expires <= Date.now() || expires <= issued ||
      expires > Date.parse(scopeAuthorization.expiresAt) || expires > Date.parse(freeze.expiresAt)) reject();
  return { envelopeSha256: sha256(envelope), authorizationRef: payload.authorizationRef,
    expiresAt: payload.expiresAt, inspectionReportSha256: reportSha256 };
}

function validateApplyAuthorization(envelope, plan, current, journalRoot) {
  const reject = () => { throw new Error("APPLY_AUTHORIZATION_INVALID"); };
  const { reportSha256, ...body } = plan;
  if (!/^[0-9a-f]{64}$/u.test(reportSha256) || sha256(body) !== reportSha256 ||
      !current.executionAuthorization || !current.writeFreezeLease || !current.databaseRestoreProof ||
      plan.eligibleForIsolatedExecution !== true || current.eligibleForIsolatedExecution !== true ||
      JSON.stringify(current.blockers) !== JSON.stringify(["PRODUCTION_EXECUTION_NOT_ENABLED"])) reject();
  const stable = value => {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.reportSha256;
    delete copy.generatedAt;
    if (copy.databaseRestoreProof) delete copy.databaseRestoreProof.verifiedAt;
    return copy;
  };
  if (sha256(stable(plan)) !== sha256(stable(current))) reject();
  if (!envelope || Object.keys(envelope).sort().join(",") !== "algorithm,payload,schemaVersion,signature" ||
      envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519") reject();
  const decode = value => {
    if (typeof value !== "string" || !value) reject();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) reject();
    return bytes;
  };
  const bytes = decode(envelope.payload), signature = decode(envelope.signature);
  const key = createPublicKey(readTrustedAuthorizationPublicKey());
  if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, bytes, key, signature)) reject();
  const payload = JSON.parse(bytes.toString("utf8"));
  const expected = { schemaVersion: 1, purpose: "isolated-orphan-file-apply-v1",
    planSha256: reportSha256, inspectionAuthorizationSha256: current.executionAuthorization.envelopeSha256,
    batchId: current.batchId, scopeSha256: current.scopeSha256, ...current.executionCodeIdentity,
    deploymentIdentitySha256: current.executionIdentity.deploymentIdentitySha256,
    executorIdentity: current.executionIdentity.executorIdentity,
    generation: current.writeFreezeLease.generation, fenceToken: current.writeFreezeLease.fenceToken, journalRoot };
  if (!payload || Object.keys(payload).sort().join(",") !==
      [...Object.keys(expected), "authorizationRef", "issuer", "issuedAt", "expiresAt"].sort().join(",") ||
      Object.entries(expected).some(([field, value]) => payload[field] !== value) ||
      typeof payload.authorizationRef !== "string" || payload.authorizationRef.trim().length < 8 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim()) reject();
  const time = value => {
    const result = Date.parse(value);
    if (!Number.isFinite(result) || new Date(result).toISOString() !== value) reject();
    return result;
  };
  const issued = time(payload.issuedAt), expires = time(payload.expiresAt), generated = time(plan.generatedAt);
  if (time(plan.databaseRestoreProof.verifiedAt) > generated || generated > issued || issued > Date.now() ||
      expires <= Date.now() || expires <= issued || expires > time(current.executionAuthorization.expiresAt)) reject();
  return { envelopeSha256: sha256(envelope), planSha256: reportSha256, expiresAt: payload.expiresAt };
}

module.exports = { validateScopeAuthorization, validateWriteFreeze, validateExecutionAuthorization, validateApplyAuthorization };
