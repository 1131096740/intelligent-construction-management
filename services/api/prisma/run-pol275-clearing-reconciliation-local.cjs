#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { loadCanonicalMigrationBaseline } = require("./migration-baseline.cjs");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const root = path.resolve(__dirname, "../../..");
const apiRoot = path.join(root, "services", "api");
const prismaRoot = path.join(apiRoot, "prisma");
const migrationsRoot = path.join(prismaRoot, "migrations");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const tar = process.platform === "win32" ? "tar.exe" : "tar";
const IMAGE = "postgres:16";
const CONFIRMATION = "LOCAL_PG16_DYNAMIC_GATE";
const DATABASE_NAME = "jiangkong_pol275";
const FULL_REPLAY_DATABASE_NAME = "jiangkong_pol275_empty";
const TERMINAL_MIGRATION =
  "20260909100000_pol275_clearing_reconciliation_repair";
const LEGACY_PROCESS_SHA = "1fc3355a89db66785a9815f7e47df58d44a4293e";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RECONCILIATION_TABLES = [
  "ClearingReconciliationItem",
  "ClearingReconciliationRevision",
  "ClearingReconciliationCoverage",
  "ClearingReconciliationResolution",
  "ClearingReconciliationDefinitionReversal",
  "ClearingReconciliationResolutionLine",
  "ClearingReconciliationDecisionSeal"
];
const prismaCli = require.resolve("prisma/build/index.js");
const jestCli = require.resolve("jest/bin/jest");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function fail(message) {
  throw new Error(`POL-275 PostgreSQL 16 动态验收失败：${message}`);
}

function inheritedDatabaseTargetNames(environment) {
  return Object.keys(environment)
    .filter((name) => name === "DATABASE_URL" || name.endsWith("_DATABASE_URL"))
    .sort();
}

function assertSafeEnvironment(environment) {
  if (environment.NODE_ENV === "production") {
    fail("禁止在 NODE_ENV=production 执行");
  }
  if (environment.LOCAL_PG16_DYNAMIC_GATE !== CONFIRMATION) {
    fail(`必须显式确认 ${CONFIRMATION}`);
  }
  const inheritedTargets = inheritedDatabaseTargetNames(environment);
  if (inheritedTargets.length > 0) {
    fail(`拒绝继承数据库目标：${inheritedTargets.join(", ")}`);
  }
  if (
    environment.DOCKER_HOST &&
    !/^(unix|npipe):\/\//u.test(environment.DOCKER_HOST)
  ) {
    fail("拒绝远程 Docker endpoint");
  }
}

async function assertRepositoryState(environment) {
  const expectedSha =
    environment.POL275_EXPECTED_SHA ??
    environment.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA;
  if (!expectedSha || !SHA_PATTERN.test(expectedSha)) {
    fail("缺少完整 40 位 POL275_EXPECTED_SHA（总门禁可传递 exact candidate SHA）");
  }
  const head = (await command("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (head !== expectedSha) {
    fail("POL275_EXPECTED_SHA 与当前 HEAD 不一致");
  }
  const status = (await command("git", ["status", "--porcelain"])).stdout;
  if (status.trim()) {
    fail("工作树不干净，拒绝生成动态验收证据");
  }
  return head;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function assertLocalDocker() {
  const result = await command(docker, [
    "context",
    "inspect",
    "--format",
    "{{json .Endpoints.docker.Host}}"
  ]);
  let endpoint;
  try {
    endpoint = JSON.parse(result.stdout.trim());
  } catch {
    fail("无法解析 Docker context endpoint");
  }
  if (typeof endpoint !== "string" || !/^(unix|npipe):\/\//u.test(endpoint)) {
    fail("当前 Docker context 不是本机 socket");
  }
  await command(docker, ["info"]);
  const image = await command(docker, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    IMAGE
  ]);
  return {
    endpoint,
    imageId: image.stdout.trim()
  };
}

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const init = await command(docker, [
        "exec",
        containerName,
        "cat",
        "/proc/1/comm"
      ]);
      if (init.stdout.trim() !== "postgres") {
        throw new Error("PostgreSQL PID 1 尚未接管容器");
      }
      await command(docker, [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "jiangkong",
        "-d",
        DATABASE_NAME
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  fail("临时 PostgreSQL 16 未在 30 秒内就绪");
}

function databaseUrl(password, port, databaseName) {
  return `postgresql://jiangkong:${password}@127.0.0.1:${port}/${databaseName}`;
}

function runtimeEnvironment(sourceEnvironment, temporaryRoot, url, ledgerSecret) {
  const environment = {
    ...sourceEnvironment,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    DATABASE_URL: url,
    OPERATING_LEDGER_DB_WRITE_SECRET: ledgerSecret,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage", "private")
  };
  delete environment.POL275_EXPECTED_SHA;
  delete environment.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA;
  return environment;
}

async function deployMigrations(schemaPath, environment) {
  await command(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", schemaPath],
    {
      env: environment,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    }
  );
}

async function preparePreTerminalPrisma(temporaryRoot) {
  const destination = path.join(temporaryRoot, "pre-terminal-prisma");
  await cp(prismaRoot, destination, {
    recursive: true,
    filter: (source) => path.basename(source) !== TERMINAL_MIGRATION
  });
  return path.join(destination, "schema.prisma");
}

async function runCurrentProcessGate(environment) {
  await command(
    process.execPath,
    [
      jestCli,
      "--config",
      "jest.config.cjs",
      "--runInBand",
      "src/database/clearing-reconciliation-concurrency.spec.ts"
    ],
    {
      cwd: apiRoot,
      env: {
        ...environment,
        RUN_POL275_CLEARING_RECONCILIATION_DATABASE: "1"
      },
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function prepareLegacyProcessSource(temporaryRoot) {
  const archivePath = path.join(temporaryRoot, "legacy-process.tar");
  const sourceRoot = path.join(temporaryRoot, "legacy-process");
  await mkdir(sourceRoot, { recursive: true });
  await command("git", [
    "archive",
    "--format=tar",
    "--output",
    archivePath,
    LEGACY_PROCESS_SHA
  ]);
  await command(tar, ["-xf", archivePath, "-C", sourceRoot]);
  const compatibilityTest =
    "services/api/src/database/clearing-reconciliation-legacy-compatibility.spec.ts";
  await copyFile(
    path.join(root, compatibilityTest),
    path.join(sourceRoot, compatibilityTest)
  );
  await symlink(path.join(root, "node_modules"), path.join(sourceRoot, "node_modules"), "dir");
  return sourceRoot;
}

async function runLegacyProcessGate(sourceRoot, environment) {
  const legacyApiRoot = path.join(sourceRoot, "services", "api");
  await command(
    process.execPath,
    [
      jestCli,
      "--config",
      "jest.config.cjs",
      "--runInBand",
      "src/database/clearing-reconciliation-legacy-compatibility.spec.ts"
    ],
    {
      cwd: legacyApiRoot,
      env: {
        ...environment,
        RUN_POL275_LEGACY_PROCESS_COMPATIBILITY: "1"
      },
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function collectEvidence(url, expectedMigrationCount) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [database] = await prisma.$queryRawUnsafe(`
      SELECT
        current_setting('server_version') AS "serverVersion",
        (SELECT COUNT(*)::integer FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "migrationCount"
    `);
    const [terminal] = await prisma.$queryRawUnsafe(`
      SELECT migration_name AS "migrationName",
             finished_at IS NOT NULL AS "finished",
             rolled_back_at IS NULL AS "notRolledBack"
        FROM "_prisma_migrations"
       WHERE migration_name = '${TERMINAL_MIGRATION}'
    `);
    const tables = await prisma.$queryRawUnsafe(`
      SELECT candidate."tableName",
             to_regclass(format('public.%I', candidate."tableName")) IS NOT NULL AS "exists"
        FROM unnest(ARRAY[${RECONCILIATION_TABLES.map((table) => `'${table}'`).join(", ")}])
             AS candidate("tableName")
       ORDER BY candidate."tableName"
    `);
    const roles = await prisma.$queryRawUnsafe(`
      SELECT rolname AS "roleName", rolcanlogin AS "canLogin",
             rolsuper AS "isSuperuser", rolcreaterole AS "canCreateRole",
             rolcreatedb AS "canCreateDatabase", rolreplication AS "canReplicate",
             rolbypassrls AS "canBypassRls"
        FROM pg_catalog.pg_roles
       WHERE rolname IN ('jg_pol275_owner', 'jg_pol275_runtime')
       ORDER BY rolname
    `);
    const [authority] = await prisma.$queryRawUnsafe(`
      SELECT
        pg_has_role('jg_pol275_runtime', 'jg_pol275_owner', 'MEMBER') AS "runtimeMemberOfOwner",
        (SELECT COUNT(*)::integer
           FROM pg_catalog.pg_auth_members membership
          WHERE membership.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol275_owner')) AS "ownerMemberCount",
        has_schema_privilege('jg_pol275_runtime', 'public', 'CREATE') AS "runtimeCanCreateInPublic",
        has_function_privilege('jg_pol275_runtime', 'public.pol275_append_reconciliation_set(text,text)', 'EXECUTE') AS "runtimeCanExecuteWriter",
        NOT EXISTS (
          SELECT 1
            FROM pg_catalog.pg_proc procedure
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
            CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
           WHERE namespace.nspname = 'public'
             AND procedure.proname = 'pol275_append_reconciliation_set'
             AND acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
        ) AS "publicCannotExecuteWriter"
    `);
    const tablePrivileges = await prisma.$queryRawUnsafe(`
      SELECT candidate."tableName",
             has_table_privilege('jg_pol275_runtime', format('public.%I', candidate."tableName"), 'SELECT') AS "canSelect",
             has_table_privilege('jg_pol275_runtime', format('public.%I', candidate."tableName"), 'INSERT') AS "canInsert",
             has_table_privilege('jg_pol275_runtime', format('public.%I', candidate."tableName"), 'UPDATE') AS "canUpdate",
             has_table_privilege('jg_pol275_runtime', format('public.%I', candidate."tableName"), 'DELETE') AS "canDelete",
             has_table_privilege('jg_pol275_runtime', format('public.%I', candidate."tableName"), 'TRUNCATE') AS "canTruncate"
        FROM unnest(ARRAY[${RECONCILIATION_TABLES.map((table) => `'${table}'`).join(", ")}])
             AS candidate("tableName")
       ORDER BY candidate."tableName"
    `);
    const [writer] = await prisma.$queryRawUnsafe(`
      SELECT pg_get_userbyid(procedure.proowner) AS "owner",
             procedure.prosecdef AS "securityDefiner",
             procedure.proconfig AS "configuration"
        FROM pg_catalog.pg_proc procedure
       WHERE procedure.oid =
             'public.pol275_append_reconciliation_set(text,text)'::regprocedure
    `);
    const evidence = {
      serverVersion: database.serverVersion,
      migrationCount: database.migrationCount,
      terminalMigration: terminal,
      reconciliationTables: tables,
      roles,
      authority,
      tablePrivileges,
      writer
    };
    assertEvidence(evidence, expectedMigrationCount);
    return evidence;
  } finally {
    await prisma.$disconnect();
  }
}

function assertEvidence(evidence, expectedMigrationCount) {
  if (!String(evidence.serverVersion).startsWith("16.")) fail("PostgreSQL 不是 16.x");
  if (evidence.migrationCount !== expectedMigrationCount) fail("成功迁移数量不等于 canonical baseline");
  if (
    !evidence.terminalMigration ||
    evidence.terminalMigration.migrationName !== TERMINAL_MIGRATION ||
    evidence.terminalMigration.finished !== true ||
    evidence.terminalMigration.notRolledBack !== true
  ) {
    fail("终态迁移不是已完成且未回滚");
  }
  if (evidence.reconciliationTables.length !== 7 || evidence.reconciliationTables.some((table) => !table.exists)) {
    fail("7 张清算关系表未完整落地");
  }
  if (
    evidence.roles.length !== 2 ||
    evidence.roles.some((role) =>
      role.canLogin || role.isSuperuser || role.canCreateRole ||
      role.canCreateDatabase || role.canReplicate || role.canBypassRls
    )
  ) {
    fail("POL-275 owner/runtime 角色不是最小 NOLOGIN 角色");
  }
  if (
    evidence.authority.runtimeMemberOfOwner ||
    evidence.authority.ownerMemberCount !== 0 ||
    evidence.authority.runtimeCanCreateInPublic ||
    !evidence.authority.runtimeCanExecuteWriter ||
    !evidence.authority.publicCannotExecuteWriter
  ) {
    fail("POL-275 角色成员关系或受控函数 ACL 不满足隔离要求");
  }
  if (
    evidence.tablePrivileges.some((privilege) =>
      !privilege.canSelect || privilege.canInsert || privilege.canUpdate ||
      privilege.canDelete || privilege.canTruncate
    )
  ) {
    fail("POL-275 runtime 仍拥有关系表直接 DML 权限");
  }
  if (
    evidence.writer?.owner !== "jg_pol275_owner" ||
    evidence.writer?.securityDefiner !== true ||
    !Array.isArray(evidence.writer?.configuration) ||
    !evidence.writer.configuration.includes("search_path=pg_catalog, public, pg_temp")
  ) {
    fail("受控 writer 的 owner、SECURITY DEFINER 或 search_path 不正确");
  }
}

async function main() {
  const sourceEnvironment = { ...process.env };
  assertSafeEnvironment(sourceEnvironment);
  const candidateSha = await assertRepositoryState(sourceEnvironment);
  const baseline = loadCanonicalMigrationBaseline({ migrationsRoot });
  if (
    baseline.terminalMigration !== TERMINAL_MIGRATION ||
    baseline.expectedDirectoryCount !== 166
  ) {
    fail("canonical migration baseline 尚未固定为 POL-275 / 166");
  }
  const dockerReceipt = await assertLocalDocker();
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-pol275-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-pol275-"));
  const password = randomUUID();
  const ledgerSecret = randomUUID();
  const upgradeUrl = databaseUrl(password, port, DATABASE_NAME);
  const fullReplayUrl = databaseUrl(password, port, FULL_REPLAY_DATABASE_NAME);
  const upgradeEnvironment = runtimeEnvironment(
    sourceEnvironment,
    temporaryRoot,
    upgradeUrl,
    ledgerSecret
  );
  const fullReplayEnvironment = runtimeEnvironment(
    sourceEnvironment,
    temporaryRoot,
    fullReplayUrl,
    ledgerSecret
  );
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 })
        .catch((error) => {
          if (!String(error?.message).includes("No such container")) throw error;
        }),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => process.stdout.write("POL-275 本地动态验收资源已清理。\n")
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => process.stderr.write(`${message}\n`),
      exit: (code) => process.exit(code)
    });
    return interruptionPromise;
  };
  const onSigint = () => void interrupt("SIGINT");
  const onSigterm = () => void interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await command(docker, [
      "run",
      "--pull=never",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--env",
      "POSTGRES_USER=jiangkong",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      `POSTGRES_DB=${DATABASE_NAME}`,
      "--publish",
      `127.0.0.1:${port}:5432`,
      IMAGE
    ], {
      env: { ...sourceEnvironment, POSTGRES_PASSWORD: password },
      forwardOutput: true
    });
    await waitForPostgres(containerName);
    await command(docker, [
      "exec",
      containerName,
      "createdb",
      "-U",
      "jiangkong",
      FULL_REPLAY_DATABASE_NAME
    ]);

    await deployMigrations(path.join(prismaRoot, "schema.prisma"), fullReplayEnvironment);
    const fullReplayEvidence = await collectEvidence(
      fullReplayUrl,
      baseline.expectedDirectoryCount
    );

    const preTerminalSchema = await preparePreTerminalPrisma(temporaryRoot);
    await deployMigrations(preTerminalSchema, upgradeEnvironment);
    await deployMigrations(path.join(prismaRoot, "schema.prisma"), upgradeEnvironment);
    await runCurrentProcessGate(upgradeEnvironment);
    const legacySourceRoot = await prepareLegacyProcessSource(temporaryRoot);
    await runLegacyProcessGate(legacySourceRoot, upgradeEnvironment);
    const upgradeEvidence = await collectEvidence(
      upgradeUrl,
      baseline.expectedDirectoryCount
    );

    const receipt = {
      schemaVersion: 1,
      gate: "pol275-clearing-reconciliation-postgresql16",
      status: "passed",
      candidateSha,
      legacyProcessSha: LEGACY_PROCESS_SHA,
      containerImage: IMAGE,
      containerImageId: dockerReceipt.imageId,
      migrationBaseline: baseline,
      fullReplay: fullReplayEvidence,
      upgradeReplay: upgradeEvidence,
      currentProcessDynamicTests: 3,
      legacyProcessCompatibilityTests: 1,
      productionTouched: false,
      finishedAt: new Date().toISOString()
    };
    const serialized = `${JSON.stringify(receipt)}\n`;
    const evidencePath = sourceEnvironment.POL275_CLEARING_RECONCILIATION_EVIDENCE_PATH;
    if (evidencePath) await writeFile(evidencePath, serialized, { encoding: "utf8", flag: "wx" });
    process.stdout.write(serialized);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "未知错误"}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION,
  DATABASE_NAME,
  FULL_REPLAY_DATABASE_NAME,
  IMAGE,
  LEGACY_PROCESS_SHA,
  RECONCILIATION_TABLES,
  TERMINAL_MIGRATION,
  assertEvidence,
  assertSafeEnvironment,
  inheritedDatabaseTargetNames,
  runtimeEnvironment
};
