import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import * as metadata from "./pr348-native-metadata.mjs";
import { SOURCE_SHA, BRANCH, validateNativeContext, runnerIdentity, inventoryTmp, lifecycleFootprint, runPhases, completionReceipt, cacheLauncherText, cacheConfigText, startPrivate } from "./pr348-native-metadata.mjs";

const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: BRANCH, GITHUB_RUN_ATTEMPT: "1",
  RUNNER_OS: "Linux", RUNNER_ARCH: "X64", PR348_CONTROL_SHA: "a".repeat(40) };
const runtime = { platform: "linux", arch: "x64", versions: { node: "20.20.2" } };

test("metadata job accepts only one native push attempt on its dedicated branch", () => {
  assert.doesNotThrow(() => validateNativeContext(env, runtime));
  for (const change of [{ GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_EVENT_NAME: "workflow_dispatch" }, { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/heads/codex/pr348-historical-evidence-20261024" }, { RUNNER_ARCH: "ARM64" }, { PR348_CONTROL_SHA: "main" }])
    assert.throws(() => validateNativeContext({ ...env, ...change }, runtime));
  assert.throws(() => validateNativeContext(env, { ...runtime, versions: { node: "22.0.0" } }));
});

test("resource observation completes before pretest, Jest loading and independent controls", async () => {
  const events = [], io = Object.fromEntries(["prepare", "generate", "buildAndObserve", "pretest", "observeCache", "positiveControls"].map(name =>
    [name, async () => { events.push(name); return { name }; }]));
  const result = await runPhases(io);
  assert.deepEqual(events, ["prepare", "generate", "buildAndObserve", "pretest", "observeCache", "positiveControls"]);
  assert.equal(result.resources.name, "buildAndObserve");
  assert.equal(result.controls.name, "positiveControls");
});

test("a failed build observation stops before any later cache preparation or transform", async () => {
  const events = [], error = new Error("private failure");
  const io = Object.fromEntries(["prepare", "generate", "buildAndObserve", "pretest", "observeCache", "positiveControls"].map(name =>
    [name, async () => { events.push(name); if (name === "buildAndObserve") throw error; }]));
  await assert.rejects(runPhases(io), value => value === error);
  assert.deepEqual(events, ["prepare", "generate", "buildAndObserve"]);
});

test("pretest cannot start while the asynchronous owned-build tail is pending", async () => {
  const events = [];
  let release;
  const tail = new Promise(resolve => { release = resolve; });
  const running = runPhases({
    prepare: async () => {}, generate: async () => {},
    buildAndObserve: async () => { events.push("tail-started"); await tail; events.push("tail-finished"); return {}; },
    pretest: async () => { events.push("pretest"); }, observeCache: async () => ({}), positiveControls: async () => ({})
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["tail-started"]);
  release(); await running;
  assert.deepEqual(events, ["tail-started", "tail-finished", "pretest"]);
});

// Exact d671 package blob; log markers project sealed log SHA256 5612f2370d2e2dd63b5e82c026dcf8893648927e48f9ab53f2ce1932ac95c376, lines 1597/1601/1602/1605/1606.
const historicalSharedPackage = "{\n  \"name\": \"@jiangkong/shared-domain\",\n  \"version\": \"0.1.0\",\n  \"private\": true,\n  \"type\": \"commonjs\",\n  \"main\": \"dist/index.js\",\n  \"types\": \"dist/index.d.ts\",\n  \"scripts\": {\n    \"build\": \"tsc\",\n    \"test\": \"vitest run\",\n    \"typecheck\": \"tsc --noEmit\",\n    \"lint\": \"eslint src --ext .ts\"\n  },\n  \"dependencies\": {},\n  \"devDependencies\": {\n    \"@types/node\": \"^20.14.0\",\n    \"@typescript-eslint/eslint-plugin\": \"^7.18.0\",\n    \"@typescript-eslint/parser\": \"^7.18.0\",\n    \"eslint\": \"^8.57.0\",\n    \"typescript\": \"^5.5.0\",\n    \"vitest\": \"^1.6.0\"\n  }\n}\n";
const historicalBuildLog = "> @jiangkong/api@0.1.0 prebuild [source]\n> @jiangkong/shared-domain@0.1.0 build [source]\n> tsc\n> @jiangkong/api@0.1.0 build [source]\n> nest build\nPRIVATE_PAYLOAD";

test("exact d671 source and sealed lifecycle markers accept shared tsc without modern arguments", () => {
  assert.equal(SOURCE_SHA, "d6719ba2ad89f716f5d67dc0795cdccf98d9820f");
  const blob = crypto.createHash("sha1").update(`blob ${Buffer.byteLength(historicalSharedPackage)}\0`).update(historicalSharedPackage).digest("hex");
  assert.equal(blob, "7fde6f14389ebcfb3957d1ba5a5b6398cdd56b4e");
  assert.equal(JSON.parse(historicalSharedPackage).scripts.build, "tsc");
  const result = lifecycleFootprint(historicalBuildLog);
  assert.deepEqual(result, { apiPrebuild: true, sharedDomainBuild: true, sharedTsc: true, apiBuild: true, nestBuild: true });
  assert.equal(JSON.stringify(result).includes("PRIVATE_PAYLOAD"), false);
  assert.equal(lifecycleFootprint(historicalBuildLog.replace("> tsc\n", "> tsc -p tsconfig.json\n")).sharedTsc, false);
  assert.equal(lifecycleFootprint(historicalBuildLog.replace("> tsc\n", "> skipped\n")).sharedTsc, false);
  assert.equal(lifecycleFootprint("> nest build\n").apiPrebuild, false);
});

test("build outcome preserves successful and failed child boundaries without raw diagnostics", () => {
  assert.equal(typeof metadata.projectBuildOutcome, "function");
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pr348-build-outcome-"));
  fs.chmodSync(root, 0o700);
  try {
    const logFile = path.join(root, "build.private.log"); fs.writeFileSync(logFile, historicalBuildLog, { mode: 0o600 });
    const project = input => metadata.projectBuildOutcome({ logFile, resourceObservationCompleted: true, ...input });
    const good = project({ exit: { code: 0, signal: null } });
    assert.equal(good.terminalGate, "passed"); assert.equal(good.childExitCode, 0);
    assert.equal(good.logReadStatus, "read"); assert.equal(good.logBytes, Buffer.byteLength(historicalBuildLog));
    assert.deepEqual(good.footprint, { apiPrebuild: true, sharedDomainBuild: true, sharedTsc: true, apiBuild: true, nestBuild: true });
    for (const [input, gate, code, signal, spawnCode] of [
      [{ exit: { code: 2, signal: null } }, "child-exit-nonzero", 2, null, null],
      [{ exit: { code: null, signal: "SIGTERM" } }, "child-signaled", null, "SIGTERM", null],
      [{ exit: { code: null, signal: "PRIVATE_SIGNAL" } }, "child-signaled", null, "unknown", null],
      [{ spawnError: { code: "ENOENT", message: "PRIVATE_ERROR" } }, "child-start-error", null, null, "ENOENT"],
      [{ spawnError: { code: "PRIVATE_CODE", message: "PRIVATE_ERROR" } }, "child-start-error", null, null, "unknown"],
      [{ exit: { code: 0, signal: null }, resourceObservationCompleted: false }, "resource-observation-incomplete", 0, null, null],
      [{ exit: { code: null, signal: null } }, "child-outcome-unknown", null, null, null]
    ]) {
      const result = project(input);
      assert.equal(result.terminalGate, gate); assert.equal(result.childExitCode, code);
      assert.equal(result.childSignal, signal); assert.equal(result.spawnErrorCode, spawnCode);
      assert.equal(result.footprint.sharedTsc, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|command|private\.log/u);
    }
    fs.writeFileSync(logFile, historicalBuildLog.replace("> tsc\n", "> skipped\n"));
    assert.equal(project({ exit: { code: 0, signal: null } }).terminalGate, "lifecycle-footprint-rejected");
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("unreadable or oversized build logs keep footprint unknown rather than five false markers", () => {
  assert.equal(typeof metadata.projectBuildOutcome, "function");
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pr348-build-log-"));
  fs.chmodSync(root, 0o700);
  try {
    const logFile = path.join(root, "build.private.log"), missing = path.join(root, "missing.private.log");
    const project = file => metadata.projectBuildOutcome({ exit: { code: 0, signal: null }, resourceObservationCompleted: true, logFile: file });
    const absent = project(missing);
    assert.equal(absent.logReadStatus, "unreadable"); assert.equal(absent.logBytes, null);
    assert.deepEqual(Object.values(absent.footprint), [null, null, null, null, null]); assert.equal(absent.terminalGate, "log-unavailable");
    fs.writeFileSync(logFile, ""); fs.truncateSync(logFile, 8 * 1024 * 1024 + 1);
    const oversized = project(logFile);
    assert.equal(oversized.logReadStatus, "too-large"); assert.equal(oversized.logBytes, 8 * 1024 * 1024 + 1);
    assert.deepEqual(Object.values(oversized.footprint), [null, null, null, null, null]);
    fs.unlinkSync(logFile); fs.symlinkSync(missing, logFile);
    assert.equal(project(logFile).logReadStatus, "unreadable");
    const initial = metadata.projectBuildOutcome();
    assert.equal(initial.terminalGate, "not-started"); assert.equal(initial.logReadStatus, "not-read");
    assert.doesNotMatch(JSON.stringify([absent, oversized, initial]), /private\.log|PRIVATE/u);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("metadata success preserves unknown resource coverage and does not claim CI or business proof", () => {
  const result = completionReceipt({ controlSha: "a".repeat(40), sourceClean: true, resources: { samplingIncomplete: true } });
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.equal(result.resourceSampling, "gaps-or-unknown");
  assert.equal(result.completeOwnedLiveCount, null);
  assert.equal(result.absenceOfResidualBuildWorkProven, false);
  assert.equal(result.original22Executed, false);
  assert.equal(result.historicalRootCauseProven, false);
  assert.equal(result.runtimeCacheKeyOptionsMatchOriginalJest, "unknown");
  assert.ok(result.unobserved.includes("HasteMap reads"));
  assert.ok(result.unobserved.includes("test sequencer performance cache"));
});

test("new workflow is isolated from original22/full CI and uploads four precise safe files", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/pr348-native-metadata.yml", import.meta.url), "utf8");
  assert.match(workflow, /branches:\n\s+- codex\/pr348-native-cache-evidence-20261025/u);
  assert.match(workflow, /run: '\[ "\$GITHUB_RUN_ATTEMPT" = 1 \]'/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /node-version: 20\.20\.2/u);
  assert.match(workflow, new RegExp("ref: " + SOURCE_SHA, "u"));
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request|secrets\.|trace\.zip|test-results|postgres|playwright/u);
  const uploads = [...workflow.matchAll(/runner\.temp \}\}\/pr348-native-metadata-safe\/(\w+\.json)/gu)].map(match => match[1]);
  assert.deepEqual(uploads, ["result.json", "resources.json", "cache.json", "controls.json"]);
  const source = fs.readFileSync(new URL("./pr348-native-metadata.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env\.HOME\s*=|--runInBand.*test|run-employee-onboarding|run-database-dynamic-gate|prisma.*migrate|\.listen\(/u);
  assert.match(source, /NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig/u);
  assert.match(source, /enable-pre-post-scripts=true/u);
});

test("controller wires the real cache observer CommonJS exports without a guessed ghost path", () => {
  const observer = createRequire(import.meta.url)("./pr348-native-cache-observer.cjs");
  assert.equal(typeof observer.runCacheObservation, "function");
  assert.equal(typeof observer.runPositiveControl, "function");
  const source = fs.readFileSync(new URL("./pr348-native-metadata.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pr348-native-cache-observer\.mjs/u);
  assert.equal((source.match(/pr348-native-cache-observer\.cjs/gu) || []).length, 2);
});

test("raw transform diagnostics and positive controls are confined to private child logs", () => {
  const source = fs.readFileSync(new URL("./pr348-native-metadata.mjs", import.meta.url), "utf8");
  assert.match(source, /stdio: \["ignore", fd, fd\]/u);
  assert.match(source, /await command\(process\.execPath, \[launcher\], "first-transform", apiRoot\)/u);
  assert.match(source, /"positive-control", "--vendor-root"/u);
  assert.match(source, /process\.chdir\(apiRoot\)/u);
  assert.match(source, /finally \{ process\.chdir\(previousCwd\); \}/u);
  assert.doesNotMatch(source.slice(source.indexOf("export async function main")), /await runCacheObservation\(|await runPositiveControl\(/u);
  const text = cacheLauncherText({ controllerUrl: "file:///private/controller.mjs", observerFile: "/private/cache.cjs", configFile: "/private/config.json",
    targetsFile: "/private/targets.json", source: "/private/source-with-\"-and-\n", tmp: "/private/tmp", outputFile: "/private/safe/cache.json", inventoryFile: "/private/inventory.json" });
  assert.doesNotThrow(() => new vm.Script(text));
  assert.match(text, /onFactoryBoundary/u); assert.match(text, /flag:"wx",mode:0o600/u);
  assert.doesNotMatch(text, /console\.(?:log|error)|error\.message|error\.stack/u);
});

test("a real tiny child writes stdout and stderr only to its private 0600 file", async () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pr348-private-stdio-"));
  fs.chmodSync(directory, 0o700);
  try {
    const log = path.join(directory, "child.private.log");
    const child = startPrivate(process.execPath, ["-e", 'if(process.cwd()!==process.argv[1])process.exit(9);process.stdout.write("PRIVATE_STDOUT_FIXTURE");process.stderr.write("PRIVATE_STDERR_FIXTURE");', directory],
      { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME }, log });
    const result = await child.exit;
    assert.equal(result.code, 0); assert.equal(result.signal, null);
    assert.equal(fs.statSync(log).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(log, "utf8"), "PRIVATE_STDOUT_FIXTUREPRIVATE_STDERR_FIXTURE");
    assert.equal(Object.hasOwn(child, "stdout"), false); assert.equal(Object.hasOwn(child, "stderr"), false);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test("cache config JSON preserves explicit API cwd and rejects functions or RegExp objects", () => {
  const config = { cwd: "/private/history/services/api", rootDir: "/private/history/services/api/src", cache: true, transform: [["^.+\\.ts$", "/vendor/ts-jest", {}]] };
  assert.deepEqual(JSON.parse(cacheConfigText(config, config.cwd)), config);
  assert.throws(() => cacheConfigText(config, "/private/history"));
  assert.throws(() => cacheConfigText({ ...config, method() {} }, config.cwd));
  assert.throws(() => cacheConfigText({ ...config, pattern: /test/u }, config.cwd));
});

test("frozen dependency preparation keeps the original install lifecycle", () => {
  const source = fs.readFileSync(new URL("./pr348-native-metadata.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--ignore-scripts/u);
  assert.match(source, /"install", "--frozen-lockfile"/u);
});

test("runner identity projects only validated image and agent values, preserving missing values as null", () => {
  assert.deepEqual(runnerIdentity({}), { imageOS: null, imageVersion: null, runnerAgentVersion: null, runnerEnvironment: null });
  assert.deepEqual(runnerIdentity({ ImageOS: "ubuntu24", ImageVersion: "20261018.339.1", RUNNER_VERSION: "2.334.0", RUNNER_ENVIRONMENT: "github-hosted", SECRET: "PRIVATE" }),
    { imageOS: "ubuntu24", imageVersion: "20261018.339.1", runnerAgentVersion: "2.334.0", runnerEnvironment: "github-hosted" });
  assert.equal(runnerIdentity({ ImageVersion: "../../PRIVATE", RUNNER_VERSION: "PRIVATE" }).imageVersion, null);
  assert.equal(runnerIdentity({ ImageVersion: "../../PRIVATE", RUNNER_VERSION: "PRIVATE" }).runnerAgentVersion, null);
});

test("cache inventories use joinable path hashes and stats without reading contents or following links", () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pr348-inventory-fixture-"));
  const root = path.join(directory, "tmp"), outside = path.join(directory, "outside");
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(outside, { mode: 0o700 });
  fs.writeFileSync(path.join(root, "entry"), "PRIVATE_PAYLOAD"); fs.writeFileSync(path.join(outside, "secret"), "PRIVATE_OUTSIDE");
  fs.symlinkSync(outside, path.join(root, "link"));
  const readFile = fs.readFileSync;
  let result;
  try { fs.readFileSync = () => { throw new Error("file contents must not be read"); }; result = inventoryTmp(root); }
  finally { fs.readFileSync = readFile; }
  try {
    const hash = createRequire(import.meta.url)("./pr348-native-cache-observer.cjs")._testing.hash;
    assert.equal(result.status, "unknown-or-incomplete");
    assert.equal(result.contentRead, false);
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.some(row => row.pathSha256 === hash(path.join(root, "entry")) && row.bytes === 15));
    assert.equal(result.entries.some(row => row.pathSha256 === hash(path.join(outside, "secret"))), false);
    assert.ok(result.gaps.includes("symlink-not-followed"));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|outside|entry|\/tmp\//u);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test("cache inventory cap and unavailable roots cannot become complete empty evidence", () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pr348-inventory-cap-"));
  try {
    for (let index = 0; index < 257; index++) fs.writeFileSync(path.join(root, String(index)), "");
    const result = inventoryTmp(root);
    assert.equal(result.entries.length, 256); assert.equal(result.truncated, true);
    assert.equal(result.status, "unknown-or-incomplete"); assert.ok(result.gaps.includes("entry-cap"));
    const missing = inventoryTmp(path.join(root, "missing"));
    assert.equal(missing.status, "unknown-or-incomplete"); assert.ok(missing.gaps.includes("inventory-unavailable"));
  } finally { fs.rmSync(root, { recursive: true }); }
});
