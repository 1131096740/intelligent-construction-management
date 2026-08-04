const { spawn } = require("node:child_process");
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

const root = path.resolve(__dirname, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
        "exec", containerName, "pg_isready", "-U", "jiangkong", "-d",
        "jiangkong_governance_uat"
      ], { timeoutMs: 15_000 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("合同结算治理 UAT 临时 PostgreSQL 在 30 秒内未就绪");
}

async function waitForApi(apiBaseUrl, apiProcess, apiOutput) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (apiProcess.exitCode !== null) {
      throw new Error(`合同结算治理 UAT API 提前退出：\n${apiOutput.join("")}`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // API still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("合同结算治理 UAT API 在 60 秒内未就绪");
}

async function main() {
  const evidencePath = process.env.TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH;
  assert(evidencePath, "必须设置 TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH 以保留隔离 UAT 证据");
  const [databasePort, apiPort, freezeApiPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort()
  ]);
  const suffix = `${Date.now()}-${process.pid}`;
  const runId = process.env.TRIAL_RUN_ID || `governance-${suffix}`;
  const containerName = `jiangkong-governance-uat-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-governance-uat-"));
  const databasePassword = randomUUID();
  const seedPassword = `Local@1-${randomUUID()}`;
  const trialPassword = `Trial@1-${randomUUID()}`;
  const databaseUrl = `postgresql://jiangkong:${databasePassword}@127.0.0.1:${databasePort}/jiangkong_governance_uat`;
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const freezeApiBaseUrl = `http://127.0.0.1:${freezeApiPort}`;
  const shaResult = await command("git", ["rev-parse", "HEAD"]);
  const candidateSha = shaResult.stdout.trim();
  assert(/^[0-9a-f]{40}$/.test(candidateSha), "无法读取当前 40 位候选 SHA");
  const statusResult = await command("git", ["status", "--porcelain"]);
  assert(!statusResult.stdout.trim(), "候选工作树必须洁净后才能生成 SHA 绑定的隔离 UAT 证据");
  if (process.env.TRIAL_RUN_CANDIDATE_SHA) {
    assert(process.env.TRIAL_RUN_CANDIDATE_SHA === candidateSha, "指定候选 SHA 与当前 HEAD 不一致");
  }
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
    SEED_PASSWORD: seedPassword,
    TRIAL_RUN_PASSWORD: trialPassword,
    TRIAL_RUN_ID: runId,
    TRIAL_RUN_CANDIDATE_SHA: candidateSha,
    TRIAL_RUN_GOVERNANCE_EVIDENCE_PATH: path.resolve(evidencePath)
  };

  let apiProcess;
  const apiOutput = [];
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () => command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 })
      .catch((error) => {
        if (!String(error?.message).includes("No such container")) throw error;
      }),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => console.log("合同结算治理 UAT 临时 API、PostgreSQL 与本地存储已清理")
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
    await command(docker, ["info"]);
    await command(docker, [
      "run", "--detach", "--rm", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD",
      "--env", "POSTGRES_DB=jiangkong_governance_uat",
      "--publish", `127.0.0.1:${databasePort}:5432`, "postgres:16"
    ], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? temporaryRoot, POSTGRES_PASSWORD: databasePassword },
      forwardOutput: true
    });
    await waitForPostgres(containerName);
    await command(pnpm, ["--filter", "@jiangkong/api", "build"], { env: runtimeEnv, timeoutMs: 15 * 60 * 1000 });
    console.log("合同结算治理 UAT API 构建完成");
    await command(pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], { env: runtimeEnv });
    console.log("合同结算治理 UAT 迁移完成");
    await command(process.execPath, [path.join(root, "services/api/prisma/seed.cjs")], { cwd: temporaryRoot, env: runtimeEnv });
    console.log("合同结算治理 UAT seed 完成");

    apiProcess = commandRuntime.track(spawn(process.execPath, [path.join(root, "services/api/dist/main.js")], {
      cwd: root,
      env: runtimeEnv,
      stdio: ["ignore", "pipe", "pipe"]
    }));
    for (const stream of [apiProcess.stdout, apiProcess.stderr]) {
      stream.on("data", (chunk) => {
        apiOutput.push(String(chunk));
        if (apiOutput.length > 200) apiOutput.shift();
      });
    }
    await waitForApi(apiBaseUrl, apiProcess, apiOutput);
    const freezeApiOutput = [];
    const freezeApiProcess = commandRuntime.track(spawn(process.execPath, [path.join(root, "services/api/dist/main.js")], {
      cwd: root,
      env: {
        ...runtimeEnv,
        PORT: String(freezeApiPort),
        API_BASE_URL: freezeApiBaseUrl,
        OPERATIONAL_WRITE_FREEZE_MODE: "all"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }));
    for (const stream of [freezeApiProcess.stdout, freezeApiProcess.stderr]) {
      stream.on("data", (chunk) => {
        freezeApiOutput.push(String(chunk));
        if (freezeApiOutput.length > 200) freezeApiOutput.shift();
      });
    }
    await waitForApi(freezeApiBaseUrl, freezeApiProcess, freezeApiOutput);
    try {
      await command(process.execPath, [path.join(__dirname, "run-contract-settlement-governance-uat.cjs")], {
        cwd: root,
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 30 * 60 * 1000
      });
      await command(process.execPath, [
        path.join(__dirname, "verify-trial-run.cjs"),
        "--isolated-write-uat"
      ], {
        cwd: root,
        env: runtimeEnv,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      });
      if (process.env.TRIAL_RUN_BROWSER_SCRIPT) {
        assert(
          process.env.REAL_BROWSER_EVIDENCE_PATH &&
            path.isAbsolute(process.env.REAL_BROWSER_EVIDENCE_PATH) &&
            process.env.REAL_BROWSER_EVIDENCE_PATH.endsWith(".json"),
          "设置 TRIAL_RUN_BROWSER_SCRIPT 时必须显式提供绝对 REAL_BROWSER_EVIDENCE_PATH"
        );
        await command(process.execPath, [path.resolve(process.env.TRIAL_RUN_BROWSER_SCRIPT)], {
          cwd: root,
          env: {
            ...runtimeEnv,
            REAL_API_BASE_URL: apiBaseUrl,
            REAL_FREEZE_API_BASE_URL: freezeApiBaseUrl,
            REAL_ROLE_PASSWORD: trialPassword,
            REAL_BROWSER_CANDIDATE_SHA: candidateSha,
            REAL_BROWSER_EVIDENCE_PATH: path.resolve(process.env.REAL_BROWSER_EVIDENCE_PATH)
          },
          forwardOutput: true,
          timeoutMs: 30 * 60 * 1000
        });
      }
    } catch (error) {
      throw new Error(`${error.message}\n本地 API 尾部日志：\n${apiOutput.slice(-80).join("")}`);
    }
    console.log(`合同结算治理隔离 UAT 通过；候选 ${candidateSha}；证据 ${path.resolve(evidencePath)}`);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { freePort, main, waitForApi, waitForPostgres };
