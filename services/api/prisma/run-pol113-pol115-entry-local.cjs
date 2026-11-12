#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");
const { pol113Pol115JestArgs } = require("./pol113-pol115-jest-command.cjs");

const root = path.resolve(__dirname, "../../..");
const pnpm = process.env.PNPM_BIN?.trim() || "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const jestPrefix = pol113Pol115JestArgs([], process.env);

function command(bin, args, env = process.env, capture = false) {
  const result = spawnSync(bin, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`POL113-POL115 本地入口门失败：${path.basename(bin)} ${args[0] ?? ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function localDockerEndpoint() {
  const endpoint = process.env.DOCKER_HOST ||
    command(docker, ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
  if (!endpoint.startsWith("unix://") && !endpoint.startsWith("npipe://")) {
    throw new Error("只允许本机 Docker");
  }
  return endpoint;
}

async function runDedicatedDatabase({ id, database, flags, spec }) {
  const name = `jiangkong-${id}-${Date.now()}-${process.pid}`;
  const password = randomUUID();
  const runId = randomUUID();
  const files = mkdtempSync(path.join(tmpdir(), `${id}-files-`));
  const cache = mkdtempSync(path.join(tmpdir(), `${id}-cache-`));
  const endpoint = localDockerEndpoint();
  const dockerEnv = { ...process.env, DOCKER_HOST: endpoint };
  delete dockerEnv.DOCKER_CONTEXT;
  let started = false;
  try {
    const containerId = command(docker, [
      "--host", endpoint,
      "run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,
      "--env", "POSTGRES_PASSWORD",
      "--env", "POSTGRES_USER=jiangkong",
      "--env", `POSTGRES_DB=${database}`,
      "--publish", "127.0.0.1::5432",
      "postgres:16"
    ], { ...dockerEnv, POSTGRES_PASSWORD: password }, true);
    started = true;
    command(docker, [
      "--host", endpoint,
      "exec", name, "sh", "-c",
      `until pg_isready -h 127.0.0.1 -U jiangkong -d ${database}; do sleep 0.2; done`
    ], dockerEnv);
    const binding = command(
      docker,
      ["--host", endpoint, "port", name, "5432/tcp"],
      dockerEnv,
      true
    );
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];
    if (!port) throw new Error("数据库必须仅监听本机回环地址");
    const env = {
      ...process.env,
      DOCKER_HOST: endpoint,
      NODE_ENV: "test",
      OPERATING_LEDGER_DB_WRITE_SECRET: randomUUID(),
      FILE_STORAGE_DRIVER: "local",
      FILE_STORAGE_ROOT: files,
      XDG_CACHE_HOME: cache,
      PNPM_BIN: pnpm,
      DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`,
      ...flags
    };
    delete env.DOCKER_CONTEXT;
    const runtime = createCommandRuntime({ defaultCwd: root });
    const migration = createCiDynamicMigrationFixture({
      ciFixture: "DYNAMIC_POL113_POL115_ENTRY_V1",
      container: { id: containerId, name, runId },
      databaseNames: [database],
      temporaryRoot: cache,
      dockerCommand: (args, options) => runtime.command(docker, ["--host", endpoint, ...args], { ...options, env: dockerEnv }),
      deploy: ({ databaseUrl, runtimeEnv, schemaPath }) => runtime.command(pnpm,
        ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy",
          ...(schemaPath ? ["--schema", schemaPath] : [])],
        { env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, forwardOutput: true })
    });
    await migration.migrate({ databaseUrl: env.DATABASE_URL, runtimeEnv: env });
    command(pnpm, [...jestPrefix, spec], env);
  } finally {
    if (started) {
      spawnSync(docker, ["--host", endpoint, "rm", "--force", "--volumes", name], {
        cwd: root,
        env: dockerEnv,
        stdio: "ignore"
      });
    }
    rmSync(files, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
  localDockerEndpoint();

  command(process.execPath, [path.join(__dirname, "run-pol113-http-local.cjs")], {
    ...process.env,
    PNPM_BIN: pnpm,
    RUN_POL113_PROJECT_BROWSER: "1"
  });
  command(process.execPath, [path.join(__dirname, "run-pol115-entry-local.cjs")], {
    ...process.env,
    PNPM_BIN: pnpm,
    RUN_POL115_BROWSER: "1"
  });
  await runDedicatedDatabase({
    id: "pol114-entry",
    database: "jiangkong_pol114",
    flags: {
      RUN_POL114_HTTP_PG16: "1",
      RUN_POL114_BROWSER: "1",
      RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16: "1",
      RUN_POL114_PAYMENT_HTTP_PG16: "1"
    },
    spec: "src/database/contract-business-entry-http.spec.ts"
  });
  await runDedicatedDatabase({
    id: "pol115-spot-entry",
    database: "jiangkong_pol115_spot_entry_test",
    flags: {
      RUN_POL115_SPOT_ENTRY_PG16: "1",
      RUN_POL115_BROWSER: "1"
    },
    spec: "src/spot-procurement/spot-procurement-entry.http.pg.spec.ts"
  });
  await runDedicatedDatabase({
    id: "settlement-template-workbench",
    database: "template_workbench",
    flags: { RUN_TEMPLATE_WORKBENCH_PG16: "1" },
    spec: "src/settlement/settlement-template-workbench.http.pg.spec.ts"
  });
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
