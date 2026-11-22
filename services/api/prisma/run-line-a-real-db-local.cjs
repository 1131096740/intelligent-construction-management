#!/usr/bin/env node
"use strict";

// Real PostgreSQL 16 + real Nest HTTP verification for the #395/#396/#415
// candidate line. Creates only its own disposable container, replays the whole
// migration ledger through the source-owned staged fixture, provisions the
// witness rows that no migration can create, then runs one HTTP spec.
const { randomBytes, randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createCommandRuntime } = require("./money-bigint-runner-runtime.cjs");
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");

const root = path.resolve(__dirname, "../../..");
const containerImage = "postgres:16";
const ciFixture = "DYNAMIC_LINE_A_V1";
const database = "jiangkong_line_a_real_db";
const specFile = "src/database/line-a-real-db.http.pg.spec.ts";
const storageRoot = mkdtempSync(path.join(tmpdir(), "line-a-real-db-files-"));
const runId = randomUUID();
const containerName = `jiangkong-line-a-real-db-${runId}`;
const password = randomUUID();
const appRole = `jg_fixture_app_${randomBytes(12).toString("hex")}`;
const witnessKeys = {
  CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY: randomBytes(32).toString("hex"),
  CONTRACT_WORK_COMPLETION_WITNESS_KEY: randomBytes(32).toString("hex"),
  SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY: randomBytes(32).toString("hex"),
  SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY: randomBytes(32).toString("hex"),
  OPERATING_LEDGER_DB_WRITE_SECRET: `line-a-ledger-${randomUUID()}`
};
let containerId;
let endpoint;
const migrationOnly = process.argv.includes("--migrate-only");
const skippedCandidates = new Set((process.env.LINE_A_SKIP_CANDIDATE ?? "").split(",").filter(Boolean));
const requireClean = process.env.LINE_A_REQUIRE_CLEAN === "1";

function command(bin, args, env = process.env, { quiet = false, timeout = 300_000, input } = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`LINE_A_REAL_DB 命令失败：${bin} ${args[0]}`);
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
  endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], process.env, { quiet: true }).stdout.replace(/^"|"$/gu, "");
  if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
  const candidateSha = command("git", ["rev-parse", "HEAD"], process.env, { quiet: true }).stdout;
  const dirty = command("git", ["status", "--porcelain=v1"], process.env, { quiet: true }).stdout;
  if (requireClean && dirty) throw new Error("LINE_A_REQUIRE_CLEAN=1 要求干净工作树");

  const imageId = docker(["image", "inspect", "--format", "{{.Id}}", containerImage], { quiet: true }).stdout;
  if (!imageId) throw new Error(`本机缺少已缓存镜像 ${containerImage}`);
  const startedAt = new Date();
  const phases = [];
  const phase = async (name, run) => {
    const at = Date.now();
    const value = await run();
    phases.push({ name, durationMs: Date.now() - at });
    return value;
  };

  try {
    containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", containerName,
      "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,
      "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`,
      "--env", `POSTGRES_DB=${database}`, "--publish", "127.0.0.1::5432", containerImage],
      { quiet: true }).stdout;
    if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("一次性容器标识无效");
    let port;
    for (let attempt = 0; attempt < 40 && !port; attempt += 1) {
      const binding = docker(["port", containerId, "5432/tcp"], { quiet: true }).stdout;
      port = /^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];
      if (!port) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!port) throw new Error("数据库必须仅监听本机回环地址");
    docker(["exec", containerId, "sh", "-c",
      "for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d " + database + " && exit 0; sleep 0.2; done; exit 1"], { quiet: true });
    const ownerUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
    const runtimeUrl = `postgresql://${appRole}:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, NODE_ENV: "test", CI: "true", FILE_STORAGE_DRIVER: "local",
      FILE_STORAGE_ROOT: storageRoot, APPROVAL_SMS_ENABLED: "false", SMS_ENABLED: "false",
      DATABASE_URL: ownerUrl, JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex") };

    const { command: stagedCommand } = createCommandRuntime({ defaultCwd: root });
    const migration = createCiDynamicMigrationFixture({
      ciFixture, container: { id: containerId, name: containerName, runId }, databaseNames: [database],
      temporaryRoot: mkdtempSync(path.join(storageRoot, "staged-migrations-")),
      dockerCommand: (args, options) => stagedCommand("docker", ["--host", endpoint, ...args], { ...options, env: process.env }),
      deploy({ databaseUrl, runtimeEnv, schemaPath }) {
        const args = ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"];
        if (schemaPath) args.push("--schema", schemaPath);
        return { stdout: command(pnpm(), args, { ...runtimeEnv, DATABASE_URL: databaseUrl }, { quiet: true }).stdout };
      }
    });
    const installerGate = "20261118221000_contract_legacy_guard_relation_namespace";
    const diagnoseGate = process.argv.includes("--diagnose-archive-gate");
    const terminalMigration = "20261119006400_contract_work_completion_original_subject";
    let fullLedger;
    await phase("migrate-staged-prefix-and-tail", async () => {
      try {
        await migration.migrate({ databaseUrl: ownerUrl, runtimeEnv: env });
        fullLedger = { status: "applied", ledgerMode: "FULL_STAGED_320" };
      } catch (error) {
        // The source-owned staged fixture stops when the clean ledger reaches
        // the archive-installer gate at index 276. Production runs the
        // 20261111060000/20261111070000 archive installers before this boundary;
        // no migration in this repository creates their binding rows.
        const failed = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
          `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;`],
          { quiet: true }).stdout;
        if (failed !== installerGate) throw error;
        fullLedger = { status: "blocked", ledgerMode: "PREFIX_275_PLUS_CANDIDATE", gate: installerGate,
          cause: "20261118221000 要求生产归档安装器已执行的 requireActiveProjectParticipatingCompany 前态；仓库内无迁移写入归档闭包/意图绑定行",
          productionInstaller: ".github/task12-install-295/contract-finance" };
        process.stdout.write(`LINE_A_FULL_LEDGER_GATE_BLOCKED ${installerGate}; candidate flows continue\n`);
        if (diagnoseGate) {
          // Diagnostic only: apply the source-pinned guard-body shim, then show
          // the next installer-gated migration. This path is never used for the
          // candidate HTTP pass and never fakes archive binding rows.
          const shim = require("node:fs").readFileSync(path.join(__dirname, "line-a-replay-archive-install-shim.sql"), "utf8");
          docker(["exec", "-i", containerId, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-f", "-"],
            { quiet: true, input: shim });
          command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "resolve", "--rolled-back", installerGate],
            { ...env, DATABASE_URL: ownerUrl }, { quiet: true });
          try {
            command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"],
              { ...env, DATABASE_URL: ownerUrl }, { quiet: true });
            fullLedger = { ...fullLedger, status: "applied", ledgerMode: "FULL_STAGED_320_WITH_REPLAY_SHIM" };
          } catch {
            const next = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
              `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;`],
              { quiet: true }).stdout;
            fullLedger = { ...fullLedger, nextGate: next,
              nextCause: "20261118223000 要求真实 jg_contract_direct_upward_closure_v2 归档闭包行；伪造该行会使 jg_require_contract_direct_upward_source_v2() 的 INTO STRICT 失败" };
            process.stdout.write(`LINE_A_FULL_LEDGER_NEXT_GATE ${next || "UNKNOWN"}\n`);
          }
        }
      }
    });
    if (diagnoseGate) {
      const count = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
        `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`], { quiet: true }).stdout;
      const receipt = {
        schemaVersion: 1, status: fullLedger.status === "applied" ? "passed_full_320" : "full_ledger_blocked",
        candidateSha, worktreeClean: dirty.length === 0, containerImage, imageId, database,
        migrationCount: Number(count), ledgerMode: fullLedger.ledgerMode, fullLedgerReplay: fullLedger,
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime()
      };
      process.stdout.write(`LINE_A_DIAGNOSE_RECEIPT ${JSON.stringify(receipt)}\n`);
      if (fullLedger.status !== "applied") process.exitCode = 2;
      return;
    }
    const migrationRoot = path.join(__dirname, "migrations");
    const baseCandidates = ["20261119003500_fund_balance_correction_controlled_round",
      "20261119003600_fund_balance_notice_lock"];
    const candidateMigrations = [...baseCandidates, ...require("node:fs").readdirSync(migrationRoot)
      .filter(name => /^2026111900[4-9][0-9]{3}_/u.test(name))
      .sort()];
    const appliedCandidates = [];
    const skipped = [];
    if (fullLedger?.status !== "applied") for (const name of candidateMigrations) {
      if ([...skippedCandidates].some(prefix => name.startsWith(prefix))) { skipped.push(name); continue; }
      const sql = require("node:fs").readFileSync(path.join(migrationRoot, name, "migration.sql"), "utf8");
      try {
        docker(["exec", "-i", containerId, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-f", "-"],
          { quiet: true, input: sql });
        appliedCandidates.push(name);
      } catch (error) {
        throw new Error(`候选迁移失败 ${name}: ${error.message}`);
      }
    }
    const candidateApply = { applied: appliedCandidates.length, skipped,
      firstApplied: appliedCandidates[0], lastApplied: appliedCandidates.at(-1) };
    process.stdout.write(`LINE_A_CANDIDATE_MIGRATIONS applied=${appliedCandidates.length} skipped=${JSON.stringify(skipped)}\n`);
    const ledger = docker(["exec", containerId, "psql", "-X", "-A", "-t", "-U", "jiangkong", "-d", database, "-c",
      `SELECT count(*), max(migration_name) FILTER (WHERE migration_name='${terminalMigration}') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`],
      { quiet: true }).stdout;
    const [migrationCount, terminal] = ledger.split("|");
    if (fullLedger?.status === "applied") {
      if (Number(migrationCount) !== 320 || terminal !== terminalMigration) {
        throw new Error(`迁移终点证明不完整：count=${migrationCount} terminal=${terminal}`);
      }
    } else if (Number(migrationCount) < 275) {
      throw new Error(`候选流程重放前置不足：count=${migrationCount}`);
    }

    await phase("provision-runtime-role-and-witnesses", () => {
      const witnessTables = [
        "jg_contract_signed_change_submit_witness", "jg_contract_work_completion_witness",
        "jg_signed_settlement_attachment_witness_key", "jg_signed_settlement_draft_witness_key",
        "jg_fund_balance_correction_witness_key", "jg_fund_balance_notice_witness",
        "jg_contract_direct_pending_binding_v1", "OperatingLedgerWriteSecret"
      ].map(table => `public.${/^[A-Z]/u.test(table) ? `"${table}"` : table}`).join(", ");
      const witnessRows = `
        DELETE FROM public.jg_contract_signed_change_submit_witness;
        DELETE FROM public.jg_contract_work_completion_witness;
        DELETE FROM public.jg_signed_settlement_attachment_witness_key;
        DELETE FROM public.jg_signed_settlement_draft_witness_key;
        INSERT INTO public.jg_contract_signed_change_submit_witness(singleton,"key","databaseOid","runtimeRoleOid")
          VALUES (true, decode('${witnessKeys.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY}','hex'),
            (SELECT oid FROM pg_database WHERE datname=current_database()),
            (SELECT oid FROM pg_roles WHERE rolname='${appRole}'));
        INSERT INTO public.jg_contract_work_completion_witness(singleton,"key","databaseOid","runtimeRoleOid")
          VALUES (true, decode('${witnessKeys.CONTRACT_WORK_COMPLETION_WITNESS_KEY}','hex'),
            (SELECT oid FROM pg_database WHERE datname=current_database()),
            (SELECT oid FROM pg_roles WHERE rolname='${appRole}'));
        INSERT INTO public.jg_signed_settlement_attachment_witness_key(singleton,"key")
          VALUES (true, decode('${witnessKeys.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY}','hex'));
        INSERT INTO public.jg_signed_settlement_draft_witness_key(singleton,"key")
          VALUES (true, decode('${witnessKeys.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY}','hex'));`;
      const ownerSql = `
        CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
        GRANT USAGE ON SCHEMA public TO ${appRole};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRole};
        REVOKE ALL ON TABLE ${witnessTables} FROM ${appRole};
        GRANT SELECT ON TABLE public.jg_contract_direct_pending_binding_v1 TO ${appRole};
        ${witnessRows}`;
      const file = path.join(storageRoot, "provision-runtime.sql");
      require("node:fs").writeFileSync(file, ownerSql, { mode: 0o600 });
      docker(["exec", "-i", containerId, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", database, "-f", "-"],
        { quiet: true, input: ownerSql });
      return ownerSql.length;
    });

    if (migrationOnly) {
      process.stdout.write(`LINE_A_MIGRATION_ONLY_PASS migrations=${migrationCount}\n`);
      return;
    }

    await phase("prisma-generate", () =>
      command(pnpm(), ["--filter", "@jiangkong/api", "exec", "prisma", "generate"], env, { quiet: true }));
    await phase("build-shared-domain", () =>
      command(pnpm(), ["--filter", "@jiangkong/shared-domain", "build"], env, { quiet: true }));
    const specEnv = { ...env, NODE_ENV: "test", DATABASE_URL: runtimeUrl, OWNER_DATABASE_URL: ownerUrl,
      RUN_LINE_A_REAL_DB: "1", ...witnessKeys };
    await phase("http-spec", () =>
      command(pnpm(), ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", "--runTestsByPath", specFile],
        specEnv, { timeout: 600_000 }));

    const fullApplied = fullLedger?.status === "applied" && Number(migrationCount) === 320;
    const receipt = {
      schemaVersion: 1,
      status: fullApplied ? "passed_full_320" : "candidate_http_passed_full_320_blocked",
      mode: "local_disposable_postgresql16", candidateSha, worktreeClean: dirty.length === 0,
      containerImage, imageId, database, appRole, migrationCount: Number(migrationCount),
      terminalMigration: terminal || null, candidateApply, ledgerMode: fullApplied ? "FULL_STAGED_320" : "PREFIX_275_PLUS_CANDIDATE",
      fullLedgerReplay: fullLedger,
      migrationPhases: phases, startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime()
    };
    process.stdout.write(`LINE_A_RECEIPT ${JSON.stringify(receipt)}\n`);
    if (!fullApplied) {
      process.stdout.write("LINE_A_SCOPE_WARNING 完整 320 迁移重放仍被归档安装器前置阻断；本次通过的是 275 前缀 + 候选迁移的 4 条业务链，未伪造 320 通过\n");
      if (process.env.LINE_A_REQUIRE_FULL_LEDGER === "1") throw new Error("LINE_A_FULL_LEDGER_REQUIRED");
    }
  } finally {
    if (process.env.LINE_A_KEEP === "1") {
      process.stderr.write(`LINE_A_KEEP container=${containerName} storage=${storageRoot}\n`);
    } else {
      if (containerId && /^[a-f0-9]{64}$/u.test(containerId)) {
        try { docker(["rm", "--force", "--volumes", containerId], { quiet: true }); } catch {}
      }
      rmSync(storageRoot, { recursive: true, force: true });
    }
  }
}

function pnpm() {
  return process.env.PNPM_BIN?.trim() || "pnpm";
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`LINE_A_REAL_DB 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
