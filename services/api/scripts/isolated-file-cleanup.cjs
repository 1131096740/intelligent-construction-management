#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require("node:fs");
const path = require("node:path");
const { isExactObjectKey, sha256 } = require("./business-zeroing-core.cjs");

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

function boundedCosFetch(objectKey, request = fetch) {
  if (!isExactObjectKey(objectKey) || typeof request !== "function") throw new Error("COS_REQUEST_BOUNDARY");
  const seen = new Set();
  const deadline = Date.now() + 60000;
  let totalBytes = 0;
  return async (input, init) => {
    const url = new URL(input);
    const expectedHost = `${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com`;
    const remaining = deadline - Date.now();
    const query = [...url.searchParams];
    const keys = query.map(([key]) => key).sort();
    const hasCursor = keys.includes("key-marker") || keys.includes("version-id-marker");
    const expectedKeys = hasCursor ? ["key-marker", "max-keys", "prefix", "version-id-marker", "versions"] :
      ["max-keys", "prefix", "versions"];
    const headers = new Headers(init?.headers);
    if (url.protocol !== "https:" || url.host !== expectedHost || url.pathname !== "/" ||
        url.username || url.password || url.hash || init?.method !== "GET" || init?.body != null ||
        !headers.get("Authorization") || headers.get("Host") !== expectedHost ||
        JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
        url.searchParams.get("versions") !== "" || url.searchParams.get("prefix") !== objectKey ||
        url.searchParams.get("max-keys") !== "1000" ||
        (hasCursor && (url.searchParams.get("key-marker") !== objectKey ||
          !url.searchParams.get("version-id-marker"))) ||
        remaining <= 0 || seen.size >= 1000 || seen.has(url.href)) {
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
      response = await Promise.race([request(url, { ...init, redirect: "error", signal: controller.signal }), timeout]);
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

async function main(argv, mode) {
  const [command, ...options] = argv;
  if (!["inspect", "dry-run", "execute", "postcheck"].includes(command)) return blocked("COMMAND_NOT_AVAILABLE");
  if (mode === "production" && !["inspect", "dry-run"].includes(command)) {
    return blocked("PRODUCTION_EXECUTION_NOT_ENABLED");
  }
  const paths = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!["--scope", "--source-report", "--backup-receipt", "--scope-authorization", "--version-backup-root", "--version-restore-root", "--batch-id", "--output", "--inspection-report", "--execution-authorization", "--plan", "--apply-authorization", "--journal-root", "--confirm", "--schema-continuity-envelope", "--pol25a-receipt"].includes(key) || paths.has(key) || !value || value.startsWith("--")) {
      return blocked("INVALID_ARGUMENTS");
    }
    paths.set(key, value);
  }
  if (!paths.has("--scope")) return blocked("INVALID_ARGUMENTS");
  if (mode === "local" && (paths.has("--schema-continuity-envelope") || paths.has("--pol25a-receipt"))) {
    return blocked("INVALID_ARGUMENTS");
  }
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
  if (mode === "production" && command === "dry-run" &&
      ["--scope", "--source-report", "--backup-receipt", "--scope-authorization", "--version-backup-root",
        "--version-restore-root", "--batch-id", "--output", "--inspection-report", "--execution-authorization",
        "--schema-continuity-envelope", "--pol25a-receipt"].some(flag => !paths.has(flag))) {
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
  let productionContinuity;
  if (mode === "production") {
    if (!paths.has("--schema-continuity-envelope") || !paths.has("--pol25a-receipt")) {
      return blocked("PRODUCTION_CONTINUITY_REQUIRED");
    }
    if (!paths.has("--scope-authorization") || !paths.has("--batch-id") || !paths.has("--output")) {
      return blocked("PRODUCTION_INSPECTION_AUTHORITY_REQUIRED");
    }
    try {
      const { POL25A_RECEIPT_SHA256, validateProductionContinuity } =
        require("./isolated-file-cleanup-production-contract.cjs");
      const { readTrustedSchemaContinuityPublicKey } = require("./business-zeroing-cli.cjs");
      productionContinuity = validateProductionContinuity(readInput(paths.get("--schema-continuity-envelope")),
        readInput(paths.get("--pol25a-receipt"), true), source, envelope.payload,
        readTrustedSchemaContinuityPublicKey(), POL25A_RECEIPT_SHA256);
    } catch { return blocked("PRODUCTION_CONTINUITY_INVALID"); }
  }
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
  if (mode === "production") {
    try {
      const { assertProductionInspectionBoundary } = require("./isolated-file-cleanup-production-boundary.cjs");
      assertProductionInspectionBoundary(source);
    } catch { return blocked("PRODUCTION_RUNTIME_INVALID"); }
    if (!writeFreezeLease || !scopeAuthorization || !executionIdentity || !executionCodeIdentity) {
      return blocked("PRODUCTION_INSPECTION_AUTHORITY_REQUIRED");
    }
    if (command === "dry-run" && !process.env.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL?.trim()) {
      return blocked("PRODUCTION_RESTORE_DATABASE_REQUIRED");
    }
  }
  const { assertLocalExecutionBoundary } = require("./isolated-file-cleanup-local-boundary.cjs");
  if (mode === "local" && ["dry-run", "execute", "postcheck"].includes(command)) {
    try { await assertLocalExecutionBoundary(source); }
    catch { return blocked("LOCAL_ISOLATION_REQUIRED"); }
  }
  const verifyAuthority = () => {
    const { validateScopeAuthorization, validateWriteFreeze, validateExecutionAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
    const { readTrustedExecutionIdentity, currentCodeIdentity } = require("./business-zeroing-cli.cjs");
    const same = (left, right) => { if (sha256(left) !== sha256(right)) throw new Error("AUTHORITY_CHANGED"); };
    same(readInput(paths.get("--scope")), envelope);
    same(readInput(paths.get("--source-report")), source);
    if (mode === "production") {
      const { POL25A_RECEIPT_SHA256, validateProductionContinuity } =
        require("./isolated-file-cleanup-production-contract.cjs");
      const { readTrustedSchemaContinuityPublicKey } = require("./business-zeroing-cli.cjs");
      require("./isolated-file-cleanup-production-boundary.cjs").assertProductionInspectionBoundary(source);
      same(validateProductionContinuity(readInput(paths.get("--schema-continuity-envelope")),
        readInput(paths.get("--pol25a-receipt"), true), source, envelope.payload,
        readTrustedSchemaContinuityPublicKey(), POL25A_RECEIPT_SHA256), productionContinuity);
    }
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
    if (sha256(plan.executionAuthorization) !== sha256(executionAuthorization) ||
        sha256(plan.scopeAuthorization) !== sha256(scopeAuthorization) || sha256(plan.writeFreezeLease) !== sha256(writeFreezeLease) ||
        sha256(plan.executionIdentity) !== sha256(executionIdentity) || sha256(plan.executionCodeIdentity) !== sha256(executionCodeIdentity) ||
        plan.scopeSha256 !== sha256(envelope.payload) || plan.sourceReportSha256 !== source.reportSha256 || plan.batchId !== paths.get("--batch-id")) {
      throw new Error("PLAN_AUTHORITY_CHANGED");
    }
    if (mode === "production") {
      const { validateProductionApplyAuthorization } = require("./isolated-file-cleanup-production-contract.cjs");
      const { readTrustedAuthorizationPublicKey } = require("./business-zeroing-cli.cjs");
      const currentBackup = readInput(paths.get("--backup-receipt"));
      const { receiptSha256, ...backupBody } = currentBackup;
      if (sha256(plan.productionContinuity) !== sha256(productionContinuity) ||
          plan.versionBackupReceiptSha256 !== versionBackup?.receiptSha256 ||
          !/^[0-9a-f]{64}$/u.test(receiptSha256) || sha256(backupBody) !== receiptSha256 ||
          plan.backupReceiptSha256 !== receiptSha256) {
        throw new Error("PLAN_AUTHORITY_CHANGED");
      }
      return validateProductionApplyAuthorization(readInput(paths.get("--apply-authorization")),
        plan, envelope.payload, source, productionContinuity, paths.get("--journal-root"),
        readTrustedAuthorizationPublicKey());
    }
    const { validateApplyAuthorization } = require("./isolated-file-cleanup-authorization.cjs");
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
      if (mode === "production") require("./isolated-file-cleanup-production-boundary.cjs").assertProductionInspectionBoundary(source);
      else await assertLocalExecutionBoundary(source);
      verifyAuthority();
      if (sha256(readInput(paths.get("--plan"))) !== sha256(plan)) throw new Error("PLAN_CHANGED");
      validateSavedPlan(plan);
    };
    const localListVersions = async object => {
      await assertLocalExecutionBoundary(source);
      if (object.bucket !== process.env.COS_BUCKET || !plan.operations.some(item => item.object.objectKey === object.objectKey && item.object.bucket === object.bucket)) {
        throw new Error("OBJECT_SCOPE_INVALID");
      }
      return new CosVersionedObjectStorage({ fetchImpl: boundedCosFetch(object.objectKey) }).listObjectVersions(object.objectKey);
    };
    const localDeleteVersion = async (object, versionId) => {
      await assertLocalExecutionBoundary(source);
      if (!plan.operations.some(item => item.object.bucket === object.bucket && item.object.objectKey === object.objectKey &&
          item.object.versions.some(version => version.versionId === versionId))) throw new Error("VERSION_SCOPE_INVALID");
      const { createOneShotVersionDeleteFetch } = require("./isolated-file-cleanup-delete-transport.cjs");
      const fetchImpl = createOneShotVersionDeleteFetch({ bucket: "private-local", region: "ap-test",
        objectKey: object.objectKey, versionId });
      await new CosVersionedObjectStorage({ fetchImpl }).deleteObjectVersion(object.objectKey, versionId);
    };
    const productionObjects = mode === "production" ?
      require("./isolated-file-cleanup-production-objects.cjs").createProductionObjectOperations({
        source, plan, verifyAuthority: guard,
        listObjectVersions: object => new CosVersionedObjectStorage({ fetchImpl: boundedCosFetch(object.objectKey) })
          .listObjectVersions(object.objectKey),
        deleteObjectVersion: async (object, versionId) => {
          const { createOneShotVersionDeleteFetch } = require("./isolated-file-cleanup-delete-transport.cjs");
          const fetchImpl = createOneShotVersionDeleteFetch({ bucket: process.env.COS_BUCKET,
            region: process.env.COS_REGION, objectKey: object.objectKey, versionId });
          await new CosVersionedObjectStorage({ fetchImpl }).deleteObjectVersion(object.objectKey, versionId);
        }
      }) : null;
    const listVersions = productionObjects?.listVersions ?? localListVersions;
    const deleteVersion = productionObjects?.deleteVersion ?? localDeleteVersion;
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
  const { inspectReadOnlyFacts } = require("./isolated-file-cleanup-readonly-coordinator.cjs");
  const inspection = await inspectReadOnlyFacts({
    scope: envelope.payload, source, databaseUrl: process.env.DATABASE_URL,
    restoreDatabaseUrl: process.env.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL?.trim(),
    versionBackup, boundedCosFetch,
    loadBackup: () => paths.has("--backup-receipt") ? readInput(paths.get("--backup-receipt")) : null
  });
  if (inspection.status === "blocked") return blocked(inspection.code);
  const { result, backup, databaseRestoreProof, objectSnapshots } = inspection;
  if (approvedInspection) {
    const stableProof = proof => {
      if (!proof) return null;
      return Object.fromEntries(Object.entries(proof).filter(([field]) => field !== "verifiedAt"));
    };
    const current = { schemaDigest: result.schemaDigest, migrationHead: result.migrationHead, migrationCount: result.migrationCount,
      backupReceiptSha256: backup.receiptSha256, versionBackupReceiptSha256: versionBackup?.receiptSha256 ?? null,
      objectSnapshotsSha256: sha256(objectSnapshots) };
    if (Object.entries(current).some(([field, value]) => approvedInspection[field] !== value) ||
        (mode === "production" && sha256(approvedInspection.productionContinuity) !== sha256(productionContinuity)) ||
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
      if (mode === "production") {
        const { POL25A_RECEIPT_SHA256, validateProductionContinuity } =
          require("./isolated-file-cleanup-production-contract.cjs");
        const { readTrustedSchemaContinuityPublicKey } = require("./business-zeroing-cli.cjs");
        same(validateProductionContinuity(readInput(paths.get("--schema-continuity-envelope")),
          readInput(paths.get("--pol25a-receipt"), true), source, envelope.payload,
          readTrustedSchemaContinuityPublicKey(), POL25A_RECEIPT_SHA256), productionContinuity);
        require("./isolated-file-cleanup-production-boundary.cjs").assertProductionInspectionBoundary(source);
      }
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
      productionContinuity: productionContinuity ?? null,
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
        eligibleForIsolatedExecution: mode === "local" && Boolean(scopeAuthorization && writeFreezeLease &&
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
  () => main(process.argv.slice(2), "local").catch(() => blocked("INPUT_REJECTED")),
  "独立文件清理已安全阻断"
);
const productionRunMain = createTrustedEntrypoint(
  () => main(process.argv.slice(2), "production").catch(() => blocked("INPUT_REJECTED")),
  "生产独立文件清理已安全阻断"
);
module.exports = { runMain, productionRunMain, boundedCosFetch };
if (require.main === module) blocked("TRUSTED_LAUNCHER_REQUIRED");
