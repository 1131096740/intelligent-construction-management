#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");
const readiness = require("../scripts/inspect-contract-draft-aggregate-readiness.cjs");

const root = path.resolve(__dirname, "../../..");
const databaseName = "jiangkong_contract_draft_aggregate_local";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const prismaCli = require.resolve("prisma/build/index.js");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;
const actorUserId = "00000000-0000-4000-8000-000000000099";
const projectId = "00000000-0000-4000-8000-000000000101";
const contractId = "00000000-0000-4000-8000-000000000201";
const versionId = "00000000-0000-4000-8000-000000000301";
const billId = "00000000-0000-4000-8000-000000000401";
const paymentTermsVersionId = "00000000-0000-4000-8000-000000000601";
const takeoverId = "00000000-0000-4000-8000-000000000701";
const evidenceFileId = "00000000-0000-4000-8000-000000000801";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertLocalDockerEndpoint(endpoint) {
  const normalized = endpoint.trim().replace(/^"(.*)"$/u, "$1");
  if (
    normalized &&
    !normalized.startsWith("unix://") &&
    !normalized.startsWith("npipe://")
  ) {
    throw new Error(
      `合同草稿聚合验证拒绝远程 Docker endpoint：${normalized}`
    );
  }
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

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await command(docker, [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "jiangkong",
        "-d",
        databaseName
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("合同草稿聚合临时 PostgreSQL 在 30 秒内未就绪");
}

async function insertFixture(prisma) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "name", "isActive", "updatedAt")
     VALUES ($1, '本地迁移操作者', true, now())`,
    actorUserId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Project" ("id", "code", "name", "updatedAt")
     VALUES ($1, 'LOCAL-DRAFT-AGGREGATE', '本地合同草稿聚合验证', now())`,
    projectId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Contract" (
       "id", "projectId", "source", "name", "counterparty", "contractTypeKey",
       "temporaryCode", "updatedAt"
     ) VALUES (
       $1, $2, 'historical_takeover', '本地草稿迁移合同', '本地测试相对方',
       'construction_subcontract', 'TMP-LOCAL-AGGREGATE', now()
     )`,
    contractId,
    projectId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractVersion" (
       "id", "contractId", "versionNo", "changeType", "status", "amountCents",
       "draftRevision", "draftData", "templateSnapshot", "clauseSnapshot", "updatedAt"
     ) VALUES ($1, $2, 1, 'historical_takeover', 'draft', 32700, 3, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, now())`,
    versionId,
    contractId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractBill" (
       "id", "contractVersionId", "billKey", "name", "amountRole", "pricingMode",
       "quantityScale", "unitPriceScale", "schemaSnapshot",
       "taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents",
       "updatedAt"
     ) VALUES (
       $1, $2, 'main', '本地验证清单', 'contract_amount', 'quantity_unit_price',
       6, 6, '{}'::jsonb, 32700, 30000, 2700, now()
     )`,
    billId,
    versionId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractBillRow" (
       "id", "contractBillId", "rowKey", "sortOrder", "itemName", "unit",
       "quantity", "unitPrice", "taxRate", "pricingFactStatus",
       "taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents",
       "taxExclusiveUnitPrice", "customData", "updatedAt"
     ) VALUES (
       '00000000-0000-4000-8000-000000000501', $1, 'row-1', 1, '本地验证行', '项',
       3, 109, 9, 'confirmed', 32700, 30000, 2700, NULL, '{}'::jsonb, now()
     )`,
    billId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PaymentTermsVersion" (
       "id", "contractId", "contractVersionId", "versionNo", "status",
       "originalText", "updatedAt"
     ) VALUES (
       $1, $2, $3, 1, 'draft', '本地验证付款条款原文', now()
     )`,
    paymentTermsVersionId,
    contractId,
    versionId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FileObject" (
       "id", "bucket", "objectKey", "originalName", "mimeType", "sizeBytes",
       "uploadedByUserId", "contentSha256", "storageStatus"
     ) VALUES (
       $1, 'local-test', 'local/contract-draft-aggregate/evidence.pdf',
       '本地结算依据.pdf', 'application/pdf', 128, $2, $3, 'active'
     )`,
    evidenceFileId,
    actorUserId,
    "a".repeat(64)
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractTakeover" (
       "id", "projectId", "contractId", "contractVersionId",
       "paymentTermsVersionId", "takeoverLevel", "takeoverStatus",
       "lifecycleStatus", "signedAt", "historicalSettledCents",
       "evidenceSummary", "createdByUserId", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, 'A', 'draft', 'signed_not_started',
       '2026-06-01T00:00:00.000Z', 0, '本地历史结算为零依据',
       $6, now()
     )`,
    takeoverId,
    projectId,
    contractId,
    versionId,
    paymentTermsVersionId,
    actorUserId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContractTakeoverSettlementEvidence" (
       "id", "takeoverId", "fileId", "displayOrder", "createdByUserId"
     ) VALUES (
       '00000000-0000-4000-8000-000000000901', $1, $2, 0, $3
     )`,
    takeoverId,
    evidenceFileId,
    actorUserId
  );
}

async function counts(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT count(*)::int FROM "Contract") AS "contracts",
       (SELECT count(*)::int FROM "ContractVersion") AS "versions",
       (SELECT count(*)::int FROM "ContractBill") AS "bills",
       (SELECT count(*)::int FROM "ContractBillRow") AS "billRows",
       (SELECT count(*)::int FROM "ContractPartySnapshot") AS "parties",
       (SELECT count(*)::int FROM "PaymentTermsVersion") AS "paymentTerms",
       (SELECT count(*)::int FROM "FileObject") AS "files"`
  );
  return rows[0];
}

async function main() {
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-contract-draft-aggregate-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-contract-draft-aggregate-")
  );
  const password = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${databaseName}`;
  const runtimeEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl
  };
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      command(docker, ["rm", "--force", containerName], {
        timeoutMs: 60_000
      }).catch((error) => {
        if (!String(error?.message).includes("No such container")) throw error;
      }),
    removeTemporaryRoot: () =>
      rm(temporaryRoot, { recursive: true, force: true }),
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
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    assertLocalDockerEndpoint(process.env.DOCKER_HOST ?? "");
    const context = await command(docker, [
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}"
    ]);
    assertLocalDockerEndpoint(context.stdout);
    await command(docker, ["info"]);
    await command(
      docker,
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
        `POSTGRES_DB=${databaseName}`,
        "--publish",
        `127.0.0.1:${port}:5432`,
        "postgres:16"
      ],
      {
        env: { ...process.env, POSTGRES_PASSWORD: password },
        forwardOutput: true
      }
    );
    await waitForPostgres(containerName);
    console.log(`临时 PostgreSQL 16 已就绪：${containerName}（仅 127.0.0.1）`);
    await command(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        path.join(root, "services/api/prisma/schema.prisma")
      ],
      { env: runtimeEnv, forwardOutput: true, timeoutMs: 15 * 60 * 1000 }
    );
    await command(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "status",
        "--schema",
        path.join(root, "services/api/prisma/schema.prisma")
      ],
      { env: runtimeEnv, forwardOutput: true }
    );

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    try {
      await insertFixture(prisma);
      const before = await counts(prisma);
      const report = await readiness.inspectWithClient(prisma);
      invariant(report.status === "ready", "本地 fixture 预检必须为 ready");
      invariant(report.records.length === 1, "本地 fixture 必须只有一个候选");
      const reportPath = path.join(temporaryRoot, "readiness-report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
      const fingerprint = readiness.databaseFingerprint(databaseUrl);
      const batchId = "local-draft-aggregate";
      const transitionArgs = [
        path.join(
          root,
          "services/api/prisma/transition-contract-draft-aggregate.cjs"
        ),
        "--apply",
        "--report",
        reportPath,
        "--batch-id",
        batchId,
        "--expected-database-fingerprint",
        fingerprint,
        "--expected-report-sha256",
        report.reportSha256,
        "--actor-user-id",
        actorUserId,
        "--confirm",
        `TRANSITION_CONTRACT_DRAFT_AGGREGATE_${batchId}`
      ];
      const first = await command(process.execPath, transitionArgs, {
        env: runtimeEnv
      });
      const firstReceipt = JSON.parse(first.stdout);
      invariant(
        firstReceipt.status === "applied" && firstReceipt.writes === 4,
        "首次转换必须只写派生单价、双侧 facts 与 batch audit receipt"
      );
      const after = await counts(prisma);
      invariant(
        JSON.stringify(before) === JSON.stringify(after),
        "合同、版本、清单、主体、付款条款或文件总数发生变化"
      );
      const derived = await prisma.$queryRawUnsafe(
        `SELECT "taxExclusiveUnitPrice"::text AS "value"
         FROM "ContractBillRow"
         WHERE "contractBillId" = $1`,
        billId
      );
      invariant(
        derived[0]?.value === "100.000000",
        "不含税单价没有按权威行金额精确派生"
      );
      const facts = await prisma.$queryRawUnsafe(
        `SELECT
           (SELECT count(*)::int FROM "ContractTakeoverContractFacts" WHERE "takeoverId" = $1) AS "contractFacts",
           (SELECT count(*)::int FROM "ContractTakeoverFinanceFacts" WHERE "takeoverId" = $1) AS "financeFacts"`,
        takeoverId
      );
      invariant(
        facts[0]?.contractFacts === 1 && facts[0]?.financeFacts === 1,
        "未激活且无旧确认的接管记录没有初始化双侧 revision"
      );
      const second = await command(process.execPath, transitionArgs, {
        env: runtimeEnv
      });
      const secondReceipt = JSON.parse(second.stdout);
      invariant(
        secondReceipt.status === "already_applied" &&
          secondReceipt.writes === 0,
        "同 batch 二次运行不是零写幂等"
      );
      process.stdout.write(
        `${JSON.stringify({
          mode: "isolated_contract_draft_aggregate",
          database: databaseName,
          databaseFingerprint: fingerprint,
          reportSha256: report.reportSha256,
          conservedCounts: after,
          firstRun: firstReceipt,
          secondRun: secondReceipt
        })}\n`
      );
    } finally {
      await prisma.$disconnect();
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

module.exports = {
  assertLocalDockerEndpoint,
  freePort,
  insertFixture,
  counts,
  main
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `合同草稿聚合本地隔离验证失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
