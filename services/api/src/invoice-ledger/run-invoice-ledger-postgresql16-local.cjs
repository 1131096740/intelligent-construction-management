#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("../../prisma/money-bigint-runner-runtime.cjs");
const {
  waitForLocalTcpReady
} = require("../../prisma/wait-for-local-tcp-ready.cjs");

const DATABASE_NAME = "jiangkong_invoice_ledger_pol260";
const root = path.resolve(__dirname, "../../../..");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm = process.env.PNPM_BIN?.trim() || (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const prismaCli = require.resolve("prisma/build/index.js");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function fail(message) {
  throw new Error(`POL-11B PostgreSQL 16 动态验收失败：${message}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForPostgres(
  containerName,
  databasePort,
  dockerCommand = (args, options) => command(docker, args, options),
  waitForHost = waitForLocalTcpReady
) {
  let containerReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await dockerCommand(["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", DATABASE_NAME]);
      containerReady = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!containerReady) fail("临时 PostgreSQL 16 未在 30 秒内就绪");
  await waitForHost({ host: "127.0.0.1", port: databasePort });
}

async function main() {
  if (process.env.NODE_ENV === "production") fail("禁止在 NODE_ENV=production 执行");
  if (process.env.DOCKER_HOST && !/^(unix|npipe):\/\//u.test(process.env.DOCKER_HOST)) fail("拒绝远程 Docker endpoint");
  const port = await freePort();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-pol260-invoice-ledger-"));
  const containerName = `jiangkong-pol260-invoice-ledger-${Date.now()}-${process.pid}`;
  const password = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${DATABASE_NAME}`;
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    RUN_INVOICE_LEDGER_POSTGRESQL16: "1"
  };
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () => command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 }).catch((error) => {
      if (!String(error?.message).includes("No such container")) throw error;
    }),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => console.log(`POL-11B 动态验收清理完成：${containerName}`)
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => console.error(message),
      exit: (code) => process.exit(code)
    });
    return interruptionPromise;
  };
  const onSigint = () => void interrupt("SIGINT");
  const onSigterm = () => void interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await command(docker, [
      "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"
    ]);
    await command(docker, ["info"]);
    await command(docker, [
      "run", "--detach", "--rm", "--pull=never", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD",
      "--env", `POSTGRES_DB=${DATABASE_NAME}`,
      "--publish", `127.0.0.1:${port}:5432`, "postgres:16"
    ], { env: { ...process.env, POSTGRES_PASSWORD: password }, forwardOutput: true });
    await waitForPostgres(containerName, port);
    await command(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(root, "services/api/prisma/schema.prisma")], {
      env: runtimeEnv,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    });
    await command(pnpm, [
      "--filter", "@jiangkong/api", "test", "--", "--runInBand",
      "src/invoice-ledger/invoice-ledger.postgres.spec.ts"
    ], { env: runtimeEnv, forwardOutput: true, timeoutMs: 3 * 60 * 1000 });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, waitForPostgres };
