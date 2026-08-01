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

const DATABASE_NAME = "jiangkong_payment_execution_concurrency";
const EXPECTED_MIGRATION_COUNT = 115;
const LATEST_MIGRATION =
  "20260728139000_payment_execution_idempotency";
const PRE139_TEMPLATE_DATABASE =
  "jiangkong_payment_execution_pre139_template";
const RETAINED_MIGRATION_DATABASES = {
  valid: "jiangkong_payment_execution_retained_valid",
  paidMismatch: "jiangkong_payment_execution_retained_paid_mismatch",
  payerIncomplete:
    "jiangkong_payment_execution_retained_payer_incomplete",
  paymentStatusMismatch:
    "jiangkong_payment_execution_retained_payment_status_mismatch",
  settlementStatusMismatch:
    "jiangkong_payment_execution_retained_settlement_status_mismatch",
  paymentApprovalPendingStatus:
    "jiangkong_payment_execution_retained_payment_approval_pending",
  settlementApprovalPendingStatus:
    "jiangkong_payment_execution_retained_settlement_approval_pending",
  historicalTakeoverLinkedInvalidStatus:
    "jiangkong_payment_execution_retained_linked_historical_status",
  settlementPaidMismatch:
    "jiangkong_payment_execution_retained_settlement_paid_mismatch",
  voucherOwnerOrStatusMismatch:
    "jiangkong_payment_execution_retained_voucher_owner_mismatch",
  payerLineageMismatch:
    "jiangkong_payment_execution_retained_payer_lineage_mismatch",
  fundingAllocationMissing:
    "jiangkong_payment_execution_retained_funding_missing",
  fundingAllocationMismatch:
    "jiangkong_payment_execution_retained_funding_mismatch",
  auditMissing:
    "jiangkong_payment_execution_retained_audit_missing",
  auditMismatch:
    "jiangkong_payment_execution_retained_audit_mismatch"
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
    throw new Error("付款实付并发验收 DATABASE_URL 不是有效 URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("付款实付并发验收只能连接 PostgreSQL 临时数据库");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("付款实付并发验收拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("付款实付并发验收只允许连接固定的一次性临时数据库");
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
      `付款实付并发验收拒绝远程 Docker endpoint：${normalized}`
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
  throw new Error("付款实付并发临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createPaymentExecutionConcurrencyCleanup({
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
      `付款实付并发验收要求 ${EXPECTED_MIGRATION_COUNT} 个迁移，当前为 ${actual} 个`
    );
  }
}

function databaseUrlFor(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function preparePre139MigrationRoot(temporaryRoot) {
  const pre139MigrationRoot = path.join(temporaryRoot, "pre139-prisma");
  const pre139Migrations = path.join(pre139MigrationRoot, "migrations");
  await mkdir(pre139Migrations, { recursive: true });
  await copyFile(
    path.join(__dirname, "schema.prisma"),
    path.join(pre139MigrationRoot, "schema.prisma")
  );
  await copyFile(
    path.join(migrationsRoot, "migration_lock.toml"),
    path.join(pre139Migrations, "migration_lock.toml")
  );
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name >= LATEST_MIGRATION) continue;
    await cp(
      path.join(migrationsRoot, entry.name),
      path.join(pre139Migrations, entry.name),
      { recursive: true }
    );
  }
  return pre139MigrationRoot;
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

async function runCoreSeed(runtimeEnv) {
  await command(
    pnpm,
    [
      "--filter",
      "@jiangkong/api",
      "exec",
      "prisma",
      "db",
      "seed"
    ],
    {
      env: runtimeEnv,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    }
  );
}

async function assertSeedPaymentExecutionClosedLoop(dockerCommand) {
  const facts = await runPsql(
    dockerCommand,
    DATABASE_NAME,
    `
      SELECT
        (
          SELECT COUNT(*)::text
          FROM "PaymentExecution"
          WHERE "id" = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || (
          SELECT COUNT(*)::text
          FROM "ProjectFundingAllocation"
          WHERE "executionType" = 'payment_execution'
            AND "executionId" = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || COALESCE((
          SELECT SUM("amountCents")::text
          FROM "ProjectFundingAllocation"
          WHERE "executionType" = 'payment_execution'
            AND "executionId" = 'seed-payment-execution-fk-2026-006-001'
            AND "direction" = 'debit'
            AND "reversalKey" = 'original'
        ), '0')
        || '|' || (
          SELECT COUNT(*)::text
          FROM "AuditLog"
          WHERE "action" = 'payment.execution.record'
            AND "businessType" = 'payment_request'
            AND "businessId" = 'seed-payment-request-fk-2026-006'
            AND "metadata"->>'executionId'
              = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || CASE WHEN
          EXISTS (
            SELECT 1
            FROM "PaymentExecution"
            WHERE "id" = 'seed-payment-execution-fk-2026-006-001'
              AND "idempotencyKey"
                = 'b1111111-1111-4111-8111-111111111111'
              AND "paymentRequestId" = 'seed-payment-request-fk-2026-006'
              AND "settlementId" = 'seed-settlement-js-2026-018'
              AND "paymentSubjectType" = 'our_company'
              AND "companyEntityIdSnapshot" = 'seed-company-entity-jgzg'
              AND "companyEntityNameSnapshot" = '建工智管建设有限公司'
              AND "companyEntityCreditCodeSnapshot" = '91350211M000100Y46'
              AND "amountCents" = 12800000
              AND "executedByUserId" = 'seed-user-cashier'
              AND "voucherFileId" = 'seed-file-payment-voucher-fk-2026-006'
          )
          AND EXISTS (
            SELECT 1
            FROM "ProjectFundingAllocation"
            WHERE "id"
              = 'seed-project-funding-allocation-fk-2026-006-001'
              AND "projectId" = 'seed-project-jgxm-001'
              AND "executionType" = 'payment_execution'
              AND "executionId"
                = 'seed-payment-execution-fk-2026-006-001'
              AND "businessType" = 'payment_request'
              AND "businessId" = 'seed-payment-request-fk-2026-006'
              AND "sourceType" = 'project_cash'
              AND "sourceKey" = 'project_cash'
              AND "sourceId" IS NULL
              AND "direction" = 'debit'
              AND "amountCents" = 12800000
              AND "createdByUserId" = 'seed-user-cashier'
              AND "reversalOfAllocationId" IS NULL
              AND "reversalKey" = 'original'
          )
          AND EXISTS (
            SELECT 1
            FROM "AuditLog"
            WHERE "id" = 'seed-audit-payment-execution-fk-2026-006-001'
              AND "actorUserId" = 'seed-user-cashier'
              AND "action" = 'payment.execution.record'
              AND "businessType" = 'payment_request'
              AND "businessId" = 'seed-payment-request-fk-2026-006'
              AND "metadata"->>'amountCents' = '12800000'
              AND "metadata"->>'idempotencyKey'
                = 'b1111111-1111-4111-8111-111111111111'
              AND "metadata"->'funding'->>'projectCashAmountCents'
                = '12800000'
              AND "metadata"->'funding'->>'financingQuotaAmountCents'
                = '0'
          )
        THEN 'exact' ELSE 'drift' END;
    `
  );
  const expected = "1|1|12800000|1|exact";
  if (facts.stdout.trim() !== expected) {
    throw new Error(
      `付款实付 seed 闭环事实不完整或不幂等：${facts.stdout.trim()}`
    );
  }
}

function retainedFixtureSql(
  label,
  {
    paidMismatch = false,
    payerIncomplete = false,
    paymentStatusMismatch = false,
    settlementStatusMismatch = false,
    paymentApprovalPendingStatus = false,
    settlementApprovalPendingStatus = false,
    historicalTakeoverLinkedInvalidStatus = false,
    settlementPaidMismatch = false,
    voucherOwnerOrStatusMismatch = false,
    payerLineageMismatch = false,
    fundingAllocationMissing = false,
    fundingAllocationMismatch = false,
    auditMissing = false,
    auditMismatch = false
  } = {}
) {
  const prefix = `retained_${label}`;
  const paymentPaidAmount = paidMismatch ? 500 : 400;
  const paymentStatus = paymentApprovalPendingStatus
    ? "approval_pending"
    : paymentStatusMismatch
      ? "approved_pending_payment"
      : "partially_paid";
  const settlementStatus = historicalTakeoverLinkedInvalidStatus
    ? "effective"
    : settlementApprovalPendingStatus
      ? "approval_pending"
      : settlementStatusMismatch
        ? "effective"
        : "partially_paid";
  const settlementSourceType = historicalTakeoverLinkedInvalidStatus
    ? "historical_takeover"
    : "system";
  const settlementPaidAmount = settlementPaidMismatch ? 300 : 400;
  const companyCreditCode = payerIncomplete
    ? "NULL"
    : "'91310000RETAINED01'";
  const voucherUploaderId = voucherOwnerOrStatusMismatch
    ? `${prefix}_uploader`
    : `${prefix}_executor`;
  const voucherStorageStatus = voucherOwnerOrStatusMismatch
    ? "quarantined"
    : "active";
  const paymentSubjectType = payerLineageMismatch
    ? "affiliate"
    : "our_company";
  const fundingAllocationSql = fundingAllocationMissing
    ? ""
    : `
      INSERT INTO "ProjectFundingAllocation" (
        "id",
        "projectId",
        "executionType",
        "executionId",
        "businessType",
        "businessId",
        "sourceType",
        "sourceKey",
        "sourceId",
        "direction",
        "amountCents",
        "occurredAt",
        "createdByUserId",
        "reversalOfAllocationId",
        "reversalKey",
        "reason"
      )
      VALUES (
        '${prefix}_funding',
        '${prefix}_project',
        'payment_execution',
        '${prefix}_execution',
        'payment_request',
        '${prefix}_payment',
        'project_cash',
        'project_cash',
        NULL,
        'debit',
        ${fundingAllocationMismatch ? 399 : 400},
        '2026-07-02T00:00:00.000Z',
        '${prefix}_executor',
        NULL,
        'original',
        NULL
      );
    `;
  const auditSql = auditMissing
    ? ""
    : `
      INSERT INTO "AuditLog" (
        "id",
        "actorUserId",
        "action",
        "businessType",
        "businessId",
        "metadata"
      )
      VALUES (
        '${prefix}_audit',
        '${prefix}_executor',
        'payment.execution.record',
        'payment_request',
        '${prefix}_payment',
        jsonb_build_object(
          'executionId', '${prefix}_execution',
          'amountCents', '${auditMismatch ? 399 : 400}',
          'voucherFileId', '${prefix}_voucher'
        )
      );
    `;
  return `
    BEGIN;
    INSERT INTO "User" (
      "id",
      "name",
      "mustChangePassword",
      "isActive",
      "updatedAt"
    )
    VALUES
      (
        '${prefix}_uploader',
        '存量凭证上传人',
        FALSE,
        TRUE,
        CURRENT_TIMESTAMP
      ),
      (
        '${prefix}_executor',
        '存量付款登记人',
        FALSE,
        TRUE,
        CURRENT_TIMESTAMP
      );
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (
      '${prefix}_project',
      '${prefix}_project_code',
      '存量迁移验收项目',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "CompanyEntity" (
      "id",
      "name",
      "unifiedSocialCreditCode",
      "dataStatus",
      "currentVersionNo",
      "isActive",
      "updatedAt"
    )
    VALUES (
      '${prefix}_company',
      '存量迁移验收建设有限公司',
      '91310000RETAINED01',
      'complete',
      1,
      TRUE,
      CURRENT_TIMESTAMP
    );
    INSERT INTO "Contract" (
      "id",
      "projectId",
      "code",
      "name",
      "counterparty",
      "companyEntityId",
      "companyEntityName",
      "updatedAt"
    )
    VALUES (
      '${prefix}_contract',
      '${prefix}_project',
      '${prefix}_contract_code',
      '存量迁移验收合同',
      '存量迁移验收相对方',
      '${prefix}_company',
      '存量迁移验收建设有限公司',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "ContractVersion" (
      "id",
      "contractId",
      "versionNo",
      "changeType",
      "status",
      "amountCents",
      "effectiveAt",
      "signingSubjectType",
      "companyEntityIdSnapshot",
      "companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot",
      "draftData",
      "templateSnapshot",
      "clauseSnapshot",
      "updatedAt"
    )
    VALUES (
      '${prefix}_version',
      '${prefix}_contract',
      1,
      'original',
      'effective',
      1000,
      '2026-07-01T00:00:00.000Z',
      'our_company',
      '${prefix}_company',
      '存量迁移验收建设有限公司',
      ${companyCreditCode},
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb,
      CURRENT_TIMESTAMP
    );
    INSERT INTO "PaymentTermsVersion" (
      "id",
      "contractId",
      "contractVersionId",
      "versionNo",
      "status",
      "originalText",
      "updatedAt"
    )
    VALUES (
      '${prefix}_terms',
      '${prefix}_contract',
      '${prefix}_version',
      1,
      'effective',
      '存量迁移验收付款条款',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "Settlement" (
      "id",
      "projectId",
      "contractId",
      "contractVersionId",
      "paymentTermsVersionId",
      "code",
      "periodLabel",
      "status",
      "amountCents",
      "payableAmountCents",
      "paidAmountCents",
      "sourceType",
      "updatedAt"
    )
    VALUES (
      '${prefix}_settlement',
      '${prefix}_project',
      '${prefix}_contract',
      '${prefix}_version',
      '${prefix}_terms',
      '${prefix}_settlement_code',
      '2026-07',
      '${settlementStatus}',
      1000,
      1000,
      ${settlementPaidAmount},
      '${settlementSourceType}',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "Settlement" (
      "id",
      "projectId",
      "contractId",
      "contractVersionId",
      "paymentTermsVersionId",
      "code",
      "periodLabel",
      "status",
      "amountCents",
      "payableAmountCents",
      "paidAmountCents",
      "sourceType",
      "updatedAt"
    )
    VALUES (
      '${prefix}_historical_settlement',
      '${prefix}_project',
      '${prefix}_contract',
      '${prefix}_version',
      '${prefix}_terms',
      '${prefix}_historical_settlement_code',
      '历史期初',
      'effective',
      1000,
      1000,
      400,
      'historical_takeover',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "PaymentRequest" (
      "id",
      "projectId",
      "settlementId",
      "sourceType",
      "contractId",
      "contractVersionId",
      "paymentTermsVersionId",
      "code",
      "status",
      "requestedAmountCents",
      "approvedAmountCents",
      "paidAmountCents",
      "paymentSubjectType",
      "updatedAt"
    )
    VALUES (
      '${prefix}_payment',
      '${prefix}_project',
      '${prefix}_settlement',
      'settlement',
      '${prefix}_contract',
      '${prefix}_version',
      '${prefix}_terms',
      '${prefix}_payment_code',
      '${paymentStatus}',
      1000,
      1000,
      ${paymentPaidAmount},
      '${paymentSubjectType}',
      CURRENT_TIMESTAMP
    );
    INSERT INTO "FileObject" (
      "id",
      "bucket",
      "objectKey",
      "originalName",
      "mimeType",
      "sizeBytes",
      "uploadedByUserId",
      "contentSha256",
      "storageStatus"
    )
    VALUES (
      '${prefix}_voucher',
      'local-private',
      '${prefix}/voucher.pdf',
      '存量付款凭证.pdf',
      'application/pdf',
      128,
      '${voucherUploaderId}',
      '${"a".repeat(64)}',
      '${voucherStorageStatus}'
    );
    INSERT INTO "PaymentExecution" (
      "id",
      "paymentRequestId",
      "settlementId",
      "paymentSubjectType",
      "amountCents",
      "paidAt",
      "executedByUserId",
      "voucherFileId"
    )
    VALUES (
      '${prefix}_execution',
      '${prefix}_payment',
      '${prefix}_settlement',
      'our_company',
      400,
      '2026-07-02T00:00:00.000Z',
      '${prefix}_executor',
      '${prefix}_voucher'
    );
    ${fundingAllocationSql}
    ${auditSql}
    COMMIT;
  `;
}

async function assertMigrationRolledBack(dockerCommand, databaseName) {
  const result = await runPsql(
    dockerCommand,
    databaseName,
    `
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'PaymentExecution'
        AND column_name IN (
          'idempotencyKey',
          'companyEntityIdSnapshot',
          'companyEntityNameSnapshot',
          'companyEntityCreditCodeSnapshot'
        );
    `
  );
  if (result.stdout.trim() !== "0") {
    throw new Error(
      `存量迁移失败后未完整回滚：${databaseName} 仍存在新列`
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
  const postgresLog = await dockerCommand([
    "logs",
    dockerCommand.containerName
  ]);
  const failureEvidence = [
    failure instanceof Error ? failure.message : "",
    failedMigrationLog.stdout,
    failedMigrationLog.stderr,
    postgresLog.stdout,
    postgresLog.stderr
  ].join("\n");
  if (!failure || !failureEvidence.includes(expectedMarker)) {
    throw new Error(
      `存量迁移未以 ${expectedMarker} 拒绝 ${databaseName}：${
        failure instanceof Error ? failure.message : "迁移意外成功"
      }`
    );
  }
  await assertMigrationRolledBack(dockerCommand, databaseName);
}

async function verifyRetainedMigration({
  dockerCommand,
  databaseUrl,
  temporaryRoot,
  runtimeEnv
}) {
  const pre139MigrationRoot =
    await preparePre139MigrationRoot(temporaryRoot);
  const pre139SchemaPath = path.join(
    pre139MigrationRoot,
    "schema.prisma"
  );
  await dockerCommand([
    "exec",
    dockerCommand.containerName,
    "createdb",
    "-U",
    "jiangkong",
    PRE139_TEMPLATE_DATABASE
  ]);
  await runPrismaMigrate({
    databaseUrl: databaseUrlFor(databaseUrl, PRE139_TEMPLATE_DATABASE),
    runtimeEnv,
    schemaPath: pre139SchemaPath
  });

  for (const databaseName of Object.values(RETAINED_MIGRATION_DATABASES)) {
    await createDatabaseFromTemplate(
      dockerCommand,
      PRE139_TEMPLATE_DATABASE,
      databaseName
    );
  }

  const cases = [
    ["valid", RETAINED_MIGRATION_DATABASES.valid, {}],
    [
      "paid_mismatch",
      RETAINED_MIGRATION_DATABASES.paidMismatch,
      { paidMismatch: true }
    ],
    [
      "payer_incomplete",
      RETAINED_MIGRATION_DATABASES.payerIncomplete,
      { payerIncomplete: true }
    ],
    [
      "payment_status_mismatch",
      RETAINED_MIGRATION_DATABASES.paymentStatusMismatch,
      { paymentStatusMismatch: true }
    ],
    [
      "settlement_status_mismatch",
      RETAINED_MIGRATION_DATABASES.settlementStatusMismatch,
      { settlementStatusMismatch: true }
    ],
    [
      "payment_approval_pending",
      RETAINED_MIGRATION_DATABASES.paymentApprovalPendingStatus,
      { paymentApprovalPendingStatus: true }
    ],
    [
      "settlement_approval_pending",
      RETAINED_MIGRATION_DATABASES.settlementApprovalPendingStatus,
      { settlementApprovalPendingStatus: true }
    ],
    [
      "linked_historical_status",
      RETAINED_MIGRATION_DATABASES.historicalTakeoverLinkedInvalidStatus,
      { historicalTakeoverLinkedInvalidStatus: true }
    ],
    [
      "settlement_paid_mismatch",
      RETAINED_MIGRATION_DATABASES.settlementPaidMismatch,
      { settlementPaidMismatch: true }
    ],
    [
      "voucher_owner_mismatch",
      RETAINED_MIGRATION_DATABASES.voucherOwnerOrStatusMismatch,
      { voucherOwnerOrStatusMismatch: true }
    ],
    [
      "payer_lineage_mismatch",
      RETAINED_MIGRATION_DATABASES.payerLineageMismatch,
      { payerLineageMismatch: true }
    ],
    [
      "funding_missing",
      RETAINED_MIGRATION_DATABASES.fundingAllocationMissing,
      { fundingAllocationMissing: true }
    ],
    [
      "funding_mismatch",
      RETAINED_MIGRATION_DATABASES.fundingAllocationMismatch,
      { fundingAllocationMismatch: true }
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
    ]
  ];
  for (const [label, databaseName, options] of cases) {
    await runPsql(
      dockerCommand,
      databaseName,
      retainedFixtureSql(label, options)
    );
  }

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
        || '|' || execution."companyEntityIdSnapshot"
        || '|' || execution."companyEntityNameSnapshot"
        || '|' || execution."companyEntityCreditCodeSnapshot"
        || '|' || file."uploadedByUserId"
        || '|' || execution."executedByUserId"
      FROM "PaymentExecution" execution
      JOIN "FileObject" file ON file."id" = execution."voucherFileId";
    `
  );
  const expectedRetainedFacts =
    "legacy:payment_execution:retained_valid_execution" +
    "|retained_valid_company" +
    "|存量迁移验收建设有限公司" +
    "|91310000RETAINED01" +
    "|retained_valid_executor" +
    "|retained_valid_executor";
  if (retainedFacts.stdout.trim() !== expectedRetainedFacts) {
    throw new Error(
      `合法存量付款事实升级结果不一致：${retainedFacts.stdout.trim()}`
    );
  }
  const historicalTakeoverFacts = await runPsql(
    dockerCommand,
    RETAINED_MIGRATION_DATABASES.valid,
    `
      SELECT "status" || '|' || "paidAmountCents"::text
      FROM "Settlement"
      WHERE "id" = 'retained_valid_historical_settlement'
        AND "sourceType" = 'historical_takeover';
    `
  );
  if (historicalTakeoverFacts.stdout.trim() !== "effective|400") {
    throw new Error(
      "合法历史接管期初结算在 139000 存量迁移中未被原样保留"
    );
  }

  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.paidMismatch,
    expectedMarker: "payment_execution_payment_paid_amount_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.payerIncomplete,
    expectedMarker: "payment_execution_incomplete_payer_snapshot",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.paymentStatusMismatch,
    expectedMarker: "payment_execution_payment_status_amount_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.settlementStatusMismatch,
    expectedMarker: "payment_execution_settlement_status_amount_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName:
      RETAINED_MIGRATION_DATABASES.paymentApprovalPendingStatus,
    expectedMarker: "payment_execution_payment_owner_status_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName:
      RETAINED_MIGRATION_DATABASES.settlementApprovalPendingStatus,
    expectedMarker: "payment_execution_settlement_owner_status_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName:
      RETAINED_MIGRATION_DATABASES.historicalTakeoverLinkedInvalidStatus,
    expectedMarker: "payment_execution_settlement_owner_status_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.settlementPaidMismatch,
    expectedMarker: "payment_execution_settlement_paid_amount_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName:
      RETAINED_MIGRATION_DATABASES.voucherOwnerOrStatusMismatch,
    expectedMarker:
      "payment_execution_voucher_owner_or_status_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.payerLineageMismatch,
    expectedMarker: "payment_execution_payer_lineage_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.fundingAllocationMissing,
    expectedMarker: "payment_execution_funding_allocation_missing",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.fundingAllocationMismatch,
    expectedMarker: "payment_execution_funding_allocation_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.auditMissing,
    expectedMarker: "payment_execution_audit_missing",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  await expectRetainedMigrationFailure({
    databaseName: RETAINED_MIGRATION_DATABASES.auditMismatch,
    expectedMarker: "payment_execution_audit_mismatch",
    databaseUrl,
    runtimeEnv,
    dockerCommand
  });
  console.log(
    "付款实付 139000 存量迁移：合法快照保留，十四类非法事实均失败并回滚"
  );
}

async function main() {
  await assertMigrationCount();
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-payment-execution-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-payment-execution-")
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
    RUN_PAYMENT_EXECUTION_CONCURRENCY: "1",
    SEED_PASSWORD: randomUUID()
  };
  dockerCommand.containerName = containerName;
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createPaymentExecutionConcurrencyCleanup({
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
    await runCoreSeed(runtimeEnv);
    await assertSeedPaymentExecutionClosedLoop(dockerCommand);
    await runCoreSeed(runtimeEnv);
    await assertSeedPaymentExecutionClosedLoop(dockerCommand);
    await command(
      pnpm,
      [
        "--filter",
        "@jiangkong/api",
        "test",
        "--",
        "--runInBand",
        "src/database/payment-execution-concurrency.spec.ts"
      ],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    console.log(
      `付款实付四类并发不变量已通过完整 ${EXPECTED_MIGRATION_COUNT} 迁移验收`
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
  createPaymentExecutionConcurrencyCleanup,
  verifyRetainedMigration,
  main
};
