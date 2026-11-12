#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GROUPS,
  createRuntimeEnvironment
} = require("./run-database-dynamic-remaining-local.cjs");

test("operating-ledger group receives a fresh isolated write secret", () => {
  const group = GROUPS.find(({ id }) => id === "generic_database_constraints");
  assert.ok(group);

  const first = createRuntimeEnvironment(
    { PATH: "/usr/bin", OPERATING_LEDGER_DB_WRITE_SECRET: "must-not-inherit" },
    "/tmp/dynamic-gate",
    "postgresql://jiangkong:jiangkong@127.0.0.1:5432/jiangkong_database_dynamic_misc",
    group
  );
  const second = createRuntimeEnvironment(
    { PATH: "/usr/bin" },
    "/tmp/dynamic-gate",
    "postgresql://jiangkong:jiangkong@127.0.0.1:5432/jiangkong_database_dynamic_misc",
    group
  );

  assert.match(first.OPERATING_LEDGER_DB_WRITE_SECRET, /^[0-9a-f-]{36}$/u);
  assert.notEqual(first.OPERATING_LEDGER_DB_WRITE_SECRET, "must-not-inherit");
  assert.notEqual(first.OPERATING_LEDGER_DB_WRITE_SECRET, second.OPERATING_LEDGER_DB_WRITE_SECRET);
});

test("participant-history group uses its dedicated database and both profile gates", () => {
  const group = GROUPS.find(({ id }) => id === "participant_history_integrity");
  assert.deepEqual(group, {
    id: "participant_history_integrity",
    database: "jiangkong_participant_history_integrity_test",
    files: ["src/database/project-operating-profile-db.spec.ts"],
    flags: {
      DATABASE_URL: "databaseUrl",
      RUN_PROJECT_OPERATING_PROFILE_DB_TESTS: "1",
      RUN_PARTICIPANT_HISTORY_INTEGRITY_DATABASE: "1",
      PARTICIPANT_HISTORY_INTEGRITY_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 30,
    requiresOperatingLedgerWriteSecret: true
  });
});

test("the terminal upgrade stages the exact predecessor before deploying only its successor", async () => {
  const Module = require("node:module");
  const { readFileSync } = require("node:fs");
  const path = require("node:path");
  const filename = path.join(__dirname, "run-database-dynamic-remaining-local.cjs");
  const fixture = new Module(filename, module);
  fixture.filename = filename;
  fixture.paths = Module._nodeModulePaths(__dirname);
  fixture._compile(readFileSync(filename, "utf8").replace(/^#!.*\n/u, "") + `
module.exports.runTerminalUpgrade = async (rejectPredecessor) => {
  const calls = [];
  const directory = await mkdtemp(path.join(tmpdir(), "remaining-model-"));
  run = async (_bin, args) => { calls.push(args.slice(4)); return {}; };
  try {
    await migrate("postgresql://jiangkong:test@127.0.0.1:5432/jiangkong_wage_statement_dynamic_test", {}, {
      temporaryRoot: directory,
      group: GROUPS.find(group => group.preTerminalMigrationFixture === "terminal_migration"),
      migration: { async migrate({schemaPath}) {
        const {readdir} = require("node:fs/promises");
        const entries = await readdir(path.join(path.dirname(schemaPath), "migrations"), {withFileTypes:true});
        assertFixture(!entries.some(entry => entry.name === TERMINAL_MIGRATION));
        calls.push(["qualified", entries.filter(entry => entry.isDirectory()).length]);
        if (rejectPredecessor) throw new Error("controlled predecessor rejection");
      }}
    });
  } catch (error) {
    if (!rejectPredecessor || error.message !== "controlled predecessor rejection") throw error;
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
  function assertFixture(condition) { if (!condition) throw new Error("terminal fixture contains successor"); }
  return calls;
};
`, filename);
  assert.deepEqual(await fixture.exports.runTerminalUpgrade(false), [
    ["qualified", 258], ["migrate", "deploy"], ["migrate", "status"]
  ]);
  assert.deepEqual(await fixture.exports.runTerminalUpgrade(true), [["qualified", 258]]);
});
