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
