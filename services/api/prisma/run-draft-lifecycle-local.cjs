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
const {
  DATABASE_NAME,
  EXPECTED_MIGRATION_COUNT,
  assertDedicatedLocalDatabase
} = require("./verify-draft-lifecycle.cjs");

const root = path.resolve(__dirname, "../../..");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const prismaCli = require.resolve("prisma/build/index.js");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function assertLocalDockerEndpoint(endpoint) {
  const normalized = endpoint.trim().replace(/^"(.*)"$/u, "$1");
  if (normalized && !normalized.startsWith("unix://") && !normalized.startsWith("npipe://")) {
    throw new Error(`草稿生命周期验证拒绝使用远程 Docker endpoint：${normalized}`);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await command(docker, [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "jiangkong",
        "-d",
        DATABASE_NAME
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("临时 PostgreSQL 16 在 30 秒内未就绪");
}

async function main() {
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-draft-lifecycle-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-draft-lifecycle-"));
  const password = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${DATABASE_NAME}`;
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage"),
    SEED_PASSWORD: `Local@1-${randomUUID()}`
  };
  assertDedicatedLocalDatabase(databaseUrl);

  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () =>
      command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 }).catch(
        (error) => {
          if (!String(error?.message).includes("No such container")) throw error;
        }
      ),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () =>
      console.log(`清理完成：临时容器 ${containerName} 与临时目录已删除`)
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => console.error(message),
      exit: (code) => process.exit(code)
    });
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    assertLocalDockerEndpoint(process.env.DOCKER_HOST ?? "");
    const context = await command(docker, [
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}"
    ]);
    assertLocalDockerEndpoint(context.stdout);
    await command(docker, ["info"]);
    await command(
      docker,
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
        `127.0.0.1:${port}:5432`,
        "postgres:16"
      ],
      {
        env: { ...process.env, POSTGRES_PASSWORD: password },
        forwardOutput: true
      }
    );
    await waitForPostgres(containerName);
    console.log(`临时 PostgreSQL 16 已就绪：${containerName}（仅 127.0.0.1）`);

    await command(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", path.join(root, "services/api/prisma/schema.prisma")],
      { env: runtimeEnv, forwardOutput: true, timeoutMs: 15 * 60 * 1000 }
    );
    await command(
      process.execPath,
      [prismaCli, "migrate", "status", "--schema", path.join(root, "services/api/prisma/schema.prisma")],
      { env: runtimeEnv, forwardOutput: true }
    );
    await command(process.execPath, [path.join(root, "services/api/prisma/seed.cjs")], {
      cwd: temporaryRoot,
      env: runtimeEnv,
      forwardOutput: true,
      timeoutMs: 5 * 60 * 1000
    });
    await command(
      process.execPath,
      [path.join(root, "services/api/prisma/verify-draft-lifecycle.cjs"), "--probe-rollback"],
      { env: runtimeEnv, forwardOutput: true }
    );
    console.log(`草稿生命周期 ${EXPECTED_MIGRATION_COUNT} 迁移与本地回滚不变量验证通过`);
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

module.exports = { assertLocalDockerEndpoint, main };
