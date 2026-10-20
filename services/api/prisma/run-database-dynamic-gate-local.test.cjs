#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
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
const { deriveMigrationBaseline } = require("./migration-baseline.cjs");
const {
  GROUPS: remainingGroups,
  assertManifestMatchesGroups,
  createRuntimeEnvironment: createRemainingRuntimeEnvironment,
  selectGroups: selectRemainingGroups
} = require("./run-database-dynamic-remaining-local.cjs");
const {
  probePostgresReady
} = require("./verify-fund-execution-v7.cjs");
const {
  waitForLocalTcpReady
} = require("./wait-for-local-tcp-ready.cjs");
const {
  waitForPostgres: waitForContractTemplateScenarioPostgres
} = require("./run-contract-template-scenario-concurrency-local.cjs");
const {
  waitForPostgres: waitForInvoiceLedgerPostgres
} = require("../src/invoice-ledger/run-invoice-ledger-postgresql16-local.cjs");
const {
  waitForPostgres: waitForSettlementDraftPostgres
} = require("./run-settlement-draft-lifecycle-concurrency-local.cjs");
const {
  CURRENT_PROCESS_DYNAMIC_TESTS,
  assertCanonicalMigrationBaseline: assertPol275CanonicalMigrationBaseline,
  assertSafeEnvironment: assertPol275SafeEnvironment,
  inheritedDatabaseTargetNames: inheritedPol275DatabaseTargetNames,
  isExpectedRoleMembershipGuardError,
  legacyJestCli,
  LEGACY_PROCESS_COMPATIBILITY_TESTS,
  REVIEWED_BASE_SHA,
  runtimeEnvironment: createPol275RuntimeEnvironment,
  selectPostgresDiagnostics
} = require("./run-pol275-clearing-reconciliation-local.cjs");

const runnerPath = path.join(
  __dirname,
  "run-database-dynamic-gate-local.cjs"
);

test("POL113 readiness cannot finish on the bootstrap socket-only server", () => {
  const source = readFileSync(path.join(__dirname, "run-pol113-pol115-entry-local.cjs"), "utf8");
  const readiness = source.match(/`(until pg_isready [^`]+)`/u)?.[1];
  assert.ok(readiness, "POL113 must expose its PostgreSQL readiness command");
  // Model the official image's temporary socket-only server, then final TCP server.
  const result = spawnSync(process.env.BASH_BIN || "bash", ["-c", `
    probes=0
    pg_isready() {
      probes=$((probes + 1))
      case " $* " in
        *" -h 127.0.0.1 "*)
          if [ "$probes" -eq 1 ]; then return 1; fi
          echo FINAL_TCP_READY
          return 0
          ;;
        *) echo BOOTSTRAP_SOCKET_READY; return 0 ;;
      esac
    }
    sleep() { :; }
    ${readiness.replaceAll("${database}", "readiness_fixture")}
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FINAL_TCP_READY/u);
  assert.doesNotMatch(result.stdout, /BOOTSTRAP_SOCKET_READY/u);
});

test("fund execution verifier waits for the final postgres PID 1", () => {
  const bootstrapCalls = [];
  const bootstrapSpawn = (_command, args) => {
    bootstrapCalls.push(args);
    return {
      status: 0,
      stdout: "docker-entrypoint.sh\n"
    };
  };
  assert.equal(probePostgresReady("fund-v7", bootstrapSpawn), false);
  assert.equal(bootstrapCalls.length, 1);
  assert.deepEqual(bootstrapCalls[0].slice(-2), ["cat", "/proc/1/comm"]);

  const finalCalls = [];
  const finalSpawn = (_command, args) => {
    finalCalls.push(args);
    return args.includes("pg_isready")
      ? { status: 0, stdout: "accepting connections\n" }
      : { status: 0, stdout: "postgres\n" };
  };
  assert.equal(probePostgresReady("fund-v7", finalSpawn), true);
  assert.equal(finalCalls.length, 2);
  assert.equal(finalCalls[1].includes("pg_isready"), true);
});

test("POL-115 host-port readiness retries until the published loopback port accepts", async () => {
  let probes = 0;
  let sleeps = 0;

  await waitForLocalTcpReady({
    host: "127.0.0.1",
    port: 54321,
    attempts: 3,
    probe: async () => ++probes === 3,
    sleep: async () => {
      sleeps += 1;
    }
  });

  assert.equal(probes, 3);
  assert.equal(sleeps, 2);
  await assert.rejects(
    waitForLocalTcpReady({
      host: "127.0.0.1",
      port: 54321,
      attempts: 2,
      probe: async () => false,
      sleep: async () => {}
    }),
    /本机端口未就绪/u
  );
  await assert.rejects(
    waitForLocalTcpReady({
      host: "0.0.0.0",
      port: 54321,
      attempts: 1,
      probe: async () => true,
      sleep: async () => {}
    }),
    /127\.0\.0\.1/u
  );
});

test("contract template scenario waits for the published loopback port after container readiness", async () => {
  const dockerCalls = [];
  const hostWaitCalls = [];

  await waitForContractTemplateScenarioPostgres(
    "contract-template-postgres",
    43210,
    async (args) => {
      dockerCalls.push(args);
    },
    async (options) => {
      hostWaitCalls.push(options);
    }
  );

  assert.equal(dockerCalls.length, 1);
  assert.equal(dockerCalls[0].includes("pg_isready"), true);
  assert.deepEqual(hostWaitCalls, [
    { host: "127.0.0.1", port: 43210 }
  ]);
});

test("invoice ledger waits for the published loopback port after container readiness", async () => {
  const dockerCalls = [];
  const hostWaitCalls = [];

  await waitForInvoiceLedgerPostgres(
    "invoice-ledger-postgres",
    43211,
    async (args) => {
      dockerCalls.push(args);
    },
    async (options) => {
      hostWaitCalls.push(options);
    }
  );

  assert.equal(dockerCalls.length, 1);
  assert.equal(dockerCalls[0].includes("pg_isready"), true);
  assert.deepEqual(hostWaitCalls, [
    { host: "127.0.0.1", port: 43211 }
  ]);
});

test("invoice ledger refuses the bootstrap socket-only server before host readiness", async () => {
  const dockerCalls = [];
  let finalServerReady = false;
  await waitForInvoiceLedgerPostgres(
    "invoice-bootstrap-postgres",
    43212,
    async (args) => {
      dockerCalls.push(args);
      const hostIndex = args.indexOf("-h");
      if (hostIndex >= 0 && args[hostIndex + 1] === "127.0.0.1") {
        if (dockerCalls.length === 1) throw new Error("bootstrap has no TCP listener");
        finalServerReady = true;
      }
    },
    async () => assert.equal(finalServerReady, true, "host TCP accept must not hide socket-only initialization")
  );
  assert.equal(dockerCalls.length, 2);
});

test("settlement draft readiness waits beyond the bootstrap socket-only server", async () => {
  const dockerCalls = [];
  let finalServerReady = false;
  await waitForSettlementDraftPostgres("settlement-bootstrap-postgres", async (args) => {
    dockerCalls.push(args);
    const hostIndex = args.indexOf("-h");
    if (hostIndex >= 0 && args[hostIndex + 1] === "127.0.0.1") {
      if (dockerCalls.length === 1) throw new Error("bootstrap has no TCP listener");
      finalServerReady = true;
    }
  });
  assert.equal(finalServerReady, true, "migration must wait for the final TCP server");
  assert.equal(dockerCalls.length, 2);
});

test("manifest derives all 470 pending tests as executable local coverage", () => {
  const manifest = loadManifest();
  const result = validateManifest(manifest);
  const baseline = deriveMigrationBaseline(path.join(__dirname, "migrations"));

  assert.deepEqual(result, {
    pendingFiles: 72,
    fullyPendingSuites: 61,
    partiallyPendingSuites: 11,
    pendingTests: 470,
    coveredFiles: 72,
    coveredTests: 470,
    remainingFiles: 0,
    remainingTests: 0,
    migrationCount: baseline.expectedDirectoryCount,
    terminalMigration: baseline.terminalMigration,
    terminalMigrationChecksum: baseline.terminalMigrationChecksum
  });
});

test("canonical manifest executes all 14 POL-108 PG16 tests across three independent shards", () => {
  const { SHARDS } = require("./pol108-shards.cjs");
  const groups = loadManifest().coveredGroups.filter(group => group.id.startsWith("operating_projection_pol108"));
  assert.equal(groups.length, 3);
  assert.equal(groups.reduce((sum, group) => sum + group.pendingTests, 0), 14);
  for (const [shard, config] of Object.entries(SHARDS)) {
    const id = "operating_projection_pol108" + (shard === "core" ? "" : `_${shard}`);
    const group = groups.find(entry => entry.id === id);
    assert.equal(group.pendingTests, config.titles.length);
    assert.deepEqual(group.testFiles, [{ path: `services/api/${config.file}`, pendingTests: config.titles.length, suiteStatus: "fully_pending" }]);
    assert.equal(group.runner.script, `verify:pol108-operating-projection:${shard}:local`);
  }
});

test("canonical manifest executes the POL-109 project close PG16 and HTTP acceptance", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "project_close_profit_pol109"
  );

  assert.deepEqual(group, {
    id: "project_close_profit_pol109",
    pendingTests: 4,
    testFiles: [
      {
        path: "services/api/src/database/project-close-profit-postgresql.spec.ts",
        pendingTests: 3,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/project-close-profit/project-close-profit.http.pg.spec.ts",
        pendingTests: 1,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "workspaceScript",
      script: "verify:pol109-project-close-profit:local",
      path: "services/api/prisma/run-pol109-project-close-profit-local.cjs"
    },
    state: "executable_local_runner"
  });
});

test("POL-109 runner resolves Playwright from the Web workspace", () => {
  const source = readFileSync(
    path.join(__dirname, "run-pol109-project-close-profit-local.cjs"),
    "utf8"
  );

  assert.match(
    source,
    /require\.resolve\("@playwright\/test\/cli",\s*\{\s*paths:\s*\[path\.join\(root,\s*"apps\/web-admin"\)\]\s*\}\)/u
  );
});

test("POL-109 readiness ignores the Unix-only initialization server until TCP PostgreSQL is ready", async () => {
  const source = readFileSync(path.join(__dirname, "run-pol109-project-close-profit-local.cjs"), "utf8");
  const start = source.indexOf("async function waitForPostgres(");
  const end = source.indexOf("async function waitForApi(", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const command = async (_bin, args) => {
    calls.push(args);
    // PostgreSQL's temporary init server accepts Unix sockets before its final TCP server starts.
    if (args.includes("-h") && calls.length === 1) throw new Error("TCP server still initializing");
    return { stdout: "accepting connections" };
  };
  const wait = new Function("command", "docker", "DATABASE_NAME", "fail", "setTimeout",
    `${source.slice(start, end)}; return waitForPostgres;`)(
    command, "docker", "jiangkong_pol109", (message) => { throw new Error(message); }, (callback) => callback()
  );
  await wait("owned-disposable-container");
  assert.equal(calls.length, 2, "Unix-only readiness must not allow migration to start");
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 3), ["exec", "owned-disposable-container", "pg_isready"]);
    assert.equal(args[args.indexOf("-h") + 1], "127.0.0.1");
  }
});

test("canonical manifest executes all 169 entry tests including the template workbench", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "pol113_pol115_business_entries"
  );

  assert.deepEqual(group, {
    id: "pol113_pol115_business_entries",
    pendingTests: 169,
    testFiles: [
      {
        path: "services/api/src/database/base-entry-http-postgres.spec.ts",
        pendingTests: 23,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/database/contract-business-entry-http.spec.ts",
        pendingTests: 8,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/expense-claim/expense-claim-entry.http.pg.spec.ts",
        pendingTests: 56,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/fund-execution/fund-execution-entry.http.pg.spec.ts",
        pendingTests: 2,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/spot-procurement/spot-procurement-entry.http.pg.spec.ts",
        pendingTests: 3,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/settlement/settlement-template-workbench.http.pg.spec.ts",
        pendingTests: 9,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/database/draft-hard-deletion.pg.spec.ts",
        pendingTests: 57,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/database/draft-deletion-numbering.pg.spec.ts",
        pendingTests: 2,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/database/approval-v6-independent-http-postgres.spec.ts",
        pendingTests: 9,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "node",
      path: "services/api/prisma/run-pol113-pol115-entry-local.cjs"
    },
    state: "executable_local_runner"
  });
});

test("canonical manifest executes all 5 POL-280 PG16 tests", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "project_fund_dispute_pol280"
  );

  assert.deepEqual(group, {
    id: "project_fund_dispute_pol280",
    pendingTests: 5,
    testFiles: [
      {
        path: "services/api/src/database/project-fund-dispute-postgresql.spec.ts",
        pendingTests: 5,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "workspaceScript",
      script: "verify:pol280-project-fund-dispute:local",
      path: "services/api/prisma/run-pol280-project-fund-dispute-local.cjs"
    },
    state: "executable_local_runner"
  });
});

test("canonical manifest executes all 11 POL-275 PG16 tests", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "clearing_reconciliation_pol275"
  );

  assert.deepEqual(group, {
    id: "clearing_reconciliation_pol275",
    pendingTests: 11,
    testFiles: [
      {
        path: "services/api/src/database/clearing-reconciliation-concurrency.spec.ts",
        pendingTests: 10,
        suiteStatus: "fully_pending"
      },
      {
        path: "services/api/src/database/clearing-reconciliation-legacy-compatibility.spec.ts",
        pendingTests: 1,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "workspaceScript",
      script: "verify:pol275-clearing-reconciliation:local",
      path: "services/api/prisma/run-pol275-clearing-reconciliation-local.cjs",
      evidenceEnv: "POL275_CLEARING_RECONCILIATION_EVIDENCE_PATH"
    },
    state: "executable_local_runner"
  });
});

test("POL-275 receipt counts match the canonical manifest", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "clearing_reconciliation_pol275"
  );
  const currentProcessFile = group.testFiles.find(
    (file) => file.path.endsWith("clearing-reconciliation-concurrency.spec.ts")
  );
  const legacyProcessFile = group.testFiles.find(
    (file) => file.path.endsWith("clearing-reconciliation-legacy-compatibility.spec.ts")
  );

  assert.equal(CURRENT_PROCESS_DYNAMIC_TESTS, currentProcessFile.pendingTests);
  assert.equal(LEGACY_PROCESS_COMPATIBILITY_TESTS, legacyProcessFile.pendingTests);
  assert.equal(
    CURRENT_PROCESS_DYNAMIC_TESTS + LEGACY_PROCESS_COMPATIBILITY_TESTS,
    group.pendingTests
  );
});

test("POL-275 runner keeps its frozen migration position while allowing later migrations", () => {
  const pol275Migration = "20260909100000_pol275_clearing_reconciliation_repair";
  const laterMigration = "20260910170000_pol279_necessary_expense_reserve";
  assert.doesNotThrow(() => assertPol275CanonicalMigrationBaseline(
    {
      expectedDirectoryCount: 167,
      terminalMigration: laterMigration
    },
    [
      ...Array.from({ length: 165 }, (_, index) => `migration-${index}`),
      pol275Migration,
      laterMigration
    ]
  ));
  assert.throws(
    () => assertPol275CanonicalMigrationBaseline(
      {
        expectedDirectoryCount: 167,
        terminalMigration: laterMigration
      },
      [
        ...Array.from({ length: 165 }, (_, index) => `migration-${index}`),
        "unexpected-migration",
        laterMigration
      ]
    ),
    /POL-275 第 166 个迁移/u
  );
});

test("POL-275 runner fails closed without confirmation and inherited database targets", () => {
  assert.throws(
    () => assertPol275SafeEnvironment({ NODE_ENV: "test" }),
    /LOCAL_PG16_DYNAMIC_GATE/u
  );
  assert.deepEqual(
    inheritedPol275DatabaseTargetNames({
      DATABASE_URL: "secret-one",
      WAGE_DATABASE_URL: "secret-two",
      PATH: "/usr/bin"
    }),
    ["DATABASE_URL", "WAGE_DATABASE_URL"]
  );
  assert.throws(
    () => assertPol275SafeEnvironment({
      NODE_ENV: "test",
      LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE",
      DATABASE_URL: "must-not-be-used"
    }),
    /DATABASE_URL/u
  );
});

test("POL-275 runner preserves rather than repurposes the caller home", () => {
  const environment = createPol275RuntimeEnvironment(
    { HOME: "/caller/home", PATH: "/usr/bin" },
    "/tmp/pol275",
    "postgresql://local/test",
    "local-secret"
  );
  assert.equal(environment.HOME, "/caller/home");
  assert.equal(environment.TMPDIR, "/tmp/pol275");
});

test("POL-275 legacy compatibility binds the reviewed base and its own frozen dependencies", () => {
  assert.equal(REVIEWED_BASE_SHA, "3cf11b6c46b301856b554598522213f0839ef595");
  assert.equal(
    legacyJestCli("/tmp/pol275-reviewed-base"),
    path.join(
      "/tmp/pol275-reviewed-base",
      "services",
      "api",
      "node_modules",
      "jest",
      "bin",
      "jest.js"
    )
  );
  const runnerSource = require("node:fs").readFileSync(
    path.join(__dirname, "run-pol275-clearing-reconciliation-local.cjs"),
    "utf8"
  );
  assert.match(runnerSource, /reviewed_base_frozen_lockfile_offline/u);
  assert.match(runnerSource, /nodeModulesLinkedFromCandidate: false/u);
  assert.doesNotMatch(runnerSource, /await symlink/u);
  assert.doesNotMatch(runnerSource, /NODE_PATH:/u);
});

test("POL-275 role-collision receipt accepts only the exact 42501 membership guard", () => {
  assert.equal(
    isExpectedRoleMembershipGuardError({
      code: "P2010",
      meta: {
        code: "42501",
        message: "ERROR: POL-275 同名技术角色已有成员关系，拒绝迁移且不自动清理"
      }
    }),
    true
  );
  assert.equal(
    isExpectedRoleMembershipGuardError({
      code: "P2010",
      meta: { code: "42601", message: "syntax error" }
    }),
    false
  );
  assert.equal(
    isExpectedRoleMembershipGuardError({
      code: "P2010",
      meta: { code: "42501", message: "unrelated permission denial" }
    }),
    false
  );
});

test("POL-275 runner reports only bounded PostgreSQL error diagnostics", () => {
  assert.equal(
    selectPostgresDiagnostics([
      "LOG: statement: sensitive bulk SQL",
      "ERROR: first migration error",
      "CONTEXT: PL/pgSQL function inline_code_block line 9",
      "STATEMENT: sensitive bulk SQL"
    ].join("\n")),
    "ERROR: first migration error\nCONTEXT: PL/pgSQL function inline_code_block line 9"
  );
});

test("canonical manifest executes all 26 fund execution v7 PG tests", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "fund_execution_v7"
  );

  assert.deepEqual(group, {
    id: "fund_execution_v7",
    pendingTests: 26,
    testFiles: [
      {
        path: "services/api/src/fund-execution/fund-execution-service.pg.spec.ts",
        pendingTests: 26,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "node",
      path: "services/api/prisma/verify-fund-execution-v7.cjs"
    },
    state: "executable_local_runner"
  });
});

test("canonical manifest executes all 10 POL-11B invoice ledger PG tests", () => {
  const manifest = loadManifest();
  const group = manifest.coveredGroups.find(
    (candidate) => candidate.id === "invoice_ledger_pol260"
  );

  assert.deepEqual(group, {
    id: "invoice_ledger_pol260",
    pendingTests: 10,
    testFiles: [
      {
        path: "services/api/src/invoice-ledger/invoice-ledger.postgres.spec.ts",
        pendingTests: 10,
        suiteStatus: "fully_pending"
      }
    ],
    runner: {
      kind: "node",
      path: "services/api/src/invoice-ledger/run-invoice-ledger-postgresql16-local.cjs"
    },
    state: "executable_local_runner"
  });
});

test("manifest validation fails closed when inventory totals drift", () => {
  const manifest = structuredClone(loadManifest());
  manifest.inventory.coveredTests = 26;

  assert.throws(
    () => validateManifest(manifest),
    /inventory\.coveredTests=26，派生值=470/u
  );
});

test("manifest validation fails closed when any RUN_* gated PG spec is unregistered", () => {
  const manifest = structuredClone(loadManifest());
  const groupIndex = manifest.coveredGroups.findIndex(
    (group) => group.id === "fund_execution_v7"
  );
  assert.notEqual(groupIndex, -1);
  const [removed] = manifest.coveredGroups.splice(groupIndex, 1);
  manifest.inventory.pendingFiles -= removed.testFiles.length;
  manifest.inventory.fullyPendingSuites -= removed.testFiles.filter(
    (file) => file.suiteStatus === "fully_pending"
  ).length;
  manifest.inventory.partiallyPendingSuites -= removed.testFiles.filter(
    (file) => file.suiteStatus === "partial_pending"
  ).length;
  manifest.inventory.pendingTests -= removed.pendingTests;
  manifest.inventory.coveredFiles -= removed.testFiles.length;
  manifest.inventory.coveredTests -= removed.pendingTests;

  assert.throws(
    () => validateManifest(manifest),
    /RUN_\* gated PG spec 未登记：services\/api\/src\/fund-execution\/fund-execution-service\.pg\.spec\.ts/u
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
  assert.doesNotThrow(() => assertManifestMatchesGroups());
  assert.deepEqual(
    selectRemainingGroups(["--group", "generic_database_constraints"]).map(
      (group) => group.id
    ),
    ["generic_database_constraints"]
  );
  assert.equal(selectRemainingGroups([]).length, remainingGroups.length);
});

test("wage subgroup upgrades from the immediately preceding migration baseline", () => {
  const group = remainingGroups.find(({ id }) => id === "wage_statement");
  assert.ok(group);
  assert.equal(group.pendingTests, 24);
  assert.equal(group.preTerminalMigrationFixture, "terminal_migration");
  assert.equal(group.requiresOperatingLedgerWriteSecret, true);
});

test("historical wage subgroup derives the service baseline SHA without inheriting caller commit metadata", () => {
  const group = remainingGroups.find(({ id }) => id === "historical_wage_takeover");
  assert.ok(group);

  const environment = createRemainingRuntimeEnvironment(
    {
      PATH: "/usr/bin",
      DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: "a".repeat(40),
      BUILD_COMMIT_SHA: "b".repeat(40),
      GIT_COMMIT_SHA: "c".repeat(40)
    },
    "/tmp/dynamic-gate",
    "postgresql://jiangkong:jiangkong@127.0.0.1:5432/jiangkong_historical_wage_takeover_dynamic_test",
    group
  );

  assert.equal(environment.GIT_COMMIT_SHA, "a".repeat(40));
  assert.equal(environment.BUILD_COMMIT_SHA, undefined);
});

test("historical financial subgroup derives the service baseline SHA without inheriting caller commit metadata", () => {
  const group = remainingGroups.find(({ id }) => id === "historical_financial_takeover");
  assert.ok(group);

  const environment = createRemainingRuntimeEnvironment(
    {
      PATH: "/usr/bin",
      DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: "a".repeat(40),
      BUILD_COMMIT_SHA: "b".repeat(40),
      GIT_COMMIT_SHA: "c".repeat(40)
    },
    "/tmp/dynamic-gate",
    "postgresql://jiangkong:jiangkong@127.0.0.1:5432/jiangkong_historical_financial_takeover_dynamic_test",
    group
  );

  assert.equal(environment.GIT_COMMIT_SHA, "a".repeat(40));
  assert.equal(environment.BUILD_COMMIT_SHA, undefined);
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
      DOCKER_CONTEXT: "must-not-leak",
      LANG: "C",
      LC_ALL: "C"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.deepEqual(child, {
    PATH: "/usr/bin",
    HOME: "/tmp/local-home",
    TMPDIR: "/tmp/dynamic-gate",
    LANG: "C.UTF-8",
    NODE_ENV: "test",
    CI: "true",
    DOCKER_HOST: "unix:///var/run/docker.sock",
    COREPACK_HOME: "/tmp/local-cache/node/corepack"
  });
});

test("child runner preserves explicitly configured task-local Prisma engines", () => {
  const child = createChildEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/local-home",
      PRISMA_QUERY_ENGINE_LIBRARY: "/tmp/dynamic-gate/libquery-engine",
      PRISMA_SCHEMA_ENGINE_BINARY: "/tmp/dynamic-gate/schema-engine"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.equal(
    child.PRISMA_QUERY_ENGINE_LIBRARY,
    "/tmp/dynamic-gate/libquery-engine"
  );
  assert.equal(
    child.PRISMA_SCHEMA_ENGINE_BINARY,
    "/tmp/dynamic-gate/schema-engine"
  );
});

test("child runner preserves the explicitly configured pnpm binary", () => {
  const child = createChildEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/local-home",
      PNPM_BIN: "/tmp/task-tools/pnpm"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.equal(child.PNPM_BIN, "/tmp/task-tools/pnpm");
});

test("child runner preserves only an absolute Playwright browser cache path", () => {
  const child = createChildEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/tmp/local-home",
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/task-playwright"
    },
    "/tmp/dynamic-gate",
    "unix:///var/run/docker.sock"
  );

  assert.equal(child.PLAYWRIGHT_BROWSERS_PATH, "/tmp/task-playwright");
  assert.throws(
    () => createChildEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/tmp/local-home",
        PLAYWRIGHT_BROWSERS_PATH: "relative/playwright"
      },
      "/tmp/dynamic-gate",
      "unix:///var/run/docker.sock"
    ),
    /PLAYWRIGHT_BROWSERS_PATH.*绝对路径/u
  );
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

async function artifactLifecycleFixture(shouldFail, groupId = "artifact-fixture") {
  // Exercise the real executeGate/finally filesystem lifecycle. Infrastructure
  // callbacks are substituted; this fixture does not execute a business/PG gate.
  const Module = require('node:module');
  const fixtureModule = new Module(runnerPath, module);
  fixtureModule.filename = runnerPath;
  fixtureModule.paths = Module._nodeModulePaths(path.dirname(runnerPath));
  const hook = `
module.exports.artifactLifecycleFixture = async (shouldFail, groupId) => {
  let preparations = 0;
  let directory;
  assertExecutionArguments = () => {};
  assertSafeExecutionEnvironment = () => {};
  selectCoveredGroups = () => [{ id: groupId, pendingTests: 1, runner: {} }];
  selectedCoverage = () => ({ coveredFiles: 1, coveredTests: 1 });
  createProbeEnvironment = () => ({});
  assertRepositoryState = async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  resolveLocalDocker = async () => ({ endpoint: 'unix:///fixture', imageId: 'fixture-only' });
  createChildEnvironment = (_source, temporaryRoot) => { directory = temporaryRoot; return { TMPDIR: temporaryRoot }; };
  runPreflight = async () => { preparations += 1; };
  resolveGroupCommand = () => ({ command: 'fixture', args: [] });
  runCommand = async () => {
    await require('node:fs/promises').mkdir(path.join(directory, 'browser-failure'));
    await require('node:fs/promises').writeFile(path.join(directory, 'browser-failure', 'trace.zip'), 'synthetic-private-trace');
    if (shouldFail) throw new Error('controlled browser failure');
  };
  let failure;
  try {
    await executeGate({ manifest: { id: 'filesystem-lifecycle-fixture', executionPolicy: { confirmation: 'fixture' },
      migrationBaseline: { containerImage: 'fixture', expectedDirectoryCount: 0 }, inventory: { remainingTests: 0, remainingFiles: 0 } }, options: {} });
  } catch (error) { failure = error; }
  return { directory, failure, preparations };
};`;
  fixtureModule._compile("const process = { ...require('node:process'), stdout: { write: () => true }, stderr: { write: () => true } };\n" + readFileSync(runnerPath, 'utf8').replace(/^#!.*\n/u, '') + hook, runnerPath);
  return fixtureModule.exports.artifactLifecycleFixture(shouldFail, groupId);
}

test('failed dynamic gate preserves its private browser trace instead of deleting evidence', async () => {
  const { readFile, rm, stat } = require('node:fs/promises');
  const result = await artifactLifecycleFixture(true);
  try {
    assert.match(result.failure?.message ?? '', /controlled browser failure/u);
    assert.equal(await readFile(path.join(result.directory, 'browser-failure', 'trace.zip'), 'utf8'), 'synthetic-private-trace');
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
  } finally { await rm(result.directory, { recursive: true, force: true }); }
});

test('successful dynamic gate still removes its own temporary directory', async () => {
  const { rm, stat } = require('node:fs/promises');
  const result = await artifactLifecycleFixture(false);
  try {
    assert.equal(result.failure, undefined);
    await assert.rejects(stat(result.directory), { code: 'ENOENT' });
  } finally { await rm(result.directory, { recursive: true, force: true }); }
});


test("POL108 prepared dispatch preserves every shard without rerunning pnpm lifecycle", () => {
  const { resolveGroupCommand } = require("./run-database-dynamic-gate-local.cjs");
  const manifest = loadManifest();
  for (const [id, shard] of [["operating_projection_pol108", "core"], ["operating_projection_pol108_facts", "facts"], ["operating_projection_pol108_impacts", "impacts"]]) {
    const group = manifest.coveredGroups.find(group => group.id === id);
    const result = resolveGroupCommand(group);
    assert.equal(result.command, process.execPath);
    assert.deepEqual(result.args, [path.join(__dirname, "run-pol108-operating-projection-local.cjs"), "--shard", shard]);
  }
});

test("remaining runner prepares once before all batches and invokes Jest without pretest", async () => {
  const Module = require("node:module");
  const filename = path.join(__dirname, "run-database-dynamic-remaining-local.cjs");
  const fixture = new Module(filename, module);
  fixture.filename = filename;
  fixture.paths = Module._nodeModulePaths(__dirname);
  fixture._compile(readFileSync(filename, "utf8").replace(/^#!.*\n/u, "") + `
module.exports.capturePreparation = async () => {
  const commands = [];
  assertSafeEnvironment = () => {};
  assertRepositoryState = async () => {};
  assertLocalDockerEndpoint = () => "unix:///fixture";
  freePort = async () => 1234;
  waitForPostgres = async () => {};
  migrate = async () => {};
  assertTerminalMigrationProof = async () => {};
  selectGroups = () => GROUPS.filter(g => !g.preTerminalMigrationFixture).slice(0, 2);
  run = async (bin, args) => { commands.push({bin, args}); return { stdout: "fixture-image" }; };
  await main({PATH: "fixture", DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: "a".repeat(40)}, []);
  return commands;
};`, filename);
  const commands = await fixture.exports.capturePreparation();
  const build = commands.filter(c => c.args.includes("build"));
  const generate = commands.filter(c => c.args.includes("generate"));
  const tests = commands.filter(c => c.args.includes("--runInBand"));
  assert.equal(build.length, 1);
  assert.equal(generate.length, 1);
  assert.equal(tests.length, 2);
  assert.ok(commands.indexOf(generate[0]) < commands.indexOf(build[0]));
  for (const entry of tests) {
    assert.ok(commands.indexOf(build[0]) < commands.indexOf(entry));
    assert.equal(entry.args.includes("test"), false);
    assert.ok(entry.args.includes("jest"));
    assert.ok(entry.args.includes("--runTestsByPath"));
  }
});


test("outer gate delegates preparation only to the remaining runner that always prepares itself", async () => {
  assert.equal((await artifactLifecycleFixture(false)).preparations, 1);
  assert.equal((await artifactLifecycleFixture(false, "remaining_dynamic_postgresql16")).preparations, 0);
});

test("contract finance remaining subgroup creates its own ledger write credential", () => {
  const group = remainingGroups.find(({ id }) => id === "affiliate_company_contract");
  assert.ok(group);
  const env = createRemainingRuntimeEnvironment({ PATH: "/usr/bin", OPERATING_LEDGER_DB_WRITE_SECRET: "caller-secret" }, "/tmp/gate", "postgresql://localhost/synthetic", group);
  assert.match(env.OPERATING_LEDGER_DB_WRITE_SECRET, /^[0-9a-f-]{36}$/u);
  assert.notEqual(env.OPERATING_LEDGER_DB_WRITE_SECRET, "caller-secret");
});

test("contract settlement V2 runner isolates seed files per run and cleans only its temporary storage", async () => {
  const Module = require("node:module");
  const { mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
  const filename = path.join(__dirname, "run-contract-settlement-v2-local.cjs");
  const fixture = new Module(filename, module);
  fixture.filename = filename;
  fixture.paths = Module._nodeModulePaths(__dirname);
  fixture._compile(readFileSync(filename, "utf8").replace(/^#!.*\n/u, "") + `
module.exports.captureSeedStorage = async () => {
  const environments = [];
  freePort = async () => 1234;
  waitForPostgres = async () => {};
  run = async (_bin, args, options = {}) => {
    if (args.includes("context")) return "unix:///fixture";
    if (options.env?.DATABASE_URL) environments.push({ args, env: options.env, cwd: options.cwd });
    if (args.some(arg => arg.endsWith("seed.cjs"))) {
      const { mkdir, writeFile } = require("node:fs/promises");
      await mkdir(options.env.FILE_STORAGE_ROOT, { recursive: true });
      await writeFile(path.join(options.env.FILE_STORAGE_ROOT, "synthetic-seed-file"), "this run only");
    }
    return "";
  };
  await main();
  return environments;
};`, filename);
  const previous = {
    evidence: process.env.CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH,
    storage: process.env.FILE_STORAGE_ROOT
  };
  const existingRoot = await mkdtemp(path.join(require("node:os").tmpdir(), "v2-existing-private-"));
  const existingFile = path.join(existingRoot, "synthetic-existing-file");
  await writeFile(existingFile, "preserve this external file");
  process.env.CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH = path.join(existingRoot, "synthetic-v2-evidence.json");
  process.env.FILE_STORAGE_ROOT = existingRoot;
  try {
    const roots = [];
    for (let run = 0; run < 2; run += 1) {
      const commands = await fixture.exports.captureSeedStorage();
      const seed = commands.find(({ args }) => args.includes("seed") || args.some(arg => arg.endsWith("seed.cjs")));
      assert.ok(seed, "exercise the actual runner's seed invocation");
      assert.equal(seed.env.FILE_STORAGE_DRIVER, "local");
      const storage = seed.env.FILE_STORAGE_ROOT;
      assert.ok(path.isAbsolute(storage));
      assert.notEqual(storage, process.env.FILE_STORAGE_ROOT);
      assert.match(storage, /jiangkong-contract-settlement-v2-[^/\\]+[/\\]storage[/\\]private$/u);
      assert.equal(seed.cwd, path.dirname(path.dirname(storage)), "seed resolves its private files from its working directory");
      assert.ok(commands.some(({ args }) => args.includes("build")), "preserve the seed prerequisite build");
      for (const command of commands) assert.equal(command.env.FILE_STORAGE_ROOT, storage);
      await assert.rejects(stat(path.dirname(path.dirname(storage))), { code: "ENOENT" });
      assert.equal(await readFile(existingFile, "utf8"), "preserve this external file");
      roots.push(storage);
    }
    assert.notEqual(roots[0], roots[1]);
  } finally {
    for (const [name, value] of [["CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH", previous.evidence], ["FILE_STORAGE_ROOT", previous.storage]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(existingRoot, { recursive: true, force: true });
  }
});
