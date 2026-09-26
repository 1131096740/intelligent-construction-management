"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { PrismaClient } = require("@prisma/client");
const { sha256, validateBackupReceipt, verifyObjectSnapshot } = require("./business-zeroing-core.cjs");
const { inspectTargets, verifyRestoredDatabase } = require("./isolated-file-cleanup-database.cjs");
const { verifyBackupArtifacts } = require("./inspect-test-business-zeroing.cjs");
const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");

const blocked = code => ({ status: "blocked", code });

// This interface begins only after the launcher has validated the source,
// scope, continuity, and authority. "verified" means the read-only facts
// agree; it never grants execution or replaces the launcher's trust gates.
async function inspectReadOnlyFacts({
  scope, source, databaseUrl, restoreDatabaseUrl, loadBackup, versionBackup, boundedCosFetch
}) {
  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl ?? "") ||
      typeof loadBackup !== "function") return blocked("DATABASE_NOT_CONFIGURED");
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let result;
  try {
    result = await inspectTargets(client, scope, source);
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
  let backup;
  try {
    backup = loadBackup();
    if (backup == null) return blocked("BACKUP_RECEIPT_REQUIRED");
    validateBackupReceipt(backup, source.environment, result.databaseFingerprint, new Date().toISOString());
    await verifyBackupArtifacts(backup);
    if (backup.databaseBackup.restoreEvidence.migrationCount !== result.migrationCount ||
        backup.databaseBackup.restoreEvidence.migrationHead !== result.migrationHead) {
      return blocked("BACKUP_MIGRATION_MISMATCH");
    }
  } catch { return blocked("BACKUP_RESTORE_EVIDENCE_INVALID"); }
  let databaseRestoreProof;
  if (restoreDatabaseUrl) {
    if (!/^postgres(?:ql)?:\/\//u.test(restoreDatabaseUrl)) return blocked("RESTORE_DATABASE_NOT_CONFIGURED");
    const restoredClient = new PrismaClient({ datasources: { db: { url: restoreDatabaseUrl } } });
    try {
      databaseRestoreProof = await verifyRestoredDatabase(restoredClient, scope, result, backup);
      if (typeof databaseRestoreProof === "string") return blocked(databaseRestoreProof);
    } catch { return blocked("RESTORE_DATABASE_INSPECTION_FAILED"); }
    finally { await restoredClient.$disconnect(); }
  }
  const objectSnapshots = [];
  try {
    let CosVersionedObjectStorage;
    let withObjectStorageRetry;
    if (process.env.COS_BUCKET?.trim()) {
      if (typeof boundedCosFetch !== "function") throw new Error("COS_REQUEST_BOUNDARY");
      const { Logger } = require("@nestjs/common");
      Logger.overrideLogger(false);
      ({ CosVersionedObjectStorage, withObjectStorageRetry } = require("../dist/file/versioned-object-storage"));
    }
    for (const file of result.files) {
      const versionedStorage = CosVersionedObjectStorage ? {
        client: new CosVersionedObjectStorage({ fetchImpl: boundedCosFetch(file.objectKey) }),
        retry: operation => withObjectStorageRetry(operation, { maxAttempts: 1 })
      } : undefined;
      const storage = createExactObjectStorage({ versionedStorage });
      const snapshot = await storage.inspectExactObject({
        bucket: file.bucket, objectKey: file.objectKey, maxModifiedAt: backup.privateFileBackup.capturedAt
      });
      verifyObjectSnapshot(snapshot);
      if (snapshot.kind === "cos_versions") {
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
  return { status: "verified", result, backup, databaseRestoreProof, objectSnapshots };
}

module.exports = { inspectReadOnlyFacts };
