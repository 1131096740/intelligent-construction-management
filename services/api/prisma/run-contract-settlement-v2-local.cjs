#!/usr/bin/env node
"use strict";

const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const databaseName = "jiangkong_contract_bill_batch_test";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm =
  process.env.PNPM_BIN?.trim() ||
  (process.platform === "win32" ? "pnpm.cmd" : "pnpm");

const commandRuntime = createCommandRuntime({ defaultCwd: root, defaultTimeoutMs: 0 });
async function run(command, args, options = {}) {
  const result = await commandRuntime.command(command, args, options);
  return result.stdout;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPostgres(containerName, dockerEnv) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run(docker, ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", databaseName], { env: dockerEnv });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("合同清单与结算 V2 临时 PostgreSQL 在 30 秒内未就绪");
}

function assertLocalDockerEndpoint(endpoint) {
  if (endpoint && !endpoint.startsWith("unix://") && !endpoint.startsWith("npipe://")) {
    throw new Error("合同清单与结算 V2 验证拒绝远程 Docker endpoint");
  }
}

async function main() {
  const evidencePath = process.env.CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH;
  if (!evidencePath) throw new Error("必须设置 CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH");
  assertLocalDockerEndpoint(process.env.DOCKER_HOST ?? "");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-contract-settlement-v2-"));
  const port = await freePort();
  const password = randomUUID();
  const containerName = `jiangkong-contract-settlement-v2-${Date.now()}-${process.pid}`;
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${databaseName}`;
  const runtimeEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage", "private"),
    CONTRACT_BILL_BATCH_DATABASE_URL: databaseUrl,
    RUN_CONTRACT_BILL_BATCH_DATABASE: "1",
    CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE_URL: databaseUrl,
    RUN_CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE: "1"
  };

  let containerRunAttempted = false;
  let dockerEnv;
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: async () => {
      if (!containerRunAttempted) return;
      try {
        await run(docker, ["rm", "--force", "--volumes", containerName], {
          env: dockerEnv, timeoutMs: 60_000
        });
      } catch (error) {
        if (!String(error?.message).includes("No such container")) throw error;
      }
    },
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true })
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal, cleanup,
      reportError: (message) => process.stderr.write(`${message}\n`),
      exit: (code) => process.exit(code)
    });
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const endpoint = await run(docker, ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).then((value) => value.trim());
    assertLocalDockerEndpoint(endpoint);
    if (!endpoint) throw new Error("无法确认本机 Docker endpoint");
    dockerEnv = { PATH: runtimeEnv.PATH, HOME: runtimeEnv.HOME, DOCKER_HOST: endpoint };
    containerRunAttempted = true;
    await run(docker, ["run", "--pull=never", "--detach", "--rm", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD", "--env", `POSTGRES_DB=${databaseName}`,
      "--publish", `127.0.0.1:${port}:5432`, "postgres:16"], {
      env: { ...dockerEnv, POSTGRES_PASSWORD: password }
    });
    await waitForPostgres(containerName, dockerEnv);
    await run(pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "build"], { env: runtimeEnv });
    await run(process.execPath, [path.join(__dirname, "seed.cjs")], { cwd: temporaryRoot, env: runtimeEnv });
    await run(process.execPath, [path.join(root, "services/api/prisma/precheck-contract-settlement-v2.cjs"), "--output", path.resolve(evidencePath)], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/contract-bill-batch-replace-concurrency.spec.ts", "src/database/contract-bill-transition-confirm-concurrency.spec.ts"], { env: runtimeEnv, forwardOutput: true });
    await cleanup();
    process.stdout.write(JSON.stringify({ mode: "isolated_contract_settlement_v2", evidencePath: path.resolve(evidencePath), database: databaseName, concurrency: "contract_bill_batch_replace,contract_bill_transition_confirm" }) + "\n");
  } finally {
    try {
      await cleanup();
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`合同清单与结算 V2 本地隔离验证失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertLocalDockerEndpoint, freePort, main };
