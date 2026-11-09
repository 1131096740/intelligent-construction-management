"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { runSdkGuardedProcess } = require("./task16-sdk205-guard.cjs");

const sha = value => createHash("sha256").update(value).digest("hex");
const cwd = "/private/tmp/simulated-task16-sdk205/work";
const relative = {
  schema: "services/api/prisma/schema.prisma",
  migration205: "services/api/prisma/migrations/20261109100000_contract_direct_pending_input_v1/migration.sql",
  cli: "tool/prisma/build/index.js",
  generator: "tool/client/generator-build/index.js",
  guard: "tool/guard.cjs",
  auditor: "tool/auditor.cjs"
};
const outputs = ["default.d.ts", "default.js", "edge.d.ts", "edge.js", "index-browser.js", "index.d.ts", "index.js", "package.json", "schema.prisma", "wasm.d.ts", "wasm.js"];
const outputDirectory = cwd + "/node_modules/.prisma/client";
const cache = "/Users/simulated-owner/Library/Caches/prisma-nodejs";
const node = "/private/tmp/simulated-node/bin/node";
const [cli, generator, guard, auditor] = [relative.cli, relative.generator, relative.guard, relative.auditor].map(file => cwd + "/" + file);
const optionalMissing = [cwd + "/tool/prisma/node_modules/fsevents/package.json"];
const env = { LANG: "C", TZ: "UTC", NODE_PATH: "", CHECKPOINT_DISABLE: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1" };
const argv = [cli, "generate", "--schema", cwd + "/" + relative.schema, "--no-engine", "--no-hints"];
const forkOptions = () => ({ stdio: ["pipe", "inherit", "pipe", "ipc"], env: { ...env, PRISMA_GENERATOR_INVOCATION: "true" }, execArgv: ["--max-old-space-size=8096"] });
const clientStore = "node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules";
const physicalOutput = clientStore + "/.prisma/client";
const physicalCli = "node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js";
const physicalGenerator = clientStore + "/@prisma/client/generator-build/index.js";

function fixture({ empty = false, cacheDenial = false } = {}) {
  const files = new Map();
  const bodies = new Map();
  const directories = new Map();
  const calls = [];
  const events = [];
  const hooks = {};
  let time = 0, inode = 0, groupAlive = false, rootHandle, generatorResult, cacheCall;
  const timers = new Map();
  const cliEntry = empty ? cwd + "/" + physicalCli : cli;
  const generatorEntry = empty ? cwd + "/" + physicalGenerator : generator;
  const entryArgs = [cliEntry, ...argv.slice(1)];
  const targetDirectory = empty ? cwd + "/" + physicalOutput : outputDirectory;
  const oldDirectory = empty ? "/private/tmp/simulated-task16-sdk204/work/" + physicalOutput : outputDirectory;
  const names = dir => [...files.keys()].filter(file => path.dirname(file) === dir).map(file => path.basename(file));
  const physicalMember = (relativePath, absolute) => {
    const toolRoot = process.env.JG_TASK16_SDK205_TOOL_FIXTURE || path.resolve(__dirname, "../../..");
    return member(absolute, fs.readFileSync(path.join(toolRoot, relativePath)),
      { mode: relativePath === physicalCli ? "100755" : "100644" });
  };
  function member(file, value, { sha256, mode = "100644" } = {}) {
    const bytes = Buffer.from(value);
    const record = { path: file, realpath: file, sha256: sha256 ?? sha(bytes), size: bytes.length,
      mode, dev: "1", ino: String(++inode), mtimeNs: "2", ctimeNs: "2", nlink: 1 };
    files.set(file, record); bodies.set(file, bytes);
    return { ...record };
  }
  const migrations = path.join(__dirname, "migrations");
  const history = [...fs.readdirSync(migrations, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name < "20261109100000_contract_direct_pending_input_v1")
    .map(entry => "services/api/prisma/migrations/" + entry.name + "/migration.sql").sort(),
  "services/api/prisma/migrations/migration_lock.toml"];
  const historyRows = history.map(file => member(cwd + "/" + file, fs.readFileSync(path.join(__dirname, "../../..", file))));
  const immutable = [member(node, "simulated executable bytes", { mode: "100755" }),
    ...(empty ? [physicalMember(physicalCli, cliEntry), physicalMember(physicalGenerator, generatorEntry)]
      : [cli, generator].map(file => member(file, "inert file " + file))),
    ...[guard, auditor].map(file => member(file, "inert file " + file)),
    member(cwd + "/" + relative.schema, fs.readFileSync(path.join(__dirname, "../../..", relative.schema))),
    member(cwd + "/" + relative.migration205, fs.readFileSync(path.join(__dirname, "../../..", relative.migration205))),
    ...["pnpm-lock.yaml", "services/api/src/contract/contract-direct-pending-recipe.ts"]
      .map(file => member(cwd + "/" + file, fs.readFileSync(path.join(__dirname, "../../..", file)))),
    ...historyRows];
  const outputPreimages = outputs.map(file => member(oldDirectory + "/" + file, "old " + file));
  const manifest = { schemaVersion: 1, purpose: "task16-sdk205-generation-guard", sourceSetSha: "f7a0bd9f4f51adcd74b28894f87ab0e2e76a0f196aaa6aaf6bc6e680c1ded1b7",
    cwd, node, cli: cliEntry, generator: generatorEntry, guard, auditor, env: { ...env }, argv: entryArgs, immutable, outputPreimages,
    optionalMissing: [...optionalMissing], timeoutMs: 200, maxOutputBytes: 1024 };
  if (empty) {
    for (const dir of [cwd, path.dirname(targetDirectory), targetDirectory]) {
      directories.set(dir, { path: dir, realpath: dir, dev: "1", ino: String(++inode), mode: "040700" });
    }
    manifest.emptyOutput = { root: { ...directories.get(cwd) },
      parent: { ...directories.get(path.dirname(targetDirectory)) }, directory: { ...directories.get(targetDirectory) },
      priorDirectory: oldDirectory };
  }
  if (cacheDenial) manifest.cacheDenial = "simulated-prisma-cache-eacces-v1";
  const runtime = {
    files: {
      capture(file) { const row = files.get(file) ?? directories.get(file); return row ? { ...row } : null; },
      openRead(file) {
        if (!files.has(file)) return null;
        const row = files.get(file);
        return { before: { ...row }, bytes: Buffer.from(bodies.get(file)), after: { ...row }, named: { ...row } };
      },
      listDirectory(dir) { assert.equal(dir, oldDirectory); return names(dir); },
      writeFile(file, bytes, expected) {
        assert.deepEqual(files.get(file), expected);
        calls.push(["write", file]);
        files.set(file, { ...expected, sha256: sha(bytes), size: bytes.length, mtimeNs: "3", ctimeNs: "3" });
        bodies.set(file, Buffer.from(bytes));
      },
      mkdir(dir, options) { calls.push(["mkdir", dir, options]); }
    },
    modules: { resolve(request) { return request === "fsevents" ? null : request; }, load(file) { calls.push(["load", file]); return { inert: true }; } },
    process: {
      inspect(pid) { return pid === 41 ? { pid, ppid: 1, entry: cliEntry, executable: node, cwd, env: { ...env }, argv: [...entryArgs] }
        : { pid, ppid: 41, entry: generatorEntry, executable: node, cwd, env: forkOptions().env, argv: [generatorEntry] }; },
      async runEntry(identity, api, launch) {
        if (cacheDenial && identity.entry === generatorEntry) {
          cacheCall = { manifestSha: launch.manifestSha, launchNonce: launch.grant.nonce, pid: 42, ppid: 41,
            entry: generatorEntry, api: "fs/promises.mkdir", fileSha256: "1697ccccd6b9ef9bfe00277ab8347d656080854d12680568940546e1ef4602ee",
            line: 10051, column: 35, direct: true, native: false, eval: false };
        }
        calls.push(["entry", identity.entry]);
        if (identity.entry === cliEntry) {
          if (hooks.cli) return hooks.cli(api);
          try { api.module.load("fsevents"); } catch (error) { assert.equal(error.code, "MODULE_NOT_FOUND"); }
          await api.childProcess.fork(generatorEntry, [], forkOptions());
        } else {
          if (hooks.generator) return hooks.generator(api);
          await (empty ? writeEmptyOutputs(api) : writeOutputs(api));
        }
        return { code: 0, signal: null };
      },
      fork(file, args, options, start) {
        calls.push(["fork", file]);
        if (hooks.fork) return hooks.fork(start);
        generatorResult = start(42);
        return generatorResult;
      },
      terminate(pid) { calls.push(["terminate", pid]); }
    },
    clock: { now: () => time },
    events: {
      read: () => events.map(event => ({ ...event })),
      append(event) {
        events.push({ ...event });
        if (hooks.event) return hooks.event(event);
        return { sequence: event.sequence, manifestSha: event.manifestSha };
      }
    },
    boundary: {
      spawn(executable, args, options, start) {
        calls.push(["spawn", executable, options.detached]);
        assert.equal(executable, node);
        assert.deepEqual(args, entryArgs);
        assert.deepEqual(options.env, env);
        rootHandle = new EventEmitter();
        rootHandle.pid = 41;
        rootHandle.stdout = new EventEmitter();
        rootHandle.stderr = new EventEmitter();
        groupAlive = true;
        if (hooks.spawn) hooks.spawn({ start, handle: rootHandle, settle, advance });
        else queueMicrotask(async () => {
          const result = await start(41);
          settle(result.code);
        });
        return rootHandle;
      },
      groupExists(pid) { assert.equal(pid, 41); return groupAlive; },
      groupSignal(pid, signal) {
        assert.equal(pid, 41); calls.push(["group signal", signal]);
        if (hooks.signal) hooks.signal(signal, settle, () => { groupAlive = false; });
      },
      setTimer(callback, delay) { const key = Symbol(); timers.set(key, { at: time + delay, callback }); return key; },
      clearTimer(key) { timers.delete(key); }
    }
  };
  if (cacheDenial) runtime.process.observeCacheCall = () => hooks.cacheCall ? hooks.cacheCall(cacheCall) : cacheCall;
  if (empty) Object.assign(runtime.files, {
    observeOutput(scope) {
      assert.deepEqual(scope, manifest.emptyOutput);
      const snapshot = () => [cwd, path.dirname(targetDirectory), targetDirectory].map(dir => ({ ...directories.get(dir) }));
      return { before: snapshot(), names: names(targetDirectory), after: snapshot(), named: snapshot() };
    },
    openExclusive(scope, basename) {
      assert.deepEqual(scope, manifest.emptyOutput);
      assert.ok(outputs.includes(basename));
      const file = targetDirectory + "/" + basename;
      assert.equal(files.has(file), false);
      member(file, "");
      const record = { ...files.get(file) };
      let closed = false;
      calls.push(["exclusive open", file, record.ino]);
      return {
        capture() { assert.equal(closed, false); return { ...record }; },
        write(bytes) {
          assert.equal(closed, false);
          calls.push(["descriptor write", file, record.ino]);
          Object.assign(record, { size: bytes.length, sha256: sha(bytes), mtimeNs: "3", ctimeNs: "3" });
          files.set(file, { ...record }); bodies.set(file, Buffer.from(bytes));
        },
        read() { assert.equal(closed, false); return Buffer.from(bodies.get(file)); },
        close() { assert.equal(closed, false); closed = true; calls.push(["descriptor close", file, record.ino]); }
      };
    }
  });
  function settle(code, remains = false) { groupAlive = remains; rootHandle.emit("close", code); }
  async function advance(ms) {
    const until = time + ms;
    await Promise.resolve();
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
      if (!next) break;
      const [key, timer] = next; timers.delete(key); time = timer.at; timer.callback();
      await Promise.resolve();
    }
    time = until;
  }
  async function writeOutputs(api) {
    await api.fs.promises.mkdir(outputDirectory, { recursive: true });
    for (const name of outputs) await api.fs.promises.writeFile(outputDirectory + "/" + name, "new " + name);
  }
  async function prepareEmptyOutput(api) {
    try { api.module.load(targetDirectory + "/package.json"); }
    catch (error) { assert.equal(error.code, "MODULE_NOT_FOUND"); }
    await new Promise((resolve, reject) => api.fs.mkdir(targetDirectory, { mode: 511, recursive: true },
      error => error ? reject(error) : resolve()));
  }
  async function writeEmptyOutputs(api, schemaOptions = { encoding: "utf-8" }) {
    await prepareEmptyOutput(api);
    await Promise.all(outputs.filter(name => name !== "schema.prisma").map(async name => {
      const file = targetDirectory + "/" + name;
      await api.fs.promises.rm(file, { recursive: true, force: true });
      await api.fs.promises.writeFile(file, "new " + name);
    }));
    await api.fs.promises.writeFile(targetDirectory + "/schema.prisma", "new schema.prisma", schemaOptions);
  }
  return { manifest, runtime, hooks, files, bodies, directories, calls, events, timers, advance, writeOutputs,
    prepareEmptyOutput, writeEmptyOutputs, targetDirectory, oldDirectory,
    result: () => runSdkGuardedProcess(manifest, runtime), generatorResult: () => generatorResult };
}

test("an independently held empty physical output follows the official sequence without deleting old SDK members", async () => {
  const f = fixture({ empty: true });
  const old = f.manifest.outputPreimages.map(row => ({ ...row }));
  const receipt = await f.result();
  assert.equal(receipt.status, "SIMULATED_GENERATED_UNQUALIFIED", JSON.stringify(receipt));
  assert.deepEqual(receipt.outputManifest.map(row => row.path), outputs.map(name => f.targetDirectory + "/" + name));
  for (const preimage of old) {
    assert.deepEqual(f.files.get(preimage.path), preimage);
    assert.equal(f.bodies.get(preimage.path).toString(), "old " + path.basename(preimage.path));
  }
  const opens = f.calls.filter(([action]) => action === "exclusive open").map(([, file, ino]) => [file, ino]);
  assert.equal(opens.length, 11);
  for (const action of ["descriptor write", "descriptor close"]) {
    assert.deepEqual(f.calls.filter(([name]) => name === action).map(([, file, ino]) => [file, ino]), opens);
  }
  assert.equal(opens.at(-1)[0], f.targetDirectory + "/schema.prisma");
  assert.equal(f.calls.some(([action]) => ["rm", "rmdir", "write", "mkdir"].includes(action)), false);
  assert.equal(receipt.events.filter(event => event.code === "SDK205_EMPTY_REMOVE_ABSENT").length, 10);
});

test("a parent replaced during exclusive open is refused before the first descriptor write", async () => {
  const f = fixture({ empty: true });
  const open = f.runtime.files.openExclusive;
  f.runtime.files.openExclusive = (...args) => {
    const descriptor = open(...args);
    const parent = f.directories.get(path.dirname(f.targetDirectory));
    f.directories.set(parent.path, { ...parent, ino: "99999" });
    return descriptor;
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_EMPTY_OUTPUT_IDENTITY");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.deepEqual(f.calls.filter(([action]) => action.startsWith("descriptor")).map(([action]) => action), ["descriptor close"]);
});

test("a pinned generator changed during exclusive open cannot write descriptor bytes", async () => {
  const f = fixture({ empty: true });
  const open = f.runtime.files.openExclusive;
  f.runtime.files.openExclusive = (...args) => {
    const descriptor = open(...args);
    f.bodies.set(f.manifest.generator, Buffer.from("changed generator"));
    return descriptor;
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_FILE_IDENTITY");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.deepEqual(f.calls.filter(([action]) => action.startsWith("descriptor")).map(([action]) => action), ["descriptor close"]);
});

for (const [name, change, code] of [
  ["an occupied output", f => f.files.set(f.targetDirectory + "/index.js", {}), "SDK205_OUTPUT_MEMBERSHIP"],
  ["a linked directory", f => {
    const directory = f.directories.get(f.targetDirectory);
    f.directories.set(directory.path, { ...directory, realpath: f.oldDirectory });
  }, "SDK205_EMPTY_OUTPUT_IDENTITY"],
  ["changed old SDK bytes", f => f.bodies.set(f.manifest.outputPreimages[0].path, Buffer.from("changed SDK")), "SDK205_FILE_IDENTITY"],
  ["changed official CLI bytes", f => f.bodies.set(f.manifest.cli, Buffer.from("changed CLI")), "SDK205_FILE_IDENTITY"],
  ["an incomplete filesystem boundary", f => { delete f.runtime.files.openExclusive; }, "SDK205_RUNTIME_BOUNDARY"]
]) {
  test(`the empty-output profile refuses ${name} before spawn`, async () => {
    const f = fixture({ empty: true });
    change(f);
    const receipt = await f.result();
    assert.equal(receipt.code, code);
    assert.equal(receipt.cleanup, "NOT_STARTED");
    assert.equal(f.calls.length, 0);
  });
}

test("an empty enumeration cannot substitute for a named absence observation", async () => {
  const f = fixture({ empty: true });
  const capture = f.runtime.files.capture;
  f.runtime.files.capture = file => file === f.targetDirectory + "/index.js" ? f.manifest.outputPreimages[0] : capture(file);
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_EMPTY_OUTPUT_NOT_ABSENT");
  assert.equal(f.calls.some(([action]) => action === "exclusive open"), false);
});

test("exclusive open refuses a target that appears after the absence observation", async () => {
  const f = fixture({ empty: true });
  f.runtime.files.openExclusive = (scope, name) => {
    const target = scope.directory.path + "/" + name;
    f.files.set(target, { path: target });
    throw Object.assign(new Error("synthetic exclusive create conflict"), { code: "EEXIST" });
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_IO_FAILURE");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.equal(f.calls.some(([event]) => ["descriptor write", "rm", "rmdir"].includes(event)), false);
  assert.equal(f.files.has(f.targetDirectory + "/default.d.ts"), true);
});

test("the empty profile only accepts the exact callback mkdir argument shape", async () => {
  const f = fixture({ empty: true });
  let called = false;
  f.hooks.generator = async api => {
    try { api.module.load(f.targetDirectory + "/package.json"); } catch {}
    try { api.fs.mkdir(f.targetDirectory, { recursive: true }, () => { called = true; }); } catch {}
    return { code: 0, signal: null };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(called, false);
  assert.equal(f.calls.some(([event]) => ["exclusive open", "mkdir"].includes(event)), false);
});

test("the schema cannot be created with different write options after the other ten files", async () => {
  const f = fixture({ empty: true });
  f.hooks.generator = async api => {
    try { await f.writeEmptyOutputs(api, { encoding: "ascii" }); } catch {}
    return { code: 0, signal: null };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(f.calls.filter(([event]) => event === "exclusive open").length, 10);
  assert.equal(f.files.has(f.targetDirectory + "/schema.prisma"), false);
});

const removeOptions = { recursive: true, force: true };
for (const [name, action, expectedOpens] of [
  ["directory recursion", (f, api) => api.fs.promises.rmdir(f.targetDirectory, { recursive: true }), 0],
  ["an unknown remove target", (f, api) => api.fs.promises.rm(f.targetDirectory + "/unknown", removeOptions), 0],
  ["a write before its remove witness", (f, api) => api.fs.promises.writeFile(f.targetDirectory + "/index.js", "new"), 0],
  ["a schema write before other files", (f, api) => api.fs.promises.writeFile(f.targetDirectory + "/schema.prisma", "new", { encoding: "utf-8" }), 0],
  ["a removal after creation", async (f, api) => {
    const target = f.targetDirectory + "/index.js";
    await api.fs.promises.rm(target, removeOptions);
    await api.fs.promises.writeFile(target, "new");
    await api.fs.promises.rm(target, removeOptions);
  }, 1],
  ["a duplicate creation", async (f, api) => {
    const target = f.targetDirectory + "/index.js";
    await api.fs.promises.rm(target, removeOptions);
    await api.fs.promises.writeFile(target, "new");
    await api.fs.promises.writeFile(target, "again");
  }, 1]
]) {
  test(`the empty-output profile refuses ${name}`, async () => {
    const f = fixture({ empty: true });
    f.hooks.generator = async api => {
      await f.prepareEmptyOutput(api);
      try { await action(f, api); } catch {}
      return { code: 0, signal: null };
    };
    const receipt = await f.result();
    assert.equal(receipt.code, "SDK205_WRITE_DENIED");
    assert.equal(receipt.cleanup, "SETTLED");
    assert.equal(f.calls.filter(([event]) => event === "exclusive open").length, expectedOpens);
    assert.equal(f.calls.some(([event]) => ["rm", "rmdir", "write", "mkdir"].includes(event)), false);
  });
}

test("the CLI role cannot open the generator output scope", async () => {
  const f = fixture({ empty: true });
  f.hooks.cli = async api => {
    try { api.module.load(f.targetDirectory + "/package.json"); } catch {}
    return { code: 0, signal: null };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_MODULE_DENIED");
  assert.equal(f.calls.some(([event]) => event === "fork" || event === "exclusive open"), false);
});

test("the official tail cache attempt remains fatal after all simulated new files are created", async () => {
  const f = fixture({ empty: true });
  f.hooks.generator = async api => {
    await f.writeEmptyOutputs(api);
    try { await api.module.load("fs/promises").mkdir(cache, { recursive: true }); } catch {}
    return { code: 0, signal: null };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(receipt.firstEvent.path, cache);
  assert.equal(receipt.cleanup, "SETTLED");
  assert.equal(f.calls.filter(([event]) => event === "descriptor write").length, 11);
  assert.equal(f.calls.some(([event]) => ["write", "mkdir"].includes(event)), false);
});

test("one guarded fake fork re-enters the public guard and records exactly eleven simulated outputs", async () => {
  const f = fixture();
  const result = await f.result();
  assert.equal(result.status, "SIMULATED_GENERATED_UNQUALIFIED", JSON.stringify(result));
  assert.equal(result.cleanup, "SETTLED");
  assert.equal(result.exit.code, 0);
  assert.deepEqual(f.calls.filter(([api]) => api === "entry"), [["entry", cli], ["entry", generator]]);
  assert.deepEqual(f.calls.filter(([api]) => api === "fork"), [["fork", generator]]);
  assert.deepEqual(result.outputManifest.map(row => row.path), outputs.map(name => outputDirectory + "/" + name));
  assert.ok(result.events.some(row => row.api === "child_process.fork" && row.decision === "ALLOW"));
  assert.ok(result.events.some(row => row.code === "OPTIONAL_MODULE_ABSENT"));
  assert.equal(f.timers.size, 0);
});

const cleanExit = () => ({ code: 0, signal: null });
const noWrites = f => assert.deepEqual(f.calls.filter(([api]) => api === "write" || api === "mkdir"), []);

for (const [name, call, apiName] of [
  ["canonical fs/promises import", api => api.module.load("fs/promises").mkdir(cache, { recursive: true }), "fs.promises.mkdir"],
  ["node:fs/promises import", api => api.module.load("node:fs/promises").mkdir(cache, { recursive: true }), "fs.promises.mkdir"],
  ["fs.promises alias", api => api.module.load("fs").promises.mkdir(cache, { recursive: true }), "fs.promises.mkdir"],
  ["node:fs alias", api => api.module.load("node:fs").promises.mkdir(cache, { recursive: true }), "fs.promises.mkdir"],
  ["same-name cache at a different path", api => api.fs.promises.mkdir(cwd + "/prisma-nodejs", { recursive: true }), "fs.promises.mkdir"],
  ["mkdirSync", api => api.fs.mkdirSync(cache, { recursive: true }), "fs.mkdirSync"],
  ["callback mkdir", api => api.fs.mkdir(cache, { recursive: true }, () => {}), "fs.mkdir"],
  ["last-generate write", api => api.fs.promises.writeFile(cache + "/last-generate", "timestamp"), "fs.promises.writeFile"],
  ["unexpected extra cache options", api => api.fs.promises.mkdir(cache, { recursive: true, mode: 0o700 }), "fs.promises.mkdir"],
]) {
  test(`cache ${name} stays fatal even when the generator catches it and reports exit 0`, async () => {
    const f = fixture();
    f.hooks.generator = async api => {
      await assert.rejects(async () => call(api), { code: "SDK205_WRITE_DENIED" });
      await assert.rejects(api.fs.promises.writeFile(outputDirectory + "/index.js", "caught"), { code: "SDK205_WRITE_DENIED" });
      return cleanExit();
    };
    const result = await f.result();
    assert.equal(result.status, "FAILED");
    assert.equal(result.code, "SDK205_WRITE_DENIED");
    assert.equal(result.firstEvent.api, apiName);
    assert.equal(result.firstEvent.process, 42);
    assert.equal(result.cleanup, "SETTLED");
    assert.deepEqual(f.calls.filter(([api]) => api === "terminate"), [["terminate", 42]]);
    noWrites(f);
  });
}

for (const [name, mutate] of [
  ["Schema205 bytes with unchanged stat and claimed hash", f => { f.bodies.get(cwd + "/" + relative.schema)[0] ^= 1; }],
  ["last old migration bytes", f => { f.bodies.get(cwd + "/services/api/prisma/migrations/20261108220000_contract_archive_v2_authority/migration.sql")[0] ^= 1; }],
  ["migration205 bytes", f => { f.bodies.get(cwd + "/" + relative.migration205)[0] ^= 1; }],
  ["old lock bytes", f => { f.bodies.get(cwd + "/services/api/prisma/migrations/migration_lock.toml")[0] ^= 1; }],
  ["old SDK204 preimage bytes", f => { f.bodies.get(outputDirectory + "/index.js")[0] ^= 1; }],
  ["FD changed during read", f => {
    const openRead = f.runtime.files.openRead;
    f.runtime.files.openRead = file => {
      const witness = openRead(file);
      if (file === cli) witness.after.ino = "999";
      return witness;
    };
  }],
]) {
  test(`preflight refuses ${name} with zero child calls`, async () => {
    const f = fixture();
    mutate(f);
    const result = await f.result();
    assert.equal(result.code, "SDK205_FILE_IDENTITY");
    assert.equal(result.cleanup, "NOT_STARTED");
    assert.deepEqual(f.calls, []);
  });
}

for (const [name, mutate, code] of [
  ["an incomplete runtime", f => { delete f.runtime.boundary.groupExists; }, "SDK205_RUNTIME_BOUNDARY"],
  ["an extra capability", f => { f.runtime.files.guessPermission = () => true; }, "SDK205_RUNTIME_BOUNDARY"],
  ["an undeclared manifest key", f => { f.manifest.bypass = true; }, "SDK205_MANIFEST"],
  ["an undeclared environment key", f => { f.manifest.env.DATABASE_URL = "not-used"; }, "SDK205_COMMAND"],
  ["a substituted migration digest", f => { f.manifest.immutable.find(row => row.path.endsWith("/20261108220000_contract_archive_v2_authority/migration.sql")).sha256 = "0".repeat(64); }, "SDK205_MIGRATION_HISTORY"],
  ["a restored optional package", f => { f.files.set(optionalMissing[0], { path: optionalMissing[0] }); }, "SDK205_OPTIONAL_MODULE_PRESENT"],
]) {
  test(`preflight refuses ${name}`, async () => {
    const f = fixture();
    mutate(f);
    const result = await f.result();
    assert.equal(result.code, code);
    assert.equal(result.cleanup, "NOT_STARTED");
    assert.deepEqual(f.calls, []);
  });
}

for (const [name, call, code] of [
  ["native load", api => api.process.dlopen({}, cwd + "/file.node"), "SDK205_NATIVE_DENIED"],
  ["network call", api => api.network.fetch("https://example.invalid"), "SDK205_NETWORK_DENIED"],
  ["unknown child API", api => api.childProcess.spawn(node, []), "SDK205_CHILD_DENIED"],
  ["wrong fork path", api => api.childProcess.fork(cli, [], forkOptions()), "SDK205_FORK_DENIED"],
  ["wrong fork options", api => api.childProcess.fork(generator, [], { ...forkOptions(), shell: true }), "SDK205_FORK_DENIED"],
  ["root output writer", api => api.fs.promises.writeFile(outputDirectory + "/index.js", "wrong caller"), "SDK205_WRITE_DENIED"],
  ["unknown builtin alias", api => api.module.load("node:fs/promises/extra"), "SDK205_MODULE_DENIED"],
]) {
  test(`${name} is sticky and stops before any generator, even if the fake CLI catches the error`, async () => {
    const f = fixture();
    f.hooks.cli = async api => {
      try { await call(api); } catch {}
      try { await api.childProcess.fork(generator, [], forkOptions()); } catch {}
      return cleanExit();
    };
    const result = await f.result();
    assert.equal(result.code, code);
    assert.equal(result.cleanup, "SETTLED");
    assert.equal(result.events.filter(row => row.decision === "DENY").length, 1);
    assert.deepEqual(f.calls.filter(([api]) => api === "fork"), []);
    noWrites(f);
  });
}

for (const [name, file] of [
  ["dot segments", outputDirectory + "/../client/index.js"],
  ["nonmanifest output", outputDirectory + "/additional.js"],
  ["file URL", new URL("file://" + outputDirectory + "/index.js")],
]) {
  test(`the generator cannot write to ${name}`, async () => {
    const f = fixture();
    f.hooks.generator = async api => {
      try { await api.fs.promises.writeFile(file, "must not write"); } catch {}
      return cleanExit();
    };
    const result = await f.result();
    assert.equal(result.code, "SDK205_WRITE_DENIED");
    noWrites(f);
  });
}

test("a fork acknowledgment without guarded child re-entry is not generation", async () => {
  const f = fixture();
  f.hooks.fork = async () => cleanExit();
  const result = await f.result();
  assert.equal(result.code, "SDK205_GENERATOR_NOT_OBSERVED");
  assert.equal(result.cleanup, "SETTLED");
  noWrites(f);
});

test("a second fork request is fatal before its child starts", async () => {
  const f = fixture();
  f.hooks.generator = async () => cleanExit();
  f.hooks.cli = async api => {
    await api.childProcess.fork(generator, [], forkOptions());
    try { await api.childProcess.fork(generator, [], forkOptions()); } catch {}
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_FORK_DENIED");
  assert.deepEqual(f.calls.filter(([api]) => api === "fork"), [["fork", generator]]);
});

test("a fake child cannot replay its guarded entry callback", async () => {
  const f = fixture();
  f.hooks.generator = async () => cleanExit();
  f.hooks.fork = async start => { await start(42); await start(43); };
  const result = await f.result();
  assert.equal(result.code, "SDK205_PROCESS_REENTRY");
  assert.equal(f.calls.filter(([api, entry]) => api === "entry" && entry === generator).length, 1);
});

test("resolved fsevents is fatal even if returned as a pinned JavaScript path", async () => {
  const f = fixture();
  f.runtime.modules.resolve = () => guard;
  const result = await f.result();
  assert.equal(result.code, "SDK205_MODULE_DENIED");
  assert.deepEqual(f.calls.filter(([api]) => api === "load"), []);
});

test("only one natural absence of optional fsevents is recoverable", async () => {
  const f = fixture();
  f.hooks.cli = async api => {
    for (let index = 0; index < 2; index++) {
      try { api.module.load("fsevents"); } catch {}
    }
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_MODULE_DENIED");
  assert.equal(result.events.filter(row => row.code === "OPTIONAL_MODULE_ABSENT").length, 1);
});

test("wrong or missing event acknowledgment is fatal without attempting duplicate records", async () => {
  const f = fixture();
  f.hooks.event = event => ({ sequence: event.sequence - 1, manifestSha: event.manifestSha });
  const result = await f.result();
  assert.equal(result.code, "SDK205_EVENT_NOT_RECORDED");
  assert.equal(result.cleanup, "SETTLED");
  assert.equal(f.events.length, 1);
  noWrites(f);
});

async function until(check) {
  for (let index = 0; index < 200 && !check(); index++) await Promise.resolve();
  assert.ok(check(), "the mocked process never reached its expected state");
}

test("root exit with a live descendant waits for the owned group and escalates to SIGKILL", async () => {
  const f = fixture();
  f.hooks.spawn = ({ start, settle }) => queueMicrotask(async () => { await start(41); settle(0, true); });
  f.hooks.signal = (signal, settle, clearGroup) => {
    if (signal === "SIGKILL") clearGroup();
  };
  let finished = false;
  const run = f.result().then(result => { finished = true; return result; });
  await until(() => f.calls.some(([api, signal]) => api === "group signal" && signal === "SIGTERM"));
  assert.equal(finished, false);
  await f.advance(1100);
  const result = await run;
  assert.equal(result.status, "FAILED");
  assert.equal(result.code, "TASK16_MIGRATE_PROCESS_REMAINS");
  assert.equal(result.cleanup, "SETTLED");
  assert.deepEqual(f.calls.filter(([api]) => api === "group signal"), [["group signal", "SIGTERM"], ["group signal", "SIGKILL"]]);
  assert.equal(f.timers.size, 0);
});

test("an owned group that survives the hard deadline remains unconfirmed", async () => {
  const f = fixture();
  f.hooks.spawn = ({ start, settle }) => queueMicrotask(async () => { await start(41); settle(0, true); });
  const run = f.result();
  await until(() => f.calls.some(([api]) => api === "group signal"));
  await f.advance(5100);
  const result = await run;
  assert.equal(result.code, "TASK16_MIGRATE_PROCESS_REMAINS");
  assert.equal(result.cleanup, "UNCONFIRMED");
  assert.equal(f.timers.size, 0);
});

for (const [name, spawn, code] of [
  ["deadline", () => {}, "TASK16_MIGRATE_TIMEOUT"],
  ["output limit", ({ handle }) => queueMicrotask(() => handle.stdout.emit("data", Buffer.alloc(1025))), "TASK16_MIGRATE_OUTPUT_LIMIT"]
]) {
  test(`fake ${name} aborts the owned group and clears timers`, async () => {
    const f = fixture();
    f.hooks.spawn = spawn;
    f.hooks.signal = (signal, settle) => queueMicrotask(() => settle(1));
    const run = f.result();
    await f.advance(250);
    const result = await run;
    assert.equal(result.code, code);
    assert.equal(result.cleanup, "SETTLED");
    assert.deepEqual(f.calls.filter(([api]) => api === "group signal"), [["group signal", "SIGTERM"]]);
    assert.equal(f.timers.size, 0);
  });
}

test("a fork rejection after its guarded child finishes cannot be caught and hidden", async () => {
  const f = fixture();
  f.hooks.fork = async start => { await start(42); throw Error("synthetic fork observation failed"); };
  f.hooks.cli = async api => {
    try { await api.childProcess.fork(generator, [], forkOptions()); } catch {}
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_FORK_FAILED");
  assert.equal(result.firstEvent.api, "child_process.fork");
  assert.equal(result.cleanup, "SETTLED");
});

test("a transient immutable input swap at the output call has zero write effects", async () => {
  const f = fixture();
  const bytes = f.bodies.get(cwd + "/" + relative.schema);
  f.hooks.generator = async api => {
    bytes[0] ^= 1;
    try { await api.fs.promises.writeFile(outputDirectory + "/index.js", "guard must refuse"); } catch {}
    bytes[0] ^= 1;
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_FILE_IDENTITY");
  noWrites(f);
});

test("a transient actor identity swap at the output call has zero write effects", async () => {
  const f = fixture();
  const inspect = f.runtime.process.inspect;
  let drift = false;
  f.runtime.process.inspect = pid => ({ ...inspect(pid), ...(drift && pid === 42 ? { ppid: 99 } : {}) });
  f.hooks.generator = async api => {
    drift = true;
    try { await api.fs.promises.mkdir(outputDirectory, { recursive: true }); } catch {}
    drift = false;
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_PROCESS_IDENTITY");
  noWrites(f);
});

test("an event echo ACK cannot conceal a missing event record", async () => {
  const f = fixture();
  f.runtime.events.append = event => ({ sequence: event.sequence, manifestSha: event.manifestSha });
  f.runtime.events.read = () => [];
  const result = await f.result();
  assert.equal(result.code, "SDK205_EVENT_STREAM");
  assert.equal(result.cleanup, "SETTLED");
});

test("a replacement between output capture and adapter use cannot be written", async () => {
  const f = fixture();
  const write = f.runtime.files.writeFile;
  f.runtime.files.writeFile = (file, bytes, expected) => {
    f.files.set(file, { ...f.files.get(file), ino: "9898" });
    assert.deepEqual(f.files.get(file), expected);
    return write(file, bytes, expected);
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_IO_FAILURE");
  assert.deepEqual(f.calls.filter(([api]) => api === "write"), []);
});

test("an unrecognized FS method cannot be silently caught by the generator", async () => {
  const f = fixture();
  f.hooks.generator = async api => {
    try { await api.fs.promises.copyFile(cli, cache + "/new"); } catch {}
    try { await f.writeOutputs(api); } catch {}
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_WRITE_DENIED");
  noWrites(f);
});

test("a failed spawn cannot claim cleanup just by reporting a controller-shaped error", async () => {
  const f = fixture();
  f.runtime.boundary.spawn = () => {
    throw Object.assign(Error("fake handle never returned"), { code: "TASK16_MIGRATE_SPAWN_FAILED" });
  };
  const result = await f.result();
  assert.equal(result.status, "FAILED");
  assert.equal(result.cleanup, "UNCONFIRMED");
  noWrites(f);
});

for (const childExit of [{ code: 7, signal: null }, { code: 0, signal: null, foreign: true }]) {
  test(`a finished guarded child cannot conceal a failed or foreign fork receipt ${JSON.stringify(childExit)}`, async () => {
    const f = fixture();
    f.hooks.fork = async start => { await start(42); return childExit; };
    f.hooks.cli = async api => {
      try { await api.childProcess.fork(generator, [], forkOptions()); } catch {}
      return cleanExit();
    };
    const result = await f.result();
    assert.equal(result.code, "SDK205_FORK_RESULT");
    assert.equal(result.cleanup, "SETTLED");
  });
}

test("mutating a child handle PID cannot move probes or signals outside the original owned group", async () => {
  const f = fixture();
  const probes = [], signals = [];
  const exists = f.runtime.boundary.groupExists, signal = f.runtime.boundary.groupSignal;
  f.runtime.boundary.groupExists = pid => {
    probes.push(pid);
    return pid === 41 ? exists(pid) : false;
  };
  f.runtime.boundary.groupSignal = (pid, code) => {
    signals.push([pid, code]);
    if (pid === 41) signal(pid, code);
  };
  f.hooks.spawn = ({ start, handle, settle }) => queueMicrotask(async () => {
    await start(41);
    handle.pid = 987;
    settle(0, true);
  });
  f.hooks.signal = (code, settle, clearGroup) => { if (code === "SIGKILL") clearGroup(); };
  let finished = false;
  const pending = f.result().then(result => { finished = true; return result; });
  await until(() => finished || signals.length > 0);
  if (!finished) await f.advance(1100);
  const result = await pending;
  assert.equal(result.status, "FAILED");
  assert.equal(result.cleanup, "SETTLED");
  assert.deepEqual(signals, [[41, "SIGTERM"], [41, "SIGKILL"]]);
  assert.ok(probes.length > 0 && probes.every(pid => pid === 41));
});

test("nested manifest accessors are rejected without evaluating them or launching a child", async () => {
  const f = fixture();
  Object.defineProperty(f.manifest.env, "LANG", {
    enumerable: true,
    get() { f.calls.push(["getter"]); return "C"; },
  });
  const result = await f.result();
  assert.equal(result.code, "SDK205_MANIFEST");
  assert.equal(result.cleanup, "NOT_STARTED");
  assert.deepEqual(f.calls, []);
});

test("a getter-backed mkdir option cannot execute or authorize an output operation", async () => {
  const f = fixture();
  f.hooks.generator = async api => {
    const options = { get recursive() { f.calls.push(["getter"]); return true; } };
    try { await api.fs.promises.mkdir(outputDirectory, options); } catch {}
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_WRITE_DENIED");
  assert.deepEqual(f.calls.filter(([api]) => api === "getter"), []);
  noWrites(f);
});

test("a getter-backed fork option cannot execute or launch the generator", async () => {
  const f = fixture();
  f.hooks.cli = async api => {
    const options = forkOptions();
    const stdio = options.stdio;
    Object.defineProperty(options, "stdio", { enumerable: true, get() { f.calls.push(["getter"]); return stdio; } });
    try { await api.childProcess.fork(generator, [], options); } catch {}
    return cleanExit();
  };
  const result = await f.result();
  assert.equal(result.code, "SDK205_FORK_DENIED");
  assert.deepEqual(f.calls.filter(([api]) => api === "getter" || api === "fork"), []);
  noWrites(f);
});

test("the declared official cache notification returns one simulated EACCES without a cache call", async () => {
  const f = fixture({ empty: true, cacheDenial: true });
  let observed;
  f.hooks.generator = async api => {
    await f.writeEmptyOutputs(api);
    try { await api.module.load("fs/promises").mkdir(cache, { recursive: true }); }
    catch (error) { observed = { code: error.code, syscall: error.syscall, path: error.path }; }
    return { code: 0, signal: null };
  };
  for (const operation of ["capture", "openRead", "listDirectory", "writeFile", "mkdir"]) {
    const next = f.runtime.files[operation];
    f.runtime.files[operation] = (target, ...args) => {
      assert.ok(target !== cache && !target.startsWith(cache + "/"));
      return next(target, ...args);
    };
  }
  const receipt = await f.result();
  assert.equal(receipt.status, "SIMULATED_GENERATED_UNQUALIFIED", JSON.stringify(receipt));
  assert.deepEqual(observed, { code: "EACCES", syscall: "mkdir", path: cache });
  assert.deepEqual(receipt.events.filter(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES")
    .map(event => [event.decision, event.process, event.api, event.path]), [["DECLARED_DENIAL", 42, "fs.promises.mkdir", cache]]);
  assert.equal(receipt.outputManifest.length, 11);
  assert.equal(receipt.cleanup, "SETTLED");
  assert.equal(f.calls.some(([event]) => ["write", "mkdir", "terminate"].includes(event)), false);
});

for (const [name, update] of [
  ["no direct frame", () => undefined],
  ["wrong source hash", call => ({ ...call, fileSha256: "a".repeat(64) })],
  ["another launch", call => ({ ...call, launchNonce: "b".repeat(64) })],
  ["wrong process", call => ({ ...call, pid: 41 })],
  ["wrong column", call => ({ ...call, column: 40 })],
  ["an eval frame", call => ({ ...call, eval: true })],
  ["a different import", call => ({ ...call, api: "node:fs/promises.mkdir" })]
]) {
  test(`the declared cache denial rejects ${name}`, async () => {
    const f = fixture({ empty: true, cacheDenial: true });
    f.hooks.cacheCall = update;
    f.hooks.generator = async api => {
      await f.writeEmptyOutputs(api);
      try { await api.module.load("fs/promises").mkdir(cache, { recursive: true }); } catch {}
      return cleanExit();
    };
    const receipt = await f.result();
    assert.equal(receipt.code, "SDK205_CACHE_CALL_IDENTITY");
    assert.equal(receipt.cleanup, "SETTLED");
    assert.equal(receipt.events.some(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES"), false);
    noWrites(f);
  });
}

for (const [name, request, early, declared] of [
  ["premature", api => api.fs.promises.mkdir(cache, { recursive: true }), true, 0],
  ["detached receiver", api => (0, api.fs.promises.mkdir)(cache, { recursive: true }), false, 0],
  ["extra arguments", api => api.fs.promises.mkdir(cache, { recursive: true }, "extra"), false, 0],
  ["extra options", api => api.fs.promises.mkdir(cache, { recursive: true, mode: 511 }), false, 0],
  ["different path", api => api.fs.promises.mkdir(cache + "/other", { recursive: true }), false, 0],
  ["last-generate write", api => api.fs.promises.writeFile(cache + "/last-generate", "timestamp"), false, 0],
  ["repeat", async api => {
    await assert.rejects(api.fs.promises.mkdir(cache, { recursive: true }), { code: "EACCES" });
    await api.fs.promises.mkdir(cache, { recursive: true });
  }, false, 1]
]) {
  test(`the declared cache denial still terminates on ${name}`, async () => {
    const f = fixture({ empty: true, cacheDenial: true });
    f.hooks.generator = async api => {
      if (!early) await f.writeEmptyOutputs(api);
      try { await request(api); } catch {}
      return cleanExit();
    };
    const receipt = await f.result();
    assert.equal(receipt.code, "SDK205_WRITE_DENIED");
    assert.equal(receipt.cleanup, "SETTLED");
    assert.equal(receipt.events.filter(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES").length, declared);
    noWrites(f);
  });
}

test("declared cache denial cannot be requested by the parent CLI", async () => {
  const f = fixture({ empty: true, cacheDenial: true });
  f.hooks.cli = async api => {
    try { await api.fs.promises.mkdir(cache, { recursive: true }); } catch {}
    return cleanExit();
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.equal(f.calls.some(([event]) => event === "fork"), false);
  noWrites(f);
});

test("an enabled cache denial without a matching request cannot report generation success", async () => {
  const f = fixture({ empty: true, cacheDenial: true });
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_CACHE_DENIAL_NOT_OBSERVED");
  assert.equal(receipt.cleanup, "SETTLED");
  noWrites(f);
});

test("the cache denial audit event must be acknowledged and read back intact", async () => {
  for (const lost of ["append", "read"]) {
    const f = fixture({ empty: true, cacheDenial: true });
    f.hooks.generator = async api => {
      await f.writeEmptyOutputs(api);
      try { await api.fs.promises.mkdir(cache, { recursive: true }); } catch {}
      return cleanExit();
    };
    if (lost === "append") {
      f.hooks.event = event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES" ? null
        : { sequence: event.sequence, manifestSha: event.manifestSha };
    } else {
      const read = f.runtime.events.read;
      f.runtime.events.read = () => read().filter(event => event.code !== "SDK205_CACHE_NOTIFICATION_EACCES");
    }
    const receipt = await f.result();
    assert.equal(receipt.code, lost === "append" ? "SDK205_EVENT_NOT_RECORDED" : "SDK205_EVENT_STREAM");
    assert.equal(receipt.cleanup, "SETTLED");
    noWrites(f);
  }
});

test("an observer re-entering the declared cache denial cannot record an EACCES or bypass termination", async () => {
  const f = fixture({ empty: true, cacheDenial: true });
  let nested;
  f.hooks.generator = async api => {
    await f.writeEmptyOutputs(api);
    f.hooks.cacheCall = witness => {
      delete f.hooks.cacheCall;
      nested = api.fs.promises.mkdir(cache, { recursive: true }).catch(error => error.code);
      return witness;
    };
    try { await api.fs.promises.mkdir(cache, { recursive: true }); } catch {}
    return cleanExit();
  };
  const receipt = await f.result();
  assert.equal(await nested, "SDK205_WRITE_DENIED");
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.equal(receipt.events.some(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES"), false);
  noWrites(f);
});

test("cache denial profile rejects an invalid mode or incomplete witness boundary before spawn", async () => {
  const invalid = fixture({ empty: true, cacheDenial: true });
  invalid.manifest.cacheDenial = "real-cache-eacces";
  const missing = fixture({ empty: true, cacheDenial: true });
  delete missing.runtime.process.observeCacheCall;
  for (const [f, code] of [[invalid, "SDK205_CACHE_DENIAL_PROFILE"], [missing, "SDK205_RUNTIME_BOUNDARY"]]) {
    const receipt = await f.result();
    assert.equal(receipt.code, code);
    assert.equal(receipt.cleanup, "NOT_STARTED");
    assert.deepEqual(f.calls, []);
  }
});

test("a declared EACCES with a surviving process group cannot report success", async () => {
  const f = fixture({ empty: true, cacheDenial: true });
  f.hooks.generator = async api => {
    await f.writeEmptyOutputs(api);
    await assert.rejects(api.fs.promises.mkdir(cache, { recursive: true }), { code: "EACCES" });
    return cleanExit();
  };
  f.hooks.spawn = ({ start, settle }) => queueMicrotask(async () => { await start(41); settle(0, true); });
  const run = f.result();
  await until(() => f.calls.some(([api]) => api === "group signal"));
  await f.advance(5100);
  const receipt = await run;
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.code, "TASK16_MIGRATE_PROCESS_REMAINS");
  assert.equal(receipt.cleanup, "UNCONFIRMED");
  assert.equal(receipt.events.filter(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES").length, 1);
  noWrites(f);
});

function inertV8Caller(t) {
  const root = fs.mkdtempSync("/private/tmp/jg-task16-v8-caller-");
  const filename = path.join(root, "self-authored.cjs");
  t.after(() => { delete require.cache[filename]; fs.rmSync(root, { recursive: true }); });
  const prefix = '"use strict";\nexports.direct = async function (import_promises, prismaCache) {\n';
  fs.writeFileSync(filename, prefix + "\n".repeat(10048) +
    "    await import_promises.default.mkdir(prismaCache, { recursive: true });\n};\n" +
    'exports.wrapped = (api, target) => api.mkdir(target, { recursive: true });\n' +
    'exports.evalCaller = (api, target) => eval("api.mkdir(target, { recursive: true })");\n');
  return { filename, calls: require(filename) };
}

test("a first V8 direct frame qualifies the declared EACCES through the existing SDK guard", async t => {
  const { createTask16Sdk205V8Observer } = require("./task16-sdk205-v8-observer.cjs");
  const { filename, calls } = inertV8Caller(t);
  const f = fixture({ empty: true, cacheDenial: true });
  const observe = createTask16Sdk205V8Observer({ filename, line: 10051, column: 35 });
  let observed;
  f.hooks.generator = async api => {
    await f.writeEmptyOutputs(api);
    const promises = api.module.load("fs/promises");
    f.hooks.cacheCall = witness => {
      observed = observe(promises.mkdir);
      // Test-only correspondence: the declared authority stays synthetic.
      return observed && { ...witness, line: observed.line, column: observed.column };
    };
    await assert.rejects(calls.direct({ default: promises }, cache), { code: "EACCES" });
    return cleanExit();
  };
  const receipt = await f.result();
  assert.deepEqual(observed, { filename, line: 10051, column: 35 });
  assert.equal(receipt.status, "SIMULATED_GENERATED_UNQUALIFIED", JSON.stringify(receipt));
  assert.equal(receipt.events.filter(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES").length, 1);
  assert.equal(receipt.cleanup, "SETTLED");
  noWrites(f);
});

for (const [name, invoke, failureCode] of [
  ["a wrapper", (calls, promises) => calls.wrapped(promises, cache), "SDK205_CACHE_CALL_IDENTITY"],
  ["an eval source", (calls, promises) => calls.evalCaller(promises, cache), "SDK205_CACHE_CALL_IDENTITY"],
  ["a false receiver", (calls, promises) => calls.direct({ default: { mkdir: promises.mkdir } }, cache), "SDK205_WRITE_DENIED"]
]) {
  test(`the V8 witness guard refuses ${name} with zero underlying cache calls`, async t => {
    const { createTask16Sdk205V8Observer } = require("./task16-sdk205-v8-observer.cjs");
    const { filename, calls } = inertV8Caller(t);
    const observe = createTask16Sdk205V8Observer({ filename, line: 10051, column: 35 });
    const f = fixture({ empty: true, cacheDenial: true });
    f.hooks.generator = async api => {
      await f.writeEmptyOutputs(api);
      const promises = api.module.load("fs/promises");
      f.hooks.cacheCall = witness => {
        const frame = observe(promises.mkdir);
        return frame && { ...witness, line: frame.line, column: frame.column };
      };
      await assert.rejects(invoke(calls, promises), { code: failureCode });
      return cleanExit();
    };
    const receipt = await f.result();
    assert.equal(receipt.code, failureCode);
    assert.equal(receipt.cleanup, "SETTLED");
    assert.equal(receipt.events.some(event => event.code === "SDK205_CACHE_NOTIFICATION_EACCES"), false);
    noWrites(f);
  });
}

test("V8 frame capture will not invoke an accessor replacing its formatter", async t => {
  const { createTask16Sdk205V8Observer } = require("./task16-sdk205-v8-observer.cjs");
  const { filename, calls } = inertV8Caller(t);
  const observe = createTask16Sdk205V8Observer({ filename, line: 10051, column: 35 });
  const before = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
  let accessed = 0, result;
  const mkdir = () => { result = observe(mkdir); };
  Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get() { accessed++; throw Error("unexpected"); } });
  try { await calls.direct({ default: { mkdir } }, cache); }
  finally {
    if (before) Object.defineProperty(Error, "prepareStackTrace", before);
    else delete Error.prepareStackTrace;
  }
  assert.equal(result, null);
  assert.equal(accessed, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Error, "prepareStackTrace"), before);
});

test("array prototype mutation cannot turn a wrapper into the exact V8 frame", t => {
  const { createTask16Sdk205V8Observer } = require("./task16-sdk205-v8-observer.cjs");
  const { filename, calls } = inertV8Caller(t);
  const observe = createTask16Sdk205V8Observer({ filename, line: 10051, column: 35 });
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map");
  let result;
  const mkdir = () => { result = observe(mkdir); };
  Object.defineProperty(Array.prototype, "map", { ...descriptor,
    value: () => [filename, filename, 10051, 35, false, false] });
  try { calls.wrapped({ mkdir }, cache); }
  finally { Object.defineProperty(Array.prototype, "map", descriptor); }
  assert.equal(result, null);
});

test("a pinned V8 CallSite method cannot be replaced before a valid direct observation", async t => {
  const { createTask16Sdk205V8Observer } = require("./task16-sdk205-v8-observer.cjs");
  const { filename, calls } = inertV8Caller(t);
  const observe = createTask16Sdk205V8Observer({ filename, line: 10051, column: 35 });
  const before = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
  let prototype;
  try {
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, value: (_, frames) => frames[0] });
    const holder = {};
    Error.captureStackTrace(holder);
    prototype = Object.getPrototypeOf(holder.stack);
  } finally {
    if (before) Object.defineProperty(Error, "prepareStackTrace", before);
    else delete Error.prepareStackTrace;
  }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "getLineNumber");
  let callsToSubstitute = 0, result;
  const mkdir = () => { result = observe(mkdir); };
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.writable, false);
  assert.throws(() => Object.defineProperty(prototype, "getLineNumber",
    { ...descriptor, value: () => { callsToSubstitute++; return 10051; } }), TypeError);
  await calls.direct({ default: { mkdir } }, cache);
  assert.deepEqual(result, { filename, line: 10051, column: 35 });
  assert.equal(callsToSubstitute, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Error, "prepareStackTrace"), before);
});
