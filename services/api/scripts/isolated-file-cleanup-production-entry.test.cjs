"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { sha256 } = require("./business-zeroing-core.cjs");
const { TRUSTED_AUTHORIZATION_PUBLIC_KEY_PATH, TRUSTED_SCHEMA_CONTINUITY_PUBLIC_KEY_PATH } =
  require("./business-zeroing-cli.cjs");

test("生产入口与本机入口不共享可切换的主编排器", () => {
  assert.equal(require("./isolated-file-cleanup.cjs").productionRunMain, undefined);
  assert.equal(typeof require("./isolated-file-cleanup-production-inspection.cjs").runMain, "function");
});

test("Schema 连续性与处置授权使用不同的固定信任锚", () => {
  assert.notEqual(TRUSTED_SCHEMA_CONTINUITY_PUBLIC_KEY_PATH, TRUSTED_AUTHORIZATION_PUBLIC_KEY_PATH);
  assert.equal(TRUSTED_SCHEMA_CONTINUITY_PUBLIC_KEY_PATH,
    "/etc/jiangkong/pol122-schema-continuity-public-key.pem");
});

test("生产只读入口拒绝两个孤儿文件之外的任何来源 blocker", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pol122-production-extra-blocker-"));
  try {
    const files = [randomUUID(), randomUUID()].map(id => ({ id, rowSha256: "a".repeat(64) }));
    const sourceBody = { mode: "read_only_preflight", status: "blocked", executed: false,
      deletionCandidates: [], blockers: [
        ...files.map(file => ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } })),
        { code: "MISSING_POLICY_TABLE", details: { table: "OtherTable" } }
      ] };
    const source = { ...sourceBody, reportSha256: sha256(sourceBody) };
    const scopePath = path.join(directory, "scope.json");
    const sourcePath = path.join(directory, "source.json");
    writeFileSync(scopePath, JSON.stringify({ payload: { files, sourceReportSha256: source.reportSha256 } }),
      { mode: 0o600 });
    writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
    const result = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
      "production-isolated-file-cleanup", "inspect", "--scope", scopePath,
      "--source-report", sourcePath], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout),
      { status: "blocked", code: "SOURCE_TARGET_MISMATCH", executed: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("独立生产入口缺少连续性收据时在数据库和 COS 前阻断", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pol122-production-entry-"));
  try {
    const files = [randomUUID(), randomUUID()].map(id => ({ id, rowSha256: "a".repeat(64) }));
    const sourceBody = { mode: "read_only_preflight", status: "blocked", executed: false,
      environment: "production", codeSha: "a".repeat(40), databaseFingerprint: "b".repeat(64),
      schemaDigest: "c".repeat(64), migrationHead: "20260918170000_pol109_project_close_stages",
      migrationCount: 171, deletionCandidates: [], blockers: files.map(file =>
        ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } })) };
    const source = { ...sourceBody, reportSha256: sha256(sourceBody) };
    const scope = { payload: { files, sourceReportSha256: source.reportSha256 } };
    const scopePath = path.join(directory, "scope.json");
    const sourcePath = path.join(directory, "source.json");
    writeFileSync(scopePath, JSON.stringify(scope), { mode: 0o600 });
    writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
    const launcher = path.join(__dirname, "run-business-zeroing-cli.sh");
    const run = command => spawnSync("/bin/sh", [launcher, command, "inspect",
      "--scope", scopePath, "--source-report", sourcePath], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    const production = run("production-isolated-file-cleanup");
    assert.equal(production.status, 2);
    assert.equal(production.stderr, "");
    assert.deepEqual(JSON.parse(production.stdout),
      { status: "blocked", code: "PRODUCTION_CONTINUITY_REQUIRED", executed: false });
    const fakeReceipt = path.join(directory, "fake-pol25a.json");
    const fakeEnvelope = path.join(directory, "fake-continuity.json");
    writeFileSync(fakeReceipt, "{}", { mode: 0o600 });
    writeFileSync(fakeEnvelope, "{}", { mode: 0o600 });
    const forged = spawnSync("/bin/sh", [launcher, "production-isolated-file-cleanup", "inspect",
      "--scope", scopePath, "--source-report", sourcePath,
      "--pol25a-receipt", fakeReceipt, "--schema-continuity-envelope", fakeEnvelope], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    assert.equal(forged.status, 2);
    assert.deepEqual(JSON.parse(forged.stdout),
      { status: "blocked", code: "PRODUCTION_INSPECTION_AUTHORITY_REQUIRED", executed: false });
    const forgedWithAuthority = spawnSync("/bin/sh", [launcher, "production-isolated-file-cleanup", "inspect",
      "--scope", scopePath, "--source-report", sourcePath,
      "--pol25a-receipt", fakeReceipt, "--schema-continuity-envelope", fakeEnvelope,
      "--scope-authorization", fakeEnvelope, "--batch-id", "two-orphans-001",
      "--output", path.join(directory, "must-not-exist.json")], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    assert.equal(forgedWithAuthority.status, 2);
    assert.deepEqual(JSON.parse(forgedWithAuthority.stdout),
      { status: "blocked", code: "PRODUCTION_CONTINUITY_INVALID", executed: false });
    const missingDryRunMaterial = spawnSync("/bin/sh", [launcher, "production-isolated-file-cleanup", "dry-run",
      "--scope", scopePath, "--source-report", sourcePath,
      "--inspection-report", fakeEnvelope, "--execution-authorization", fakeEnvelope,
      "--scope-authorization", fakeEnvelope,
      "--batch-id", "two-orphans-001", "--output", path.join(directory, "must-not-exist.json")], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    assert.equal(missingDryRunMaterial.status, 2);
    assert.deepEqual(JSON.parse(missingDryRunMaterial.stdout),
      { status: "blocked", code: "PRODUCTION_DRY_RUN_MATERIAL_REQUIRED", executed: false });
    for (const action of ["execute", "postcheck"]) {
      const denied = spawnSync("/bin/sh", [launcher, "production-isolated-file-cleanup", action], {
        encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
      });
      assert.equal(denied.status, 2);
      assert.deepEqual(JSON.parse(denied.stdout),
        { status: "blocked", code: "PRODUCTION_EXECUTION_NOT_ENABLED", executed: false });
    }
    const local = run("isolated-file-cleanup");
    assert.equal(local.status, 2);
    assert.equal(JSON.parse(local.stdout).code, "DATABASE_NOT_CONFIGURED");
    const localWithProductionMaterial = spawnSync("/bin/sh", [launcher, "isolated-file-cleanup", "inspect",
      "--scope", scopePath, "--source-report", sourcePath, "--pol25a-receipt", sourcePath], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" }
    });
    assert.equal(localWithProductionMaterial.status, 2);
    assert.equal(JSON.parse(localWithProductionMaterial.stdout).code, "INVALID_ARGUMENTS");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
