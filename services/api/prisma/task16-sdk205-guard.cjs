"use strict";

// This boundary requires a complete injected runtime. It installs no Node
// hooks and supplies no operational CLI, filesystem, or process adapter.
const { createHash, generateKeyPairSync, randomBytes, sign, verify } = require("node:crypto");
const path = require("node:path").posix;
const { isDeepStrictEqual: equal, types: { isProxy } } = require("node:util");
const { runTask16BoundedCommand } = require("./task16-bounded-command.cjs");

const SOURCE_SET = "f7a0bd9f4f51adcd74b28894f87ab0e2e76a0f196aaa6aaf6bc6e680c1ded1b7";
const HISTORY = "db017c06bff3d0e7ca7aa88022f83cb53f726eaf49f445966cc0cd68ecae88bd";
const SCHEMA = "services/api/prisma/schema.prisma";
const MIGRATIONS = "services/api/prisma/migrations/";
const MIGRATION205 = MIGRATIONS + "20261109100000_contract_direct_pending_input_v1/migration.sql";
const LOCK = MIGRATIONS + "migration_lock.toml";
const SOURCE_PINS = {
  [SCHEMA]: "68b76ddd1ca8dda27ebb511db2d5fa49285eab5c7b95e83f9cac20b3c26a7286",
  [MIGRATION205]: "81b419f9a59fb3ab6d38731af0c1591bce5f92d91568aa55a8798d8a05d812c5",
  "services/api/src/contract/contract-direct-pending-recipe.ts": "c710a45922b445a91fa3cebb0e814c6b3a0c4124dca8cfb339bd154b72be04be",
  "pnpm-lock.yaml": "69f6656b5b25db8f79e3c9714d8c163d1b84c76750029b1cdf662682526fc3f9"
};
const OUTPUTS = ["default.d.ts", "default.js", "edge.d.ts", "edge.js", "index-browser.js", "index.d.ts", "index.js", "package.json", "schema.prisma", "wasm.d.ts", "wasm.js"];
const CLIENT_STORE = "node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules";
const PHYSICAL_OUTPUT = CLIENT_STORE + "/.prisma/client";
const OFFICIAL_CLI = "node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js";
const OFFICIAL_GENERATOR = CLIENT_STORE + "/@prisma/client/generator-build/index.js";
const OFFICIAL_TOOLS = {
  [OFFICIAL_CLI]: "ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388",
  [OFFICIAL_GENERATOR]: "1697ccccd6b9ef9bfe00277ab8347d656080854d12680568940546e1ef4602ee"
};
const SIMULATED_CACHE_DENIAL = "simulated-prisma-cache-eacces-v1";
const SIMULATED_CACHE_PATH = "/Users/simulated-owner/Library/Caches/prisma-nodejs";
const MEMBER = ["path", "realpath", "sha256", "size", "mode", "dev", "ino", "mtimeNs", "ctimeNs", "nlink"];
const RUNTIME = {
  files: ["capture", "openRead", "listDirectory", "writeFile", "mkdir"],
  modules: ["resolve", "load"],
  process: ["inspect", "runEntry", "fork", "terminate"],
  clock: ["now"],
  events: ["append", "read"],
  boundary: ["spawn", "groupSignal", "groupExists", "setTimer", "clearTimer"]
};
const EXACT_ENV = { LANG: "C", TZ: "UTC", NODE_PATH: "", CHECKPOINT_DISABLE: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1" };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fault(code); };
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const canonical = value => typeof value === "string" && path.isAbsolute(value) &&
  value !== "/" && !value.endsWith("/") && !value.includes("\\") && !value.includes("\0") && path.normalize(value) === value;
const under = (root, target) => canonical(target) && target.startsWith(root + "/");
const inRange = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hasOwnManifestField = (value, key) => value !== null && typeof value === "object" &&
  !isProxy(value) && Object.hasOwn(value, key);

function exact(value, keys) {
  return value !== null && typeof value === "object" && !isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property?.enumerable && Object.hasOwn(property, "value");
    });
}

function plainManifestData(value, depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || Number.isFinite(value)) return true;
  if (typeof value !== "object" || isProxy(value) || depth > 6) return false;
  const keys = Reflect.ownKeys(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > 1000 || keys.length !== value.length + 1 ||
      !keys.slice(0, -1).every((key, index) => key === String(index))) return false;
    keys.pop(); // Array length is an own data property, not a manifest member.
  } else if (![Object.prototype, null].includes(prototype) || keys.length > 30) {
    return false;
  }
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor.enumerable && Object.hasOwn(descriptor, "value") &&
      plainManifestData(descriptor.value, depth + 1);
  });
}

function capabilities(runtime, empty, cacheDenial) {
  need(exact(runtime, Object.keys(RUNTIME)), "SDK205_RUNTIME_BOUNDARY");
  return Object.freeze(Object.fromEntries(Object.entries(RUNTIME).map(([group, baseKeys]) => {
    let keys = baseKeys;
    if (group === "files" && empty) keys = [...keys, "observeOutput", "openExclusive"];
    if (group === "process" && cacheDenial) keys = [...keys, "observeCacheCall"];
    const api = runtime[group];
    need(exact(api, keys) && keys.every(key => typeof api[key] === "function"), "SDK205_RUNTIME_BOUNDARY");
    return [group, Object.freeze({ ...api })];
  })));
}

function member(row, mode) {
  return exact(row, MEMBER) && canonical(row.path) && row.realpath === row.path &&
    digest(row.sha256) && inRange(row.size, 0, 128 * 1024 * 1024) &&
    row.mode === mode && row.nlink === 1 &&
    ["dev", "ino", "mtimeNs", "ctimeNs"].every(key => typeof row[key] === "string" && /^\d+$/u.test(row[key]));
}

function ownedDirectory(row, expectedPath) {
  return exact(row, ["path", "realpath", "dev", "ino", "mode"]) &&
    row.path === expectedPath && row.realpath === expectedPath && row.mode === "040700" &&
    [row.dev, row.ino].every(value => typeof value === "string" && /^[1-9]\d*$/u.test(value));
}

function synchronous(result) {
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw fault("SDK205_ASYNC_ADAPTER");
  }
  return result;
}

function validateManifest(input) {
  const empty = hasOwnManifestField(input, "emptyOutput");
  const cacheDenial = hasOwnManifestField(input, "cacheDenial");
  need(exact(input, ["schemaVersion", "purpose", "sourceSetSha", "cwd", "node", "cli", "generator", "guard",
    "auditor", "env", "argv", "immutable", "outputPreimages", "optionalMissing", "timeoutMs", "maxOutputBytes",
    ...(empty ? ["emptyOutput"] : []), ...(cacheDenial ? ["cacheDenial"] : [])]) &&
    plainManifestData(input), "SDK205_MANIFEST");
  const m = structuredClone(input);
  need(m.schemaVersion === 1 && m.purpose === "task16-sdk205-generation-guard" && m.sourceSetSha === SOURCE_SET &&
    under("/private/tmp", m.cwd) && canonical(m.node), "SDK205_MANIFEST");
  const entrypoints = [m.cli, m.generator, m.guard, m.auditor];
  need(entrypoints.every(file => under(m.cwd, file)) && new Set([m.node, ...entrypoints]).size === 5, "SDK205_MANIFEST");
  need(equal(m.env, EXACT_ENV) && equal(m.argv, [m.cli, "generate", "--schema", path.join(m.cwd, SCHEMA), "--no-engine", "--no-hints"]) &&
    inRange(m.timeoutMs, 1, 120000) && inRange(m.maxOutputBytes, 1, 16 * 1024 * 1024), "SDK205_COMMAND");
  need(!cacheDenial || empty && m.cacheDenial === SIMULATED_CACHE_DENIAL, "SDK205_CACHE_DENIAL_PROFILE");
  const directory = path.join(m.cwd, empty ? PHYSICAL_OUTPUT : "node_modules/.prisma/client");
  let priorDirectory = directory;
  if (empty) {
    const scope = m.emptyOutput;
    need(exact(scope, ["root", "parent", "directory", "priorDirectory"]) &&
      ownedDirectory(scope.root, m.cwd) && ownedDirectory(scope.parent, path.dirname(directory)) &&
      ownedDirectory(scope.directory, directory) && under("/private/tmp", scope.priorDirectory) &&
      !under(m.cwd, scope.priorDirectory) && scope.priorDirectory.endsWith("/" + PHYSICAL_OUTPUT) &&
      scope.root.dev === scope.parent.dev && scope.parent.dev === scope.directory.dev &&
      new Set([scope.root.ino, scope.parent.ino, scope.directory.ino]).size === 3,
    "SDK205_EMPTY_OUTPUT_SCOPE");
    priorDirectory = scope.priorDirectory;
    need(m.cli === path.join(m.cwd, OFFICIAL_CLI) && m.generator === path.join(m.cwd, OFFICIAL_GENERATOR), "SDK205_TOOL_MEMBER");
  }
  need(Array.isArray(m.immutable) && inRange(m.immutable.length, 214, 1000) &&
    Array.isArray(m.outputPreimages) && m.outputPreimages.length === OUTPUTS.length &&
    Array.isArray(m.optionalMissing) && inRange(m.optionalMissing.length, 1, 1000), "SDK205_MANIFEST");
  const inputs = new Map();
  for (const row of m.immutable) {
    const executable = row?.path === m.node || (empty && row?.path === m.cli);
    need(member(row, executable ? "100755" : "100644") &&
      (row.path === m.node || under(m.cwd, row.path)) && row.path !== directory &&
      !under(directory, row.path) && !inputs.has(row.path), "SDK205_IMMUTABLE_MEMBER");
    inputs.set(row.path, row);
  }
  need([m.node, ...entrypoints].every(file => inputs.has(file)), "SDK205_TOOL_MEMBER");
  if (empty) for (const [file, hash] of Object.entries(OFFICIAL_TOOLS)) {
    need(inputs.get(path.join(m.cwd, file))?.sha256 === hash, "SDK205_TOOL_MEMBER");
  }
  for (const [file, hash] of Object.entries(SOURCE_PINS)) {
    need(inputs.get(path.join(m.cwd, file))?.sha256 === hash, "SDK205_SOURCE_PIN");
  }
  const migrationPrefix = path.join(m.cwd, MIGRATIONS);
  const migrations = [...inputs.values()].filter(row => row.path.startsWith(migrationPrefix) && row.path.endsWith("/migration.sql"));
  const previous = migrations.filter(row => row.path !== path.join(m.cwd, MIGRATION205)).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const lock = inputs.get(path.join(m.cwd, LOCK));
  need(migrations.length === 205 && lock && sha(JSON.stringify([...previous, lock]
    .map(row => [row.path.slice(m.cwd.length + 1), row.sha256, row.mode]))) === HISTORY, "SDK205_MIGRATION_HISTORY");
  const preimages = new Map();
  for (const [index, row] of m.outputPreimages.entries()) {
    need(member(row, "100644") && row.path === path.join(priorDirectory, OUTPUTS[index]), "SDK205_OUTPUT_PREIMAGE");
    preimages.set(row.path, row);
  }
  need(new Set(m.optionalMissing).size === m.optionalMissing.length &&
    m.optionalMissing.every(file => under(m.cwd, file) && file.endsWith("/node_modules/fsevents/package.json") &&
      !inputs.has(file) && !under(directory, file)), "SDK205_OPTIONAL_MODULE_MANIFEST");
  return { manifest: m, inputs, preimages, directory, priorDirectory, emptyOutput: m.emptyOutput };
}

function capture(context, file, expected) {
  const { files } = context.io;
  const witness = synchronous(files.openRead(file));
  need(exact(witness, ["before", "bytes", "after", "named"]) &&
    member(witness.before, expected?.mode ?? "100644") && witness.before.path === file &&
    equal(witness.before, witness.after) && equal(witness.before, witness.named) &&
    equal(witness.before, files.capture(file)) && (!expected || equal(witness.before, expected)) &&
    Buffer.isBuffer(witness.bytes) && witness.bytes.length === witness.before.size &&
    sha(witness.bytes) === witness.before.sha256, "SDK205_FILE_IDENTITY");
  return { ...witness.before, bytes: Buffer.from(witness.bytes) };
}

function verifyImmutable(context) {
  for (const row of context.inputs.values()) capture(context, row.path, row);
  need(context.manifest.optionalMissing.every(file => context.io.files.capture(file) === null), "SDK205_OPTIONAL_MODULE_PRESENT");
}

function verifyEmptyDirectory(context, { absent, opened } = {}) {
  const scope = context.emptyOutput;
  const known = [scope.root, scope.parent, scope.directory];
  const observed = synchronous(context.io.files.observeOutput(structuredClone(scope)));
  need(exact(observed, ["before", "after", "named", "names"]) && plainManifestData(observed) &&
    equal(observed.before, known) && equal(observed.after, known) && equal(observed.named, known) &&
    known.every(row => {
      const named = synchronous(context.io.files.capture(row.path));
      return plainManifestData(named) && equal(named, row);
    }), "SDK205_EMPTY_OUTPUT_IDENTITY");
  const expected = [...context.writes.keys()].map(file => path.basename(file));
  if (opened) expected.push(path.basename(opened));
  need(Array.isArray(observed.names) && observed.names.every(name => typeof name === "string") &&
    equal([...observed.names].sort(), expected.sort()), "SDK205_OUTPUT_MEMBERSHIP");
  if (absent) need(!observed.names.includes(path.basename(absent)) &&
    synchronous(context.io.files.capture(absent)) === null, "SDK205_EMPTY_OUTPUT_NOT_ABSENT");
}

function verifyOutputs(context, complete) {
  const names = context.io.files.listDirectory(context.priorDirectory);
  need(Array.isArray(names) && equal([...names].sort(), OUTPUTS), "SDK205_OUTPUT_MEMBERSHIP");
  if (complete) need(context.writes.size === OUTPUTS.length, "SDK205_OUTPUT_INCOMPLETE");
  const preserved = [...context.preimages].map(([file, preimage]) => {
    const { bytes, ...row } = capture(context, file, context.writes.get(file) ?? preimage);
    return row;
  });
  if (!context.emptyOutput) return preserved;
  verifyEmptyDirectory(context);
  return OUTPUTS.filter(name => context.writes.has(path.join(context.directory, name))).map(name => {
    const file = path.join(context.directory, name);
    const { bytes, ...row } = capture(context, file, context.writes.get(file));
    return row;
  });
}

function writeExclusiveOutput(context, target, bytes, verifyActor) {
  const { files } = context.io;
  const descriptor = synchronous(files.openExclusive(structuredClone(context.emptyOutput), path.basename(target)));
  const canInspect = descriptor !== null && typeof descriptor === "object" && !isProxy(descriptor);
  const close = canInspect && Object.getOwnPropertyDescriptor(descriptor, "close")?.value;
  need(typeof close === "function", "SDK205_EMPTY_OUTPUT_DESCRIPTOR");
  try {
    const methods = ["capture", "write", "read", "close"];
    need(exact(descriptor, methods) && methods.every(key => typeof descriptor[key] === "function"),
      "SDK205_EMPTY_OUTPUT_DESCRIPTOR");
    const { capture: captureFd, write, read } = descriptor;
    const before = synchronous(captureFd.call(descriptor));
    const namedBefore = synchronous(files.capture(target));
    need(member(before, "100644") && plainManifestData(before) && before.path === target &&
      before.dev === context.emptyOutput.directory.dev && before.size === 0 &&
      before.sha256 === sha("") && plainManifestData(namedBefore) && equal(namedBefore, before) &&
      ![context.emptyOutput.root, context.emptyOutput.parent, context.emptyOutput.directory,
        ...context.preimages.values(), ...context.writes.values()].some(row => row.dev === before.dev && row.ino === before.ino),
    "SDK205_EMPTY_OUTPUT_DESCRIPTOR");
    verifyEmptyDirectory(context, { opened: target });
    verifyActor();
    synchronous(write.call(descriptor, Buffer.from(bytes)));
    const written = synchronous(read.call(descriptor));
    const after = synchronous(captureFd.call(descriptor));
    const namedAfter = synchronous(files.capture(target));
    need(member(after, "100644") && plainManifestData(after) && after.path === target &&
      after.dev === before.dev && after.ino === before.ino && after.size === bytes.length && after.sha256 === sha(bytes) &&
      Buffer.isBuffer(written) && written.equals(bytes) && plainManifestData(namedAfter) && equal(namedAfter, after),
    "SDK205_OUTPUT_CONTENT");
    return { ...after };
  } finally {
    synchronous(close.call(descriptor));
  }
}

function append(context, actor, api, file, decision, code) {
  let at;
  try {
    at = synchronous(context.io.clock.now());
    need(inRange(at, context.lastTime, Number.MAX_SAFE_INTEGER), "SDK205_CLOCK");
  } catch (error) {
    context.eventFailed = true;
    throw error;
  }
  context.lastTime = at;
  const event = Object.freeze({ sequence: context.events.length + 1, manifestSha: context.manifestSha, at,
    process: actor ? actor.pid : null, entry: actor?.entry ?? null, api, path: file, decision, code });
  try {
    const ack = synchronous(context.io.events.append(event));
    need(exact(ack, ["sequence", "manifestSha"]) && ack.sequence === event.sequence &&
      ack.manifestSha === event.manifestSha, "SDK205_EVENT_NOT_RECORDED");
    context.events.push(event);
    return event;
  } catch {
    context.eventFailed = true;
    throw fault("SDK205_EVENT_NOT_RECORDED");
  }
}

function deny(context, actor, api, file, code) {
  if (!context.failure) {
    context.failure = { code, firstEvent: null };
    try {
      if (!context.eventFailed) context.failure.firstEvent = append(context, actor, api, file, "DENY", code);
    } catch {
      context.failure.code = "SDK205_EVENT_NOT_RECORDED";
    }
    try {
      if (actor) synchronous(context.io.process.terminate(actor.pid));
    } finally {
      context.controller.abort();
    }
  }
  throw fault(context.failure.code);
}

function pendingPreload(context, actor) {
  if (actor.preloadEntered) return null;
  if (actor.role === "generator" && context.entered.get("cli")?.preloadEntered) return "SDK205_PRELOAD_CHILD";
  return actor.preloadCleanup ? "SDK205_PRELOAD_ENTRY_REQUIRED" : null;
}

function through(context, actor, api, file, action) {
  if (!context.active || context.failure || actor.closed) throw fault(context.failure?.code ?? "SDK205_PROCESS_CLOSED");
  const target = canonical(file) ? file : null;
  const preload = pendingPreload(context, actor);
  if (preload) return deny(context, actor, api, target, preload);
  try {
    return action(target);
  } catch (error) {
    return deny(context, actor, api, target, typeof error?.code === "string" && error.code.startsWith("SDK205_") ? error.code : "SDK205_IO_FAILURE");
  }
}

function forkShape(m) {
  return { stdio: ["pipe", "inherit", "pipe", "ipc"], env: { ...m.env, PRISMA_GENERATOR_INVOCATION: "true" },
    execArgv: ["--max-old-space-size=8096"] };
}

const dispatches = new WeakMap();
const preloadEntries = new WeakMap();

const preloadGrantBytes = grant => Buffer.from("task16-sdk205-mock-launch-grant:v1\n" + JSON.stringify(grant));

function issuePreloadLaunch(context, actor) {
  if (!context.launchAuthority) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const envelope = Object.freeze({ manifestSha: context.manifestSha, rootPid: context.ownedPid,
      publicKey: publicKey.export({ type: "spki", format: "pem" }) });
    context.launchAuthority = { envelope, runSha: sha(JSON.stringify(envelope)), publicKey, privateKey };
  }
  const authority = context.launchAuthority;
  const { pid, ppid, executable, cwd, env, argv } = actor.identity;
  // The preload observes Node's full argv and separate execArgv, rather than
  // accepting the controller's projection of the entry and argument list.
  const startup = Object.freeze({ pid, ppid, execPath: executable, cwd,
    argv: Object.freeze([executable, ...argv]),
    execArgv: Object.freeze(actor.role === "cli" ? [] : forkShape(context.manifest).execArgv),
    env: Object.freeze({ ...env }) });
  const grant = Object.freeze({ runSha: authority.runSha, manifestSha: context.manifestSha, role: actor.role,
    rootPid: context.ownedPid, pid, ppid, startupSha: sha(JSON.stringify(startup)), nonce: randomBytes(32).toString("hex") });
  return Object.freeze({ manifestSha: context.manifestSha, role: actor.role, rootPid: context.ownedPid, process: startup,
    envelope: authority.envelope, grant, signature: sign(null, preloadGrantBytes(grant), authority.privateKey).toString("base64") });
}

function verifyPreloadLaunch(context, actor, launch) {
  need(plainManifestData(launch) && exact(launch, ["manifestSha", "role", "rootPid", "process", "envelope", "grant", "signature"]),
    "SDK205_PRELOAD_LAUNCH");
  const { envelope, grant, signature, ...startup } = launch;
  const expected = { manifestSha: context.manifestSha, role: actor.role, rootPid: context.ownedPid, process: actor.launch.process };
  need(equal(startup, expected), "SDK205_PRELOAD_LAUNCH");
  need(equal(envelope, context.launchAuthority.envelope), "SDK205_PRELOAD_ENVELOPE");
  need(exact(grant, Object.keys(actor.launch.grant)) && [grant.runSha, grant.manifestSha, grant.startupSha, grant.nonce].every(digest) &&
    ["cli", "generator"].includes(grant.role) && [grant.rootPid, grant.pid, grant.ppid].every(pid => inRange(pid, 1, 2 ** 31 - 1)) &&
    typeof signature === "string" &&
    /^[A-Za-z0-9+/]{86}==$/u.test(signature), "SDK205_PRELOAD_GRANT_SHAPE");
  const signatureBytes = Buffer.from(signature, "base64");
  need(signatureBytes.toString("base64") === signature &&
    verify(null, preloadGrantBytes(grant), context.launchAuthority.publicKey, signatureBytes), "SDK205_PRELOAD_GRANT_SIGNATURE");
  need(equal(grant, actor.launch.grant), "SDK205_PRELOAD_GRANT_IDENTITY");
}

function claimTask16Sdk205PreloadEntry(api) {
  const entry = preloadEntries.get(api);
  need(entry, "SDK205_PRELOAD_ENTRY");
  const { context, actor } = entry;
  const reject = code => deny(context, actor, "preload", actor.entry, code);
  if (entry.claimed) return reject("SDK205_PRELOAD_REPLAY");
  entry.claimed = true;
  return Object.freeze({
    check(manifest, launch, observed) {
      need(context.active && !actor.closed && !context.failure, "SDK205_PRELOAD_ENTRY");
      need(plainManifestData(manifest) && equal(manifest, context.manifest), "SDK205_PRELOAD_MANIFEST");
      verifyPreloadLaunch(context, actor, launch);
      const owned = context.io.process.inspect(actor.pid);
      need(plainManifestData(owned) && equal(owned, actor.identity) &&
        plainManifestData(observed) && equal(observed, actor.launch.process), "SDK205_PRELOAD_PROCESS");
      if (actor.role === "generator") need(context.entered.get("cli")?.preloadEntered === true, "SDK205_PRELOAD_PARENT");
    },
    ownCleanup(restore) { actor.preloadCleanup = restore; },
    enter() { actor.preloadEntered = true; },
    reject
  });
}

function reenter(context, role, pid) {
  if (!context.active || context.failure) return Promise.resolve({ code: 1, signal: null });
  const ticket = Object.freeze({});
  dispatches.set(ticket, { context, role, pid });
  return runSdkGuardedProcess(context.manifest, ticket);
}

function installedApi(context, actor) {
  const { io, inputs, preimages, directory, emptyOutput, manifest: m } = context;
  const blocked = (api, code) => (file) => through(context, actor, api, file, () => { throw fault(code); });
  const verifyActor = () => {
    need(equal(synchronous(io.process.inspect(actor.pid)), actor.identity), "SDK205_PROCESS_IDENTITY");
    verifyImmutable(context);
  };
  const read = (file, ...extra) => through(context, actor, "fs.readFile", file, target => {
    const expected = inputs.get(target);
    need(expected && extra.length === 0, "SDK205_READ_DENIED");
    return capture(context, target, expected).bytes;
  });
  const write = (file, value, ...extra) => through(context, actor, "fs.promises.writeFile", file, target => {
    if (emptyOutput) {
      const name = target && path.basename(target);
      const schema = name === "schema.prisma";
      const expectedArgs = schema ? [{ encoding: "utf-8" }] : [];
      need(actor.role === "generator" && target && path.dirname(target) === directory && OUTPUTS.includes(name) &&
        context.mkdir && !context.writes.has(target) && plainManifestData(extra) && equal(extra, expectedArgs) &&
        (schema ? context.writes.size === OUTPUTS.length - 1 : context.removalProofs.has(target)) &&
        (typeof value === "string" || Buffer.isBuffer(value)), "SDK205_WRITE_DENIED");
      const bytes = Buffer.from(value);
      need(bytes.length <= 128 * 1024 * 1024, "SDK205_WRITE_DENIED");
      verifyActor();
      verifyEmptyDirectory(context, { absent: target });
      append(context, actor, "fs.promises.writeFile", target, "ALLOW", "SDK205_EMPTY_OUTPUT_CREATE");
      context.writes.set(target, writeExclusiveOutput(context, target, bytes, verifyActor));
      verifyEmptyDirectory(context);
      verifyActor();
      return;
    }
    const expected = preimages.get(target);
    need(actor.role === "generator" && expected && !context.writes.has(target) && extra.length === 0 &&
      (typeof value === "string" || Buffer.isBuffer(value)), "SDK205_WRITE_DENIED");
    const bytes = Buffer.from(value);
    need(bytes.length <= 128 * 1024 * 1024, "SDK205_WRITE_DENIED");
    verifyActor();
    capture(context, target, expected);
    append(context, actor, "fs.promises.writeFile", target, "ALLOW", "SDK205_OUTPUT_WRITE");
    synchronous(io.files.writeFile(target, Buffer.from(bytes), { ...expected }));
    const { bytes: written, ...row } = capture(context, target);
    need(row.dev === expected.dev && row.ino === expected.ino && written.equals(bytes), "SDK205_OUTPUT_CONTENT");
    verifyActor();
    context.writes.set(target, row);
  });
  const mkdirExisting = (file, options, callback, ...extra) => through(context, actor, "fs.mkdir", file, target => {
    need(actor.role === "generator" && target === directory && context.outputPackageAbsent && !context.mkdir &&
      typeof callback === "function" && extra.length === 0 && plainManifestData(options) &&
      equal(options, { mode: 511, recursive: true }), "SDK205_WRITE_DENIED");
    verifyActor();
    verifyEmptyDirectory(context);
    context.mkdir = true;
    append(context, actor, "fs.mkdir", target, "ALLOW", "SDK205_EMPTY_OUTPUT_DIRECTORY_HELD");
    callback(null, undefined);
  });
  const rmAbsent = (file, options, ...extra) => through(context, actor, "fs.promises.rm", file, target => {
    const name = target && path.basename(target);
    need(actor.role === "generator" && target && path.dirname(target) === directory && OUTPUTS.includes(name) &&
      name !== "schema.prisma" && context.mkdir && !context.writes.has(target) && !context.removalProofs.has(target) &&
      extra.length === 0 && plainManifestData(options) && equal(options, { recursive: true, force: true }),
    "SDK205_WRITE_DENIED");
    verifyActor();
    verifyEmptyDirectory(context, { absent: target });
    append(context, actor, "fs.promises.rm", target, "ABSENT", "SDK205_EMPTY_REMOVE_ABSENT");
    context.removalProofs.add(target);
  });
  const recordCacheDenial = (receiver, file, options, extra) => through(context, actor, "fs.promises.mkdir", file, target => {
    need(actor.role === "generator" && receiver === promises && !context.cacheDenialState &&
      target === SIMULATED_CACHE_PATH && extra.length === 0 && plainManifestData(options) &&
      equal(options, { recursive: true }) && context.writes.size === OUTPUTS.length, "SDK205_WRITE_DENIED");
    // These coordinates identify only the synthetic witness. The actual V8
    // column and the adapter that captures its direct frame require separate proof.
    const expected = {
      manifestSha: context.manifestSha, launchNonce: actor.launch.grant.nonce, pid: actor.pid, ppid: actor.identity.ppid,
      entry: m.generator, api: "fs/promises.mkdir", fileSha256: OFFICIAL_TOOLS[OFFICIAL_GENERATOR],
      line: 10051, column: 35, direct: true, native: false, eval: false
    };
    context.cacheDenialState = "checking";
    const observed = synchronous(io.process.observeCacheCall());
    need(exact(observed, Object.keys(expected)) && plainManifestData(observed) && equal(observed, expected), "SDK205_CACHE_CALL_IDENTITY");
    verifyActor();
    verifyOutputs(context, true);
    need(!context.failure, "SDK205_WRITE_DENIED");
    append(context, actor, "fs.promises.mkdir", target, "DECLARED_DENIAL", "SDK205_CACHE_NOTIFICATION_EACCES");
    need(!context.failure, "SDK205_WRITE_DENIED");
    context.cacheDenialState = "recorded";
  });
  const mkdir = (file, options, ...extra) => through(context, actor, "fs.promises.mkdir", file, target => {
    need(!emptyOutput && actor.role === "generator" && target === directory && !context.mkdir && extra.length === 0 &&
      plainManifestData(options) && equal(options, { recursive: true }), "SDK205_WRITE_DENIED");
    verifyActor();
    verifyOutputs(context, false);
    context.mkdir = true;
    append(context, actor, "fs.promises.mkdir", target, "ALLOW", "SDK205_OUTPUT_DIRECTORY");
    synchronous(io.files.mkdir(target, { recursive: true }));
    verifyActor();
    verifyOutputs(context, false);
  });
  const absent = Symbol("optional fsevents absent");
  const moduleLoad = (request, ...extra) => {
    const loaded = through(context, actor, "module.load", request, () => {
      need(typeof request === "string" && !request.includes("\0") && extra.length === 0, "SDK205_MODULE_DENIED");
      verifyActor();
      if (emptyOutput && request === path.join(directory, "package.json")) {
        need(actor.role === "generator" && !context.outputPackageAbsent && !context.mkdir, "SDK205_MODULE_DENIED");
        verifyEmptyDirectory(context, { absent: request });
        append(context, actor, "module.load", request, "ABSENT", "SDK205_EMPTY_OUTPUT_PACKAGE_ABSENT");
        context.outputPackageAbsent = true;
        return absent;
      }
      if (["fs", "node:fs"].includes(request)) return api.fs;
      if (["fs/promises", "node:fs/promises"].includes(request)) return api.fs.promises;
      if (["child_process", "node:child_process"].includes(request)) return api.childProcess;
      const target = synchronous(io.modules.resolve(request, actor.entry));
      if (request === "fsevents") {
        need(actor.role === "cli" && target === null && !context.optionalObserved, "SDK205_MODULE_DENIED");
        context.optionalObserved = true;
        append(context, actor, "module.load", null, "ABSENT", "OPTIONAL_MODULE_ABSENT");
        return absent;
      }
      need(canonical(target) && inputs.has(target) && ![m.node, m.cli, m.generator, m.guard, m.auditor].includes(target) &&
        !target.split("/").includes("fsevents") && /\.(?:cjs|js|json)$/u.test(target), "SDK205_MODULE_DENIED");
      append(context, actor, "module.load", target, "ALLOW", "SDK205_MODULE_MEMBER");
      const result = synchronous(io.modules.load(target, actor.entry));
      verifyActor();
      return result;
    });
    if (loaded === absent) throw fault("MODULE_NOT_FOUND");
    return loaded;
  };
  const fork = (file, args, options, ...extra) => through(context, actor, "child_process.fork", file, target => {
    need(actor.role === "cli" && context.forkCount === 0 && target === m.generator && extra.length === 0 &&
      plainManifestData(args) && plainManifestData(options) && equal(args, []) && equal(options, forkShape(m)), "SDK205_FORK_DENIED");
    verifyActor();
    context.forkCount++;
    append(context, actor, "child_process.fork", target, "ALLOW", "SDK205_GENERATOR_FORK");
    const start = pid => reenter(context, "generator", pid);
    const pending = io.process.fork(target, [], forkShape(m), start);
    need(pending && typeof pending.then === "function", "SDK205_FORK_RESULT");
    const completion = Promise.resolve(pending).then(result => {
      if (!context.active || context.failure) return result;
      try {
        need(exact(result, ["code", "signal"]) && result.code === 0 && result.signal === null, "SDK205_FORK_RESULT");
        verifyActor();
        context.forkSettled = true;
        return result;
      } catch (error) {
        return deny(context, actor, "child_process.fork", target, error.code ?? "SDK205_FORK_FAILED");
      }
    }, () => {
      if (context.active && !context.failure) return deny(context, actor, "child_process.fork", target, "SDK205_FORK_FAILED");
    });
    completion.catch(() => {});
    return completion;
  });
  const guarded = (surface, name, code) => new Proxy(Object.freeze(surface), {
    get(target, key) {
      if (!Object.hasOwn(target, key)) {
        return blocked(name + "." + (typeof key === "string" ? key : "unknown"), code)();
      }
      return target[key];
    }
  });
  const promises = guarded({ readFile: async (...args) => read(...args),
    async mkdir(file, options, ...extra) {
      if (!m.cacheDenial || file !== SIMULATED_CACHE_PATH) return mkdir(file, options, ...extra);
      recordCacheDenial(this, file, options, extra);
      throw Object.assign(fault("EACCES"), { syscall: "mkdir", path: file });
    },
    writeFile: async (...args) => write(...args),
    ...(emptyOutput ? { rm: async (...args) => rmAbsent(...args) } : {}),
    open: async file => blocked("fs.promises.open", "SDK205_WRITE_DENIED")(file),
    appendFile: async file => blocked("fs.promises.appendFile", "SDK205_WRITE_DENIED")(file),
    rename: async file => blocked("fs.promises.rename", "SDK205_WRITE_DENIED")(file),
    unlink: async file => blocked("fs.promises.unlink", "SDK205_WRITE_DENIED")(file) }, "fs.promises", "SDK205_WRITE_DENIED");
  const denied = (names, group, code) => Object.fromEntries(names.map(name => [name, blocked(group + "." + name, code)]));
  const api = Object.freeze({
    fs: guarded({ promises, readFileSync: read, ...denied(["writeFile", "writeFileSync", "mkdir", "mkdirSync", "open",
      "openSync", "appendFile", "appendFileSync", "rename", "renameSync", "unlink", "unlinkSync", "createWriteStream"], "fs", "SDK205_WRITE_DENIED"),
      ...(emptyOutput ? { mkdir: mkdirExisting } : {}) }, "fs", "SDK205_WRITE_DENIED"),
    module: guarded({ load: moduleLoad }, "module", "SDK205_MODULE_DENIED"),
    process: guarded(denied(["dlopen", "binding", "_linkedBinding"], "process", "SDK205_NATIVE_DENIED"), "process", "SDK205_NATIVE_DENIED"),
    childProcess: guarded({ fork, ...denied(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "Worker"], "child_process", "SDK205_CHILD_DENIED") }, "child_process", "SDK205_CHILD_DENIED"),
    network: guarded(denied(["connect", "request", "lookup", "fetch"], "network", "SDK205_NETWORK_DENIED"), "network", "SDK205_NETWORK_DENIED")
  });
  return api;
}

async function runProcess(context, role, pid) {
  const m = context.manifest;
  const actor = { pid, role, entry: role === "cli" ? m.cli : m.generator };
  let api;
  try {
    need(context.active && !context.failure && !context.entered.has(role) && inRange(pid, 1, 2 ** 31 - 1), "SDK205_PROCESS_REENTRY");
    need(role === "cli" ? pid === context.ownedPid : context.forkCount === 1 && pid !== context.ownedPid, "SDK205_PROCESS_REENTRY");
    const identity = synchronous(context.io.process.inspect(pid));
    const env = role === "cli" ? m.env : forkShape(m).env;
    const argv = role === "cli" ? m.argv : [m.generator];
    need(exact(identity, ["pid", "ppid", "entry", "executable", "cwd", "env", "argv"]) && plainManifestData(identity) &&
      identity.pid === pid && inRange(identity.ppid, 1, 2 ** 31 - 1) &&
      (role === "cli" || identity.ppid === context.ownedPid) && identity.entry === actor.entry &&
      identity.executable === m.node && identity.cwd === m.cwd && equal(identity.env, env) && equal(identity.argv, argv), "SDK205_PROCESS_IDENTITY");
    actor.identity = structuredClone(identity);
    context.entered.set(role, actor);
    verifyImmutable(context);
    append(context, actor, "entry", actor.entry, "ALLOW", "SDK205_GUARDED_ENTRY");
    api = installedApi(context, actor);
    actor.launch = issuePreloadLaunch(context, actor);
    preloadEntries.set(api, { context, actor });
    const exit = await context.io.process.runEntry(structuredClone(identity), api, actor.launch);
    if (actor.preloadCleanup) need(actor.preloadCleanup(), "SDK205_PRELOAD_CLEANUP_UNCONFIRMED");
    const preload = pendingPreload(context, actor);
    need(!preload, preload);
    need(!context.failure && exact(exit, ["code", "signal"]) && exit.code === 0 && exit.signal === null, "SDK205_PROCESS_EXIT");
    need(equal(synchronous(context.io.process.inspect(pid)), actor.identity), "SDK205_PROCESS_IDENTITY");
    verifyImmutable(context);
    append(context, actor, "exit", actor.entry, "OBSERVED", "SDK205_GUARDED_EXIT");
    context.completed.add(role);
    return { code: 0, signal: null };
  } catch (error) {
    try {
      if (actor.preloadCleanup && !actor.preloadCleanup()) deny(context, actor, "preload", actor.entry, "SDK205_PRELOAD_CLEANUP_UNCONFIRMED");
      deny(context, context.entered.get(role) === actor ? actor : null, "entry", actor.entry,
        typeof error?.code === "string" && error.code.startsWith("SDK205_") ? error.code : "SDK205_PROCESS_EXIT");
    } catch {
      return { code: 1, signal: null };
    }
  } finally {
    if (api) preloadEntries.delete(api);
    actor.closed = true;
  }
}

async function runSdkGuardedProcess(manifest, runtime) {
  const dispatch = dispatches.get(runtime);
  if (dispatch) {
    dispatches.delete(runtime);
    return runProcess(dispatch.context, dispatch.role, dispatch.pid);
  }
  let context;
  let started = false;
  let settled = false;
  let exit = null;
  try {
    const io = capabilities(runtime, hasOwnManifestField(manifest, "emptyOutput"), hasOwnManifestField(manifest, "cacheDenial"));
    const plan = validateManifest(manifest);
    context = { ...plan, io, controller: new AbortController(), manifestSha: sha(JSON.stringify(plan.manifest)),
      entered: new Map(), completed: new Set(), events: [], lastTime: 0, writes: new Map(), active: true,
      forkCount: 0, removalProofs: new Set() };
    verifyImmutable(context);
    verifyOutputs(context, false);
    const m = plan.manifest;
    exit = await runTask16BoundedCommand(m.node, [...m.argv], { signal: context.controller.signal, cwd: m.cwd,
      env: { ...m.env }, timeoutMs: m.timeoutMs, maxOutputBytes: m.maxOutputBytes }, {
      ...io.boundary,
      spawn(executable, args, options) {
        started = true;
        const child = io.boundary.spawn(executable, args, options, pid => reenter(context, "cli", pid));
        context.ownedPid = child.pid;
        const once = child.once.bind(child);
        once("close", () => {
          context.rootClosed = true;
          context.handleDrift = child.pid !== context.ownedPid;
        });
        return Object.freeze({ pid: context.ownedPid, stdout: child.stdout, stderr: child.stderr, once,
          unref: typeof child.unref === "function" ? child.unref.bind(child) : undefined });
      }
    });
    settled = exit.actualSettled === true;
    need(!context.handleDrift, "SDK205_PROCESS_HANDLE");
    need(settled && exit.code === 0 && !context.failure, "SDK205_PROCESS_EXIT");
    need(context.forkCount === 1 && context.forkSettled && context.completed.has("cli") && context.completed.has("generator"), "SDK205_GENERATOR_NOT_OBSERVED");
    need(!m.cacheDenial || context.cacheDenialState === "recorded", "SDK205_CACHE_DENIAL_NOT_OBSERVED");
    verifyImmutable(context);
    const outputManifest = verifyOutputs(context, true);
    need(equal(synchronous(io.events.read()), context.events), "SDK205_EVENT_STREAM");
    return { status: "SIMULATED_GENERATED_UNQUALIFIED", manifestSha: context.manifestSha, exit: { code: exit.code },
      events: [...context.events], outputManifest, cleanup: "SETTLED" };
  } catch (error) {
    const code = context?.failure?.code ?? error?.code ?? "SDK205_GUARD_FAILED";
    if (!settled && context?.rootClosed) {
      try {
        settled = !inRange(context.ownedPid, 1, 2 ** 31 - 1) ||
          context.io.boundary.groupExists(context.ownedPid) === false;
      } catch { /* Group absence is still unconfirmed. */ }
    }
    return { status: "FAILED", code, firstEvent: context?.failure?.firstEvent ?? null,
      exit: exit ? { code: exit.code } : null, cleanup: !started ? "NOT_STARTED" : settled ? "SETTLED" : "UNCONFIRMED",
      events: context ? [...context.events] : [], evidencePaths: [] };
  } finally {
    if (context) context.active = false;
  }
}

module.exports = { runSdkGuardedProcess, claimTask16Sdk205PreloadEntry };
