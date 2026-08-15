#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const {
  assertExecutionArguments,
  assertLocalDockerEndpoint,
  assertSafeExecutionEnvironment,
  createChildEnvironment,
  inheritedDatabaseTargetNames,
  loadManifest,
  parseArguments,
  validateManifest
} = require("./run-database-dynamic-gate-local.cjs");
const {
  GROUPS: remainingGroups,
  selectGroups: selectRemainingGroups
} = require("./run-database-dynamic-remaining-local.cjs");

const runnerPath = path.join(
  __dirname,
  "run-database-dynamic-gate-local.cjs"
);

test("manifest derives all 89 pending tests as executable local coverage", () => {
  const manifest = loadManifest();
  const result = validateManifest(manifest);

  assert.deepEqual(result, {
    pendingFiles: 37,
    fullyPendingSuites: 27,
    partiallyPendingSuites: 10,
    pendingTests: 89,
    coveredFiles: 37,
    coveredTests: 89,
    remainingFiles: 0,
    remainingTests: 0,
    migrationCount: 130,
    terminalMigration:
      "20260815150000_pol06_expense_employee_subjects"
  });
});

test("manifest validation fails closed when inventory totals drift", () => {
  const manifest = structuredClone(loadManifest());
  manifest.inventory.coveredTests = 25;

  assert.throws(
    () => validateManifest(manifest),
    /inventory\.coveredTests=25，派生值=89/u
  );
});

test("execution arguments require an exact SHA and explicit confirmation", () => {
  const manifest = loadManifest();
  assert.deepEqual(parseArguments([]), {
    mode: "preview",
    candidateSha: undefined,
    confirmation: undefined,
    groups: []
  });
  const options = parseArguments([
    "--execute",
    "--candidate-sha",
    "a".repeat(40),
    "--group",
    "payment_execution",
    "--confirm",
    "LOCAL_PG16_DYNAMIC_GATE"
  ]);
  assert.deepEqual(options.groups, ["payment_execution"]);
  assert.doesNotThrow(() => assertExecutionArguments(options, manifest));
  assert.throws(
    () => assertExecutionArguments({ ...options, candidateSha: "abc" }, manifest),
    /完整 40 位/u
  );
  assert.throws(
    () => assertExecutionArguments({ ...options, confirmation: "yes" }, manifest),
    /LOCAL_PG16_DYNAMIC_GATE/u
  );
});

test("list mode exposes only the requested database group and stays read-only", () => {
  const result = spawnSync(
    process.execPath,
    [runnerPath, "--list", "--group", "payment_execution"],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      env: {
        PATH: "",
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://preview-must-not-use.example/prod",
        DOCKER_HOST: "tcp://preview-must-not-use.example:2376"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.coveredGroups.map((group) => group.id),
    ["payment_execution"]
  );
  assert.equal(payload.coveredTests, 1);
  assert.equal(payload.coveredFiles, 1);
  assert.doesNotMatch(result.stdout, /preview-must-not-use/u);
});

test("group selection rejects unknown and duplicate database groups", () => {
  for (const args of [
    ["--list", "--group", "missing_group"],
    [
      "--list",
      "--group",
      "payment_execution",
      "--group",
      "payment_execution"
    ]
  ]) {
    const result = spawnSync(process.execPath, [runnerPath, ...args], {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /数据库组/u);
  }
});

test("remaining runner can isolate one exact database subgroup", () => {
  assert.deepEqual(
    selectRemainingGroups(["--group", "generic_database_constraints"]).map(
      (group) => group.id
    ),
    ["generic_database_constraints"]
  );
  assert.equal(selectRemainingGroups([]).length, remainingGroups.length);
});

test("remaining runner rejects unknown, duplicate or malformed subgroup arguments", () => {
  for (const args of [
    ["--group", "missing_group"],
    ["--group", "generic_database_constraints", "--group", "generic_database_constraints"],
    ["--unknown", "generic_database_constraints"]
  ]) {
    assert.throws(() => selectRemainingGroups(args), /子组/u);
  }
});

test("execution rejects inherited database targets without printing values", () => {
  const environment = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://must-not-appear.example/prod",
    CONTRACT_DATABASE_URL: "postgresql://also-must-not-appear.example/prod"
  };

  assert.deepEqual(inheritedDatabaseTargetNames(environment), [
    "CONTRACT_DATABASE_URL",
    "DATABASE_URL"
  ]);
  assert.throws(
    () => assertSafeExecutionEnvironment(environment),
    (error) => {
      assert.match(error.message, /CONTRACT_DATABASE_URL, DATABASE_URL/u);
      assert.doesNotMatch(error.message, /must-not-appear/u);
      return true;
    }
  );
});

test("execution accepts only local Docker sockets and never production mode", () => {
  assert.equal(
    assertLocalDockerEndpoint('"unix:///var/run/docker.sock"'),
    "unix:///var/run/docker.sock"
  );
  assert.equal(
    assertLocalDockerEndpoint("npipe:////./pipe/docker_engine"),
    "npipe:////./pipe/docker_engine"
  );
  assert.throws(
    () => assertLocalDockerEndpoint("tcp://docker.example.com:2376"),
    /拒绝远程/u
  );
  assert.throws(
    () => assertSafeExecutionEnvironment({ NODE_ENV: "production" }),
    /禁止/u
  );
});

test("child runner environment is allowlisted and cannot inherit secrets or DB URLs", () => {
  const child = createChildEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/local-home",
      XDG_CACHE_HOME: "/tmp/local-cache",
      DATABASE_URL: "postgresql://must-not-leak",
      CONTRACT_DATABASE_URL: "postgresql://must-not-leak",
      NODE_OPTIONS: "--require must-not-leak",
      POSTGRES_PASSWORD: "must-not-leak",
      DOCKER_CONTEXT: "must-not-leak"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.deepEqual(child, {
    PATH: "/usr/bin",
    HOME: "/tmp/local-home",
    TMPDIR: "/tmp/dynamic-gate",
    NODE_ENV: "test",
    CI: "true",
    DOCKER_HOST: "unix:///var/run/docker.sock",
    COREPACK_HOME: "/tmp/local-cache/node/corepack"
  });
});

test("preserves an explicitly configured Corepack cache location", () => {
  const child = createChildEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/local-home",
      COREPACK_HOME: "/opt/corepack-cache"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.equal(child.COREPACK_HOME, "/opt/corepack-cache");
});

test("derives the Corepack cache from the child HOME when XDG is absent", () => {
  const child = createChildEnvironment(
    { PATH: "/usr/bin", HOME: "/tmp/local-home" },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.equal(child.COREPACK_HOME, "/tmp/local-home/.cache/node/corepack");
});

test("default and list modes stay read-only even with no executable PATH", () => {
  for (const args of [[], ["--list"], ["--validate-manifest"]]) {
    const result = spawnSync(process.execPath, [runnerPath, ...args], {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      env: {
        PATH: "",
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://preview-must-not-use.example/prod",
        DOCKER_HOST: "tcp://preview-must-not-use.example:2376"
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"executed": false/u);
    assert.doesNotMatch(result.stdout, /preview-must-not-use/u);
  }
});
