"use strict";
// Synthetic SQL/deploy ports mirror the existing staged fixture model; no resource tools.
const assert = require("node:assert/strict");
const test = require("node:test");
const { createLocalMigrationFixture } = require("./local-staged-migrations.cjs");
const { frameStage205 } = require("./testdata/local-stage205-readback-model.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const database = "jiangkong_project_financing_quota_concurrency";
const databaseUrl = "postgresql://jiangkong:local@127.0.0.1:55432/" + database +
  "?application_name=jg-pfq-first-01234567-89ab-cdef-0123-456789abcdef";
const legacyNames = ["jg_payment_execution_payer_issuer", "jg_pol275_owner", "jg_pol275_runtime",
  "jg_pol279_runtime", "jg_pol280_runtime"];
const inert = (name, oid) => ({ oid: String(oid), name, superuser: false, createRole: false,
  createDb: false, replication: false, bypassRls: false, memberships: [] });


async function canonicalRows() {
  const dir = path.join(__dirname, "migrations");
  const names = (await fs.readdir(dir, { withFileTypes: true }))
    .filter(row => row.isDirectory()).map(row => row.name).sort();
  return Promise.all(names.map(async name => ({ name, sha256: crypto.createHash("sha256")
    .update(await fs.readFile(path.join(dir, name, "migration.sql"))).digest("hex") })));
}

async function fakeFixture(temporaryRoot, mutate, failDatabases = [], masked = false, named = false, factory = createLocalMigrationFixture) {
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
      return { stdout: phase === "stage205-readback" ? frameStage205(result) : JSON.stringify(result), stderr: "" };
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
      deploymentRequests.push({ database: currentDatabase, count: files.length, url: request.databaseUrl, schemaPath: request.schemaPath });
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
  const fixture = named ? null : factory(ports);
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

test("one fixture reuses immutable source prefixes across independent databases", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-cache-"));
  try {
    const harness = await fakeFixture(temporaryRoot);
    await harness.fixture.migrate({ databaseUrl });
    const first = harness.deploymentRequests.filter(row => row.count < 259);
    const identities = await Promise.all(first.map(row => fs.lstat(row.schemaPath)));
    const secondUrl = databaseUrl.replace(database, harness.databaseNames[1]);
    await harness.fixture.migrate({ databaseUrl: secondUrl });
    const second = harness.deploymentRequests.filter(row => row.database === harness.databaseNames[1] && row.count < 259);
    assert.deepEqual(second.map(row => row.count), [203, 205, 213, 215, 218, 221]);
    assert.deepEqual(second.map(row => row.schemaPath), first.map(row => row.schemaPath));
    for (let index = 0; index < second.length; index++) {
      const actual = await fs.lstat(second[index].schemaPath);
      assert.equal(actual.ino, identities[index].ino);
      assert.equal(actual.ctimeMs, identities[index].ctimeMs);
    }
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

const changes = {
  schema: async (root) => fs.appendFile(path.join(root, "schema.prisma"), "\n// drift\n"),
  lock: async (root) => fs.appendFile(path.join(root, "migrations/migration_lock.toml"), "\n# drift\n"),
  sql: async (root, name) => fs.appendFile(path.join(root, "migrations", name, "migration.sql"), "\n-- drift\n"),
  missing: async (root, name) => fs.unlink(path.join(root, "migrations", name, "migration.sql")),
  extra: async (root, name) => fs.writeFile(path.join(root, "migrations", name, "extra.sql"), "-- drift"),
  rootExtra: async (root) => fs.writeFile(path.join(root, "extra"), "drift"),
  replacedDirectory: async (root, name, temporaryRoot) => {
    const dir = path.join(root, "migrations", name);
    const backup = path.join(temporaryRoot, "original-directory");
    await fs.rename(dir, backup);
    await fs.cp(backup, dir, { recursive: true });
  },
  replacedFile: async (root, name, temporaryRoot) => {
    const file = path.join(root, "migrations", name, "migration.sql");
    const backup = path.join(temporaryRoot, "original-file");
    await fs.rename(file, backup);
    await fs.copyFile(backup, file);
  },
  symlink: async (root, name, temporaryRoot) => {
    const file = path.join(root, "migrations", name, "migration.sql");
    const backup = path.join(temporaryRoot, "original-file");
    await fs.rename(file, backup);
    await fs.symlink(backup, file);
  },
  replacedRoot: async (root, name, temporaryRoot) => {
    const backup = path.join(temporaryRoot, "original-prefix");
    await fs.rename(root, backup);
    await fs.cp(backup, root, { recursive: true });
  },
  replacedPhaseRoot: async (root, name, temporaryRoot) => {
    const parent = path.dirname(root);
    const backup = path.join(temporaryRoot, "original-phase");
    await fs.rename(parent, backup);
    await fs.cp(backup, parent, { recursive: true });
  }
};
for (const [name, change] of Object.entries(changes)) {
  test("cached " + name + " drift stops permanently before any further deployment", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-drift-"));
    try {
      const harness = await fakeFixture(temporaryRoot);
      await harness.fixture.migrate({ databaseUrl });
      const root = path.dirname(harness.deploymentRequests.find(row => row.count === 221).schemaPath);
      await change(root, (await canonicalRows())[0].name, temporaryRoot);
      const deployments = harness.deploymentRequests.length;
      await assert.rejects(harness.fixture.migrate({ databaseUrl }), /LOCAL_MIGRATION_PREFIX_CACHE/u);
      assert.equal(harness.deploymentRequests.length, deployments);
      await assert.rejects(harness.fixture.migrate({ databaseUrl }), /LOCAL_MIGRATION_STOPPED/u);
      assert.equal(harness.deploymentRequests.length, deployments);
    } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

test("unused cached prefixes are checked before the historical fast deployment path", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-fast-"));
  try {
    const harness = await fakeFixture(temporaryRoot);
    await harness.fixture.migrate({ databaseUrl });
    const schemaPath = harness.deploymentRequests.find(row => row.count === 203).schemaPath;
    const unused = path.dirname(harness.deploymentRequests.find(row => row.count === 221).schemaPath);
    await changes.sql(unused, (await canonicalRows())[0].name);
    const deployments = harness.deploymentRequests.length;
    await assert.rejects(harness.fixture.migrate({ databaseUrl, schemaPath }), /LOCAL_MIGRATION_PREFIX_CACHE/u);
    assert.equal(harness.deploymentRequests.length, deployments);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

test("separate fixtures own separate source directories", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-separated-"));
  try {
    const first = await fakeFixture(temporaryRoot);
    const second = await fakeFixture(temporaryRoot);
    await first.fixture.migrate({ databaseUrl });
    await second.fixture.migrate({ databaseUrl });
    assert.notEqual(first.deploymentRequests[0].schemaPath, second.deploymentRequests[0].schemaPath);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});

for (const kind of ["schema", "lock", "sql"]) {
  test("source " + kind + " cannot replace the closure's original source binding", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-source-"));
    try {
      const source = path.join(temporaryRoot, "source");
      await fs.mkdir(source);
      for (const name of await fs.readdir(__dirname)) {
        if (/\.(?:cjs|json|sql|prisma)$/u.test(name)) await fs.copyFile(path.join(__dirname, name), path.join(source, name));
      }
      await fs.cp(path.join(__dirname, "migrations"), path.join(source, "migrations"), { recursive: true });
      const factory = require(path.join(source, "local-staged-migrations.cjs")).createLocalMigrationFixture;
      const harness = await fakeFixture(temporaryRoot, undefined, [], false, false, factory);
      const request = { databaseUrl, schemaPath: path.join(source, "schema.prisma") };
      await harness.fixture.migrate(request);
      await changes[kind](source, (await canonicalRows())[0].name);
      const calls = harness.calls.length;
      await assert.rejects(harness.fixture.migrate(request), /LOCAL_MIGRATION_PREFIX_CACHE/u);
      assert.equal(harness.calls.length, calls, "source changes must stop before SQL or deploy");
      await assert.rejects(harness.fixture.migrate(request), /LOCAL_MIGRATION_STOPPED/u);
    } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
  });
}

for (const targetDatabase of ["same", "different"]) {
test("a preflight port cannot change a checked prefix before " + targetDatabase + " database deployment", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-prefix-await-"));
  try {
    let cachedSql;
    let tamper = false;
    const harness = await fakeFixture(temporaryRoot, (phase, row) => {
      if (tamper && phase === "preflight") require("node:fs").appendFileSync(cachedSql, "\n-- changed while awaiting preflight\n");
      return row;
    });
    await harness.fixture.migrate({ databaseUrl });
    const prefix = path.dirname(harness.deploymentRequests[0].schemaPath);
    cachedSql = path.join(prefix, "migrations", (await canonicalRows())[0].name, "migration.sql");
    tamper = true;
    const deployments = harness.deploymentRequests.length;
    await assert.rejects(harness.fixture.migrate({ databaseUrl: targetDatabase === "same" ? databaseUrl : databaseUrl.replace(database, harness.databaseNames[1]) }), /LOCAL_MIGRATION_PREFIX_CACHE/u);
    assert.equal(harness.deploymentRequests.length, deployments);
    await assert.rejects(harness.fixture.migrate({ databaseUrl }), /LOCAL_MIGRATION_STOPPED/u);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
});
}
