"use strict";

const { createHash, randomUUID, randomBytes } = require("node:crypto");
const { cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { types, isDeepStrictEqual } = require("node:util");
const controls = require("./local-staged-migration-controls.cjs");

const canonicalRoot = path.join(__dirname, "migrations");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const need = (ok, code) => { if (!ok) throw new Error("LOCAL_MIGRATION_" + code); };
const oid = value => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) &&
  Number(value) <= 0xffffffff;

function snapshot(value) {
  need(value && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => Object.hasOwn(field, "value")),
  "INPUT");
  return Object.freeze({ ...value });
}

async function inventory(prismaRoot) {
  const entries = await readdir(path.join(prismaRoot, "migrations"), { withFileTypes: true });
  const rows = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (entry.name === "migration_lock.toml") {
      need(entry.isFile(), "SOURCE");
      continue;
    }
    need(entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name), "SOURCE");
    const dir = path.join(prismaRoot, "migrations", entry.name);
    const files = await readdir(dir, { withFileTypes: true });
    need(files.length === 1 && files[0].name === "migration.sql" && files[0].isFile(), "SOURCE");
    rows.push({ name: entry.name, sha256: sha(await readFile(path.join(dir, "migration.sql"))) });
  }
  return rows;
}

function checkLedger(rows, expected, rolledBack) {
  need(Array.isArray(rows), "LEDGER");
  const completed = [];
  for (const row of rows) {
    need(row && typeof row.name === "string" && typeof row.sha256 === "string", "LEDGER");
    if (row.finished === true && row.rolledBack === false) {
      completed.push({ name: row.name, sha256: row.sha256 });
    } else {
      need(row.finished === false && row.rolledBack === true &&
        rolledBack.includes(row.name) &&
        expected.some(item => item.name === row.name && item.sha256 === row.sha256), "LEDGER");
    }
  }
  need(isDeepStrictEqual(completed, expected.slice(0, completed.length)), "LEDGER");
  return completed.length;
}

function identity(row, database) {
  need(row && row.database === database && oid(row.databaseOid) && oid(row.namespaceOid) &&
    oid(row.actorOid) && row.ownerOid === row.actorOid && row.actor === "jiangkong" &&
    row.sessionActor === row.actor && row.version >= 160000 && row.version < 170000 &&
    row.encoding === "UTF8" && row.replication === "origin" &&
    typeof row.systemIdentifier === "string" && /^[1-9][0-9]{0,19}$/u.test(row.systemIdentifier) &&
    BigInt(row.systemIdentifier) <= 0xffffffffffffffffn, "DATABASE_IDENTITY");
  return {
    database: row.database, databaseOid: row.databaseOid, namespaceOid: row.namespaceOid,
    actorOid: row.actorOid, ownerOid: row.ownerOid, systemIdentifier: row.systemIdentifier
  };
}

function createLocalMigrationFixture(input) {
  const options = snapshot(input);
  const container = snapshot(options.container);
  need([container.id, container.name, container.runId].every(value => typeof value === "string") &&
    /^[a-f0-9]{64}$/u.test(container.id) &&
    /^jiangkong-[a-z0-9-]+$/u.test(container.name) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(container.runId), "INPUT");
  for (const key of ["inspectContainer", "executeSql", "deploy"]) {
    need(typeof options[key] === "function" && !types.isProxy(options[key]), "INPUT");
  }
  const { inspectContainer, executeSql, deploy } = options;
  need(Array.isArray(options.databaseNames) && !types.isProxy(options.databaseNames) &&
    Object.values(Object.getOwnPropertyDescriptors(options.databaseNames))
      .every(field => Object.hasOwn(field, "value")), "INPUT");
  const databaseNames = Object.freeze([...options.databaseNames]);
  need(databaseNames.length > 0 && new Set(databaseNames).size === databaseNames.length &&
    databaseNames.every(name => typeof name === "string" && /^jiangkong_[a-z0-9_]+$/u.test(name)), "INPUT");
  const states = new Map();
  let busy = false;
  let stopped = false;
  let clusterRoles;
  let publishedPort;
  const applicationNames = new Set();
  const recoverableFailures = new WeakSet();
  const pendingRecovery = new Map();

  async function assertContainer() {
    need(!stopped, "STOPPED");
    const observed = snapshot(await inspectContainer(container.id));
    need(observed.id === container.id && observed.name === container.name &&
      observed.runId === container.runId && observed.running === true, "CONTAINER_IDENTITY");
    need(observed.publishedHost === "127.0.0.1" && typeof observed.publishedPort === "string" &&
      /^[1-9][0-9]{0,4}$/u.test(observed.publishedPort) && Number(observed.publishedPort) <= 65535,
    "CONTAINER_PORT");
    if (publishedPort) need(observed.publishedPort === publishedPort, "CONTAINER_PORT");
    publishedPort = observed.publishedPort;
  }

  async function read(database, phase, sql) {
    await assertContainer();
    let result;
    try { result = snapshot(await executeSql({ database, phase, sql })); }
    catch { throw new Error("LOCAL_MIGRATION_SQL_" + phase.toUpperCase().replaceAll("-", "_")); }
    await assertContainer();
    need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= 512 * 1024, "READBACK");
    let row;
    try { row = JSON.parse(result.stdout.trim()); } catch { need(false, "READBACK"); }
    return row;
  }

  function checkRoles(row, allowedNewNames = []) {
    need(Array.isArray(row.roles) && row.roles.every(role => oid(role.oid) &&
      /^[a-z_][a-z0-9_]{0,62}$/u.test(role.name)), "ROLE_PROVENANCE");
    if (!clusterRoles) {
      need(row.roles.every(role => role.oid === "10" && role.name === "jiangkong" ||
        Number(role.oid) < 16384 && role.name.startsWith("pg_")), "ROLE_PROVENANCE");
    } else {
      need(clusterRoles.every(role => row.roles.some(current => isDeepStrictEqual(current, role))),
        "ROLE_PROVENANCE");
      for (const role of row.roles.filter(current => !clusterRoles.some(prior => prior.oid === current.oid))) {
        need((allowedNewNames.includes(role.name) || applicationNames.has(role.name)) &&
          role.superuser === false && role.createRole === false && role.createDb === false &&
          role.replication === false && role.bypassRls === false, "ROLE_PROVENANCE");
      }
    }
    clusterRoles = structuredClone(row.roles);
  }

  async function migrate(requestInput) {
    need(!busy && !stopped, "STOPPED");
    busy = true;
    try {
      await assertContainer();
      const sourceRequest = snapshot(requestInput);
      const request = snapshot({ ...sourceRequest, runtimeEnv: snapshot(sourceRequest.runtimeEnv ?? {}) });
      need(typeof request.databaseUrl === "string" &&
        (request.schemaPath === undefined || typeof request.schemaPath === "string") &&
        Object.values(request.runtimeEnv).every(value => typeof value === "string"), "INPUT");
      const parsed = new URL(request.databaseUrl);
      need(parsed.protocol === "postgresql:" && parsed.hostname === "127.0.0.1" &&
        parsed.username === "jiangkong" && parsed.port === publishedPort &&
        [...parsed.searchParams.keys()].every(key => key === "application_name") &&
        parsed.searchParams.getAll("application_name").length <= 1 &&
        (!parsed.searchParams.has("application_name") ||
          /^[a-zA-Z0-9_-]{1,63}$/u.test(parsed.searchParams.get("application_name"))) &&
        !parsed.hash, "TARGET");
      const database = decodeURIComponent(parsed.pathname.slice(1));
      need(databaseNames.includes(database), "TARGET");
      const targetRoot = request.schemaPath ? path.dirname(request.schemaPath) : __dirname;
      const schemaPath = request.schemaPath ?? path.join(__dirname, "schema.prisma");
      need(path.basename(schemaPath) === "schema.prisma" && (await lstat(schemaPath)).isFile(), "SCHEMA");
      const schema = await readFile(schemaPath);
      need(schema.equals(await readFile(path.join(__dirname, "schema.prisma"))), "SCHEMA");
      const expected = await inventory(__dirname);
      const target = await inventory(targetRoot);
      need(expected.length >= 205 && isDeepStrictEqual(target, expected.slice(0, target.length)) &&
        target.length > 0, "SOURCE_PREFIX");
      const lock = await readFile(path.join(canonicalRoot, "migration_lock.toml"));
      need((await readFile(path.join(targetRoot, "migrations/migration_lock.toml"))).equals(lock), "SOURCE");
      if (target.length <= 203) return await deploy(request);
      const declaredRoles = [];
      for (const row of target) {
        const sql = await readFile(path.join(canonicalRoot, row.name, "migration.sql"), "utf8");
        for (const match of sql.matchAll(/\bCREATE\s+ROLE\s+"?([a-z][a-z0-9_]*)"?/gu)) declaredRoles.push(match[1]);
      }
      need(expected[203].sha256 === "296c6e2f502bc782bd83ab59190505e27b80623d1da1a3b6dddb72c414eb686f" &&
        expected[204].sha256 === "2ca118b29e8e75745a1ac7d6f8de3fbfa70fa5774b3d95c48c6119caff8b316a",
      "SOURCE_204_205");
      const rolledBack = ["20260802010000_project_financing_quota_request_idempotency"];
      const before = await read(database, "preflight", controls.inspectSql());
      const bound = identity(before, database);
      const prior = states.get(database);
      if (prior) need(isDeepStrictEqual(prior.identity, bound), "DATABASE_IDENTITY");
      else states.set(database, { identity: bound });
      checkRoles(before);
      const count = checkLedger(before.ledger, target, rolledBack);
      const recovery = pendingRecovery.get(database);
      if (recovery) {
        need(count === 114 && before.ledger.filter(row => row.name === expected[114].name &&
          row.sha256 === expected[114].sha256 && row.finished === false && row.rolledBack === true)
          .length === recovery.rolledBackCount + 1, "RECOVERY_NOT_RESOLVED");
        pendingRecovery.delete(database);
      }
      if (count >= 205) return await deploy(request);
      need(count <= 203, "PARTIAL_QUALIFICATION");

      const phaseRoot = await mkdtemp(path.join(options.temporaryRoot, "staged-migrations-"));
      const roots = new Map();
      for (const size of [203, 205]) {
        const dir = path.join(phaseRoot, String(size));
        await mkdir(path.join(dir, "migrations"), { recursive: true });
        await writeFile(path.join(dir, "schema.prisma"), schema);
        await writeFile(path.join(dir, "migrations/migration_lock.toml"), lock);
        for (const row of expected.slice(0, size)) {
          await cp(path.join(canonicalRoot, row.name), path.join(dir, "migrations", row.name), { recursive: true });
        }
        need(isDeepStrictEqual(await inventory(dir), expected.slice(0, size)), "SOURCE");
        roots.set(size, dir);
      }
      const phaseOutput = [];
      try {
        const initial = await deploy({ ...request, schemaPath: path.join(roots.get(203), "schema.prisma") });
        phaseOutput.push(initial.stdout ?? "");
      } catch (error) {
        const expectedFailure = request.expectedFailure;
        if (count === 114 && error instanceof Error && ["project_financing_quota_duplicate_attachment",
          "project_financing_quota_cross_business_attachment"].includes(expectedFailure) &&
          error.message.includes(expectedFailure)) {
          recoverableFailures.add(error);
          pendingRecovery.set(database, { rolledBackCount: before.ledger.filter(row =>
            row.name === expected[114].name && row.rolledBack === true).length });
        }
        throw error;
      }
      const stage203 = await read(database, "stage203-readback", controls.inspectSql());
      need(isDeepStrictEqual(identity(stage203, database), bound) &&
        checkLedger(stage203.ledger, target, rolledBack) === 203, "STAGE203");
      checkRoles(stage203, declaredRoles);

      const plan = {
        ...bound, runId: randomUUID(), nonce: randomBytes(32).toString("hex"),
        appName: "jg_fixture_app_" + randomBytes(12).toString("hex"),
        schemaName: "jg_fixture_" + randomBytes(12).toString("hex"),
        migrations: expected.slice(0, 205)
      };
      const setup = await read(database, "qualification-setup", controls.setupSql(plan));
      controls.checkSetup(setup, plan);
      applicationNames.add(plan.appName);
      const qualified = new URL(request.databaseUrl);
      qualified.searchParams.set("options", "-c app.contract_archive_v2_application_role_oid=" + setup.appOid +
        " -c app.contract_archive_v2_file_caller_oids=" + JSON.stringify(setup.fileCallerOids) +
        " -c app.local_migration_nonce=" + plan.nonce);
      const middle = await deploy({ ...request, databaseUrl: qualified.toString(), schemaPath: path.join(roots.get(205), "schema.prisma") });
      phaseOutput.push(middle.stdout ?? "");
      const complete = await read(database, "stage205-readback", controls.readbackSql(plan, setup));
      need(isDeepStrictEqual(identity(complete, database), bound) &&
        checkLedger(complete.ledger, target, rolledBack) === 205, "STAGE205");
      controls.checkCompletion(complete, plan, setup);
      await read(database, "qualification-cleanup", controls.cleanupSql(plan, setup));
      const clean = await read(database, "cleanup-readback", controls.cleanReadSql(plan, setup));
      need(clean.schemaAbsent === true && clean.eventAbsent === true && clean.appOid === setup.appOid &&
        clean.applicationQualified === true, "CLEANUP");
      const after = await read(database, "post-qualification", controls.inspectSql());
      need(isDeepStrictEqual(identity(after, database), bound), "DATABASE_IDENTITY");
      checkRoles(after, declaredRoles);
      const result = await deploy(request);
      const final = await read(database, "complete-readback", controls.inspectSql());
      need(isDeepStrictEqual(identity(final, database), bound) &&
        checkLedger(final.ledger, target, rolledBack) === target.length, "COMPLETION");
      checkRoles(final, declaredRoles);
      return { ...result, stdout: [...phaseOutput, result.stdout ?? ""].join("\n") };
    } finally {
      busy = false;
    }
  }

  return {
    async migrate(request) {
      try { return await migrate(request); }
      catch (error) {
        // Original expected pre115 failure remains recoverable only by the runner's
        // explicit rollback/remediation path. Unknown outcomes stop this fixture.
        if (!recoverableFailures.has(error)) stopped = true;
        throw error;
      }
    }
  };
}

module.exports = { createLocalMigrationFixture };
