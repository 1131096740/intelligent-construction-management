#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const fsConstants = require("node:fs").constants;
const { link, lstat, open, rename, unlink } = require("node:fs/promises");
const path = require("node:path");
const { canonicalize, sha256 } = require("./business-zeroing-core.cjs");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function finalizeSnapshot(snapshot) {
  return { ...snapshot, snapshotSha256: sha256(snapshot) };
}

function normalizeVersions(versions) {
  return versions
    .map((version) => ({
      versionId: version.versionId,
      isDeleteMarker: version.isDeleteMarker === true,
      isLatest: version.isLatest === true,
      ...(version.lastModified ? { lastModified: version.lastModified } : {}),
      ...(Number.isInteger(version.sizeBytes) ? { sizeBytes: version.sizeBytes } : {})
    }))
    .sort((left, right) => left.versionId.localeCompare(right.versionId));
}

function localStorageRoot() {
  return path.resolve(
    process.env.FILE_STORAGE_ROOT ?? path.join(process.cwd(), "storage/private")
  );
}

function localSnapshot(content, metadata) {
  return finalizeSnapshot({
    kind: "local_file",
    contentSha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
    lastModified: metadata.mtime.toISOString(),
    deviceId: metadata.dev,
    inodeId: metadata.ino
  });
}

function sameLocalSnapshot(left, right) {
  return (
    left?.contentSha256 === right?.contentSha256 &&
    left?.sizeBytes === right?.sizeBytes &&
    left?.snapshotSha256 === right?.snapshotSha256
  );
}

async function inspectOpenedLocalFile(target) {
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    invariant(metadata.isFile() && !metadata.isSymbolicLink(), "本地对象必须是普通文件");
    return { snapshot: localSnapshot(await handle.readFile(), metadata), metadata };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function restoreQuarantinedFile(quarantine, target) {
  try {
    await link(quarantine, target);
    await unlink(quarantine);
  } catch {
    throw new Error("原子隔离对象已漂移且无法无覆盖恢复，隔离工件已保留");
  }
}

function createExactObjectStorage(testHooks = {}) {
  let localStorage;
  let versionedStorage;
  return {
    async inspectExactObject({ bucket, objectKey, maxModifiedAt }) {
      invariant(typeof bucket === "string" && bucket.trim(), "文件 bucket 缺失");
      invariant(typeof objectKey === "string" && objectKey.trim(), "精确对象键缺失");
      const capturedAt = new Date(maxModifiedAt).getTime();
      invariant(Number.isFinite(capturedAt), "私有文件备份捕获时间无效");
      const configuredCosBucket = process.env.COS_BUCKET?.trim();
      if (configuredCosBucket) {
        invariant(bucket === configuredCosBucket, "文件 bucket 与当前对象存储环境不匹配");
        if (!versionedStorage) {
          const {
            CosVersionedObjectStorage,
            withObjectStorageRetry
          } = require("../dist/file/versioned-object-storage");
          versionedStorage = {
            client: new CosVersionedObjectStorage(),
            retry: withObjectStorageRetry
          };
        }
        const versions = normalizeVersions(
          await versionedStorage.retry(
            () => versionedStorage.client.listObjectVersions(objectKey),
            { maxAttempts: 3, baseBackoffMs: 50 }
          )
        );
        invariant(versions.length > 0, "文件记录对应的精确对象版本不存在");
        invariant(
          versions.every(
            (version) =>
              typeof version.lastModified === "string" &&
              new Date(version.lastModified).getTime() <= capturedAt
          ),
          "对象版本晚于私有文件备份捕获时间"
        );
        return finalizeSnapshot({ kind: "cos_versions", versions });
      }

      invariant(bucket === "private-local", "本地文件 bucket 与当前环境不匹配");
      if (!localStorage) {
        const { PrivateFileStorage } = require("../dist/file/file.service");
        localStorage = new PrivateFileStorage();
        localStorage.assertConfigured();
        invariant(localStorage.bucketName() === bucket, "本地文件存储绑定不匹配");
      }
      await localStorage.read(objectKey);
      const target = path.resolve(localStorageRoot(), objectKey);
      const { snapshot, metadata } = await inspectOpenedLocalFile(target);
      invariant(metadata.mtimeMs <= capturedAt, "本地对象晚于私有文件备份捕获时间");
      return snapshot;
    },
    async deleteExactObject({ bucket, objectKey, expectedSnapshot }) {
      invariant(typeof bucket === "string" && bucket.trim(), "文件 bucket 缺失");
      invariant(typeof objectKey === "string" && objectKey.trim(), "精确对象键缺失");
      const configuredCosBucket = process.env.COS_BUCKET?.trim();
      if (configuredCosBucket) {
        invariant(bucket === configuredCosBucket, "文件 bucket 与当前对象存储环境不匹配");
        if (!versionedStorage) {
          const {
            CosVersionedObjectStorage,
            withObjectStorageRetry
          } = require("../dist/file/versioned-object-storage");
          versionedStorage = {
            client: new CosVersionedObjectStorage(),
            retry: withObjectStorageRetry
          };
        }
        const versions = normalizeVersions(await versionedStorage.retry(
          () => versionedStorage.client.listObjectVersions(objectKey),
          { maxAttempts: 3, baseBackoffMs: 50 }
        ));
        const currentSnapshot = finalizeSnapshot({ kind: "cos_versions", versions });
        invariant(
          JSON.stringify(canonicalize(currentSnapshot)) ===
            JSON.stringify(canonicalize(expectedSnapshot)),
          "精确对象版本集合已漂移"
        );
        for (const version of expectedSnapshot.versions) {
          await versionedStorage.retry(
            () => versionedStorage.client.deleteObjectVersion(objectKey, version.versionId),
            { maxAttempts: 3, baseBackoffMs: 50 }
          );
        }
        const converged = await versionedStorage.retry(
          () => versionedStorage.client.isConverged(objectKey),
          { maxAttempts: 3, baseBackoffMs: 50 }
        );
        invariant(converged, "精确对象键的全部版本与删除标记未收敛");
        return {
          kind: "cos_versions",
          status: "deleted_exact_versions",
          objectKey,
          deletedVersionIds: expectedSnapshot.versions.map((version) => version.versionId)
        };
      }

      invariant(bucket === "private-local", "本地文件 bucket 与当前环境不匹配");
      if (!localStorage) {
        const { PrivateFileStorage } = require("../dist/file/file.service");
        localStorage = new PrivateFileStorage();
        localStorage.assertConfigured();
        invariant(localStorage.bucketName() === bucket, "本地文件存储绑定不匹配");
      }
      await localStorage.read(objectKey);
      const target = path.resolve(localStorageRoot(), objectKey);
      const { snapshot: currentSnapshot } = await inspectOpenedLocalFile(target);
      invariant(
        sameLocalSnapshot(currentSnapshot, expectedSnapshot),
        "本地精确对象内容已漂移"
      );
      await testHooks.beforeLocalQuarantine?.({ target, expectedSnapshot });
      const quarantine = path.join(
        path.dirname(target),
        `.${path.basename(target)}.pol22-${randomUUID()}.quarantine`
      );
      await rename(target, quarantine);
      let quarantinedSnapshot;
      try {
        ({ snapshot: quarantinedSnapshot } = await inspectOpenedLocalFile(quarantine));
      } catch (error) {
        await restoreQuarantinedFile(quarantine, target);
        throw error;
      }
      if (!sameLocalSnapshot(quarantinedSnapshot, expectedSnapshot)) {
        await restoreQuarantinedFile(quarantine, target);
        throw new Error("原子隔离对象内容已漂移，拒绝删除");
      }
      await testHooks.afterLocalQuarantineVerified?.({
        target,
        quarantine,
        expectedSnapshot
      });
      const { snapshot: finalQuarantinedSnapshot } = await inspectOpenedLocalFile(quarantine);
      if (!sameLocalSnapshot(finalQuarantinedSnapshot, expectedSnapshot)) {
        await restoreQuarantinedFile(quarantine, target);
        throw new Error("原子隔离对象复核后内容已漂移，拒绝删除");
      }
      try {
        await lstat(target);
        throw new Error("本地精确对象键删除后出现新内容，收敛失败");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return {
        kind: "local_quarantine",
        status: "object_key_removed_recovery_artifact_retained",
        objectKey,
        quarantineObjectKey: path.relative(localStorageRoot(), quarantine)
      };
    }
  };
}

async function inspectInventoryObjectSnapshots(inventory, privateFileBackupCapturedAt) {
  const storage = createExactObjectStorage();
  const fileTable = inventory.tables.find((table) => table.name === "FileObject");
  const snapshots = [];
  for (const file of fileTable?.rows ?? []) {
    try {
      snapshots.push({
        fileId: String(file.id),
        status: "ready",
        snapshot: await storage.inspectExactObject({
          bucket: file.bucket,
          objectKey: file.objectKey,
          maxModifiedAt: privateFileBackupCapturedAt
        })
      });
    } catch {
      snapshots.push({ fileId: String(file.id), status: "blocked" });
    }
  }
  return snapshots;
}

module.exports = {
  createExactObjectStorage,
  inspectInventoryObjectSnapshots,
  normalizeVersions
};
