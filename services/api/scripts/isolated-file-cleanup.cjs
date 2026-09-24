#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require("node:fs");
const path = require("node:path");
const { sha256, validateBackupReceipt, verifyObjectSnapshot } = require("./business-zeroing-core.cjs");

function readInput(filePath, raw = false) {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    const maxBytes = 16 * 1024 * 1024;
    if (!before.isFile() || before.size > maxBytes) throw new Error("INPUT_REJECTED");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fs.fstatSync(fd);
    if (length !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("INPUT_REJECTED");
    return raw ? buffer.subarray(0, length) : JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally { fs.closeSync(fd); }
}

// This independent entrypoint must never turn a POL-22 blocked report into ready.
// Runtime evidence and execution are introduced in separate, tested slices.
function blocked(code) {
  process.stdout.write(`${JSON.stringify({ status: "blocked", code, executed: false })}\n`);
  process.exitCode = 2;
}

function boundedCosFetch() {
  const seen = new Set();
  const deadline = Date.now() + 60000;
  let totalBytes = 0;
  return async (input, init) => {
    const url = new URL(input);
    const expectedHost = `${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com`;
    const remaining = deadline - Date.now();
    if (url.protocol !== "https:" || url.host !== expectedHost || url.pathname !== "/" ||
        init?.method !== "GET" || remaining <= 0 || seen.size >= 1000 || seen.has(url.href)) {
      throw new Error("COS_REQUEST_BOUNDARY");
    }
    seen.add(url.href);
    const controller = new AbortController();
    let response;
    let reader;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      rejectTimeout(new Error("COS_REQUEST_TIMEOUT"));
      controller.abort();
      reader?.cancel().catch(() => undefined);
    }, Math.min(10000, remaining));
    try {
      response = await Promise.race([fetch(url, { ...init, redirect: "error", signal: controller.signal }), timeout]);
      if (!response.ok || !response.body) throw new Error("COS_RESPONSE_REJECTED");
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      let part = await Promise.race([reader.read(), timeout]);
      while (!part.done) {
        bytes += part.value.byteLength;
        totalBytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024 || totalBytes > 16 * 1024 * 1024) throw new Error("COS_RESPONSE_LIMIT");
        chunks.push(Buffer.from(part.value));
        part = await Promise.race([reader.read(), timeout]);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      // Require an explicit, unambiguous terminal/pagination signal instead
      // of letting the legacy parser treat an absent flag as false.
      const flags = [...text.matchAll(/<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/gu)];
      if (flags.length !== 1 || (text.match(/<IsTruncated\b/gu) || []).length !== 1 ||
          !/^\s*(?:<\?xml[^?]*\?>\s*)?<ListVersionsResult(?:\s[^>]*)?>[\s\S]*<\/ListVersionsResult>\s*$/u.test(text) ||
          /<!/u.test(text)) throw new Error("COS_PAGINATION_INVALID");
      if (flags[0][1] === "true") {
        for (const tag of ["NextKeyMarker", "NextVersionIdMarker"]) {
          const values = [...text.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, "gu"))];
          if (values.length !== 1 || !values[0][1].trim()) throw new Error("COS_CURSOR_MISSING");
        }
      }
      return new Response(text, { status: response.status, headers: { "content-type": "application/xml" } });
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) { reader.cancel().catch(() => undefined); reader.releaseLock(); }
      else response?.body?.cancel().catch(() => undefined);
    }
  };
}

function writeInspectionEvidence(outputPath, body) {
  if (!path.isAbsolute(outputPath) || outputPath.endsWith(path.sep)) throw new Error("OUTPUT_REJECTED");
  const parent = path.dirname(outputPath);
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0) throw new Error("OUTPUT_REJECTED");
  const canonicalParent = fs.realpathSync(parent);
  const directoryFd = fs.openSync(canonicalParent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let fd;
  try {
    fd = fs.openSync(path.join(canonicalParent, path.basename(outputPath)),
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify({ ...body, reportSha256: sha256(body) }, null, 2)}\n`);
    let written = 0;
    while (written < bytes.length) {
      const count = fs.writeSync(fd, bytes, written, bytes.length - written);
      if (count === 0) throw new Error("OUTPUT_REJECTED");
      written += count;
    }
    fs.fsyncSync(fd);
    fs.fsyncSync(directoryFd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.closeSync(directoryFd);
  }
}

async function main(argv) {
  const [command, ...options] = argv;
  if (!["inspect", "dry-run", "execute", "postcheck"].includes(command)) return blocked("COMMAND_NOT_AVAILABLE");
  const paths = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!["--scope", "--source-report", "--backup-receipt", "--scope-authorization", "--version-backup-root", "--version-restore-root", "--batch-id", "--output", "--inspection-report", "--execution-authorization", "--plan", "--apply-authorization", "--journal-root", "--confirm"].includes(key) || paths.has(key) || !value || value.startsWith("--")) {
      return blocked("INVALID_ARGUMENTS");
    }
    paths.set(key, value);
  }
  if (!paths.has("--scope")) return blocked("INVALID_ARGUMENTS");
  const applyFlags = ["--plan", "--apply-authorization", "--journal-root", "--confirm"];
  if (["execute", "postcheck"].includes(command)) {
    if ([...applyFlags, "--execution-authorization", "--inspection-report", "--batch-id"].some(flag => !paths.has(flag))) return blocked("APPLY_ARGUMENTS_REQUIRED");
    if (paths.has("--output") || paths.get("--confirm") !== `EXECUTE_ISOLATED_FILE_CLEANUP_${paths.get("--batch-id")}`) return blocked("INVALID_ARGUMENTS");
  } else if (applyFlags.some(flag => paths.has(flag))) return blocked("INVALID_ARGUMENTS");
  if (command === "dry-run") {
    if (!paths.has("--execution-authorization")) return blocked("DRY_RUN_AUTHORIZATION_REQUIRED");
    if (!paths.has("--output")) return blocked("DRY_RUN_OUTPUT_REQUIRED");
  }
  if (paths.has("--inspection-report") !== paths.has("--execution-authorization") ||
      (paths.has("--execution-authorization") && !paths.has("--batch-id"))) return blocked("INVALID_ARGUMENTS");
  if (paths.has("--batch-id") && !/^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(paths.get("--batch-id"))) {
    return blocked("INVALID_ARGUMENTS");
  }
  if (paths.has("--batch-id") && !paths.has("--scope-authorization")) return blocked("AUTHORIZATION_REQUIRED");
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
    !/^[0-9a-f]{64}$/u.test(file.rowSha256)
  )) return blocked("INVALID_EXACT_TARGET");
  if (!paths.has("--source-report")) return blocked("SOURCE_REPORT_REQUIRED");
  const source = readInput(paths.get("--source-report"));
  const { reportSha256, ...body } = source;
  if (!/^[0-9a-f]{64}$/u.test(reportSha256) || sha256(body) !== reportSha256) {
    return blocked("SOURCE_REPORT_INTEGRITY_FAILED");
  }
  if (envelope.payload.sourceReportSha256 !== reportSha256) return blocked("SOURCE_REPORT_BINDING_FAILED");
  if (source.mode !== "read_only_preflight" || source.status !== "blocked" || source.executed !== false ||
      !Array.isArray(source.blockers) || !Array.isArray(source.deletionCandidates) || source.deletionCandidates.length !== 0) {
    return blocked("INVALID_SOURCE_REPORT");
  }
  const orphans = source.blockers.filter(item => item.code === "ORPHAN_FILE");
  const sourceIds = orphans.map(item => item.details?.primaryKey?.id).sort();
  const targetIds = envelope.payload.files.map(file => file.id).sort();
  if (orphans.length !== 2 || new Set(sourceIds).size !== 2 ||
      JSON.stringify(sourceIds) !== JSON.stringify(targetIds)) return blocked("SOURCE_TARGET_MISMATCH");
  if (paths.has("--version-backup-root") !== paths.has("--version-restore-root")) return blocked("INVALID_ARGUMENTS");
  let versionBackup;
  if (paths.has("--version-backup-root")) {
    try {
      const { verifyVersionBackup } = require("./isolated-file-cleanup-version-backup.cjs");
      versionBackup = verifyVersionBackup(paths.get("--version-backup-root"), paths.get("--version-restore-root"), envelope.payload, source, readInput);
    } catch { return blocked("VERSION_BACKUP_INVALID"); }
  }
  let scopeAuthorization;
  let executionIdentity;
  let executionCodeIdentity;
  let writeFreezeLease;
  let executionAuthorization;
  let approvedInspection;
  if (paths.has("--scope-authorization")) {
    try {
      const { validateScopeAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
      scopeAuthorization = validateScopeAuthorization(readInput(paths.get("--scope-authorization")), envelope.payload, source);
    } catch { return blocked("SCOPE_AUTHORIZATION_INVALID"); }
    try {
      const { readTrustedExecutionIdentity } = require("./business-zeroing-cli.cjs");
      const identity = readTrustedExecutionIdentity();
      if (identity.environment !== source.environment || identity.executorIdentity !== source.executorIdentity ||
          identity.deploymentIdentitySha256 !== source.deploymentIdentitySha256) {
        return blocked("EXECUTION_IDENTITY_INVALID");
      }
      executionIdentity = identity;
    } catch { return blocked("EXECUTION_IDENTITY_INVALID"); }
    try {
      // Bind the signed source to the actual clean checkout and runtime before
      // database access. Final execution authorization is still required.
      const { currentCodeIdentity } = require("./business-zeroing-cli.cjs");
      const actual = currentCodeIdentity();
      if (actual.codeSha !== source.codeSha || actual.executionCodeSha256 !== source.executionCodeSha256) {
        return blocked("EXECUTION_CODE_BINDING_FAILED");
      }
      executionCodeIdentity = actual;
    } catch { return blocked("EXECUTION_CODE_IDENTITY_INVALID"); }
    if (paths.has("--batch-id")) {
      try {
        const { validateWriteFreeze } = require("./isolated-file-cleanup-authorization.cjs");
        writeFreezeLease = validateWriteFreeze(envelope.payload, source, executionIdentity, paths.get("--batch-id"), scopeAuthorization);
      } catch { return blocked("WRITE_FREEZE_INVALID"); }
    }
  }
  if (paths.has("--execution-authorization")) {
    try {
      const { validateExecutionAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
      approvedInspection = readInput(paths.get("--inspection-report"));
      executionAuthorization = validateExecutionAuthorization(readInput(paths.get("--execution-authorization")),
        approvedInspection, envelope.payload, source, executionIdentity, paths.get("--batch-id"), scopeAuthorization, writeFreezeLease);
    } catch { return blocked("EXECUTION_AUTHORIZATION_INVALID"); }
  }
  const { assertLocalExecutionBoundary } = require("./isolated-file-cleanup-local-boundary.cjs");
  if (["dry-run", "execute", "postcheck"].includes(command)) {
    try { await assertLocalExecutionBoundary(source); }
    catch { return blocked("LOCAL_ISOLATION_REQUIRED"); }
  }
  const verifyAuthority = () => {
    const { validateScopeAuthorization, validateWriteFreeze, validateExecutionAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
    const { readTrustedExecutionIdentity, currentCodeIdentity } = require("./business-zeroing-cli.cjs");
    const same = (left, right) => { if (sha256(left) !== sha256(right)) throw new Error("AUTHORITY_CHANGED"); };
    same(readInput(paths.get("--scope")), envelope);
    same(readInput(paths.get("--source-report")), source);
    const currentScope = validateScopeAuthorization(readInput(paths.get("--scope-authorization")), envelope.payload, source);
    same(currentScope, scopeAuthorization);
    const identity = readTrustedExecutionIdentity();
    same(identity, executionIdentity);
    same(currentCodeIdentity(), executionCodeIdentity);
    const freeze = writeFreezeLease ? validateWriteFreeze(envelope.payload, source, identity, paths.get("--batch-id"), currentScope) : null;
    if (writeFreezeLease) same(freeze, writeFreezeLease);
    if (executionAuthorization) {
      const report = readInput(paths.get("--inspection-report"));
      same(report, approvedInspection);
      same(validateExecutionAuthorization(readInput(paths.get("--execution-authorization")), report,
        envelope.payload, source, identity, paths.get("--batch-id"), currentScope, freeze), executionAuthorization);
    }
  };
  const validateSavedPlan = plan => {
    const { validateApplyAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
    if (sha256(plan.executionAuthorization) !== sha256(executionAuthorization) ||
        sha256(plan.scopeAuthorization) !== sha256(scopeAuthorization) || sha256(plan.writeFreezeLease) !== sha256(writeFreezeLease) ||
        sha256(plan.executionIdentity) !== sha256(executionIdentity) || sha256(plan.executionCodeIdentity) !== sha256(executionCodeIdentity) ||
        plan.scopeSha256 !== sha256(envelope.payload) || plan.sourceReportSha256 !== source.reportSha256 || plan.batchId !== paths.get("--batch-id")) {
      throw new Error("PLAN_AUTHORITY_CHANGED");
    }
    return validateApplyAuthorization(readInput(paths.get("--apply-authorization")), plan, plan, paths.get("--journal-root"));
  };
  if (!/^postgres(?:ql)?:\/\//u.test(process.env.DATABASE_URL ?? "")) return blocked("DATABASE_NOT_CONFIGURED");
  const { PrismaClient } = require("@prisma/client");
  const runCleanup = async plan => {
    const { Logger } = require("@nestjs/common");
    Logger.overrideLogger(false);
    const { CosVersionedObjectStorage } = require("../dist/file/versioned-object-storage");
    const { executeCleanup, postcheckCleanup } = require("./isolated-file-cleanup-execution.cjs");
    const executionClient = new PrismaClient();
    const guard = async () => {
      await assertLocalExecutionBoundary(source);
      verifyAuthority();
      if (sha256(readInput(paths.get("--plan"))) !== sha256(plan)) throw new Error("PLAN_CHANGED");
      validateSavedPlan(plan);
    };
    const listVersions = async object => {
      await assertLocalExecutionBoundary(source);
      if (object.bucket !== process.env.COS_BUCKET || !plan.operations.some(item => item.object.objectKey === object.objectKey && item.object.bucket === object.bucket)) {
        throw new Error("OBJECT_SCOPE_INVALID");
      }
      return new CosVersionedObjectStorage({ fetchImpl: boundedCosFetch() }).listObjectVersions(object.objectKey);
    };
    const deleteVersion = async (object, versionId) => {
      await assertLocalExecutionBoundary(source);
      if (!plan.operations.some(item => item.object.bucket === object.bucket && item.object.objectKey === object.objectKey &&
          item.object.versions.some(version => version.versionId === versionId))) throw new Error("VERSION_SCOPE_INVALID");
      let requested = false;
      const fetchImpl = async (input, init) => {
        const url = new URL(input);
        // The existing adapter lowercases query names for signing and URL
        // construction. Preserve its signature, but send the COS wire name.
        if ([...url.searchParams].length === 1 && url.searchParams.get("versionid") === versionId) {
          url.searchParams.delete("versionid");
          url.searchParams.set("versionId", versionId);
        }
        if (requested || init?.method !== "DELETE" || url.protocol !== "https:" ||
            url.host !== "private-local.cos.ap-test.myqcloud.com" ||
            decodeURIComponent(url.pathname) !== `/${object.objectKey}` || [...url.searchParams].length !== 1 ||
            url.searchParams.get("versionId") !== versionId) throw new Error("DELETE_TRANSPORT_BOUNDARY");
        requested = true;
        const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
        response.body?.cancel().catch(() => undefined);
        if (response.status !== 204) throw new Error("DELETE_NOT_CONFIRMED");
        return new Response(null, { status: 204 });
      };
      await new CosVersionedObjectStorage({ fetchImpl }).deleteObjectVersion(object.objectKey, versionId);
    };
    try {
      await guard();
      const options = { client: executionClient, scope: envelope.payload, source, plan,
        root: paths.get("--journal-root"), readInput, verifyAuthority: guard, listVersions, deleteVersion,
        completeDatabase: (audit, versions) => require("./isolated-file-cleanup-database.cjs").completeCleanupDatabase(
          executionClient, envelope.payload, source, plan, audit, versions, guard),
        recordFailureAudit: (audit, completionAudit, versions) =>
          require("./isolated-file-cleanup-database.cjs").recordFailedAfterCommit(
            executionClient, envelope.payload, source, plan, audit, completionAudit, versions, guard) };
      await (command === "postcheck" ? postcheckCleanup(options) : executeCleanup(options));
      process.stdout.write(`${JSON.stringify({ status: command === "postcheck" ? "completed" : "postcheck_required",
        code: command === "postcheck" ? "POSTCHECK_PASSED" : "EXECUTION_APPLIED_PENDING_POSTCHECK", executed: true })}\n`);
    } catch (error) {
      const knownFailures = new Set(["POSTCHECK_AUDIT_PROOF_INVALID", "POSTCHECK_AUDIT_MISMATCH",
        "POSTCHECK_DATABASE_DRIFT", "POSTCHECK_RETAINED_ROWS_DRIFT", "EXECUTION_OBJECT_DRIFT",
        "DELETE_TRANSPORT_BOUNDARY", "DELETE_NOT_CONFIRMED", "EXECUTION_JOURNAL_INVALID",
        "EXECUTION_JOURNAL_TRANSITION_INVALID", "LOCAL_ISOLATION_REQUIRED"]);
      const reason = error.cause?.message ?? error.message;
      const outcome = error.databaseOutcome ?? (command === "postcheck" ? "unknown" : "not_started");
      process.stdout.write(`${JSON.stringify({ status: "blocked", code: "EXECUTION_STOPPED_RECONCILIATION_REQUIRED",
        reasonCode: knownFailures.has(reason) ? reason : "UNCLASSIFIED_FAILURE",
        executed: outcome === "committed" ? true : outcome === "unknown" ? null : false,
        databaseOutcome: outcome })}\n`);
      process.exitCode = 2;
    } finally { await executionClient.$disconnect(); }
  };
  if (["execute", "postcheck"].includes(command)) {
    try {
      const plan = readInput(paths.get("--plan"));
      verifyAuthority();
      validateSavedPlan(plan);
      const journalPath = path.join(paths.get("--journal-root"), paths.get("--batch-id"));
      if (command === "postcheck") return runCleanup(plan);
      if (fs.existsSync(journalPath)) return blocked("EXECUTION_JOURNAL_EXISTS");
    } catch { return blocked("APPLY_AUTHORIZATION_INVALID"); }
  }
  const { inspectTargets } = require("./isolated-file-cleanup-database.cjs");
  const client = new PrismaClient();
  let result;
  try {
    result = await inspectTargets(client, envelope.payload, source);
    if (typeof result === "string") return blocked(result);
  } catch {
    return blocked("DATABASE_INSPECTION_FAILED");
  } finally {
    await client.$disconnect();
  }
  if (versionBackup && result.files.some(file => {
    const object = versionBackup.manifest.objects.find(item => item.databaseFileIds.includes(file.id));
    const latest = object?.versions.find(version => version.isLatest);
    return !object || object.bucket !== file.bucket || object.objectKey !== file.objectKey ||
      !Array.isArray(object.databaseStorageStatuses) || object.databaseStorageStatuses.length !== 1 ||
      object.databaseStorageStatuses[0] !== file.storageStatus || latest?.sizeBytes !== file.sizeBytes ||
      (file.contentSha256 !== null && latest?.contentSha256 !== file.contentSha256);
  })) return blocked("VERSION_BACKUP_BINDING_FAILED");
  if (!paths.has("--backup-receipt")) return blocked("BACKUP_RECEIPT_REQUIRED");
  let backup;
  try {
    backup = readInput(paths.get("--backup-receipt"));
    validateBackupReceipt(backup, source.environment, result.databaseFingerprint, new Date().toISOString());
    const { verifyBackupArtifacts } = require("./inspect-test-business-zeroing.cjs");
    await verifyBackupArtifacts(backup);
    if (backup.databaseBackup.restoreEvidence.migrationCount !== result.migrationCount ||
        backup.databaseBackup.restoreEvidence.migrationHead !== result.migrationHead) {
      return blocked("BACKUP_MIGRATION_MISMATCH");
    }
  } catch { return blocked("BACKUP_RESTORE_EVIDENCE_INVALID"); }
  let databaseRestoreProof;
  const restoreDatabaseUrl = process.env.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL?.trim();
  if (restoreDatabaseUrl) {
    if (!/^postgres(?:ql)?:\/\//u.test(restoreDatabaseUrl)) return blocked("RESTORE_DATABASE_NOT_CONFIGURED");
    const restoredClient = new PrismaClient({ datasources: { db: { url: restoreDatabaseUrl } } });
    try {
      const { verifyRestoredDatabase } = require("./isolated-file-cleanup-database.cjs");
      databaseRestoreProof = await verifyRestoredDatabase(restoredClient, envelope.payload, result, backup);
      if (typeof databaseRestoreProof === "string") return blocked(databaseRestoreProof);
    } catch { return blocked("RESTORE_DATABASE_INSPECTION_FAILED"); }
    finally { await restoredClient.$disconnect(); }
  }
  const objectSnapshots = [];
  try {
    const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");
    let versionedStorage;
    if (process.env.COS_BUCKET?.trim()) {
      // This standalone process exposes only its redacted JSON result. Keep
      // provider diagnostics out of stdout/stderr and stop at the first failed
      // request; the original POL-22 adapter's retry defaults stay unchanged.
      const { Logger } = require("@nestjs/common");
      Logger.overrideLogger(false);
      const { CosVersionedObjectStorage, withObjectStorageRetry } = require("../dist/file/versioned-object-storage");
      versionedStorage = { client: new CosVersionedObjectStorage({ fetchImpl: boundedCosFetch() }),
        retry: operation => withObjectStorageRetry(operation, { maxAttempts: 1 }) };
    }
    const storage = createExactObjectStorage({ versionedStorage });
    for (const file of result.files) {
      const snapshot = await storage.inspectExactObject({
        bucket: file.bucket, objectKey: file.objectKey, maxModifiedAt: backup.privateFileBackup.capturedAt
      });
      verifyObjectSnapshot(snapshot);
      if (snapshot.kind === "cos_versions") {
        // The offline verifier has already checked every data blob and its
        // independent restored copy. Bind that proof to the entire live set,
        // including old versions and delete markers, never just the latest.
        if (!versionBackup) return blocked("COS_BACKUP_COVERAGE_UNPROVEN");
        const object = versionBackup.manifest.objects.find(item => item.databaseFileIds[0] === file.id);
        const comparable = versions => versions.map(version => {
          if (!version.isDeleteMarker && (!Number.isSafeInteger(version.sizeBytes) || version.sizeBytes < 0)) {
            throw new Error("INVALID_VERSION_SIZE");
          }
          return { versionId: version.versionId, isDeleteMarker: version.isDeleteMarker, isLatest: version.isLatest,
            lastModified: new Date(version.lastModified).toISOString(),
            ...(!version.isDeleteMarker ? { sizeBytes: version.sizeBytes } : {}) };
        }).sort((a, b) => a.versionId.localeCompare(b.versionId));
        if (sha256(comparable(snapshot.versions)) !== sha256(comparable(object.versions))) {
          return blocked("COS_VERSION_BACKUP_MISMATCH");
        }
      } else {
        const matches = backup.privateFileBackup.sourceObjects.filter(object => object.objectKey === file.objectKey);
        if (matches.length !== 1 || matches[0].sha256 !== snapshot.contentSha256 ||
            matches[0].sizeBytes !== snapshot.sizeBytes || file.sizeBytes !== snapshot.sizeBytes ||
            (file.contentSha256 !== null && file.contentSha256 !== snapshot.contentSha256)) {
          return blocked("OBJECT_BACKUP_MISMATCH");
        }
      }
      objectSnapshots.push({ fileId: file.id, bucket: file.bucket, objectKey: file.objectKey, snapshot });
    }
  } catch { return blocked("OBJECT_SNAPSHOT_FAILED"); }
  if (approvedInspection) {
    const stableProof = proof => {
      if (!proof) return null;
      return Object.fromEntries(Object.entries(proof).filter(([field]) => field !== "verifiedAt"));
    };
    const current = { schemaDigest: result.schemaDigest, migrationHead: result.migrationHead, migrationCount: result.migrationCount,
      backupReceiptSha256: backup.receiptSha256, versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
      objectSnapshotsSha256: sha256(objectSnapshots) };
    if (Object.entries(current).some(([field, value]) => approvedInspection[field] !== value) ||
        sha256(stableProof(approvedInspection.databaseRestoreProof)) !== sha256(stableProof(databaseRestoreProof))) {
      return blocked("APPROVED_INSPECTION_DRIFT");
    }
  }
  if (scopeAuthorization) {
    // Database/object checks may take time. Never publish a plan using only
    // the authority observed at entry. Re-read fixed control-plane materials,
    // recheck expiry and reject even a newly valid but different generation.
    try {
      const { validateScopeAuthorization, validateWriteFreeze, validateExecutionAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
      const { readTrustedExecutionIdentity, currentCodeIdentity } = require("./business-zeroing-cli.cjs");
      const same = (left, right) => {
        if (sha256(left) !== sha256(right)) throw new Error("AUTHORITY_CHANGED");
      };
      same(readInput(paths.get("--scope")), envelope);
      same(readInput(paths.get("--source-report")), source);
      const currentScope = validateScopeAuthorization(readInput(paths.get("--scope-authorization")), envelope.payload, source);
      same(currentScope, scopeAuthorization);
      const currentIdentity = readTrustedExecutionIdentity();
      same(currentIdentity, executionIdentity);
      same(currentCodeIdentity(), executionCodeIdentity);
      let currentFreeze;
      if (writeFreezeLease) {
        currentFreeze = validateWriteFreeze(envelope.payload, source, currentIdentity, paths.get("--batch-id"), currentScope);
        same(currentFreeze, writeFreezeLease);
      }
      if (executionAuthorization) {
        const currentReport = readInput(paths.get("--inspection-report"));
        same(currentReport, approvedInspection);
        same(validateExecutionAuthorization(readInput(paths.get("--execution-authorization")), currentReport,
          envelope.payload, source, currentIdentity, paths.get("--batch-id"), currentScope, currentFreeze), executionAuthorization);
      }
    } catch { return blocked("AUTHORITY_CHANGED_DURING_INSPECTION"); }
  }
  if (paths.has("--output") || command === "execute") {
    const evidence = {
      schemaVersion: 1, mode: "isolated_file_cleanup_inspection", status: "blocked", executed: false,
      eligibleForExecution: false, eligibleForIsolatedExecution: false, generatedAt: new Date().toISOString(),
      sourceReportSha256: source.reportSha256, scopeSha256: sha256(envelope.payload), targets: envelope.payload.files,
      databaseFingerprint: result.databaseFingerprint, schemaDigest: result.schemaDigest,
      migrationHead: result.migrationHead, migrationCount: result.migrationCount,
      backupReceiptSha256: backup.receiptSha256, versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
      databaseRestoreProof: databaseRestoreProof ?? null,
      executionIdentity: executionIdentity ?? null, executionCodeIdentity: executionCodeIdentity ?? null,
      scopeAuthorization: scopeAuthorization ?? null, writeFreezeLease: writeFreezeLease ?? null,
      executionAuthorization: executionAuthorization ?? null,
      batchId: paths.get("--batch-id") ?? null, objectSnapshots, objectSnapshotsSha256: sha256(objectSnapshots),
      blockers: [
        ...(!scopeAuthorization ? ["AUTHORIZATION_REQUIRED"] : []),
        ...(!paths.has("--batch-id") ? ["BATCH_ID_REQUIRED"] : []),
        ...(!writeFreezeLease ? ["WRITE_FREEZE_REQUIRED"] : []),
        ...(!databaseRestoreProof ? ["DATABASE_RESTORE_ROW_PROOF_REQUIRED"] : []),
        ...(!executionAuthorization ? ["EXECUTION_AUTHORIZATION_REQUIRED"] : []), "PRODUCTION_EXECUTION_NOT_ENABLED"
      ]
    };
    if (command === "dry-run" || command === "execute") {
      // The plan records exact targets and recovery anchors only. It is not a
      // terminal marker, an execution journal, or permission to mutate either
      // medium. All inspection and approved-checkpoint gates above still run.
      Object.assign(evidence, {
        mode: "isolated_file_cleanup_dry_run", status: "verified",
        eligibleForIsolatedExecution: Boolean(scopeAuthorization && writeFreezeLease &&
          executionAuthorization && databaseRestoreProof && versionBackup),
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
    if (command === "execute") {
      let plan, applyEnvelope, applyAuthorization;
      try {
        plan = readInput(paths.get("--plan"));
        applyEnvelope = readInput(paths.get("--apply-authorization"));
        const { validateApplyAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
        applyAuthorization = validateApplyAuthorization(applyEnvelope, plan, evidence, paths.get("--journal-root"));
      } catch { return blocked("APPLY_AUTHORIZATION_INVALID"); }
      try {
        const { prepareJournal } = require("./isolated-file-cleanup-journal.cjs");
        prepareJournal(paths.get("--journal-root"), paths.get("--batch-id"), plan, applyEnvelope, applyAuthorization);
      } catch (error) {
        return blocked(["EXECUTION_JOURNAL_EXISTS", "EXECUTION_JOURNAL_REJECTED"].includes(error.message) ? error.message : "EXECUTION_PREPARATION_FAILED");
      }
      return runCleanup(plan);
    }
    try { writeInspectionEvidence(paths.get("--output"), evidence); }
    catch { return blocked("OUTPUT_REJECTED"); }
    if (command === "dry-run") {
      process.stdout.write(`${JSON.stringify({ status: "dry_run_verified", code: "DRY_RUN_VERIFIED", executed: false })}\n`);
      return;
    }
  }
  return blocked(executionAuthorization ? "PRODUCTION_EXECUTION_NOT_ENABLED" :
    scopeAuthorization ? "EXECUTION_AUTHORIZATION_REQUIRED" : "AUTHORIZATION_REQUIRED");
}

const { createTrustedEntrypoint } = require("./business-zeroing-cli.cjs");
const runMain = createTrustedEntrypoint(
  () => main(process.argv.slice(2)).catch(() => blocked("INPUT_REJECTED")),
  "独立文件清理已安全阻断"
);
module.exports = { runMain };
if (require.main === module) blocked("TRUSTED_LAUNCHER_REQUIRED");
