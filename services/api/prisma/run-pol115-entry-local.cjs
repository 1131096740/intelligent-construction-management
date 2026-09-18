"use strict";
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const root = path.resolve(__dirname, "../../..");
const name = `jiangkong-pol115-entry-${Date.now()}-${process.pid}`;
const password = randomUUID();
function command(bin, args, env = process.env, capture = false) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`POL115 本地命令失败：${bin} ${args[0]}`);
  return result.stdout?.trim();
}
if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
const endpoint = command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://") || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
try {
  command("docker", ["run", "--detach", "--rm", "--pull=never", "--name", name, "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_DB=jiangkong_pol115_entry_test", "--publish", "127.0.0.1::5432", "postgres:16"], { ...process.env, POSTGRES_PASSWORD: password });
  const port = command("docker", ["port", name, "5432/tcp"], process.env, true).split(":").pop();
  command("docker", ["exec", name, "sh", "-c", "until pg_isready -U jiangkong -d jiangkong_pol115_entry_test; do sleep 0.2; done"]);
  command(process.execPath, [path.join(__dirname, "wait-for-local-tcp-ready.cjs"), port]);
  const env = { ...process.env, FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: mkdtempSync(path.join(tmpdir(), "pol115-entry-files-")), XDG_CACHE_HOME: mkdtempSync(path.join(tmpdir(), "pol115-entry-cache-")), NODE_ENV: "test", RUN_POL115_ENTRY_PG16: "1", DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/jiangkong_pol115_entry_test` };
  command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], env);
  command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", ...process.argv.slice(2).length ? process.argv.slice(2) : ["src/expense-claim/expense-claim-entry.http.pg.spec.ts", "src/fund-execution/fund-execution-entry.http.pg.spec.ts"]], env);
} finally {
  command("docker", ["rm", "--force", name]);
}
