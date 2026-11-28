"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { PDFDocument } = require("pdf-lib");
const { readOwnedNativeArchiveIdentity } = require("../prisma/seal-retirement-329-archive.cjs");
const { assertA08Source, captureA08Direct346Source } = require("./task426-a08-upward-pin-332-profile.cjs");
const { prepareNativeA08Mode } = require("./task426-a08-native-runtime.cjs");

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const candidate = "a".repeat(40);
const sourceTree = "b".repeat(40);
const migrations = join(__dirname, "../prisma/migrations");
const readLedger = () => readdirSync(migrations).sort().filter(name => /^[0-9]{14}_/u.test(name)).map(name => ({
  name, sha256: sha(readFileSync(join(migrations, name, "migration.sql"))), finished: true, rolledBack: false
}));

test("the A08 proof binds to the pinned 346 ledger and live in-memory archive provenance", () => {
  const ledger = readLedger();
  const source = captureA08Direct346Source(candidate, sourceTree, ledger);
  assert.doesNotThrow(() => assertA08Source(source, candidate));
  assert.throws(() => assertA08Source(JSON.parse(JSON.stringify(source)), candidate), /A08_DIRECT_346_SOURCE_PROVENANCE/u);
  assert.throws(() => captureA08Direct346Source(candidate, sourceTree, ledger.slice(0, 332)));
  const changedLedger = ledger.map((row, index) => index === 345 ? { ...row, sha256: "0".repeat(64) } : row);
  assert.throws(() => captureA08Direct346Source(candidate, sourceTree, changedLedger), /NATIVE_A24_340_PINNED_LEDGER/u);
  assert.throws(() => readOwnedNativeArchiveIdentity({ owner: {}, application: {} }), /NATIVE_ARCHIVE_LIVE_INSTALLATION_REQUIRED/u);
});

test("original downloads replay two distinct valid PDFs for outside and one fixed PDF for upward", async () => {
  const sourceProfile = captureA08Direct346Source(candidate, sourceTree, readLedger());
  const source = { candidate, sourceProfile };
  const outside = await prepareNativeA08Mode(source, "outside");
  const upward = await prepareNativeA08Mode(source, "upward");
  assert.equal(outside.evidence.originalCount, 2);
  assert.equal(upward.evidence.originalCount, 1);
  assert.notEqual(outside.evidence.originalManifest[0].contentSha256, outside.evidence.originalManifest[1].contentSha256);
  assert.deepEqual(upward.evidence.originalManifest, [outside.evidence.originalManifest[1]]);
  for (const { evidence, region, scenario } of [outside, upward]) {
    assert.equal(evidence.storage, "SYNTHETIC_OFFLINE_BYTES");
    assert.equal(evidence.originalManifestSha256, sha(JSON.stringify(evidence.originalManifest)));
    const transport = scenario.offlineOriginalTransport;
    for (const original of evidence.originalManifest) {
      const host = `${original.bucket}.cos.${region}.myqcloud.com`;
      const url = `https://${host}/${original.objectKey}?versionId=${original.objectGeneration}`;
      const request = { method: "GET", redirect: "error", headers: { host, "accept-encoding": "identity" } };
      const response = await transport.fetch(url, request);
      const body = Buffer.from(await response.arrayBuffer());
      const pdf = await PDFDocument.load(body);
      assert.equal(pdf.getPageCount(), 1);
      assert.match(pdf.getTitle(), /A08 isolated synthetic signed original [12]/u);
      assert.equal(body.length, original.sizeBytes);
      assert.equal(sha(body), original.contentSha256);
      assert.throws(() => transport.fetch(url, { ...request, method: "PUT" }), /A08_OFFLINE_READ_SCOPE/u);
      assert.throws(() => transport.fetch(url + "-unknown", request), /A08_OFFLINE_READ_SCOPE/u);
    }
    assert.deepEqual(transport.readsSince(0), evidence.originalManifest.map(original => ({
      contentSha256: original.contentSha256, pinned: true
    })));
  }
});
