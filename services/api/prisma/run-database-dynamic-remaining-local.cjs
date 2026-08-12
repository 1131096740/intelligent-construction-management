#!/usr/bin/env node
"use strict";

const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../../..");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const IMAGE = "postgres:16";
const CONFIRMATION = "LOCAL_PG16_DYNAMIC_GATE";
const EXPECTED_MIGRATION_COUNT = 125;
const TERMINAL_MIGRATION =
  "20260811090000_contract_document_content_revision";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

const GROUPS = [
  {
    id: "contract_draft_aggregate",
    database: "jiangkong_contract_draft_aggregate_test",
    files: [
      "src/database/contract-draft-aggregate-concurrency.spec.ts",
      "src/database/contract-draft-retention-script.spec.ts",
      "src/database/contract-lifecycle-route.spec.ts",
      "src/database/contract-ended-application-retention.spec.ts",
      "src/database/contract-ended-application-purge.spec.ts",
      "src/database/legacy-contract-cleanup-preflight-postgres.spec.ts"
    ],
    flags: {
      RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE: "1",
      CONTRACT_DRAFT_AGGREGATE_DATABASE_URL: "databaseUrl",
      DATABASE_URL: "databaseUrl"
    },
    pendingTests: 16
  },
  {
    id: "project_funding_availability",
    database: "jiangkong_project_funding_integration_test",
    files: ["src/database/project-funding-availability-concurrency.spec.ts"],
    flags: {
      RUN_PROJECT_FUNDING_DATABASE: "1",
      PROJECT_FUNDING_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 1
  },
  {
    id: "takeover_task1",
    database: "jiangkong_contract_takeover_task1_20260729",
    files: [
      "src/database/contract-takeover-confirmation-concurrency.spec.ts",
      "src/database/contract-takeover-balance-concurrency.spec.ts"
    ],
    flags: {
      RUN_CONTRACT_TAKEOVER_CONFIRMATION_CONCURRENCY: "1",
      CONTRACT_TAKEOVER_CONFIRMATION_DATABASE_URL: "databaseUrl",
      RUN_CONTRACT_TAKEOVER_BALANCE_CONCURRENCY: "1",
      CONTRACT_TAKEOVER_BALANCE_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 3
  },
  {
    id: "affiliate_company_contract",
    database: "jiangkong_project_affiliate_company_contract_test",
    files: ["src/database/project-affiliate-company-contract-db.spec.ts"],
    flags: {
      RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS: "1",
      PROJECT_AFFILIATE_COMPANY_CONTRACT_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 4
  },
  {
    id: "spot_material_classification",
    database: "jiangkong_spot_incidental_task11",
    files: ["src/database/spot-material-classification-concurrency.spec.ts"],
    flags: {
      RUN_SPOT_MATERIAL_CLASSIFICATION_DATABASE: "1",
      SPOT_MATERIAL_CLASSIFICATION_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 1
  },
  {
    id: "direct_payment_capacity",
    database: "jiangkong_direct_payment_task13",
    files: ["src/database/direct-payment-capacity-concurrency.spec.ts"],
    flags: {
      RUN_DIRECT_PAYMENT_CAPACITY_CONCURRENCY: "1",
      DIRECT_PAYMENT_CAPACITY_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 1
  },
  {
    id: "takeover_correction",
    database: "jiangkong_contract_takeover_task8_final_20260729",
    files: ["src/database/contract-takeover-correction-concurrency.spec.ts"],
    flags: {
      RUN_CONTRACT_TAKEOVER_CORRECTION_CONCURRENCY: "1",
      CONTRACT_TAKEOVER_CORRECTION_DATABASE_URL: "databaseUrl"
    },
    pendingTests: 1
  },
  {
    id: "file_binding_manifest",
    database: "jiangkong_file_binding_manifest_test",
    files: ["src/database/file-binding-manifest.spec.ts"],
    flags: {
      RUN_FILE_BINDING_MANIFEST_DATABASE: "1",
      FILE_BINDING_MANIFEST_DATABASE_URL: "databaseUrl",
      DATABASE_URL: "databaseUrl"
    },
    pendingTests: 1
  },
  {
    id: "generic_database_constraints",
    database: "jiangkong_database_dynamic_misc",
    files: [
      "src/database/settlement-contract-cap-concurrency.spec.ts",
      "src/database/contract-change-limit-transaction.spec.ts",
      "src/database/project-affiliate-business-fact-db.spec.ts",
      "src/database/approval-review-concurrency.spec.ts",
      "src/database/contract-change-baseline-concurrency.spec.ts",
      "src/database/project-upstream-fund-fact-db.spec.ts",
      "src/database/contract-governance-file-concurrency.spec.ts",
      "src/database/project-external-upstream-db.spec.ts",
      "src/database/project-affiliate-subject-db.spec.ts"
    ],
    flags: {
      DATABASE_URL: "databaseUrl",
      RUN_SETTLEMENT_CONTRACT_CAP_CONCURRENCY: "1",
      RUN_CONTRACT_CHANGE_LIMIT_DATABASE: "1",
      RUN_PROJECT_AFFILIATE_BUSINESS_DB_TESTS: "1",
      RUN_APPROVAL_REVIEW_CONCURRENCY: "1",
      RUN_CONTRACT_CHANGE_BASELINE_CONCURRENCY: "1",
      RUN_PROJECT_UPSTREAM_FUND_DB_TESTS: "1",
      RUN_CONTRACT_GOVERNANCE_CONCURRENCY: "1",
      RUN_PROJECT_EXTERNAL_UPSTREAM_DB_TESTS: "1",
      RUN_PROJECT_AFFILIATE_DB_TESTS: "1"
    },
    pendingTests: 14
  }
];

const ALLOWED_DATABASE_NAMES = new Set(GROUPS.map((group) => group.database));

function fail(message) {
  throw new Error(message);
}

function isLocalHostName(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function isLocalDockerSocketEndpoint(endpoint) {
  return (
    /^unix:\/\/\/[^\r\n]+$/u.test(endpoint) ||
    /^npipe:\/{4}\.\/pipe\/[^/\r\n]+$/u.test(endpoint)
  );
}

function assertLocalDockerEndpoint(value) {
  const endpoint = String(value ?? "").trim().replace(/^"(.*)"$/u, "$1");
  if (!isLocalDockerSocketEndpoint(endpoint)) {
    fail("剩余数据库动态门拒绝远程或不可证明为本机 socket 的 Docker endpoint");
  }
  return endpoint;
}

function inheritedDatabaseTargetNames(env) {
  return Object.entries(env)
    .filter(([key, value]) => {
      const normalized = key.toUpperCase();
      return (
        Boolean(String(value ?? "").trim()) &&
        (normalized === "DATABASE_URL" || normalized.endsWith("_DATABASE_URL"))
      );
    })
    .map(([key]) => key)
    .sort();
}

function assertSafeEnvironment(env) {
  if (env.LOCAL_PG16_DYNAMIC_GATE !== CONFIRMATION) {
    fail(`剩余数据库动态门必须提供 ${CONFIRMATION} 确认串`);
  }
  if (!SHA_PATTERN.test(env.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA ?? "")) {
    fail("剩余数据库动态门必须提供精确候选 SHA");
  }
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") {
    fail("剩余数据库动态门禁止在 NODE_ENV=production 下执行");
  }
  const inherited = inheritedDatabaseTargetNames(env);
  if (inherited.length > 0) {
    fail(`剩余数据库动态门拒绝继承数据库目标变量：${inherited.join(", ")}`);
  }
  assertLocalDockerEndpoint(env.DOCKER_HOST);
}

function assertLocalDatabaseUrl(value, expectedDatabase) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("剩余数据库动态门生成了无效 PostgreSQL URL");
  }
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !isLocalHostName(parsed.hostname) ||
    parsed.pathname !== `/${expectedDatabase}` ||
    !ALLOWED_DATABASE_NAMES.has(expectedDatabase)
  ) {
    fail("剩余数据库动态门拒绝非本机一次性专库 URL");
  }
  return parsed.toString();
}

function databaseUrlFor(password, port, database) {
  return assertLocalDatabaseUrl(
    `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`,
    database
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.forwardOutput ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = `${stdout}\n${stderr}`.trim().slice(-2400);
      reject(
        new Error(
          `${path.basename(command)} ${args.join(" ")} 失败（code=${
            code ?? "none"
          }, signal=${signal ?? "none"}）${detail ? `：${detail}` : ""}`
        )
      );
    });
  });
}

async function assertRepositoryState(candidateSha) {
  const head = await run("git", ["rev-parse", "HEAD"]);
  if (head.stdout.trim().toLowerCase() !== candidateSha.toLowerCase()) {
    fail(`候选 SHA 不一致：requested=${candidateSha} current=${head.stdout.trim()}`);
  }
  const status = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.stdout.trim()) fail("剩余数据库动态门要求干净工作树");
}

async function waitForPostgres(containerName, database) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run(docker, ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", database]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  fail("剩余数据库动态门临时 PostgreSQL 16 在 30 秒内未就绪");
}

function createRuntimeEnvironment(base, temporaryRoot, databaseUrl, group) {
  const environment = {
    PATH: base.PATH ?? "",
    HOME: base.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    CI: "true"
  };
  for (const [key, value] of Object.entries(group.flags)) {
    environment[key] = value === "databaseUrl" ? databaseUrl : value;
  }
  return environment;
}

async function migrate(databaseUrl, environment) {
  await run(
    pnpm,
    ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"],
    { env: { ...environment, DATABASE_URL: databaseUrl }, forwardOutput: true }
  );
  await run(
    pnpm,
    ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "status"],
    { env: { ...environment, DATABASE_URL: databaseUrl }, forwardOutput: true }
  );
}

async function main(sourceEnv = process.env) {
  assertSafeEnvironment(sourceEnv);
  const candidateSha = sourceEnv.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA;
  await assertRepositoryState(candidateSha);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-database-dynamic-remaining-")
  );
  const port = await freePort();
  const password = randomUUID();
  const initialDatabase = GROUPS[0].database;
  const containerName = `jiangkong-database-dynamic-remaining-${Date.now()}-${process.pid}`;
  const dockerEnv = {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? temporaryRoot,
    DOCKER_HOST: assertLocalDockerEndpoint(sourceEnv.DOCKER_HOST)
  };
  const startedAt = new Date();
  const receipts = [];
  let containerRunAttempted = false;

  try {
    const context = await run(
      docker,
      ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
      { env: dockerEnv }
    );
    assertLocalDockerEndpoint(context.stdout);
    await run(docker, ["info", "--format", "{{json .ServerVersion}}"], {
      env: dockerEnv
    });
    const image = await run(
      docker,
      ["image", "inspect", "--format", "{{.Id}}", IMAGE],
      { env: dockerEnv }
    );
    const imageId = image.stdout.trim();
    if (!imageId) fail(`本机缺少已缓存镜像 ${IMAGE}`);

    await run(pnpm, ["--filter", "@jiangkong/api", "build"], {
      env: {
        PATH: sourceEnv.PATH ?? "",
        NODE_ENV: "test",
        CI: "true"
      },
      forwardOutput: true
    });

    await run(
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
        `POSTGRES_DB=${initialDatabase}`,
        "--publish",
        `127.0.0.1:${port}:5432`,
        IMAGE
      ],
      {
        env: { ...dockerEnv, POSTGRES_PASSWORD: password },
        forwardOutput: true
      }
    );
    containerRunAttempted = true;
    await waitForPostgres(containerName, initialDatabase);

    for (const group of GROUPS) {
      const groupStartedAt = Date.now();
      const databaseUrl = databaseUrlFor(password, port, group.database);
      if (group.database !== initialDatabase) {
        await run(docker, ["exec", containerName, "createdb", "-U", "jiangkong", group.database], {
          env: dockerEnv
        });
      }
      const environment = createRuntimeEnvironment(
        sourceEnv,
        temporaryRoot,
        databaseUrl,
        group
      );
      process.stdout.write(
        `[database-dynamic-remaining] start ${group.id} (${group.pendingTests} pending tests)\n`
      );
      await migrate(databaseUrl, environment);
      await run(
        pnpm,
        ["--filter", "@jiangkong/api", "test", "--", "--runInBand", ...group.files],
        { env: environment, forwardOutput: true }
      );
      receipts.push({
        id: group.id,
        database: group.database,
        pendingTests: group.pendingTests,
        files: group.files,
        durationMs: Date.now() - groupStartedAt,
        status: "passed"
      });
    }

    await assertRepositoryState(candidateSha);
    const finishedAt = new Date();
    const receipt = {
      schemaVersion: 1,
      gate: "jiangkong-local-postgresql16-remaining-dynamic",
      mode: "local_disposable_postgresql16",
      status: "passed",
      candidateSha,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      migrationCount: EXPECTED_MIGRATION_COUNT,
      terminalMigration: TERMINAL_MIGRATION,
      containerImage: IMAGE,
      containerImageId: imageId,
      executedTests: GROUPS.reduce((sum, group) => sum + group.pendingTests, 0),
      groups: receipts
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    if (containerRunAttempted) {
      await run(docker, ["rm", "--force", containerName], { env: dockerEnv }).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `剩余数据库动态门失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_DATABASE_NAMES,
  GROUPS,
  assertLocalDatabaseUrl,
  assertLocalDockerEndpoint,
  assertSafeEnvironment,
  createRuntimeEnvironment,
  databaseUrlFor,
  main
};
