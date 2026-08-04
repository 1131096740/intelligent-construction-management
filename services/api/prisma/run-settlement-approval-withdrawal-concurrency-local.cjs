#!/usr/bin/env node
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  mkdtemp,
  readFile,
  readdir,
  rm
} = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  createCommandRuntime,
  createRunnerCleanup,
  resolveCorepackHome,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");
const {
  DATABASE_NAME,
  VERIFICATION_SCOPE,
  assertVerificationScope
} = require("./settlement-approval-withdrawal-concurrency-fixtures.cjs");

const EXPECTED_MIGRATION_COUNT = 118;
const TERMINAL_MIGRATION =
  "20260804031000_contract_takeover_allocation_zero_index";
const TERMINAL_MIGRATION_CHECKSUM =
  "801de5c5504a4b02eba000769e8efed19909125f92f0cf2d380e35dac6a57aca";
const root = path.resolve(__dirname, "../../..");
const migrationsRoot = path.join(__dirname, "migrations");
const pnpm =
  process.env.PNPM_BIN?.trim() ||
  (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const docker =
  process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;
const CONTAINER_CLEANUP_MAX_CHECKS = 120;
const CONTAINER_STABLE_MISSING_CHECKS = 60;
const CONTAINER_CLEANUP_RETRY_DELAY_MS = 500;
const POSTGRES_16_MIN_VERSION_NUM = 160000;
const POSTGRES_17_MIN_VERSION_NUM = 170000;

function isLocalHostName(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    hostname
  );
}

function assertDedicatedLocalDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "结算审批撤回并发门 DATABASE_URL 不是有效 URL"
    );
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("结算审批撤回并发门只能连接 PostgreSQL");
  }
  if (!isLocalHostName(parsed.hostname)) {
    throw new Error("结算审批撤回并发门拒绝连接非本机数据库");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error(
      "结算审批撤回并发门只允许连接固定的一次性专库"
    );
  }
}

function isLocalDockerSocketEndpoint(endpoint) {
  return (
    /^unix:\/\/\/[^\r\n]+$/u.test(endpoint) ||
    /^npipe:\/{4}\.\/pipe\/[^/]+$/u.test(endpoint)
  );
}

function assertLocalDockerEndpoint(endpoint) {
  const normalized = endpoint.trim().replace(/^"(.*)"$/u, "$1");
  if (normalized && !isLocalDockerSocketEndpoint(normalized)) {
    throw new Error(
      "结算审批撤回并发门拒绝远程 Docker endpoint/context"
    );
  }
}

function assertResolvedLocalDockerEndpoint(endpoint) {
  let resolved;
  try {
    resolved = JSON.parse(endpoint.trim());
  } catch {
    throw new Error(
      "结算审批撤回并发门无法确认本机 Docker endpoint/context"
    );
  }
  if (
    typeof resolved !== "string" ||
    !isLocalDockerSocketEndpoint(resolved.trim())
  ) {
    throw new Error(
      "结算审批撤回并发门无法确认本机 Docker endpoint/context"
    );
  }
  return resolved.trim();
}

function pinResolvedLocalDockerEndpoint(dockerEnv, endpoint) {
  const resolved = assertResolvedLocalDockerEndpoint(endpoint);
  dockerEnv.DOCKER_HOST = resolved;
  delete dockerEnv.DOCKER_CONTEXT;
  return resolved;
}

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

function parseDockerSha256Id(output, label) {
  let parsed;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    throw new Error(`无法解析${label} ID`);
  }
  if (
    typeof parsed !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(parsed)
  ) {
    throw new Error(`${label} ID 不是精确 sha256`);
  }
  return parsed;
}

function assertPostgres16Version(versionText) {
  const versionNumber = Number(versionText.trim());
  if (
    !Number.isInteger(versionNumber) ||
    versionNumber < POSTGRES_16_MIN_VERSION_NUM ||
    versionNumber >= POSTGRES_17_MIN_VERSION_NUM
  ) {
    throw new Error(
      `结算审批撤回并发门要求实际 PostgreSQL 16，` +
        `server_version_num=${versionText.trim() || "missing"}`
    );
  }
  return versionNumber;
}

async function assertMigrationSource() {
  const entries = (await readdir(migrationsRoot, {
    withFileTypes: true
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    entries.length !== EXPECTED_MIGRATION_COUNT ||
    entries.at(-1) !== TERMINAL_MIGRATION
  ) {
    throw new Error(
      `结算审批撤回并发门要求精确 ${EXPECTED_MIGRATION_COUNT} 个迁移，` +
        `终点为 ${TERMINAL_MIGRATION}`
    );
  }
  const migrationSql = await readFile(
    path.join(migrationsRoot, TERMINAL_MIGRATION, "migration.sql")
  );
  const checksum = createHash("sha256")
    .update(migrationSql)
    .digest("hex");
  if (checksum !== TERMINAL_MIGRATION_CHECKSUM) {
    throw new Error(
      `结算审批撤回并发门终点迁移 checksum 漂移：${checksum}`
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
  throw new Error(
    "结算审批撤回临时 PostgreSQL 16 在 30 秒内未就绪"
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
      if (stableMissingChecks >= containerStableMissingChecks) {
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

function createSettlementWithdrawalRunnerCleanup({
  commandRuntime: runtime,
  dockerCommand,
  containerName,
  containerLifecycle,
  temporaryRoot,
  removeTemporaryRoot = rm,
  waitForContainerRetry,
  containerCleanupMaxChecks,
  containerStableMissingChecks,
  onComplete
}) {
  return createRunnerCleanup({
    stopChildren: async () => {
      if (containerLifecycle.containerCreatePromise) {
        await containerLifecycle.containerCreatePromise.catch(
          () => undefined
        );
      }
      await runtime.stopAll();
    },
    removeContainer: () => {
      if (
        !containerLifecycle.localDockerValidated ||
        !containerLifecycle.containerRunAttempted
      ) {
        return Promise.resolve();
      }
      return removeContainerWithLateCreationGuard({
        dockerCommand,
        containerName,
        waitForContainerRetry,
        containerCleanupMaxChecks,
        containerStableMissingChecks
      });
    },
    removeTemporaryRoot: () =>
      removeTemporaryRoot(temporaryRoot, {
        recursive: true,
        force: true
      }),
    onComplete
  });
}

async function runPrismaMigrate(databaseUrl, runtimeEnv) {
  return command(
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
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    }
  );
}

async function runPrismaStatus(databaseUrl, runtimeEnv) {
  return command(
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
      env: { ...runtimeEnv, DATABASE_URL: databaseUrl },
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    }
  );
}

async function verifyMigrationProof(
  dockerCommand,
  containerName
) {
  const proof = await dockerCommand(
    [
      "exec",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "jiangkong",
      "-d",
      DATABASE_NAME,
      "-X",
      "-A",
      "-t",
      "-F",
      "|",
      "-c",
      `SELECT ` +
        `count(*) FILTER (` +
        `WHERE "finished_at" IS NOT NULL ` +
        `AND "rolled_back_at" IS NULL), ` +
        `count(*) FILTER (` +
        `WHERE "migration_name" = '${TERMINAL_MIGRATION}' ` +
        `AND "finished_at" IS NOT NULL ` +
        `AND "rolled_back_at" IS NULL), ` +
        `count(*) FILTER (` +
        `WHERE "rolled_back_at" IS NOT NULL), ` +
        `COALESCE(max("checksum") FILTER (` +
        `WHERE "migration_name" = '${TERMINAL_MIGRATION}' ` +
        `AND "finished_at" IS NOT NULL ` +
        `AND "rolled_back_at" IS NULL), '') ` +
        `FROM "_prisma_migrations";`
    ],
    { timeoutMs: 60_000 }
  );
  const [
    appliedMigrationCount,
    terminalMigrationCount,
    rolledBackMigrationCount,
    terminalChecksum
  ] = proof.stdout.trim().split("|");
  if (
    Number(appliedMigrationCount) !== EXPECTED_MIGRATION_COUNT ||
    Number(terminalMigrationCount) !== 1 ||
    Number(rolledBackMigrationCount) !== 0 ||
    terminalChecksum !== TERMINAL_MIGRATION_CHECKSUM
  ) {
    throw new Error(
      `结算审批撤回迁移证据不完整：` +
        `applied=${appliedMigrationCount} ` +
        `terminal=${terminalMigrationCount} ` +
        `rolled_back=${rolledBackMigrationCount} ` +
        `checksum=${terminalChecksum}`
    );
  }
}

async function verifyPostgres16(dockerCommand, containerName) {
  const version = await dockerCommand(
    [
      "exec",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "jiangkong",
      "-d",
      DATABASE_NAME,
      "-X",
      "-A",
      "-t",
      "-c",
      "SHOW server_version_num;"
    ],
    { timeoutMs: 60_000 }
  );
  return assertPostgres16Version(version.stdout);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("结算审批撤回并发门禁止在 production 环境执行");
  }
  assertVerificationScope(process.env);
  await assertMigrationSource();
  const { withGuaranteedCleanup } = require(
    "../dist/database/money-bigint-live-verification"
  );
  const databasePort = await freePort();
  const suffix = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const containerName =
    `jiangkong-settlement-withdrawal-${suffix}`;
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-settlement-withdrawal-")
  );
  const databasePassword = `${randomUUID()}${randomUUID()}`;
  const databaseUrl =
    `postgresql://jiangkong:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${DATABASE_NAME}`;
  assertDedicatedLocalDatabase(databaseUrl);

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
    PATH: process.env.PATH ?? "",
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    COREPACK_HOME: resolveCorepackHome(process.env, temporaryRoot),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    SETTLEMENT_APPROVAL_WITHDRAWAL_DATABASE_URL: databaseUrl,
    SETTLEMENT_APPROVAL_WITHDRAWAL_CONCURRENCY_SCOPE:
      VERIFICATION_SCOPE,
    FILE_STORAGE_DRIVER: "local"
  };
  const containerLifecycle = {
    localDockerValidated: false,
    containerRunAttempted: false,
    containerCreatePromise: null,
    interrupted: false
  };
  const cleanup = createSettlementWithdrawalRunnerCleanup({
    commandRuntime,
    dockerCommand,
    containerName,
    containerLifecycle,
    temporaryRoot,
    onComplete: () =>
      console.log(
        `清理完成：临时容器 ${containerName} 与临时目录已删除`
      )
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    containerLifecycle.interrupted = true;
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
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await withGuaranteedCleanup(async () => {
      assertLocalDockerEndpoint(dockerEnv.DOCKER_HOST ?? "");
      const context = await dockerCommand([
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}"
      ]);
      pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout);
      containerLifecycle.localDockerValidated = true;
      await dockerCommand(["info"]);
      const imageInspection = await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{json .Id}}",
        "postgres:16"
      ]);
      const imageId = parseDockerSha256Id(
        imageInspection.stdout,
        "PostgreSQL 16 image"
      );
      containerLifecycle.containerRunAttempted = true;
      containerLifecycle.containerCreatePromise = dockerCommand(
        [
          "create",
          "--pull=never",
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
          imageId
        ],
        {
          extraEnv: { POSTGRES_PASSWORD: databasePassword },
          timeoutMs: 60_000
        }
      );
      const created = await containerLifecycle.containerCreatePromise;
      containerLifecycle.containerCreatePromise = null;
      if (containerLifecycle.interrupted) {
        throw new Error(
          "临时 PostgreSQL 容器创建期间已中断，转入清理"
        );
      }
      const containerId = created.stdout.trim();
      if (!/^[a-f0-9]{64}$/u.test(containerId)) {
        throw new Error("临时 PostgreSQL 容器 ID 不精确");
      }
      const containerImageInspection = await dockerCommand([
        "container",
        "inspect",
        "--format",
        "{{json .Image}}",
        containerId
      ]);
      const containerImageId = parseDockerSha256Id(
        containerImageInspection.stdout,
        "临时 PostgreSQL 容器 image"
      );
      if (containerImageId !== imageId) {
        throw new Error("临时 PostgreSQL 容器 image ID 漂移");
      }
      await dockerCommand(["start", containerId], {
        forwardOutput: true,
        timeoutMs: 60_000
      });
      await waitForPostgres(containerName, dockerCommand);
      await verifyPostgres16(dockerCommand, containerName);

      const firstDeploy = await runPrismaMigrate(
        databaseUrl,
        runtimeEnv
      );
      const secondDeploy = await runPrismaMigrate(
        databaseUrl,
        runtimeEnv
      );
      if (!firstDeploy.stdout.includes(TERMINAL_MIGRATION)) {
        throw new Error(
          "首次 migrate deploy 未显示精确终点迁移"
        );
      }
      if (!/No pending migrations to apply\.?/u.test(secondDeploy.stdout)) {
        throw new Error("第二次 migrate deploy 未证明零待办");
      }
      const status = await runPrismaStatus(databaseUrl, runtimeEnv);
      if (!/Database schema is up to date!?/u.test(status.stdout)) {
        throw new Error("migrate status 未证明空库达到精确终点");
      }
      await verifyMigrationProof(dockerCommand, containerName);

      await command(
        process.execPath,
        [
          path.join(
            root,
            "services/api/prisma/verify-settlement-approval-withdrawal-concurrency.cjs"
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
        `结算审批撤回 PostgreSQL 16 动态门通过：` +
          `applied=${EXPECTED_MIGRATION_COUNT} terminal=1 ` +
          `rolled_back=0 pending=0 scope=${VERIFICATION_SCOPE}`
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
  DATABASE_NAME,
  VERIFICATION_SCOPE,
  EXPECTED_MIGRATION_COUNT,
  TERMINAL_MIGRATION,
  TERMINAL_MIGRATION_CHECKSUM,
  CONTAINER_CLEANUP_MAX_CHECKS,
  CONTAINER_STABLE_MISSING_CHECKS,
  CONTAINER_CLEANUP_RETRY_DELAY_MS,
  assertDedicatedLocalDatabase,
  assertLocalDockerEndpoint,
  assertResolvedLocalDockerEndpoint,
  pinResolvedLocalDockerEndpoint,
  createControlledDockerEnv,
  parseDockerSha256Id,
  assertPostgres16Version,
  createSettlementWithdrawalRunnerCleanup,
  removeContainerWithLateCreationGuard,
  main
};
