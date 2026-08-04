#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const { readdirSync: readDirectorySync } = require("node:fs");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME =
  "jiangkong_project_expense_approval_concurrency";
const root = path.resolve(__dirname, "../../..");
const migrationsRoot = path.join(__dirname, "migrations");
const EXPECTED_MIGRATION_COUNT = readDirectorySync(migrationsRoot, {
  withFileTypes: true
}).filter((entry) => entry.isDirectory()).length;
const pnpm =
  process.env.PNPM_BIN?.trim() ||
  (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const docker =
  process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;
const CONTAINER_CLEANUP_MAX_CHECKS = 60;
const CONTAINER_STABLE_MISSING_CHECKS = 30;
const CONTAINER_CLEANUP_RETRY_DELAY_MS = 100;

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
    throw new Error(
      "项目支出审批并发验收 DATABASE_URL 不是有效 URL"
    );
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error(
      "项目支出审批并发验收只能连接 PostgreSQL 临时数据库"
    );
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error(
      "项目支出审批并发验收拒绝连接非本机数据库"
    );
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error(
      "项目支出审批并发验收只允许连接固定的一次性临时数据库"
    );
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
      `项目支出审批并发验收拒绝远程 Docker endpoint：${normalized}`
    );
  }
}

function createControlledDockerEnv(sourceEnv, fallbackHome) {
  const dockerEnv = {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? fallbackHome
  };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (sourceEnv[key] !== undefined) dockerEnv[key] = sourceEnv[key];
  }
  return dockerEnv;
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
  throw new Error(
    "项目支出审批并发验收临时 PostgreSQL 16 在 30 秒内未就绪"
  );
}

function isMissingContainerError(error) {
  const message = String(error?.message);
  return (
    message.includes("No such container") ||
    message.includes("No such object")
  );
}

async function removeContainerWithLateCreationGuard({
  dockerCommand,
  containerName,
  waitForContainerRetry = (delayMs) =>
    new Promise((resolve) => setTimeout(resolve, delayMs)),
  containerCleanupMaxChecks = CONTAINER_CLEANUP_MAX_CHECKS,
  containerStableMissingChecks =
    CONTAINER_STABLE_MISSING_CHECKS
}) {
  if (
    !Number.isInteger(containerCleanupMaxChecks) ||
    !Number.isInteger(containerStableMissingChecks) ||
    containerCleanupMaxChecks < containerStableMissingChecks ||
    containerStableMissingChecks < 1
  ) {
    throw new Error("临时容器清理重试参数无效");
  }
  let stableMissingChecks = 0;
  let shouldRemove = true;
  for (
    let check = 0;
    check < containerCleanupMaxChecks;
    check += 1
  ) {
    if (shouldRemove) {
      try {
        await dockerCommand(["rm", "--force", containerName], {
          timeoutMs: 60_000
        });
      } catch (error) {
        if (!isMissingContainerError(error)) throw error;
      }
    }

    let exists = true;
    try {
      await dockerCommand(
        ["inspect", "--type", "container", containerName],
        { timeoutMs: 15_000 }
      );
    } catch (error) {
      if (!isMissingContainerError(error)) throw error;
      exists = false;
    }
    if (exists) {
      stableMissingChecks = 0;
      shouldRemove = true;
    } else {
      stableMissingChecks += 1;
      shouldRemove = false;
      if (
        stableMissingChecks >= containerStableMissingChecks
      ) {
        return;
      }
    }
    await waitForContainerRetry(
      CONTAINER_CLEANUP_RETRY_DELAY_MS
    );
  }
  throw new Error(
    `临时容器 ${containerName} 未在有界窗口内稳定消失`
  );
}

function createProjectExpenseApprovalConcurrencyCleanup({
  commandRuntime: runtime = commandRuntime,
  dockerCommand,
  containerName,
  temporaryRoot,
  removeTemporaryRoot = rm,
  waitForContainerRetry,
  containerCleanupMaxChecks,
  containerStableMissingChecks,
  onComplete
}) {
  return createRunnerCleanup({
    stopChildren: () => runtime.stopAll(),
    removeContainer: () =>
      removeContainerWithLateCreationGuard({
        dockerCommand,
        containerName,
        waitForContainerRetry,
        containerCleanupMaxChecks,
        containerStableMissingChecks
      }),
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, {
        recursive: true,
        force: true
      }),
    onComplete
  });
}

async function assertMigrationCount() {
  const entries = readDirectorySync(migrationsRoot, {
    withFileTypes: true
  });
  const actual = entries.filter((entry) => entry.isDirectory()).length;
  if (actual !== EXPECTED_MIGRATION_COUNT) {
    throw new Error(
      `项目支出审批并发验收期间迁移数发生变化：` +
        `启动时 ${EXPECTED_MIGRATION_COUNT}，当前 ${actual}`
    );
  }
}

async function main() {
  await assertMigrationCount();
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName =
    `jiangkong-project-expense-approval-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-project-expense-approval-")
  );
  const databasePassword = randomUUID();
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  const dockerEnv = createControlledDockerEnv(
    process.env,
    temporaryRoot
  );
  const dockerCommand = (args, options = {}) => {
    const { extraEnv = {}, ...commandOptions } = options;
    return command(docker, args, {
      ...commandOptions,
      env: { ...dockerEnv, ...extraEnv }
    });
  };
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    FILE_STORAGE_DRIVER: "local"
  };
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup =
    createProjectExpenseApprovalConcurrencyCleanup({
      commandRuntime,
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
    assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST ?? "");
    const dockerEndpoint = await dockerCommand([
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}"
    ]);
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
        extraEnv: { POSTGRES_PASSWORD: databasePassword },
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
      ["--filter", "@jiangkong/api", "build"],
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
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
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
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
      {
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    await command(
      process.execPath,
      [
        path.join(
          root,
          "services/api/prisma/verify-project-expense-approval-concurrency.cjs"
        )
      ],
      {
        cwd: root,
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      }
    );
    console.log(
      `项目支出审批 PostgreSQL 16 并发验收通过（${EXPECTED_MIGRATION_COUNT} 个迁移）`
    );
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
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAME,
  EXPECTED_MIGRATION_COUNT,
  assertDedicatedLocalDatabase,
  assertLocalDockerEndpoint,
  createProjectExpenseApprovalConcurrencyCleanup,
  removeContainerWithLateCreationGuard,
  main
};
