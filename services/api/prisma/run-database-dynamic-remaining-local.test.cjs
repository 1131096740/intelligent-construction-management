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
    pendingTests: 28,
    requiresOperatingLedgerWriteSecret: true
  });
});
