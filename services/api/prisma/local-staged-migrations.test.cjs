"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createLocalMigrationFixture } = require("./local-staged-migrations.cjs");
const { migrationBaseline: canonicalBaseline } = require("./database-dynamic-gate-manifest.json");

test("an owned container ID mismatch stops before SQL or deployment", async () => {
  let commands = 0;
  const fixture = createLocalMigrationFixture({
    databaseNames: ["jiangkong_project_financing_quota_concurrency"],
    container: {
      id: "a".repeat(64),
      name: "jiangkong-pfq-concurrency-fixture",
      runId: "01234567-89ab-cdef-0123-456789abcdef"
    },
    inspectContainer: async () => ({
      id: "b".repeat(64),
      name: "jiangkong-pfq-concurrency-fixture",
      runId: "01234567-89ab-cdef-0123-456789abcdef",
      running: true
    }),
    executeSql: async () => { commands++; },
    deploy: async () => { commands++; }
  });
  await assert.rejects(fixture.migrate({
    databaseUrl: "postgresql://jiangkong:local@127.0.0.1:55432/jiangkong_project_financing_quota_concurrency"
  }), /LOCAL_MIGRATION_CONTAINER_IDENTITY/u);
  assert.equal(commands, 0);
});

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const container = {
  id: "a".repeat(64), name: "jiangkong-pfq-concurrency-fixture",
  runId: "01234567-89ab-cdef-0123-456789abcdef"
};
const database = "jiangkong_project_financing_quota_concurrency";
const databaseUrl = "postgresql://jiangkong:local@127.0.0.1:55432/" + database +
  "?application_name=jg-pfq-first-01234567-89ab-cdef-0123-456789abcdef";
const actor = { oid: "10", name: "jiangkong", superuser: true, createRole: false,
  createDb: true, replication: true, bypassRls: true, memberships: [] };
const legacyNames = ["jg_payment_execution_payer_issuer", "jg_pol275_owner", "jg_pol275_runtime",
  "jg_pol279_runtime", "jg_pol280_runtime"];
const inert = (name, oid) => ({ oid: String(oid), name, superuser: false, createRole: false,
  createDb: false, replication: false, bypassRls: false, memberships: [] });
const observedContainer = () => ({ ...container, running: true,
  publishedHost: "127.0.0.1", publishedPort: "55432" });

async function canonicalRows() {
  const dir = path.join(__dirname, "migrations");
  const names = (await fs.readdir(dir, { withFileTypes: true }))
    .filter(row => row.isDirectory()).map(row => row.name).sort();
  return Promise.all(names.map(async name => ({ name, sha256: crypto.createHash("sha256")
    .update(await fs.readFile(path.join(dir, name, "migration.sql"))).digest("hex") })));
}

async function fakeFixture(temporaryRoot, mutate, failDatabases = [], masked = false, named = false) {
  const database = named ? "jg_task01_0123456789abcdef0123456789abcdef" : "jiangkong_project_financing_quota_concurrency";
  const container = { id: "a".repeat(64), name: named ? "jg-task01-01234567-89ab-cdef-0123-456789abcdef" : "jiangkong-pfq-concurrency-fixture", runId: "01234567-89ab-cdef-0123-456789abcdef" };
  const actor = { oid: "10", name: named ? "jg_task01_owner" : "jiangkong", superuser: true, createRole: false, createDb: true, replication: true, bypassRls: true, memberships: [] };
  const observedContainer = () => ({ ...container, running: true, publishedHost: "127.0.0.1", publishedPort: "55432" });
  const rows = await canonicalRows();
  const calls = [];
  const databaseNames = [database, "jiangkong_project_financing_quota_pre115_clean",
    "jiangkong_project_financing_quota_pre115_duplicate", "jiangkong_project_financing_quota_pre115_cross_business",
    "jiangkong_project_financing_quota_pre115_replacement_child", "jiangkong_project_financing_quota_pre115_replacement_parent",
    "jiangkong_project_financing_quota_pre116_legacy"];
  const databaseStates = new Map();
  const deploymentRequests = [];
  let currentDatabase = database;
  let nextDeploymentError;
  function currentState() {
    if (!databaseStates.has(currentDatabase)) databaseStates.set(currentDatabase, {
      applied: 0, oid: String(16384 + databaseStates.size), failed: false, rolledBack: false
    });
    return databaseStates.get(currentDatabase);
  }
  let plan;
  let setup;
  let roles = [actor];
  const readback = () => ({ database: currentDatabase, databaseOid: currentState().oid, namespaceOid: "2200",
    actorOid: "10", ownerOid: "10", actor: actor.name, sessionActor: actor.name,
    systemIdentifier: "1234567890123456789", version: 160015, encoding: "UTF8", replication: "origin",
    roles, ledger: [...rows.slice(0, currentState().applied).map(row => ({ ...row, finished: true, rolledBack: false })),
      ...(currentState().rolledBack ? [{ ...rows[114], finished: false, rolledBack: true }] : [])]
      .sort((left, right) => left.name.localeCompare(right.name)) });
  const ports = { container, databaseNames, temporaryRoot,
    inspectContainer: async () => observedContainer(),
    executeSqlStdin: async request => ports.executeSql(request),
    executeSql: async ({ database: targetDatabase, phase, sql }) => {
      currentDatabase = targetDatabase;
      calls.push(phase);
      let result = readback();
      if (phase.startsWith("tail")) {
        result = require("./testdata/local-staged-tail-model.cjs").observe(sql, phase);
        result.ledger = readback().ledger;
        result.identity.actor = actor.name; result.identity.sessionActor = actor.name;
        if (mutate) result = mutate(phase, result, sql);
        return { stdout: JSON.stringify(result), stderr: "" };
      }
      if (phase === "qualification-setup") {
        const match = /'(\{"database":[^\n]+?\})'/u.exec(sql);
        assert.ok(match, "setup must bind its actual plan");
        plan = JSON.parse(match[1]);
        setup = { runId: plan.runId, appOid: String(30000 + databaseStates.size), fileCallerOids: [10, 20004, 20005],
          schemaOid: "31001", controlOid: "31002", eventOid: "31003", qualified: true };
        roles = [...roles, inert(plan.appName, Number(setup.appOid))];
        result = setup;
      }
      if (phase === "stage205-readback") {
        const anchors = [
          [204, "ALTER TABLE", "pg_class", "ContractArchiveFile", null],
          [204, "CREATE FUNCTION", "pg_proc", "protectProjectParticipatingCompanyEndDate", "bf63fd6b2e56aa7d6562f0ab2793ee9f87fd3ffaacb03aee7f3f7162e34c5faa"],
          [205, "ALTER TABLE", "pg_class", "ContractVersion", null],
          [205, "ALTER FUNCTION", "pg_proc", "jg_contract_direct_pending_file_guard_v1", "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1"]
        ];
        const beforeRoutes = [10, ...setup.fileCallerOids.filter(x => x !== 10), Number(setup.appOid)].sort((a,b) => a-b)
          .map(role => [String(role), "51", "52", 23, true, true, true, false,
            role !== Number(setup.appOid), false, null, [[8, false]], role !== Number(setup.appOid), false, false]);
        const afterRoutes = JSON.parse(JSON.stringify(beforeRoutes));
        afterRoutes.find(row => row[0] === setup.appOid)[8] = true;
        const transition = { versionOid: "52", before: beforeRoutes, after: afterRoutes,
          callers: [...setup.fileCallerOids, Number(setup.appOid)].sort((a,b) => a-b),
          acl: ["INSERT", "SELECT", "UPDATE"].map(p => ["10", setup.appOid, p, false]) };
        result = { ...result, ...setup, readerPid: 202, fileCallerTransition: transition,
          events: anchors.map(([stage, tag, catalog, name, bodySha256], index) => ({
            ordinal: index + 1, stage, tag, catalog, name, bodySha256, objectOid: index === 2 ? "52" : String(40001 + index),
            querySha256: rows[Number(stage) - 1].sha256, runId: plan.runId, nonce: plan.nonce,
            databaseOid: plan.databaseOid, systemIdentifier: plan.systemIdentifier, actorOid: plan.actorOid,
            appOid: setup.appOid, fileCallerOids: setup.fileCallerOids, backendPid: 101,
            backendStart: "2026-11-10T12:00:00.123456Z", transactionId: index < 2 ? "1001" : "1002",
            preceding: { ...rows[Number(stage) - 2], finished: true, rolledBack: false }
          })) };
      }
      if (phase === "qualification-cleanup") result = {};
      if (phase === "cleanup-readback") result = { schemaAbsent: true, eventAbsent: true,
        appOid: setup.appOid, applicationQualified: true };
      if (mutate) result = mutate(phase, result);
      return { stdout: JSON.stringify(result), stderr: "" };
    },
    deploy: async request => {
      const url = new URL(request.databaseUrl);
      currentDatabase = decodeURIComponent(url.pathname.slice(1));
      const state = currentState();
      const target = request.schemaPath ? path.dirname(request.schemaPath) : __dirname;
      const files = (await fs.readdir(path.join(target, "migrations"), { withFileTypes: true }))
        .filter(row => row.isDirectory());
      calls.push("deploy-" + files.length);
      if (nextDeploymentError) {
        const error = nextDeploymentError;
        nextDeploymentError = undefined;
        throw error;
      }
      deploymentRequests.push({ database: currentDatabase, count: files.length, url: request.databaseUrl });
      if (files.length === 205) {
        const initial = deploymentRequests.filter(row => row.database === currentDatabase && row.count === 203).at(-1);
        assert.equal(url.searchParams.get("application_name"), new URL(initial.url).searchParams.get("application_name"));
        assert.ok(url.searchParams.get("options").includes("application_role_oid=" + setup.appOid));
        assert.match(url.searchParams.get("options"), /file_caller_oids=\[10,20004,20005\]/u);
      } else assert.equal(url.searchParams.has("options"), false);
      if (files.length === 203 && state.applied === 114 && failDatabases.includes(currentDatabase) && !state.failed) {
        state.failed = true;
        state.failure = new Error(masked ? "current transaction is aborted" : currentDatabase.includes("duplicate") ?
          "project_financing_quota_duplicate_attachment" : "project_financing_quota_cross_business_attachment");
        throw state.failure;
      }
      const before = state.applied;
      state.applied = files.length;
      if (files.length === 203) roles = [...roles, ...legacyNames
        .filter(name => !roles.some(role => role.name === name))
        .map(name => inert(name, 20001 + legacyNames.indexOf(name)))];
      for (const row of rows.slice(0, files.length)) {
        const bytes = await fs.readFile(path.join(target, "migrations", row.name, "migration.sql"));
        assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), row.sha256);
      }
      return { stdout: before === state.applied ? "No pending migrations to apply." :
        "Applying migration " + rows.slice(before, state.applied).map(row => row.name).join("\n"), stderr: "" };
    }
  };
  const fixture = named ? null : createLocalMigrationFixture(ports);
  return { fixture, ports, calls, deploymentRequests, databaseNames,
    resolveHistorical(name) {
      const state = databaseStates.get(name);
      assert.ok(state?.failed);
      state.rolledBack = true;
    },
    failure(name) { return databaseStates.get(name)?.failure; },
    failNextDeploy(error) { nextDeploymentError = error; }
  };
}

test("full fixture deploys exact203 then qualified205, cleans independently and preserves the final no-pending path", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-test-"));
  try {
    const { fixture, calls } = await fakeFixture(temporaryRoot);
    const result = await fixture.migrate({ databaseUrl, runtimeEnv: {} });
    assert.match(result.stdout, /20261108160000_operating_amount_protocol_v2/u);
    assert.match(result.stdout, /20261108220000_contract_archive_v2_authority|20261109100000_contract_direct_pending_input_v1/u);
    assert.match(result.stdout, /20261111096000_contract_direct_outside_operating_basis_bridge_v2/u);
    assert.ok(result.stdout.includes(canonicalBaseline.terminalMigration));
    assert.match(result.stdout, /20260802020000_project_financing_quota_termination_idempotency/u);
    assert.deepEqual(calls, ["preflight", "deploy-203", "stage203-readback", "qualification-setup",
      "deploy-205", "stage205-readback", "qualification-cleanup", "cleanup-readback", "post-qualification",
      ...[213, 215, 218, 221].flatMap(stage => [`deploy-${stage}`, `stage${stage}-readback`,
        `tail${stage}-before`, `tail${stage}-supply`, `tail${stage}-readback`]),
      `deploy-${canonicalBaseline.expectedDirectoryCount}`, "complete-readback"]);
    const repeated = await fixture.migrate({ databaseUrl, runtimeEnv: {} });
    assert.equal(repeated.stdout, "No pending migrations to apply.");
    assert.deepEqual(calls.slice(-2), ["preflight", `deploy-${canonicalBaseline.expectedDirectoryCount}`]);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test("engine URL must use the port actually inspected on the owned container", async () => {
  let commands = 0;
  const fixture = createLocalMigrationFixture({ container, databaseNames: [database],
    inspectContainer: async () => observedContainer(),
    executeSql: async () => { commands++; }, deploy: async () => { commands++; }
  });
  await assert.rejects(fixture.migrate({ databaseUrl: databaseUrl.replace(":55432/", ":55433/") }), /LOCAL_MIGRATION_TARGET/u);
  assert.equal(commands, 0);
});

test("container and option accessors or proxies cannot authorize a fixture", () => {
  let getters = 0;
  const unsafe = { get container() { getters++; return container; } };
  assert.throws(() => createLocalMigrationFixture(unsafe), /LOCAL_MIGRATION_INPUT/u);
  assert.equal(getters, 0);
  const proxied = new Proxy(container, { get() { throw new Error("proxy invoked"); } });
  assert.throws(() => createLocalMigrationFixture({ container: proxied }), /LOCAL_MIGRATION_INPUT/u);
});

for (const change of ["schema", "hole"]) {
  test("a historical prefix with a changed " + change + " stops before SQL and deployment", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-source-"));
    try {
      const target = path.join(temporaryRoot, "prefix");
      await fs.mkdir(path.join(target, "migrations"), { recursive: true });
      await fs.copyFile(path.join(__dirname, "schema.prisma"), path.join(target, "schema.prisma"));
      await fs.copyFile(path.join(__dirname, "migrations/migration_lock.toml"), path.join(target, "migrations/migration_lock.toml"));
      const rows = await canonicalRows();
      for (const row of rows.slice(0, 114)) {
        await fs.cp(path.join(__dirname, "migrations", row.name), path.join(target, "migrations", row.name), { recursive: true });
      }
      if (change === "schema") await fs.appendFile(path.join(target, "schema.prisma"), "\n// tampered datasource material\n");
      else await fs.rm(path.join(target, "migrations", rows[50].name), { recursive: true });
      let commands = 0;
      const fixture = createLocalMigrationFixture({ container, databaseNames: [database], temporaryRoot,
        inspectContainer: async () => observedContainer(),
        executeSql: async () => { commands++; }, deploy: async () => { commands++; }
      });
      await assert.rejects(fixture.migrate({ databaseUrl, schemaPath: path.join(target, "schema.prisma") }),
        change === "schema" ? /LOCAL_MIGRATION_SCHEMA/u : /LOCAL_MIGRATION_SOURCE_PREFIX/u);
      assert.equal(commands, 0);
    } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

for (const [name, phase, mutate, error] of [
  ["wrong203checksum", "stage203-readback", row => ({ ...row, ledger: row.ledger.map((item, index) => index ? item : { ...item, sha256: "f".repeat(64) }) }), /LOCAL_MIGRATION_LEDGER/u],
  ["unresolved203failure", "stage203-readback", row => ({ ...row, ledger: row.ledger.map((item, index) => index ? item : { ...item, finished: false }) }), /LOCAL_MIGRATION_LEDGER/u],
  ["replaced database", "stage203-readback", row => ({ ...row, databaseOid: "90000" }), /LOCAL_MIGRATION_STAGE203/u],
  ["unexpected role", "stage203-readback", row => ({ ...row, roles: [...row.roles, inert("unknown_runtime", 29000)] }), /LOCAL_MIGRATION_ROLE_PROVENANCE/u],
  ["missing205commit", "stage205-readback", row => ({ ...row, ledger: row.ledger.slice(0, -1) }), /LOCAL_MIGRATION_STAGE205/u],
  ["changedmigrationbackend", "stage205-readback", row => ({ ...row, events: row.events.map((item, index) => index === 2 ? { ...item, backendPid: 303 } : item) }), /LOCAL_MIGRATION_CONTROL/u],
  ["cleanupnotproven", "cleanup-readback", row => ({ ...row, eventAbsent: false }), /LOCAL_MIGRATION_CLEANUP/u]
]) {
  test(name + " stops without running later phases or retrying", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-negative-"));
    try {
      const { fixture, calls } = await fakeFixture(temporaryRoot, (current, row) => current === phase ? mutate(row) : row);
      await assert.rejects(fixture.migrate({ databaseUrl }), error);
      assert.equal(calls.includes(`deploy-${canonicalBaseline.expectedDirectoryCount}`), false);
      const completedCalls = calls.length;
      await assert.rejects(fixture.migrate({ databaseUrl }), /LOCAL_MIGRATION_STOPPED/u);
      assert.equal(calls.length, completedCalls);
    } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

for (const query of ["host=/another/socket", "schema=other", "options=-c%20role=other",
  "application_name=second"]) {
  test("engine target refuses added query " + query, async () => {
    let commands = 0;
    const fixture = createLocalMigrationFixture({ container, databaseNames: [database],
      inspectContainer: async () => observedContainer(),
      executeSql: async () => { commands++; }, deploy: async () => { commands++; }
    });
    await assert.rejects(fixture.migrate({ databaseUrl: databaseUrl + "&" + query }), /LOCAL_MIGRATION_TARGET/u);
    assert.equal(commands, 0);
  });
}

async function prefix(root, count) {
  const target = path.join(root, "prefix-" + count);
  await fs.mkdir(path.join(target, "migrations"), { recursive: true });
  await fs.copyFile(path.join(__dirname, "schema.prisma"), path.join(target, "schema.prisma"));
  await fs.copyFile(path.join(__dirname, "migrations/migration_lock.toml"), path.join(target, "migrations/migration_lock.toml"));
  for (const row of (await canonicalRows()).slice(0, count)) {
    await fs.cp(path.join(__dirname, "migrations", row.name), path.join(target, "migrations", row.name), { recursive: true });
  }
  return path.join(target, "schema.prisma");
}

test("one owned cluster preserves all seven original databases and explicit115 failure/resolve recovery", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-journey-"));
  try {
    const negatives = ["duplicate", "cross_business", "replacement_child", "replacement_parent"]
      .map(suffix => "jiangkong_project_financing_quota_pre115_" + suffix);
    const harness = await fakeFixture(temporaryRoot, undefined, negatives);
    const schema114 = await prefix(temporaryRoot, 114);
    const schema115 = await prefix(temporaryRoot, 115);
    await harness.fixture.migrate({ databaseUrl });
    const apps = [];
    for (const name of harness.databaseNames.slice(1)) {
      const url = new URL(databaseUrl);
      url.pathname = "/" + name;
      url.search = "";
      const legacy = name.endsWith("pre116_legacy");
      await harness.fixture.migrate({ databaseUrl: url.toString(), schemaPath: legacy ? schema115 : schema114 });
      if (negatives.includes(name)) {
        const expectedFailure = name.endsWith("duplicate") ? "project_financing_quota_duplicate_attachment" :
          "project_financing_quota_cross_business_attachment";
        const before = harness.calls.length;
        await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString(), expectedFailure }),
          error => error === harness.failure(name));
        assert.equal(harness.calls.slice(before).includes("deploy-205"), false);
        assert.equal(harness.calls.slice(before).filter(call => call === "deploy-203").length, 1);
        // Models only the original runner's independently checked remediation + explicit Prisma resolve.
        harness.resolveHistorical(name);
      }
      const result = await harness.fixture.migrate({ databaseUrl: url.toString() });
      assert.match(result.stdout, /20261111096000_contract_direct_outside_operating_basis_bridge_v2/u);
    assert.ok(result.stdout.includes(canonicalBaseline.terminalMigration));
      apps.push(harness.deploymentRequests.filter(row => row.database === name && row.count === 205).length);
    }
    assert.deepEqual(apps, [1, 1, 1, 1, 1, 1]);
    assert.equal(harness.deploymentRequests.filter(row => row.count === 205).length, 7);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test("an expected115 error cannot resume without the original explicit resolved rollback state", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-unresolved-"));
  try {
    const name = "jiangkong_project_financing_quota_pre115_duplicate";
    const harness = await fakeFixture(temporaryRoot, undefined, [name]);
    // The actual runner starts its current empty database before the historical cases.
    await harness.fixture.migrate({ databaseUrl });
    const url = new URL(databaseUrl);
    url.pathname = "/" + name;
    await harness.fixture.migrate({ databaseUrl: url.toString(), schemaPath: await prefix(temporaryRoot, 114) });
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString(),
      expectedFailure: "project_financing_quota_duplicate_attachment" }), error => error === harness.failure(name));
    const deploys = harness.deploymentRequests.length;
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString() }), /LOCAL_MIGRATION_RECOVERY_NOT_RESOLVED/u);
    assert.equal(harness.deploymentRequests.length, deploys);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});


test("a masked115 engine failure can continue only after the explicit original rollback resolution", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-masked-"));
  try {
    const name = "jiangkong_project_financing_quota_pre115_duplicate";
    const harness = await fakeFixture(temporaryRoot, undefined, [name], true);
    await harness.fixture.migrate({ databaseUrl });
    const url = new URL(databaseUrl);
    url.pathname = "/" + name;
    await harness.fixture.migrate({ databaseUrl: url.toString(), schemaPath: await prefix(temporaryRoot, 114) });
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString(),
      expectedFailure: "project_financing_quota_duplicate_attachment" }), error => error === harness.failure(name));
    assert.equal(harness.failure(name).message, "current transaction is aborted");
    harness.resolveHistorical(name);
    const result = await harness.fixture.migrate({ databaseUrl: url.toString() });
    assert.match(result.stdout, /20261111096000_contract_direct_outside_operating_basis_bridge_v2/u);
    assert.ok(result.stdout.includes(canonicalBaseline.terminalMigration));
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

for (const changed of ["database", "prefix", "telemetry", "environment", "scenario", "password"]) {
  test("a pending masked115 failure blocks changed " + changed + " before SQL or deployment", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-pending-"));
    try {
      const name = "jiangkong_project_financing_quota_pre115_duplicate";
      const harness = await fakeFixture(temporaryRoot, undefined, [name], true);
      await harness.fixture.migrate({ databaseUrl });
      const url = new URL(databaseUrl);
      url.pathname = "/" + name;
      const schemaPath = await prefix(temporaryRoot, 114);
      await harness.fixture.migrate({ databaseUrl: url.toString(), schemaPath });
      await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString(),
        expectedFailure: "project_financing_quota_duplicate_attachment" }));
      const request = { databaseUrl: url.toString() };
      if (changed === "database") { url.pathname = "/" + database; request.databaseUrl = url.toString(); }
      if (changed === "prefix") request.schemaPath = schemaPath;
      if (changed === "telemetry") { url.searchParams.set("application_name", "other"); request.databaseUrl = url.toString(); }
      if (changed === "environment") request.runtimeEnv = { NODE_ENV: "test" };
      if (changed === "scenario") request.expectedFailure = "project_financing_quota_duplicate_attachment";
      if (changed === "password") { url.password = "other"; request.databaseUrl = url.toString(); }
      const commands = harness.calls.length;
      await assert.rejects(harness.fixture.migrate(request), /LOCAL_MIGRATION_RECOVERY_CONTEXT/u);
      assert.equal(harness.calls.length, commands);
    } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

test("an Error reused by a later deployment cannot reopen the previous expected failure window", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-error-reuse-"));
  try {
    const name = "jiangkong_project_financing_quota_pre115_duplicate";
    const harness = await fakeFixture(temporaryRoot, undefined, [name], true);
    await harness.fixture.migrate({ databaseUrl });
    const url = new URL(databaseUrl);
    url.pathname = "/" + name;
    await harness.fixture.migrate({ databaseUrl: url.toString(), schemaPath: await prefix(temporaryRoot, 114) });
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString(),
      expectedFailure: "project_financing_quota_duplicate_attachment" }));
    harness.resolveHistorical(name);
    const original = harness.failure(name);
    harness.failNextDeploy(original);
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString() }), error => error === original);
    const commands = harness.calls.length;
    await assert.rejects(harness.fixture.migrate({ databaseUrl: url.toString() }), /LOCAL_MIGRATION_STOPPED/u);
    assert.equal(harness.calls.length, commands);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test("independent205 caller proof rejects an unexplained route before cleanup or259 suffix", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-staged-caller-delta-"));
  try {
    const harness = await fakeFixture(temporaryRoot, (phase, row) => {
      if (phase === "stage205-readback") {
        const appRoute = row.fileCallerTransition.after.find(r => r[0] === row.appOid);
        appRoute[12] = true; // Table-wide INSERT is not the sealed single-column delta.
      }
      return row;
    });
    await assert.rejects(harness.fixture.migrate({ databaseUrl }), /LOCAL_MIGRATION_CONTROL/u);
    assert.deepEqual(harness.calls.filter(x => x.startsWith("deploy-")), ["deploy-203", "deploy-205"]);
    assert.equal(harness.calls.includes("qualification-cleanup"), false);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test("full259 deployment stops at every mandatory technical supply window before its consumer", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-tail259-frontier-"));
  try {
    const fake = await fakeFixture(dir);
    await fake.fixture.migrate({ databaseUrl });
    assert.deepEqual(fake.deploymentRequests.filter(row => row.database === database).map(row => row.count),
      [203, 205, 213, 215, 218, 221, canonicalBaseline.expectedDirectoryCount]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

for (const [phase, change, forbidden] of [
  ['tail213-before', row => { row.scope.nonce='f'.repeat(64); }, 'tail213-supply'],
  ['tail213-supply', row => { row.bindings.find(b=>b.name==='jg_contract_direct_archive_binding_v1').rows[0].xmin='7'; }, 'tail213-readback'],
  ['tail213-readback', row => { row.protectedAclSha256='e'.repeat(64); }, 'deploy-215'],
  ['tail215-before', row => { row.appTablePrivileges.push({kind:'table',object:'ContractVersion',objectOid:'40000',privilege:'UPDATE',grantable:false}); }, 'tail215-supply'],
  ['tail215-readback', row => { row.pending.sha256='e'.repeat(64); }, 'deploy-218'],
  ['tail218-before', row => { row.required.find(r=>r.key==='Contract/id/SELECT').effective=false; }, 'tail218-supply'],
  ['tail218-supply', row => { row.targets[0].direct[0][3]=true; }, 'tail218-readback'],
  ['tail218-readback', row => { row.identity.backendPid=20218; row.identity.backendStart='2026-11-11T01:02:00.000001Z'; }, 'deploy-221'],
  ['tail221-readback', row => { row.commitStatus='in progress'; }, `deploy-${canonicalBaseline.expectedDirectoryCount}`]
]) test(`tail ${phase} rejects changed proof before advancing or retrying`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail259-negative-'));
  try {
    const fake=await fakeFixture(dir,(current,row)=>{if(current===phase)change(row);return row;});
    await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
      const diagnostic=require("./local-staged-tail-qualification.cjs").localTailFailureDiagnostic(error);
      assert.deepEqual({stage:diagnostic.stage,kind:diagnostic.kind},
        {stage:phase.toUpperCase().replaceAll("-","_"),kind:"NODE_PROOF"});
      assert.match(diagnostic.reason,/^(BEFORE|SUPPLY|READBACK)_VALIDATE_[A-Z0-9_]+$/u);
      assert.equal(error.message.includes("e".repeat(64)),false);
      return true;
    });
    assert.equal(fake.calls.includes(forbidden),false);
    const length=fake.calls.length;
    await assert.rejects(fake.fixture.migrate({databaseUrl}),/LOCAL_MIGRATION_STOPPED/u);
    assert.equal(fake.calls.length,length);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("tail SQL resource errors carry a fixed safe phase without exposing their exception",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail259-resource-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{if(phase==='tail215-supply')throw new Error('SELECT synthetic-secret-role');return row;});
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   assert.deepEqual(require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error),{stage:'TAIL215_SUPPLY',kind:'RESOURCE_PORT',reason:'SUPPLY_RESULT'});
   assert.equal(error.message.includes('SELECT'),false);assert.equal(error.message.includes('synthetic-secret'),false);return true;
  });
  assert.equal(fake.calls.includes('tail215-readback'),false);assert.equal(fake.calls.includes('deploy-218'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("tail ACL proof must bind the actual changed catalog tuple to its writer XID",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail259-acl-xmin-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{
   if(phase==='tail215-supply'&&Object.hasOwn(row.targets[0],'catalogXmin'))row.targets[0].catalogXmin='7';
   return row;
  });
  await assert.rejects(fake.fixture.migrate({databaseUrl}),/LOCAL_MIGRATION_TAIL215_SUPPLY_NODE_PROOF/u);
  assert.equal(fake.calls.includes('tail215-readback'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

for(const [name,alter] of [
 ['same-body review definer',row=>{const f=row.routines?.find(r=>r.name==='jg_guard_contract_direct_review_v1');if(f)f.securityDefiner=true;}],
 ['same-body review configuration',row=>{const f=row.routines?.find(r=>r.name==='jg_guard_contract_direct_review_v1');if(f)f.config=['search_path=pg_catalog, public'];}],
 ['same-body legacy null configuration',row=>{const f=row.routines?.find(r=>r.name==='protectContractEconomicReview');if(f)f.config=['search_path=pg_catalog'];}],
 ['named input type',row=>{const f=row.routines?.find(r=>r.name==='jg_contract_direct_archive_proof_v1');if(f)f.inputTypes=['23'];}],
 ['trigger deferrability',row=>{if(row.triggers)row.triggers[0].deferrable=!row.triggers[0].deferrable;}]
])test(`tail213 refuses ${name} independently of unchanged body and catalog digest`,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail259-source-meta-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{if(phase==='tail213-before')alter(row);return row;});
  await assert.rejects(fake.fixture.migrate({databaseUrl}),/LOCAL_MIGRATION_TAIL213_BEFORE_NODE_PROOF/u);
  assert.equal(fake.calls.includes('tail213-supply'),false);assert.equal(fake.calls.includes('deploy-215'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


// The only replaced boundaries here are the original owned-resource claim and
// bounded Prisma CLI process. No alternative issuer is registered in product.
async function current259Model(temporaryRoot, mutate, technical = true) {
  const model = await fakeFixture(temporaryRoot, mutate, [], false, true);
  const vm = require("node:vm"), nativeRequire = require("node:module").createRequire(__filename);
  const handle = Object.freeze({ simulation: "owned-current259-test" });
  let closed = false, checks = 0, commands = 0, closes = 0, observations = 0, observation = "valid", pauseSql = false, pendingReject, notifySql, closeFails = false, cliHash = "ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388";
  const rows = await canonicalRows();
  const receipt = { runId: container.runId, containerId: container.id, networkId: "b".repeat(64),
    databaseName: "jg_task01_0123456789abcdef0123456789abcdef", port: 55432,
    containerName: "jg-task01-" + container.runId, purpose:"CURRENT259_TECHNICAL_MIGRATIONS_V1",limits:{totalDeadlineMs:3600000} };
  const resource = { containerId: receipt.containerId, networkId: receipt.networkId, port: receipt.port,
    caPath: "/synthetic-immutable-ca.crt", getReceipt: () => ({ ...receipt }),
    captureLogCursor: async () => { observations++; if(observation === "fail") throw Error("synthetic physical inspect failed");
      return {runId:receipt.runId,containerId:observation === "wrong-id" ? "e".repeat(64) : receipt.containerId}; },
    execOwnerSql: (sql, phase) => {
      if(pauseSql) { pauseSql=false; return new Promise((resolve,reject) => { pendingReject=reject; notifySql(); }); }
      if(phase === "current259-live-inspect") {
        if(observation === "stopped") throw Error("synthetic stopped container cannot exec");
        const nonce=/'nonce','([a-f0-9]{64})'/u.exec(sql)?.[1];assert.ok(nonce);
        // PostgreSQL 16 Table 9.40: the explicit inet cast includes the
        // netmask; host(inet) returns the address without it.
        const address=(key,side)=>{
          if(sql.includes(`'${key}',pg_catalog.host(pg_catalog.inet_${side}_addr())`))return "127.0.0.1";
          assert.ok(sql.includes(`'${key}',inet_${side}_addr()::text`));return "127.0.0.1/32";
        };
        return Promise.resolve({stdout:JSON.stringify({nonce,database:observation === "wrong-live-db" ? "foreign" : receipt.databaseName,databaseOid:"16384",namespaceOid:"2200",ownerOid:"10",actorOid:"10",actor:"jg_task01_owner",sessionActor:"jg_task01_owner",systemIdentifier:"1234567890123456789",tls:true,clientAddress:observation==="wrong-client"?"127.0.0.2":observation==="cidr-result"?"127.0.0.1/32":address("clientAddress","client"),serverAddress:observation==="wrong-server"?"127.0.0.2":address("serverAddress","server"),serverPort:5432,backendPid:700+observations})});
      }
      return model.ports.executeSql({ database:receipt.databaseName,phase:phase.replace(/^current259-/u,""),sql });
    } };
  const view = { purpose:"CURRENT259_TECHNICAL_MIGRATIONS_V1",deadlineMs:3600000,source: { candidateSha: "c".repeat(40), profile: { ledgerSha256: "d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952", ledger: rows } },
    build: { node: { path: process.execPath, sha256: crypto.createHash("sha256").update(require("node:fs").readFileSync(process.execPath)).digest("hex") } }, runId: container.runId, resource,
    credentials: () => ({ owner: "synthetic-non-secret" }),
    check: () => { checks++; assert.equal(closed, false, "synthetic resource closed"); },
    verifyFull: () => { checks++; assert.equal(closed, false, "synthetic source closed"); } };
  const cache = new Map(), moduleCache = {};
  const replaced = new Set(["local-staged-current259-profile.cjs", "local-staged-migrations.cjs",
    "local-staged-migration-controls.cjs", "local-staged-tail-qualification.cjs"]);
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(__dirname, name), module = { exports: {} }; cache.set(name, module); moduleCache[file] = module;
    const uncachedRequire = request => {
      if (request === "node:fs") return { ...require("node:fs"), realpathSync(file) {
        if(file.endsWith("services/api/node_modules/prisma/build/index.js") || file.endsWith("schema-engine-darwin-arm64")) return file;
        return require("node:fs").realpathSync(file);
      } };
      if (request === "./task16-runtime-inputs.cjs") return { readQualifiedTask16File(file) {
        if(file.endsWith("schema-engine-darwin-arm64")) return { sha256:"57b090d47b947dc9284379d9480d11ffe14fe63155e3da515b359f3aa7fa408a",identity:{simulation:"fixed-schema-engine"} };
        if(file.endsWith("services/api/node_modules/prisma/build/index.js")) return { sha256:cliHash,identity:{simulation:"fixed-cli"} };
        return { sha256:crypto.createHash("sha256").update(require("node:fs").readFileSync(file)).digest("hex"),identity:{simulation:"fixed-node"} };
      } };
      if (request === "./task16-current259-owned-resource.cjs") return { claimCurrent259OwnedResource(value) {
        assert.equal(value, handle, "synthetic genuine handle required"); view.check(); return view;
      }, claimCurrent259TechnicalResource(value) {
        assert.equal(value,handle,"synthetic genuine handle required");
        if(!technical)throw Error('CURRENT259_TECHNICAL_RESOURCE_REQUIRED');view.check();return view;
      }, closeCurrent259OwnedResource(value) {
        assert.equal(value,handle);closes++;closed=true;
        if(pendingReject)pendingReject(Error("synthetic owned SQL stopped"));
        return closeFails ? Promise.reject(Error("synthetic cleanup unknown")) : Promise.resolve();
      } };
      if (request === "./task16-bounded-command.cjs") return { async runTask16BoundedCommand(executable, args, control) {
        commands++;
        assert.equal(executable, process.execPath);
        assert.equal(args[0], path.join(__dirname, "../node_modules/prisma/build/index.js"));
        assert.equal(control.env.PRISMA_QUERY_ENGINE_LIBRARY, undefined);
        assert.equal(control.env.CHECKPOINT_DISABLE,"1");
        const url = new URL(control.env.DATABASE_URL);
        assert.equal(url.username, "jg_task01_owner"); assert.equal(url.searchParams.get("sslmode"), "require");
        assert.equal(url.searchParams.get("sslaccept"), "strict"); assert.equal(url.searchParams.get("sslcert"), resource.caPath);
        for (const key of ["schema", "connection_limit", "sslmode", "sslaccept", "sslcert", "connect_timeout", "pool_timeout"]) url.searchParams.delete(key);
        const result = await model.ports.deploy({ databaseUrl: url.toString(), schemaPath: args.at(-1), runtimeEnv: {} });
        return { ...result, code: 0, timedOut: false, actualSettled: true };
      } };
      return request.startsWith("./") && replaced.has(request.slice(2)) ? load(request.slice(2)) : nativeRequire(request);
    };
    const localRequire = request => {
      const resolved = nativeRequire.resolve(request);
      if(["./task16-current259-owned-resource.cjs","./task16-runtime-inputs.cjs","./task16-bounded-command.cjs"].includes(request)) {
        if(!moduleCache[resolved]) moduleCache[resolved] = { exports:uncachedRequire(request) };
        return moduleCache[resolved].exports;
      }
      return uncachedRequire(request);
    };
    localRequire.resolve = nativeRequire.resolve; localRequire.cache = moduleCache;
    const source = awaitRead(file);
    vm.runInThisContext("(function(require,module,exports,__dirname,__filename){\n" + source + "\n})", { filename: file })(localRequire, module, module.exports, __dirname, file);
    return module.exports;
  }
  function awaitRead(file) { return require("node:fs").readFileSync(file, "utf8"); }
  const api = load("local-staged-current259-profile.cjs");
  return { ...model, api, handle, receipt, close: () => { closed = true; },
    installGetter: field => {
      const map={core:["./local-staged-migrations.cjs","createLocalMigrationFixture"],owned:["./task16-current259-owned-resource.cjs","claimCurrent259TechnicalResource"],input:["./task16-runtime-inputs.cjs","readQualifiedTask16File"],command:["./task16-bounded-command.cjs","runTask16BoundedCommand"]};
      const [file,key]=map[field],owner=moduleCache[nativeRequire.resolve(file)].exports,value=owner[key];let reads=0;
      Object.defineProperty(owner,key,{get(){reads++;return value;},enumerable:true,configurable:true});return ()=>reads;
    }, driftCli: () => { cliHash = "0".repeat(64); }, tamperCommand: () => { moduleCache[nativeRequire.resolve("./task16-bounded-command.cjs")].exports = {}; }, physicalFailure: value => { observation=value; }, pauseNextSql: () => { pauseSql=true; return new Promise(resolve=>{notifySql=resolve;}); }, releaseSql: () => pendingReject?.(Error("synthetic test release")), failClose:()=>{closeFails=true;}, counts: () => ({ checks, commands, closes, observations }) };
}

test("owned current259 technical recipe reuses all four atomic windows and independent readbacks", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-"));
  const model = await current259Model(temporaryRoot);
  const run = model.api.createCurrent259TechnicalMigration(model.handle);
  const result = await run.migrate();
  assert.equal(result.status, "CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION");
  assert.equal(result.executionAllowed, false); assert.equal(result.nativeAdmission, false);
  assert.match(result.application.name, /^jg_fixture_app_[a-f0-9]{24}$/u);
  assert.deepEqual(model.deploymentRequests.map(row => row.count), [203,205,213,215,218,221,259]);
  for (const stage of [213,215,218,221]) assert.deepEqual(model.calls.filter(value => value.startsWith("tail" + stage)),
    ["tail" + stage + "-before", "tail" + stage + "-supply", "tail" + stage + "-readback"]);
  assert.ok(model.counts().checks >= 544,"all former per-stage source checks remain"); assert.equal(model.counts().commands, 7);
  await assert.rejects(run.migrate());
});


for (const stage of [213,215,218,221]) {
  test("owned current259 stops after unproved " + stage + " commit without later deployment", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-negative-"));
    const model = await current259Model(root, (phase,row) => {
      if (phase === "tail" + stage + "-readback") row.commitStatus = "in progress";
      return row;
    });
    const run = model.api.createCurrent259TechnicalMigration(model.handle);
    await assert.rejects(run.migrate(), /LOCAL_MIGRATION_TAIL[0-9]+_/u);
    assert.equal(model.deploymentRequests.at(-1).count, stage);
    assert.equal(model.calls.at(-1), "tail" + stage + "-readback");
    await assert.rejects(run.migrate());
    assert.throws(() => model.api.createCurrent259TechnicalMigration(model.handle));
  });
}

test("owned current259 rejects258 suffix and changed owner before Prisma deployment", async () => {
  for (const mutation of ["prefix258","wrongOwner"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-fresh-"));
    const rows = await canonicalRows();
    const model = await current259Model(root, (phase,row) => {
      if (phase === "preflight") {
        if (mutation === "prefix258") row.ledger = rows.slice(0,258).map(value => ({...value,finished:true,rolledBack:false}));
        else row.actor = "jiangkong";
      }
      return row;
    });
    await assert.rejects(model.api.createCurrent259TechnicalMigration(model.handle).migrate(), /LOCAL_MIGRATION_(CURRENT259_FRESH_FULL_ONLY|DATABASE_IDENTITY)/u);
    assert.equal(model.counts().commands, 0);
  }
});

test("owned current259 rechecks resource identity after awaited SQL and permanently stops", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-drift-"));
  let model;
  model = await current259Model(root, (phase,row) => {
    if (phase === "preflight") model.receipt.networkId = "d".repeat(64);
    return row;
  });
  const run = model.api.createCurrent259TechnicalMigration(model.handle);
  await assert.rejects(run.migrate(), /LOCAL_MIGRATION_SQL_PREFLIGHT/u);
  model.receipt.networkId = "b".repeat(64);
  await assert.rejects(run.migrate());
  assert.equal(model.counts().commands,0);
});


test("owned current259 rejects changed fixed CLI before deployment and rejects aborted scope", async () => {
  for (const choice of ["cli","abort"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-tools-"));
    const model = await current259Model(root), signal = new AbortController();
    const run = model.api.createCurrent259TechnicalMigration(model.handle,signal.signal);
    if(choice === "cli") model.driftCli(); else signal.abort();
    await assert.rejects(run.migrate(), /CURRENT259_TECHNICAL_PROFILE/u);
    assert.equal(model.counts().commands,0);
    await assert.rejects(run.migrate());
  }
});

test("owned current259 caught reentrant call revokes the first operation before deployment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-reentrant-"));
  let run;
  const model = await current259Model(root,(phase,row) => {
    if(phase === "preflight") void run.migrate().catch(() => {});
    return row;
  });
  run = model.api.createCurrent259TechnicalMigration(model.handle);
  await assert.rejects(run.migrate(), /LOCAL_MIGRATION_SQL_PREFLIGHT/u);
  assert.equal(model.counts().commands,0);
});


test("owned current259 rejects original transport replacement and copied technical tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "current259-model-transport-"));
  const model = await current259Model(root);
  assert.throws(() => model.api.resolveTechnicalProfile({kind:"CURRENT259_OWNED_TECHNICAL_V1"}));
  const run = model.api.createCurrent259TechnicalMigration(model.handle);
  model.tamperCommand();
  await assert.rejects(run.migrate(), /CURRENT259_TECHNICAL_PROFILE/u);
  assert.equal(model.counts().commands,0);
  assert.deepEqual(model.calls,[]);
});


for(const physical of ["fail","wrong-id","stopped","wrong-live-db","wrong-client","wrong-server","cidr-result"]) test("owned current259 physical inspection " + physical + " rejects before SQL and deployment",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"current259-inspect-")),model=await current259Model(root);
 const run=model.api.createCurrent259TechnicalMigration(model.handle);model.physicalFailure(physical);
 await assert.rejects(run.migrate());assert.equal(model.counts().commands,0);assert.deepEqual(model.calls,[]);
 await assert.rejects(run.migrate());
});

test("owned current259 independent cancellation immediately closes a pending SQL transport",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"current259-sql-abort-")),model=await current259Model(root),signal=new AbortController();
 const run=model.api.createCurrent259TechnicalMigration(model.handle,signal.signal),started=model.pauseNextSql();
 const work=run.migrate();
 try {await started;signal.abort();assert.equal(model.counts().closes,1);}
 finally {model.releaseSql();await assert.rejects(work);}
 assert.equal(model.counts().commands,0);assert.throws(()=>model.api.createCurrent259TechnicalMigration(model.handle));
});


for(const field of ["core","owned","input","command"]) test("owned current259 refuses fixed " + field + " accessor without evaluating it",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"current259-descriptor-")),model=await current259Model(root);
 const run=model.api.createCurrent259TechnicalMigration(model.handle),reads=model.installGetter(field);
 await assert.rejects(run.migrate(),/CURRENT259_TECHNICAL_PROFILE/u);
 assert.equal(reads(),0);assert.equal(model.counts().commands,0);assert.deepEqual(model.calls,[]);
});

test("owned current259 retains primary semantic failure when owned cleanup is UNKNOWN",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"current259-cleanup-")),model=await current259Model(root,(phase,row)=>{
  if(phase === "preflight")row.actor="jiangkong";return row;
 });
 model.failClose();
 await assert.rejects(model.api.createCurrent259TechnicalMigration(model.handle).migrate(),error=>{
  assert.equal(error.resourceCleanup?.status,"UNKNOWN");assert.match(error.cause?.message??"",/LOCAL_MIGRATION_DATABASE_IDENTITY/u);return true;
 });
 assert.equal(model.counts().closes,1);assert.equal(model.counts().commands,0);
});


test("owned current259 technical migration rejects genuine900s owner-only handle despite forged purpose",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"current259-requires-technical-"));
 const model=await current259Model(root,undefined,false);
 assert.throws(()=>model.api.createCurrent259TechnicalMigration(model.handle),/CURRENT259_TECHNICAL_RESOURCE_REQUIRED/);
 assert.equal(model.counts().checks,0);assert.equal(model.counts().commands,0);assert.equal(model.counts().observations,0);
 assert.deepEqual(model.calls,[]);
});


test("owned current259 complete supply claim binds the original result and handle once without execution ports",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'current259-supply-claim-'));
 const model=await current259Model(root);
 const result=await model.api.createCurrent259TechnicalMigration(model.handle).migrate();
 const supplied=model.api.claimCurrent259TechnicalSupply(result,model.handle);
 assert.equal(supplied.completion,result);assert.equal(supplied.source.candidateSha,'c'.repeat(40));
 assert.equal(supplied.completion.application.oid,result.application.oid);
 assert.deepEqual(Object.keys(supplied).sort(),['check','completion','source']);
 assert.ok(Object.isFrozen(supplied)&&Object.isFrozen(supplied.source)&&Object.isFrozen(supplied.source.profile));
 supplied.check();
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(result,model.handle),/CURRENT259_TECHNICAL_PROFILE/);
});


test("owned current259 supply rejects copies, wrong handles and claims before the completed operation",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'current259-supply-order-')),model=await current259Model(root);
 const run=model.api.createCurrent259TechnicalMigration(model.handle),pending=run.migrate();
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(pending,model.handle),/CURRENT259_TECHNICAL_PROFILE/);
 const result=await pending;
 for(const copy of [{...result},JSON.parse(JSON.stringify(result)),Object.freeze({status:result.status,nativeAdmission:false})])
  assert.throws(()=>model.api.claimCurrent259TechnicalSupply(copy,model.handle),/CURRENT259_TECHNICAL_PROFILE/);
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(result,{}),/CURRENT259_TECHNICAL_PROFILE/);
 const supplied=model.api.claimCurrent259TechnicalSupply(result,model.handle);supplied.check();
 assert.deepEqual(supplied.completion.databaseIdentity,{database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'16384',namespaceOid:'2200',ownerOid:'10',actorOid:'10',actor:'jg_task01_owner',sessionActor:'jg_task01_owner',systemIdentifier:'1234567890123456789',tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432});
});

test("owned current259 claimed supply immediately revokes on its independent signal after migration",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'current259-supply-abort-')),model=await current259Model(root),controller=new AbortController();
 const result=await model.api.createCurrent259TechnicalMigration(model.handle,controller.signal).migrate();
 const supplied=model.api.claimCurrent259TechnicalSupply(result,model.handle);
 controller.abort();assert.equal(model.counts().closes,1);
 assert.throws(()=>supplied.check(),/CURRENT259_TECHNICAL_PROFILE/);
});


for(const ended of ['scope ended','signal aborted'])test(`owned current259 unclaimed supply denies after ${ended}`,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'current259-supply-ended-')),model=await current259Model(root),controller=new AbortController();
 const result=await model.api.createCurrent259TechnicalMigration(model.handle,controller.signal).migrate();
 if(ended==='scope ended')model.close();else {controller.abort();assert.equal(model.counts().closes,1);}
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(result,model.handle),/CURRENT259_TECHNICAL_PROFILE|synthetic resource closed/);
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(result,model.handle),/CURRENT259_TECHNICAL_PROFILE/);
});

test("owned current259 partial final readback cannot issue technical supply",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'current259-supply-partial-'));
 const model=await current259Model(root,(phase,row)=>{if(phase==='complete-readback')row.ledger.pop();return row;});
 const partial=model.api.createCurrent259TechnicalMigration(model.handle).migrate();
 await assert.rejects(partial,/LOCAL_MIGRATION_COMPLETION/);assert.equal(model.deploymentRequests.at(-1).count,259);
 assert.throws(()=>model.api.claimCurrent259TechnicalSupply(partial,model.handle),/CURRENT259_TECHNICAL_PROFILE/);
 assert.equal(model.counts().closes,1);
});


test("tail column privileges resolve the PG16 attnum overload through every qualification window", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-tail-column-signature-"));
  let observations = 0;
  try {
    const fake = await fakeFixture(dir, (phase, row, sql) => {
      if (!phase.startsWith("tail")) return row;
      // PG16.1 pg_proc OID3019 takes oid,oid,int2,text. Its int4->int2
      // pg_cast entry is assignment-only, so a bare integer arm cannot bind.
      const expression = /CASE WHEN kind='column' THEN a\.attnum ELSE (0(?:::(?:smallint|integer|int2|int4))?) END AS attnum/u.exec(sql);
      assert.ok(expression, "the synthetic PG16 boundary needs the projected column number");
      const fallbackType = expression[1].includes("::") ? expression[1].split("::")[1] : "integer";
      const columnType = ["smallint", "int2"].includes(fallbackType) ? "int2" : "int4";
      if (columnType !== "int2") {
        throw Object.assign(new Error("function has_column_privilege(oid, oid, integer, text) does not exist"), { code: "42883" });
      }
      observations++;
      return row;
    });
    await fake.fixture.migrate({ databaseUrl });
    assert.equal(observations, 12);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test("tail before proof reports a fixed routine category without exposing observed metadata", async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(), 'local-tail-proof-reason-'));
 try {
  const fake=await fakeFixture(dir,(phase,row)=>{if(phase==='tail213-before')row.routines[0].securityDefiner=!row.routines[0].securityDefiner;return row;});
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   assert.deepEqual(require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error),
    {stage:'TAIL213_BEFORE',kind:'NODE_PROOF',reason:'BEFORE_VALIDATE_ROUTINE_01_ATTRIBUTES'});
   return true;
  });
  assert.equal(fake.calls.includes('tail213-supply'),false);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});


for(const [label,change,reason] of [
 ['owner',row=>{row.routines[0].ownerOid='999';},'ROUTINE_01_OWNER'],
 ['configuration',row=>{row.routines[0].config=['search_path=untrusted'];},'ROUTINE_01_CONFIG'],
 ['arguments',row=>{row.routines[0].inputTypes=['25'];},'ROUTINE_01_ARGUMENTS'],
 ['body',row=>{row.routines[0].bodySha256='e'.repeat(64);},'ROUTINE_01_BODY'],
 ['trigger binding',row=>{row.triggers[0].routineOid='999';},'TRIGGER_01_BINDING'],
 ['trigger attributes',row=>{row.triggers[0].enabled='D';},'TRIGGER_01_ATTRIBUTES'],
 ['trigger condition',row=>{row.triggers[0].condition=!row.triggers[0].condition;},'TRIGGER_01_CONDITION'],
 ['ledger',row=>{row.ledger[0].sha256='e'.repeat(64);},'LEDGER'],
 ['pending binding',row=>{row.pending.appOid='999';},'PENDING'],
 ['binding rows',row=>{row.bindings[0].rows.push({sha256:'e'.repeat(64),xmin:'1'});},'BINDINGS'],
 ['app table ACL',row=>{row.appTablePrivileges.push({secret:'not-logged'});},'APP_TABLE_ACL']
])test(`tail first proof identifies fixed ${label} category and permanently stops`,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail-proof-category-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{if(phase==='tail213-before')change(row);return row;});
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   const diagnostic=require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error);
   assert.deepEqual(diagnostic,{stage:'TAIL213_BEFORE',kind:'NODE_PROOF',reason:'BEFORE_VALIDATE_'+reason});
   assert.equal(JSON.stringify(diagnostic).includes('not-logged'),false);
   return true;
  });
  assert.equal(fake.calls.includes('tail213-supply'),false);
  const count=fake.calls.length;
  await assert.rejects(fake.fixture.migrate({databaseUrl}),/LOCAL_MIGRATION_STOPPED/u);
  assert.equal(fake.calls.length,count);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('tail invalid resource JSON is distinguished from validation and caller reason cannot override it',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail-proof-json-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>phase==='tail213-before'?undefined:row);
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   assert.deepEqual(require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error),
    {stage:'TAIL213_BEFORE',kind:'NODE_PROOF',reason:'READ_RESULT'});return true;
  });
  assert.equal(fake.calls.includes('tail213-supply'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('tail caller exception cannot supply a proof reason',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail-proof-spoof-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{
   if(phase==='tail213-before'){const error=new Error('private-untrusted');error.reason='BEFORE_VALIDATE_OWNER';throw error;}return row;
  });
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   assert.deepEqual(require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error),
    {stage:'TAIL213_BEFORE',kind:'RESOURCE_PORT',reason:'READ_RESULT'});return true;
  });
  assert.equal(fake.calls.includes('tail213-supply'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('post213 public qualification requests the original fixed SQL column tuples without crossing relation boundaries',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail-source-targets-'));
 try{
  const sql=await fs.readFile(path.join(__dirname,'local-staged-tail-post213.sql'),'utf8');
  const start=sql.indexOf('-- Only columns actually selected');
  const end=sql.indexOf(') expected(table_name,cols,recipients) LOOP',start);
  assert.ok(start>=0&&end>start);
  // Each ARRAY terminates before its own recipient expression. Neither later
  // relation names nor recipient arrays are column names in this source recipe.
  const tuples=[...sql.slice(start,end).matchAll(/\('([A-Za-z0-9_]+)',ARRAY\[([^\]]*)\],\s*(file_readers|ARRAY\[snapshot\.application_oid\])\)/gu)];
  assert.equal(tuples.length,16);
  const expected=tuples.flatMap(([,table,columns,recipients])=>[...columns.matchAll(/'([^']+)'/gu)]
   .map(([,member])=>({kind:'column',table,member,privilege:'SELECT',recipients:recipients==='file_readers'?'file':'app'})));
  let observed;
  const fake=await fakeFixture(dir,(phase,row,request)=>{
   if(phase==='tail213-before')observed=require('./testdata/local-staged-tail-model.cjs').config(request).targets.filter(t=>t.kind==='column');
   return row;
  });
  await fake.fixture.migrate({databaseUrl});
  assert.deepEqual(observed,expected);
  assert.equal(fake.calls.includes(`deploy-${canonicalBaseline.expectedDirectoryCount}`),true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('post213 still refuses a missing physical target column before any supply',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'local-tail-missing-column-'));
 try{
  const fake=await fakeFixture(dir,(phase,row)=>{
   if(phase==='tail213-before'){
    const target=row.targets.find(t=>t.kind==='column'&&t.object==='Contract'&&t.member==='projectId');
    assert.ok(target);
    // PG16's pg_attribute LEFT JOIN has no row for a missing column; the
    // projected attribute number, type and catalog tuple are SQL NULL.
    target.attnum=null;target.typeOid=null;target.catalogXmin=null;target.effective=null;
   }
   return row;
  });
  await assert.rejects(fake.fixture.migrate({databaseUrl}),error=>{
   assert.deepEqual(require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error),
    {stage:'TAIL213_BEFORE',kind:'NODE_PROOF',reason:'BEFORE_VALIDATE_TARGETS'});
   return true;
  });
  assert.equal(fake.calls.includes('tail213-supply'),false);
  assert.equal(fake.calls.includes('deploy-215'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
