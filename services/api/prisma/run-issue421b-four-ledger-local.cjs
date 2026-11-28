#!/usr/bin/env node
"use strict";

// #421b 付款/零星采购/综合采购/报销四类台账筛选与导出真实 PostgreSQL 16 + HTTP 验证。
// 只创建本机一次性容器；Schema 由 prisma/schema.prisma 经 db push 建立（未重放迁移账），
// 不接触生产、真实数据或外部网关。
const { randomUUID, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const image = "postgres:16";
const database = "jiangkong_issue421b_ledger";
const specFile = "src/database/issue421b-four-ledger.http.pg.spec.ts";
const runId = randomUUID();
const containerName = `jiangkong-issue421-line-aj-${runId}`;
const password = randomUUID();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "issue421b-ledger-"));
const storageRoot = path.join(temporaryRoot, "private-storage");
let containerId;
let endpoint;

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`ISSUE421B_LEDGER 命令失败：${bin} ${args[0]}`);
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);
const pnpm = () => process.env.PNPM_BIN?.trim() || "pnpm";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
  endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
    process.env, { quiet: true }).stdout.replace(/^"|"$/gu, "");
  if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
  const candidateSha = command("git", ["rev-parse", "HEAD"], process.env, { quiet: true }).stdout;
  const dirty = command("git", ["status", "--porcelain=v1"], process.env, { quiet: true }).stdout;
  const imageId = docker(["image", "inspect", "--format", "{{.Id}}", image], { quiet: true }).stdout;
  if (!imageId) throw new Error(`本机缺少已缓存镜像 ${image}`);
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
      "--env", `POSTGRES_DB=${database}`, "--publish", "127.0.0.1::5432", image], { quiet: true }).stdout;
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
    const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, NODE_ENV: "test", CI: "true", DATABASE_URL: databaseUrl,
      FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storageRoot,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex") };
    await phase("prisma-generate", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      env, { quiet: true }));
    await phase("schema-db-push", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "db", "push", "--skip-generate"],
      { ...env, CHECKPOINT_DISABLE: "1" }, { quiet: true }));
    const tables = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`], { quiet: true }).stdout;
    await phase("pg-ledger-spec", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand",
      "--runTestsByPath", specFile], { ...env, ISSUE421B_LEDGER_RUN: "1" }, { timeout: 600_000 }));
    const receipt = {
      schemaVersion: 1, purpose: "ISSUE421B_FOUR_LEDGER_EXPORT", status: "PASSED",
      candidateSha, worktreeClean: dirty.length === 0, containerImage: image, imageId, database,
      schemaMode: "PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA", migrationLedgerReplayed: false,
      publicTables: Number(tables), containerRuntime: "docker_postgresql16_disposable",
      phases, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scopeWarning: "本用例证明真实 PG/HTTP 的付款/零星采购/综合采购/报销四类台账服务端筛选与导出一致、逐行可见性不因导出绕过、金额/日期单元格、公式注入转义与未知金额不写 0；Schema 由 db push 建立，不是迁移重放"
    };
    process.stdout.write(`ISSUE421B_RECEIPT ${JSON.stringify(receipt)}\n`);
  } finally {
    if (process.env.ISSUE421B_KEEP === "1") {
      process.stderr.write(`ISSUE421B_KEEP container=${containerName}\n`);
    } else {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId)) {
        try { docker(["rm", "--force", "--volumes", containerId], { quiet: true }); } catch {}
      }
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`ISSUE421B_LEDGER 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
