"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { sha256 } = require("./business-zeroing-core.cjs");

function verifyVersionBackup(backupPath, restorePath, scope, source, readInput) {
  const requireValid = condition => { if (!condition) throw new Error("VERSION_BACKUP_INVALID"); };
  const directory = input => {
    requireValid(path.isAbsolute(input) && fs.lstatSync(input).isDirectory() && !fs.lstatSync(input).isSymbolicLink());
    const root = fs.realpathSync(input);
    const blobs = path.join(root, "blobs");
    requireValid(fs.lstatSync(blobs).isDirectory() && !fs.lstatSync(blobs).isSymbolicLink());
    return root;
  };
  const backupRoot = directory(backupPath);
  const restoreRoot = directory(restorePath);
  requireValid(backupRoot !== restoreRoot && !backupRoot.startsWith(`${restoreRoot}${path.sep}`) &&
    !restoreRoot.startsWith(`${backupRoot}${path.sep}`));
  const receipt = readInput(path.join(backupRoot, "private-object-backup-receipt.json"));
  const { receiptSha256, ...receiptBody } = receipt;
  requireValid(sha256(receiptBody) === receiptSha256 && receipt.schemaVersion === 1 && receipt.status === "passed" &&
    receipt.mode === "capture-and-verify" && receipt.restoreStatus === "passed" && receipt.productionWriteExecuted === false);
  const manifestBytes = readInput(path.join(backupRoot, "private-object-backup-manifest.json"), true);
  requireValid(createHash("sha256").update(manifestBytes).digest("hex") === receipt.manifestSha256);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  requireValid(manifest.schemaVersion === 1 && /^[0-9a-f]{40}$/u.test(manifest.candidateSha) &&
    manifest.candidateSha === source.codeSha && receipt.candidateSha === manifest.candidateSha &&
    manifest.capturedAt === receipt.capturedAt && /^[0-9a-f]{64}$/u.test(manifest.inventorySha256) &&
    manifest.inventorySha256 === receipt.inventorySha256);
  const captured = Date.parse(receipt.capturedAt);
  const verified = Date.parse(receipt.verifiedAt);
  requireValid(Number.isFinite(captured) && Number.isFinite(verified) && captured <= verified && verified <= Date.now() &&
    new Date(captured).toISOString() === receipt.capturedAt && new Date(verified).toISOString() === receipt.verifiedAt);
  requireValid(Array.isArray(manifest.objects) && manifest.objects.length > 0);
  const objectKeys = new Set();
  const fileIds = new Set();
  let versionCount = 0;
  let markerCount = 0;
  const verifyBlob = (root, version) => {
    requireValid(/^[0-9a-f]{64}$/u.test(version.contentSha256) && version.blobName === `${version.contentSha256}.blob` &&
      Number.isSafeInteger(version.sizeBytes) && version.sizeBytes >= 0);
    const fd = fs.openSync(path.join(root, "blobs", version.blobName), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      requireValid(before.isFile() && before.size === version.sizeBytes);
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(65536);
      let total = 0;
      while (total < before.size) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, before.size - total), null);
        requireValid(count > 0);
        total += count;
        hash.update(buffer.subarray(0, count));
      }
      const after = fs.fstatSync(fd);
      requireValid(after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs &&
        hash.digest("hex") === version.contentSha256);
      return { device: after.dev, inode: after.ino };
    } finally { fs.closeSync(fd); }
  };
  for (const object of manifest.objects) {
    requireValid(typeof object.bucket === "string" && object.bucket && typeof object.objectKey === "string" && object.objectKey);
    const key = JSON.stringify([object.bucket, object.objectKey]);
    requireValid(!objectKeys.has(key));
    objectKeys.add(key);
    requireValid(Array.isArray(object.databaseFileIds) && object.databaseFileIds.length > 0);
    for (const id of object.databaseFileIds) {
      requireValid(typeof id === "string" && id && !fileIds.has(id));
      fileIds.add(id);
    }
    requireValid(Array.isArray(object.versions) && object.versions.length > 0);
    const versions = new Set();
    let latestCount = 0;
    for (const version of object.versions) {
      requireValid(typeof version.versionId === "string" && version.versionId && !versions.has(version.versionId) &&
        typeof version.isDeleteMarker === "boolean" && typeof version.isLatest === "boolean" &&
        Number.isFinite(Date.parse(version.lastModified)) && Date.parse(version.lastModified) <= captured);
      versions.add(version.versionId);
      if (version.isLatest) { latestCount += 1; requireValid(!version.isDeleteMarker); }
      if (version.isDeleteMarker) { markerCount += 1; continue; }
      versionCount += 1;
      const original = verifyBlob(backupRoot, version);
      const restored = verifyBlob(restoreRoot, version);
      requireValid(original.device !== restored.device || original.inode !== restored.inode);
    }
    requireValid(latestCount === 1);
  }
  requireValid(scope.files.every(file => manifest.objects.some(object =>
    object.databaseFileIds.length === 1 && object.databaseFileIds[0] === file.id)));
  requireValid(receipt.uniqueObjectCount === objectKeys.size && receipt.sourceRecordCount === fileIds.size &&
    receipt.versionCount === versionCount && receipt.restoredVersionCount === versionCount && receipt.deleteMarkerCount === markerCount);
  return { manifest, receiptSha256 };
}

module.exports = { verifyVersionBackup };
