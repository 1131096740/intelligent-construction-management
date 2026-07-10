const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  assertLocalMoneyVerificationRuntime,
  assertSeedOutputHasNoPassword,
  withGuaranteedCleanup
} = require("../dist/database/money-bigint-live-verification");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

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
        "jiangkong_money_verify"
      ], { timeoutMs: 15_000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("临时 PostgreSQL 在 30 秒内未就绪");
}

async function waitForApi(apiBaseUrl, apiProcess, apiOutput) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (apiProcess.exitCode !== null) {
      throw new Error(`本地 API 提前退出：\n${apiOutput.join("")}`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) return;
    } catch {
      // API still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("本地 API 在 60 秒内未就绪");
}

async function main() {
  const [databasePort, apiPort] = await Promise.all([freePort(), freePort()]);
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-money-bigint-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-money-bigint-"));
  const databasePassword = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${databasePassword}@127.0.0.1:${databasePort}/jiangkong_money_verify`;
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const runtimeEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    WEB_ORIGIN: "http://127.0.0.1:5173",
    API_BASE_URL: apiBaseUrl,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomUUID(),
    JWT_REFRESH_SECRET: randomUUID(),
    FILE_DOWNLOAD_SECRET: randomUUID(),
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage", "private"),
    SEED_PASSWORD: `Local@1-${randomUUID()}`
  };
  assertLocalMoneyVerificationRuntime({
    databaseUrl,
    apiBaseUrl,
    host: runtimeEnv.HOST,
    storageDriver: runtimeEnv.FILE_STORAGE_DRIVER
  });

  let apiProcess;
  const apiOutput = [];

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
      console.log(`清理完成：API 已停止，临时容器 ${containerName} 与临时目录已删除`)
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
          "POSTGRES_DB=jiangkong_money_verify",
          "--publish",
          `127.0.0.1:${databasePort}:5432`,
          "postgres:16"
        ],
        {
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? temporaryRoot,
            POSTGRES_PASSWORD: databasePassword
          },
          forwardOutput: true
        }
      );
      await waitForPostgres(containerName);
      console.log(`临时 PostgreSQL 已就绪：${containerName}（仅 127.0.0.1）`);

      await command(
        pnpm,
        ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"],
        { env: runtimeEnv, forwardOutput: true }
      );
      await command(
        pnpm,
        ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"],
        { env: runtimeEnv, forwardOutput: true }
      );
      const seedResult = await command(
        process.execPath,
        [path.join(root, "services/api/prisma/seed.cjs")],
        {
          cwd: temporaryRoot,
          env: runtimeEnv
        }
      );
      assertSeedOutputHasNoPassword(
        `${seedResult.stdout}\n${seedResult.stderr}`,
        runtimeEnv.SEED_PASSWORD
      );
      process.stdout.write(seedResult.stdout);
      process.stderr.write(seedResult.stderr);
      await command(
        process.execPath,
        [path.join(root, "services/api/prisma/prepare-money-bigint-local.cjs")],
        { cwd: root, env: runtimeEnv, forwardOutput: true }
      );

      apiProcess = commandRuntime.track(
        spawn(process.execPath, [path.join(root, "services/api/dist/main.js")], {
          cwd: root,
          env: runtimeEnv,
          stdio: ["ignore", "pipe", "pipe"]
        })
      );
      for (const stream of [apiProcess.stdout, apiProcess.stderr]) {
        stream.on("data", (chunk) => {
          apiOutput.push(String(chunk));
          if (apiOutput.length > 200) apiOutput.shift();
        });
      }
      await waitForApi(apiBaseUrl, apiProcess, apiOutput);
      console.log(`本地 API 已就绪：${apiBaseUrl}`);

      for (const script of [
        "verify-core-flow.cjs",
        "verify-money-bigint.cjs"
      ]) {
        try {
          await command(process.execPath, [path.join(root, "services/api/prisma", script)], {
            cwd: root,
            env: runtimeEnv,
            forwardOutput: true,
            timeoutMs: 15 * 60 * 1000
          });
        } catch (error) {
          throw new Error(`${error.message}\n本地 API 尾部日志：\n${apiOutput.slice(-80).join("")}`);
        }
      }
      await command(
        process.execPath,
        [path.join(root, "services/api/prisma/verify-trial-run.cjs"), "--preflight"],
        { cwd: root, env: runtimeEnv, forwardOutput: true, timeoutMs: 15 * 60 * 1000 }
      );
      console.log("大额金额临时库与本地 HTTP 全链路验收通过");
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
