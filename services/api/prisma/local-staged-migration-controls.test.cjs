"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const controls = require("./local-staged-migration-controls.cjs");

const plan = {
  database: "jiangkong_project_financing_quota_concurrency", databaseOid: "16384",
  namespaceOid: "2200", actorOid: "10", ownerOid: "10", systemIdentifier: "123456789",
  runId: "01234567-89ab-cdef-0123-456789abcdef", nonce: "a".repeat(64),
  appName: "jg_fixture_app_" + "b".repeat(24), schemaName: "jg_fixture_" + "c".repeat(24)
};
const setup = {
  runId: plan.runId, appOid: "17000", fileCallerOids: [10, 17001],
  schemaOid: "18000", controlOid: "18001", eventOid: "18002", qualified: true
};
test("setup proof rejects a runtime identity equal to migration owner even when both inputs agree", () => {
  assert.throws(() => controls.checkSetup({ ...setup, appOid: "10" }, plan), /LOCAL_MIGRATION_CONTROL/u);
});

test("fixed control builders reject malformed target or role names before producing SQL", () => {
  for (const change of [{ schemaName: "public;DROP SCHEMA public" }, { appName: "jiangkong" },
    { actorOid: "0" }, { databaseOid: null }, { nonce: "x".repeat(64) }]) {
    assert.throws(() => controls.setupSql({ ...plan, ...change }), /LOCAL_MIGRATION_CONTROL/u);
  }
});

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const migrationRoot = path.join(__dirname, "migrations");
const migrations = fs.readdirSync(migrationRoot).filter(name => /^[0-9]{14}_/u.test(name)).sort()
  .slice(0, 205).map(name => ({ name, sha256: createHash("sha256")
    .update(fs.readFileSync(path.join(migrationRoot, name, "migration.sql"))).digest("hex") }));
plan.migrations = migrations;
test("fixed setup includes independent effective application ACL verification before any cleanup proof", () => {
  const sql = controls.setupSql(plan);
  assert.match(sql, /CREATE FUNCTION jg_fixture_c{24}\.application_qualified\(\)/u);
  assert.equal(sql.includes("__PLAN__"), false);
  assert.equal(sql.includes("GRANT ALL"), false);
  assert.equal(sql.includes("SECURITY DEFINER"), false);
  assert.match(controls.readbackSql(plan, setup), /REPEATABLE READ READ ONLY/u);
  assert.match(controls.cleanupSql(plan, setup), /DROP EVENT TRIGGER/u);
  assert.equal(controls.cleanupSql(plan, setup).includes("CASCADE"), false);
});

function completion() {
  const anchors = [
    [204, "ALTER TABLE", "pg_class", "ContractArchiveFile", null],
    [204, "CREATE FUNCTION", "pg_proc", "protectProjectParticipatingCompanyEndDate", "bf63fd6b2e56aa7d6562f0ab2793ee9f87fd3ffaacb03aee7f3f7162e34c5faa"],
    [205, "ALTER TABLE", "pg_class", "ContractVersion", null],
    [205, "ALTER FUNCTION", "pg_proc", "jg_contract_direct_pending_file_guard_v1", "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1"]
  ];
  return { ...setup, readerPid: 999, events: anchors.map(([stage, tag, catalog, name, body], index) => ({
    ordinal: index + 1, stage, tag, catalog, name, bodySha256: body, objectOid: String(19000 + index),
    querySha256: migrations[stage - 1].sha256, runId: plan.runId, nonce: plan.nonce,
    databaseOid: plan.databaseOid, systemIdentifier: plan.systemIdentifier, actorOid: plan.actorOid,
    appOid: setup.appOid, fileCallerOids: [...setup.fileCallerOids], backendPid: 333,
    backendStart: "2026-11-10T01:02:03.123456Z", transactionId: index < 2 ? "100" : "102",
    preceding: { ...migrations[stage - 2], finished: true, rolledBack: false }
  })) };
}
test("completion accepts four exact anchors from two committed-stage transactions and independent reader", () => {
  controls.checkCompletion(completion(), plan, setup);
});
for (const [name, mutate] of [
  ["same backend reader", row => { row.readerPid = 333; }],
  ["engine backend swap", row => { row.events[3].backendPid = 444; }],
  ["backend start swap", row => { row.events[3].backendStart = "2026-11-10T01:02:04.123456Z"; }],
  ["transaction reused", row => { row.events[2].transactionId = "100"; row.events[3].transactionId = "100"; }],
  ["pair transaction split", row => { row.events[1].transactionId = "101"; }],
  ["SQL drift", row => { row.events[1].querySha256 = "0".repeat(64); }],
  ["body drift", row => { row.events[3].bodySha256 = "0".repeat(64); }],
  ["wrong prior checksum", row => { row.events[2].preceding.sha256 = "0".repeat(64); }],
  ["nonce changed", row => { row.events[1].nonce = "b".repeat(64); }],
  ["caller closure changed", row => { row.events[2].fileCallerOids = [10]; }],
  ["runtime owner substituted", row => { row.appOid = "10"; }],
  ["control OID substituted", row => { row.controlOid = "19000"; }],
  ["missing final anchor", row => { row.events.pop(); }],
  ["extra anchor", row => { row.events.push({ ...row.events[3] }); }]
]) {
  test(`completion rejects ${name}`, () => {
    const row = completion(); mutate(row);
    assert.throws(() => controls.checkCompletion(row, plan, setup), /LOCAL_MIGRATION_CONTROL/u);
  });
}
test("plan accessors are rejected without invoking them", () => {
  let reads = 0;
  const malicious = { ...plan };
  Object.defineProperty(malicious, "schemaName", { enumerable: true, get() { reads++; return plan.schemaName; } });
  assert.throws(() => controls.setupSql(malicious), /LOCAL_MIGRATION_CONTROL/u);
  assert.equal(reads, 0);
});

test("cleanup readback rechecks effective column and routine ACL after controls are gone", () => {
  const sql = controls.cleanReadSql(plan, setup);
  assert.match(sql, /has_column_privilege/u);
  assert.match(sql, /aclexplode\(p.proacl\)/u);
  assert.equal(sql.includes(`${plan.schemaName}.control`), false);
});

test("nested migration accessors and unknown serialization hooks are rejected before invocation", () => {
  let reads = 0;
  const migration = { ...migrations[0] };
  Object.defineProperty(migration, "sha256", { enumerable: true, get() { reads++; return migrations[0].sha256; } });
  assert.throws(() => controls.setupSql({ ...plan, migrations: [migration, ...migrations.slice(1)] }), /LOCAL_MIGRATION_CONTROL/u);
  assert.throws(() => controls.setupSql({ ...plan, extra: { toJSON() { reads++; return "payload"; } } }), /LOCAL_MIGRATION_CONTROL/u);
  assert.throws(() => controls.setupSql({ ...plan, migrations: new Proxy(migrations, { get() { reads++; } }) }), /LOCAL_MIGRATION_CONTROL/u);
  assert.equal(reads, 0);
});
