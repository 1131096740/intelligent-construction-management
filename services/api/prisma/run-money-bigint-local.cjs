const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  assertLocalMoneyVerificationRuntime,
  withGuaranteedCleanup
} = require("../dist/database/money-bigint-live-verification");

const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";

function command(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: options.cwd ?? root,
      env: options.env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (options.forwardOutput) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (options.forwardOutput) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${commandName} ${args.join(" ")} failed (${signal ?? code})\n${stderr || stdout}`
        )
      );
    });
  });
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
        "jiangkong_money_verify"
      ]);
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
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) return;
    } catch {
      // API still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("本地 API 在 60 秒内未就绪");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 5000)
    )
  ]);
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
    storageDriver: runtimeEnv.FILE_STORAGE_DRIVER
  });

  let apiProcess;
  let containerStarted = false;
  let cleanupStarted = false;
  const apiOutput = [];

  const cleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    await stopProcess(apiProcess);
    if (containerStarted) {
      await command(docker, ["rm", "--force", containerName]).catch((error) => {
        if (!String(error.message).includes("No such container")) throw error;
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    console.log(`清理完成：API 已停止，临时容器 ${containerName} 与临时目录已删除`);
  };
  const interrupt = (signal) => {
    cleanup()
      .catch((error) => console.error(`中断清理失败：${error.message}`))
      .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
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
      containerStarted = true;
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
      await command(process.execPath, [path.join(root, "services/api/prisma/seed.cjs")], {
        cwd: temporaryRoot,
        env: runtimeEnv,
        forwardOutput: true
      });
      await command(
        process.execPath,
        [path.join(root, "services/api/prisma/prepare-money-bigint-local.cjs")],
        { cwd: root, env: runtimeEnv, forwardOutput: true }
      );

      apiProcess = spawn(process.execPath, [path.join(root, "services/api/dist/main.js")], {
        cwd: root,
        env: runtimeEnv,
        stdio: ["ignore", "pipe", "pipe"]
      });
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
            forwardOutput: true
          });
        } catch (error) {
          throw new Error(`${error.message}\n本地 API 尾部日志：\n${apiOutput.slice(-80).join("")}`);
        }
      }
      await command(
        process.execPath,
        [path.join(root, "services/api/prisma/verify-trial-run.cjs"), "--preflight"],
        { cwd: root, env: runtimeEnv, forwardOutput: true }
      );
      console.log("大额金额临时库与本地 HTTP 全链路验收通过");
    }, cleanup);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
