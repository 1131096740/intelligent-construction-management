"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, unlinkSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { sha256, canonicalize } = require("./business-zeroing-core.cjs");

test("预检核对已有全版本备份及独立恢复内容", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "orphan-version-backup-"));
  const backupRoot = path.join(directory, "backup");
  const restoreRoot = path.join(directory, "restore");
  try {
    for (const root of [backupRoot, restoreRoot]) mkdirSync(path.join(root, "blobs"), { recursive: true, mode: 0o700 });
    const files = [1, 2].map(() => ({ id: randomUUID(), rowSha256: "a".repeat(64) }));
    const sourceBody = { mode: "read_only_preflight", status: "blocked", executed: false,
      codeSha: "c".repeat(40), deletionCandidates: [],
      blockers: files.map(file => ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } })) };
    const source = { ...sourceBody, reportSha256: sha256(sourceBody) };
    const sourcePath = path.join(directory, "source.json");
    const scopePath = path.join(directory, "scope.json");
    writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
    writeFileSync(scopePath, JSON.stringify({ payload: { files, sourceReportSha256: source.reportSha256 } }), { mode: 0o600 });
    const capturedAt = new Date(Date.now() - 2000).toISOString();
    const objects = files.map(file => ({ bucket: "synthetic-bucket", objectKey: `${file.id}.pdf`,
      databaseFileIds: [file.id], databaseStorageStatuses: ["quarantined"],
      versions: ["old", "current"].map((name, index) => {
        const content = Buffer.from(`${file.id}-${name}`);
        const hash = createHash("sha256").update(content).digest("hex");
        const blobName = `${hash}.blob`;
        for (const root of [backupRoot, restoreRoot]) writeFileSync(path.join(root, "blobs", blobName), content, { mode: 0o600 });
        return { versionId: name, isDeleteMarker: false, isLatest: index === 1,
          lastModified: capturedAt, sizeBytes: content.length, contentSha256: hash, blobName };
      }) }));
    const manifest = { schemaVersion: 1, candidateSha: source.codeSha, capturedAt, inventorySha256: "d".repeat(64), objects };
    const writeEvidence = (deleteMarkerCount = 0) => {
      const bytes = `${JSON.stringify(canonicalize(manifest))}\n`;
      writeFileSync(path.join(backupRoot, "private-object-backup-manifest.json"), bytes, { mode: 0o600 });
      const body = { schemaVersion: 1, status: "passed", mode: "capture-and-verify", candidateSha: source.codeSha,
        capturedAt, verifiedAt: new Date(Date.now() - 1000).toISOString(), sourceRecordCount: 2,
        uniqueObjectCount: 2, versionCount: 4, deleteMarkerCount, restoredVersionCount: 4,
        restoreStatus: "passed", inventorySha256: manifest.inventorySha256,
        manifestSha256: createHash("sha256").update(bytes).digest("hex"), productionWriteExecuted: false };
      writeFileSync(path.join(backupRoot, "private-object-backup-receipt.json"),
        JSON.stringify({ ...body, receiptSha256: sha256(body) }), { mode: 0o600 });
    };
    writeEvidence();
    const inspect = () => {
      const result = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"), "isolated-file-cleanup", "inspect",
        "--scope", scopePath, "--source-report", sourcePath, "--version-backup-root", backupRoot,
        "--version-restore-root", restoreRoot], { env: { ...process.env, DATABASE_URL: "invalid-no-connection" }, encoding: "utf8" });
      assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      return JSON.parse(result.stdout).code;
    };
    await t.test("历史及当前版本的备份和恢复字节匹配时进入后续门禁", () => {
      assert.equal(inspect(), "DATABASE_NOT_CONFIGURED");
    });
    await t.test("把备份硬链接到恢复目录不能冒充独立恢复", () => {
      const blob = objects[0].versions[0].blobName;
      const restored = path.join(restoreRoot, "blobs", blob);
      const bytes = readFileSync(restored);
      unlinkSync(restored);
      linkSync(path.join(backupRoot, "blobs", blob), restored);
      try { assert.equal(inspect(), "VERSION_BACKUP_INVALID"); }
      finally { unlinkSync(restored); writeFileSync(restored, bytes, { mode: 0o600 }); }
    });
    await t.test("旧版本备份缺失不能用最新版本通过", () => {
      const target = path.join(backupRoot, "blobs", objects[0].versions[0].blobName);
      const bytes = readFileSync(target);
      unlinkSync(target);
      try { assert.equal(inspect(), "VERSION_BACKUP_INVALID"); }
      finally { writeFileSync(target, bytes, { mode: 0o600 }); }
    });
    await t.test("恢复文件内容损坏必须阻断", () => {
      const target = path.join(restoreRoot, "blobs", objects[0].versions[0].blobName);
      const bytes = readFileSync(target);
      writeFileSync(target, Buffer.alloc(bytes.length, 120));
      try { assert.equal(inspect(), "VERSION_BACKUP_INVALID"); }
      finally { writeFileSync(target, bytes, { mode: 0o600 }); }
    });
    await t.test("清单正文变化而收据未变必须阻断", () => {
      const target = path.join(backupRoot, "private-object-backup-manifest.json");
      writeFileSync(target, "{}\n");
      try { assert.equal(inspect(), "VERSION_BACKUP_INVALID"); }
      finally { writeEvidence(); }
    });
    await t.test("重复版本即使重新生成摘要也必须阻断", () => {
      objects[0].versions.push(objects[0].versions[0]);
      writeEvidence();
      try { assert.equal(inspect(), "VERSION_BACKUP_INVALID"); }
      finally { objects[0].versions.pop(); writeEvidence(); }
    });
    await t.test("历史删除标记单独计数，不要求伪造内容文件", () => {
      objects[0].versions.push({ versionId: "historical-marker", isDeleteMarker: true, isLatest: false, lastModified: capturedAt });
      writeEvidence(1);
      try { assert.equal(inspect(), "DATABASE_NOT_CONFIGURED"); }
      finally { objects[0].versions.pop(); writeEvidence(); }
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
