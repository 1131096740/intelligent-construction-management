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
const { createHash } = require("node:crypto");
const { Script } = require("node:vm");
const {
  assertManifestBaseline,
  deriveMigrationBaseline
} = require("./migration-baseline.cjs");
const { resolveCorepackHome } = require("./money-bigint-runner-runtime.cjs");
const {
  POL113_POL115_GROUP, pol113Pol115Batches, assertPol113Pol115Coverage, projectPol113Pol115Shard
} = require("./pol113-pol115-shards.cjs");

const root = path.resolve(__dirname, "../../..");
const manifestPath = path.join(
  __dirname,
  "database-dynamic-gate-manifest.json"
);
const migrationRoot = path.join(__dirname, "migrations");
const apiSourceRoot = path.join(root, "services", "api", "src");
const pnpm =
  process.env.PNPM_BIN?.trim() ||
  (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const SUITE_STATUSES = new Set(["fully_pending", "partial_pending"]);
const RUNNER_KINDS = new Set(["workspaceScript", "apiScript", "node"]);
const TASK01_GROUP = "enterprise_task01_entry";
const TASK01_DRIVER = "services/api/prisma/run-enterprise-task01-local.cjs";
const TASK01_HELPER = "services/api/prisma/enterprise-task01-resources.cjs";
const TASK01_IMAGE = "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d";
const TASK01_FLAGS = ["--task01-packet", "--task01-inputs", "--task01-inputs-sha256", "--task01-artifacts", "--task01-confirm"];

function ciExecutionFor(group) {
  const category = group.ciExecution === undefined ? "automatic" : group.ciExecution;
  if (!["automatic", "manual-only"].includes(category) || (group.id !== TASK01_GROUP && category !== "automatic")) {
    fail("CI执行分类无效；旧组必须继续全部进入CI");
  }
  if (group.id === TASK01_GROUP && category !== "manual-only") fail("任务01必须显式登记manual-only");
  return category;
}

function executionInventory(groups) {
  const result = { ciEligible: { groups: 0, files: 0, tests: 0 }, manualOnly: { groups: 0, files: 0, tests: 0 } };
  for (const group of groups) {
    const bucket = ciExecutionFor(group) === "automatic" ? result.ciEligible : result.manualOnly;
    bucket.groups += 1; bucket.files += group.testFiles?.length ?? 0; bucket.tests += group.pendingTests;
  }
  return result;
}

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

function discoverRunGatedPgSpecPaths(directory = apiSourceRoot) {
  const discovered = [];
  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !/\.spec\.ts$/u.test(entry.name)) continue;
      const source = readFileSync(absolutePath, "utf8");
      if (
        !/process\.env(?:\.RUN_[A-Z0-9_]+|\[\s*["']RUN_[A-Z0-9_]+["']\s*\])/u.test(
          source
        )
      ) {
        continue;
      }
      discovered.push(
        path.relative(root, absolutePath).split(path.sep).join("/")
      );
    }
  };
  visit(directory);
  return discovered.sort();
}

function assertRunGatedPgSpecsRegistered(registeredPaths) {
  const unregistered = discoverRunGatedPgSpecPaths().filter(
    (filePath) => !registeredPaths.has(filePath)
  );
  if (unregistered.length > 0) {
    fail(`RUN_* gated PG spec 未登记：${unregistered.join(", ")}`);
  }
}

function validateRunner(runner, groupId, rootPackage, apiPackage) {
  if (!runner || !RUNNER_KINDS.has(runner.kind)) {
    fail(`coveredGroups.${groupId}.runner.kind 不受支持`);
  }
  if (groupId === TASK01_GROUP || runner.invocation === "task01_explicit_inputs") {
    if (groupId !== TASK01_GROUP || runner.kind !== "node" || runner.path !== TASK01_DRIVER
      || runner.resourceHelper !== TASK01_HELPER || runner.imageId !== TASK01_IMAGE || runner.invocation !== "task01_explicit_inputs"
      || Object.keys(runner).sort().join(",") !== "imageId,invocation,kind,path,resourceHelper,resourceHelperSha256,sourceSha256") {
      fail("任务01只允许固定operator、资源helper与准确镜像");
    }
    // Bind the reviewed executable bodies, not postgres:16 strings in comments.
    // Parsing compiles syntax only: neither module is imported or executed here.
    for (const [relative, expected] of [[TASK01_DRIVER, runner.sourceSha256], [TASK01_HELPER, runner.resourceHelperSha256]]) {
      const source = readFileSync(resolveRepositoryPath(relative, "task01 source"));
      if (!/^[a-f0-9]{64}$/u.test(expected ?? "") || createHash("sha256").update(source).digest("hex") !== expected) {
        fail("任务01固定执行源码哈希不匹配");
      }
      new Script(source.toString("utf8"), { filename: relative });
    }
    return;
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

  const sourceBaseline = deriveMigrationBaseline(migrationRoot);
  assertManifestBaseline(manifest, sourceBaseline);

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
    ciExecutionFor(group);
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
    if (group.id === POL113_POL115_GROUP) assertPol113Pol115Coverage(group);
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

  assertRunGatedPgSpecsRegistered(seenPaths);

  const execution = executionInventory(manifest.coveredGroups);
  for (const category of ["ciEligible", "manualOnly"]) {
    for (const count of ["groups", "files", "tests"]) {
      if (manifest.executionInventory?.[category]?.[count] !== execution[category][count]) {
        fail(`CI执行分类库存漂移：${category}.${count}`);
      }
    }
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
  return {
    ...derived,
    migrationCount: sourceBaseline.expectedDirectoryCount,
    terminalMigration: sourceBaseline.terminalMigration,
    terminalMigrationChecksum: sourceBaseline.terminalMigrationChecksum
  };
}

function parseArguments(argv) {
  const options = {
    mode: "preview",
    candidateSha: undefined,
    confirmation: undefined,
    groups: []
  };
  const modes = new Set();
  const task01 = {};
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
    } else if (argument === "--automatic-only") {
      if (options.automaticOnly) fail("--automatic-only 不能重复");
      options.automaticOnly = true;
    } else if (argument === "--group") {
      const group = argv[++index];
      if (!group) fail("--group 缺少数据库组名称");
      options.groups.push(group);
    } else if (argument === "--pol113-pol115-shard") {
      if (options.pol113Pol115Shard !== undefined) fail("--pol113-pol115-shard 不能重复");
      const shard = argv[++index];
      if (!shard) fail("--pol113-pol115-shard 缺少值");
      pol113Pol115Batches(shard);
      options.pol113Pol115Shard = shard;
    } else if (TASK01_FLAGS.includes(argument)) {
      if (Object.hasOwn(task01, argument)) fail(`任务01独立参数重复：${argument}`);
      task01[argument] = argv[++index];
      if (!task01[argument] || task01[argument].startsWith("--")) fail(`任务01独立参数缺少值：${argument}`);
    } else {
      fail(`未知参数：${argument}`);
    }
  }
  if (modes.size > 1) fail("--list、--validate-manifest 与 --execute 只能选择一个");
  options.mode = [...modes][0] ?? "preview";
  assertAutomaticSelection(options, Object.keys(task01).length > 0);
  assertPol113Pol115Selection(options);
  if (Object.keys(task01).length) {
    if (options.mode !== "execute" || !options.groups.includes(TASK01_GROUP)) {
      fail("任务01独立参数只能用于显式单独执行任务01组");
    }
    options.task01 = task01;
  }
  if (options.mode !== "execute" && (options.candidateSha || options.confirmation)) {
    fail("--candidate-sha 与 --confirm 只能和 --execute 一起使用");
  }
  return options;
}

function selectCoveredGroups(manifest, requestedGroups) {
  if (requestedGroups.length === 0) return manifest.coveredGroups;
  const uniqueGroups = new Set(requestedGroups);
  if (uniqueGroups.size !== requestedGroups.length) {
    fail("数据库组不能重复选择");
  }
  const knownGroups = new Set(manifest.coveredGroups.map((group) => group.id));
  const unknownGroups = requestedGroups.filter((group) => !knownGroups.has(group));
  if (unknownGroups.length > 0) {
    fail(`未知数据库组：${unknownGroups.join(", ")}`);
  }
  return manifest.coveredGroups.filter((group) => uniqueGroups.has(group.id));
}

function assertAutomaticSelection(options, hasTask01Inputs = Boolean(options.task01)) {
  if (options.automaticOnly && (options.groups.length > 0 || hasTask01Inputs)) {
    fail("--automatic-only 不能与 --group 或任务01独立参数同时使用");
  }
}

function groupsForInvocation(manifest, options) {
  assertPol113Pol115Selection(options);
  if (options.pol113Pol115Shard !== undefined) {
    const [group] = selectCoveredGroups(manifest, options.groups);
    return [projectPol113Pol115Shard(group, options.pol113Pol115Shard)];
  }
  if (!options.automaticOnly) return selectCoveredGroups(manifest, options.groups);
  assertAutomaticSelection(options);
  const automatic = manifest.coveredGroups.filter(group => ciExecutionFor(group) === "automatic");
  if (automatic.length === 0) fail("--automatic-only 未找到自动执行组");
  return automatic;
}

function assertPol113Pol115Selection(options) {
  if (options.pol113Pol115Shard !== undefined &&
    (options.automaticOnly || options.groups.length !== 1 || options.groups[0] !== POL113_POL115_GROUP)) {
    fail("--pol113-pol115-shard 仅用于单独选择 POL113-POL115 数据库组");
  }
}

function automaticScopeEvidence(manifest, options) {
  if (!options.automaticOnly) return {};
  const deferred = manifest.coveredGroups.filter(group => ciExecutionFor(group) === "manual-only");
  return {
    executionScope: "automatic-only",
    deferredManualOnly: {
      ...executionInventory(deferred).manualOnly,
      groupIds: deferred.map(group => group.id),
      executionStatus: "NOT_EXECUTED"
    }
  };
}

function selectedCoverage(groups) {
  return {
    pendingFiles: groups.reduce((total, group) => total + group.testFiles.length, 0),
    pendingTests: groups.reduce((total, group) => total + group.pendingTests, 0),
    coveredFiles: groups.reduce((total, group) => total + group.testFiles.length, 0),
    coveredTests: groups.reduce((total, group) => total + group.pendingTests, 0)
  };
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
  const selected = groupsForInvocation(manifest, options);
  if (selected.some(group => group.id === TASK01_GROUP)) {
    if (options.groups.length !== 1 || options.groups[0] !== TASK01_GROUP || selected.length !== 1) {
      fail("任务01必须显式单独选择，不能默认all或与旧组混跑");
    }
    if (!options.task01 || TASK01_FLAGS.some(flag => !options.task01[flag])) fail("任务01必须提供全部独立输入和确认串");
    if (options.task01["--task01-confirm"] !== "LOCAL_TASK01_HTTP_PG") fail("任务01必须独立确认 LOCAL_TASK01_HTTP_PG");
    if (!/^[a-f0-9]{64}$/u.test(options.task01["--task01-inputs-sha256"])) fail("任务01输入清单SHA256必须为完整64位");
    for (const flag of ["--task01-packet", "--task01-inputs", "--task01-artifacts"]) {
      const value = options.task01[flag];
      if (!path.isAbsolute(value) || !value.startsWith("/private/tmp/") || path.normalize(value) !== value) fail("任务01独立路径必须是准确/private/tmp绝对路径");
    }
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
  const playwrightBrowsersPath = String(
    sourceEnv.PLAYWRIGHT_BROWSERS_PATH ?? ""
  ).trim();
  if (playwrightBrowsersPath && !path.isAbsolute(playwrightBrowsersPath)) {
    fail("PLAYWRIGHT_BROWSERS_PATH 必须是绝对路径");
  }
  const fontConfigFile = String(sourceEnv.FONTCONFIG_FILE ?? "").trim();
  if (fontConfigFile && !path.isAbsolute(fontConfigFile)) {
    fail("FONTCONFIG_FILE 必须是绝对路径");
  }
  const prismaEngineEnvironment = {};
  for (const key of [
    "PRISMA_QUERY_ENGINE_LIBRARY",
    "PRISMA_SCHEMA_ENGINE_BINARY"
  ]) {
    if (sourceEnv[key]) prismaEngineEnvironment[key] = sourceEnv[key];
  }
  return {
    PATH: sourceEnv.PATH ?? "",
    HOME: sourceEnv.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    // Chromium uses the process locale to encode download filenames on Linux.
    LANG: "C.UTF-8",
    NODE_ENV: "test",
    CI: "true",
    DOCKER_HOST: dockerEndpoint,
    ...(sourceEnv.PNPM_BIN?.trim()
      ? { PNPM_BIN: sourceEnv.PNPM_BIN.trim() }
      : {}),
    ...(playwrightBrowsersPath
      ? { PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath }
      : {}),
    ...(fontConfigFile ? { FONTCONFIG_FILE: fontConfigFile } : {}),
    ...prismaEngineEnvironment,
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

function resolveGroupCommand(group, options = {}) {
  if (group.id === TASK01_GROUP) {
    if (!options.task01 || TASK01_FLAGS.some(flag => !options.task01[flag])) fail("任务01必须提供全部独立输入和确认串");
    return { command: process.execPath, args: [resolveRepositoryPath(TASK01_DRIVER, "task01 driver"),
      "--packet", options.task01["--task01-packet"], "--inputs", options.task01["--task01-inputs"],
      "--inputs-sha256", options.task01["--task01-inputs-sha256"], "--artifacts", options.task01["--task01-artifacts"]] };
  }
  // This dispatcher runs only after the gate's real generate + build preflight.
  // Standalone pnpm entry points retain their normal preparation lifecycle.
  const pol108Shards = {
    operating_projection_pol108: "core",
    operating_projection_pol108_facts: "facts",
    operating_projection_pol108_impacts: "impacts"
  };
  if (Object.hasOwn(pol108Shards, group.id)) {
    return { command: process.execPath, args: [
      resolveRepositoryPath(group.runner.path, `${group.id}.runner.path`),
      "--shard", pol108Shards[group.id]
    ] };
  }
  if (group.id === POL113_POL115_GROUP && group.pol113Pol115Shard !== undefined) {
    return { command: process.execPath, args: [
      resolveRepositoryPath(group.runner.path, `${group.id}.runner.path`),
      "--shard", group.pol113Pol115Shard
    ] };
  }
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
  const started = performance.now();
  await runCommand(
    pnpm,
    ["--filter", "@jiangkong/api", "exec", "prisma", "generate"],
    { env: environment, forwardOutput: true }
  );
  await runCommand(pnpm, ["--filter", "@jiangkong/api", "build"], {
    env: environment,
    forwardOutput: true
  });
  process.stdout.write(`[database-dynamic-timing] ${JSON.stringify({ phase: "prepare.generate-and-build", durationMs: Math.round(performance.now() - started) })}\n`);
}

async function executeGate({ manifest, options, sourceEnv = process.env }) {
  assertExecutionArguments(options, manifest);
  assertSafeExecutionEnvironment(sourceEnv);
  const coveredGroups = groupsForInvocation(manifest, options);
  const coverage = selectedCoverage(coveredGroups);
  if (coveredGroups.length === 1 && coveredGroups[0].id === TASK01_GROUP) {
    if (sourceEnv.GITHUB_ACTIONS === "true") fail("任务01仅限本机独立授权，禁止GitHub Actions自动执行");
    // The operator owns its exact source/dependency/build/TLS/ACL admissions.
    // No generic build, Docker discovery, temporary resource or SQL precedes it.
    const environment = { PATH: sourceEnv.PATH ?? "", LANG: "C", LC_ALL: "C", NODE_ENV: "test",
      JG_TASK01_EXECUTION_APPROVED: "LOCAL_TASK01_HTTP_PG", JG_TASK01_EXPECTED_SOURCE_SHA: options.candidateSha.toLowerCase() };
    const resolved = resolveGroupCommand(coveredGroups[0], options);
    await runCommand(resolved.command, resolved.args, { env: environment, forwardOutput: true });
    return { status: "task01-operator-completed", scope: "first-case-tracer-only", candidateSha: options.candidateSha,
      driverReceiptPath: path.join(options.task01["--task01-artifacts"], "task01-receipt.json"),
      coveredTests: 1, fullDynamicGate: false, executionInventory: executionInventory(coveredGroups), ciExecution: "manual-only" };
  }
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "jiangkong-database-dynamic-gate-" +
      (options.pol113Pol115Shard === undefined ? "" : options.pol113Pol115Shard + "-"))
  );
  const startedAt = new Date();
  const groupReceipts = [];
  let completed = false;
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
    // The remaining runner owns preparation for both standalone and CI use.
    // No environment flag or persisted cache can bypass that preparation.
    if (coveredGroups.some(group => group.id !== "remaining_dynamic_postgresql16")) {
      await runPreflight(childEnvironment);
    }

    for (const group of coveredGroups) {
      await assertRepositoryState(candidateSha, probeEnvironment);
      const groupStartedAt = Date.now();
      const resolved = resolveGroupCommand(group);
      const groupEnvironment = { ...childEnvironment };
      if (group.id === POL113_POL115_GROUP) {
        // The preflight above generated this checkout's client and built the API.
        groupEnvironment.POL113_POL115_PREPARED_SHA = candidateSha;
      }
      if (group.runner.evidenceEnv) {
        groupEnvironment[group.runner.evidenceEnv] = path.join(
          temporaryRoot,
          `${group.id}-evidence.json`
        );
      }
      process.stdout.write(
        `[database-dynamic-gate] start ${group.id}${group.pol113Pol115Shard ? "/" + group.pol113Pol115Shard : ""} (${group.pendingTests} pending tests)\n`
      );
      await runCommand(resolved.command, resolved.args, {
        env: groupEnvironment,
        forwardOutput: true
      });
      groupReceipts.push({
        id: group.id,
        ...(group.pol113Pol115Shard ? { shard: group.pol113Pol115Shard } : {}),
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
      terminalMigrationChecksum: manifest.migrationBaseline.terminalMigrationChecksum,
      containerImage: manifest.migrationBaseline.containerImage,
      containerImageId: dockerReceipt.imageId,
      coveredTests: coverage.coveredTests,
      coveredFiles: coverage.coveredFiles,
      executionInventory: executionInventory(coveredGroups),
      ...automaticScopeEvidence(manifest, options),
      remainingTests: manifest.inventory.remainingTests,
      remainingFiles: manifest.inventory.remainingFiles,
      groups: groupReceipts
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    completed = true;
    return receipt;
  } finally {
    if (completed) {
      await rm(temporaryRoot, { recursive: true, force: true });
    } else {
      // mkdtemp creates a private 0700 root. Keep failure traces inside it;
      // group runners still clean their own containers, and no passed receipt is emitted.
      process.stderr.write(`[database-dynamic-gate] failure artifacts retained: ${temporaryRoot}\n`);
    }
  }
}

function preview(manifest, validation, options) {
  const coveredGroups = groupsForInvocation(manifest, options);
  const coverage = selectedCoverage(coveredGroups);
  const payload = {
    schemaVersion: 1,
    gate: manifest.id,
    mode: options.mode,
    ...(options.pol113Pol115Shard ? { shard: options.pol113Pol115Shard } : {}),
    executed: false,
    executionInventory: executionInventory(coveredGroups),
    ...automaticScopeEvidence(manifest, options),
    manifestValid: true,
    migrationCount: validation.migrationCount,
    terminalMigration: validation.terminalMigration,
    terminalMigrationChecksum: validation.terminalMigrationChecksum,
    pendingFiles: coverage.pendingFiles,
    pendingTests: coverage.pendingTests,
    coveredFiles: coverage.coveredFiles,
    coveredTests: coverage.coveredTests,
    remainingFiles: validation.remainingFiles,
    remainingTests: validation.remainingTests
  };
  if (options.mode === "list") {
    payload.coveredGroups = coveredGroups.map((group) => ({
      id: group.id,
      ciExecution: ciExecutionFor(group),
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
  if (options.mode === "preview") {
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
  return preview(manifest, validation, options);
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
  assertRunGatedPgSpecsRegistered,
  assertSafeExecutionEnvironment,
  createChildEnvironment,
  createProbeEnvironment,
  discoverRunGatedPgSpecPaths,
  executeGate,
  inheritedDatabaseTargetNames,
  isLocalDockerSocketEndpoint,
  loadManifest,
  main,
  normalizeDockerEndpoint,
  parseArguments,
  resolveGroupCommand,
  root,
  selectCoveredGroups,
  validateManifest
};
