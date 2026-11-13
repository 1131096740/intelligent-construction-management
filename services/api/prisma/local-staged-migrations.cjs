"use strict";

const { createHash, randomUUID, randomBytes } = require("node:crypto");
const { cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { types, isDeepStrictEqual } = require("node:util");
const controls = require("./local-staged-migration-controls.cjs");
const { createLocalTailQualification } = require("./local-staged-tail-qualification.cjs");

const technicalProfiles = require("./local-staged-technical-profile-policy.cjs");

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

function identity(row, database, owner = "jiangkong") {
  need(row && row.database === database && oid(row.databaseOid) && oid(row.namespaceOid) &&
    oid(row.actorOid) && row.ownerOid === row.actorOid && row.actor === owner &&
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
  const supplied = snapshot(input);
  const technical = Object.hasOwn(supplied, "technicalProfile") ? require("./local-staged-current259-profile.cjs").resolveTechnicalProfile(supplied.technicalProfile) : null;
  if (technical) need(Object.keys(supplied).length === 2 && typeof supplied.temporaryRoot === "string", "INPUT");
  const options = technical ? snapshot({ ...supplied, ...technical.options }) : supplied;
  const owner = technical?.owner ?? "jiangkong";
  const ci = Object.hasOwn(options, "ciFixture");
  const container = snapshot(options.container);
  need([container.id, container.name, container.runId].every(value => typeof value === "string") &&
    /^[a-f0-9]{64}$/u.test(container.id) &&
    (technical ? /^jg-task01-[a-f0-9-]+$/u : /^jiangkong-[a-z0-9-]+$/u).test(container.name) &&
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
    databaseNames.every(name => typeof name === "string" && (technical ? name === technical.database :
      ci ? technicalProfiles.isCiDynamicDatabase(options.ciFixture, name) : /^jiangkong_[a-z0-9_]+$/u.test(name))), "INPUT");
  const states = new Map();
  let busy = false;
  let stopped = false;
  let clusterRoles;
  let publishedPort;
  const applicationNames = new Set();
  const recoverableFailures = new WeakSet();
  const pendingRecovery = new Map();
  // Only immutable migration files are shared across calls, never database evidence.
  let prefixSource;
  let phaseRoot;
  let phaseIdentity;
  const prefixCache = new Map();

  function fileIdentity(stat) {
    return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
  }

  function directoryIdentity(stat) {
    return [stat.dev, stat.ino, stat.mode];
  }

  async function capturePrefix(dir, rows) {
    const directories = [dir, path.join(dir, "migrations"),
      ...rows.map(row => path.join(dir, "migrations", row.name))];
    const files = [path.join(dir, "schema.prisma"), path.join(dir, "migrations/migration_lock.toml"),
      ...rows.map(row => path.join(dir, "migrations", row.name, "migration.sql"))];
    const identities = [];
    for (const name of directories) {
      const stat = await lstat(name);
      need(stat.isDirectory() && !stat.isSymbolicLink(), "PREFIX_CACHE");
      identities.push({ name, directory: true, identity: directoryIdentity(stat) });
    }
    for (const name of files) {
      const stat = await lstat(name);
      need(stat.isFile() && !stat.isSymbolicLink(), "PREFIX_CACHE");
      identities.push({ name, directory: false, identity: fileIdentity(stat) });
    }
    return { dir, identities };
  }

  async function verifyIdentities(identities) {
    for (const item of identities) {
      const stat = await lstat(item.name);
      need(!stat.isSymbolicLink() && (item.directory ? stat.isDirectory() : stat.isFile()) &&
        isDeepStrictEqual(item.directory ? directoryIdentity(stat) : fileIdentity(stat), item.identity),
      "PREFIX_CACHE");
    }
  }

  async function verifyPrefixes(source) {
    if (!phaseRoot) return;
    need(isDeepStrictEqual(source, prefixSource), "PREFIX_CACHE");
    await verifyIdentities([phaseIdentity]);
    need(isDeepStrictEqual((await readdir(phaseRoot)).sort(),
      [...prefixCache.keys()].map(String).sort()), "PREFIX_CACHE");
    for (const [size, cached] of prefixCache) {
      await verifyIdentities(cached.identities);
      need(isDeepStrictEqual((await readdir(cached.dir)).sort(), ["migrations", "schema.prisma"]), "PREFIX_CACHE");
      need((await readFile(path.join(cached.dir, "schema.prisma"))).equals(source.schema) &&
        (await readFile(path.join(cached.dir, "migrations/migration_lock.toml"))).equals(source.lock) &&
        isDeepStrictEqual(await inventory(cached.dir), source.expected.slice(0, size)), "PREFIX_CACHE");
      await verifyIdentities(cached.identities);
    }
    await verifyIdentities([phaseIdentity]);
  }

  async function prefixRoots(source, targetLength) {
    if (!phaseRoot) {
      phaseRoot = await mkdtemp(path.join(options.temporaryRoot, "staged-migrations-"));
      const stat = await lstat(phaseRoot);
      need(stat.isDirectory() && !stat.isSymbolicLink(), "PREFIX_CACHE");
      phaseIdentity = { name: phaseRoot, directory: true, identity: directoryIdentity(stat) };
      prefixSource = { schema: Buffer.from(source.schema), lock: Buffer.from(source.lock),
        expected: structuredClone(source.expected) };
    }
    const roots = new Map();
    for (const size of [203, 205, ...[213, 215, 218, 221].filter(size => size < targetLength)]) {
      if (!prefixCache.has(size)) {
        const dir = path.join(phaseRoot, String(size));
        await mkdir(path.join(dir, "migrations"), { recursive: true });
        await writeFile(path.join(dir, "schema.prisma"), source.schema);
        await writeFile(path.join(dir, "migrations/migration_lock.toml"), source.lock);
        for (const row of source.expected.slice(0, size)) {
          await cp(path.join(canonicalRoot, row.name), path.join(dir, "migrations", row.name), { recursive: true });
        }
        need(isDeepStrictEqual(await inventory(dir), source.expected.slice(0, size)), "SOURCE");
        prefixCache.set(size, await capturePrefix(dir, source.expected.slice(0, size)));
      }
      roots.set(size, prefixCache.get(size).dir);
    }
    return roots;
  }

  async function assertContainer() {
    need(!stopped, "STOPPED");
    if (technical) technical.check();
    const observed = snapshot(await inspectContainer(container.id));
    need(observed.id === container.id && observed.name === container.name &&
      observed.runId === container.runId && observed.running === true, "CONTAINER_IDENTITY");
    need(observed.publishedHost === "127.0.0.1" && typeof observed.publishedPort === "string" &&
      /^[1-9][0-9]{0,4}$/u.test(observed.publishedPort) && Number(observed.publishedPort) <= 65535,
    "CONTAINER_PORT");
    if (publishedPort) need(observed.publishedPort === publishedPort, "CONTAINER_PORT");
    publishedPort = observed.publishedPort;
  }

  async function read(database, phase, sql, stdin = false) {
    technical?.recordControlPhase(phase, "BEFORE_READ");
    await assertContainer();
    technical?.recordControlPhase(phase, "SQL");
    let result;
    try {
      const execute = stdin ? options.executeSqlStdin : executeSql;
      need(typeof execute === "function" && !types.isProxy(execute), "TAIL_STDIN_PORT");
      result = snapshot(await execute({ database, phase, sql }));
    }
    catch (error) {
      const failure = new Error("LOCAL_MIGRATION_SQL_" + phase.toUpperCase().replaceAll("-", "_"));
      if (phase === "preflight" && error && typeof error === "object" && !types.isProxy(error)) {
        const exit = Object.getOwnPropertyDescriptor(error, "exitCode")?.value;
        const signal = Object.getOwnPropertyDescriptor(error, "signal")?.value;
        const safeExit = Number.isInteger(exit) && exit > 0 && exit <= 255 ? exit : null;
        const safeSignal = ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV"].includes(signal) ? signal : null;
        if (safeExit !== null || safeSignal !== null) {
          Object.defineProperty(failure, "localMigrationPortFailure", {
            value: Object.freeze({ phase: "preflight", exitCode: safeExit, signal: safeSignal })
          });
        }
      }
      if (/^tail(213|215|218|221)-(before|supply|readback)$/u.test(phase)) failure.localMigrationFailureKind = "RESOURCE_PORT";
      throw failure;
    }
    technical?.recordControlPhase(phase, "AFTER_READ");
    await assertContainer();
    technical?.recordControlPhase(phase, "READBACK");
    if (phase === "stage205-readback") return controls.parseReadback(result?.stdout);
    try {
      need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= 512 * 1024, "READBACK");
      return JSON.parse(result.stdout.trim());
    } catch (error) {
      if (/^tail(213|215|218|221)-(before|supply|readback)$/u.test(phase)) {
        const failure = new Error("LOCAL_MIGRATION_TAIL_READBACK");
        failure.localMigrationFailureKind = "NODE_PROOF";
        throw failure;
      }
      if (error instanceof SyntaxError) need(false, "READBACK");
      throw error;
    }
  }

  function checkRoles(row, allowedNewNames = []) {
    need(Array.isArray(row.roles) && row.roles.every(role => oid(role.oid) &&
      /^[a-z_][a-z0-9_]{0,62}$/u.test(role.name)), "ROLE_PROVENANCE");
    if (!clusterRoles) {
      need(row.roles.every(role => role.oid === "10" && role.name === owner ||
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
        parsed.username === owner && parsed.port === publishedPort &&
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
      const source = { schema, lock, expected };
      try { await verifyPrefixes(source); }
      catch { need(false, "PREFIX_CACHE"); }
      const recovery = pendingRecovery.values().next().value;
      const recoveryContext = {
        databaseUrl: request.databaseUrl,
        schemaPath: request.schemaPath ?? null,
        runtimeEnv: request.runtimeEnv
      };
      if (recovery) {
        need(database === recovery.database && request.expectedFailure === undefined &&
          target.length === expected.length && isDeepStrictEqual(recoveryContext, recovery.context),
        "RECOVERY_CONTEXT");
      }
      if (target.length <= 203) return await deploy(request);
      const declaredRoles = [];
      for (const row of target) {
        const sql = await readFile(path.join(canonicalRoot, row.name, "migration.sql"), "utf8");
        for (const match of sql.matchAll(/\bCREATE\s+ROLE\s+"?([a-z][a-z0-9_]*)"?/gu)) declaredRoles.push(match[1]);
      }
      need(expected[203].sha256 === "296c6e2f502bc782bd83ab59190505e27b80623d1da1a3b6dddb72c414eb686f" &&
        expected[204].sha256 === "2ca118b29e8e75745a1ac7d6f8de3fbfa70fa5774b3d95c48c6119caff8b316a",
      "SOURCE_204_205");
      const ciRecovery = ci && technicalProfiles.ciDynamicRecoveryMigration(options.ciFixture, database);
      const rolledBack = ci ? (ciRecovery ? [ciRecovery] : []) : ["20260802010000_project_financing_quota_request_idempotency"];
      const before = await read(database, "preflight", controls.inspectSql());
      const bound = identity(before, database, owner);
      const prior = states.get(database);
      if (prior) need(isDeepStrictEqual(prior.identity, bound), "DATABASE_IDENTITY");
      else states.set(database, { identity: bound });
      checkRoles(before);
      const count = checkLedger(before.ledger, target, rolledBack);
      if (ciRecovery) need(before.ledger.filter(row => row.name === ciRecovery && row.rolledBack === true).length === 1, "CI_RECOVERY");
      if (technical) need(count === 0 && request.expectedFailure === undefined &&
        isDeepStrictEqual(target, technical.ledger.map(({name, sha256}) => ({name, sha256}))), "CURRENT259_FRESH_FULL_ONLY");
      if (recovery) {
        need(count === 114 && before.ledger.filter(row => row.name === expected[114].name &&
          row.sha256 === expected[114].sha256 && row.finished === false && row.rolledBack === true)
          .length === recovery.rolledBackCount + 1 &&
          isDeepStrictEqual(before.ledger.filter(row => row.name !== expected[114].name),
            recovery.ledger.filter(row => row.name !== expected[114].name)), "RECOVERY_NOT_RESOLVED");
        pendingRecovery.delete(database);
      }
      // Recheck after awaited preflight, including its no-pending deployment path.
      try { await verifyPrefixes(source); }
      catch { need(false, "PREFIX_CACHE"); }
      if (count >= target.length) return await deploy(request);
      need(count < 205, "PARTIAL_TAIL_QUALIFICATION");
      need(count <= 203, "PARTIAL_QUALIFICATION");

      const roots = await prefixRoots(source, target.length);
      const phaseOutput = [];
      try {
        const initial = await deploy({ ...request, schemaPath: path.join(roots.get(203), "schema.prisma") });
        phaseOutput.push(initial.stdout ?? "");
      } catch (error) {
        const expectedFailure = request.expectedFailure;
        if (count === 114 && target.length === expected.length && error instanceof Error &&
          ["project_financing_quota_duplicate_attachment", "project_financing_quota_cross_business_attachment"].includes(expectedFailure)) {
          // This records an unverified original deployment failure only. The existing
          // runner must validate its retained evidence, remediate and explicitly resolve it.
          recoverableFailures.add(error);
          pendingRecovery.set(database, {
            database, context: recoveryContext,
            ledger: structuredClone(before.ledger),
            rolledBackCount: before.ledger.filter(row => row.name === expected[114].name &&
              row.finished === false && row.rolledBack === true).length
          });
        }
        throw error;
      }
      const stage203 = await read(database, "stage203-readback", controls.inspectSql());
      need(isDeepStrictEqual(identity(stage203, database, owner), bound) &&
        checkLedger(stage203.ledger, target, rolledBack) === 203, "STAGE203");
      checkRoles(stage203, declaredRoles);

      const plan = {
        ...bound, runId: randomUUID(), nonce: randomBytes(32).toString("hex"),
        appName: "jg_fixture_app_" + randomBytes(12).toString("hex"),
        schemaName: "jg_fixture_" + randomBytes(12).toString("hex"),
        ...(technical ? { technicalProfile: technical.id, resourceRunId: technical.runId } : {}),
        ...(ci ? { ciFixture: options.ciFixture } : {}),
        migrations: expected.slice(0, 205)
      };
      if (technical) technical.recordMaterial(technicalProfiles.projectTechnicalSql(plan, await readFile(path.join(__dirname, "local-staged-migration-acl.sql"), "utf8"), "setup"));
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
      need(isDeepStrictEqual(identity(complete, database, owner), bound) &&
        checkLedger(complete.ledger, target, rolledBack) === 205, "STAGE205");
      controls.checkCompletion(complete, plan, setup);
      await read(database, "qualification-cleanup", controls.cleanupSql(plan, setup));
      const clean = await read(database, "cleanup-readback", controls.cleanReadSql(plan, setup));
      need(clean.schemaAbsent === true && clean.eventAbsent === true && clean.appOid === setup.appOid &&
        clean.applicationQualified === true, "CLEANUP");
      const after = await read(database, "post-qualification", controls.inspectSql());
      need(isDeepStrictEqual(identity(after, database, owner), bound), "DATABASE_IDENTITY");
      checkRoles(after, declaredRoles);
      if (target.length > 213) {
        const tail = createLocalTailQualification({ plan, setup, migrations: expected }, {
          read: (phase, sql) => read(database, phase, sql),
          write: (phase, sql) => read(database, phase, sql, true),
          ...(technical ? { recordMaterial: technical.recordMaterial } : {})
        });
        for (const size of [213, 215, 218, 221].filter(size => size < target.length)) {
          const prefix = await deploy({ ...request, schemaPath: path.join(roots.get(size), "schema.prisma") });
          phaseOutput.push(prefix.stdout ?? "");
          const observed = await read(database, `stage${size}-readback`, controls.inspectSql());
          need(isDeepStrictEqual(identity(observed, database, owner), bound) &&
            checkLedger(observed.ledger, target, rolledBack) === size, "TAIL_PREFIX");
          checkRoles(observed, declaredRoles);
          await tail.qualify(size);
        }
      }
      const result = await deploy(request);
      const final = await read(database, "complete-readback", controls.inspectSql());
      need(isDeepStrictEqual(identity(final, database, owner), bound) &&
        checkLedger(final.ledger, target, rolledBack) === target.length, "COMPLETION");
      checkRoles(final, declaredRoles);
      return { ...result, ...(technical ? { technicalApplication: Object.freeze({ name: plan.appName, oid: setup.appOid, nonce: plan.nonce }) } : {}), stdout: [...phaseOutput, result.stdout ?? ""].join("\n") };
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
        if (recoverableFailures.has(error)) recoverableFailures.delete(error);
        else stopped = true;
        throw error;
      }
    }
  };
}

module.exports = { createLocalMigrationFixture };
