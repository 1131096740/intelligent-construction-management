"use strict";

const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign, verify } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runSdkGuardedProcess } = require("./task16-sdk205-guard.cjs");
const { installTask16Sdk205Preload } = require("./task16-sdk205-preload.cjs");

const sha = value => createHash("sha256").update(value).digest("hex");
const cwd = "/private/tmp/sdk205-preload-fake/work";
const node = "/private/tmp/sdk205-preload-fake/node";
const cli = cwd + "/tool/cli.cjs";
const generator = cwd + "/tool/generator.cjs";
const guard = cwd + "/tool/guard.cjs";
const auditor = cwd + "/tool/auditor.cjs";
const schema = "services/api/prisma/schema.prisma";
const outputDirectory = cwd + "/node_modules/.prisma/client";
const names = ["default.d.ts", "default.js", "edge.d.ts", "edge.js", "index-browser.js", "index.d.ts", "index.js", "package.json", "schema.prisma", "wasm.d.ts", "wasm.js"];
const optional = cwd + "/tool/node_modules/fsevents/package.json";
const env = { LANG: "C", TZ: "UTC", NODE_PATH: "", CHECKPOINT_DISABLE: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1" };
const argv = [cli, "generate", "--schema", cwd + "/" + schema, "--no-engine", "--no-hints"];
const forkOptions = () => ({ stdio: ["pipe", "inherit", "pipe", "ipc"], env: { ...env, PRISMA_GENERATOR_INVOCATION: "true" }, execArgv: ["--max-old-space-size=8096"] });
const okExit = () => ({ code: 0, signal: null });

function fixture() {
  const source = path.resolve(__dirname, "../../..");
  const files = new Map(), effects = [], loaders = new Map(), witnesses = new Map(), hooks = {};
  let inode = 0, alive = false;
  function add(file, value, mode = "100644") {
    const bytes = Buffer.from(value);
    const record = { path: file, realpath: file, sha256: sha(bytes), size: bytes.length, mode,
      dev: "1", ino: String(++inode), mtimeNs: "2", ctimeNs: "2", nlink: 1 };
    files.set(file, { record, bytes });
    return { ...record };
  }
  const migrations = "services/api/prisma/migrations";
  const inputs = [schema, "pnpm-lock.yaml", "services/api/src/contract/contract-direct-pending-recipe.ts",
    ...fs.readdirSync(path.join(source, migrations), { withFileTypes: true })
      .filter(row => row.isDirectory()).map(row => migrations + "/" + row.name + "/migration.sql").sort(),
    migrations + "/migration_lock.toml"];
  const immutable = [add(node, "inert Node fixture", "100755"), ...[cli, generator, guard, auditor].map(file => add(file, "inert " + file)),
    ...inputs.map(file => add(cwd + "/" + file, fs.readFileSync(path.join(source, file))))];
  const manifest = { schemaVersion: 1, purpose: "task16-sdk205-generation-guard", sourceSetSha: "f7a0bd9f4f51adcd74b28894f87ab0e2e76a0f196aaa6aaf6bc6e680c1ded1b7",
    cwd, node, cli, generator, guard, auditor, env, argv, immutable,
    outputPreimages: names.map(name => add(outputDirectory + "/" + name, "old " + name)),
    optionalMissing: [optional], timeoutMs: 200, maxOutputBytes: 1024 };
  function identity(pid) {
    return pid === 41 ? { pid, ppid: 1, entry: cli, executable: node, cwd, env: { ...env }, argv: [...argv] }
      : { pid, ppid: 41, entry: generator, executable: node, cwd, env: forkOptions().env, argv: [generator] };
  }
  function observeNodeStartup(pid) {
    const actual = identity(pid);
    return { pid, ppid: actual.ppid, execPath: actual.executable, cwd: actual.cwd,
      argv: [actual.executable, ...actual.argv], execArgv: pid === 41 ? [] : forkOptions().execArgv,
      env: actual.env };
  }
  function makeLoader(role) {
    const raw = () => { effects.push(["raw", role]); throw Error("unwrapped fake API"); };
    const promises = { mkdir: raw, writeFile: raw };
    const disk = { promises, mkdirSync: raw };
    const children = { fork: raw };
    const table = { fs: disk, "node:fs": disk, "fs/promises": promises, "node:fs/promises": promises,
      child_process: children, "node:child_process": children, module: { load: raw }, process: { dlopen: raw }, network: { fetch: raw } };
    const original = Object.getOwnPropertyDescriptors(table);
    const loader = {
      table,
      loaded: () => [],
      replace(key, descriptor) {
        effects.push(["replace", role, key]);
        Object.defineProperty(table, key, descriptor);
      },
      async enter() {
        effects.push(["entry", role]);
        assert.equal(table.fs, table["node:fs"]);
        assert.equal(table.fs.promises, table["fs/promises"]);
        assert.equal(table["fs/promises"], table["node:fs/promises"]);
        if (hooks.entry) return hooks.entry(role, table, defaultEntry);
        return defaultEntry(role, table);
      }
    };
    loaders.set(role, { loader, original });
    return loader;
  }
  async function defaultEntry(role, table) {
    if (role === "cli") await table.child_process.fork(generator, [], forkOptions());
    else {
      await table["fs/promises"].mkdir(outputDirectory, { recursive: true });
      for (const name of names) await table["fs/promises"].writeFile(outputDirectory + "/" + name, "new " + name);
    }
    return okExit();
  }
  const events = [];
  const runtime = {
    files: {
      capture(file) { return files.has(file) ? { ...files.get(file).record } : null; },
      openRead(file) {
        const { record, bytes } = files.get(file);
        return { before: { ...record }, bytes: Buffer.from(bytes), after: { ...record }, named: { ...record } };
      },
      listDirectory() { return [...names]; },
      writeFile(file, bytes, expected) {
        assert.deepEqual(files.get(file).record, expected);
        effects.push(["write", file]);
        files.set(file, { record: { ...expected, sha256: sha(bytes), size: bytes.length, mtimeNs: "3", ctimeNs: "3" }, bytes });
      },
      mkdir(dir) { effects.push(["mkdir", dir]); }
    },
    modules: { resolve: () => null, load: () => { throw Error("no real modules"); } },
    process: {
      inspect: pid => hooks.ownedInspect ? hooks.ownedInspect(pid, identity(pid)) : identity(pid),
      async runEntry(actual, guardedApi, witness) {
        const role = actual.pid === 41 ? "cli" : "generator";
        const loader = makeLoader(role);
        witnesses.set(role, witness);
        const launch = structuredClone(witness);
        const boundary = { guardedApi, readLaunch: () => launch, inspect: () => observeNodeStartup(actual.pid), loader };
        if (hooks.boundary) hooks.boundary(role, boundary, launch);
        if (hooks.bypassRoot && role === "cli") {
          await guardedApi.childProcess.fork(generator, [], forkOptions());
          return okExit();
        }
        if (hooks.bypassChild && role === "generator") {
          try { await guardedApi.fs.promises.writeFile(outputDirectory + "/index.js", "must not write"); } catch {}
          return okExit();
        }
        try {
          const receipt = await installTask16Sdk205Preload(manifest, boundary);
          effects.push(["installed", role, receipt.status]);
          assert.equal(receipt.status, "SIMULATED_PRELOAD_INSTALLED");
          if (hooks.installed) await hooks.installed(role, receipt, boundary);
          if (hooks.abandonRoot && role === "cli") {
            try { await guardedApi.childProcess.fork(generator, [], forkOptions()); } catch {}
            return okExit();
          }
          const exit = await receipt.enter();
          if (hooks.afterEntry) hooks.afterEntry(role, boundary);
          return exit;
        } catch (error) {
          effects.push(["caught", role, error.code]);
          return okExit();
        }
      },
      fork(file, args, options, start) {
        effects.push(["fork", file]);
        return start(42);
      },
      terminate(pid) { effects.push(["terminate", pid]); }
    },
    clock: { now: () => 0 },
    events: { append(event) { events.push({ ...event }); return { sequence: event.sequence, manifestSha: event.manifestSha }; }, read: () => events },
    boundary: {
      spawn(executable, args, options, start) {
        effects.push(["spawn", executable]);
        const handle = new EventEmitter();
        handle.pid = 41; handle.stdout = new EventEmitter(); handle.stderr = new EventEmitter();
        alive = true;
        queueMicrotask(async () => {
          const exit = await start(41);
          alive = false; handle.emit("close", exit.code);
        });
        return handle;
      },
      groupSignal(pid, signal) { effects.push(["signal", pid, signal]); },
      groupExists: () => alive,
      setTimer: () => Symbol(),
      clearTimer() {}
    }
  };
  return { hooks, effects, loaders, witnesses, manifest, result: () => runSdkGuardedProcess(manifest, runtime) };
}

test("both authenticated mock preloads install canonical aliases before entering and restore them after exit", async () => {
  const f = fixture();
  const receipt = await f.result();
  assert.equal(receipt.status, "SIMULATED_GENERATED_UNQUALIFIED", JSON.stringify(receipt));
  assert.deepEqual([...f.witnesses.keys()], ["cli", "generator"]);
  const root = f.witnesses.get("cli"), child = f.witnesses.get("generator");
  assert.deepEqual(root.envelope, child.envelope);
  assert.deepEqual(Object.keys(root.envelope).sort(), ["manifestSha", "publicKey", "rootPid"]);
  assert.equal(root.grant.rootPid, 41);
  assert.equal(child.grant.ppid, 41);
  assert.deepEqual(root.process.argv, [node, ...argv]);
  assert.deepEqual(root.process.execArgv, []);
  assert.deepEqual(child.process.argv, [node, generator]);
  assert.deepEqual(child.process.execArgv, ["--max-old-space-size=8096"]);
  assert.notEqual(root.grant.nonce, child.grant.nonce);
  assert.notEqual(root.signature, child.signature);
  for (const witness of [root, child]) {
    assert.equal(witness.grant.manifestSha, receipt.manifestSha);
    assert.equal(witness.grant.startupSha, sha(JSON.stringify(witness.process)));
    assert.equal(witness.grant.runSha, sha(JSON.stringify(witness.envelope)));
    assert.equal(verify(null, Buffer.from("task16-sdk205-mock-launch-grant:v1\n" + JSON.stringify(witness.grant)),
      witness.envelope.publicKey, Buffer.from(witness.signature, "base64")), true);
  }
  assert.deepEqual(f.effects.filter(([action]) => action === "installed" || action === "entry"), [
    ["installed", "cli", "SIMULATED_PRELOAD_INSTALLED"], ["entry", "cli"],
    ["installed", "generator", "SIMULATED_PRELOAD_INSTALLED"], ["entry", "generator"]
  ]);
  assert.equal(f.effects.filter(([action]) => action === "raw").length, 0);
  assert.equal(f.effects.filter(([action]) => action === "write").length, 11);
  for (const { loader, original } of f.loaders.values()) {
    assert.deepEqual(Object.getOwnPropertyDescriptors(loader.table), original);
  }
});

test("a signature byte change blocks installation even when every launch field is correct", async () => {
  const f = fixture();
  f.hooks.boundary = (role, boundary, launch) => {
    launch.signature = (launch.signature[0] === "A" ? "B" : "A") + launch.signature.slice(1);
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_GRANT_SIGNATURE");
  assert.deepEqual(f.effects.filter(([action]) => ["replace", "entry", "fork", "write"].includes(action)), []);
});

test("a structured value cannot stand in for the fixed-length signed startup digest", async () => {
  const f = fixture();
  f.hooks.boundary = (role, boundary, launch) => {
    launch.grant.startupSha = { digest: launch.grant.startupSha };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_GRANT_SHAPE");
  assert.deepEqual(f.effects.filter(([action]) => ["replace", "entry", "fork", "write"].includes(action)), []);
});

test("a self-consistent signature from a different signing key cannot install a root preload", async () => {
  const f = fixture();
  f.hooks.boundary = (role, boundary, launch) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    launch.envelope.publicKey = publicKey.export({ type: "spki", format: "pem" });
    launch.grant.runSha = sha(JSON.stringify(launch.envelope));
    const bytes = Buffer.from("task16-sdk205-mock-launch-grant:v1\n" + JSON.stringify(launch.grant));
    launch.signature = sign(null, bytes, privateKey).toString("base64");
    assert.equal(verify(null, bytes, launch.envelope.publicKey, Buffer.from(launch.signature, "base64")), true);
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_ENVELOPE");
  assert.deepEqual(f.effects.filter(([action]) => ["replace", "entry", "fork", "write"].includes(action)), []);
});

test("the valid root signature cannot release the generator under the same run key", async () => {
  const f = fixture();
  f.hooks.boundary = (role, boundary, launch) => {
    if (role !== "generator") return;
    const root = f.witnesses.get("cli");
    launch.grant = structuredClone(root.grant);
    launch.signature = root.signature;
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_GRANT_IDENTITY");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry"), [["entry", "cli"]]);
  assert.deepEqual(f.effects.filter(([action, role]) => (action === "replace" && role === "generator") || action === "write"), []);
});

test("a valid root launch from an earlier run cannot release a new run with the same mock PID", async () => {
  const first = fixture();
  assert.equal((await first.result()).status, "SIMULATED_GENERATED_UNQUALIFIED");
  const oldRoot = first.witnesses.get("cli");
  const second = fixture();
  second.hooks.boundary = (role, boundary, launch) => {
    assert.equal(launch.manifestSha, oldRoot.manifestSha);
    assert.deepEqual(launch.process, oldRoot.process);
    boundary.readLaunch = () => oldRoot;
  };
  const receipt = await second.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_ENVELOPE");
  assert.deepEqual(second.effects.filter(([action]) => ["replace", "entry", "fork", "write"].includes(action)), []);
});

for (const [name, targetRole, change] of [
  ["a different Node argv[0]", "cli", observation => { observation.argv[0] += "-alias"; }],
  ["an extra root Node flag", "cli", observation => { observation.execArgv = ["--inspect"]; }],
  ["a missing generator memory flag", "generator", observation => { observation.execArgv = []; }],
  ["an extra generator Node flag", "generator", observation => { observation.execArgv.push("--inspect"); }]
]) {
  test(`a signed launch cannot override ${name} in the observed process`, async () => {
    const f = fixture();
    f.hooks.boundary = (role, boundary) => {
      if (role !== targetRole) return;
      const observe = boundary.inspect;
      boundary.inspect = () => {
        const observation = observe();
        change(observation);
        return observation;
      };
    };
    const receipt = await f.result();
    assert.equal(receipt.code, "SDK205_PRELOAD_PROCESS");
    assert.deepEqual(f.effects.filter(([action]) => action === "entry"),
      targetRole === "cli" ? [] : [["entry", "cli"]]);
    assert.deepEqual(f.effects.filter(([action, role]) =>
      (action === "replace" && role === targetRole) || action === "mkdir" || action === "write"), []);
  });
}

test("an accessor-backed observed execArgv cannot run or install a hook", async () => {
  const f = fixture();
  let reads = 0;
  f.hooks.boundary = (role, boundary) => {
    const observe = boundary.inspect;
    boundary.inspect = () => Object.defineProperty(observe(), "execArgv", {
      enumerable: true, get() { reads++; return []; }
    });
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_PROCESS");
  assert.equal(reads, 0);
  assert.deepEqual(f.effects.filter(([action]) => ["replace", "entry", "fork", "write"].includes(action)), []);
});

for (const [name, change, code] of [
  ["unknown module", loader => { loader.table.unsealed = {}; }, "SDK205_PRELOAD_HOOK_TABLE"],
  ["inherited module table", loader => Object.setPrototypeOf(loader.table, { hidden: true }), "SDK205_PRELOAD_HOOK_TABLE"],
  ["missing capability", loader => { delete loader.replace; }, "SDK205_PRELOAD_BOUNDARY"],
  ["broken fs alias", loader => { loader.table["node:fs"] = {}; }, "SDK205_PRELOAD_ALIAS"],
  ["preloaded tool", loader => { loader.loaded = () => [cli]; }, "SDK205_PRELOAD_LOADED"]
]) {
  test(`an invalid synthetic preload with ${name} cannot enter a tool`, async () => {
    const f = fixture();
    f.hooks.boundary = (role, boundary) => change(boundary.loader);
    const receipt = await f.result();
    assert.equal(receipt.code, code);
    assert.deepEqual(f.effects.filter(([action]) => action === "replace" || action === "entry" || action === "fork"), []);
  });
}

test("an accessor in the hook table is refused without reading it", async () => {
  const f = fixture();
  let reads = 0;
  f.hooks.boundary = (role, boundary) => {
    Object.defineProperty(boundary.loader.table, "fs", { configurable: true, enumerable: true, get() { reads++; } });
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_HOOK_TABLE");
  assert.equal(reads, 0);
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "replace"), []);
});

test("an accessor on a forged startup record is refused without evaluating it", async () => {
  const f = fixture();
  let reads = 0;
  f.hooks.boundary = (role, boundary, launch) => {
    Object.defineProperty(launch, "then", { enumerable: true, get() { reads++; } });
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_LAUNCH");
  assert.equal(reads, 0);
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "replace"), []);
});

test("partial hook installation restores the full original descriptor table and opens no entry", async () => {
  const f = fixture();
  let failed = false;
  f.hooks.boundary = (role, { loader }) => {
    const replace = loader.replace;
    loader.replace = (key, descriptor) => {
      if (key === "module" && !failed) { failed = true; throw Error("synthetic replacement failure"); }
      return replace(key, descriptor);
    };
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_HOOK_INSTALL");
  assert.equal(failed, true);
  assert.ok(f.effects.some(([action]) => action === "replace"));
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "fork"), []);
  const { loader, original } = f.loaders.get("cli");
  assert.deepEqual(Object.getOwnPropertyDescriptors(loader.table), original);
});

test("a self-consistent forged generator launch still fails against the original owned fork", async () => {
  const f = fixture();
  f.hooks.boundary = (role, boundary, launch) => {
    if (role !== "generator") return;
    const forged = { ...launch.process, pid: 43, ppid: 99, argv: [generator, "--extra"],
      env: { ...launch.process.env, NODE_OPTIONS: "synthetic override" } };
    boundary.readLaunch = () => ({ ...launch, rootPid: 99, process: forged });
    boundary.inspect = () => forged;
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_LAUNCH");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry"), [["entry", "cli"]]);
  assert.equal(f.effects.some(([action]) => action === "write"), false);
});

test("startup parameter drift after installation is caught again before the entry barrier", async () => {
  const f = fixture();
  f.hooks.installed = (role, receipt, boundary) => {
    if (role !== "cli") return;
    const observed = boundary.inspect();
    Object.defineProperty(observed.env, "NODE_OPTIONS", { value: "synthetic override", enumerable: true });
    // An already captured function can report a changed observation at the next read.
    Object.assign(f.hooks, { changed: observed });
  };
  f.hooks.boundary = (role, boundary) => {
    const inspect = boundary.inspect;
    boundary.inspect = () => f.hooks.changed ?? inspect();
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_PROCESS");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry"), []);
});

test("the generator cannot preload before its authenticated root has entered", async () => {
  const f = fixture();
  f.hooks.bypassRoot = true;
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_PARENT");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "replace"), []);
});

test("a root that chose preload cannot have its generator bypass that entry barrier", async () => {
  const f = fixture();
  f.hooks.bypassChild = true;
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_CHILD");
  assert.deepEqual(f.effects.filter(([action]) => action === "write" || action === "mkdir"), []);
});

test("cache mkdir through the installed fs/promises alias is sticky despite catch and exit zero", async () => {
  const f = fixture();
  f.hooks.entry = async (role, table, defaultEntry) => {
    if (role === "cli") return defaultEntry(role, table);
    try { await table.module.load("fs/promises").mkdir("/Users/fake/Library/Caches/prisma-nodejs", { recursive: true }); } catch {}
    try { await table["node:fs/promises"].writeFile(outputDirectory + "/index.js", "must not write"); } catch {}
    return okExit();
  };
  const receipt = await f.result();
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.code, "SDK205_WRITE_DENIED");
  assert.equal(receipt.firstEvent.api, "fs.promises.mkdir");
  assert.equal(receipt.cleanup, "SETTLED");
  assert.deepEqual(f.effects.filter(([action]) => action === "raw" || action === "write" || action === "mkdir"), []);
  for (const { loader, original } of f.loaders.values()) assert.deepEqual(Object.getOwnPropertyDescriptors(loader.table), original);
});

test("an installed root cannot abandon its receipt and bypass the entry barrier", async () => {
  const f = fixture();
  f.hooks.abandonRoot = true;
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_ENTRY_REQUIRED");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "fork" || action === "write"), []);
  const { loader, original } = f.loaders.get("cli");
  assert.deepEqual(Object.getOwnPropertyDescriptors(loader.table), original);
});

test("an already restored hook table is read again before the guarded actor settles", async () => {
  const f = fixture();
  f.hooks.afterEntry = (role, boundary) => {
    if (role === "cli") boundary.loader.table.fs = {};
  };
  const receipt = await f.result();
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.code, "SDK205_PRELOAD_CLEANUP_UNCONFIRMED");
});

test("the same guarded process cannot claim a second preload receipt", async () => {
  const f = fixture();
  f.hooks.installed = async (role, receipt, boundary) => {
    try { await installTask16Sdk205Preload(f.manifest, boundary); } catch {}
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_REPLAY");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "fork"), []);
});

test("the fake loader cannot mask drift in the guard-owned process at entry", async () => {
  const f = fixture();
  f.hooks.installed = () => {
    f.hooks.ownedInspect = (pid, identity) => pid === 41 ? { ...identity, ppid: 99 } : identity;
  };
  const receipt = await f.result();
  assert.equal(receipt.code, "SDK205_PRELOAD_PROCESS");
  assert.deepEqual(f.effects.filter(([action]) => action === "entry" || action === "fork" || action === "write"), []);
});

test("ordinary caller objects cannot mint a guarded preload ticket", async () => {
  const f = fixture();
  let called = false;
  await assert.rejects(installTask16Sdk205Preload(f.manifest, {
    guardedApi: {}, readLaunch() { called = true; }, inspect() { called = true; }, loader: {}
  }), { code: "SDK205_PRELOAD_ENTRY" });
  assert.equal(called, false);
  assert.deepEqual(f.effects, []);
});
