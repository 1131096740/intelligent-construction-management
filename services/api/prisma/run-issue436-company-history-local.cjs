#!/usr/bin/env node
const { randomBytes, randomUUID } = require("node:crypto");
const { appendFileSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");

const root = resolve(__dirname, "../../..");
const migration = "20261129021000_company_history_expense";
const candidate = process.argv[2];
const image = process.argv[3];
const runId = randomUUID();
const password = randomBytes(24).toString("hex");
const database = "jiangkong_line_a_real_db";
const name = `jiangkong-issue436-company-${runId}`;
let container;
let endpoint;
let evidence;
let volumes = [];

function log(file, output) {
  if (evidence) appendFileSync(join(evidence, file), output.replaceAll(password, "[redacted]"), { mode: 0o600 });
}

function run(bin, args, { env = process.env, timeout = 30_000, quiet = false, stdin, bothStreams = false, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, timeout, encoding: "utf8", maxBuffer, input: stdin });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (result.error || result.status !== 0) {
    log("first-error.log", `${bin} ${args[0]} exit=${result.error?.code ?? result.status}\n${output}\n`);
    process.stderr.write(output);
    throw new Error(`#436 命令失败 ${bin} ${args[0]} (${result.error?.code ?? result.status})`);
  }
  if (!quiet) process.stdout.write(output);
  return bothStreams ? output.trim() : (result.stdout ?? "").trim();
}

function docker(args, options) {
  return run("docker", ["--host", endpoint, ...args], options);
}

function cleanup() {
  let cleaned = false;
  try {
    if (container && /^[a-f0-9]{64}$/u.test(container)) {
      docker(["rm", "--force", "--volumes", container], { quiet: true });
      container = undefined;
    }
    const remaining = docker(["ps", "-aq", "--filter", `name=^/${name}$`], { quiet: true });
    const currentVolumes = docker(["volume", "ls", "--format", "{{.Name}}"], { quiet: true }).split("\n");
    cleaned = remaining.length === 0 && volumes.every(volume => !currentVolumes.includes(volume));
    if (!cleaned) throw new Error("隔离 PostgreSQL 容器或匿名卷仍存在");
  } finally {
    log("cleanup.json", JSON.stringify({ containerName: name, volumes, cleaned }) + "\n");
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" || !/^[0-9a-f]{40}$/.test(candidate ?? "") ||
      !/^sha256:[0-9a-f]{64}$/.test(image ?? "")) {
    throw new Error("请传入隔离工作树完整提交 SHA 和本机缓存镜像 ID，仅限本地测试");
  }
  if (run("git", ["rev-parse", "HEAD"], { quiet: true }) !== candidate ||
      run("git", ["status", "--porcelain"], { quiet: true })) {
    throw new Error("工作树必须干净且与 #436 验收提交一致");
  }
  endpoint = process.env.DOCKER_HOST ||
    run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { quiet: true });
  if (!endpoint.startsWith("unix://")) throw new Error("仅配置本机 Docker Unix 接口");
  if (docker(["image", "inspect", "--format", "{{.Id}}", image], { quiet: true }) !== image) {
    throw new Error("缺少已缓存的指定 PostgreSQL 镜像");
  }
  const startedAt = new Date().toISOString();
  evidence = mkdtempSync(join(tmpdir(), "jg436-company-history-pg-"));
  const stagedRoot = mkdtempSync(join(evidence, "staged-"));
  writeFileSync(join(evidence, "run.json"), JSON.stringify({ candidateSha: candidate, runId, containerName: name, image, startedAt }), { mode: 0o600 });
  process.stdout.write(`ISSUE436_PG_EVIDENCE ${evidence}\n`);
  try {
    container = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", "org.jiangkong.task=issue436-company-history",
      "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`, "--env", `POSTGRES_DB=${database}`,
      "--publish", "127.0.0.1::5432", image], { quiet: true });
    if (!/^[a-f0-9]{64}$/u.test(container)) throw new Error("一次性容器标识无效");
    const mounts = JSON.parse(docker(["inspect", "--type", "container", "--format", "{{json .Mounts}}", container], { quiet: true }));
    volumes = mounts.filter(mount => mount.Type === "volume").map(mount => mount.Name);
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(docker(["port", container, "5432/tcp"], { quiet: true }))?.[1];
    if (!port) throw new Error("数据库必须在本机回环地址");
    docker(["exec", container, "sh", "-c",
      'for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" && exit 0; sleep 0.25; done; exit 1'
    ], { quiet: true, timeout: 35_000 });
    const url = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: url, CHECKPOINT_DISABLE: "1",
      ISSUE436_COMPANY_HISTORY_RUN: "1", ISSUE436_COMPANY_HISTORY_DATABASE_URL: url,
      ISSUE436_COMPANY_HISTORY_RUN_ID: runId,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false" };
    const prisma = ["--filter", "@jiangkong/api", "exec", "prisma"];
    run("pnpm", [...prisma, "generate"], { env, timeout: 60_000, quiet: true });
    const staged = createCiDynamicMigrationFixture({
      ciFixture: "DYNAMIC_LINE_A_V1",
      container: { id: container, name, runId },
      databaseNames: [database],
      temporaryRoot: stagedRoot,
      dockerCommand: (args, options) => ({ stdout: docker(args, {
        quiet: true, timeout: options.timeoutMs, stdin: options.stdinText, maxBuffer: options.maxOutputBytes * 2
      }) }),
      deploy({ databaseUrl, runtimeEnv, schemaPath }) {
        const stdout = run("pnpm", [...prisma, "migrate", "deploy", "--schema", schemaPath], {
          env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, timeout: 240_000, quiet: true
        });
        return { stdout };
      }
    });
    const migrationResult = await staged.migrate({
      databaseUrl: url, runtimeEnv: env, schemaPath: join(root, "services/api/prisma/schema.prisma")
    });
    log("migration.log", migrationResult.stdout + "\n");
    docker(["exec", container, "psql", "-XAt", "--set=ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-c",
      `ALTER DATABASE "${database}" SET "app.issue436_company_run" = '${runId}'`
    ], { quiet: true });
    const migrationCounts = docker(["exec", container, "psql", "-XAt", "--set=ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*), count(*) FILTER (WHERE migration_name = '${migration}') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    ], { quiet: true });
    if (!/^\d+\|1$/.test(migrationCounts)) throw new Error("未找到唯一已完成的 #436 迁移收据");
    run("pnpm", ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", "--runTestsByPath",
      "src/database/issue436-company-history-expense.pg.spec.ts"], { env, timeout: 90_000 });
    cleanup();
    const receipt = {
      status: "PASSED", candidateSha: candidate, migration, migrationCount: Number(migrationCounts.split("|")[0]),
      migrationMode: "CANONICAL_STAGED_FULL_REPLAY", image, database, startedAt, finishedAt: new Date().toISOString(), cleaned: true
    };
    log("receipt.json", JSON.stringify(receipt) + "\n");
    process.stdout.write(`ISSUE436_COMPANY_HISTORY_RECEIPT ${JSON.stringify(receipt)}\n`);
  } catch (error) {
    log("first-error.log", error.message + "\n");
    if (container) {
      try {
        log("postgres.log", docker(["logs", container], { quiet: true, bothStreams: true }) + "\n");
      } catch (logError) {
        log("first-error.log", logError.message + "\n");
      }
    }
    cleanup();
    throw error;
  } finally {
    rmSync(stagedRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
