const { randomUUID } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "../../..");
const apiRoot = path.join(repositoryRoot, "services/api");
const migrationsRoot = path.join(__dirname, "migrations");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const databaseName = "jgzg_fund_execution_v7";
const databaseUser = "jgzg_v7";

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
    "context",
    "inspect",
    "--format",
    "{{json .Endpoints.docker.Host}}"
  ]).stdout.trim();
  invariant(
    inspected.includes("unix://") || inspected.includes("npipe://"),
    "v7 verifier 只允许本机 Docker endpoint"
  );
}

function psql(containerName, sql) {
  return command(
    docker,
    [
      "exec",
      "--interactive",
      containerName,
      "psql",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
      "--set",
      "ON_ERROR_STOP=1",
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--quiet"
    ],
    { input: sql }
  );
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

function applyMigrations(containerName) {
  const directories = migrationDirectories();
  directories.forEach((directory, index) => {
    const migrationPath = path.join(migrationsRoot, directory, "migration.sql");
    psql(containerName, readFileSync(migrationPath, "utf8"));
    if ((index + 1) % 25 === 0 || index + 1 === directories.length) {
      console.log(`已重放 ${index + 1}/${directories.length} 个迁移目录`);
    }
  });
  return directories;
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
  const published = command(docker, ["port", containerName, "5432/tcp"])
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

function main() {
  const suffix = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const containerName = `jgzg-fund-execution-v7-${suffix}`;
  const password = randomUUID();
  let started = false;
  try {
    assertLocalDockerEndpoint();
    command(docker, ["image", "inspect", "postgres:16"]);
    command(docker, [
      "run",
      "--detach",
      "--rm",
      "--pull=never",
      "--name",
      containerName,
      "--env",
      `POSTGRES_USER=${databaseUser}`,
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      `POSTGRES_DB=${databaseName}`,
      "--publish",
      "127.0.0.1::5432",
      "postgres:16"
    ]);
    started = true;
    waitForPostgres(containerName);
    const version = psql(containerName, "SHOW server_version_num;").stdout.trim();
    invariant(/^16\d{4}$/u.test(version), `verifier 要求 PostgreSQL 16，实际为 ${version}`);
    const directories = applyMigrations(containerName);
    verifyCoreContractExists(containerName);
    runServicePostgresSpec(hostDatabaseUrl(containerName, password));
    console.log(
      `Fund execution v7 verifier GREEN：PostgreSQL 16，${directories.length} migrations，FundExecutionService PG spec`
    );
  } finally {
    if (started) {
      spawnSync(docker, ["rm", "--force", containerName], { encoding: "utf8" });
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  applyMigrations,
  assertLocalDockerEndpoint,
  main,
  migrationDirectories,
  probePostgresReady,
  runServicePostgresSpec
};
