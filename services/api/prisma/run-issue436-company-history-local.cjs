#!/usr/bin/env node
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");
const { readbackWireLimit } = require("./local-staged-migration-controls.cjs");

const root = resolve(__dirname, "../../..");
const migration = "20261129021000_company_history_expense";
const candidate = process.argv[2];
const image = process.argv[3];
const mode = process.argv[4] ?? "--target-sql";
const fullChain = mode === "--full-chain";
const runId = randomUUID();
const password = randomBytes(24).toString("hex");
const database = fullChain ? "jiangkong_line_a_real_db" : `issue436_company_${runId.replaceAll("-", "").slice(0, 12)}`;
const name = `jiangkong-issue436-company-${runId}`;
let container;
let endpoint;
let evidence;
let volumes = [];
let stage205Wire;

function log(file, output) {
  if (evidence) appendFileSync(join(evidence, file), output.replaceAll(password, "[redacted]"), { mode: 0o600 });
}

function run(bin, args, { env = process.env, timeout = 30_000, quiet = false, stdin, bothStreams = false, rawStdout = false, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, timeout, encoding: "utf8", maxBuffer, input: stdin });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (result.error || result.status !== 0) {
    log("first-error.log", `${bin} ${args[0]} exit=${result.error?.code ?? result.status}\n${output}\n`);
    process.stderr.write(output);
    throw new Error(`#436 命令失败 ${bin} ${args[0]} (${result.error?.code ?? result.status})`);
  }
  if (!quiet) process.stdout.write(output);
  const stdout = result.stdout ?? "";
  if (rawStdout) return stdout;
  return bothStreams ? output.trim() : stdout.trim();
}

function docker(args, options) {
  return run("docker", ["--host", endpoint, ...args], options);
}

function runStagedDockerCommand(dockerEndpoint, args, { env = process.env, timeoutMs, stdinText, maxOutputBytes }) {
  const stdout = run("docker", ["--host", dockerEndpoint, ...args], {
    env, quiet: true, timeout: timeoutMs, stdin: stdinText, maxBuffer: maxOutputBytes, rawStdout: true
  });
  return { stdout };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function immediatePreimage(schema) {
  const relation = /^  historyExpenseBatches +CompanyHistoryExpenseBatch\[\]\n/m;
  const block = /^\/\/ Company-only historical expenses[^\n]*\nmodel CompanyHistoryExpenseBatch \{[\s\S]*?(?=^model OperatingTakeoverBatch \{)/m;
  const models = [...(schema.match(block)?.[0] ?? "").matchAll(/^model (\w+) \{/gm)].map(match => match[1]);
  const expected = ["CompanyHistoryExpenseBatch", "CompanyHistoryExpenseRow", "CompanyHistoryExpenseFact"];
  if (!relation.test(schema) || JSON.stringify(models) !== JSON.stringify(expected)) {
    throw new Error("#436 前态剥离只允许移除三个目标模型及其公司反向关系");
  }
  const preimage = schema.replace(relation, "").replace(block, "");
  if (preimage.includes("CompanyHistoryExpense")) throw new Error("#436 前态包含未识别的公司历史费用数据结构");
  return preimage;
}

function psql(args, options) {
  return docker(["exec", "--interactive", container, "psql", "-X", "--set=ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, ...args], options);
}

function inspectSchema() {
  return JSON.parse(psql(["-At", "-c", `
    SELECT json_build_object(
      'baselineCompanyExists', to_regclass('public."CompanyEntity"') IS NOT NULL,
      'baselineProjectExists', to_regclass('public."OperatingFact"') IS NOT NULL,
      'baselineFundsExist', to_regclass('public."FundAccountBalanceRegistration"') IS NOT NULL,
      'migrationLedgerExists', to_regclass('public._prisma_migrations') IS NOT NULL,
      'targetTableCount', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname IN ('CompanyHistoryExpenseBatch', 'CompanyHistoryExpenseRow', 'CompanyHistoryExpenseFact')),
      'targetGuardCount', (SELECT count(*) FROM pg_trigger
        WHERE tgname IN ('CompanyHistoryExpenseFact_immutable', 'CompanyHistoryExpenseRow_posted_immutable')
          AND tgenabled = 'O')
    )`
  ], { quiet: true }));
}

function assertSchema(observed, tableCount, guardCount, migrationLedgerExists = false) {
  if (!observed.baselineCompanyExists || !observed.baselineProjectExists || !observed.baselineFundsExist ||
      observed.migrationLedgerExists !== migrationLedgerExists ||
      observed.targetTableCount !== tableCount || observed.targetGuardCount !== guardCount) {
    throw new Error("#436 SQL 前后态与目标迁移范围不符");
  }
}

function applyTargetSql(prisma, env, temporaryRoot, sql) {
  const targetSchema = readFileSync(join(root, "services/api/prisma/schema.prisma"), "utf8");
  const predecessor = immediatePreimage(targetSchema);
  const predecessorPath = join(temporaryRoot, "schema.prisma");
  writeFileSync(predecessorPath, predecessor, { mode: 0o600 });
  const schemaBuild = run("pnpm", [...prisma, "db", "push", "--skip-generate", "--schema", predecessorPath],
    { env, timeout: 120_000, quiet: true });
  log("preimage.log", schemaBuild + "\n");
  const before = inspectSchema();
  log("schema-before.json", JSON.stringify(before) + "\n");
  assertSchema(before, 0, 0);
  const migrationOutput = psql(["-f", "-"], { stdin: sql, quiet: true, timeout: 60_000 });
  log("target-migration.log", migrationOutput + "\n");
  const after = inspectSchema();
  log("schema-after.json", JSON.stringify(after) + "\n");
  assertSchema(after, 3, 2);
  return {
    migrationLedgerReplayed: false,
    migrationMode: "EXACT_TARGET_SQL_ON_SCHEMA_PREIMAGE",
    preimageSchemaSha256: sha256(predecessor)
  };
}

async function replayFullChain(prisma, env, temporaryRoot, databaseUrl) {
  const prismaRoot = join(root, "services/api/prisma");
  const migrationsRoot = join(prismaRoot, "migrations");
  const names = readdirSync(migrationsRoot, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
  if (names.length !== 352 || names.at(-1) !== migration) throw new Error("#436 完整验收要求准确 352 条迁移及 #436 终点");
  const expected = names.map(name => ({ name, checksum: sha256(readFileSync(join(migrationsRoot, name, "migration.sql"))) }));
  const fixture = createCiDynamicMigrationFixture({
    ciFixture: "DYNAMIC_LINE_A_V1",
    container: { id: container, name, runId },
    databaseNames: [database],
    temporaryRoot,
    dockerCommand(args, options) {
      const result = runStagedDockerCommand(endpoint, args, options);
      if (options.maxOutputBytes === readbackWireLimit) {
        writeFileSync(join(evidence, "stage205.wire"), result.stdout, { mode: 0o600, flag: "wx" });
        stage205Wire = {
          bytes: Buffer.byteLength(result.stdout),
          sha256: sha256(result.stdout),
          terminalLf: result.stdout.endsWith("\n")
        };
        log("stage205-wire.json", JSON.stringify(stage205Wire) + "\n");
      }
      return result;
    },
    deploy({ databaseUrl: actualUrl, runtimeEnv, schemaPath }) {
      const stdout = run("pnpm", [...prisma, "migrate", "deploy", "--schema", schemaPath], {
        env: { ...runtimeEnv, DATABASE_URL: actualUrl }, timeout: 240_000, quiet: true
      });
      log("migration.log", stdout + "\n");
      return { stdout };
    }
  });
  await fixture.migrate({ databaseUrl, runtimeEnv: env, schemaPath: join(prismaRoot, "schema.prisma") });

  // Capture the complete ledger after the fixture has independently checked its staged readback.
  const ledgerWire = psql(["-At", "-c", `
    SELECT json_agg(json_build_object('name', migration_name, 'checksum', checksum, 'finished', finished_at IS NOT NULL,
      'rolledBack', rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM _prisma_migrations
  `], { quiet: true, rawStdout: true });
  writeFileSync(join(evidence, "migration-ledger.json"), ledgerWire, { mode: 0o600 });
  const ledger = JSON.parse(ledgerWire);
  if (!Array.isArray(ledger) || ledger.length !== expected.length ||
      ledger.some((row, index) => !row.finished || row.rolledBack ||
        row.name !== expected[index].name || row.checksum !== expected[index].checksum) ||
      !stage205Wire?.terminalLf) {
    throw new Error("#436 完整迁移账本或第205段回读未通过");
  }
  const after = inspectSchema();
  log("schema-after.json", JSON.stringify(after) + "\n");
  assertSchema(after, 3, 2, true);
  return {
    migrationLedgerReplayed: true, migrationMode: "CANONICAL_STAGED_FULL_REPLAY",
    migrationCount: ledger.length, migrationLedgerSha256: sha256(ledgerWire), stage205Wire
  };
}

function cleanup() {
  let cleaned = false;
  try {
    if (container && /^[a-f0-9]{64}$/u.test(container)) {
      docker(["rm", "--force", "--volumes", container], { quiet: true });
      container = undefined;
    }
    const remaining = docker(["ps", "-aq", "--filter", `name=^/${name}$`], { quiet: true });
    const currentVolumes = docker(["volume", "ls", "--format", "{{.Name}}"], { quiet: true }).split("\n");
    cleaned = remaining.length === 0 && volumes.every(volume => !currentVolumes.includes(volume));
    if (!cleaned) throw new Error("隔离 PostgreSQL 容器或匿名卷仍存在");
  } finally {
    log("cleanup.json", JSON.stringify({ containerName: name, volumes, cleaned }) + "\n");
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" || !/^[0-9a-f]{40}$/.test(candidate ?? "") ||
      !/^sha256:[0-9a-f]{64}$/.test(image ?? "") ||
      !["--target-sql", "--full-chain"].includes(mode) || process.argv.length > 5) {
    throw new Error("请传入隔离工作树完整提交 SHA 和本机缓存镜像 ID，仅限本地测试");
  }
  if (run("git", ["rev-parse", "HEAD"], { quiet: true }) !== candidate ||
      run("git", ["status", "--porcelain"], { quiet: true })) {
    throw new Error("工作树必须干净且与 #436 验收提交一致");
  }
  endpoint = process.env.DOCKER_HOST ||
    run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { quiet: true });
  if (!endpoint.startsWith("unix://")) throw new Error("仅配置本机 Docker Unix 接口");
  if (docker(["image", "inspect", "--format", "{{.Id}}", image], { quiet: true }) !== image) {
    throw new Error("缺少已缓存的指定 PostgreSQL 镜像");
  }
  const startedAt = new Date().toISOString();
  evidence = mkdtempSync(join(tmpdir(), "jg436-company-history-pg-"));
  const temporaryRoot = mkdtempSync(join(evidence, fullChain ? "staged-" : "preimage-"));
  writeFileSync(join(evidence, "run.json"), JSON.stringify({ candidateSha: candidate, runId, containerName: name, image, startedAt, mode }), { mode: 0o600 });
  process.stdout.write(`ISSUE436_PG_EVIDENCE ${evidence}\n`);
  try {
    container = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
      "--label", "org.jiangkong.task=issue436-company-history",
      ...(fullChain ? ["--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`] : []),
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`, "--env", `POSTGRES_DB=${database}`,
      "--publish", "127.0.0.1::5432", image], { quiet: true });
    if (!/^[a-f0-9]{64}$/u.test(container)) throw new Error("一次性容器标识无效");
    const mounts = JSON.parse(docker(["inspect", "--type", "container", "--format", "{{json .Mounts}}", container], { quiet: true }));
    volumes = mounts.filter(mount => mount.Type === "volume").map(mount => mount.Name);
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(docker(["port", container, "5432/tcp"], { quiet: true }))?.[1];
    if (!port) throw new Error("数据库必须在本机回环地址");
    docker(["exec", container, "sh", "-c",
      'for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" && exit 0; sleep 0.25; done; exit 1'
    ], { quiet: true, timeout: 35_000 });
    const url = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: url, CHECKPOINT_DISABLE: "1",
      ISSUE436_COMPANY_HISTORY_RUN: "1", ISSUE436_COMPANY_HISTORY_DATABASE_URL: url,
      ISSUE436_COMPANY_HISTORY_RUN_ID: runId, ISSUE436_COMPANY_HISTORY_MODE: mode,
      APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false" };
    const prisma = ["--filter", "@jiangkong/api", "exec", "prisma"];
    run("pnpm", [...prisma, "generate"], { env, timeout: 60_000, quiet: true });
    const sql = readFileSync(join(root, "services/api/prisma/migrations", migration, "migration.sql"));
    const migrationProof = fullChain
      ? await replayFullChain(prisma, env, temporaryRoot, url)
      : applyTargetSql(prisma, env, temporaryRoot, sql);
    psql(["-At", "-c", `ALTER DATABASE "${database}" SET "app.issue436_company_run" = '${runId}'`], { quiet: true });
    run("pnpm", ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", "--runTestsByPath",
      "src/database/issue436-company-history-expense.pg.spec.ts"], { env, timeout: 90_000 });
    cleanup();
    const receipt = {
      status: "PASSED", candidateSha: candidate, migration, ...migrationProof,
      migrationSqlSha256: sha256(sql),
      image, database, startedAt, finishedAt: new Date().toISOString(), cleaned: true
    };
    log("receipt.json", JSON.stringify(receipt) + "\n");
    process.stdout.write(`ISSUE436_COMPANY_HISTORY_RECEIPT ${JSON.stringify(receipt)}\n`);
  } catch (error) {
    log("first-error.log", error.message + "\n");
    if (container) {
      try {
        log("postgres.log", docker(["logs", container], { quiet: true, bothStreams: true }) + "\n");
      } catch (logError) {
        log("first-error.log", logError.message + "\n");
      }
    }
    cleanup();
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { runStagedDockerCommand };
