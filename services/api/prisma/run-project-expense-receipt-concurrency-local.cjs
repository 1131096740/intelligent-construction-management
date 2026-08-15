#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm
} = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption,
  withLocalPostgresHost
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME =
  "jiangkong_project_expense_receipt_concurrency";
const EXPECTED_MIGRATION_COUNT = 132;
const LATEST_MIGRATION =
  "20260728160000_project_expense_receipt_confirmation";
const PRE160_TEMPLATE_DATABASE =
  "jiangkong_project_expense_receipt_pre160_template";
const RETAINED_DATABASES = {
  valid: "jiangkong_project_expense_receipt_retained_valid",
  shapeInvalid: "jiangkong_project_expense_receipt_retained_shape",
  businessInvalid:
    "jiangkong_project_expense_receipt_retained_business",
  actorMissing:
    "jiangkong_project_expense_receipt_retained_actor",
  auditMissing:
    "jiangkong_project_expense_receipt_retained_audit_missing",
  auditReverse:
    "jiangkong_project_expense_receipt_retained_audit_reverse",
  auditDuplicate:
    "jiangkong_project_expense_receipt_retained_audit_duplicate",
  lockConflict:
    "jiangkong_project_expense_receipt_retained_lock"
};
const root = path.resolve(__dirname, "../../..");
const migrationsRoot = path.join(__dirname, "migrations");
const pnpm =
  process.env.PNPM_BIN?.trim() ||
  (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function isLocalHostName(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    hostname
  );
}

function assertDedicatedLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("项目支出收货并发验收 DATABASE_URL 不是有效 URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("项目支出收货并发验收只能连接 PostgreSQL");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("项目支出收货并发验收拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出收货并发验收只允许固定一次性数据库");
  }
}

function assertLocalDockerEndpoint(endpoint) {
  const normalized = endpoint.trim().replace(/^"(.*)"$/u, "$1");
  if (
    normalized &&
    !normalized.startsWith("unix://") &&
    !normalized.startsWith("npipe://")
  ) {
    throw new Error(
      `项目支出收货并发验收拒绝远程 Docker endpoint：${normalized}`
    );
  }
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
      const port = typeof address === "object" && address
        ? address.port
        : 0;
      server.close((error) =>
        error ? reject(error) : resolve(port)
      );
    });
  });
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
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("收货并发临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createReceiptConcurrencyCleanup({
  dockerCommand,
  containerName,
  temporaryRoot,
  removeTemporaryRoot = rm,
  onComplete
}) {
  return createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      dockerCommand(["rm", "--force", containerName], {
        timeoutMs: 60_000
      }).catch((error) => {
        if (!String(error?.message).includes("No such container")) {
          throw error;
        }
      }),
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, {
        recursive: true,
        force: true
      }),
    onComplete
  });
}

async function assertMigrationCount() {
  const entries = await readdir(migrationsRoot, {
    withFileTypes: true
  });
  const actual = entries.filter((entry) => entry.isDirectory()).length;
  if (actual !== EXPECTED_MIGRATION_COUNT) {
    throw new Error(
      `收货并发验收要求 ${EXPECTED_MIGRATION_COUNT} 个迁移，当前为 ${actual} 个`
    );
  }
}

function databaseUrlFor(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function preparePre160MigrationRoot(temporaryRoot) {
  const prismaRoot = path.join(temporaryRoot, "pre160-prisma");
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
  const entries = await readdir(migrationsRoot, {
    withFileTypes: true
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === LATEST_MIGRATION) continue;
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(migrations, entry.name),
      { recursive: true }
    );
  }
  return path.join(prismaRoot, "schema.prisma");
}

async function runPrismaMigrate(schemaPath, databaseUrl, runtimeEnv) {
  return command(
    pnpm,
    [
      "--filter",
      "@jiangkong/api",
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      schemaPath
    ],
    {
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    }
  );
}

async function createDatabase(dockerCommand, databaseName, template) {
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    "--template",
    template,
    databaseName
  ]);
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
    "-At",
    "-c",
    sql
  ]);
}

async function capturePostgresLogs(dockerCommand) {
  const result = await dockerCommand([
    "logs",
    dockerCommand.containerName
  ]);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function postgresLogDelta(before, after) {
  if (after.startsWith(before)) return after.slice(before.length);
  return after;
}

function retainedFixtureSql(label, mode) {
  const actor = `receipt_${label}_actor`;
  const applicant = mode === "actorMissing"
    ? `receipt_${label}_missing_actor`
    : actor;
  const request = `receipt_${label}_request`;
  const confirmed = !["shapeInvalid", "auditReverse"].includes(mode);
  const confirmedAt = mode === "shapeInvalid" || confirmed
    ? "'2026-07-31T01:00:00.000Z'"
    : "NULL";
  const confirmedBy = mode === "shapeInvalid"
    ? "NULL"
    : confirmed
      ? `'${applicant}'`
      : "NULL";
  const expenseType = mode === "businessInvalid"
    ? "reimbursement"
    : "spot_purchase";
  const expenseSubtype = mode === "businessInvalid"
    ? "reimbursement"
    : "spot_material_purchase";
  const shouldAudit = mode !== "auditMissing" && mode !== "shapeInvalid";
  const auditConfirmedAt = "2026-07-31T01:00:00.000Z";

  return `
    INSERT INTO "User" (
      "id", "name", "mustChangePassword", "isActive", "updatedAt"
    ) VALUES (
      '${actor}', '收货存量测试人', FALSE, TRUE, CURRENT_TIMESTAMP
    );
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (
      'receipt_${label}_project', 'receipt_${label}_project_code',
      '收货存量项目', CURRENT_TIMESTAMP
    );
    INSERT INTO "ProjectExpenseRequest" (
      "id", "projectId", "code", "expenseType", "expenseSubtype",
      "paymentSubject", "reason", "requestedAmountCents",
      "approvedAmountCents", "paidAmountCents", "paymentMethod",
      "handlerUserId", "applicantUserId", "purchaseExecutedByUserId",
      "purchaseExecutedAt", "receiptConfirmedByUserId",
      "receiptConfirmedAt", "receiptConfirmationNote", "status",
      "updatedAt"
    ) VALUES (
      '${request}', 'receipt_${label}_project', 'receipt_${label}_code',
      '${expenseType}', '${expenseSubtype}', '收货存量测试',
      '迁移闭合验收', 1000, 1000, 1000, 'bank_transfer',
      '${applicant}', '${applicant}', '${applicant}',
      '2026-07-31T00:00:00.000Z', ${confirmedBy}, ${confirmedAt},
      ${confirmed ? "'存量收货'" : "NULL"}, 'paid',
      '2026-07-31T00:30:00.000Z'
    );
    ${shouldAudit ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId",
        "metadata"
      ) VALUES (
        'receipt_${label}_audit', '${applicant}',
        'project_expense.receipt.confirm', 'project_expense_request',
        '${request}', jsonb_build_object(
          'projectId', 'receipt_${label}_project',
          'confirmedAt', '${auditConfirmedAt}'
        )
      );
    ` : ""}
    ${mode === "auditDuplicate" ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId",
        "metadata"
      ) VALUES (
        'receipt_${label}_audit_duplicate', '${applicant}',
        'project_expense.receipt.confirm', 'project_expense_request',
        '${request}', jsonb_build_object(
          'projectId', 'receipt_${label}_project',
          'confirmedAt', '${auditConfirmedAt}'
        )
      );
    ` : ""}
  `;
}

async function expectMigrationFailure({
  databaseName,
  expectedMarker,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const logsBefore = await capturePostgresLogs(dockerCommand);
  let failed = false;
  try {
    await runPrismaMigrate(
      path.join(__dirname, "schema.prisma"),
      databaseUrlFor(databaseUrl, databaseName),
      runtimeEnv
    );
  } catch (error) {
    failed = true;
    const logsAfter = await capturePostgresLogs(dockerCommand);
    const evidence =
      `${String(error)}\n${postgresLogDelta(logsBefore, logsAfter)}`;
    if (!evidence.includes(expectedMarker)) throw error;
  }
  if (!failed) {
    throw new Error(`迁移未按预期失败：${expectedMarker}`);
  }
}

async function assertMigrationRolledBack(dockerCommand, databaseName) {
  const result = await runPsql(
    dockerCommand,
    databaseName,
    `SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'ProjectExpenseRequest'
       AND column_name = 'receiptConfirmationIdempotencyKey'`
  );
  if (result.stdout.trim() !== "0") {
    throw new Error("失败的收货迁移遗留了新字段");
  }
}

async function verifyRetainedMigration({
  dockerCommand,
  databaseUrl,
  temporaryRoot,
  runtimeEnv
}) {
  await createDatabase(
    dockerCommand,
    PRE160_TEMPLATE_DATABASE,
    "template0"
  );
  const pre160Schema = await preparePre160MigrationRoot(temporaryRoot);
  await runPrismaMigrate(
    pre160Schema,
    databaseUrlFor(databaseUrl, PRE160_TEMPLATE_DATABASE),
    runtimeEnv
  );
  for (const databaseName of Object.values(RETAINED_DATABASES)) {
    await createDatabase(
      dockerCommand,
      databaseName,
      PRE160_TEMPLATE_DATABASE
    );
  }

  const scenarios = [
    [RETAINED_DATABASES.valid, "valid", "valid"],
    [RETAINED_DATABASES.shapeInvalid, "shape", "shapeInvalid"],
    [
      RETAINED_DATABASES.businessInvalid,
      "business",
      "businessInvalid"
    ],
    [RETAINED_DATABASES.actorMissing, "actor", "actorMissing"],
    [RETAINED_DATABASES.auditMissing, "audit_missing", "auditMissing"],
    [RETAINED_DATABASES.auditReverse, "audit_reverse", "auditReverse"],
    [
      RETAINED_DATABASES.auditDuplicate,
      "audit_duplicate",
      "auditDuplicate"
    ]
  ];
  for (const [databaseName, label, mode] of scenarios) {
    await runPsql(
      dockerCommand,
      databaseName,
      retainedFixtureSql(label, mode)
    );
  }

  await runPrismaMigrate(
    path.join(__dirname, "schema.prisma"),
    databaseUrlFor(databaseUrl, RETAINED_DATABASES.valid),
    runtimeEnv
  );
  const legacyKey = await runPsql(
    dockerCommand,
    RETAINED_DATABASES.valid,
    `SELECT COALESCE("receiptConfirmationIdempotencyKey", '<NULL>')
     FROM "ProjectExpenseRequest"
     WHERE "id" = 'receipt_valid_request'`
  );
  if (legacyKey.stdout.trim() !== "<NULL>") {
    throw new Error("legacy 收货事实的 NULL 幂等键未原样保留");
  }

  const failures = [
    [RETAINED_DATABASES.shapeInvalid, "project_expense_receipt_shape_invalid"],
    [
      RETAINED_DATABASES.businessInvalid,
      "project_expense_receipt_business_fact_invalid"
    ],
    [RETAINED_DATABASES.actorMissing, "project_expense_receipt_actor_missing"],
    [
      RETAINED_DATABASES.auditMissing,
      "project_expense_receipt_audit_missing_or_mismatch"
    ],
    [
      RETAINED_DATABASES.auditReverse,
      "project_expense_receipt_audit_reverse_mismatch"
    ],
    [
      RETAINED_DATABASES.auditDuplicate,
      "project_expense_receipt_audit_duplicate"
    ]
  ];
  for (const [databaseName, expectedMarker] of failures) {
    await expectMigrationFailure({
      databaseName,
      expectedMarker,
      databaseUrl,
      runtimeEnv,
      dockerCommand
    });
    await assertMigrationRolledBack(dockerCommand, databaseName);
  }

  const writerApplicationName =
    "project-expense-receipt-migration-writer";
  const lockPromise = runPsql(
    dockerCommand,
    RETAINED_DATABASES.lockConflict,
    `BEGIN;
     SET LOCAL application_name = '${writerApplicationName}';
     LOCK TABLE "ProjectExpenseRequest" IN ROW EXCLUSIVE MODE;
     SELECT pg_sleep(8);
     COMMIT;`
  );
  let writerReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const lockResult = await runPsql(
      dockerCommand,
      RETAINED_DATABASES.lockConflict,
      `SELECT COUNT(*)
       FROM pg_stat_activity activity
       JOIN pg_locks held_lock
         ON held_lock.pid = activity.pid
        AND held_lock.locktype = 'relation'
        AND held_lock.granted
       JOIN pg_class relation ON relation.oid = held_lock.relation
       WHERE activity.datname = current_database()
         AND activity.application_name = '${writerApplicationName}'
         AND held_lock.mode = 'RowExclusiveLock'
         AND relation.relname = 'ProjectExpenseRequest'`
    );
    if (Number(lockResult.stdout.trim()) > 0) {
      writerReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!writerReady) {
    await lockPromise.catch(() => undefined);
    throw new Error("项目支出收货迁移锁冲突夹具未就绪");
  }
  await expectMigrationFailure({
    databaseName: RETAINED_DATABASES.lockConflict,
    expectedMarker:
      "project_expense_receipt_migration_requires_quiescence",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await lockPromise;
  await assertMigrationRolledBack(
    dockerCommand,
    RETAINED_DATABASES.lockConflict
  );

  console.log(
    "收货 160000 存量迁移：legacy NULL 保留，六类非法事实与在途 writer 均 fail closed"
  );
}

async function main() {
  await assertMigrationCount();
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-project-expense-receipt-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-project-expense-receipt-")
  );
  const databasePassword = randomUUID();
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  const dockerEnv = createControlledDockerEnv(
    process.env,
    temporaryRoot
  );
  const dockerCommand = (args, options = {}) => {
    const { extraEnv = {}, ...commandOptions } = options;
    return command(docker, withLocalPostgresHost(args), {
      ...commandOptions,
      env: { ...dockerEnv, ...extraEnv }
    });
  };
  dockerCommand.containerName = containerName;
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    RUN_PROJECT_EXPENSE_RECEIPT_CONCURRENCY: "1"
  };
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createReceiptConcurrencyCleanup({
    dockerCommand,
    containerName,
    temporaryRoot,
    onComplete: () =>
      console.log(`清理完成：临时容器 ${containerName} 与临时目录已删除`)
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
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST ?? "");
    const endpoint = await dockerCommand([
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}"
    ]);
    assertLocalDockerEndpoint(endpoint.stdout);
    await dockerCommand(["info"]);
    await dockerCommand(
      [
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
      ],
      {
        extraEnv: { POSTGRES_PASSWORD: databasePassword },
        forwardOutput: true
      }
    );
    await waitForPostgres(containerName, dockerCommand);
    await verifyRetainedMigration({
      dockerCommand,
      databaseUrl,
      temporaryRoot,
      runtimeEnv
    });
    await runPrismaMigrate(
      path.join(__dirname, "schema.prisma"),
      databaseUrl,
      runtimeEnv
    );
    await runPrismaMigrate(
      path.join(__dirname, "schema.prisma"),
      databaseUrl,
      runtimeEnv
    );
    await command(
      pnpm,
      [
        "--filter",
        "@jiangkong/api",
        "test",
        "--",
        "--runInBand",
        "src/database/project-expense-receipt-concurrency.spec.ts"
      ],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    console.log(
      `收货并发不变量已通过 PostgreSQL 16 完整 ${EXPECTED_MIGRATION_COUNT} 迁移验收`
    );
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
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
  EXPECTED_MIGRATION_COUNT,
  assertDedicatedLocalDatabase,
  assertLocalDockerEndpoint,
  createReceiptConcurrencyCleanup,
  verifyRetainedMigration,
  main
};
