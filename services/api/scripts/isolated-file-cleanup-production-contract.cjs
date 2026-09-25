"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { createHash, createPublicKey, verify } = require("node:crypto");
const { sha256, verifyObjectSnapshot } = require("./business-zeroing-core.cjs");

const POL25A_RECEIPT_SHA256 = "707202fbf66bc1f22cc2bf06285a8fed67e5d79e9b1b855a40f2a90bc1a37582";

// This is a read-only admission contract, not an execution entrypoint. The
// eventual production adapter must obtain the key from the fixed root-owned
// trust anchor and revalidate this contract before every mutation.
function validateProductionContinuity(envelope, predecessorBytes, source, scope, trustedPublicKey, anchorSha256) {
  const reject = () => { throw new Error("PRODUCTION_CONTINUITY_INVALID"); };
  if (!/^[0-9a-f]{64}$/u.test(anchorSha256) || !Buffer.isBuffer(predecessorBytes) ||
      createHash("sha256").update(predecessorBytes).digest("hex") !== anchorSha256 ||
      !source || source.mode !== "read_only_preflight" || source.status !== "blocked" ||
      source.executed !== false || source.environment !== "production" ||
      !/^[0-9a-f]{40}$/u.test(source.codeSha) ||
      !/^[0-9a-f]{64}$/u.test(source.databaseFingerprint) ||
      !/^[0-9a-f]{64}$/u.test(source.schemaDigest) ||
      source.migrationCount !== 171 || typeof source.migrationHead !== "string" ||
      !Array.isArray(source.deletionCandidates) || source.deletionCandidates.length !== 0 ||
      !Array.isArray(source.blockers) || source.blockers.length !== 2 ||
      source.blockers.some(item => item.code !== "ORPHAN_FILE") ||
      !scope || !Array.isArray(scope.files) || scope.files.length !== 2 ||
      scope.sourceReportSha256 !== source.reportSha256 ||
      scope.files.some(file => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(file?.id) ||
        !/^[0-9a-f]{64}$/u.test(file?.rowSha256)) ||
      new Set(scope.files.map(file => file.id)).size !== 2 ||
      JSON.stringify(scope.files.map(file => file.id).sort()) !==
        JSON.stringify(source.blockers.map(item => item.details?.primaryKey?.id).sort())) reject();
  const { reportSha256, ...reportBody } = source;
  if (!/^[0-9a-f]{64}$/u.test(reportSha256) || sha256(reportBody) !== reportSha256) reject();
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
  let payload;
  try {
    const key = createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 ||
        !verify(null, bytes, key, signature)) reject();
    payload = JSON.parse(bytes.toString("utf8"));
  } catch { reject(); }
  const fields = ["candidateSha", "databaseFingerprint", "environment", "expiresAt", "issuedAt", "issuer",
    "migrationCount", "migrationHead", "predecessorReceiptSha256", "purpose", "schemaDigest", "schemaVersion",
    "sourceReportSha256"];
  if (!payload || Object.keys(payload).sort().join(",") !== fields.join(",") ||
      payload.schemaVersion !== 1 || payload.purpose !== "pol122-two-orphan-production-continuity-v1" ||
      payload.predecessorReceiptSha256 !== anchorSha256 ||
      payload.candidateSha !== source.codeSha || payload.databaseFingerprint !== source.databaseFingerprint ||
      payload.environment !== source.environment || payload.schemaDigest !== source.schemaDigest ||
      payload.migrationCount !== source.migrationCount || payload.migrationHead !== source.migrationHead ||
      payload.sourceReportSha256 !== source.reportSha256 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim()) reject();
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      new Date(issued).toISOString() !== payload.issuedAt || new Date(expires).toISOString() !== payload.expiresAt ||
      issued > Date.now() || expires <= Date.now() || expires <= issued || expires - issued > 15 * 60 * 1000 ||
      scope.schemaContinuitySha256 !== sha256(envelope)) reject();
  return { envelopeSha256: sha256(envelope), predecessorReceiptSha256: anchorSha256,
    candidateSha: payload.candidateSha, expiresAt: payload.expiresAt };
}

// Pure authorization check only. Production execute/postcheck remain disabled;
// any future adapter must also re-read and compare the live dry-run evidence.
function validateProductionApplyAuthorization(envelope, plan, scope, source, continuity, journalRoot, trustedPublicKey) {
  const reject = () => { throw new Error("PRODUCTION_APPLY_AUTHORIZATION_INVALID"); };
  const hex = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  const time = value => {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) reject();
    return parsed;
  };
  if (!plan || !scope || !source || !continuity ||
      journalRoot !== "/var/lib/jiangkong/pol122-two-file-journals" ||
      source.environment !== "production" || source.codeSha !== continuity.candidateSha ||
      !hex(source.reportSha256) || !hex(source.databaseFingerprint) || !hex(source.schemaDigest) ||
      source.migrationCount !== 171 || !hex(continuity.envelopeSha256) ||
      !hex(continuity.predecessorReceiptSha256) ||
      scope.sourceReportSha256 !== source.reportSha256 ||
      scope.schemaContinuitySha256 !== continuity.envelopeSha256 ||
      !Array.isArray(scope.files) || scope.files.length !== 2 ||
      new Set(scope.files.map(file => file.id)).size !== 2 ||
      scope.files.some(file => !hex(file.rowSha256) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(file.id))) reject();
  const { reportSha256, ...body } = plan;
  if (!hex(reportSha256) || sha256(body) !== reportSha256 ||
      plan.schemaVersion !== 1 || plan.mode !== "isolated_file_cleanup_dry_run" ||
      plan.status !== "verified" || plan.executed !== false ||
      plan.eligibleForExecution !== false || plan.eligibleForIsolatedExecution !== false ||
      JSON.stringify(plan.blockers) !== JSON.stringify(["PRODUCTION_EXECUTION_NOT_ENABLED"]) ||
      sha256(plan.targets) !== sha256(scope.files) ||
      plan.sourceReportSha256 !== source.reportSha256 || plan.scopeSha256 !== sha256(scope) ||
      sha256(plan.productionContinuity) !== sha256(continuity) ||
      plan.databaseFingerprint !== source.databaseFingerprint || plan.schemaDigest !== source.schemaDigest ||
      plan.migrationCount !== source.migrationCount || plan.migrationHead !== source.migrationHead ||
      plan.executionCodeIdentity?.codeSha !== source.codeSha ||
      plan.executionCodeIdentity?.executionCodeSha256 !== source.executionCodeSha256 ||
      !hex(source.executionCodeSha256) ||
      !hex(plan.executionIdentity?.deploymentIdentitySha256) ||
      typeof plan.executionIdentity?.executorIdentity !== "string" ||
      !plan.executionIdentity.executorIdentity.trim() ||
      !hex(plan.scopeAuthorization?.envelopeSha256) ||
      !hex(plan.writeFreezeLease?.envelopeSha256) ||
      !Number.isSafeInteger(plan.writeFreezeLease?.generation) ||
      plan.writeFreezeLease.generation < 1 || !hex(plan.writeFreezeLease.fenceToken) ||
      !hex(plan.executionAuthorization?.envelopeSha256) ||
      !hex(plan.backupReceiptSha256) || !hex(plan.versionBackupReceiptSha256) ||
      plan.databaseRestoreProof?.status !== "passed" ||
      plan.databaseRestoreProof.backupReceiptSha256 !== plan.backupReceiptSha256 ||
      plan.databaseRestoreProof.targetRowsSha256 !== sha256(scope.files) ||
      !hex(plan.databaseRestoreProof.retainedRowsSha256) ||
      plan.recovery?.databaseBackupReceiptSha256 !== plan.backupReceiptSha256 ||
      plan.recovery?.versionBackupReceiptSha256 !== plan.versionBackupReceiptSha256 ||
      plan.recovery?.retainedRowsSha256 !== plan.databaseRestoreProof.retainedRowsSha256 ||
      typeof plan.batchId !== "string" || !plan.batchId.trim() ||
      !Array.isArray(plan.operations) || plan.operations.length !== 2 ||
      !Array.isArray(plan.objectSnapshots) || plan.objectSnapshots.length !== 2 ||
      sha256(plan.objectSnapshots) !== plan.objectSnapshotsSha256) reject();
  for (let index = 0; index < 2; index += 1) {
    const target = scope.files[index];
    const operation = plan.operations[index];
    const snapshot = plan.objectSnapshots.find(item => item.fileId === target.id);
    if (!operation || operation.database?.table !== "FileObject" ||
        operation.database.primaryKey?.id !== target.id ||
        operation.database.rowSha256 !== target.rowSha256 ||
        !snapshot || snapshot.bucket !== operation.object?.bucket ||
        snapshot.objectKey !== operation.object.objectKey ||
        sha256(snapshot.snapshot) !== sha256(Object.fromEntries(
          Object.entries(operation.object).filter(([field]) => field !== "bucket" && field !== "objectKey"))) ||
        operation.object.kind !== "cos_versions" ||
        !Array.isArray(operation.object.versions) || operation.object.versions.length < 1 ||
        operation.object.versions.some(version => typeof version.versionId !== "string" || !version.versionId)) reject();
    try { verifyObjectSnapshot(snapshot.snapshot); }
    catch { reject(); }
  }
  if (!envelope || Object.keys(envelope).sort().join(",") !== "algorithm,payload,schemaVersion,signature" ||
      envelope.schemaVersion !== 1 || envelope.algorithm !== "Ed25519") reject();
  const decode = value => {
    if (typeof value !== "string" || !value) reject();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) reject();
    return bytes;
  };
  let payload;
  try {
    const bytes = decode(envelope.payload);
    const signature = decode(envelope.signature);
    const key = createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 ||
        !verify(null, bytes, key, signature)) reject();
    payload = JSON.parse(bytes.toString("utf8"));
  } catch { reject(); }
  const expected = { schemaVersion: 1, purpose: "pol122-two-orphan-production-apply-v1",
    predecessorReceiptSha256: continuity.predecessorReceiptSha256,
    schemaContinuitySha256: continuity.envelopeSha256, candidateSha: source.codeSha,
    databaseFingerprint: source.databaseFingerprint, planSha256: reportSha256,
    exactTargetsSha256: sha256(scope.files), objectOperationsSha256: sha256(plan.operations),
    inspectionAuthorizationSha256: plan.executionAuthorization.envelopeSha256,
    versionBackupReceiptSha256: plan.versionBackupReceiptSha256,
    databaseBackupReceiptSha256: plan.backupReceiptSha256, batchId: plan.batchId,
    scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256,
    executionCodeSha256: source.executionCodeSha256,
    deploymentIdentitySha256: plan.executionIdentity.deploymentIdentitySha256,
    executorIdentity: plan.executionIdentity.executorIdentity,
    generation: plan.writeFreezeLease.generation, fenceToken: plan.writeFreezeLease.fenceToken,
    journalRoot };
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !==
        [...Object.keys(expected), "authorizationRef", "issuer", "issuedAt", "expiresAt"].sort().join(",") ||
      Object.entries(expected).some(([field, value]) => payload[field] !== value) ||
      typeof payload.authorizationRef !== "string" || payload.authorizationRef.trim().length < 8 ||
      typeof payload.issuer !== "string" || !payload.issuer.trim()) reject();
  const now = Date.now();
  const issued = time(payload.issuedAt), expires = time(payload.expiresAt);
  if (time(plan.databaseRestoreProof.verifiedAt) > time(plan.generatedAt) ||
      time(plan.generatedAt) > issued || issued > now || expires <= now || expires <= issued ||
      expires - issued > 15 * 60 * 1000 ||
      expires > time(continuity.expiresAt) ||
      expires > time(plan.scopeAuthorization.expiresAt) ||
      expires > time(plan.writeFreezeLease.expiresAt) ||
      expires > time(plan.executionAuthorization.expiresAt)) reject();
  return { envelopeSha256: sha256(envelope), planSha256: reportSha256, expiresAt: payload.expiresAt };
}

module.exports = { POL25A_RECEIPT_SHA256, validateProductionContinuity, validateProductionApplyAuthorization };
