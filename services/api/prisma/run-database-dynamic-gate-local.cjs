#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { resolveCorepackHome } = require("./money-bigint-runner-runtime.cjs");

const root = path.resolve(__dirname, "../../..");
const manifestPath = path.join(
  __dirname,
  "database-dynamic-gate-manifest.json"
);
const migrationRoot = path.join(__dirname, "migrations");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const SUITE_STATUSES = new Set(["fully_pending", "partial_pending"]);
const RUNNER_KINDS = new Set(["workspaceScript", "apiScript", "node"]);

function fail(message) {
  throw new Error(message);
}

function assertInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} 必须是非负整数`);
  }
}

function resolveRepositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    fail(`${label} 必须是仓库内相对路径`);
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail(`${label} 越出仓库边界`);
  }
  return resolved;
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadManifest(filePath = manifestPath) {
  return loadJson(filePath);
}

function listMigrationDirectories() {
  return readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function validateRunner(runner, groupId, rootPackage, apiPackage) {
  if (!runner || !RUNNER_KINDS.has(runner.kind)) {
    fail(`coveredGroups.${groupId}.runner.kind 不受支持`);
  }
  if (runner.kind === "workspaceScript") {
    if (!rootPackage.scripts?.[runner.script]) {
      fail(`coveredGroups.${groupId} 缺少根脚本 ${runner.script}`);
    }
  } else if (runner.kind === "apiScript") {
    if (!apiPackage.scripts?.[runner.script]) {
      fail(`coveredGroups.${groupId} 缺少 API 脚本 ${runner.script}`);
    }
  } else if (!runner.path) {
    fail(`coveredGroups.${groupId}.runner.path 不能为空`);
  }
  const runnerPath = resolveRepositoryPath(
    runner.path,
    `coveredGroups.${groupId}.runner.path`
  );
  if (!existsSync(runnerPath) || !statSync(runnerPath).isFile()) {
    fail(`coveredGroups.${groupId} runner 不存在：${runner.path}`);
  }
  const runnerSource = readFileSync(runnerPath, "utf8");
  if (
    !runnerSource.includes('"postgres:16"') ||
    !runnerSource.includes('"--pull=never"')
  ) {
    fail(`coveredGroups.${groupId} runner 未固定 postgres:16 与 --pull=never`);
  }
  if (
    runner.evidenceEnv !== undefined &&
    !/^[A-Z][A-Z0-9_]+$/u.test(runner.evidenceEnv)
  ) {
    fail(`coveredGroups.${groupId}.runner.evidenceEnv 非法`);
  }
}

function validateTestFile(file, label, seenPaths) {
  if (!file || !SUITE_STATUSES.has(file.suiteStatus)) {
    fail(`${label}.suiteStatus 非法`);
  }
  assertInteger(file.pendingTests, `${label}.pendingTests`);
  if (file.pendingTests === 0) fail(`${label}.pendingTests 不能为 0`);
  const absolutePath = resolveRepositoryPath(file.path, `${label}.path`);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(`${label} 测试文件不存在：${file.path}`);
  }
  if (seenPaths.has(file.path)) fail(`测试文件重复登记：${file.path}`);
  seenPaths.add(file.path);
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) {
    fail("database dynamic gate manifest schemaVersion 必须为 1");
  }
  const { inventory, migrationBaseline, executionPolicy } = manifest;
  if (!inventory || !migrationBaseline || !executionPolicy) {
    fail("manifest 缺少 inventory、migrationBaseline 或 executionPolicy");
  }
  for (const key of [
    "pendingFiles",
    "fullyPendingSuites",
    "partiallyPendingSuites",
    "pendingTests",
    "coveredFiles",
    "coveredTests",
    "remainingFiles",
    "remainingTests"
  ]) {
    assertInteger(inventory[key], `inventory.${key}`);
  }
  if (executionPolicy.mode !== "local_disposable_only") {
    fail("executionPolicy.mode 必须为 local_disposable_only");
  }
  if (!executionPolicy.confirmation) {
    fail("executionPolicy.confirmation 不能为空");
  }
  if (
    migrationBaseline.postgresMajorVersion !== 16 ||
    migrationBaseline.containerImage !== "postgres:16" ||
    migrationBaseline.allowImagePull !== false
  ) {
    fail("manifest 必须固定为不拉取镜像的本机 PostgreSQL 16 动态门");
  }

  const migrations = listMigrationDirectories();
  if (
    migrations.length !== migrationBaseline.expectedDirectoryCount ||
    migrations.at(-1) !== migrationBaseline.terminalMigration
  ) {
    fail(
      `迁移基线漂移：manifest=${migrationBaseline.expectedDirectoryCount}/` +
        `${migrationBaseline.terminalMigration}，source=${migrations.length}/` +
        `${migrations.at(-1) ?? "none"}`
    );
  }

  const rootPackage = loadJson(path.join(root, "package.json"));
  const apiPackage = loadJson(path.join(root, "services/api/package.json"));
  const seenGroupIds = new Set();
  const seenPaths = new Set();
  let coveredTests = 0;
  let coveredFiles = 0;
  let remainingTests = 0;
  let fullyPendingSuites = 0;
  let partiallyPendingSuites = 0;

  if (!Array.isArray(manifest.coveredGroups) || manifest.coveredGroups.length === 0) {
    fail("coveredGroups 不能为空");
  }
  for (const group of manifest.coveredGroups) {
    if (!group.id || seenGroupIds.has(group.id)) {
      fail(`coveredGroups id 缺失或重复：${group.id ?? "missing"}`);
    }
    seenGroupIds.add(group.id);
    assertInteger(group.pendingTests, `coveredGroups.${group.id}.pendingTests`);
    if (!Array.isArray(group.testFiles) || group.testFiles.length === 0) {
      fail(`coveredGroups.${group.id}.testFiles 不能为空`);
    }
    let groupTests = 0;
    for (const file of group.testFiles) {
      validateTestFile(file, `coveredGroups.${group.id}`, seenPaths);
      groupTests += file.pendingTests;
      coveredFiles += 1;
      if (file.suiteStatus === "fully_pending") fullyPendingSuites += 1;
      else partiallyPendingSuites += 1;
    }
    if (groupTests !== group.pendingTests) {
      fail(`coveredGroups.${group.id} pendingTests 与文件小计不一致`);
    }
    validateRunner(group.runner, group.id, rootPackage, apiPackage);
    coveredTests += group.pendingTests;
  }

  if (!Array.isArray(manifest.remainingFiles)) {
    fail("remainingFiles 必须为数组");
  }
  for (const [index, file] of manifest.remainingFiles.entries()) {
    const label = `remainingFiles.${index}`;
    validateTestFile(file, label, seenPaths);
    if (!/^RUN_[A-Z0-9_]+$/u.test(file.runFlag ?? "")) {
      fail(`${label}.runFlag 非法`);
    }
    if (
      !Array.isArray(file.databaseEnv) ||
      file.databaseEnv.length === 0 ||
      file.databaseEnv.some((key) => !/^[A-Z][A-Z0-9_]+$/u.test(key))
    ) {
      fail(`${label}.databaseEnv 非法`);
    }
    if (file.reason !== "missing_disposable_pg16_orchestration") {
      fail(`${label}.reason 必须明确为缺少一次性 PostgreSQL 16 编排`);
    }
    remainingTests += file.pendingTests;
    if (file.suiteStatus === "fully_pending") fullyPendingSuites += 1;
    else partiallyPendingSuites += 1;
  }

  const derived = {
    pendingFiles: seenPaths.size,
    fullyPendingSuites,
    partiallyPendingSuites,
    pendingTests: coveredTests + remainingTests,
    coveredFiles,
    coveredTests,
    remainingFiles: manifest.remainingFiles.length,
    remainingTests
  };
  for (const [key, value] of Object.entries(derived)) {
    if (inventory[key] !== value) {
      fail(`inventory.${key}=${inventory[key]}，派生值=${value}`);
    }
  }
  if (inventory.fullyPendingSuites + inventory.partiallyPendingSuites !== inventory.pendingFiles) {
    fail("pending suite 分类总数与 pendingFiles 不一致");
  }
  return { ...derived, migrationCount: migrations.length, terminalMigration: migrations.at(-1) };
}

function parseArguments(argv) {
  const options = {
    mode: "preview",
    candidateSha: undefined,
    confirmation: undefined
  };
  const modes = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") {
      modes.add("list");
    } else if (argument === "--validate-manifest") {
      modes.add("validate");
    } else if (argument === "--execute") {
      modes.add("execute");
    } else if (argument === "--candidate-sha") {
      options.candidateSha = argv[++index];
      if (!options.candidateSha) fail("--candidate-sha 缺少值");
    } else if (argument === "--confirm") {
      options.confirmation = argv[++index];
      if (!options.confirmation) fail("--confirm 缺少值");
    } else {
      fail(`未知参数：${argument}`);
    }
  }
  if (modes.size > 1) fail("--list、--validate-manifest 与 --execute 只能选择一个");
  options.mode = [...modes][0] ?? "preview";
  if (options.mode !== "execute" && (options.candidateSha || options.confirmation)) {
    fail("--candidate-sha 与 --confirm 只能和 --execute 一起使用");
  }
  return options;
}

function assertExecutionArguments(options, manifest) {
  if (!SHA_PATTERN.test(options.candidateSha ?? "")) {
    fail("--execute 必须提供完整 40 位 --candidate-sha");
  }
  if (options.confirmation !== manifest.executionPolicy.confirmation) {
    fail(
      `--execute 必须提供 --confirm ${manifest.executionPolicy.confirmation}`
    );
  }
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

function isLocalDockerSocketEndpoint(endpoint) {
  return (
    /^unix:\/\/\/[^\r\n]+$/u.test(endpoint) ||
    /^npipe:\/{4}\.\/pipe\/[^/\r\n]+$/u.test(endpoint)
  );
}

function normalizeDockerEndpoint(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed.trim() : trimmed;
  } catch {
    return trimmed.replace(/^"(.*)"$/u, "$1");
  }
}

function assertLocalDockerEndpoint(value, { allowEmpty = false } = {}) {
  const endpoint = normalizeDockerEndpoint(value);
  if (!endpoint && allowEmpty) return "";
  if (!isLocalDockerSocketEndpoint(endpoint)) {
    fail("数据库动态门拒绝远程或不可证明为本机 socket 的 Docker endpoint/context");
  }
  return endpoint;
}

function assertSafeExecutionEnvironment(env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    fail("数据库动态门禁止在 NODE_ENV=production 下执行");
  }
  const targets = inheritedDatabaseTargetNames(env);
  if (targets.length > 0) {
    fail(`数据库动态门拒绝继承数据库目标变量：${targets.join(", ")}`);
  }
  assertLocalDockerEndpoint(env.DOCKER_HOST, { allowEmpty: true });
}

function createProbeEnvironment(sourceEnv, temporaryRoot) {
  const environment = {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test"
  };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"]) {
    if (sourceEnv[key]) environment[key] = sourceEnv[key];
  }
  return environment;
}

function createChildEnvironment(sourceEnv, temporaryRoot, dockerEndpoint) {
  const corepackHome = resolveCorepackHome(sourceEnv, temporaryRoot);
  return {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    CI: "true",
    DOCKER_HOST: dockerEndpoint,
    ...(corepackHome ? { COREPACK_HOME: corepackHome } : {})
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const forwardOutput = options.forwardOutput === true;
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env,
      stdio: forwardOutput ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = forwardOutput
        ? ""
        : `：${`${stdout}\n${stderr}`.trim().slice(-2000)}`;
      reject(
        new Error(
          `${path.basename(command)} ${args.join(" ")} 失败` +
            `（code=${code ?? "none"}, signal=${signal ?? "none"}）${detail}`
        )
      );
    });
  });
}

async function assertRepositoryState(candidateSha, environment) {
  const topLevel = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    env: environment
  });
  if (path.resolve(topLevel.stdout.trim()) !== root) {
    fail("当前命令不在预期仓库工作树内");
  }
  const head = await runCommand("git", ["rev-parse", "HEAD"], {
    env: environment
  });
  if (head.stdout.trim().toLowerCase() !== candidateSha.toLowerCase()) {
    fail(`候选 SHA 不一致：requested=${candidateSha} current=${head.stdout.trim()}`);
  }
  const status = await runCommand(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { env: environment }
  );
  if (status.stdout.trim()) {
    fail("数据库动态门要求干净工作树；当前存在未提交或未跟踪文件");
  }
  return head.stdout.trim();
}

async function resolveLocalDocker(environment, image) {
  const context = await runCommand(
    docker,
    ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
    { env: environment }
  );
  const endpoint = assertLocalDockerEndpoint(context.stdout);
  const pinnedEnvironment = { ...environment, DOCKER_HOST: endpoint };
  delete pinnedEnvironment.DOCKER_CONTEXT;
  await runCommand(docker, ["info", "--format", "{{json .ServerVersion}}"], {
    env: pinnedEnvironment
  });
  const imageResult = await runCommand(
    docker,
    ["image", "inspect", "--format", "{{.Id}}", image],
    { env: pinnedEnvironment }
  );
  const imageId = imageResult.stdout.trim();
  if (!imageId) fail(`本机缺少已缓存镜像 ${image}；动态门禁止自动拉取`);
  return { endpoint, imageId };
}

function resolveGroupCommand(group) {
  if (group.runner.kind === "workspaceScript") {
    return { command: pnpm, args: [group.runner.script] };
  }
  if (group.runner.kind === "apiScript") {
    return {
      command: pnpm,
      args: ["--filter", "@jiangkong/api", group.runner.script]
    };
  }
  return {
    command: process.execPath,
    args: [resolveRepositoryPath(group.runner.path, `${group.id}.runner.path`)]
  };
}

async function runPreflight(environment) {
  await runCommand(
    pnpm,
    ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
    { env: environment, forwardOutput: true }
  );
  await runCommand(pnpm, ["--filter", "@jiangkong/api", "build"], {
    env: environment,
    forwardOutput: true
  });
}

async function executeGate({ manifest, options, sourceEnv = process.env }) {
  assertExecutionArguments(options, manifest);
  assertSafeExecutionEnvironment(sourceEnv);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-database-dynamic-gate-")
  );
  const startedAt = new Date();
  const groupReceipts = [];
  try {
    const probeEnvironment = createProbeEnvironment(sourceEnv, temporaryRoot);
    const candidateSha = await assertRepositoryState(
      options.candidateSha,
      probeEnvironment
    );
    const dockerReceipt = await resolveLocalDocker(
      probeEnvironment,
      manifest.migrationBaseline.containerImage
    );
    const childEnvironment = createChildEnvironment(
      sourceEnv,
      temporaryRoot,
      dockerReceipt.endpoint
    );
    childEnvironment.LOCAL_PG16_DYNAMIC_GATE =
      manifest.executionPolicy.confirmation;
    childEnvironment.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA = candidateSha;
    await runPreflight(childEnvironment);

    for (const group of manifest.coveredGroups) {
      await assertRepositoryState(candidateSha, probeEnvironment);
      const groupStartedAt = Date.now();
      const resolved = resolveGroupCommand(group);
      const groupEnvironment = { ...childEnvironment };
      if (group.runner.evidenceEnv) {
        groupEnvironment[group.runner.evidenceEnv] = path.join(
          temporaryRoot,
          `${group.id}-evidence.json`
        );
      }
      process.stdout.write(
        `[database-dynamic-gate] start ${group.id} (${group.pendingTests} pending tests)\n`
      );
      await runCommand(resolved.command, resolved.args, {
        env: groupEnvironment,
        forwardOutput: true
      });
      groupReceipts.push({
        id: group.id,
        pendingTests: group.pendingTests,
        durationMs: Date.now() - groupStartedAt,
        status: "passed"
      });
    }
    await assertRepositoryState(candidateSha, probeEnvironment);

    const finishedAt = new Date();
    const receipt = {
      schemaVersion: 1,
      gate: manifest.id,
      mode: "local_disposable_postgresql16",
      status: "passed",
      candidateSha,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      migrationCount: manifest.migrationBaseline.expectedDirectoryCount,
      terminalMigration: manifest.migrationBaseline.terminalMigration,
      containerImage: manifest.migrationBaseline.containerImage,
      containerImageId: dockerReceipt.imageId,
      coveredTests: manifest.inventory.coveredTests,
      coveredFiles: manifest.inventory.coveredFiles,
      remainingTests: manifest.inventory.remainingTests,
      remainingFiles: manifest.inventory.remainingFiles,
      groups: groupReceipts
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return receipt;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function preview(manifest, validation, mode) {
  const payload = {
    schemaVersion: 1,
    gate: manifest.id,
    mode,
    executed: false,
    manifestValid: true,
    migrationCount: validation.migrationCount,
    terminalMigration: validation.terminalMigration,
    pendingFiles: validation.pendingFiles,
    pendingTests: validation.pendingTests,
    coveredFiles: validation.coveredFiles,
    coveredTests: validation.coveredTests,
    remainingFiles: validation.remainingFiles,
    remainingTests: validation.remainingTests
  };
  if (mode === "list") {
    payload.coveredGroups = manifest.coveredGroups.map((group) => ({
      id: group.id,
      pendingTests: group.pendingTests,
      testFiles: group.testFiles.map((file) => file.path),
      runner: group.runner
    }));
    payload.remaining = manifest.remainingFiles.map((file) => ({
      path: file.path,
      pendingTests: file.pendingTests,
      runFlag: file.runFlag,
      databaseEnv: file.databaseEnv,
      reason: file.reason
    }));
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (mode === "preview") {
    process.stdout.write(
      "仅完成只读预览，未调用 git、Docker、PostgreSQL 或测试 runner。\n" +
        "执行前请先使用 --validate-manifest 或 --list；动态执行还必须显式提供候选 SHA 与确认串。\n"
    );
  }
  return payload;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const manifest = loadManifest();
  const validation = validateManifest(manifest);
  if (options.mode === "execute") {
    return executeGate({ manifest, options });
  }
  return preview(manifest, validation, options.mode);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `数据库动态门失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  assertExecutionArguments,
  assertLocalDockerEndpoint,
  assertRepositoryState,
  assertSafeExecutionEnvironment,
  createChildEnvironment,
  createProbeEnvironment,
  executeGate,
  inheritedDatabaseTargetNames,
  isLocalDockerSocketEndpoint,
  loadManifest,
  main,
  normalizeDockerEndpoint,
  parseArguments,
  resolveGroupCommand,
  root,
  validateManifest
};
