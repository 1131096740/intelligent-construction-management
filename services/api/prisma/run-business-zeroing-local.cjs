#!/usr/bin/env node
"use strict";

if (require.main === module) {
  throw new Error("归零工具直接 Node 入口已禁用；必须使用受信启动器");
}

const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");
const {
  assertLocalDockerEndpoint,
  assertSafeExecutionEnvironment,
  createChildEnvironment,
  createProbeEnvironment
} = require("./run-database-dynamic-gate-local.cjs");
const { verifyBusinessZeroing } = require("./verify-business-zeroing.cjs");
const {
  assertTrustedLauncherCapability,
  currentCodeIdentity
} = require("../scripts/business-zeroing-cli.cjs");

const root = path.resolve(__dirname, "../../..");
const databaseName = "jiangkong_pol22_zeroing_local";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const prismaCli = require.resolve("prisma/build/index.js");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
}

function createPinnedDockerEnvironment(sourceEnv, temporaryRoot, dockerEndpoint) {
  const environment = createChildEnvironment(sourceEnv, temporaryRoot, dockerEndpoint);
  delete environment.DOCKER_CONTEXT;
  return environment;
}

async function waitForPostgres(containerName, dockerEnvironment) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await command(
        docker,
        ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", databaseName],
        { env: dockerEnvironment }
      );
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("POL-22 临时 PostgreSQL 16 在 30 秒内未就绪");
}

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(
      "sh services/api/scripts/run-business-zeroing-cli.sh dynamic\n"
    );
    return;
  }
  assertSafeExecutionEnvironment(process.env);
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-pol22-zeroing-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-pol22-zeroing-"));
  const password = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${databaseName}`;
  let dockerEnvironment;
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      dockerEnvironment
        ? command(docker, ["rm", "--force", containerName], {
            env: dockerEnvironment,
            timeoutMs: 60_000
          }).catch(
            (error) => {
              if (!String(error?.message).includes("No such container")) throw error;
            }
          )
        : Promise.resolve(),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => process.stdout.write("POL-22 隔离容器和临时文件已清理。\n")
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => process.stderr.write(`${message}\n`),
      exit: (code) => process.exit(code)
    });
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const probeEnvironment = createProbeEnvironment(process.env, temporaryRoot);
    const context = await command(
      docker,
      ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
      { env: probeEnvironment }
    );
    const dockerEndpoint = assertLocalDockerEndpoint(context.stdout);
    dockerEnvironment = createPinnedDockerEnvironment(
      process.env,
      temporaryRoot,
      dockerEndpoint
    );
    await command(docker, ["info", "--format", "{{json .ServerVersion}}"], {
      env: dockerEnvironment
    });
    await command(docker, ["image", "inspect", "postgres:16"], {
      env: dockerEnvironment
    });
    await command(
      docker,
      [
        "run",
        "--pull=never",
        "--detach",
        "--rm",
        "--name",
        containerName,
        "--env",
        "POSTGRES_USER=jiangkong",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        `POSTGRES_DB=${databaseName}`,
        "--publish",
        `127.0.0.1:${port}:5432`,
        "postgres:16"
      ],
      {
        env: { ...dockerEnvironment, POSTGRES_PASSWORD: password },
        timeoutMs: 60_000
      }
    );
    await waitForPostgres(containerName, dockerEnvironment);
    const runtimeEnvironment = {
      ...dockerEnvironment,
      DATABASE_URL: databaseUrl
    };
    await command(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        path.join(root, "services/api/prisma/schema.prisma")
      ],
      { env: runtimeEnvironment, timeoutMs: 15 * 60 * 1000, forwardOutput: true }
    );
    await command(pnpm, ["--filter", "@jiangkong/api", "build"], {
      env: runtimeEnvironment,
      timeoutMs: 15 * 60 * 1000,
      forwardOutput: true
    });
    const codeIdentity = currentCodeIdentity();

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    try {
      const receipt = await verifyBusinessZeroing(prisma, temporaryRoot, codeIdentity, {
        trustedRunner: true
      });
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
    } finally {
      await prisma.$disconnect();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

async function runMain(capability) {
  assertTrustedLauncherCapability(capability);
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `POL-22 本地隔离验证失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

module.exports = { createPinnedDockerEnvironment, freePort, main, runMain, waitForPostgres };
