#!/usr/bin/env node
"use strict";

// #419 real PostgreSQL 16 verification for contract/payment correction SMS.
// Creates only its own disposable container on 127.0.0.1, creates the schema
// from prisma/schema.prisma with `prisma db push` (no migration replay), runs
// the guarded PG diagnostic spec, and removes the container. It never contacts
// production, real data, or a real SMS provider.
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const image = "postgres:16";
const database = "jiangkong_issue419_correction";
const specFile = "src/approval/duty-correction-notification.pg.diagnostic.spec.ts";
const runId = randomUUID();
const containerName = `jiangkong-issue419-line-f-${runId}`;
const password = randomUUID();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "issue419-notification-"));
let containerId;
let endpoint;

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`ISSUE419_NOTIFICATION 命令失败：${bin} ${args[0]}`);
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
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false" };
    await phase("prisma-generate", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
      env, { quiet: true }));
    await phase("schema-db-push", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "db", "push", "--skip-generate"],
      { ...env, CHECKPOINT_DISABLE: "1" }, { quiet: true }));
    const tables = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`], { quiet: true }).stdout;
    await phase("pg-correction-spec", () => command(pnpm(), ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand",
      "--runTestsByPath", specFile], { ...env, ISSUE419_CORRECTION_DATABASE_URL: databaseUrl }, { timeout: 600_000 }));
    const receipt = {
      schemaVersion: 1, purpose: "ISSUE419_NTF04_CORRECTION_OUTBOX", status: "PASSED",
      candidateSha, worktreeClean: dirty.length === 0, containerImage: image, imageId, database,
      schemaMode: "PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA", migrationLedgerReplayed: false,
      publicTables: Number(tables), containerRuntime: "docker_postgresql16_disposable",
      provider: "SIMULATED_IN_MEMORY", realProviderEnabled: false,
      phases, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scopeWarning: "本用例证明真实 PG 的事务/幂等/审计/派发行为；Schema 由 db push 建立，不是迁移重放，也不包含真实短信送达"
    };
    process.stdout.write(`ISSUE419_RECEIPT ${JSON.stringify(receipt)}\n`);
  } finally {
    if (process.env.ISSUE419_KEEP === "1") {
      process.stderr.write(`ISSUE419_KEEP container=${containerName}\n`);
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
    process.stderr.write(`ISSUE419_NOTIFICATION 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
