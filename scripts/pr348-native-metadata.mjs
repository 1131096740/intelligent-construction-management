import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE_SHA = "d6719ba2ad89f716f5d67dc0795cdccf98d9820f";
export const BRANCH = "refs/heads/codex/pr348-native-cache-evidence-20261025";
const LOCK_BLOB = "de6c8061d7f37abace24753a6005d4571f3404db";
const GENERATED_SCHEMA = "a909c04b8c85f3cc5fc810ec93b33f19d90ab18788ba58e657d29ee002aa93c8";
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const reject = () => { throw new Error("native metadata rejected"); };
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
const canonical = directory => {
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== path.resolve(directory) || fs.lstatSync(directory).isSymbolicLink()) reject();
  return directory;
};

export function validateNativeContext(env, runtime = process) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== BRANCH ||
      env.GITHUB_RUN_ATTEMPT !== "1" || env.RUNNER_OS !== "Linux" || env.RUNNER_ARCH !== "X64" ||
      runtime.platform !== "linux" || runtime.arch !== "x64" || runtime.versions.node !== "20.20.2" ||
      !/^[a-f0-9]{40}$/.test(env.PR348_CONTROL_SHA || "")) reject();
}

export function runnerIdentity(env) {
  const text = (value, pattern) => typeof value === "string" && pattern.test(value) ? value : null;
  return {
    imageOS: text(env.ImageOS, /^[A-Za-z0-9_.-]{1,64}$/u),
    imageVersion: text(env.ImageVersion, /^[0-9][A-Za-z0-9_.-]{0,63}$/u),
    runnerAgentVersion: text(env.ACTIONS_RUNNER_VERSION || env.RUNNER_VERSION, /^\d+\.\d+\.\d+$/u),
    runnerEnvironment: ["github-hosted", "self-hosted"].includes(env.RUNNER_ENVIRONMENT) ? env.RUNNER_ENVIRONMENT : null
  };
}

export function inventoryTmp(root) {
  const readStartEpochMs = Date.now(), started = performance.now(), entries = [], gaps = new Set();
  let truncated = false;
  const walk = directory => {
    const before = fs.lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || fs.realpathSync(directory) !== directory) { gaps.add("symlink-or-alias"); return; }
    const handle = fs.opendirSync(directory);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        if (entries.length >= 256) { truncated = true; gaps.add("entry-cap"); break; }
        const file = path.join(directory, entry.name);
        try {
          const stat = fs.lstatSync(file), type = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
          if (!Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isFinite(stat.mtimeMs)) { gaps.add("metadata-invalid"); continue; }
          entries.push({ pathSha256: digest(file), type, bytes: stat.size, mtimeMs: stat.mtimeMs });
          if (type === "symlink") gaps.add("symlink-not-followed");
          else if (fs.realpathSync(file) !== file) gaps.add("symlink-or-alias");
          else if (type === "directory") walk(file);
        } catch { gaps.add("stat-or-read-failed"); }
      }
    } finally { handle.closeSync(); }
    const after = fs.lstatSync(directory);
    if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()) gaps.add("identity-changed");
  };
  try { canonical(root); walk(root); } catch { gaps.add("inventory-unavailable"); }
  return { status: gaps.size ? "unknown-or-incomplete" : "observed", scope: "task-private-TMPDIR-stat-only", cap: 256,
    readStartEpochMs, readEndEpochMs: Date.now(), readDurationMs: performance.now() - started,
    contentRead: false, truncated, gaps: [...gaps], entries: entries.sort((a, b) => a.pathSha256.localeCompare(b.pathSha256)) };
}

export function lifecycleFootprint(text) {
  const log = text.replace(/\u001b\[[0-9;]*m/gu, "");
  return {
    apiPrebuild: /^> @jiangkong\/api@\S+ prebuild /mu.test(log),
    sharedDomainBuild: /^> @jiangkong\/shared-domain@\S+ build /mu.test(log),
    sharedTsc: /^> tsc -p tsconfig\.json\s*$/mu.test(log),
    apiBuild: /^> @jiangkong\/api@\S+ build /mu.test(log),
    nestBuild: /^> nest build\s*$/mu.test(log)
  };
}

// These fixed phases are also exercised with in-memory fakes; no business runner is called.
export async function runPhases(io) {
  await io.prepare();
  await io.generate();
  const resources = await io.buildAndObserve();
  await io.pretest();
  const cache = await io.observeCache();
  const controls = await io.positiveControls();
  return { resources, cache, controls };
}

export function completionReceipt({ controlSha, resources, sourceClean }) {
  return {
    schemaVersion: 1, status: "metadata-only-collected", controlSha, sourceSha: SOURCE_SHA,
    sourceClean, resourceSampling: resources.samplingIncomplete === false ? "reported-within-observer-scope" : "gaps-or-unknown",
    completeOwnedLiveCount: null, absenceOfResidualBuildWorkProven: false,
    qualification: "instrumentation-only; not original22 or full CI qualification",
    runtimeCacheKeyOptionsMatchOriginalJest: "unknown",
    privateTmpScope: "this native tool observation only; not historical cold or warm state",
    unobserved: ["HasteMap reads", "test sequencer performance cache", "full Jest-runtime memory", "OS page cache", "historical cache state"],
    original22Executed: false, databaseOrBrowserStarted: false, historicalRootCauseProven: false
  };
}

export function cacheLauncherText({ controllerUrl, observerFile, configFile, targetsFile, source, tmp, outputFile, inventoryFile }) {
  return `"use strict";
const fs=require("node:fs"),rows=[];
(async()=>{
 const {inventoryTmp}=await import(${JSON.stringify(controllerUrl)});
 const {runCacheObservation}=require(${JSON.stringify(observerFile)});
 try{await runCacheObservation({vendorRoot:${JSON.stringify(source)},config:JSON.parse(fs.readFileSync(${JSON.stringify(configFile)},"utf8")),targets:JSON.parse(fs.readFileSync(${JSON.stringify(targetsFile)},"utf8")),outputFile:${JSON.stringify(outputFile)},privateRoot:${JSON.stringify(tmp)},onFactoryBoundary:async({phase})=>{if(!["before-factory","after-factory"].includes(phase))throw Error();rows.push({stage:phase,...inventoryTmp(${JSON.stringify(tmp)})});}});}
 finally{fs.writeFileSync(${JSON.stringify(inventoryFile)},JSON.stringify(rows)+"\\n",{flag:"wx",mode:0o600});}
})().catch(()=>{process.stderr.write('{"status":"cache-child-rejected"}\\n');process.exitCode=1;});
`;
}

export function cacheConfigText(config, apiRoot) {
  if (config.cwd !== apiRoot) reject();
  return JSON.stringify(config, (_key, value) => {
    if (typeof value === "function" || value instanceof RegExp) reject();
    return value;
  }) + "\n";
}

export function startPrivate(command, args, { cwd, env, log }) {
  const fd = fs.openSync(log, "wx", 0o600);
  let child;
  try { child = spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd] }); }
  catch (error) { fs.closeSync(fd); throw error; }
  const exit = new Promise((resolve, fail) => {
    child.once("error", fail);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  exit.finally(() => fs.closeSync(fd)).catch(() => {});
  return { pid: child.pid, exit };
}

export async function main(sourceArg) {
  validateNativeContext(process.env);
  const workspace = canonical(process.env.GITHUB_WORKSPACE), runnerTemp = canonical(process.env.RUNNER_TEMP);
  const source = canonical(sourceArg), control = canonical(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  if (source !== path.join(workspace, "historical") || control !== path.join(workspace, "control")) reject();
  const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git(source, ["rev-parse", "HEAD"]) !== SOURCE_SHA || git(control, ["rev-parse", "HEAD"]) !== process.env.PR348_CONTROL_SHA ||
      git(source, ["status", "--porcelain=v1", "--untracked-files=no"]) ||
      git(source, ["rev-parse", "HEAD:pnpm-lock.yaml"]) !== LOCK_BLOB ||
      git(source, ["ls-files", "-z"]).split("\0").filter(Boolean).length !== 2811 ||
      fs.readdirSync(path.join(source, "services/api/prisma/migrations"), { withFileTypes: true }).filter(row => row.isDirectory()).length !== 192) reject();
  const privateRoot = fs.mkdtempSync(path.join(runnerTemp, "pr348-native-metadata-private-"));
  fs.chmodSync(privateRoot, 0o700);
  const safe = path.join(runnerTemp, "pr348-native-metadata-safe"); fs.mkdirSync(safe, { mode: 0o700 });
  const tmp = path.join(privateRoot, "tmp"); fs.mkdirSync(tmp, { mode: 0o700 });
  const userConfig = path.join(privateRoot, "user.npmrc"), globalConfig = path.join(privateRoot, "global.npmrc");
  fs.writeFileSync(userConfig, "enable-pre-post-scripts=true\n", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(globalConfig, "", { flag: "wx", mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", CI: "true", NODE_ENV: "test",
    TMPDIR: tmp, COREPACK_HOME: path.join(privateRoot, "corepack"), COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" };
  // Keep the same task-private default tmp/cache context for build, pretest and later Jest loading.
  process.env.TMPDIR = tmp;
  process.env.NODE_ENV = "test";
  let phase = "preparation", ordinal = 0;
  const cacheInventory = [];
  const inventory = stage => { cacheInventory.push({ stage, ...inventoryTmp(tmp) }); };
  const command = async (bin, args, label, cwd = source) => {
    const log = path.join(privateRoot, `${++ordinal}-${label}.private.log`), child = startPrivate(bin, args, { cwd, env, log });
    const result = await child.exit; if (result.code !== 0 || result.signal) reject(); return log;
  };
  const pnpm = (args, label) => command("corepack", ["pnpm", "--dir", source, ...args], label);
  const readLog = log => { if (fs.statSync(log).size > 8 * 1024 * 1024) reject(); return fs.readFileSync(log, "utf8"); };
  const readJson = file => JSON.parse(readLog(file));
  let buildFootprint;
  try {
    const observed = await runPhases({
      prepare: async () => {
        await command("corepack", ["prepare", "pnpm@9.15.9", "--activate"], "pnpm-prepare");
        const version = await command("corepack", ["pnpm", "--version"], "pnpm-version");
        if (readLog(version).trim() !== "9.15.9") reject();
        await pnpm(["install", "--frozen-lockfile", "--store-dir", path.join(privateRoot, "store")], "frozen-install");
        const api = createRequire(path.join(source, "services/api/package.json"));
        for (const name of ["prisma", "@prisma/client"]) if (JSON.parse(fs.readFileSync(api.resolve(name + "/package.json"), "utf8")).version !== "5.22.0") reject();
      },
      generate: async () => { phase = "generate"; await pnpm(["--filter", "@jiangkong/api", "exec", "prisma", "generate"], "generate"); },
      buildAndObserve: async () => {
        phase = "owned-build-resource-observation";
        const { createResourceObserver, observeOwnedBuild } = await import("./pr348-native-resource-observer.mjs");
        inventory("prebuild");
        const observer = createResourceObserver(), baseline = await observer.snapshot({ pid: null, phase: "baseline" });
        const log = path.join(privateRoot, "api-build.private.log");
        const child = startPrivate("corepack", ["pnpm", "--dir", source, "--filter", "@jiangkong/api", "build"], { cwd: source, env, log });
        if (!Number.isSafeInteger(child.pid)) { await child.exit; reject(); }
        let resources;
        try { resources = await observeOwnedBuild({ pid: child.pid, exitPromise: child.exit, observer }); }
        finally { await child.exit; }
        write(path.join(safe, "resources.json"), { ...resources, baseline });
        inventory("afterbuild-resource-window");
        const result = await child.exit; if (result.code !== 0 || result.signal) reject();
        buildFootprint = lifecycleFootprint(readLog(log)); if (!Object.values(buildFootprint).every(Boolean)) reject();
        return resources;
      },
      pretest: async () => {
        phase = "normal-pretest"; await pnpm(["--filter", "@jiangkong/api", "run", "pretest"], "normal-pretest");
        const api = createRequire(path.join(source, "services/api/package.json")), client = api.resolve("@prisma/client/package.json");
        const generated = path.dirname(createRequire(client).resolve(".prisma/client/package.json"));
        if (digest(fs.readFileSync(path.join(generated, "schema.prisma"))) !== GENERATED_SCHEMA) reject();
      },
      observeCache: async () => {
        phase = "first-transform-observation";
        inventory("afterpretest-beforeConfig");
        const apiRoot = path.join(source, "services/api");
        const vendor = createRequire(path.join(source, "node_modules/.pnpm/node_modules/package.json"));
        const { readConfig } = vendor("jest-config");
        const previousCwd = process.cwd();
        let projectConfig;
        try {
          process.chdir(apiRoot);
          ({ projectConfig } = await readConfig({ config: path.join(apiRoot, "jest.config.cjs"), cwd: apiRoot, runInBand: true }, apiRoot));
        } finally { process.chdir(previousCwd); }
        inventory("afterreadConfig");
        const targets = ["onboarding", "roster"].map(id => {
          const file = path.join(source, "services/api/src/database", id === "onboarding" ? "employee-onboarding-http-postgres.spec.ts" : "project-roster-http-postgres.spec.ts");
          return { id, file, sha256: digest(fs.readFileSync(file)) };
        });
        const configFile = path.join(privateRoot, "normalized-config.private.json"), targetsFile = path.join(privateRoot, "targets.private.json");
        fs.writeFileSync(configFile, cacheConfigText(projectConfig, apiRoot), { flag: "wx", mode: 0o600 }); write(targetsFile, targets);
        const launcher = path.join(privateRoot, "cache-launch.private.cjs"), inventoryFile = path.join(privateRoot, "factory-inventory.private.json");
        fs.writeFileSync(launcher, cacheLauncherText({ controllerUrl: import.meta.url, observerFile: path.join(control, "scripts/pr348-native-cache-observer.cjs"),
          configFile, targetsFile, source, tmp, outputFile: path.join(safe, "cache.json"), inventoryFile }), { flag: "wx", mode: 0o600 });
        try { await command(process.execPath, [launcher], "first-transform", apiRoot); }
        finally {
          if (fs.existsSync(inventoryFile)) {
            const rows = readJson(inventoryFile);
            if (!Array.isArray(rows) || rows.length > 2 || rows.some(row => !["before-factory", "after-factory"].includes(row.stage))) reject();
            cacheInventory.push(...rows);
          }
          inventory("afterobserve");
        }
        const result = readJson(path.join(safe, "cache.json"));
        if (result.status !== "observed" || result.scope !== "pure-transform-declared-flags" || result.pinsVerified !== true || result.inverseVerified !== true || result.observationIntegrity !== true) reject();
        return result;
      },
      positiveControls: async () => {
        phase = "independent-tool-controls";
        const directory = path.join(privateRoot, "controls"); fs.mkdirSync(directory, { mode: 0o700 });
        await command(process.execPath, [path.join(control, "scripts/pr348-native-cache-observer.cjs"), "positive-control", "--vendor-root", source, "--private-root", directory], "independent-cache-controls");
        const result = readJson(path.join(directory, "controls.safe.json"));
        if (result.status !== "positive-controls-passed" || result.moduleEvaluationMarkerAbsent !== true) reject();
        write(path.join(safe, "controls.json"), result); return result;
      }
    });
    phase = "final-source-verification";
    const sourceClean = git(source, ["status", "--porcelain=v1", "--untracked-files=no"]) === "";
    if (!sourceClean) reject();
    write(path.join(safe, "result.json"), { ...completionReceipt({ controlSha: process.env.PR348_CONTROL_SHA, resources: observed.resources, sourceClean }),
      runtime: { node: process.versions.node, pnpm: "9.15.9", prisma: "5.22.0" }, buildFootprint,
      runnerIdentity: runnerIdentity(process.env), cacheInventory, buildProductionEdge: "unknown",
      cacheProcessCwd: "historical/services/api", normalizedConfigCwdMatched: true,
      samePrivateTmpForPreparationAndJest: true, cacheDirectoryOverride: false, rawArtifactsUploaded: false });
    return { status: "metadata-only-collected", historicalRootCauseProven: false };
  } catch {
    if (!fs.existsSync(path.join(safe, "result.json"))) write(path.join(safe, "result.json"), { schemaVersion: 1, status: "metadata-incomplete", phase,
      controlSha: process.env.PR348_CONTROL_SHA, sourceSha: SOURCE_SHA, runnerIdentity: runnerIdentity(process.env),
      cacheInventory, buildProductionEdge: "unknown", original22Executed: false, historicalRootCauseProven: false });
    reject();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('{"status":"native-metadata-rejected","historicalRootCauseProven":false}'); process.exitCode = 1;
  });
}
