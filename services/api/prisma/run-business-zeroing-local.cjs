#!/usr/bin/env node
"use strict";

if (require.main === module) {
  throw new Error("归零工具直接 Node 入口已禁用；必须使用受信启动器");
}

const { createHash, randomUUID } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { mkdir, mkdtemp, readdir, rm, stat } = require("node:fs/promises");
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

async function connectToPostgresFromHost(databaseUrl) {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await client.$queryRawUnsafe("SELECT 1");
  } finally {
    await client.$disconnect();
  }
}

async function waitForPostgres(
  containerName,
  dockerEnvironment,
  {
    command: runCommand = command,
    connectFromHost = connectToPostgresFromHost,
    databaseUrl,
    delay = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 500)),
    attempts = 60
  } = {}
) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim()) {
    throw new Error("POL-22 临时 PostgreSQL 缺少宿主协议探测地址");
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await runCommand(
        docker,
        ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", databaseName],
        { env: dockerEnvironment }
      );
      await connectFromHost(databaseUrl);
      return;
    } catch {
      if (attempt + 1 < attempts) await delay();
    }
  }
  throw new Error("POL-22 临时 PostgreSQL 16 的容器内或宿主协议在 30 秒内未就绪");
}

function assertDynamicReceiptSection(receipt, field, label) {
  const section = receipt?.[field];
  if (
    !section ||
    section.status !== "blocked" ||
    !Array.isArray(section.blockers) ||
    section.blockers.length === 0 ||
    section.candidateCount !== 0
  ) {
    throw new Error(`POL-22 动态收据缺少 ${label}`);
  }
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function listPrivateObjects(rootDirectory) {
  const objects = [];
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new Error("POL-22 私有文件备份发现非普通文件");
        }
        const metadata = await stat(absolutePath);
        objects.push({
          objectKey: path.relative(rootDirectory, absolutePath).split(path.sep).join("/"),
          sha256: await fileSha256(absolutePath),
          sizeBytes: metadata.size
        });
      }
    }
  };
  await visit(rootDirectory);
  return objects;
}

async function writeFinalDynamicReceipt(
  receipt,
  { cleanup, write = (chunk) => process.stdout.write(chunk) }
) {
  if (receipt?.status !== "passed" || receipt.productionAccessed !== false) {
    throw new Error("POL-22 动态收据最终状态或生产隔离标记无效");
  }
  if (receipt.migrationCount !== 125 || typeof receipt.migrationHead !== "string") {
    throw new Error("POL-22 动态收据迁移坐标无效");
  }
  if (!Number.isInteger(receipt.dryRunSteps) || !receipt.executionSteps) {
    throw new Error("POL-22 动态收据缺少 dry-run 或执行步骤");
  }
  assertDynamicReceiptSection(receipt, "formalRecordProtection", "formal record protection");
  assertDynamicReceiptSection(receipt, "unknownOwnershipBlockers", "unknown ownership blockers");
  assertDynamicReceiptSection(receipt, "mixedOwnershipBlockers", "mixed ownership blockers");
  if (
    receipt.backupRestore?.database?.status !== "passed" ||
    receipt.backupRestore?.privateFiles?.status !== "passed" ||
    receipt.backupRestore?.artifactsVerified !== true
  ) {
    throw new Error("POL-22 动态收据备份恢复验证无效");
  }
  await cleanup();
  const finalReceipt = {
    ...receipt,
    containerRemoved: true,
    temporaryFilesRemoved: true
  };
  write(`${JSON.stringify(finalReceipt)}\n`);
  return finalReceipt;
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
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true })
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

  let finalReceipt;
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
    await waitForPostgres(containerName, dockerEnvironment, { databaseUrl });
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
      finalReceipt = await verifyBusinessZeroing(prisma, temporaryRoot, codeIdentity, {
        trustedRunner: true,
        createVerifiedBackupRestore: async ({
          storageRoot,
          sourceCounts,
          migrationCount,
          migrationHead
        }) => {
          const containerDumpPath = `/tmp/pol22-${suffix}.dump`;
          const databaseDumpPath = path.join(temporaryRoot, "database.dump");
          const restoreDatabaseName = "jiangkong_pol22_zeroing_restore";
          const privateArchivePath = path.join(temporaryRoot, "private-files.tar");
          const privateRestoreRoot = path.join(temporaryRoot, "private-files-restored");
          const capturedAt = new Date().toISOString();
          await command(
            docker,
            ["exec", containerName, "pg_dump", "-U", "jiangkong", "-d", databaseName, "-Fc", "-f", containerDumpPath],
            { env: dockerEnvironment, timeoutMs: 5 * 60 * 1000 }
          );
          await command(
            docker,
            ["cp", `${containerName}:${containerDumpPath}`, databaseDumpPath],
            { env: dockerEnvironment, timeoutMs: 60_000 }
          );
          await command(
            docker,
            ["exec", containerName, "createdb", "-U", "jiangkong", restoreDatabaseName],
            { env: dockerEnvironment, timeoutMs: 60_000 }
          );
          await command(
            docker,
            ["exec", containerName, "pg_restore", "--exit-on-error", "--no-owner", "-U", "jiangkong", "-d", restoreDatabaseName, containerDumpPath],
            { env: dockerEnvironment, timeoutMs: 5 * 60 * 1000 }
          );
          const restoreUrl = new URL(databaseUrl);
          restoreUrl.pathname = `/${restoreDatabaseName}`;
          const restoredPrisma = new PrismaClient({
            datasources: { db: { url: restoreUrl.toString() } }
          });
          let restoredEvidence;
          try {
            const restoredRows = await restoredPrisma.$queryRawUnsafe(
              `SELECT
                 (SELECT COUNT(*)::int FROM "User") AS "users",
                 (SELECT COUNT(*)::int FROM "Project") AS "projects",
                 (SELECT COUNT(*)::int FROM "Contract") AS "contracts",
                 (SELECT COUNT(*)::int FROM "ContractVersion") AS "versions",
                 (SELECT COUNT(*)::int FROM "ContractDraftAttachment") AS "attachments",
                 (SELECT COUNT(*)::int FROM "FileObject") AS "files",
                 (SELECT COUNT(*)::int FROM "AuditLog") AS "audits",
                 (SELECT COUNT(*)::int FROM "_prisma_migrations") AS "migrations",
                 (SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "finished_at" DESC NULLS LAST, "started_at" DESC LIMIT 1) AS "migrationHead"`
            );
            restoredEvidence = restoredRows[0];
          } finally {
            await restoredPrisma.$disconnect();
          }
          const countKeys = [
            "users",
            "projects",
            "contracts",
            "versions",
            "attachments",
            "files",
            "audits"
          ];
          if (
            restoredEvidence.migrations !== migrationCount ||
            restoredEvidence.migrationHead !== migrationHead ||
            countKeys.some((key) => restoredEvidence[key] !== sourceCounts[key])
          ) {
            throw new Error("POL-22 PostgreSQL 恢复库与源库计数或迁移坐标不一致");
          }
          const sourceObjects = await listPrivateObjects(storageRoot);
          if (sourceObjects.length === 0) throw new Error("POL-22 私有文件备份源对象为空");
          await command("/usr/bin/tar", ["-cf", privateArchivePath, "-C", storageRoot, "."]);
          await mkdir(privateRestoreRoot, { recursive: true });
          await command("/usr/bin/tar", ["-xf", privateArchivePath, "-C", privateRestoreRoot]);
          const restoredObjects = await listPrivateObjects(privateRestoreRoot);
          if (JSON.stringify(restoredObjects) !== JSON.stringify(sourceObjects)) {
            throw new Error("POL-22 私有文件独立恢复目录逐对象比对失败");
          }
          const restoreVerifiedAt = new Date().toISOString();
          return {
            capturedAt,
            databaseBackup: {
              location: databaseDumpPath,
              sha256: await fileSha256(databaseDumpPath),
              format: "postgresql_custom",
              capturedAt,
              restoreVerifiedAt,
              restoreTarget: restoreDatabaseName,
              restoreStatus: "passed",
              restoreEvidence: {
                status: "passed",
                migrationCount: restoredEvidence.migrations,
                migrationHead: restoredEvidence.migrationHead,
                tableCounts: Object.fromEntries(
                  Object.entries(restoredEvidence).filter(([key]) => !["migrations", "migrationHead"].includes(key))
                ),
                commands: ["pg_dump -Fc", "createdb", "pg_restore --exit-on-error"]
              }
            },
            privateFileBackup: {
              location: privateArchivePath,
              sha256: await fileSha256(privateArchivePath),
              capturedAt,
              restoreVerifiedAt,
              restoreTarget: privateRestoreRoot,
              restoreStatus: "passed",
              sourceObjects,
              restoreEvidence: { status: "passed", objects: restoredObjects }
            }
          };
        }
      });
    } finally {
      await prisma.$disconnect();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
    await writeFinalDynamicReceipt(finalReceipt, { cleanup });
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

module.exports = {
  createPinnedDockerEnvironment,
  freePort,
  main,
  runMain,
  waitForPostgres,
  writeFinalDynamicReceipt
};
