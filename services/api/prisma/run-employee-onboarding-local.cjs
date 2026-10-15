"use strict";

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const password = randomUUID();
const name = `jiangkong-onboarding-http-${randomUUID()}`;
let containerId;

function command(bin, args, env = process.env, quiet = false, timeout = 180_000) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`EMPLOYEE_ONBOARDING 本地验证命令失败：${bin} ${args[0]}`);
  return result.stdout.trim();
}

if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
const docker = (args, env = process.env, quiet = false) => command("docker", ["--host", endpoint, ...args], env, quiet);

try {
  containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_DB=onboarding",
    "--publish", "127.0.0.1::5432", "postgres:16"], { ...process.env, POSTGRES_PASSWORD: password }, true);
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("一次性容器标识无效");
  const binding = docker(["port", containerId, "5432/tcp"], process.env, true);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
  if (!port) throw new Error("数据库必须仅监听本机回环地址");
  docker(["exec", containerId, "sh", "-c", "for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d onboarding && exit 0; sleep 0.2; done; exit 1"], process.env, true);
  const env = { ...process.env, NODE_ENV: "test", RUN_EMPLOYEE_ONBOARDING_PG16: "1",
    INITIAL_USER_TEMPORARY_PASSWORD: "Local-Initial-Only-01", SMS_ENABLED: "false",
    DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/onboarding` };
  console.log(`EMPLOYEE_ONBOARDING 一次性容器：${name}`);
  docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "onboarding", "-Atc", "SHOW server_version;"]);
  command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], env);
  const runtime = "onboarding_runtime";
  docker(["exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "onboarding", "-c", `
    CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';
    GRANT USAGE ON SCHEMA public TO ${runtime};
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${runtime};
    REVOKE ALL ON TABLE public."OperatingLedgerWriteSecret", public."OperatingLedgerWriteContext" FROM ${runtime};
    GRANT INSERT, UPDATE, DELETE ON TABLE public."User", public."UserPosition", public."Position", public."Department",
      public."Project", public."ProjectMember", public."ProjectRosterMember", public."RefreshToken", public."AuditLog" TO ${runtime};
  `], process.env, true);
  const before = docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "onboarding", "-Atc",
    `SELECT has_table_privilege('${runtime}', 'public."AuthRateLimit"', 'DELETE');`], process.env, true);
  if (before !== "f") throw new Error("本地运行身份必须先没有新表写权限");
  docker(["cp", path.join(__dirname, "employee-onboarding-runtime-grants.sql"), `${containerId}:/tmp/onboarding-grants.sql`], process.env, true);
  docker(["exec", "--env", `OPERATING_LEDGER_RUNTIME_ROLE=${runtime}`, containerId, "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "jiangkong", "-d", "onboarding", "--file=/tmp/onboarding-grants.sql"], process.env, true);
  env.DATABASE_URL = `postgresql://${runtime}:${password}@127.0.0.1:${port}/onboarding`;
  command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/employee-onboarding-http-postgres.spec.ts"], env);
} finally {
  if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    docker(["rm", "--force", containerId], process.env, true);
    console.log(`EMPLOYEE_ONBOARDING 已清理自身容器：${name}`);
  }
}
