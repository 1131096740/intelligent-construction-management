#!/usr/bin/env node
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../../..");
const migration = "20261129021000_company_history_expense";
const candidate = process.argv[2];
const image = process.argv[3];
const token = randomBytes(6).toString("hex");
const password = randomBytes(24).toString("hex");
const database = `issue436_company_${token}`;
const name = `jg-issue436-company-${token}`;
let container;
let endpoint;

function run(bin, args, { env = process.env, timeout = 30_000, quiet = false } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`#436 命令失败 ${bin} ${args[0]} (${result.error?.code ?? result.status})`);
  return (result.stdout ?? "").trim();
}

function docker(args, options) {
  return run("docker", ["--host", endpoint, ...args], options);
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
  try {
    container = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", "org.jiangkong.task=issue436-company-history",
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`, "--env", `POSTGRES_DB=${database}`,
      "--publish", "127.0.0.1::5432", image], { quiet: true });
    if (!/^[a-f0-9]{64}$/u.test(container)) throw new Error("一次性容器标识无效");
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(docker(["port", container, "5432/tcp"], { quiet: true }))?.[1];
    if (!port) throw new Error("数据库必须在本机回环地址");
    docker(["exec", container, "sh", "-c",
      'for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" && exit 0; sleep 0.25; done; exit 1'
    ], { quiet: true, timeout: 35_000 });
    const url = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: url, CHECKPOINT_DISABLE: "1",
      ISSUE436_COMPANY_HISTORY_RUN: "1", ISSUE436_COMPANY_HISTORY_DATABASE_URL: url,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false" };
    const prisma = ["--filter", "@jiangkong/api", "exec", "prisma"];
    run("pnpm", [...prisma, "generate"], { env, timeout: 60_000, quiet: true });
    run("pnpm", [...prisma, "migrate", "deploy"], { env, timeout: 240_000, quiet: true });
    const migrationCounts = docker(["exec", container, "psql", "-XAt", "--set=ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*), count(*) FILTER (WHERE migration_name = '${migration}') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    ], { quiet: true });
    if (!/^\d+\|1$/.test(migrationCounts)) throw new Error("未找到唯一已完成的 #436 迁移收据");
    run("pnpm", ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", "--runTestsByPath",
      "src/database/issue436-company-history-expense.pg.spec.ts"], { env, timeout: 90_000 });
    docker(["rm", "--force", "--volumes", container], { quiet: true });
    container = undefined;
    const remaining = docker(["ps", "-aq", "--filter", `name=^/${name}$`], { quiet: true });
    if (remaining) throw new Error("隔离 PostgreSQL 资源仍存在");
    process.stdout.write(`ISSUE436_COMPANY_HISTORY_RECEIPT ${JSON.stringify({
      status: "PASSED", candidateSha: candidate, migration, migrationCount: Number(migrationCounts.split("|")[0]),
      image, database, startedAt, finishedAt: new Date().toISOString(), cleaned: true
    })}\n`);
  } finally {
    if (container && /^[a-f0-9]{64}$/u.test(container)) {
      docker(["rm", "--force", "--volumes", container], { quiet: true });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
