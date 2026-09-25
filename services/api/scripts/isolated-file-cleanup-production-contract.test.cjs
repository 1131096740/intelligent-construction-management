"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash, generateKeyPairSync, randomUUID, sign } = require("node:crypto");
const { sha256 } = require("./business-zeroing-core.cjs");
const { validateProductionContinuity } = require("./isolated-file-cleanup-production-contract.cjs");

test("生产连续性只接受前序收据、当前 SHA 和精确两个孤儿的独立签名", async t => {
  const predecessor = Buffer.from('{"synthetic":"pol25a-receipt"}\n');
  const anchor = createHash("sha256").update(predecessor).digest("hex");
  const keys = generateKeyPairSync("ed25519");
  const files = [randomUUID(), randomUUID()].map(id => ({ id, rowSha256: "a".repeat(64) }));
  const sourceBody = { mode: "read_only_preflight", status: "blocked", executed: false,
    environment: "production", codeSha: "a".repeat(40), databaseFingerprint: "b".repeat(64),
    schemaDigest: "c".repeat(64), migrationCount: 171, migrationHead: "20260918170000_pol109_project_close_stages",
    deletionCandidates: [], blockers: files.map(file => ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } })) };
  const source = { ...sourceBody, reportSha256: sha256(sourceBody) };
  const payload = { schemaVersion: 1, purpose: "pol122-two-orphan-production-continuity-v1",
    predecessorReceiptSha256: anchor, candidateSha: source.codeSha, databaseFingerprint: source.databaseFingerprint,
    environment: source.environment, schemaDigest: source.schemaDigest, migrationCount: source.migrationCount,
    migrationHead: source.migrationHead, sourceReportSha256: source.reportSha256, issuer: "independent-control-plane",
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const signed = body => {
    const bytes = Buffer.from(JSON.stringify(body));
    return { schemaVersion: 1, algorithm: "Ed25519", payload: bytes.toString("base64"),
      signature: sign(null, bytes, keys.privateKey).toString("base64") };
  };
  const envelope = signed(payload);
  const scope = { files, sourceReportSha256: source.reportSha256, schemaContinuitySha256: sha256(envelope) };
  const verify = (options = {}) => validateProductionContinuity(options.envelope ?? envelope,
    options.predecessor ?? predecessor, options.source ?? source, options.scope ?? scope,
    options.key ?? keys.publicKey.export({ type: "spki", format: "pem" }), options.anchor ?? anchor);
  assert.deepEqual(verify(), { envelopeSha256: sha256(envelope), predecessorReceiptSha256: anchor,
    candidateSha: source.codeSha, expiresAt: payload.expiresAt });

  await t.test("错误的既有 #296 回执字节被拒绝", () => {
    assert.throws(() => verify({ predecessor: Buffer.from("different") }), /PRODUCTION_CONTINUITY_INVALID/u);
  });
  await t.test("新增第三个 blocker 被拒绝，即使两个目标仍在", () => {
    assert.throws(() => verify({ source: { ...source, blockers: [...source.blockers,
      { code: "FORMAL_AGGREGATE_CHILD_PROTECTED" }] } }), /PRODUCTION_CONTINUITY_INVALID/u);
  });
  await t.test("目标行或报告摘要漂移被拒绝", () => {
    assert.throws(() => verify({ scope: { ...scope, files: [files[0], { ...files[1], id: randomUUID() }] } }),
      /PRODUCTION_CONTINUITY_INVALID/u);
    assert.throws(() => verify({ scope: { ...scope, sourceReportSha256: "d".repeat(64) } }),
      /PRODUCTION_CONTINUITY_INVALID/u);
  });
  await t.test("旧候选 SHA、Schema 与迁移漂移被拒绝", () => {
    for (const field of ["codeSha", "schemaDigest", "migrationCount", "migrationHead"]) {
      assert.throws(() => verify({ source: { ...source, [field]: field === "migrationCount" ? 170 : "changed" } }),
        /PRODUCTION_CONTINUITY_INVALID/u);
    }
  });
  await t.test("签名用途、前序回执与有效期不能扩张", () => {
    for (const change of [
      { purpose: "isolated-orphan-file-disposition-v1" },
      { predecessorReceiptSha256: "f".repeat(64) },
      { expiresAt: new Date(Date.now() + 3600000).toISOString() },
      { deleteAll: true }
    ]) {
      assert.throws(() => verify({ envelope: signed({ ...payload, ...change }) }), /PRODUCTION_CONTINUITY_INVALID/u);
    }
  });
  await t.test("替换签名、公钥或 scope 对 envelope 的绑定被拒绝", () => {
    const other = generateKeyPairSync("ed25519");
    assert.throws(() => verify({ key: other.publicKey.export({ type: "spki", format: "pem" }) }),
      /PRODUCTION_CONTINUITY_INVALID/u);
    assert.throws(() => verify({ scope: { ...scope, schemaContinuitySha256: "f".repeat(64) } }),
      /PRODUCTION_CONTINUITY_INVALID/u);
  });
  await t.test("隔离测试和预发布环境不能冒充正式来源", () => {
    assert.throws(() => verify({ source: { ...source, environment: "isolated-test" } }),
      /PRODUCTION_CONTINUITY_INVALID/u);
    assert.throws(() => verify({ source: { ...source, environment: "staging" } }),
      /PRODUCTION_CONTINUITY_INVALID/u);
  });
});
