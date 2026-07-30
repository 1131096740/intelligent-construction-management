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
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME =
  "jiangkong_contract_template_scenario_concurrency";
const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function createControlledDockerEnv(sourceEnv, fallbackHome) {
  const dockerEnv = {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? fallbackHome
  };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (sourceEnv[key] !== undefined) {
      dockerEnv[key] = sourceEnv[key];
    }
  }
  return dockerEnv;
}

function createDockerCommand(
  dockerEnv,
  runCommand = command,
  dockerBinary = docker
) {
  return (args, options = {}) => {
    const { extraEnv = {}, ...commandOptions } = options;
    return runCommand(dockerBinary, args, {
      ...commandOptions,
      env: { ...dockerEnv, ...extraEnv }
    });
  };
}

function isLocalHostName(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertDedicatedLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("合同模板场景并发验收 DATABASE_URL 不是有效 URL");
  }
  if (![ "postgresql:", "postgres:" ].includes(parsed.protocol)) {
    throw new Error("合同模板场景并发验收只能连接 PostgreSQL 临时数据库");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("合同模板场景并发验收拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("合同模板场景并发验收只允许连接固定的一次性临时数据库");
  }
}

function assertLocalDockerEndpoint(endpoint) {
  const normalized = endpoint.trim().replace(/^"(.*)"$/u, "$1");
  if (
    normalized &&
    !normalized.startsWith("unix://") &&
    !normalized.startsWith("npipe://")
  ) {
    throw new Error(
      `合同模板场景并发验收拒绝远程 Docker endpoint：${normalized}`
    );
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : 0;
      server.close((error) =>
        error ? reject(error) : resolve(port)
      );
    });
  });
}

async function waitForPostgres(containerName, dockerCommand) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await dockerCommand(
        [
          "exec",
          containerName,
          "pg_isready",
          "-U",
          "jiangkong",
          "-d",
          DATABASE_NAME
        ],
        { timeoutMs: 15_000 }
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("合同模板场景临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createContractTemplateScenarioCleanup({
  dockerCommand,
  containerName,
  temporaryRoot,
  removeTemporaryRoot = rm,
  onComplete
}) {
  return createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      dockerCommand(
        ["rm", "--force", containerName],
        { timeoutMs: 60_000 }
      ).catch((error) => {
        if (!String(error?.message).includes("No such container")) {
          throw error;
        }
      }),
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, {
        recursive: true,
        force: true
      }),
    onComplete
  });
}

async function main() {
  const {
    withGuaranteedCleanup
  } = require("../dist/database/money-bigint-live-verification");
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-template-scenario-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-template-scenario-")
  );
  const databasePassword = randomUUID();
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  const dockerEnv = createControlledDockerEnv(process.env, temporaryRoot);
  const dockerCommand = createDockerCommand(dockerEnv);
  const runtimeEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    CONTRACT_TEMPLATE_SCENARIO_DATABASE_URL: databaseUrl,
    RUN_CONTRACT_TEMPLATE_SCENARIO_CONCURRENCY: "1"
  };
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createContractTemplateScenarioCleanup({
    dockerCommand,
    containerName,
    temporaryRoot,
    onComplete: () =>
      console.log(
        `清理完成：临时容器 ${containerName} 与临时目录已删除`
      )
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
    await withGuaranteedCleanup(async () => {
      assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST ?? "");
      const dockerEndpoint = await dockerCommand(
        [
          "context",
          "inspect",
          "--format",
          "{{json .Endpoints.docker.Host}}"
        ]
      );
      assertLocalDockerEndpoint(dockerEndpoint.stdout);
      await dockerCommand(["info"]);

      await dockerCommand(
        [
          "run",
          "--detach",
          "--rm",
          "--name",
          containerName,
          "--env",
          "POSTGRES_USER=jiangkong",
          "--env",
          "POSTGRES_PASSWORD",
          "--env",
          `POSTGRES_DB=${DATABASE_NAME}`,
          "--publish",
          `127.0.0.1:${databasePort}:5432`,
          "postgres:16"
        ],
        {
          extraEnv: {
            POSTGRES_PASSWORD: databasePassword
          },
          forwardOutput: true
        }
      );
      await waitForPostgres(containerName, dockerCommand);
      console.log(
        `临时 PostgreSQL 16 已就绪：${containerName}` +
          `（${DATABASE_NAME}，仅 127.0.0.1）`
      );

      await command(
        pnpm,
        [
          "--filter",
          "@jiangkong/api",
          "exec",
          "prisma",
          "migrate",
          "deploy"
        ],
        { env: runtimeEnv, forwardOutput: true }
      );
      await command(
        pnpm,
        [
          "--filter",
          "@jiangkong/api",
          "exec",
          "prisma",
          "migrate",
          "status"
        ],
        { env: runtimeEnv, forwardOutput: true }
      );
      await command(
        pnpm,
        [
          "--filter",
          "@jiangkong/api",
          "test",
          "--",
          "--runInBand",
          "src/database/contract-template-scenario-concurrency.spec.ts"
        ],
        {
          env: runtimeEnv,
          forwardOutput: true,
          timeoutMs: 15 * 60 * 1000
        }
      );
      console.log(
        "合同模板风险停用与场景映射 PostgreSQL 16 并发验收通过"
      );
    }, cleanup);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDedicatedLocalDatabase,
  assertLocalDockerEndpoint,
  createControlledDockerEnv,
  createDockerCommand,
  createContractTemplateScenarioCleanup,
  freePort,
  main
};
