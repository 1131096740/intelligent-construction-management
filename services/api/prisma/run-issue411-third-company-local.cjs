#!/usr/bin/env node
"use strict";

// Real PostgreSQL 16 verification for third-company repayments and settled returns.
// It creates only its own disposable container on 127.0.0.1, builds the schema
// from prisma/schema.prisma with `prisma db push`, runs the guarded PG spec, and
// removes the container. It prints a receipt and verifies no container remains.
const { randomUUID, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const database = "jg_issue411_third_company";
const specFile = "src/database/issue411-third-company-repayment.pg.spec.ts";
const runId = randomUUID();
const containerName = `jiangkong-issue411-line-ag-${runId}`;
const password = randomUUID();
const settledReturns = process.argv[2] === "--settled-returns";
const writeSecret = randomBytes(24).toString("hex");
let containerId;
let endpoint;
let image;

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]").replaceAll(writeSecret, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`ISSUE411 命令失败：${bin} ${args[0]}`);
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);
const pnpm = () => process.env.PNPM_BIN?.trim() || "pnpm";

function resolvePostgresImage() {
  const requested = process.env.ISSUE411_PG_IMAGE?.trim() || "postgres:16";
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
  if (process.argv.length > (settledReturns ? 3 : 2)) throw new Error("仅支持 --settled-returns");
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
    const env = { ...process.env, NODE_ENV: "test", CI: "true", DATABASE_URL: databaseUrl,
      RUN_ISSUE411_THIRD_COMPANY_REPAYMENT: "1",
      RUN_ISSUE435_SETTLED_RETURN: settledReturns ? "1" : "0",
      OPERATING_LEDGER_DB_WRITE_SECRET: writeSecret,
      FILE_STORAGE_DRIVER: "local", APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex") };
    await phase("prisma-generate", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      env, { quiet: true }));
    await phase("schema-db-push", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "db", "push", "--skip-generate"],
      { ...env, CHECKPOINT_DISABLE: "1" }, { quiet: true }));
    // schema.prisma 无法表达公司互转的 DB 容量/审批/流水中止守卫；
    // 这里安装由现有迁移抽取的等价守卫（fixture 只服务本轮一次性库）。
    await phase("company-transfer-guards", () => docker(["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1",
      "-U", "jiangkong", "-d", database], { quiet: true, input: require("node:fs").readFileSync(
        path.join(__dirname, "issue411-company-transfer-guards.sql"), "utf8") }));
    if (settledReturns) {
      const fixture = require("./issue435-postgres-fixture.cjs");
      const psql = (input, args = []) => docker(["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", "jiangkong", "-d", database, ...args], { quiet: true, input });
      await phase("settled-return-preimage", () => psql(fixture.preimage(), ["-v", `issue435_secret=${writeSecret}`]));
      await phase("settled-return-migration", () => psql(fixture.migration()));
    }
    const tables = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`], { quiet: true }).stdout;
    await phase("pg-issue411-spec", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand",
      "--runTestsByPath", specFile],
      env, { timeout: 600_000 }));
    const receipt = {
      schemaVersion: 1, purpose: settledReturns ? "ISSUE435_SETTLED_RETURN" : "ISSUE411_THIRD_COMPANY_REPAYMENT", status: "PASSED",
      candidateSha, worktreeClean: dirty.length === 0, containerImage: image.ref, imageId: image.id, database,
      serverVersionNum: Number(serverVersion), schemaMode: "PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA",
      migrationLedgerReplayed: false, publicTables: Number(tables),
      ...(settledReturns && { terminalMigrationApplied: require("./issue435-postgres-fixture.cjs").migrationDirectory }),
      companyTransferGuards: "issue411-company-transfer-guards.sql",
      containerRuntime: "docker_postgresql16_disposable", smsProvider: "DISABLED",
      phases, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scopeWarning: settledReturns
        ? "合成流水和审批使用隔离种子，验证 #411 原用例与 #435 退款、更正、资金投影、经营账和审计；未走 HTTP 登录且未重放完整迁移链"
        : "本用例证明真实 PG 上第三家公司代还的 A-B 清结、A-C 债权、同一债务重复入账拒绝、原债更正净额与台账代还来源；Schema 由 db push 建立并安装从既有迁移抽取的公司互转守卫（迁移链未能整体重放）；直接使用 Prisma 写入合成事实，未走 HTTP 登录"
    };
    process.stdout.write(`${settledReturns ? "ISSUE435" : "ISSUE411"}_RECEIPT ${JSON.stringify(receipt)}\n`);
  } finally {
    if (process.env.ISSUE411_KEEP === "1") {
      process.stderr.write(`ISSUE411_KEEP container=${containerName}\n`);
    } else {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId)) {
        try { docker(["rm", "--force", "--volumes", containerId], { quiet: true }); } catch {}
        if (settledReturns) {
          const remaining = docker(["ps", "--all", "--quiet", "--filter", `id=${containerId}`], { quiet: true }).stdout;
          if (remaining) throw new Error("隔离 PostgreSQL 容器未退出");
          process.stdout.write("ISSUE435_CLEANUP containerAbsent=true\n");
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`ISSUE411 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
