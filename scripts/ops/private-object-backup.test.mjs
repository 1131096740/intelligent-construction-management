import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertCandidateRepository,
  authorization,
  capture,
  listVersions,
  requestUrl,
  restoreAndVerify,
  validateInventory
} from "./private-object-backup.mjs";

const SCRIPT = fileURLToPath(new URL("./private-object-backup.mjs", import.meta.url));
const CANDIDATE_SHA = "1".repeat(40);
const OBJECT_KEY = "uploads/合同 ?#% !'()*.txt";
const CONTENT = Buffer.from("fixture", "utf8");
const CONTENT_SHA256 = createHash("sha256").update(CONTENT).digest("hex");
const CONFIG = {
  FILE_STORAGE_DRIVER: "cos",
  COS_BUCKET: "private-bucket",
  COS_REGION: "ap-test",
  COS_SECRET_ID: "test-secret-id",
  COS_SECRET_KEY: "test-secret-key"
};

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
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

function requesterFor(endpoint, requests) {
  return async (_config, pathname, query) => {
    const url = requestUrl(endpoint, pathname, query);
    const parsed = new URL(url);
    requests.push(parsed.pathname + parsed.search);
    return fetch(url);
  };
}

test("core capture backs up paginated versions and proves an isolated restore for a special-character key", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-private-backup-"));
  const backupRoot = join(root, "backup");
  const restoreRoot = join(root, "restored");
  await mkdir(backupRoot, { mode: 0o700 });
  await mkdir(restoreRoot, { mode: 0o700 });
  const requests = [];
  const encodedKey = OBJECT_KEY
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ))
    .join("/");
  const server = await listen((request, response) => {
    if (request.url.includes("versions") && !request.url.includes("key-marker")) {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<ListVersionsResult>
        <IsTruncated>true</IsTruncated>
        <NextKeyMarker>${OBJECT_KEY}</NextKeyMarker>
        <NextVersionIdMarker></NextVersionIdMarker>
        <Version><Key>${OBJECT_KEY}</Key><VersionId>version-1</VersionId><IsLatest>true</IsLatest><Size>${CONTENT.length}</Size></Version>
      </ListVersionsResult>`);
      return;
    }
    if (request.url.includes("versions") && request.url.includes("key-marker")) {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<ListVersionsResult>
        <IsTruncated>false</IsTruncated>
        <Version><Key>${OBJECT_KEY}</Key><VersionId>version-0</VersionId><IsLatest>false</IsLatest><Size>${CONTENT.length}</Size></Version>
        <DeleteMarker><Key>${OBJECT_KEY}</Key><VersionId>delete-0</VersionId><IsLatest>false</IsLatest></DeleteMarker>
      </ListVersionsResult>`);
      return;
    }
    if (request.url.startsWith(`/${encodedKey}?versionId=version-`)) {
      response.writeHead(200, { "content-length": String(CONTENT.length) });
      response.end(CONTENT);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    const inventory = validateInventory([{
      id: "file-1",
      bucket: CONFIG.COS_BUCKET,
      objectKey: OBJECT_KEY,
      sizeBytes: CONTENT.length,
      contentSha256: CONTENT_SHA256,
      storageStatus: "active"
    }], CONFIG.COS_BUCKET);
    const objects = await capture(CONFIG, inventory, backupRoot, requesterFor(server.endpoint, requests));
    const restoredVersionCount = await restoreAndVerify({ objects }, backupRoot, restoreRoot);

    assert.equal(objects.length, 1);
    assert.equal(objects[0].versions.filter((version) => !version.isDeleteMarker).length, 2);
    assert.equal(objects[0].versions.filter((version) => version.isDeleteMarker).length, 1);
    assert.equal(restoredVersionCount, 2);
    assert.match(requests[1], /key-marker=.*&max-keys=1000&prefix=.*&version-id-marker&versions/u);
    assert.deepEqual(requests.filter((request) => request.includes("?versionId=")), [
      `/${encodedKey}?versionId=version-0`,
      `/${encodedKey}?versionId=version-1`
    ]);
    assert.equal(
      authorization("GET", `/${OBJECT_KEY}`, "example.test", { versionId: "version-1" }, "id", "key", 1_700_000_000),
      "q-sign-algorithm=sha1&q-ak=id&q-sign-time=1700000000;1700000600&q-key-time=1700000000;1700000600&q-header-list=host&q-url-param-list=versionid&q-signature=46a95801b6532f7fc2db945fb827307dfcc42f9d"
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production CLI cannot use NODE_ENV to bypass the root boundary", async () => {
  if (typeof process.getuid !== "function" || process.getuid() === 0) return;
  const result = await run([
    "capture-and-verify",
    "--inventory", "/missing-inventory.json",
    "--storage-env-file", "/missing-api.env",
    "--backup-root", "/tmp/missing-backup",
    "--restore-root", "/tmp/missing-restore",
    "--candidate-sha", CANDIDATE_SHA,
    "--confirm", `CAPTURE_AND_VERIFY_PRIVATE_OBJECT_BACKUP_${CANDIDATE_SHA}`
  ], { NODE_ENV: "test", POL25A_PRIVATE_OBJECT_TEST_ENDPOINT: "http://127.0.0.1:1" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must run as root/u);
  assert.equal(result.stdout, "");
});

test("candidate binding requires the exact clean tracked repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-candidate-binding-"));
  try {
    await writeFile(join(root, "tool.mjs"), "export {};\n", { mode: 0o600 });
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "add", "tool.mjs"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const canonicalRoot = await realpath(root);
    await assertCandidateRepository(canonicalRoot, head, "tool.mjs");
    await assert.rejects(assertCandidateRepository(canonicalRoot, CANDIDATE_SHA, "tool.mjs"), /HEAD does not match/u);
    await writeFile(join(root, "tool.mjs"), "export const dirty = true;\n", { mode: 0o600 });
    await assert.rejects(assertCandidateRepository(canonicalRoot, head, "tool.mjs"), /must be clean/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("version pagination fails closed when a page repeats", async () => {
  const xml = `<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>${OBJECT_KEY}</NextKeyMarker><NextVersionIdMarker></NextVersionIdMarker><Version><Key>${OBJECT_KEY}</Key><VersionId>version-1</VersionId><IsLatest>true</IsLatest><Size>1</Size></Version></ListVersionsResult>`;
  const requester = async () => new Response(xml, { status: 200 });
  await assert.rejects(listVersions(CONFIG, OBJECT_KEY, requester), /repeated a generation|did not advance/u);
});

test("core capture fails closed when latest bytes drift from database metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "pol296-private-drift-"));
  const backupRoot = join(root, "backup");
  await mkdir(backupRoot, { mode: 0o700 });
  const server = await listen((request, response) => {
    if (request.url.includes("versions")) {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>uploads/a.txt</Key><VersionId>version-1</VersionId><IsLatest>true</IsLatest><Size>${CONTENT.length}</Size></Version></ListVersionsResult>`);
      return;
    }
    response.writeHead(200);
    response.end(CONTENT);
  });
  try {
    const inventory = validateInventory([{
      id: "file-1",
      bucket: CONFIG.COS_BUCKET,
      objectKey: "uploads/a.txt",
      sizeBytes: CONTENT.length,
      contentSha256: "0".repeat(64),
      storageStatus: "active"
    }], CONFIG.COS_BUCKET);
    await assert.rejects(
      capture(CONFIG, inventory, backupRoot, requesterFor(server.endpoint, [])),
      /latest COS bytes do not match database size\/hash metadata/u
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
