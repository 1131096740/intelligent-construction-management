#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { cp, copyFile, mkdir, mkdtemp, readdir, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME = "jiangkong_project_expense_finance_concurrency";
const EXPECTED_MIGRATION_COUNT = 114;
const LATEST_MIGRATION =
  "20260728150000_project_expense_finance_idempotency";
const PRE150_TEMPLATE_DATABASE =
  "jiangkong_project_expense_finance_pre150_template";
const RETAINED_MIGRATION_DATABASES = {
  valid: "jiangkong_project_expense_finance_retained_valid",
  ownerMismatch: "jiangkong_project_expense_finance_retained_owner",
  projectMissing: "jiangkong_project_expense_finance_retained_project_missing",
  sourceMismatch: "jiangkong_project_expense_finance_retained_source",
  amountInvalid: "jiangkong_project_expense_finance_retained_amount",
  statusMismatch: "jiangkong_project_expense_finance_retained_status",
  cumulative: "jiangkong_project_expense_finance_retained_cumulative",
  actorMissing: "jiangkong_project_expense_finance_retained_actor_missing",
  auditMissing: "jiangkong_project_expense_finance_retained_audit_missing",
  auditMismatch: "jiangkong_project_expense_finance_retained_audit_mismatch",
  auditMissingFinanceRecordId:
    "jiangkong_project_expense_finance_retained_audit_missing_finance_id",
  auditOrphanFinanceRecord:
    "jiangkong_project_expense_finance_retained_audit_orphan_finance",
  auditWrongBusiness:
    "jiangkong_project_expense_finance_retained_audit_wrong_business",
  auditDuplicate: "jiangkong_project_expense_finance_retained_audit_duplicate",
  pdfDuplicate: "jiangkong_project_expense_finance_retained_pdf_duplicate",
  lockConflict: "jiangkong_project_expense_finance_retained_lock_conflict"
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
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function assertDedicatedLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("项目支出财务并发验收 DATABASE_URL 不是有效 URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("项目支出财务并发验收只能连接 PostgreSQL 临时数据库");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("项目支出财务并发验收拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出财务并发验收只允许固定的一次性临时数据库");
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
      `项目支出财务并发验收拒绝远程 Docker endpoint：${normalized}`
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
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForPostgres(containerName, dockerCommand) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await dockerCommand(
        [
          "exec",
          containerName,
          "pg_isready",
          "-U",
          "jiangkong",
          "-d",
          DATABASE_NAME
        ],
        { timeoutMs: 15_000 }
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("项目支出财务临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createProjectExpenseFinanceConcurrencyCleanup({
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
        if (!String(error?.message).includes("No such container")) throw error;
      }),
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, { recursive: true, force: true }),
    onComplete
  });
}

async function assertMigrationCount() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const actual = entries.filter((entry) => entry.isDirectory()).length;
  if (actual !== EXPECTED_MIGRATION_COUNT) {
    throw new Error(
      `项目支出财务并发验收要求 ${EXPECTED_MIGRATION_COUNT} 个迁移，当前为 ${actual} 个`
    );
  }
}

function databaseUrlFor(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function preparePre150MigrationRoot(temporaryRoot) {
  const pre150MigrationRoot = path.join(temporaryRoot, "pre150-prisma");
  const pre150Migrations = path.join(pre150MigrationRoot, "migrations");
  await mkdir(pre150Migrations, { recursive: true });
  await copyFile(
    path.join(__dirname, "schema.prisma"),
    path.join(pre150MigrationRoot, "schema.prisma")
  );
  await copyFile(
    path.join(migrationsRoot, "migration_lock.toml"),
    path.join(pre150Migrations, "migration_lock.toml")
  );
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name >= LATEST_MIGRATION) continue;
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(pre150Migrations, entry.name),
      { recursive: true }
    );
  }
  return pre150MigrationRoot;
}

async function runPrismaMigrate({
  databaseUrl,
  runtimeEnv,
  schemaPath,
  forwardOutput = true
}) {
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
    forwardOutput,
    timeoutMs: 15 * 60 * 1000
  });
}

async function resolveLatestMigrationAsRolledBack({ databaseUrl, runtimeEnv }) {
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
      LATEST_MIGRATION
    ],
    {
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function createDatabaseFromTemplate(
  dockerCommand,
  templateDatabase,
  databaseName
) {
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    "--template",
    templateDatabase,
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

function retainedFixtureSql(
  label,
  {
    ownerMismatch = false,
    projectMissing = false,
    sourceMismatch = false,
    amountInvalid = false,
    statusMismatch = false,
    cumulativeExceedsPaid = false,
    actorMissing = false,
    auditMissing = false,
    auditMismatch = false,
    auditMissingFinanceRecordId = false,
    auditOrphanFinanceRecord = false,
    auditWrongBusiness = false,
    auditDuplicate = false,
    pdfDuplicate = false,
    paymentBlocked = false
  } = {}
) {
  const prefix = `finance_${label}`;
  const requestStatus = statusMismatch
    ? "approved_pending_payment"
    : paymentBlocked
      ? "payment_blocked"
      : "partially_paid";
  const paidAmount = statusMismatch ? 0 : cumulativeExceedsPaid ? 400 : 500;
  const financeAmount = amountInvalid ? -1 : cumulativeExceedsPaid ? 500 : 400;
  const financeProjectId = ownerMismatch
    ? `${prefix}_other_project`
    : `${prefix}_project`;
  const direction = sourceMismatch ? "inflow" : "outflow";
  const auditSql = auditMissing
    ? ""
    : `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit', '${prefix}_finance_user',
        'project_expense.finance.record', 'project_expense_request',
        '${prefix}_request', jsonb_build_object(
          'projectId', '${prefix}_project',
          'financeRecordId', '${prefix}_finance_record',
          'amountCents', '${auditMismatch ? 399 : financeAmount}'
        )
      );
    `;
  const pdfSql = pdfDuplicate
    ? `
      INSERT INTO "PdfDocument" (
        "id", "businessType", "businessId", "fileId", "templateKey"
      ) VALUES
        ('${prefix}_pdf_1', 'project_expense_request', '${prefix}_request',
          '${prefix}_pdf_file_1', 'project_expense_finance_archive'),
        ('${prefix}_pdf_2', 'project_expense_request', '${prefix}_request',
          '${prefix}_pdf_file_2', 'project_expense_finance_archive');
    `
    : "";
  const duplicateAuditSql = auditDuplicate
    ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit_duplicate', '${prefix}_finance_user',
        'project_expense.finance.record', 'project_expense_request',
        '${prefix}_request', jsonb_build_object(
          'projectId', '${prefix}_project',
          'financeRecordId', '${prefix}_finance_record',
          'amountCents', '${financeAmount}'
        )
      );
    `
    : "";
  const reverseMismatchAuditSql = auditMissingFinanceRecordId
    ? `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit_missing_finance_id', '${prefix}_finance_user',
        'project_expense.finance.record', 'project_expense_request',
        '${prefix}_request', jsonb_build_object(
          'amountCents', '${financeAmount}'
        )
      );
    `
    : auditOrphanFinanceRecord
      ? `
        INSERT INTO "AuditLog" (
          "id", "actorUserId", "action", "businessType", "businessId", "metadata"
        ) VALUES (
          '${prefix}_audit_orphan_finance', '${prefix}_finance_user',
          'project_expense.finance.record', 'project_expense_request',
          '${prefix}_request', jsonb_build_object(
            'financeRecordId', '${prefix}_missing_finance_record',
            'amountCents', '${financeAmount}'
          )
        );
      `
      : auditWrongBusiness
        ? `
          INSERT INTO "AuditLog" (
            "id", "actorUserId", "action", "businessType", "businessId", "metadata"
          ) VALUES (
            '${prefix}_audit_wrong_business', '${prefix}_finance_user',
            'project_expense.finance.record', 'project_expense_request',
            '${prefix}_wrong_request', jsonb_build_object(
              'financeRecordId', '${prefix}_finance_record',
              'amountCents', '${financeAmount}'
            )
          );
        `
        : "";
  const dropAmountConstraint = amountInvalid
    ? 'ALTER TABLE "FinanceRecord" DROP CONSTRAINT "FinanceRecord_amount_positive_check";'
    : "";
  const orphanProjectSql = projectMissing
    ? `
      SET LOCAL session_replication_role = replica;
      DELETE FROM "Project" WHERE "id" = '${prefix}_project';
      SET LOCAL session_replication_role = origin;
    `
    : "";
  const orphanActorSql = actorMissing
    ? `
      SET LOCAL session_replication_role = replica;
      DELETE FROM "User" WHERE "id" = '${prefix}_finance_user';
      SET LOCAL session_replication_role = origin;
    `
    : "";

  return `
    ${dropAmountConstraint}
    BEGIN;
    INSERT INTO "User" (
      "id", "name", "mustChangePassword", "isActive", "updatedAt"
    ) VALUES (
      '${prefix}_finance_user', '存量项目支出财务人员', FALSE, TRUE,
      CURRENT_TIMESTAMP
    );
    INSERT INTO "Project" ("id", "code", "name", "updatedAt") VALUES
      ('${prefix}_project', '${prefix}_project_code', '存量项目支出财务项目', CURRENT_TIMESTAMP),
      ('${prefix}_other_project', '${prefix}_other_project_code', '存量其他项目', CURRENT_TIMESTAMP);
    INSERT INTO "ProjectExpenseRequest" (
      "id", "projectId", "code", "expenseType", "expenseSubtype",
      "paymentSubject", "reason", "requestedAmountCents",
      "approvedAmountCents", "paidAmountCents", "paymentMethod",
      "handlerUserId", "applicantUserId", "status", "updatedAt"
    ) VALUES (
      '${prefix}_request', '${prefix}_project', '${prefix}_request_code',
      'comprehensive_expense', 'travel', '存量项目支出财务',
      '存量迁移验收', 1000, 1000, ${paidAmount}, 'bank_transfer',
      '${prefix}_finance_user', '${prefix}_finance_user', '${requestStatus}',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "FinanceRecord" (
      "id", "projectId", "projectExpenseRequestId", "direction",
      "amountCents", "occurredAt", "createdByUserId"
    ) VALUES (
      '${prefix}_finance_record', '${financeProjectId}', '${prefix}_request',
      '${direction}', ${financeAmount}, '2026-07-31T00:00:00.000Z',
      '${prefix}_finance_user'
    );
    ${auditSql}
    ${reverseMismatchAuditSql}
    ${duplicateAuditSql}
    ${pdfSql}
    ${orphanProjectSql}
    ${orphanActorSql}
    COMMIT;
  `;
}

async function assertMigrationRolledBack(dockerCommand, databaseName) {
  const result = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT (
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceRecord'
          AND column_name = 'idempotencyKey'
      ) + (
        SELECT COUNT(*)
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname IN (
            'FinanceRecord_idempotencyKey_key',
            'AuditLog_project_expense_finance_record_key',
            'PdfDocument_project_expense_finance_archive_key'
          )
      ) + (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'FinanceRecord_project_expense_owner_fk',
          'FinanceRecord_createdByUserId_fkey',
          'FinanceRecord_project_expense_idempotency_key_format_check',
          'FinanceRecord_project_expense_source_check',
          'FinanceRecord_project_expense_amount_positive_check'
        )
      ) + (
        SELECT COUNT(*)
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname IN (
            'guard_project_expense_finance_insert',
            'guard_project_expense_finance_immutable',
            'validate_project_expense_finance_closed_fact',
            'validate_project_expense_finance_audit_fact',
            'guard_project_expense_finance_audit_immutable',
            'guard_project_expense_finance_parent_projection'
          )
      ) + (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE tgname IN (
          'FinanceRecord_project_expense_insert_guard',
          'FinanceRecord_project_expense_immutable',
          'FinanceRecord_project_expense_closed_fact_guard',
          'AuditLog_project_expense_finance_closed_fact_guard',
          'AuditLog_project_expense_finance_immutable',
          'ProjectExpenseRequest_finance_projection_guard'
        )
          AND NOT tgisinternal
      );
    `
  );
  if (result.stdout.trim() !== "0") {
    throw new Error(
      `存量项目支出财务迁移失败后未完整回滚：${databaseName} 仍存在新对象`
    );
  }
}

async function failedMigrationEvidence(dockerCommand, databaseName) {
  return runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT COALESCE("logs", '')
      FROM "_prisma_migrations"
      WHERE "migration_name" = '${LATEST_MIGRATION}'
      ORDER BY "started_at" DESC
      LIMIT 1;
    `
  );
}

async function expectRetainedMigrationFailure({
  databaseName,
  expectedMarker,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const postgresLogBefore = await capturePostgresLogs(dockerCommand);
  let failure;
  try {
    await runPrismaMigrate({
      databaseUrl: databaseUrlFor(databaseUrl, databaseName),
      runtimeEnv,
      forwardOutput: false
    });
  } catch (error) {
    failure = error;
  }
  const migrationLog = await failedMigrationEvidence(dockerCommand, databaseName);
  const postgresLogAfter = await capturePostgresLogs(dockerCommand);
  const evidence = [
    failure instanceof Error ? failure.message : "",
    migrationLog.stdout,
    migrationLog.stderr,
    postgresLogDelta(postgresLogBefore, postgresLogAfter)
  ].join("\n");
  if (!failure || !evidence.includes(expectedMarker)) {
    throw new Error(
      `存量项目支出财务迁移未以 ${expectedMarker} 拒绝 ${databaseName}：${evidence}`
    );
  }
  await assertMigrationRolledBack(dockerCommand, databaseName);
}

async function verifyValidLegacy({
  databaseName,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  await runPrismaMigrate({
    databaseUrl: databaseUrlFor(databaseUrl, databaseName),
    runtimeEnv,
    forwardOutput: false
  });
  const result = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT COUNT(*)::text || '|' ||
        COUNT(*) FILTER (WHERE "idempotencyKey" IS NULL)::text || '|' ||
        COALESCE(SUM("amountCents"), 0)::text
      FROM "FinanceRecord"
      WHERE "projectExpenseRequestId" = 'finance_valid_request';
    `
  );
  if (result.stdout.trim() !== "1|1|400") {
    throw new Error(
      `合法 legacy 项目支出财务事实未原样保留：${result.stdout.trim()}`
    );
  }
}

async function verifyFailedMigrationRecovery({
  databaseName,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const targetDatabaseUrl = databaseUrlFor(databaseUrl, databaseName);
  await resolveLatestMigrationAsRolledBack({
    databaseUrl: targetDatabaseUrl,
    runtimeEnv
  });
  await runPsql(
    dockerCommand,
    databaseName,
    `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId", "metadata"
      ) VALUES (
        'finance_audit_missing_recovery', 'finance_auditMissing_finance_user',
        'project_expense.finance.record', 'project_expense_request',
        'finance_auditMissing_request', jsonb_build_object(
          'financeRecordId', 'finance_auditMissing_finance_record',
          'amountCents', '400'
        )
      );
    `
  );
  await runPrismaMigrate({
    databaseUrl: targetDatabaseUrl,
    runtimeEnv,
    forwardOutput: false
  });
  const recovery = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        COUNT(*) FILTER (WHERE "rolled_back_at" IS NOT NULL)::text || '|' ||
        COUNT(*) FILTER (WHERE "finished_at" IS NOT NULL)::text || '|' ||
        (
          SELECT CASE WHEN "idempotencyKey" IS NULL THEN 'legacy-null' ELSE 'changed' END
          FROM "FinanceRecord"
          WHERE "id" = 'finance_auditMissing_finance_record'
        )
      FROM "_prisma_migrations"
      WHERE "migration_name" = '${LATEST_MIGRATION}';
    `
  );
  if (recovery.stdout.trim() !== "1|1|legacy-null") {
    throw new Error(
      `项目支出财务失败迁移 resolve/retry 证据不完整：${recovery.stdout.trim()}`
    );
  }
}

async function verifyMigrationRequiresQuiescence({
  databaseName,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const writerApplicationName = "project-expense-finance-migration-writer";
  const writer = runPsql(
    dockerCommand,
    databaseName,
    `
      BEGIN;
      SET LOCAL application_name = '${writerApplicationName}';
      LOCK TABLE "FinanceRecord" IN ROW EXCLUSIVE MODE;
      SELECT pg_sleep(5);
      COMMIT;
    `
  );

  let writerReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const lockResult = await runPsql(
      dockerCommand,
      databaseName,
      `
        SELECT COUNT(*)
        FROM pg_stat_activity activity
        JOIN pg_locks held_lock
          ON held_lock.pid = activity.pid
         AND held_lock.locktype = 'relation'
         AND held_lock.granted
        JOIN pg_class relation ON relation.oid = held_lock.relation
        WHERE activity.datname = current_database()
          AND activity.application_name = '${writerApplicationName}'
          AND relation.relname = 'FinanceRecord';
      `
    );
    if (Number(lockResult.stdout.trim()) > 0) {
      writerReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!writerReady) {
    await writer.catch(() => undefined);
    throw new Error("项目支出财务迁移锁冲突夹具未就绪");
  }

  await expectRetainedMigrationFailure({
    databaseName,
    expectedMarker: "project_expense_finance_migration_requires_quiescence",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await writer;
}

async function verifyRetainedMigration({
  dockerCommand,
  databaseUrl,
  temporaryRoot,
  runtimeEnv
}) {
  const pre150MigrationRoot = await preparePre150MigrationRoot(temporaryRoot);
  const pre150SchemaPath = path.join(pre150MigrationRoot, "schema.prisma");
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    PRE150_TEMPLATE_DATABASE
  ]);
  await runPrismaMigrate({
    databaseUrl: databaseUrlFor(databaseUrl, PRE150_TEMPLATE_DATABASE),
    runtimeEnv,
    schemaPath: pre150SchemaPath
  });

  for (const databaseName of Object.values(RETAINED_MIGRATION_DATABASES)) {
    await createDatabaseFromTemplate(
      dockerCommand,
      PRE150_TEMPLATE_DATABASE,
      databaseName
    );
  }

  const scenarios = [
    [RETAINED_MIGRATION_DATABASES.valid, "valid", { paymentBlocked: true }],
    [RETAINED_MIGRATION_DATABASES.ownerMismatch, "ownerMismatch", { ownerMismatch: true }],
    [RETAINED_MIGRATION_DATABASES.projectMissing, "projectMissing", { projectMissing: true }],
    [RETAINED_MIGRATION_DATABASES.sourceMismatch, "sourceMismatch", { sourceMismatch: true }],
    [RETAINED_MIGRATION_DATABASES.amountInvalid, "amountInvalid", { amountInvalid: true }],
    [RETAINED_MIGRATION_DATABASES.statusMismatch, "statusMismatch", { statusMismatch: true }],
    [RETAINED_MIGRATION_DATABASES.cumulative, "cumulative", { cumulativeExceedsPaid: true }],
    [RETAINED_MIGRATION_DATABASES.actorMissing, "actorMissing", { actorMissing: true }],
    [RETAINED_MIGRATION_DATABASES.auditMissing, "auditMissing", { auditMissing: true }],
    [RETAINED_MIGRATION_DATABASES.auditMismatch, "auditMismatch", { auditMismatch: true }],
    [RETAINED_MIGRATION_DATABASES.auditMissingFinanceRecordId, "auditMissingFinanceRecordId", { auditMissingFinanceRecordId: true }],
    [RETAINED_MIGRATION_DATABASES.auditOrphanFinanceRecord, "auditOrphanFinanceRecord", { auditOrphanFinanceRecord: true }],
    [RETAINED_MIGRATION_DATABASES.auditWrongBusiness, "auditWrongBusiness", { auditWrongBusiness: true }],
    [RETAINED_MIGRATION_DATABASES.auditDuplicate, "auditDuplicate", { auditDuplicate: true }],
    [RETAINED_MIGRATION_DATABASES.pdfDuplicate, "pdfDuplicate", { pdfDuplicate: true }],
    [RETAINED_MIGRATION_DATABASES.lockConflict, "lockConflict", {}]
  ];
  for (const [databaseName, label, options] of scenarios) {
    await runPsql(
      dockerCommand,
      databaseName,
      retainedFixtureSql(label, options)
    );
  }

  await verifyValidLegacy({
    databaseName: RETAINED_MIGRATION_DATABASES.valid,
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });

  const failures = [
    [RETAINED_MIGRATION_DATABASES.ownerMismatch, "project_expense_finance_request_owner_mismatch"],
    [RETAINED_MIGRATION_DATABASES.projectMissing, "project_expense_finance_request_owner_mismatch"],
    [RETAINED_MIGRATION_DATABASES.sourceMismatch, "project_expense_finance_source_direction_mismatch"],
    [RETAINED_MIGRATION_DATABASES.amountInvalid, "project_expense_finance_amount_invalid"],
    [RETAINED_MIGRATION_DATABASES.statusMismatch, "project_expense_finance_request_status_mismatch"],
    [RETAINED_MIGRATION_DATABASES.cumulative, "project_expense_finance_cumulative_exceeds_paid"],
    [RETAINED_MIGRATION_DATABASES.actorMissing, "project_expense_finance_actor_missing"],
    [RETAINED_MIGRATION_DATABASES.auditMissing, "project_expense_finance_audit_missing"],
    [RETAINED_MIGRATION_DATABASES.auditMismatch, "project_expense_finance_audit_mismatch"],
    [RETAINED_MIGRATION_DATABASES.auditMissingFinanceRecordId, "project_expense_finance_audit_reverse_mismatch"],
    [RETAINED_MIGRATION_DATABASES.auditOrphanFinanceRecord, "project_expense_finance_audit_reverse_mismatch"],
    [RETAINED_MIGRATION_DATABASES.auditWrongBusiness, "project_expense_finance_audit_reverse_mismatch"],
    [RETAINED_MIGRATION_DATABASES.auditDuplicate, "project_expense_finance_audit_duplicate"],
    [RETAINED_MIGRATION_DATABASES.pdfDuplicate, "project_expense_finance_pdf_duplicate"]
  ];
  for (const [databaseName, expectedMarker] of failures) {
    await expectRetainedMigrationFailure({
      databaseName,
      expectedMarker,
      databaseUrl,
      runtimeEnv,
      dockerCommand
    });
  }

  await verifyMigrationRequiresQuiescence({
    databaseName: RETAINED_MIGRATION_DATABASES.lockConflict,
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await verifyFailedMigrationRecovery({
    databaseName: RETAINED_MIGRATION_DATABASES.auditMissing,
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  console.log(
    "项目支出财务 150000 存量迁移：legacy NULL 原样保留，十四类非法事实和在途 writer 均失败回滚，resolve/retry 成功"
  );
}

async function main() {
  await assertMigrationCount();
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-project-expense-finance-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-project-expense-finance-")
  );
  const databasePassword = randomUUID();
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  const dockerEnv = createControlledDockerEnv(process.env, temporaryRoot);
  const dockerCommand = (args, options = {}) => {
    const { extraEnv = {}, ...commandOptions } = options;
    return command(docker, args, {
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
    RUN_PROJECT_EXPENSE_FINANCE_CONCURRENCY: "1"
  };
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createProjectExpenseFinanceConcurrencyCleanup({
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
    const dockerEndpoint = await dockerCommand([
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}"
    ]);
    assertLocalDockerEndpoint(dockerEndpoint.stdout);
    await dockerCommand(["info"]);
    await dockerCommand(
      [
        "run",
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
    console.log(
      `临时 PostgreSQL 16 已就绪：${containerName}` +
        `（${DATABASE_NAME}，仅 127.0.0.1）`
    );

    await verifyRetainedMigration({
      dockerCommand,
      databaseUrl,
      temporaryRoot,
      runtimeEnv
    });
    await runPrismaMigrate({ databaseUrl, runtimeEnv });
    await runPrismaMigrate({ databaseUrl, runtimeEnv });
    await command(
      pnpm,
      ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"],
      { env: runtimeEnv, forwardOutput: true }
    );
    await command(
      pnpm,
      ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      { env: runtimeEnv, forwardOutput: true, timeoutMs: 15 * 60 * 1000 }
    );
    await command(
      pnpm,
      [
        "--filter",
        "@jiangkong/api",
        "test",
        "--",
        "--runInBand",
        "src/database/project-expense-finance-concurrency.spec.ts"
      ],
      { env: runtimeEnv, forwardOutput: true, timeoutMs: 15 * 60 * 1000 }
    );
    console.log(
      `项目支出财务并发不变量已通过空库、no-op 与完整 ${EXPECTED_MIGRATION_COUNT} 迁移验收`
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
  createProjectExpenseFinanceConcurrencyCleanup,
  verifyRetainedMigration,
  main
};
