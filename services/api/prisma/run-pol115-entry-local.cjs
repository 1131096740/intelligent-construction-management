"use strict";
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");
const root = path.resolve(__dirname, "../../..");
const runId = randomUUID();
const name = `jiangkong-pol115-entry-${runId}`;
const database = "jiangkong_pol115_entry_test";
const pnpm = process.env.PNPM_BIN?.trim() || "pnpm";
const password = randomUUID();
function command(bin, args, env = process.env, capture = false) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`POL115 本地命令失败：${bin} ${args[0]}`);
  return result.stdout?.trim();
}
if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
const dockerEnv = { ...process.env, DOCKER_HOST: endpoint };
delete dockerEnv.DOCKER_CONTEXT;
const docker = (args, env = dockerEnv, capture = false) => command("docker", ["--host", endpoint, ...args], env, capture);

async function main() {
  const files = mkdtempSync(path.join(tmpdir(), "pol115-entry-files-"));
  const cache = mkdtempSync(path.join(tmpdir(), "pol115-entry-cache-"));
  let containerId;
  try {
    containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`, "--env", "POSTGRES_PASSWORD",
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_DB=${database}`, "--publish",
      "127.0.0.1::5432", "postgres:16"], { ...dockerEnv, POSTGRES_PASSWORD: password }, true);
    if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("一次性容器标识无效");
    const binding = docker(["port", containerId, "5432/tcp"], dockerEnv, true);
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];
    if (!port) throw new Error("数据库必须仅监听本机回环地址");
    docker(["exec", containerId, "sh", "-c", `until pg_isready -h 127.0.0.1 -U jiangkong -d ${database}; do sleep 0.2; done`]);
    command(process.execPath, [path.join(__dirname, "wait-for-local-tcp-ready.cjs"), port]);
    const env = { ...dockerEnv, FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files, XDG_CACHE_HOME: cache,
      NODE_ENV: "test", RUN_POL115_ENTRY_PG16: "1",
      DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}` };
    const runtime = createCommandRuntime({ defaultCwd: root });
    const migration = createCiDynamicMigrationFixture({
      ciFixture: "DYNAMIC_POL113_POL115_ENTRY_V1",
      container: { id: containerId, name, runId },
      databaseNames: [database],
      temporaryRoot: cache,
      dockerCommand: (args, options) => runtime.command("docker", ["--host", endpoint, ...args], { ...options, env: dockerEnv }),
      deploy: ({ databaseUrl, runtimeEnv, schemaPath }) => runtime.command(pnpm,
        ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy",
          ...(schemaPath ? ["--schema", schemaPath] : [])],
        { env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, forwardOutput: true })
    });
    await migration.migrate({ databaseUrl: env.DATABASE_URL, runtimeEnv: env });
    command(pnpm, ["--filter", "@jiangkong/api", "test", "--", "--runInBand", ...process.argv.slice(2).length ? process.argv.slice(2) : ["src/operating-takeover/operating-takeover-entry.http.pg.spec.ts", "src/database/approval-v6-independent-http-postgres.spec.ts", "src/expense-claim/expense-claim-entry.http.pg.spec.ts", "src/fund-execution/fund-execution-entry.http.pg.spec.ts", "src/database/draft-hard-deletion.pg.spec.ts", "src/database/draft-deletion-numbering.pg.spec.ts"]], env);
  } finally {
    try {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId)) docker(["rm", "--force", "--volumes", containerId]);
    } finally {
      rmSync(files, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
