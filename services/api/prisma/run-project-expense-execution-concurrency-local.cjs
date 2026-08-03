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
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME =
  "jiangkong_project_expense_execution_concurrency";
const EXPECTED_MIGRATION_COUNT = 118;
const LATEST_MIGRATION =
  "20260728140000_project_expense_execution_idempotency";
const PRE140_TEMPLATE_DATABASE =
  "jiangkong_project_expense_execution_pre140_template";
const RETAINED_MIGRATION_DATABASES = {
  valid: "jiangkong_project_expense_execution_retained_valid",
  duplicateVoucher:
    "jiangkong_project_expense_execution_retained_duplicate_voucher",
  voucherOwner:
    "jiangkong_project_expense_execution_retained_voucher_owner",
  requestOwner:
    "jiangkong_project_expense_execution_retained_request_owner",
  paidMismatch:
    "jiangkong_project_expense_execution_retained_paid_mismatch",
  statusMismatch:
    "jiangkong_project_expense_execution_retained_status_mismatch",
  fundingMissing:
    "jiangkong_project_expense_execution_retained_funding_missing",
  fundingMismatch:
    "jiangkong_project_expense_execution_retained_funding_mismatch",
  fundingOrphan:
    "jiangkong_project_expense_execution_retained_funding_orphan",
  fundingReversal:
    "jiangkong_project_expense_execution_retained_funding_reversal",
  crossProjectQuota:
    "jiangkong_project_expense_execution_retained_cross_project_quota",
  auditMissing:
    "jiangkong_project_expense_execution_retained_audit_missing",
  auditMismatch:
    "jiangkong_project_expense_execution_retained_audit_mismatch",
  crossBusinessVoucher:
    "jiangkong_project_expense_execution_retained_cross_business_voucher",
  lockConflict:
    "jiangkong_project_expense_execution_retained_lock_conflict"
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
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertDedicatedLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("项目支出实付并发验收 DATABASE_URL 不是有效 URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("项目支出实付并发验收只能连接 PostgreSQL 临时数据库");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("项目支出实付并发验收拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出实付并发验收只允许固定的一次性临时数据库");
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
      `项目支出实付并发验收拒绝远程 Docker endpoint：${normalized}`
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
      const port =
        typeof address === "object" && address ? address.port : 0;
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
  throw new Error("项目支出实付临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createProjectExpenseExecutionConcurrencyCleanup({
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
      removeTemporaryRoot(temporaryRoot, {
        recursive: true,
        force: true
      }),
    onComplete
  });
}

async function assertMigrationCount() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const actual = entries.filter((entry) => entry.isDirectory()).length;
  if (actual !== EXPECTED_MIGRATION_COUNT) {
    throw new Error(
      `项目支出实付并发验收要求 ${EXPECTED_MIGRATION_COUNT} 个迁移，当前为 ${actual} 个`
    );
  }
}

function databaseUrlFor(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function preparePre140MigrationRoot(temporaryRoot) {
  const pre140MigrationRoot = path.join(temporaryRoot, "pre140-prisma");
  const pre140Migrations = path.join(pre140MigrationRoot, "migrations");
  await mkdir(pre140Migrations, { recursive: true });
  await copyFile(
    path.join(__dirname, "schema.prisma"),
    path.join(pre140MigrationRoot, "schema.prisma")
  );
  await copyFile(
    path.join(migrationsRoot, "migration_lock.toml"),
    path.join(pre140Migrations, "migration_lock.toml")
  );
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name >= LATEST_MIGRATION) continue;
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(pre140Migrations, entry.name),
      { recursive: true }
    );
  }
  return pre140MigrationRoot;
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

async function resolveLatestMigrationAsRolledBack({
  databaseUrl,
  runtimeEnv
}) {
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
    duplicateVoucher = false,
    voucherOwnerMismatch = false,
    requestOwnerMismatch = false,
    paidMismatch = false,
    statusMismatch = false,
    fundingAllocationMissing = false,
    fundingAllocationMismatch = false,
    orphanFundingAllocation = false,
    fundingReversal = false,
    crossProjectQuota = false,
    auditMissing = false,
    auditMismatch = false,
    crossBusinessVoucher = false,
    includePaymentBlockedRetained = false
  } = {}
) {
  const prefix = `retained_${label}`;
  const requestPaidAmount = duplicateVoucher ? 800 : paidMismatch ? 500 : 400;
  const requestStatus = statusMismatch ? "approved_pending_payment" : "partially_paid";
  const executionProjectId = requestOwnerMismatch
    ? `${prefix}_other_project`
    : `${prefix}_project`;
  const voucherUploaderId = voucherOwnerMismatch
    ? `${prefix}_other_user`
    : `${prefix}_executor`;
  const crossProjectQuotaSetupSql = crossProjectQuota
    ? `
      INSERT INTO "FileObject" (
        "id", "bucket", "objectKey", "originalName", "mimeType",
        "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
      ) VALUES (
        '${prefix}_quota_attachment', 'local-private',
        '${prefix}/quota-attachment.pdf',
        '跨项目垫资额度依据.pdf', 'application/pdf', 128,
        '${prefix}_executor', '${"c".repeat(64)}', 'active'
      );
      INSERT INTO "ProjectFinancingQuota" (
        "id", "projectId", "amountCents", "reason", "attachmentFileId",
        "requestedByUserId", "approvedByUserId", "approvedAt", "status",
        "updatedAt"
      ) VALUES (
        '${prefix}_other_quota', '${prefix}_other_project', 1000,
        '跨项目垫资负向迁移夹具', '${prefix}_quota_attachment',
        '${prefix}_executor', '${prefix}_executor', CURRENT_TIMESTAMP,
        'approved', CURRENT_TIMESTAMP
      );
    `
    : "";
  const fundingSql = fundingAllocationMissing
    ? ""
    : `
      INSERT INTO "ProjectFundingAllocation" (
        "id", "projectId", "executionType", "executionId",
        "businessType", "businessId", "sourceType", "sourceKey",
        "sourceId", "direction", "amountCents", "occurredAt",
        "createdByUserId", "reversalOfAllocationId", "reversalKey"
      ) VALUES (
        '${prefix}_funding', '${executionProjectId}',
        'project_expense_execution', '${prefix}_execution',
        'project_expense_request', '${prefix}_request',
        '${crossProjectQuota ? "financing_quota" : "project_cash"}',
        '${
          crossProjectQuota
            ? `financing_quota:${prefix}_other_quota`
            : "project_cash"
        }',
        ${crossProjectQuota ? `'${prefix}_other_quota'` : "NULL"}, 'debit',
        ${fundingAllocationMismatch ? 399 : 400},
        '2026-07-30T00:00:00.000Z', '${prefix}_executor',
        NULL, 'original'
      );
    `;
  const orphanFundingSql = orphanFundingAllocation
    ? `
      INSERT INTO "ProjectFundingAllocation" (
        "id", "projectId", "executionType", "executionId",
        "businessType", "businessId", "sourceType", "sourceKey",
        "sourceId", "direction", "amountCents", "occurredAt",
        "createdByUserId", "reversalOfAllocationId", "reversalKey"
      ) VALUES (
        '${prefix}_orphan_funding', '${prefix}_project',
        'project_expense_execution', '${prefix}_missing_execution',
        'project_expense_request', '${prefix}_request',
        'project_cash', 'project_cash', NULL, 'debit', 1,
        '2026-07-30T00:00:00.000Z', '${prefix}_executor',
        NULL, 'original'
      );
    `
    : "";
  const fundingReversalSql = fundingReversal
    ? `
      INSERT INTO "ProjectFundingAllocation" (
        "id", "projectId", "executionType", "executionId",
        "businessType", "businessId", "sourceType", "sourceKey",
        "sourceId", "direction", "amountCents", "occurredAt",
        "createdByUserId", "reversalOfAllocationId", "reversalKey", "reason"
      ) VALUES (
        '${prefix}_funding_reversal', '${prefix}_project',
        'project_expense_execution', '${prefix}_execution',
        'project_expense_request', '${prefix}_request',
        'project_cash', 'project_cash', NULL, 'credit', 1,
        '2026-07-30T01:00:00.000Z', '${prefix}_executor',
        '${prefix}_funding', 'retained-reversal',
        '项目支出无业务更正事实的反向资金负向夹具'
      );
    `
    : "";
  const auditSql = auditMissing
    ? ""
    : `
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType",
        "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit', '${prefix}_executor',
        'project_expense.execution.record',
        'project_expense_request', '${prefix}_request',
        jsonb_build_object(
          'executionId', '${prefix}_execution',
          'amountCents', '${auditMismatch ? 399 : 400}',
          'voucherFileId', '${prefix}_voucher'
        )
      );
    `;
  const duplicateSql = duplicateVoucher
    ? `
      INSERT INTO "ProjectExpenseExecution" (
        "id", "projectExpenseRequestId", "projectId", "amountCents",
        "paidAt", "executedByUserId", "voucherFileId"
      ) VALUES (
        '${prefix}_execution_2', '${prefix}_request', '${prefix}_project', 400,
        '2026-07-30T00:00:00.000Z', '${prefix}_executor', '${prefix}_voucher'
      );
      INSERT INTO "ProjectFundingAllocation" (
        "id", "projectId", "executionType", "executionId",
        "businessType", "businessId", "sourceType", "sourceKey",
        "sourceId", "direction", "amountCents", "occurredAt",
        "createdByUserId", "reversalOfAllocationId", "reversalKey"
      ) VALUES (
        '${prefix}_funding_2', '${prefix}_project',
        'project_expense_execution', '${prefix}_execution_2',
        'project_expense_request', '${prefix}_request',
        'project_cash', 'project_cash', NULL, 'debit', 400,
        '2026-07-30T00:00:00.000Z', '${prefix}_executor', NULL, 'original'
      );
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType",
        "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit_2', '${prefix}_executor',
        'project_expense.execution.record',
        'project_expense_request', '${prefix}_request',
        jsonb_build_object(
          'executionId', '${prefix}_execution_2',
          'amountCents', '400',
          'voucherFileId', '${prefix}_voucher'
        )
      );
    `
    : "";
  const crossBindingSql = crossBusinessVoucher
    ? `
      INSERT INTO "ArchiveRecord" (
        "id", "businessType", "businessId", "fileId", "departmentScope"
      ) VALUES (
        '${prefix}_archive', 'retained_fixture', '${prefix}_request',
        '${prefix}_voucher', 'finance'
      );
    `
    : "";
  const paymentBlockedSql = includePaymentBlockedRetained
    ? `
      INSERT INTO "FileObject" (
        "id", "bucket", "objectKey", "originalName", "mimeType",
        "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
      ) VALUES (
        '${prefix}_blocked_voucher', 'local-private',
        '${prefix}/blocked-voucher.pdf',
        '付款阻断前存量实付凭证.pdf', 'application/pdf', 128,
        '${prefix}_executor', '${"b".repeat(64)}', 'active'
      );
      INSERT INTO "ProjectExpenseRequest" (
        "id", "projectId", "code", "expenseType", "expenseSubtype",
        "paymentSubject", "reason", "requestedAmountCents",
        "approvedAmountCents", "paidAmountCents", "paymentMethod",
        "handlerUserId", "applicantUserId", "status", "updatedAt"
      ) VALUES (
        '${prefix}_blocked_request', '${prefix}_project',
        '${prefix}_blocked_request_code',
        'comprehensive_expense', 'travel', '付款阻断前存量实付',
        '存量迁移验收', 1000, 1000, 400,
        'bank_transfer', '${prefix}_executor', '${prefix}_executor',
        'payment_blocked', CURRENT_TIMESTAMP
      );
      INSERT INTO "ProjectExpenseExecution" (
        "id", "projectExpenseRequestId", "projectId", "amountCents",
        "paidAt", "executedByUserId", "voucherFileId"
      ) VALUES (
        '${prefix}_blocked_execution', '${prefix}_blocked_request',
        '${prefix}_project', 400, '2026-07-29T00:00:00.000Z',
        '${prefix}_executor', '${prefix}_blocked_voucher'
      );
      INSERT INTO "ProjectFundingAllocation" (
        "id", "projectId", "executionType", "executionId",
        "businessType", "businessId", "sourceType", "sourceKey",
        "sourceId", "direction", "amountCents", "occurredAt",
        "createdByUserId", "reversalOfAllocationId", "reversalKey"
      ) VALUES (
        '${prefix}_blocked_funding', '${prefix}_project',
        'project_expense_execution', '${prefix}_blocked_execution',
        'project_expense_request', '${prefix}_blocked_request',
        'project_cash', 'project_cash', NULL, 'debit', 400,
        '2026-07-29T00:00:00.000Z', '${prefix}_executor',
        NULL, 'original'
      );
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType",
        "businessId", "metadata"
      ) VALUES (
        '${prefix}_blocked_audit', '${prefix}_executor',
        'project_expense.execution.record',
        'project_expense_request', '${prefix}_blocked_request',
        jsonb_build_object(
          'executionId', '${prefix}_blocked_execution',
          'amountCents', '400',
          'voucherFileId', '${prefix}_blocked_voucher'
        )
      );
    `
    : "";

  return `
    BEGIN;
    INSERT INTO "User" (
      "id", "name", "mustChangePassword", "isActive", "updatedAt"
    ) VALUES
      ('${prefix}_executor', '存量项目支出实付人', FALSE, TRUE, CURRENT_TIMESTAMP),
      ('${prefix}_other_user', '存量其他用户', FALSE, TRUE, CURRENT_TIMESTAMP);
    INSERT INTO "Project" ("id", "code", "name", "updatedAt") VALUES
      ('${prefix}_project', '${prefix}_project_code', '存量项目支出项目', CURRENT_TIMESTAMP),
      ('${prefix}_other_project', '${prefix}_other_project_code', '存量其他项目', CURRENT_TIMESTAMP);
    INSERT INTO "FileObject" (
      "id", "bucket", "objectKey", "originalName", "mimeType",
      "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
    ) VALUES (
      '${prefix}_voucher', 'local-private', '${prefix}/voucher.pdf',
      '存量项目支出凭证.pdf', 'application/pdf', 128,
      '${voucherUploaderId}', '${"a".repeat(64)}', 'active'
    );
    ${crossProjectQuotaSetupSql}
    INSERT INTO "ProjectExpenseRequest" (
      "id", "projectId", "code", "expenseType", "expenseSubtype",
      "paymentSubject", "reason", "requestedAmountCents",
      "approvedAmountCents", "paidAmountCents", "paymentMethod",
      "handlerUserId", "applicantUserId", "status", "updatedAt"
    ) VALUES (
      '${prefix}_request', '${prefix}_project', '${prefix}_request_code',
      'comprehensive_expense', 'travel', '存量项目支出实付',
      '存量迁移验收', 1000, 1000, ${requestPaidAmount},
      'bank_transfer', '${prefix}_executor', '${prefix}_executor',
      '${requestStatus}', CURRENT_TIMESTAMP
    );
    INSERT INTO "ProjectExpenseExecution" (
      "id", "projectExpenseRequestId", "projectId", "amountCents",
      "paidAt", "executedByUserId", "voucherFileId"
    ) VALUES (
      '${prefix}_execution', '${prefix}_request', '${executionProjectId}', 400,
      '2026-07-30T00:00:00.000Z', '${prefix}_executor', '${prefix}_voucher'
    );
    ${fundingSql}
    ${orphanFundingSql}
    ${fundingReversalSql}
    ${auditSql}
    ${duplicateSql}
    ${crossBindingSql}
    ${paymentBlockedSql}
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
          AND table_name = 'ProjectExpenseExecution'
          AND column_name = 'idempotencyKey'
      ) + (
        SELECT COUNT(*)
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
          AND relation.relname IN (
            'ProjectExpenseRequest_id_projectId_key',
            'ProjectFinancingQuota_id_projectId_key',
            'ProjectExpenseExecution_idempotencyKey_key',
            'ProjectExpenseExecution_voucherFileId_key'
          )
      ) + (
        SELECT COUNT(*)
        FROM pg_constraint
        WHERE conname IN (
          'ProjectExpenseExecution_request_fk',
          'ProjectFundingAllocation_quota_project_fk',
          'ProjectFundingAllocation_project_expense_execution_guard'
        )
      ) + (
        SELECT COUNT(*)
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = current_schema()
          AND procedure.proname IN (
            'guard_project_expense_execution_immutable',
            'guard_project_expense_funding_allocation_owner',
            'validate_project_expense_funding_allocation_total',
            'validate_project_expense_execution_closed_fact',
            'jg_file_business_binding_columns_before_project_expense_execution'
          )
      ) + (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE tgname IN (
          'ProjectExpenseExecution_immutable',
          'ProjectExpenseExecution_closed_fact_guard',
          'ProjectFundingAllocation_project_expense_owner_guard',
          'ProjectFundingAllocation_project_expense_total_guard'
        )
          AND NOT tgisinternal
      );
    `
  );
  if (result.stdout.trim() !== "0") {
    throw new Error(
      `存量项目支出迁移失败后未完整回滚：${databaseName} 仍存在新对象`
    );
  }
  const originalVoucherIndex = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT COUNT(*)
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'ProjectExpenseExecution_voucherFileId_idx';
    `
  );
  if (originalVoucherIndex.stdout.trim() !== "1") {
    throw new Error(
      `存量项目支出迁移失败后原凭证索引未保留：${databaseName}`
    );
  }
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
  const failedMigrationLog = await runPsql(
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
  const postgresLogAfter = await capturePostgresLogs(dockerCommand);
  const failureEvidence = [
    failure instanceof Error ? failure.message : "",
    failedMigrationLog.stdout,
    failedMigrationLog.stderr,
    postgresLogDelta(postgresLogBefore, postgresLogAfter)
  ].join("\n");
  if (!failure || !failureEvidence.includes(expectedMarker)) {
    throw new Error(
      `存量项目支出迁移未以 ${expectedMarker} 拒绝 ${databaseName}：${
        failure instanceof Error ? failure.message : "迁移意外成功"
      }`
    );
  }
  await assertMigrationRolledBack(dockerCommand, databaseName);
}

async function verifyMigrationRequiresQuiescence({
  databaseName,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const writerUserId = "migration_lock_writer_user";
  const writerProjectId = "migration_lock_writer_project";
  const writerRequestId = "migration_lock_writer_request";
  const writerApplicationName =
    "project-expense-migration-lock-writer";

  await runPsql(
    dockerCommand,
    databaseName,
    `
      INSERT INTO "User" (
        "id", "name", "mustChangePassword", "isActive", "updatedAt"
      ) VALUES (
        '${writerUserId}', '迁移锁序写入用户', false, true, CURRENT_TIMESTAMP
      );
      INSERT INTO "Project" (
        "id", "code", "name", "isActive", "updatedAt"
      ) VALUES (
        '${writerProjectId}', 'MIGRATION-LOCK-WRITER',
        '迁移锁序写入项目', true, CURRENT_TIMESTAMP
      );
      INSERT INTO "ProjectExpenseRequest" (
        "id", "projectId", "code", "expenseType", "expenseSubtype",
        "paymentSubject", "reason", "requestedAmountCents",
        "approvedAmountCents", "paidAmountCents", "paymentMethod",
        "handlerUserId", "applicantUserId", "status", "updatedAt"
      ) VALUES (
        '${writerRequestId}', '${writerProjectId}',
        'MIGRATION-LOCK-WRITER-REQUEST', 'comprehensive_expense',
        'travel', '迁移锁序写入收款主体',
        '迁移锁序写入夹具', 1000, 1000, 0, 'bank_transfer',
        '${writerUserId}', '${writerUserId}',
        'approved_pending_payment', CURRENT_TIMESTAMP
      );
    `
  );

  const writer = runPsql(
    dockerCommand,
    databaseName,
    `
      BEGIN;
      SET LOCAL application_name = '${writerApplicationName}';
      SELECT "id"
      FROM "Project"
      WHERE "id" = '${writerProjectId}'
      FOR UPDATE;
      SELECT "id"
      FROM "ProjectFinancingQuota"
      WHERE "projectId" = '${writerProjectId}'
      FOR UPDATE;
      SELECT "id"
      FROM "ProjectExpenseRequest"
      WHERE "id" = '${writerRequestId}'
      FOR UPDATE;
      SELECT "id"
      FROM "ProjectExpenseExecution"
      WHERE "projectId" = '${writerProjectId}';
      SELECT "id"
      FROM "ProjectFundingAllocation"
      WHERE "projectId" = '${writerProjectId}';
      SELECT pg_sleep(12);
      SELECT pg_advisory_xact_lock(190731, 13);
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "businessType", "businessId",
        "metadata"
      ) VALUES (
        'migration_lock_writer_audit', '${writerUserId}',
        'migration_lock_writer_completed', 'project_expense_request',
        '${writerRequestId}', '{"fixture":true}'::jsonb
      );
      COMMIT;
    `
  );

  let writerLockCount = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const lockResult = await runPsql(
      dockerCommand,
      databaseName,
      `
        SELECT COUNT(DISTINCT relation.relname)
        FROM pg_stat_activity activity
        JOIN pg_locks held_lock
          ON held_lock.pid = activity.pid
         AND held_lock.locktype = 'relation'
         AND held_lock.granted
        JOIN pg_class relation ON relation.oid = held_lock.relation
        JOIN pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        WHERE activity.datname = current_database()
          AND activity.application_name = '${writerApplicationName}'
          AND namespace.nspname = current_schema()
          AND relation.relname IN (
            'ProjectExpenseRequest',
            'ProjectExpenseExecution',
            'ProjectFinancingQuota',
            'ProjectFundingAllocation'
          );
      `
    );
    writerLockCount = Number(lockResult.stdout.trim());
    if (writerLockCount === 4) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (writerLockCount !== 4) {
    await writer.catch(() => undefined);
    throw new Error(
      `项目支出实付迁移锁序夹具未取得四张资金事实表锁：${writerLockCount}`
    );
  }

  const postgresLogBefore = await capturePostgresLogs(dockerCommand);
  let migrationFailure;
  try {
    await runPrismaMigrate({
      databaseUrl: databaseUrlFor(databaseUrl, databaseName),
      runtimeEnv,
      forwardOutput: false
    });
  } catch (error) {
    migrationFailure = error;
  }
  await writer;

  const failedMigrationLog = await runPsql(
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
  const postgresLogAfter = await capturePostgresLogs(dockerCommand);
  const scopedEvidence = [
    migrationFailure instanceof Error ? migrationFailure.message : "",
    failedMigrationLog.stdout,
    failedMigrationLog.stderr,
    postgresLogDelta(postgresLogBefore, postgresLogAfter)
  ].join("\n");
  if (
    !migrationFailure ||
    !scopedEvidence.includes(
      "project_expense_execution_migration_requires_quiescence"
    )
  ) {
    const diagnostic = scopedEvidence.trim().slice(-4_000);
    throw new Error(
      `项目支出实付迁移未在在途文件写入下稳定失败关闭；` +
        `migrationFailure=${Boolean(migrationFailure)}；evidence=${diagnostic}`
    );
  }
  await assertMigrationRolledBack(dockerCommand, databaseName);
  const writerFact = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT COUNT(*)
      FROM "AuditLog"
      WHERE "id" = 'migration_lock_writer_audit'
        AND "action" = 'migration_lock_writer_completed';
    `
  );
  if (writerFact.stdout.trim() !== "1") {
    throw new Error("迁移失败关闭后在途资金写入未自然完成");
  }
  console.log(
    "项目支出实付 140000 迁移：在途写入下立即失败关闭，无死锁或部分安装"
  );
}

async function verifyRetainedMigration({
  dockerCommand,
  databaseUrl,
  temporaryRoot,
  runtimeEnv
}) {
  const pre140MigrationRoot =
    await preparePre140MigrationRoot(temporaryRoot);
  const pre140SchemaPath = path.join(
    pre140MigrationRoot,
    "schema.prisma"
  );
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    PRE140_TEMPLATE_DATABASE
  ]);
  await runPrismaMigrate({
    databaseUrl: databaseUrlFor(databaseUrl, PRE140_TEMPLATE_DATABASE),
    runtimeEnv,
    schemaPath: pre140SchemaPath
  });

  for (const databaseName of Object.values(RETAINED_MIGRATION_DATABASES)) {
    await createDatabaseFromTemplate(
      dockerCommand,
      PRE140_TEMPLATE_DATABASE,
      databaseName
    );
  }

  const cases = [
    [
      "valid",
      RETAINED_MIGRATION_DATABASES.valid,
      { includePaymentBlockedRetained: true }
    ],
    [
      "duplicate_voucher",
      RETAINED_MIGRATION_DATABASES.duplicateVoucher,
      { duplicateVoucher: true }
    ],
    [
      "voucher_owner",
      RETAINED_MIGRATION_DATABASES.voucherOwner,
      { voucherOwnerMismatch: true }
    ],
    [
      "request_owner",
      RETAINED_MIGRATION_DATABASES.requestOwner,
      { requestOwnerMismatch: true }
    ],
    [
      "paid_mismatch",
      RETAINED_MIGRATION_DATABASES.paidMismatch,
      { paidMismatch: true }
    ],
    [
      "status_mismatch",
      RETAINED_MIGRATION_DATABASES.statusMismatch,
      { statusMismatch: true }
    ],
    [
      "funding_missing",
      RETAINED_MIGRATION_DATABASES.fundingMissing,
      { fundingAllocationMissing: true }
    ],
    [
      "funding_mismatch",
      RETAINED_MIGRATION_DATABASES.fundingMismatch,
      { fundingAllocationMismatch: true }
    ],
    [
      "funding_orphan",
      RETAINED_MIGRATION_DATABASES.fundingOrphan,
      { orphanFundingAllocation: true }
    ],
    [
      "funding_reversal",
      RETAINED_MIGRATION_DATABASES.fundingReversal,
      { fundingReversal: true }
    ],
    [
      "cross_project_quota",
      RETAINED_MIGRATION_DATABASES.crossProjectQuota,
      { crossProjectQuota: true }
    ],
    [
      "audit_missing",
      RETAINED_MIGRATION_DATABASES.auditMissing,
      { auditMissing: true }
    ],
    [
      "audit_mismatch",
      RETAINED_MIGRATION_DATABASES.auditMismatch,
      { auditMismatch: true }
    ],
    [
      "cross_business_voucher",
      RETAINED_MIGRATION_DATABASES.crossBusinessVoucher,
      { crossBusinessVoucher: true }
    ]
  ];
  for (const [label, databaseName, options] of cases) {
    await runPsql(
      dockerCommand,
      databaseName,
      retainedFixtureSql(label, options)
    );
  }

  await verifyMigrationRequiresQuiescence({
    databaseName: RETAINED_MIGRATION_DATABASES.lockConflict,
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });

  await runPrismaMigrate({
    databaseUrl: databaseUrlFor(
      databaseUrl,
      RETAINED_MIGRATION_DATABASES.valid
    ),
    runtimeEnv
  });
  const retainedFacts = await runPsql(
    dockerCommand,
    RETAINED_MIGRATION_DATABASES.valid,
    `
      SELECT
        execution."idempotencyKey"
        || '|' || execution."projectExpenseRequestId"
        || '|' || execution."projectId"
        || '|' || execution."amountCents"::text
        || '|' || file."uploadedByUserId"
        || '|' || execution."executedByUserId"
      FROM "ProjectExpenseExecution" execution
      JOIN "FileObject" file ON file."id" = execution."voucherFileId"
      ORDER BY execution."id";
    `
  );
  const expectedRetainedFacts =
    "legacy:project_expense_execution:retained_valid_blocked_execution" +
    "|retained_valid_blocked_request" +
    "|retained_valid_project" +
    "|400" +
    "|retained_valid_executor" +
    "|retained_valid_executor\n" +
    "legacy:project_expense_execution:retained_valid_execution" +
    "|retained_valid_request" +
    "|retained_valid_project" +
    "|400" +
    "|retained_valid_executor" +
    "|retained_valid_executor";
  if (retainedFacts.stdout.trim() !== expectedRetainedFacts) {
    throw new Error(
      `合法存量项目支出实付事实升级结果不一致：${retainedFacts.stdout.trim()}`
    );
  }

  for (const [databaseName, expectedMarker] of [
    [
      RETAINED_MIGRATION_DATABASES.duplicateVoucher,
      "project_expense_execution_duplicate_voucher"
    ],
    [
      RETAINED_MIGRATION_DATABASES.voucherOwner,
      "project_expense_execution_voucher_owner_or_status_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.requestOwner,
      "project_expense_execution_request_owner_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.paidMismatch,
      "project_expense_execution_request_paid_amount_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.statusMismatch,
      "project_expense_execution_request_status_amount_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.fundingMissing,
      "project_expense_execution_funding_allocation_missing"
    ],
    [
      RETAINED_MIGRATION_DATABASES.fundingMismatch,
      "project_expense_execution_funding_allocation_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.fundingOrphan,
      "project_expense_execution_funding_allocation_orphan_or_reversal"
    ],
    [
      RETAINED_MIGRATION_DATABASES.fundingReversal,
      "project_expense_execution_funding_allocation_orphan_or_reversal"
    ],
    [
      RETAINED_MIGRATION_DATABASES.crossProjectQuota,
      "project_funding_allocation_quota_project_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.auditMissing,
      "project_expense_execution_audit_missing"
    ],
    [
      RETAINED_MIGRATION_DATABASES.auditMismatch,
      "project_expense_execution_audit_mismatch"
    ],
    [
      RETAINED_MIGRATION_DATABASES.crossBusinessVoucher,
      "project_expense_execution_cross_business_voucher"
    ]
  ]) {
    await expectRetainedMigrationFailure({
      databaseName,
      expectedMarker,
      databaseUrl,
      runtimeEnv,
      dockerCommand
    });
  }
  await verifyFailedMigrationRecovery({
    databaseName: RETAINED_MIGRATION_DATABASES.auditMissing,
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  console.log(
    "项目支出实付 140000 存量迁移：合法事实保留，十三类非法事实均失败并回滚；审计缺失案例修复后 resolve/retry 成功"
  );
}

async function verifyFailedMigrationRecovery({
  databaseName,
  databaseUrl,
  runtimeEnv,
  dockerCommand
}) {
  const prefix = "retained_audit_missing";
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
        "id", "actorUserId", "action", "businessType",
        "businessId", "metadata"
      ) VALUES (
        '${prefix}_audit_recovery', '${prefix}_executor',
        'project_expense.execution.record',
        'project_expense_request', '${prefix}_request',
        jsonb_build_object(
          'executionId', '${prefix}_execution',
          'amountCents', '400',
          'voucherFileId', '${prefix}_voucher'
        )
      );
    `
  );
  await runPrismaMigrate({
    databaseUrl: targetDatabaseUrl,
    runtimeEnv,
    forwardOutput: false
  });
  const recoveryEvidence = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT
        COUNT(*) FILTER (WHERE "rolled_back_at" IS NOT NULL)::text
        || '|' ||
        COUNT(*) FILTER (WHERE "finished_at" IS NOT NULL)::text
        || '|' ||
        (
          SELECT "idempotencyKey"
          FROM "ProjectExpenseExecution"
          WHERE "id" = '${prefix}_execution'
        )
      FROM "_prisma_migrations"
      WHERE "migration_name" = '${LATEST_MIGRATION}';
    `
  );
  if (
    recoveryEvidence.stdout.trim() !==
    `1|1|legacy:project_expense_execution:${prefix}_execution`
  ) {
    throw new Error(
      `项目支出失败迁移 resolve/retry 证据不完整：${recoveryEvidence.stdout.trim()}`
    );
  }
}

async function main() {
  await assertMigrationCount();
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-project-expense-execution-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-project-expense-execution-")
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
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    RUN_PROJECT_EXPENSE_EXECUTION_CONCURRENCY: "1"
  };
  dockerCommand.containerName = containerName;
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createProjectExpenseExecutionConcurrencyCleanup({
    dockerCommand,
    containerName,
    temporaryRoot,
    onComplete: () =>
      console.log(
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
    await command(
      pnpm,
      ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"],
      { env: runtimeEnv, forwardOutput: true }
    );
    await command(
      pnpm,
      ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    await command(
      pnpm,
      ["--filter", "@jiangkong/api", "build"],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    await command(
      pnpm,
      [
        "--filter",
        "@jiangkong/api",
        "test",
        "--",
        "--runInBand",
        "src/database/project-expense-execution-concurrency.spec.ts"
      ],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    console.log(
      `项目支出实付并发不变量已通过完整 ${EXPECTED_MIGRATION_COUNT} 迁移验收`
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
  createProjectExpenseExecutionConcurrencyCleanup,
  verifyRetainedMigration,
  main
};
