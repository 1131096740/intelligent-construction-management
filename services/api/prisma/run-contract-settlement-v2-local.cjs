#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const databaseName = "jiangkong_contract_bill_batch_test";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.forwardOutput ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve(output);
      reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${output}`));
    });
  });
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

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run(docker, ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", databaseName]);
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
    CONTRACT_BILL_BATCH_DATABASE_URL: databaseUrl,
    RUN_CONTRACT_BILL_BATCH_DATABASE: "1"
  };

  try {
    const endpoint = await run(docker, ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).then((value) => value.trim());
    assertLocalDockerEndpoint(endpoint);
    await run(docker, ["run", "--detach", "--rm", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD", "--env", `POSTGRES_DB=${databaseName}`,
      "--publish", `127.0.0.1:${port}:5432`, "postgres:16"], {
      env: { PATH: runtimeEnv.PATH, HOME: runtimeEnv.HOME, POSTGRES_PASSWORD: password }
    });
    await waitForPostgres(containerName);
    await run(pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "seed"], { env: runtimeEnv });
    await run(process.execPath, [path.join(root, "services/api/prisma/precheck-contract-settlement-v2.cjs"), "--output", path.resolve(evidencePath)], { env: runtimeEnv, forwardOutput: true });
    await run(pnpm, ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/contract-bill-batch-replace-concurrency.spec.ts"], { env: runtimeEnv, forwardOutput: true });
    process.stdout.write(JSON.stringify({ mode: "isolated_contract_settlement_v2", evidencePath: path.resolve(evidencePath), database: databaseName, concurrency: "contract_bill_batch_replace" }) + "\n");
  } finally {
    await run(docker, ["rm", "--force", containerName]).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`合同清单与结算 V2 本地隔离验证失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertLocalDockerEndpoint, freePort, main };
