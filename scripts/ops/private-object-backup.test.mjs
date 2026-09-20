import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./private-object-backup.mjs", import.meta.url));
const CANDIDATE_SHA = "1".repeat(40);
const CONTENT = Buffer.from("fixture", "utf8");
const CONTENT_SHA256 = createHash("sha256").update(CONTENT).digest("hex");

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test("capture-and-verify backs up every private-object version and proves an isolated restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-private-backup-"));
  const inventory = join(root, "inventory.json");
  const envFile = join(root, "api.env");
  const backupRoot = join(root, "backup");
  const restoreRoot = join(root, "restored");
  const requests = [];
  const server = await listen((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/?")) {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
        <ListVersionsResult>
          <IsTruncated>false</IsTruncated>
          <Version>
            <Key>uploads/a.txt</Key>
            <VersionId>version-1</VersionId>
            <IsLatest>true</IsLatest>
            <LastModified>2026-09-20T00:00:00.000Z</LastModified>
            <ETag>etag-1</ETag>
            <Size>${CONTENT.length}</Size>
          </Version>
          <Version>
            <Key>uploads/a.txt</Key>
            <VersionId>version-0</VersionId>
            <IsLatest>false</IsLatest>
            <LastModified>2026-09-19T00:00:00.000Z</LastModified>
            <ETag>etag-0</ETag>
            <Size>${CONTENT.length}</Size>
          </Version>
        </ListVersionsResult>`);
      return;
    }
    if (request.url?.startsWith("/uploads/a.txt?versionId=version-")) {
      response.writeHead(200, { "content-length": String(CONTENT.length) });
      response.end(CONTENT);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    await writeFile(
      inventory,
      `${JSON.stringify(
        [
          {
            id: "file-1",
            bucket: "private-bucket",
            objectKey: "uploads/a.txt",
            sizeBytes: CONTENT.length,
            contentSha256: CONTENT_SHA256,
            storageStatus: "active"
          }
        ],
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
    await writeFile(
      envFile,
      [
        "FILE_STORAGE_DRIVER=cos",
        "COS_BUCKET=private-bucket",
        "COS_REGION=ap-test",
        "COS_SECRET_ID=test-secret-id",
        "COS_SECRET_KEY=test-secret-key"
      ].join("\n") + "\n",
      { mode: 0o600 }
    );

    const result = await run(
      [
        "capture-and-verify",
        "--inventory",
        inventory,
        "--storage-env-file",
        envFile,
        "--backup-root",
        backupRoot,
        "--restore-root",
        restoreRoot,
        "--candidate-sha",
        CANDIDATE_SHA,
        "--confirm",
        `CAPTURE_AND_VERIFY_PRIVATE_OBJECT_BACKUP_${CANDIDATE_SHA}`
      ],
      {
        NODE_ENV: "test",
        POL25A_PRIVATE_OBJECT_TEST_ENDPOINT: server.endpoint
      }
    );

    assert.equal(result.code, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(
      {
        status: receipt.status,
        mode: receipt.mode,
        candidateSha: receipt.candidateSha,
        sourceRecordCount: receipt.sourceRecordCount,
        uniqueObjectCount: receipt.uniqueObjectCount,
        versionCount: receipt.versionCount,
        deleteMarkerCount: receipt.deleteMarkerCount,
        restoreStatus: receipt.restoreStatus,
        productionWriteExecuted: receipt.productionWriteExecuted
      },
      {
        status: "passed",
        mode: "capture-and-verify",
        candidateSha: CANDIDATE_SHA,
        sourceRecordCount: 1,
        uniqueObjectCount: 1,
        versionCount: 2,
        deleteMarkerCount: 0,
        restoreStatus: "passed",
        productionWriteExecuted: false
      }
    );
    assert.match(receipt.inventorySha256, /^[0-9a-f]{64}$/u);
    assert.match(receipt.manifestSha256, /^[0-9a-f]{64}$/u);
    assert.match(receipt.receiptSha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(requests, [
      "/?max-keys=1000&prefix=uploads%2Fa.txt&versions",
      "/uploads/a.txt?versionId=version-0",
      "/uploads/a.txt?versionId=version-1"
    ]);

    const savedReceipt = JSON.parse(
      await readFile(join(backupRoot, "private-object-backup-receipt.json"), "utf8")
    );
    assert.equal(savedReceipt.receiptSha256, receipt.receiptSha256);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("capture-and-verify rejects a confirmation that is not bound to the exact candidate before creating output", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-private-confirmation-"));
  const backupRoot = join(root, "backup");
  try {
    const result = await run(
      [
        "capture-and-verify",
        "--inventory",
        join(root, "missing-inventory.json"),
        "--storage-env-file",
        join(root, "missing-api.env"),
        "--backup-root",
        backupRoot,
        "--restore-root",
        join(root, "restored"),
        "--candidate-sha",
        CANDIDATE_SHA,
        "--confirm",
        "WRONG_CONFIRMATION"
      ],
      { NODE_ENV: "test" }
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /confirmation does not match the exact candidate SHA/u);
    await assert.rejects(readFile(join(backupRoot, "private-object-backup-receipt.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture-and-verify fails closed when current COS bytes drift from database metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-private-drift-"));
  const inventory = join(root, "inventory.json");
  const envFile = join(root, "api.env");
  const backupRoot = join(root, "backup");
  const server = await listen((request, response) => {
    if (request.url.startsWith("/?")) {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<ListVersionsResult>
        <IsTruncated>false</IsTruncated>
        <Version><Key>uploads/a.txt</Key><VersionId>version-1</VersionId><IsLatest>true</IsLatest><Size>${CONTENT.length}</Size></Version>
      </ListVersionsResult>`);
      return;
    }
    response.writeHead(200);
    response.end(CONTENT);
  });

  try {
    await writeFile(
      inventory,
      `${JSON.stringify([
        {
          id: "file-1",
          bucket: "private-bucket",
          objectKey: "uploads/a.txt",
          sizeBytes: CONTENT.length,
          contentSha256: "0".repeat(64),
          storageStatus: "active"
        }
      ])}\n`,
      { mode: 0o600 }
    );
    await writeFile(
      envFile,
      "FILE_STORAGE_DRIVER=cos\nCOS_BUCKET=private-bucket\nCOS_REGION=ap-test\nCOS_SECRET_ID=test-secret-id\nCOS_SECRET_KEY=test-secret-key\n",
      { mode: 0o600 }
    );
    const result = await run(
      [
        "capture-and-verify",
        "--inventory",
        inventory,
        "--storage-env-file",
        envFile,
        "--backup-root",
        backupRoot,
        "--restore-root",
        join(root, "restored"),
        "--candidate-sha",
        CANDIDATE_SHA,
        "--confirm",
        `CAPTURE_AND_VERIFY_PRIVATE_OBJECT_BACKUP_${CANDIDATE_SHA}`
      ],
      { NODE_ENV: "test", POL25A_PRIVATE_OBJECT_TEST_ENDPOINT: server.endpoint }
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /latest COS bytes do not match database size\/hash metadata/u);
    await assert.rejects(readFile(join(backupRoot, "private-object-backup-receipt.json")));
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
