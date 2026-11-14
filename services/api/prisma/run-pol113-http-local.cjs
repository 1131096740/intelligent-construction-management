"use strict";

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");
const { pol113Pol115JestArgs } = require("./pol113-pol115-jest-command.cjs");

const root = path.resolve(__dirname, "../../..");
const password = randomUUID();
const runId = randomUUID();
const name = `jiangkong-pol113-http-${runId}`;
const database = "pol113";
const pnpm = process.env.PNPM_BIN?.trim() || "pnpm";
let containerId;

function command(bin, args, env = process.env, quiet = false, timeout = 180_000) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`POL113 本地验证命令失败：${bin} ${args[0]}`);
  return result.stdout.trim();
}

if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
const jestArgs = [...pol113Pol115JestArgs([], process.env),
  "--config", "jest.runtime.config.cjs", "src/database/base-entry-http-postgres.spec.ts"];
if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
const docker = (args, env = process.env, quiet = false) => command("docker", ["--host", endpoint, ...args], env, quiet);

async function main() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pol113-migration-"));
  try {
    containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,
      "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_DB=${database}`,
      "--publish", "127.0.0.1::5432", "postgres:16"], { ...process.env, POSTGRES_PASSWORD: password }, true);
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("一次性容器标识无效");
    const binding = docker(["port", containerId, "5432/tcp"], process.env, true);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
    if (!port) throw new Error("数据库必须仅监听本机回环地址");
    docker(["exec", containerId, "sh", "-c", "for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d pol113 && exit 0; sleep 0.2; done; exit 1"], process.env, true);
    const env = { ...process.env, NODE_ENV: "test", RUN_POL113_HTTP_PG16: "1",
      DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/pol113` };
    console.log(`POL113 一次性容器：${name}`);
    docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "pol113", "-Atc", "SHOW server_version;"]);
    const runtime = createCommandRuntime({ defaultCwd: root, defaultTimeoutMs: 180_000 });
    const migration = createCiDynamicMigrationFixture({
      ciFixture: "DYNAMIC_POL113_POL115_ENTRY_V1",
      container: { id: containerId, name, runId },
      databaseNames: [database],
      temporaryRoot,
      dockerCommand: (args, options) => runtime.command("docker", ["--host", endpoint, ...args], { ...options, env: process.env }),
      deploy: ({ databaseUrl, runtimeEnv, schemaPath }) => runtime.command(pnpm,
        ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy",
          ...(schemaPath ? ["--schema", schemaPath] : [])],
        { env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, forwardOutput: true })
    });
    await migration.migrate({ databaseUrl: env.DATABASE_URL, runtimeEnv: env });
    // The existing browser case allows 210s; its parent must also cover pretest and the other HTTP cases.
    const testTimeout = env.RUN_POL113_PROJECT_BROWSER === "1" ? 300_000 : 180_000;
    command(pnpm, jestArgs, env, false, testTimeout);
  } finally {
    try {
      if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
        docker(["rm", "--force", "--volumes", containerId], process.env, true);
        console.log(`POL113 已清理自身容器：${name}`);
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
