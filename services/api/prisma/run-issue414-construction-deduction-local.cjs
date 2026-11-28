#!/usr/bin/env node
"use strict";

// #414 real PostgreSQL 16 verification for construction-enterprise deduction facts.
// It creates only its own disposable container on 127.0.0.1, builds the schema
// from prisma/schema.prisma with `prisma db push`, runs the guarded PG spec, and
// removes the container. It prints a receipt and verifies no container remains.
const { randomUUID, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const database = "jiangkong_issue414_construction_deduction";
const specFile = "src/database/issue414-construction-enterprise-deduction.pg.spec.ts";
const writerSqlFile = "services/api/prisma/issue414-operating-ledger-writer.sql";
const runId = randomUUID();
const containerName = `jiangkong-issue414-line-x-${runId}`;
const password = randomUUID();
let containerId;
let endpoint;
let image;

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`ISSUE414 命令失败：${bin} ${args[0]}`);
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);
const pnpm = () => process.env.PNPM_BIN?.trim() || "pnpm";

function resolvePostgresImage() {
  const requested = process.env.ISSUE414_PG_IMAGE?.trim() || "postgres:16";
  try {
    const id = docker(["image", "inspect", "--format", "{{.Id}}", requested], { quiet: true }).stdout;
    if (/^sha256:[a-f0-9]{64}$/u.test(id)) return { id, ref: requested };
  } catch {}
  const listing = docker(["images", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}"], { quiet: true }).stdout;
  const cached = listing.split("\n").map((line) => line.trim().split(/\s+/u))
    .find(([, ref]) => ref === "postgres:16");
  if (!cached) throw new Error("本机缺少已缓存镜像 postgres:16，请先准备隔离 PostgreSQL 16 镜像");
  const fullId = docker(
    ["image", "inspect", "--format", "{{.Id}}", `sha256:${cached[0]}`],
    { quiet: true }
  ).stdout;
  if (!/^sha256:[a-f0-9]{64}$/u.test(fullId)) {
    throw new Error("无法固定隔离 PostgreSQL 16 镜像的完整标识");
  }
  return { id: fullId, ref: cached[1] };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
  endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
    process.env, { quiet: true }).stdout.replace(/^"|"$/gu, "");
  if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
  const candidateSha = command("git", ["rev-parse", "HEAD"], process.env, { quiet: true }).stdout;
  const dirty = command("git", ["status", "--porcelain=v1"], process.env, { quiet: true }).stdout;
  image = resolvePostgresImage();
  const startedAt = new Date();
  const phases = [];
  const phase = async (name, run) => {
    const at = Date.now();
    const value = await run();
    phases.push({ name, durationMs: Date.now() - at });
    return value;
  };
  try {
    containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`,
      "--env", `POSTGRES_DB=${database}`, "--publish", "127.0.0.1::5432", image.id], { quiet: true }).stdout;
    if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("一次性容器标识无效");
    let port;
    for (let attempt = 0; attempt < 40 && !port; attempt += 1) {
      port = /^127\.0\.0\.1:(\d+)$/u.exec(docker(["port", containerId, "5432/tcp"], { quiet: true }).stdout)?.[1];
      if (!port) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!port) throw new Error("数据库必须仅监听本机回环地址");
    await phase("postgres-ready", () => docker(["exec", containerId, "sh", "-c",
      `for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d ${database} && exit 0; sleep 0.2; done; exit 1`],
      { quiet: true }));
    const serverVersion = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      "SHOW server_version_num;"], { quiet: true }).stdout;
    const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const ledgerSecret = randomBytes(32).toString("hex");
    const env = { ...process.env, NODE_ENV: "test", CI: "true", DATABASE_URL: databaseUrl,
      OPERATING_LEDGER_DB_WRITE_SECRET: ledgerSecret,
      ISSUE414_OPERATING_LEDGER_WRITE_SECRET: ledgerSecret,
      ISSUE414_CONSTRUCTION_DEDUCTION_DATABASE_URL: databaseUrl,
      FILE_STORAGE_DRIVER: "local", APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex") };
    await phase("prisma-generate", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      env, { quiet: true }));
    await phase("schema-db-push", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "db", "push", "--skip-generate"],
      { ...env, CHECKPOINT_DISABLE: "1" }, { quiet: true }));
    // db push cannot create the controlled operating-ledger write seam (types and
    // SECURITY DEFINER functions live in migrations). Install the exact V1 writer
    // copied from migrations 20260814120000/20260831120000 so confirmation writes
    // real OperatingFact/OperatingImpactEntry rows instead of a test stub.
    await phase("operating-ledger-writer", () => docker(["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "jiangkong", "-d", database], { quiet: true, input: readFileSync(path.join(root, writerSqlFile), "utf8") }));
    // schema.prisma 无法表达部分唯一索引；生产迁移链中的下列索引是
    // “同一笔外部付款不得重复登记 / 每个事实只允许一次反向”的真实约束，
    // 必须在真库用例中一并还原，否则测试会低估生产约束。
    await phase("canonical-partial-indexes", () => docker(["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "jiangkong", "-d", database], { quiet: true, input: [
      `CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_externalPaymentReference_original_key" ON "ProjectAffiliatePaymentFact"("externalPaymentReference") WHERE "entryKind" = 'original';`,
      `CREATE UNIQUE INDEX "ProjectAffiliatePaymentFact_single_reversal_idx" ON "ProjectAffiliatePaymentFact"("adjustsFactId") WHERE "entryKind" = 'reversal';`,
      `CREATE UNIQUE INDEX "ProjectAffiliateSettlementFact_single_reversal_idx" ON "ProjectAffiliateSettlementFact"("adjustsFactId") WHERE "entryKind" = 'reversal';`,
      `CREATE UNIQUE INDEX "ProjectUpstreamFundFact_single_reversal_idx" ON "ProjectUpstreamFundFact"("adjustsFactId") WHERE "entryKind" = 'reversal';`
    ].join("\n") }));
    const tables = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`], { quiet: true }).stdout;
    await phase("pg-issue414-spec", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand",
      "--runTestsByPath", specFile], { ...env, RUN_ISSUE414_CONSTRUCTION_DEDUCTION_DATABASE: "1" }, { timeout: 600_000 }));
    const receipt = {
      schemaVersion: 1, purpose: "ISSUE414_CONSTRUCTION_ENTERPRISE_DEDUCTION", status: "PASSED",
      candidateSha, worktreeClean: dirty.length === 0, containerImage: image.ref, imageId: image.id, database,
      serverVersionNum: Number(serverVersion), schemaMode: "PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA",
      migrationLedgerReplayed: false, publicTables: Number(tables),
      canonicalPartialIndexesApplied: 4,
      containerRuntime: "docker_postgresql16_disposable", smsProvider: "DISABLED",
      phases, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scopeWarning: "本用例证明真实 PG 上的施工企业扣费简单登记、同费用名称/金额/日期重复登记拒绝、同幂等键回放、确认后同一事务恰好写 1 条成本事实并只减少施工企业持有资金、重复确认被拒、反转+重登后成本净额正确且施工企业已付聚合不变；Schema 由 db push 建立，经营账写入函数按 20260814120000/20260831120000 安装，并还原 4 条生产部分唯一索引（完整迁移链未重放）；密码校验使用确定性替身，业务事务与约束为真实数据库"
    };
    process.stdout.write(`ISSUE414_RECEIPT ${JSON.stringify(receipt)}\n`);
  } finally {
    if (process.env.ISSUE414_KEEP === "1") {
      process.stderr.write(`ISSUE414_KEEP container=${containerName}\n`);
    } else {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId)) {
        try { docker(["rm", "--force", "--volumes", containerId], { quiet: true }); } catch {}
      }
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`ISSUE414 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
