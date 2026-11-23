#!/usr/bin/env node
"use strict";

//  #418 经营总览与成本主体归属统一去重真实 PostgreSQL 16 验证。
// 只创建本机一次性容器；Schema 由 prisma/schema.prisma 经 db push 建立（未重放迁移账），
// 不接触生产、真实数据或外部支付/短信网关。
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const image = "postgres:16";
const database = "jiangkong_issue418";
const specFile = "src/database/issue418-operating-dedup.pg.spec.ts";
const runId = randomUUID();
const containerName = `jiangkong-issue418-line-ai-${runId}`;
const password = randomUUID();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "issue418-operating-dedup-"));
let containerId;
let endpoint;

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`ISSUE418_OPERATING_DEDUP 命令失败：${bin} ${args[0]}`);
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);

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
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
      ISSUE418_OPERATING_DEDUP_DATABASE_URL: databaseUrl, ISSUE418_OPERATING_DEDUP_RUN: "1" };
    await phase("prisma-generate", () => command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      env, { quiet: true }));
    await phase("schema-db-push", () => command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "db", "push", "--skip-generate"],
      { ...env, CHECKPOINT_DISABLE: "1" }, { quiet: true }));
    await phase("pg-operating-dedup-spec", () => command("pnpm", ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand",
      "--runTestsByPath", specFile], env, { timeout: 600_000 }));
    const tables = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`], { quiet: true }).stdout;
    const receipt = {
      schemaVersion: 1, purpose: "ISSUE418_OPERATING_DEDUP", status: "PASSED",
      candidateSha, worktreeClean: dirty.length === 0, containerImage: image, imageId, database,
      schemaMode: "PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA", migrationLedgerReplayed: false,
      publicTables: Number(tables), containerRuntime: "docker_postgresql16_disposable",
      phases, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scopeWarning: "本用例证明真实 PG 上同一合同双入口只计一次成本、upward/outside 已签结算进入投影、施工企业已付与项目对外支付成对且不可相加、成本归属/来源追溯可查、FND-22 待归属确认后只改分账不加成本、FND-23 资金流水与经营事实一致且可导出、OPS-14 按合同钻取与总览一致；经营事实由 Prisma 直接落表（未重放经营账数据库函数/迁移账），不是生产迁移重放"
    };
    process.stdout.write(`ISSUE418_OPERATING_DEDUP_RECEIPT ${JSON.stringify(receipt)}\n`);
  } finally {
    if (process.env.ISSUE417_KEEP === "1") {
      process.stderr.write(`ISSUE417_KEEP container=${containerName}\n`);
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
    process.stderr.write(`ISSUE418_OPERATING_DEDUP 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
