"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require("node:fs");
const { sha256 } = require("./business-zeroing-core.cjs");
const { readInput, blocked, boundedCosFetch, writeInspectionEvidence } =
  require("./isolated-file-cleanup.cjs");
const { createTrustedEntrypoint, readTrustedExecutionIdentity, currentCodeIdentity,
  readTrustedSchemaContinuityPublicKey } = require("./business-zeroing-cli.cjs");
const { POL25A_RECEIPT_SHA256, validateProductionContinuity } =
  require("./isolated-file-cleanup-production-contract.cjs");
const { assertProductionInspectionBoundary } =
  require("./isolated-file-cleanup-production-boundary.cjs");
const { validateScopeAuthorization, validateWriteFreeze, validateExecutionAuthorization } =
  require("./isolated-file-cleanup-authorization.cjs");
const { inspectReadOnlyFacts } = require("./isolated-file-cleanup-readonly-coordinator.cjs");

const INPUT_FLAGS = new Set([
  "--scope", "--source-report", "--backup-receipt", "--scope-authorization",
  "--version-backup-root", "--version-restore-root", "--batch-id", "--output",
  "--inspection-report", "--execution-authorization", "--schema-continuity-envelope",
  "--pol25a-receipt"
]);
const DRY_RUN_FLAGS = [
  "--scope", "--source-report", "--backup-receipt", "--scope-authorization",
  "--version-backup-root", "--version-restore-root", "--batch-id", "--output",
  "--inspection-report", "--execution-authorization", "--schema-continuity-envelope",
  "--pol25a-receipt"
];

function same(left, right) {
  if (sha256(left) !== sha256(right)) throw new Error("AUTHORITY_CHANGED");
}

function stableProof(proof) {
  if (!proof) return null;
  return Object.fromEntries(Object.entries(proof).filter(([field]) => field !== "verifiedAt"));
}

async function main(argv) {
  const [command, ...options] = argv;
  // No input is parsed for either mutation command. This entry has no write path.
  if (["execute", "postcheck"].includes(command)) return blocked("PRODUCTION_EXECUTION_NOT_ENABLED");
  if (!["inspect", "dry-run"].includes(command)) return blocked("COMMAND_NOT_AVAILABLE");

  const paths = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!INPUT_FLAGS.has(key) || paths.has(key) || !value || value.startsWith("--")) {
      return blocked("INVALID_ARGUMENTS");
    }
    paths.set(key, value);
  }
  if (!paths.has("--scope")) return blocked("INVALID_ARGUMENTS");
  if (command === "dry-run" && !paths.has("--execution-authorization")) {
    return blocked("DRY_RUN_AUTHORIZATION_REQUIRED");
  }
  if (command === "dry-run" && !paths.has("--output")) {
    return blocked("DRY_RUN_OUTPUT_REQUIRED");
  }
  if (paths.has("--inspection-report") !== paths.has("--execution-authorization") ||
      (paths.has("--execution-authorization") && !paths.has("--batch-id"))) {
    return blocked("INVALID_ARGUMENTS");
  }
  if (paths.has("--batch-id") && !/^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(paths.get("--batch-id"))) {
    return blocked("INVALID_ARGUMENTS");
  }
  if (paths.has("--batch-id") && !paths.has("--scope-authorization")) {
    return blocked("AUTHORIZATION_REQUIRED");
  }
  if (command === "dry-run" && DRY_RUN_FLAGS.some(flag => !paths.has(flag))) {
    return blocked("PRODUCTION_DRY_RUN_MATERIAL_REQUIRED");
  }
  const envelope = readInput(paths.get("--scope"));
  if (!Array.isArray(envelope?.payload?.files) || envelope.payload.files.length !== 2) {
    return blocked("EXACT_TWO_FILES_REQUIRED");
  }
  if (new Set(envelope.payload.files.map(file => file?.id)).size !== 2) {
    return blocked("DUPLICATE_FILE_TARGET");
  }
  if (envelope.payload.files.some(file =>
    !file || Object.keys(file).sort().join(",") !== "id,rowSha256" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(file.id) ||
    !/^[0-9a-f]{64}$/u.test(file.rowSha256))) return blocked("INVALID_EXACT_TARGET");

  if (!paths.has("--source-report")) return blocked("SOURCE_REPORT_REQUIRED");
  const source = readInput(paths.get("--source-report"));
  const { reportSha256, ...body } = source;
  if (!/^[0-9a-f]{64}$/u.test(reportSha256) || sha256(body) !== reportSha256) {
    return blocked("SOURCE_REPORT_INTEGRITY_FAILED");
  }
  if (envelope.payload.sourceReportSha256 !== reportSha256) return blocked("SOURCE_REPORT_BINDING_FAILED");
  if (source.mode !== "read_only_preflight" || source.status !== "blocked" || source.executed !== false ||
      !Array.isArray(source.blockers) || !Array.isArray(source.deletionCandidates) ||
      source.deletionCandidates.length !== 0) return blocked("INVALID_SOURCE_REPORT");
  const orphans = source.blockers.filter(item => item.code === "ORPHAN_FILE");
  const sourceIds = orphans.map(item => item.details?.primaryKey?.id).sort();
  const targetIds = envelope.payload.files.map(file => file.id).sort();
  if (source.blockers.length !== 2 || orphans.length !== 2 || new Set(sourceIds).size !== 2 ||
      JSON.stringify(sourceIds) !== JSON.stringify(targetIds)) return blocked("SOURCE_TARGET_MISMATCH");
  if (!paths.has("--schema-continuity-envelope") || !paths.has("--pol25a-receipt")) {
    return blocked("PRODUCTION_CONTINUITY_REQUIRED");
  }
  if (!paths.has("--scope-authorization") || !paths.has("--batch-id") || !paths.has("--output")) {
    return blocked("PRODUCTION_INSPECTION_AUTHORITY_REQUIRED");
  }
  if (paths.has("--version-backup-root") !== paths.has("--version-restore-root")) {
    return blocked("INVALID_ARGUMENTS");
  }

  let productionContinuity;
  try {
    productionContinuity = validateProductionContinuity(
      readInput(paths.get("--schema-continuity-envelope")),
      readInput(paths.get("--pol25a-receipt"), true), source, envelope.payload,
      readTrustedSchemaContinuityPublicKey(), POL25A_RECEIPT_SHA256);
  } catch { return blocked("PRODUCTION_CONTINUITY_INVALID"); }

  let versionBackup;
  if (paths.has("--version-backup-root")) {
    try {
      versionBackup = require("./isolated-file-cleanup-version-backup.cjs").verifyVersionBackup(
        paths.get("--version-backup-root"), paths.get("--version-restore-root"),
        envelope.payload, source, readInput);
    } catch { return blocked("VERSION_BACKUP_INVALID"); }
  }
  let scopeAuthorization;
  let executionIdentity;
  let executionCodeIdentity;
  let writeFreezeLease;
  let executionAuthorization;
  let approvedInspection;
  try {
    scopeAuthorization = validateScopeAuthorization(
      readInput(paths.get("--scope-authorization")), envelope.payload, source);
  } catch { return blocked("SCOPE_AUTHORIZATION_INVALID"); }
  try {
    executionIdentity = readTrustedExecutionIdentity();
    if (executionIdentity.environment !== source.environment ||
        executionIdentity.executorIdentity !== source.executorIdentity ||
        executionIdentity.deploymentIdentitySha256 !== source.deploymentIdentitySha256) {
      return blocked("EXECUTION_IDENTITY_INVALID");
    }
  } catch { return blocked("EXECUTION_IDENTITY_INVALID"); }
  try {
    executionCodeIdentity = currentCodeIdentity();
    if (executionCodeIdentity.codeSha !== source.codeSha ||
        executionCodeIdentity.executionCodeSha256 !== source.executionCodeSha256) {
      return blocked("EXECUTION_CODE_BINDING_FAILED");
    }
  } catch { return blocked("EXECUTION_CODE_IDENTITY_INVALID"); }
  try {
    writeFreezeLease = validateWriteFreeze(envelope.payload, source, executionIdentity,
      paths.get("--batch-id"), scopeAuthorization);
  } catch { return blocked("WRITE_FREEZE_INVALID"); }
  if (paths.has("--execution-authorization")) {
    try {
      approvedInspection = readInput(paths.get("--inspection-report"));
      executionAuthorization = validateExecutionAuthorization(
        readInput(paths.get("--execution-authorization")), approvedInspection,
        envelope.payload, source, executionIdentity, paths.get("--batch-id"),
        scopeAuthorization, writeFreezeLease);
    } catch { return blocked("EXECUTION_AUTHORIZATION_INVALID"); }
  }
  try { assertProductionInspectionBoundary(source); }
  catch { return blocked("PRODUCTION_RUNTIME_INVALID"); }
  if (command === "dry-run" && !process.env.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL?.trim()) {
    return blocked("PRODUCTION_RESTORE_DATABASE_REQUIRED");
  }

  const verifyAuthority = () => {
    same(readInput(paths.get("--scope")), envelope);
    same(readInput(paths.get("--source-report")), source);
    same(validateProductionContinuity(readInput(paths.get("--schema-continuity-envelope")),
      readInput(paths.get("--pol25a-receipt"), true), source, envelope.payload,
      readTrustedSchemaContinuityPublicKey(), POL25A_RECEIPT_SHA256), productionContinuity);
    assertProductionInspectionBoundary(source);
    const currentScope = validateScopeAuthorization(readInput(paths.get("--scope-authorization")),
      envelope.payload, source);
    same(currentScope, scopeAuthorization);
    const currentIdentity = readTrustedExecutionIdentity();
    same(currentIdentity, executionIdentity);
    same(currentCodeIdentity(), executionCodeIdentity);
    const currentFreeze = validateWriteFreeze(envelope.payload, source, currentIdentity,
      paths.get("--batch-id"), currentScope);
    same(currentFreeze, writeFreezeLease);
    if (executionAuthorization) {
      const currentReport = readInput(paths.get("--inspection-report"));
      same(currentReport, approvedInspection);
      same(validateExecutionAuthorization(readInput(paths.get("--execution-authorization")),
        currentReport, envelope.payload, source, currentIdentity, paths.get("--batch-id"),
        currentScope, currentFreeze), executionAuthorization);
    }
  };
  if (!/^postgres(?:ql)?:\/\//u.test(process.env.DATABASE_URL ?? "")) {
    return blocked("DATABASE_NOT_CONFIGURED");
  }
  const inspection = await inspectReadOnlyFacts({
    scope: envelope.payload, source, databaseUrl: process.env.DATABASE_URL,
    restoreDatabaseUrl: process.env.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL?.trim(),
    versionBackup, boundedCosFetch,
    loadBackup: () => paths.has("--backup-receipt") ? readInput(paths.get("--backup-receipt")) : null
  });
  if (inspection.status === "blocked") return blocked(inspection.code);
  const { result, backup, databaseRestoreProof, objectSnapshots } = inspection;
  if (approvedInspection) {
    const current = {
      schemaDigest: result.schemaDigest, migrationHead: result.migrationHead,
      migrationCount: result.migrationCount, backupReceiptSha256: backup.receiptSha256,
      versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
      objectSnapshotsSha256: sha256(objectSnapshots)
    };
    if (Object.entries(current).some(([field, value]) => approvedInspection[field] !== value) ||
        sha256(approvedInspection.productionContinuity) !== sha256(productionContinuity) ||
        sha256(stableProof(approvedInspection.databaseRestoreProof)) !==
          sha256(stableProof(databaseRestoreProof))) {
      return blocked("APPROVED_INSPECTION_DRIFT");
    }
  }
  try { verifyAuthority(); }
  catch { return blocked("AUTHORITY_CHANGED_DURING_INSPECTION"); }

  const evidence = {
    schemaVersion: 1, mode: "isolated_file_cleanup_inspection", status: "blocked", executed: false,
    eligibleForExecution: false, eligibleForIsolatedExecution: false,
    generatedAt: new Date().toISOString(), sourceReportSha256: source.reportSha256,
    scopeSha256: sha256(envelope.payload), targets: envelope.payload.files,
    databaseFingerprint: result.databaseFingerprint, schemaDigest: result.schemaDigest,
    migrationHead: result.migrationHead, migrationCount: result.migrationCount,
    backupReceiptSha256: backup.receiptSha256,
    versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
    databaseRestoreProof: databaseRestoreProof ?? null,
    executionIdentity, executionCodeIdentity, productionContinuity, scopeAuthorization,
    writeFreezeLease, executionAuthorization: executionAuthorization ?? null,
    batchId: paths.get("--batch-id"), objectSnapshots,
    objectSnapshotsSha256: sha256(objectSnapshots),
    blockers: [
      ...(!databaseRestoreProof ? ["DATABASE_RESTORE_ROW_PROOF_REQUIRED"] : []),
      ...(!executionAuthorization ? ["EXECUTION_AUTHORIZATION_REQUIRED"] : []),
      "PRODUCTION_EXECUTION_NOT_ENABLED"
    ]
  };
  if (command === "dry-run") {
    Object.assign(evidence, {
      mode: "isolated_file_cleanup_dry_run", status: "verified",
      approvedInspectionSha256: approvedInspection.reportSha256,
      operations: envelope.payload.files.map(file => {
        const object = objectSnapshots.find(item => item.fileId === file.id);
        return { database: { table: "FileObject", primaryKey: { id: file.id }, rowSha256: file.rowSha256 },
          object: { bucket: object.bucket, objectKey: object.objectKey, ...object.snapshot } };
      }),
      recovery: {
        databaseBackupReceiptSha256: backup.receiptSha256,
        databaseBackupSha256: backup.databaseBackup.sha256,
        databaseBackupLocation: backup.databaseBackup.location,
        databaseRestoreTarget: backup.databaseBackup.restoreTarget,
        databaseRestoreFingerprint: databaseRestoreProof.restoredDatabaseFingerprint,
        retainedRowsSha256: databaseRestoreProof.retainedRowsSha256,
        privateFileBackupSha256: backup.privateFileBackup.sha256,
        privateFileBackupLocation: backup.privateFileBackup.location,
        privateFileRestoreTarget: backup.privateFileBackup.restoreTarget,
        versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
        versionManifestSha256: versionBackup ? sha256(versionBackup.manifest) : null,
        versionBackupRoot: versionBackup ? fs.realpathSync(paths.get("--version-backup-root")) : null,
        versionRestoreRoot: versionBackup ? fs.realpathSync(paths.get("--version-restore-root")) : null
      }
    });
  }
  writeInspectionEvidence(paths.get("--output"), evidence);
  if (command === "dry-run") {
    process.stdout.write(`${JSON.stringify({ status: "dry_run_verified", code: "DRY_RUN_VERIFIED", executed: false })}\n`);
    return;
  }
  return blocked(executionAuthorization ? "PRODUCTION_EXECUTION_NOT_ENABLED" :
    "EXECUTION_AUTHORIZATION_REQUIRED");
}

const runMain = createTrustedEntrypoint(
  () => main(process.argv.slice(2)).catch(() => blocked("INPUT_REJECTED")),
  "生产独立文件清理已安全阻断"
);
module.exports = { runMain };
if (require.main === module) blocked("TRUSTED_LAUNCHER_REQUIRED");
