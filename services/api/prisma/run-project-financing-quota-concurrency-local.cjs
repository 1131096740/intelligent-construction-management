#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  resolveCorepackHome,
  runInterruption,
  withLocalPostgresHost
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME = "jiangkong_project_financing_quota_concurrency";
const LEGACY_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre116_legacy";
const PRE115_CLEAN_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre115_clean";
const PRE115_DUPLICATE_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre115_duplicate";
const PRE115_CROSS_BUSINESS_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre115_cross_business";
const PRE115_REPLACEMENT_CHILD_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre115_replacement_child";
const PRE115_REPLACEMENT_PARENT_DATABASE_NAME =
  "jiangkong_project_financing_quota_pre115_replacement_parent";
const ALLOWED_DATABASE_NAMES = [
  DATABASE_NAME,
  LEGACY_DATABASE_NAME,
  PRE115_CLEAN_DATABASE_NAME,
  PRE115_DUPLICATE_DATABASE_NAME,
  PRE115_CROSS_BUSINESS_DATABASE_NAME,
  PRE115_REPLACEMENT_CHILD_DATABASE_NAME,
  PRE115_REPLACEMENT_PARENT_DATABASE_NAME
];
const PRE115_MIGRATION_COUNT = 114;
const PRE115_TERMINAL_MIGRATION =
  "20260728161000_spot_procurement_application_revision_status";
const REQUEST_MIGRATION =
  "20260802010000_project_financing_quota_request_idempotency";
const REQUEST_MIGRATION_CHECKSUM =
  "d3d0d07a6cc9a49da1cca1478822a873fad7c7324b9d189e2a55a4d3f57bfe61";
const EXPECTED_MIGRATION_COUNT = 128;
const CURRENT_TERMINAL_MIGRATION =
  "20260814120000_operating_ledger_runtime_write_guard";
const TERMINAL_MIGRATION =
  "20260802020000_project_financing_quota_termination_idempotency";
const TERMINAL_MIGRATION_CHECKSUM =
  "a713473b527c5ba6201f35e11f27a54f62a15e72db5bc65a1f84094a0a276b03";
const PRE115_CONFLICT_SCENARIOS = [
  {
    kind: "duplicate",
    databaseName: PRE115_DUPLICATE_DATABASE_NAME,
    expectedFailure: "project_financing_quota_duplicate_attachment"
  },
  {
    kind: "cross_business",
    databaseName: PRE115_CROSS_BUSINESS_DATABASE_NAME,
    expectedFailure: "project_financing_quota_cross_business_attachment"
  },
  {
    kind: "replacement_child",
    databaseName: PRE115_REPLACEMENT_CHILD_DATABASE_NAME,
    expectedFailure: "project_financing_quota_cross_business_attachment"
  },
  {
    kind: "replacement_parent",
    databaseName: PRE115_REPLACEMENT_PARENT_DATABASE_NAME,
    expectedFailure: "project_financing_quota_cross_business_attachment"
  }
];
const root = path.resolve(__dirname, "../../..");
const migrationsRoot = path.join(__dirname, "migrations");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function isLocalHostName(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function assertLocalDatabaseUrl(databaseUrl, allowedDatabaseNames) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("项目垫资额度并发门 DATABASE_URL 不是有效 URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("项目垫资额度并发门只能连接 PostgreSQL");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("项目垫资额度并发门拒绝连接非本机数据库");
  }
  if (!allowedDatabaseNames.includes(parsed.pathname.slice(1))) {
    throw new Error("项目垫资额度并发门只允许精确的一次性专库");
  }
  return parsed;
}

function assertDedicatedLocalDatabase(databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl, [DATABASE_NAME]);
}

function assertLocalDockerEndpoint(endpoint) {
  const trimmed = endpoint.trim();
  if (!trimmed) return;
  const normalized = trimmed.replace(/^"(.*)"$/u, "$1");
  if (!isLocalDockerSocketEndpoint(normalized)) {
    throw new Error("项目垫资额度并发门拒绝远程 Docker endpoint/context");
  }
}

function assertResolvedLocalDockerEndpoint(endpoint) {
  let resolved;
  try {
    resolved = JSON.parse(endpoint.trim());
  } catch {
    throw new Error(
      "项目垫资额度并发门无法确认本机 Docker endpoint/context"
    );
  }
  if (
    typeof resolved !== "string" ||
    !isLocalDockerSocketEndpoint(resolved.trim())
  ) {
    throw new Error(
      "项目垫资额度并发门无法确认本机 Docker endpoint/context"
    );
  }
  return resolved.trim();
}

function pinResolvedLocalDockerEndpoint(dockerEnv, endpoint) {
  const resolvedDockerEndpoint = assertResolvedLocalDockerEndpoint(endpoint);
  dockerEnv.DOCKER_HOST = resolvedDockerEndpoint;
  delete dockerEnv.DOCKER_CONTEXT;
  return resolvedDockerEndpoint;
}

function isLocalDockerSocketEndpoint(endpoint) {
  return (
    /^unix:\/\/\/[^\r\n]+$/u.test(endpoint) ||
    /^npipe:\/{4}\.\/pipe\/[^/]+$/u.test(endpoint)
  );
}

function createControlledDockerEnv(sourceEnv, fallbackHome) {
  const dockerEnv = {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? fallbackHome
  };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (sourceEnv[key] !== undefined) dockerEnv[key] = sourceEnv[key];
  }
  return dockerEnv;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function assertMigrationSource() {
  const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    entries.length !== EXPECTED_MIGRATION_COUNT ||
    entries.at(-1) !== CURRENT_TERMINAL_MIGRATION ||
    entries.at(PRE115_MIGRATION_COUNT - 1) !== PRE115_TERMINAL_MIGRATION ||
    entries.at(PRE115_MIGRATION_COUNT) !== REQUEST_MIGRATION
  ) {
    throw new Error(
      `项目垫资额度并发门要求 ${EXPECTED_MIGRATION_COUNT} 个迁移且终点为 ${CURRENT_TERMINAL_MIGRATION}`
    );
  }
  const migrationSql = await readFile(
    path.join(migrationsRoot, TERMINAL_MIGRATION, "migration.sql")
  );
  const checksum = createHash("sha256").update(migrationSql).digest("hex");
  if (checksum !== TERMINAL_MIGRATION_CHECKSUM) {
    throw new Error(
      `项目垫资额度 #116 迁移 checksum 漂移：${checksum}`
    );
  }
  const requestMigrationSql = await readFile(
    path.join(migrationsRoot, REQUEST_MIGRATION, "migration.sql")
  );
  const requestChecksum = createHash("sha256")
    .update(requestMigrationSql)
    .digest("hex");
  if (requestChecksum !== REQUEST_MIGRATION_CHECKSUM) {
    throw new Error("项目垫资额度 #115 迁移 checksum 漂移");
  }
}

function databaseUrlFor(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  const result = parsed.toString();
  assertLocalDatabaseUrl(result, ALLOWED_DATABASE_NAMES);
  return result;
}

async function waitForPostgres(containerName, dockerCommand) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await dockerCommand([
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "jiangkong",
        "-d",
        DATABASE_NAME
      ], { timeoutMs: 15_000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("项目垫资额度临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createFinancingQuotaRunnerCleanup({
  commandRuntime: runtime,
  dockerCommand,
  containerName,
  containerLifecycle,
  temporaryRoot,
  removeTemporaryRoot = rm,
  onComplete
}) {
  return createRunnerCleanup({
    stopChildren: () => runtime.stopAll(),
    removeContainer: () => {
      if (
        !containerLifecycle.localDockerValidated ||
        !containerLifecycle.containerRunAttempted
      ) {
        return Promise.resolve();
      }
      return dockerCommand(["rm", "--force", containerName], {
        timeoutMs: 60_000
      }).catch((error) => {
        if (!String(error?.message).includes("No such container")) throw error;
      });
    },
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, { recursive: true, force: true }),
    onComplete
  });
}

async function preparePre116MigrationRoot(temporaryRoot) {
  const prismaRoot = path.join(temporaryRoot, "pre116-prisma");
  const migrations = path.join(prismaRoot, "migrations");
  await mkdir(migrations, { recursive: true });
  await copyFile(
    path.join(__dirname, "schema.prisma"),
    path.join(prismaRoot, "schema.prisma")
  );
  await copyFile(
    path.join(migrationsRoot, "migration_lock.toml"),
    path.join(migrations, "migration_lock.toml")
  );
  for (const entry of await readdir(migrationsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name >= TERMINAL_MIGRATION) continue;
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(migrations, entry.name),
      { recursive: true }
    );
  }
  return prismaRoot;
}

async function preparePre115MigrationRoot(temporaryRoot) {
  const prismaRoot = path.join(temporaryRoot, "pre115-prisma");
  const migrations = path.join(prismaRoot, "migrations");
  await mkdir(migrations, { recursive: true });
  await copyFile(
    path.join(__dirname, "schema.prisma"),
    path.join(prismaRoot, "schema.prisma")
  );
  await copyFile(
    path.join(migrationsRoot, "migration_lock.toml"),
    path.join(migrations, "migration_lock.toml")
  );
  const copiedMigrations = [];
  for (const entry of await readdir(migrationsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name >= REQUEST_MIGRATION) continue;
    copiedMigrations.push(entry.name);
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(migrations, entry.name),
      { recursive: true }
    );
  }
  copiedMigrations.sort();
  if (
    copiedMigrations.length !== PRE115_MIGRATION_COUNT ||
    copiedMigrations.at(-1) !== PRE115_TERMINAL_MIGRATION
  ) {
    throw new Error(
      `#115 retained migration 演练要求精确 ${PRE115_MIGRATION_COUNT} ` +
      `个前置迁移且终点为 ${PRE115_TERMINAL_MIGRATION}`
    );
  }
  return prismaRoot;
}

async function runPrismaMigrate({ databaseUrl, runtimeEnv, schemaPath }) {
  const args = [
    "--filter",
    "@jiangkong/api",
    "exec",
    "prisma",
    "migrate",
    "deploy"
  ];
  if (schemaPath) args.push("--schema", schemaPath);
  return command(pnpm, args, {
    env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
    forwardOutput: true,
    timeoutMs: 15 * 60 * 1000
  });
}

async function runPrismaResolveRolledBack({ databaseUrl, runtimeEnv }) {
  return command(
    pnpm,
    [
      "--filter",
      "@jiangkong/api",
      "exec",
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      REQUEST_MIGRATION
    ],
    {
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function runPrismaStatus({ databaseUrl, runtimeEnv }) {
  return command(
    pnpm,
    ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"],
    {
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function runPsql(dockerCommand, databaseName, sql) {
  return dockerCommand([
    "exec",
    dockerCommand.containerName,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "jiangkong",
    "-d",
    databaseName,
    "-X",
    "-A",
    "-t",
    "-F",
    "|",
    "-c",
    sql
  ], { timeoutMs: 60_000 });
}

async function capturePostgresLogs(dockerCommand) {
  const result = await dockerCommand([
    "logs",
    dockerCommand.containerName
  ]);
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function postgresLogDelta(before, after) {
  const sliceDelta = (previous, current) =>
    current.startsWith(previous) ? current.slice(previous.length) : current;
  return [
    sliceDelta(before.stdout, after.stdout),
    sliceDelta(before.stderr, after.stderr)
  ].join("\n");
}

async function verifyMigrationProof(dockerCommand, databaseName) {
  const proof = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        count(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${TERMINAL_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (WHERE "rolled_back_at" IS NOT NULL),
        COALESCE(max("checksum") FILTER (
          WHERE "migration_name" = '${TERMINAL_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ), '')
      FROM "_prisma_migrations";
    `
  );
  const [
    appliedMigrationCount,
    terminalMigrationCount,
    rolledBackMigrationCount,
    terminalChecksum
  ] = proof.stdout.trim().split("|");
  if (
    Number(appliedMigrationCount) !== EXPECTED_MIGRATION_COUNT ||
    Number(terminalMigrationCount) !== 1 ||
    Number(rolledBackMigrationCount) !== 0 ||
    terminalChecksum !== TERMINAL_MIGRATION_CHECKSUM
  ) {
    throw new Error(
      `项目垫资额度迁移证据不完整：` +
      `applied=${appliedMigrationCount} terminal=${terminalMigrationCount} ` +
      `rolled_back=${rolledBackMigrationCount} checksum=${terminalChecksum}`
    );
  }
}

async function verifyPre115MigrationProof(dockerCommand, databaseName) {
  const proof = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        count(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${PRE115_TERMINAL_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (WHERE "rolled_back_at" IS NOT NULL)
      FROM "_prisma_migrations";
    `
  );
  const [
    appliedPre115MigrationCount,
    pre115TerminalMigrationCount,
    rolledBackPre115MigrationCount
  ] = proof.stdout.trim().split("|").map(Number);
  if (
    appliedPre115MigrationCount !== PRE115_MIGRATION_COUNT ||
    pre115TerminalMigrationCount !== 1 ||
    rolledBackPre115MigrationCount !== 0
  ) {
    throw new Error(
      `#115 retained migration 前置证据不完整：` +
      `applied=${appliedPre115MigrationCount} ` +
      `terminal=${pre115TerminalMigrationCount} ` +
      `rolled_back=${rolledBackPre115MigrationCount}`
    );
  }
}

async function createDedicatedDatabase(dockerCommand, databaseName) {
  if (!ALLOWED_DATABASE_NAMES.includes(databaseName)) {
    throw new Error("项目垫资额度并发门拒绝创建非白名单数据库");
  }
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    databaseName
  ], { timeoutMs: 60_000 });
}

async function seedPre115Scenario(dockerCommand, databaseName, kind) {
  if (
    kind !== "clean" &&
    !PRE115_CONFLICT_SCENARIOS.some((scenario) => scenario.kind === kind)
  ) {
    throw new Error("#115 retained migration 演练拒绝未知场景");
  }
  await runPsql(
    dockerCommand,
    databaseName,
    `
      INSERT INTO "User" (
        "id", "name", "updatedAt"
      ) VALUES (
        'pfq-pre115-user', '#115 历史用户',
        TIMESTAMP '2026-08-02 00:00:00'
      );
      INSERT INTO "Project" (
        "id", "code", "name", "updatedAt"
      ) VALUES (
        'pfq-pre115-project', 'PFQ-PRE115', '#115 历史项目',
        TIMESTAMP '2026-08-02 00:00:00'
      );
      INSERT INTO "FileObject" (
        "id", "bucket", "objectKey", "originalName", "mimeType",
        "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
      ) VALUES
        (
          'pfq-pre115-attachment', 'local-test',
          'pfq/pre115/attachment.pdf', '#115 历史附件.pdf',
          'application/pdf', 128, 'pfq-pre115-user', repeat('a', 64), 'active'
        ),
        (
          'pfq-pre115-replacement', 'local-test',
          'pfq/pre115/replacement.pdf', '#115 替换链文件.pdf',
          'application/pdf', 128, 'pfq-pre115-user', repeat('b', 64), 'active'
        );
    `
  );
  if (kind === "replacement_child") {
    await runPsql(
      dockerCommand,
      databaseName,
      `UPDATE "FileObject"
       SET "supersedesFileObjectId" = 'pfq-pre115-replacement'
       WHERE "id" = 'pfq-pre115-attachment';`
    );
  }
  if (kind === "replacement_parent") {
    await runPsql(
      dockerCommand,
      databaseName,
      `UPDATE "FileObject"
       SET "supersedesFileObjectId" = 'pfq-pre115-attachment'
       WHERE "id" = 'pfq-pre115-replacement';`
    );
  }
  await runPsql(
    dockerCommand,
    databaseName,
    `
      INSERT INTO "ProjectFinancingQuota" (
        "id", "projectId", "amountCents", "reason", "validUntil",
        "attachmentFileId", "requestedByUserId", "status", "updatedAt"
      ) VALUES (
        'pfq-pre115-quota', 'pfq-pre115-project', 1000,
        '#115 历史额度', TIMESTAMP '2026-12-31 00:00:00',
        'pfq-pre115-attachment', 'pfq-pre115-user', 'approval_pending',
        TIMESTAMP '2026-08-02 00:00:00'
      );
    `
  );
  if (kind === "duplicate") {
    await runPsql(
      dockerCommand,
      databaseName,
      `
        INSERT INTO "ProjectFinancingQuota" (
          "id", "projectId", "amountCents", "reason", "validUntil",
          "attachmentFileId", "requestedByUserId", "status", "updatedAt"
        ) VALUES (
          'pfq-pre115-quota-duplicate', 'pfq-pre115-project', 2000,
          '#115 历史重复附件额度', TIMESTAMP '2026-12-31 00:00:00',
          'pfq-pre115-attachment', 'pfq-pre115-user', 'approval_pending',
          TIMESTAMP '2026-08-02 00:00:00'
        );
      `
    );
  }
  if (kind === "cross_business") {
    await runPsql(
      dockerCommand,
      databaseName,
      `UPDATE "User"
       SET "signatureFileId" = 'pfq-pre115-attachment'
       WHERE "id" = 'pfq-pre115-user';`
    );
  }
}

async function capturePre115BusinessSnapshot(dockerCommand, databaseName) {
  const snapshot = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        md5(COALESCE((
          SELECT string_agg(row_to_json(quota)::text, '|' ORDER BY quota."id")
          FROM "ProjectFinancingQuota" quota
        ), '')),
        md5(COALESCE((
          SELECT string_agg(row_to_json(file_object)::text, '|'
            ORDER BY file_object."id")
          FROM "FileObject" file_object
          WHERE file_object."id" LIKE 'pfq-pre115-%'
        ), '')),
        md5(COALESCE((
          SELECT string_agg(row_to_json(user_row)::text, '|'
            ORDER BY user_row."id")
          FROM "User" user_row
          WHERE user_row."id" = 'pfq-pre115-user'
        ), ''));
    `
  );
  return snapshot.stdout.trim();
}

async function verifyRequestMigrationRollback({
  dockerCommand,
  databaseName,
  beforeSnapshot
}) {
  const afterFailureSnapshot = await capturePre115BusinessSnapshot(
    dockerCommand,
    databaseName
  );
  const proof = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        count(*) FILTER (
          WHERE "table_name" = 'ProjectFinancingQuota'
            AND "column_name" IN (
              'attachmentFileSha256Snapshot', 'requestedByRoleKey',
              'requestIdempotencyKey', 'requestFingerprint'
            )
        )
      FROM information_schema.columns;
      SELECT
        count(*) FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "finished_at" IS NULL
            AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "finished_at" IS NOT NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "rolled_back_at" IS NOT NULL
        )
      FROM "_prisma_migrations";
    `
  );
  const lines = proof.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const requestSnapshotColumnCount = Number(lines[0]);
  const [
    failedRequestMigrationCount,
    finishedRequestMigrationCount,
    rolledBackRequestMigrationCount
  ] = lines[1].split("|").map(Number);
  if (
    beforeSnapshot !== afterFailureSnapshot ||
    requestSnapshotColumnCount !== 0 ||
    failedRequestMigrationCount !== 1 ||
    finishedRequestMigrationCount !== 0 ||
    rolledBackRequestMigrationCount !== 0
  ) {
    throw new Error(
      `#115 冲突迁移未证明整体回滚：` +
      `columns=${requestSnapshotColumnCount} failed=${failedRequestMigrationCount} ` +
      `finished=${finishedRequestMigrationCount} ` +
      `rolled_back=${rolledBackRequestMigrationCount} ` +
      `business_unchanged=${beforeSnapshot === afterFailureSnapshot}`
    );
  }
}

async function remediatePre115Conflict(dockerCommand, databaseName, kind) {
  const sqlByKind = {
    duplicate: `DELETE FROM "ProjectFinancingQuota"
      WHERE "id" = 'pfq-pre115-quota-duplicate';`,
    cross_business: `UPDATE "User"
      SET "signatureFileId" = NULL
      WHERE "id" = 'pfq-pre115-user';`,
    replacement_child: `UPDATE "FileObject"
      SET "supersedesFileObjectId" = NULL
      WHERE "id" = 'pfq-pre115-attachment';`,
    replacement_parent: `UPDATE "FileObject"
      SET "supersedesFileObjectId" = NULL
      WHERE "id" = 'pfq-pre115-replacement';`
  };
  const sql = sqlByKind[kind];
  if (!sql) throw new Error("#115 冲突修复拒绝未知场景");
  await runPsql(dockerCommand, databaseName, sql);
}

async function verifyHistoricalRequestSnapshotNull(
  dockerCommand,
  databaseName,
  expectedRows = 1
) {
  const proof = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT count(*), count(*) FILTER (
        WHERE "attachmentFileSha256Snapshot" IS NULL
          AND "requestedByRoleKey" IS NULL
          AND "requestIdempotencyKey" IS NULL
          AND "requestFingerprint" IS NULL
      )
      FROM "ProjectFinancingQuota"
      WHERE "id" LIKE 'pfq-pre115-quota%';
    `
  );
  const [historicalQuotaCount, historicalRequestSnapshotNullCount] =
    proof.stdout.trim().split("|").map(Number);
  if (
    historicalQuotaCount !== expectedRows ||
    historicalRequestSnapshotNullCount !== expectedRows
  ) {
    throw new Error(
      `#115 升级伪造了历史 request snapshot：` +
      `rows=${historicalQuotaCount} null_snapshots=${historicalRequestSnapshotNullCount}`
    );
  }
}

async function verifyRecoveredMigrationProof(dockerCommand, databaseName) {
  const proof = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        count(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "rolled_back_at" IS NOT NULL
        ),
        count(*) FILTER (
          WHERE "migration_name" = '${TERMINAL_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ),
        COALESCE(max("checksum") FILTER (
          WHERE "migration_name" = '${REQUEST_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ), ''),
        COALESCE(max("checksum") FILTER (
          WHERE "migration_name" = '${TERMINAL_MIGRATION}'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ), '')
      FROM "_prisma_migrations";
    `
  );
  const [
    appliedMigrationCount,
    appliedRequestMigrationCount,
    rolledBackRequestMigrationCount,
    terminalMigrationCount,
    requestChecksum,
    terminalChecksum
  ] = proof.stdout.trim().split("|");
  if (
    Number(appliedMigrationCount) !== EXPECTED_MIGRATION_COUNT ||
    Number(appliedRequestMigrationCount) !== 1 ||
    Number(rolledBackRequestMigrationCount) !== 1 ||
    Number(terminalMigrationCount) !== 1 ||
    requestChecksum !== REQUEST_MIGRATION_CHECKSUM ||
    terminalChecksum !== TERMINAL_MIGRATION_CHECKSUM
  ) {
    throw new Error(
      `#115 冲突修复后迁移证据不完整：` +
      `applied=${appliedMigrationCount} request=${appliedRequestMigrationCount} ` +
      `request_rolled_back=${rolledBackRequestMigrationCount} ` +
      `terminal=${terminalMigrationCount}`
    );
  }
}

async function verifyPre115RetainedMigrations({
  dockerCommand,
  databaseUrl,
  runtimeEnv,
  temporaryRoot
}) {
  const pre115Root = await preparePre115MigrationRoot(temporaryRoot);
  const schemaPath = path.join(pre115Root, "schema.prisma");

  await createDedicatedDatabase(dockerCommand, PRE115_CLEAN_DATABASE_NAME);
  const cleanUrl = databaseUrlFor(databaseUrl, PRE115_CLEAN_DATABASE_NAME);
  await runPrismaMigrate({
    databaseUrl: cleanUrl,
    runtimeEnv,
    schemaPath
  });
  await verifyPre115MigrationProof(
    dockerCommand,
    PRE115_CLEAN_DATABASE_NAME
  );
  await seedPre115Scenario(
    dockerCommand,
    PRE115_CLEAN_DATABASE_NAME,
    "clean"
  );
  await runPrismaMigrate({ databaseUrl: cleanUrl, runtimeEnv });
  await verifyHistoricalRequestSnapshotNull(
    dockerCommand,
    PRE115_CLEAN_DATABASE_NAME
  );
  await verifyMigrationProof(dockerCommand, PRE115_CLEAN_DATABASE_NAME);

  for (const scenario of PRE115_CONFLICT_SCENARIOS) {
    await createDedicatedDatabase(dockerCommand, scenario.databaseName);
    const scenarioUrl = databaseUrlFor(databaseUrl, scenario.databaseName);
    await runPrismaMigrate({
      databaseUrl: scenarioUrl,
      runtimeEnv,
      schemaPath
    });
    await verifyPre115MigrationProof(dockerCommand, scenario.databaseName);
    await seedPre115Scenario(
      dockerCommand,
      scenario.databaseName,
      scenario.kind
    );
    const beforeSnapshot = await capturePre115BusinessSnapshot(
      dockerCommand,
      scenario.databaseName
    );
    const postgresLogBefore = await capturePostgresLogs(dockerCommand);
    let migrationFailure;
    try {
      await runPrismaMigrate({ databaseUrl: scenarioUrl, runtimeEnv });
    } catch (error) {
      migrationFailure = error;
    }
    const failedMigrationLog = await runPsql(
      dockerCommand,
      scenario.databaseName,
      `
        SELECT COALESCE("logs", '')
        FROM "_prisma_migrations"
        WHERE "migration_name" = '${REQUEST_MIGRATION}'
        ORDER BY "started_at" DESC
        LIMIT 1;
      `
    );
    const postgresLogAfter = await capturePostgresLogs(dockerCommand);
    const migrationFailureEvidence = [
      migrationFailure instanceof Error ? migrationFailure.message : "",
      failedMigrationLog.stdout,
      failedMigrationLog.stderr,
      postgresLogDelta(postgresLogBefore, postgresLogAfter)
    ].join("\n");
    if (
      !migrationFailure ||
      !migrationFailureEvidence.includes(scenario.expectedFailure)
    ) {
      throw new Error(
        `#115 ${scenario.kind} 场景未以预期错误停止迁移；` +
        `evidence=${migrationFailureEvidence.trim().slice(-2000)}`
      );
    }
    await verifyRequestMigrationRollback({
      dockerCommand,
      databaseName: scenario.databaseName,
      beforeSnapshot
    });
    await remediatePre115Conflict(
      dockerCommand,
      scenario.databaseName,
      scenario.kind
    );
    await runPrismaResolveRolledBack({
      databaseUrl: scenarioUrl,
      runtimeEnv
    });
    await runPrismaMigrate({ databaseUrl: scenarioUrl, runtimeEnv });
    await verifyHistoricalRequestSnapshotNull(
      dockerCommand,
      scenario.databaseName
    );
    await verifyRecoveredMigrationProof(dockerCommand, scenario.databaseName);
  }
}

async function seedLegacyTerminatedQuota(dockerCommand) {
  await runPsql(
    dockerCommand,
    LEGACY_DATABASE_NAME,
    `
      INSERT INTO "User" ("id", "name", "updatedAt")
      VALUES ('pfq-legacy-user', '历史终止用户', NOW());
      INSERT INTO "Project" ("id", "code", "name", "updatedAt")
      VALUES ('pfq-legacy-project', 'PFQ-LEGACY', '历史终止项目', NOW());
      INSERT INTO "FileObject" (
        "id", "bucket", "objectKey", "originalName", "mimeType",
        "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
      ) VALUES
        ('pfq-legacy-attachment', 'local-test', 'pfq/legacy/attachment.pdf',
          '历史附件.pdf', 'application/pdf', 128, 'pfq-legacy-user',
          repeat('a', 64), 'active'),
        ('pfq-legacy-signature', 'local-test', 'pfq/legacy/signature.png',
          '历史签名.png', 'image/png', 128, 'pfq-legacy-user',
          repeat('b', 64), 'active');
      INSERT INTO "HandwrittenSignatureVersion" (
        "id", "userId", "fileId", "contentSha256", "source"
      ) VALUES (
        'pfq-legacy-signature-version', 'pfq-legacy-user',
        'pfq-legacy-signature', repeat('b', 64), 'canvas'
      );
      INSERT INTO "ProjectFinancingQuota" (
        "id", "projectId", "amountCents", "reason", "validUntil",
        "attachmentFileId", "attachmentFileSha256Snapshot",
        "requestedByUserId", "requestedByRoleKey",
        "requestIdempotencyKey", "requestFingerprint",
        "approvedByUserId", "approvedAt", "status",
        "terminatedAt", "terminatedByUserId", "terminationReason",
        "terminationSignatureFileId", "terminationSignatureSha256",
        "terminationSignatureVersionId", "updatedAt"
      ) VALUES (
        'pfq-legacy-quota', 'pfq-legacy-project', 1000,
        '历史终止额度', NULL, 'pfq-legacy-attachment', repeat('a', 64),
        'pfq-legacy-user', 'finance_staff',
        '00000000-0000-4000-8000-000000000116', repeat('c', 64),
        'pfq-legacy-user', NOW(), 'terminated', NOW(), 'pfq-legacy-user',
        '历史终止', 'pfq-legacy-signature', repeat('b', 64),
        'pfq-legacy-signature-version', NOW()
      );
    `
  );
}

async function verifyLegacyUpgrade({
  dockerCommand,
  databaseUrl,
  runtimeEnv,
  temporaryRoot
}) {
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    LEGACY_DATABASE_NAME
  ]);
  const pre116Root = await preparePre116MigrationRoot(temporaryRoot);
  const legacyUrl = databaseUrlFor(databaseUrl, LEGACY_DATABASE_NAME);
  await runPrismaMigrate({
    databaseUrl: legacyUrl,
    runtimeEnv,
    schemaPath: path.join(pre116Root, "schema.prisma")
  });
  await seedLegacyTerminatedQuota(dockerCommand);
  await runPrismaMigrate({ databaseUrl: legacyUrl, runtimeEnv });
  const legacy = await runPsql(
    dockerCommand,
    LEGACY_DATABASE_NAME,
    `
      SELECT "status", "terminationActionId" IS NULL,
        "terminationRequestFingerprint" IS NULL, "terminationReason"
      FROM "ProjectFinancingQuota"
      WHERE "id" = 'pfq-legacy-quota';
    `
  );
  if (legacy.stdout.trim() !== "terminated|t|t|历史终止") {
    throw new Error("legacy financing quota termination changed during migration");
  }
  await verifyMigrationProof(dockerCommand, LEGACY_DATABASE_NAME);

  let immutableFailure;
  try {
    await runPsql(
      dockerCommand,
      LEGACY_DATABASE_NAME,
      `UPDATE "ProjectFinancingQuota"
       SET "terminationReason" = '被篡改'
       WHERE "id" = 'pfq-legacy-quota';`
    );
  } catch (error) {
    immutableFailure = error;
  }
  if (
    !immutableFailure ||
    !String(immutableFailure.message).includes(
      "project financing quota termination facts are immutable"
    )
  ) {
    throw new Error("历史终止额度未被 #116 trigger 冻结");
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("项目垫资额度并发门禁止在 production 环境执行");
  }
  await assertMigrationSource();
  const { withGuaranteedCleanup } = require(
    "../dist/database/money-bigint-live-verification"
  );
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const containerName = `jiangkong-pfq-concurrency-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-pfq-concurrency-")
  );
  const databasePassword = `${randomUUID()}${randomUUID()}`;
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  assertDedicatedLocalDatabase(databaseUrl);

  const dockerEnv = createControlledDockerEnv(process.env, temporaryRoot);
  const dockerCommand = (args, options = {}) => {
    const { extraEnv = {}, ...commandOptions } = options;
    return command(docker, withLocalPostgresHost(args), {
      ...commandOptions,
      env: { ...dockerEnv, ...extraEnv }
    });
  };
  dockerCommand.containerName = containerName;
  const runtimeEnv = {
    PATH: process.env.PATH ?? "",
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    COREPACK_HOME: resolveCorepackHome(process.env, temporaryRoot),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    RUN_PROJECT_FINANCING_QUOTA_DATABASE: "1",
    PROJECT_FINANCING_QUOTA_DATABASE_URL: databaseUrl
  };
  const containerLifecycle = {
    localDockerValidated: false,
    containerRunAttempted: false
  };
  const cleanup = createFinancingQuotaRunnerCleanup({
    commandRuntime,
    dockerCommand,
    containerName,
    containerLifecycle,
    temporaryRoot,
    onComplete: () => console.log(
      `清理完成：临时容器 ${containerName} 与临时目录已删除`
    )
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => console.error(message),
      exit: (code) => process.exit(code)
    });
    return interruptionPromise;
  };
  const onSigint = () => void interrupt("SIGINT");
  const onSigterm = () => void interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await withGuaranteedCleanup(async () => {
      assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST ?? "");
      const context = await dockerCommand([
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}"
      ]);
      pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout);
      containerLifecycle.localDockerValidated = true;
      await dockerCommand(["info"]);
      await dockerCommand(["image", "inspect", "postgres:16"]);
      containerLifecycle.containerRunAttempted = true;
      await dockerCommand([
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
        `127.0.0.1:${databasePort}:5432`,
        "postgres:16"
      ], {
        extraEnv: { POSTGRES_PASSWORD: databasePassword },
        forwardOutput: true
      });
      await waitForPostgres(containerName, dockerCommand);

      const firstDeploy = await runPrismaMigrate({ databaseUrl, runtimeEnv });
      const secondDeploy = await runPrismaMigrate({ databaseUrl, runtimeEnv });
      if (!/No pending migrations to apply\.?/u.test(secondDeploy.stdout)) {
        throw new Error("第二次 migrate deploy 未证明零待办");
      }
      const status = await runPrismaStatus({ databaseUrl, runtimeEnv });
      if (!/Database schema is up to date!?/u.test(status.stdout)) {
        throw new Error("migrate status 未证明空库达到当前迁移终点");
      }
      if (
        !firstDeploy.stdout.includes(TERMINAL_MIGRATION) ||
        !firstDeploy.stdout.includes(CURRENT_TERMINAL_MIGRATION)
      ) {
        throw new Error("首次 migrate deploy 未显示额度约束迁移或当前终点迁移");
      }
      await verifyMigrationProof(dockerCommand, DATABASE_NAME);
      await verifyPre115RetainedMigrations({
        dockerCommand,
        databaseUrl,
        runtimeEnv,
        temporaryRoot
      });
      await verifyLegacyUpgrade({
        dockerCommand,
        databaseUrl,
        runtimeEnv,
        temporaryRoot
      });

      await command(
        pnpm,
        [
          "--filter",
          "@jiangkong/api",
          "test",
          "--",
          "--runInBand",
          "src/database/project-financing-quota-concurrency.spec.ts"
        ],
        {
          env: runtimeEnv,
          forwardOutput: true,
          timeoutMs: 15 * 60 * 1000
        }
      );
      console.log(
        `项目垫资额度 F1/F2/F3 PostgreSQL 16 门禁通过：` +
        `applied=${EXPECTED_MIGRATION_COUNT} terminal=1 rolled_back=0 pending=0 ` +
        `pre115_clean=1 pre115_conflict_recovered=${PRE115_CONFLICT_SCENARIOS.length}`
      );
    }, cleanup);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAME,
  CURRENT_TERMINAL_MIGRATION,
  LEGACY_DATABASE_NAME,
  PRE115_MIGRATION_COUNT,
  PRE115_TERMINAL_MIGRATION,
  REQUEST_MIGRATION,
  REQUEST_MIGRATION_CHECKSUM,
  EXPECTED_MIGRATION_COUNT,
  TERMINAL_MIGRATION,
  TERMINAL_MIGRATION_CHECKSUM,
  assertDedicatedLocalDatabase,
  assertLocalDockerEndpoint,
  assertResolvedLocalDockerEndpoint,
  pinResolvedLocalDockerEndpoint,
  createControlledDockerEnv,
  createFinancingQuotaRunnerCleanup,
  preparePre115MigrationRoot,
  preparePre116MigrationRoot
};
