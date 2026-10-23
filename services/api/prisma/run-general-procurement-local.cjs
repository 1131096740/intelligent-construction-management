"use strict";

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const storageRoot = mkdtempSync(path.join(tmpdir(), "general-procurement-files-"));

const root = path.resolve(__dirname, "../../..");
const password = randomUUID();
const name = `jiangkong-general_procurement-http-${randomUUID()}`;
let containerId;

function command(bin, args, env = process.env, quiet = false, timeout = 180_000) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`GENERAL_PROCUREMENT 本地验证命令失败：${bin} ${args[0]}`);
  return result.stdout.trim();
}

if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
const docker = (args, env = process.env, quiet = false) => command("docker", ["--host", endpoint, ...args], env, quiet);

try {
  containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_DB=general_procurement",
    "--publish", "127.0.0.1::5432", "postgres:16"], { ...process.env, POSTGRES_PASSWORD: password }, true);
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("一次性容器标识无效");
  const binding = docker(["port", containerId, "5432/tcp"], process.env, true);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
  if (!port) throw new Error("数据库必须仅监听本机回环地址");
  docker(["exec", containerId, "sh", "-c", "for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d general_procurement && exit 0; sleep 0.2; done; exit 1"], process.env, true);
  const env = { ...process.env, NODE_ENV: "test", RUN_GENERAL_PROCUREMENT_PG16: "1", RUN_GENERAL_PROCUREMENT_BROWSER: "1",
    FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storageRoot,
    INITIAL_USER_TEMPORARY_PASSWORD: "Local-Initial-Only-01", SMS_ENABLED: "false",
    DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/general_procurement` };
  console.log(`GENERAL_PROCUREMENT 一次性容器：${name}`);
  docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "general_procurement", "-Atc", "SHOW server_version;"]);
  command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], env);
  // Preserve the inherited CRUD state on the new table: deployment must remove DELETE itself.
  const runtime = "general_procurement_runtime";
  docker(["exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "general_procurement", "-c", `
    CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';
    GRANT USAGE ON SCHEMA public TO ${runtime};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtime};
    REVOKE ALL ON TABLE public."OperatingLedgerWriteSecret", public."OperatingLedgerWriteContext" FROM ${runtime};
    REVOKE INSERT, UPDATE, DELETE ON TABLE public."OperatingFact" FROM ${runtime};
  `], process.env, true);
  docker(["cp", path.join(__dirname, "general-procurement-runtime-grants.sql"), `${containerId}:/tmp/procurement-grants.sql`], process.env, true);
  docker(["exec", "--env", `OPERATING_LEDGER_RUNTIME_ROLE=${runtime}`, containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "general_procurement", "--file=/tmp/procurement-grants.sql"], process.env, true);
  const grants = docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "general_procurement", "-Atc", `SELECT has_table_privilege('${runtime}', 'public."GeneralProcurement"', 'INSERT'), has_table_privilege('${runtime}', 'public."GeneralProcurement"', 'DELETE');`], process.env, true);
  if (grants !== "t|f") throw new Error("新表运行权限必须可写、不可删除");
  env.DATABASE_URL = `postgresql://${runtime}:${password}@127.0.0.1:${port}/general_procurement`;
  command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/general-procurement-http-postgres.spec.ts", "src/database/approval-v6-migration-postgres.spec.ts"], env, false, 300_000);
} finally {
  rmSync(storageRoot, { recursive: true, force: true });
  if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    docker(["rm", "--force", "--volumes", containerId], process.env, true);
    console.log(`GENERAL_PROCUREMENT 已清理自身容器：${name}`);
  }
}

// Keep cross-project scope and approval isolation in the same mandatory CI shard.
command(process.execPath, [path.join(__dirname, "run-project-business-scope-local.cjs")], process.env, false, 360_000);
