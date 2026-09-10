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

const root = path.resolve(__dirname, "../../..");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const prismaCli = require.resolve("prisma/build/index.js");
const jestCli = require.resolve("jest/bin/jest");
const DATABASE_NAME = "jiangkong_pol279";
const IMAGE = "postgres:16";
const CONFIRMATION = "LOCAL_PG16_DYNAMIC_GATE";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function fail(message) {
  throw new Error(`POL-279 PostgreSQL 16 动态验收失败：${message}`);
}

function inheritedDatabaseTargets(environment) {
  return Object.keys(environment)
    .filter((name) => name === "DATABASE_URL" || name.endsWith("_DATABASE_URL"))
    .sort();
}

function assertSafeEnvironment(environment) {
  if (environment.NODE_ENV === "production") fail("禁止在 NODE_ENV=production 执行");
  if (environment.LOCAL_PG16_DYNAMIC_GATE !== CONFIRMATION) {
    fail(`必须显式确认 ${CONFIRMATION}`);
  }
  const inherited = inheritedDatabaseTargets(environment);
  if (inherited.length) fail(`拒绝继承数据库目标：${inherited.join(", ")}`);
  if (environment.DOCKER_HOST && !/^(unix|npipe):\/\//u.test(environment.DOCKER_HOST)) {
    fail("拒绝远程 Docker endpoint");
  }
}

async function assertExactCleanCandidate(environment) {
  const expectedSha = environment.POL279_EXPECTED_SHA ?? environment.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA;
  if (!expectedSha || !SHA_PATTERN.test(expectedSha)) {
    fail("缺少完整 40 位 POL279_EXPECTED_SHA");
  }
  const head = (await command("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (head !== expectedSha) fail("POL279_EXPECTED_SHA 与当前 HEAD 不一致");
  const status = (await command("git", ["status", "--porcelain"])).stdout;
  if (status.trim()) fail("工作树不干净，拒绝生成正式动态验收证据");
  return head;
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

async function assertLocalDocker() {
  const result = await command(docker, [
    "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"
  ]);
  let endpoint;
  try {
    endpoint = JSON.parse(result.stdout.trim());
  } catch {
    fail("无法解析 Docker context endpoint");
  }
  if (typeof endpoint !== "string" || !/^(unix|npipe):\/\//u.test(endpoint)) {
    fail("当前 Docker context 不是本机 socket");
  }
  await command(docker, ["info"]);
  const image = await command(docker, ["image", "inspect", "--format", "{{.Id}}", IMAGE]);
  return { endpoint, imageId: image.stdout.trim() };
}

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const init = await command(docker, ["exec", containerName, "cat", "/proc/1/comm"]);
      if (init.stdout.trim() !== "postgres") throw new Error("PostgreSQL 尚未接管 PID 1");
      await command(docker, ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", DATABASE_NAME]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  fail("临时 PostgreSQL 16 未在 30 秒内就绪");
}

async function main() {
  assertSafeEnvironment(process.env);
  const candidateSha = await assertExactCleanCandidate(process.env);
  const dockerEvidence = await assertLocalDocker();
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-pol279-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-pol279-"));
  const password = randomUUID();
  const databaseUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${DATABASE_NAME}`;
  const writeSecret = randomUUID();
  const runtimeEnvironment = {
    ...process.env,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    CI: "true",
    DATABASE_URL: databaseUrl,
    OPERATING_LEDGER_DB_WRITE_SECRET: writeSecret,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage", "private"),
    RUN_POL279_NECESSARY_EXPENSE_RESERVE_PG16: "1",
    SEED_PASSWORD: `Local@1-${randomUUID()}`
  };
  delete runtimeEnvironment.POL279_EXPECTED_SHA;
  delete runtimeEnvironment.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA;

  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () => command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 })
      .catch((error) => {
        if (!String(error?.message).includes("No such container")) throw error;
      }),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => console.log(`POL-279 动态验收清理完成：${containerName}`)
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
    await command(docker, [
      "run", "--detach", "--rm", "--pull=never", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD",
      "--env", `POSTGRES_DB=${DATABASE_NAME}`,
      "--publish", `127.0.0.1:${port}:5432`, IMAGE
    ], {
      env: { ...process.env, POSTGRES_PASSWORD: password },
      forwardOutput: true,
      timeoutMs: 60_000
    });
    await waitForPostgres(containerName);
    const schemaPath = path.join(root, "services/api/prisma/schema.prisma");
    for (let pass = 0; pass < 2; pass += 1) {
      await command(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
        env: runtimeEnvironment,
        forwardOutput: true,
        timeoutMs: 15 * 60 * 1000
      });
    }
    await command(process.execPath, [path.join(root, "services/api/prisma/seed.cjs")], {
      cwd: temporaryRoot,
      env: runtimeEnvironment,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    });
    await command(process.execPath, [
      jestCli,
      "--runInBand",
      "src/database/necessary-expense-reserve-postgresql.spec.ts"
    ], {
      cwd: path.join(root, "services/api"),
      env: runtimeEnvironment,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    });
    console.log(JSON.stringify({
      result: "PASS",
      candidateSha,
      postgresImage: IMAGE,
      postgresImageId: dockerEvidence.imageId,
      dockerEndpoint: dockerEvidence.endpoint,
      database: DATABASE_NAME,
      productionTouched: false
    }));
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
