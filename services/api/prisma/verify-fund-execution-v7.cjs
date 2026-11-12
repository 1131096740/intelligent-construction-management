const { randomUUID } = require("node:crypto");
const { readdirSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");

const repositoryRoot = path.resolve(__dirname, "../../..");
const apiRoot = path.join(repositoryRoot, "services/api");
const migrationsRoot = path.join(__dirname, "migrations");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const databaseName = "jgzg_fund_execution_v7";
const databaseUser = "jiangkong";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    const stdout = String(result.stdout ?? "").trim();
    throw new Error(
      [`命令失败：${executable} ${args.join(" ")}`, stderr, stdout]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

function assertLocalDockerEndpoint() {
  const configured = String(process.env.DOCKER_HOST ?? "")
    .trim()
    .replace(/^"(.*)"$/u, "$1");
  invariant(
    !configured || configured.startsWith("unix://") || configured.startsWith("npipe://"),
    "v7 verifier 拒绝远程 Docker endpoint"
  );
  const inspected = command(docker, [
    "context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"
  ], { timeout: 10_000 }).stdout.trim();
  let endpoint;
  try { endpoint = JSON.parse(inspected); } catch { endpoint = null; }
  invariant(typeof endpoint === "string" && /^(unix|npipe):\/\//u.test(endpoint),
    "v7 verifier 只允许本机 Docker endpoint");
}

function psql(containerName, sql, invoke = command) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "jgzg-fund-sql-"));
  const localFile = path.join(temporaryDirectory, "statement.sql");
  const containerFile = `/tmp/jgzg-fund-sql-${randomUUID()}.sql`;
  try {
    writeFileSync(localFile, sql, { encoding: "utf8", mode: 0o600 });
    // A regular file reaches EOF independently of Docker's interactive input stream.
    // Keep the original SQL and psql transaction/error behavior unchanged.
    invoke(docker, ["cp", localFile, `${containerName}:${containerFile}`], { timeout: 180_000 });
    return invoke(docker, [
      "exec", containerName, "psql", "--username", databaseUser,
      "--dbname", databaseName, "--set", "ON_ERROR_STOP=1", "--no-psqlrc",
      "--tuples-only", "--no-align", "--quiet", "--file", containerFile
    ], { timeout: 180_000 });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function probePostgresReady(containerName, spawn = spawnSync) {
  const init = spawn(
    docker,
    ["exec", containerName, "cat", "/proc/1/comm"],
    { encoding: "utf8" }
  );
  if (init.status !== 0 || String(init.stdout ?? "").trim() !== "postgres") {
    return false;
  }
  const ready = spawn(
    docker,
    ["exec", containerName, "pg_isready", "-U", databaseUser, "-d", databaseName],
    { encoding: "utf8" }
  );
  return ready.status === 0;
}

function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (probePostgresReady(containerName)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("disposable PostgreSQL 16 在 30 秒内未就绪");
}

function migrationDirectories() {
  return readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function verifyCoreContractExists(containerName) {
  psql(
    containerName,
    `
DO $$
BEGIN
  IF to_regclass('public."VerifiedBankTransactionObservation"') IS NULL THEN
    RAISE EXCEPTION 'RED: VerifiedBankTransactionObservation is missing';
  END IF;
  IF to_regclass('public."BankTransactionClaim"') IS NULL THEN
    RAISE EXCEPTION 'RED: BankTransactionClaim is missing';
  END IF;
  IF to_regclass('public."FundExecution"') IS NULL THEN
    RAISE EXCEPTION 'RED: FundExecution is missing';
  END IF;
  IF to_regclass('public."ExecutionAllocationLine"') IS NULL THEN
    RAISE EXCEPTION 'RED: ExecutionAllocationLine is missing';
  END IF;
END;
$$;
`
  );
}

function hostDatabaseUrl(containerName, password) {
  const published = command(docker, ["port", containerName, "5432/tcp"], { timeout: 10_000 })
    .stdout.trim()
    .split(/\r?\n/u)
    .find((line) => line.startsWith("127.0.0.1:"));
  invariant(published, "无法解析 disposable PostgreSQL 的 loopback 端口");
  return `postgresql://${databaseUser}:${encodeURIComponent(password)}@${published}/${databaseName}`;
}

function runServicePostgresSpec(databaseUrl) {
  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    RUN_FUND_EXECUTION_V7_PG: "1",
    OPERATING_LEDGER_DB_WRITE_SECRET:
      "fund-execution-v7-pg-test-write-secret"
  };
  command(
    process.execPath,
    [path.join(apiRoot, "node_modules/prisma/build/index.js"), "generate"],
    { cwd: apiRoot, env: environment }
  );
  const result = command(
    process.execPath,
    [
      path.join(apiRoot, "node_modules/jest/bin/jest.js"),
      "--runInBand",
      "src/fund-execution/fund-execution-service.pg.spec.ts"
    ],
    { cwd: apiRoot, env: environment }
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function main() {
  const suffix = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const containerName = `jgzg-fund-execution-v7-${suffix}`;
  const password = randomUUID(), runId = randomUUID();
  let containerId;
  try {
    assertLocalDockerEndpoint();
    command(docker, ["image", "inspect", "postgres:16"], { timeout: 10_000 });
    const created = command(docker, [
      "run",
      "--detach",
      "--rm",
      "--pull=never",
      "--name",
      containerName,
      "--label",
      CI_DYNAMIC_MIGRATION_LABEL + "=" + runId,
      "--env",
      `POSTGRES_USER=${databaseUser}`,
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      `POSTGRES_DB=${databaseName}`,
      "--publish",
      "127.0.0.1::5432",
      "postgres:16"
    ], { env: { ...process.env, POSTGRES_PASSWORD: password }, timeout: 60_000 });
    const startedId = created.stdout.trim();
    invariant(/^[a-f0-9]{64}$/u.test(startedId), "v7 verifier 无法确认本轮容器");
    containerId = startedId;
    waitForPostgres(containerId);
    const version = psql(containerId, "SHOW server_version_num;").stdout.trim();
    invariant(/^16\d{4}$/u.test(version), `verifier 要求 PostgreSQL 16，实际为 ${version}`);
    const databaseUrl = hostDatabaseUrl(containerId, password);
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "jgzg-fund-staged-"));
    try {
      const migrationFixture = createCiDynamicMigrationFixture({
        ciFixture: "DYNAMIC_FUND_EXECUTION_V7_V1",
        container: { id: containerId, name: containerName, runId },
        databaseNames: [databaseName], temporaryRoot,
        dockerCommand: (args, { stdinText, timeoutMs, maxOutputBytes }) =>
          command(docker, args, { input: stdinText, timeout: timeoutMs, maxBuffer: maxOutputBytes }),
        deploy: ({ databaseUrl, runtimeEnv, schemaPath }) =>
          command(process.execPath, [path.join(apiRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", schemaPath],
            { cwd: apiRoot, env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, timeout: 15 * 60 * 1000 })
      });
      await migrationFixture.migrate({
        databaseUrl, runtimeEnv: { ...process.env, NODE_ENV: "test" }, schemaPath: path.join(__dirname, "schema.prisma")
      });
      verifyCoreContractExists(containerId);
      runServicePostgresSpec(databaseUrl);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    if (containerId) {
      command(docker, ["rm", "--force", "--volumes", containerId], { timeout: 60_000 });
    }
  }
  console.log(
    `Fund execution v7 verifier GREEN：PostgreSQL 16，${migrationDirectories().length} migrations，FundExecutionService PG spec`
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLocalDockerEndpoint,
  main,
  migrationDirectories,
  probePostgresReady,
  psql,
  runServicePostgresSpec
};
