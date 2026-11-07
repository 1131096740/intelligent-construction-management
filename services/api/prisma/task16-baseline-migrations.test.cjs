"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-migration-protocol-");
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  const pnpm = path.join(temporary, "pnpm"); fs.writeFileSync(pnpm, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  const ca = path.join(temporary, "ca.crt"); fs.writeFileSync(ca, "synthetic CA bytes only\n", { mode: 0o600 });
  const migrations = fs.readdirSync(path.join(ROOT, "services/api/prisma/migrations")).filter(name => fs.existsSync(path.join(ROOT, "services/api/prisma/migrations", name, "migration.sql"))).sort().map(name => {
    const relative = `services/api/prisma/migrations/${name}/migration.sql`; const bytes = fs.readFileSync(path.join(ROOT, relative));
    return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
  });
  const schemaPath = "services/api/prisma/schema.prisma";
  const source = { candidateSha: "a".repeat(40), candidateRoot: ROOT, sealSha256: "b".repeat(64), migrations,
    schema: { path: schemaPath, bytes: fs.statSync(path.join(ROOT, schemaPath)).size, sha256: hash(fs.readFileSync(path.join(ROOT, schemaPath))) },
    runtimeAdmission: { status: "INPUTS_AND_CODE_TREES_MATCHED" },
    inputs: { tools: { node: { path: fs.realpathSync(process.execPath), sha256: hash(fs.readFileSync(process.execPath)) }, pnpm: { path: pnpm, sha256: hash(fs.readFileSync(pnpm)) } }, docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } } };
  const options = { packetFile: path.join(temporary, "packet.json"), expectedPacketSha256: "c".repeat(64), inputsFile: path.join(temporary, "inputs.json"), expectedInputsSha256: "d".repeat(64), artifactsDir: path.join(temporary, "artifacts") };
  const calls = []; let receipt, resource, password, commandCount = 0;
  const identity = { databaseOid: "16384", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, tls: true, version: 160004, replication: "origin", readOnly: "off" };
  const ledger = migrations.map(row => ({ name: row.path.split("/").at(-2), sha256: row.sha256, finished: true, rolledBack: false }));
  const replies = { preflight: {}, ledger: {} };
  const command = async (executable, args, control) => {
    commandCount++; calls.push("prisma");
    assert.equal(executable, pnpm);
    assert.deepEqual(args, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy", "--schema", path.join(ROOT, schemaPath)]);
    assert.equal(control.cwd, ROOT); assert.equal(control.timeoutMs, 180000); assert.equal(control.maxOutputBytes, 1048576);
    const url = new URL(control.env.DATABASE_URL);
    assert.equal(url.username, "jg_task01_owner"); assert.ok(url.password === password); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "15432");
    assert.equal(url.pathname, `/${receipt.databaseName}`); assert.equal(url.searchParams.get("sslaccept"), "strict"); assert.equal(url.searchParams.get("sslmode"), "require"); assert.equal(url.searchParams.get("sslcert"), ca);
    assert.equal(control.env.NODE_OPTIONS, undefined); assert.equal(control.env.PGDATABASE, undefined);
    return { code: 0, stdout: "synthetic migration output", stderr: "", actualSettled: true };
  };
  const adapters = {
    verifySource: async () => source,
    startResource: async context => {
      password = context.credentials.owner;
      receipt = { ...source.inputs.docker, sourceSha: source.candidateSha, runId: context.runId, containerId: "e".repeat(64), networkId: "f".repeat(64), databaseName: `jg_task01_${context.runId.replaceAll("-", "")}`, port: 15432, status: "started-awaiting-driver-verification", cleanup: { status: "pending" }, tls: { caSha256: hash(fs.readFileSync(ca)) } };
      resource = { containerId: receipt.containerId, networkId: receipt.networkId, databaseName: receipt.databaseName, port: receipt.port, caPath: ca, serverCertHashes: { caSha256: receipt.tls.caSha256 },
        getReceipt: () => structuredClone(receipt),
        execOwnerSql: async (sql, label) => { calls.push(label); return { stdout: JSON.stringify({ ...identity, database: receipt.databaseName, nonce: /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1], ledgerExists: false, publicRelations: 0, ledger, ...(label === "task16-migration-preflight" ? replies.preflight : replies.ledger) }) }; },
        close: async () => { calls.push("close-resource"); receipt.status = "closed"; receipt.cleanup = { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true }; }
      }; return resource;
    },
    verifyOwnerTransport: async () => ({ status: "OWNER_TLS_CONTROLS_VERIFIED", databaseOid: identity.databaseOid, systemIdentifier: identity.systemIdentifier, ownerRole: identity.ownerRole, caSha256: hash(fs.readFileSync(ca)) }),
    migrateBaseline: { command },
    installBaselineAccess: async context => { assert.equal(context.migrations.status, "BASELINE_MIGRATIONS_LEDGER_VERIFIED"); calls.push("access"); },
    installPreparedSql: async () => {}, installRegisteredAccess: async () => {},
    connectRestrictedClients: async () => ({ close: async () => {} }), startApplication: async () => ({ close: async () => {} }), seedFixture: async () => ({}), runNormalCase: async () => ({ caseId: "registered.null-cross-company.commit", passed: true })
  };
  return { options, adapters, calls, source, identity, ledger, replies, commandCount: () => commandCount, resource: () => resource, receipt: () => receipt, password: () => password };
}

test("the public run explicitly opts into the real migration stage with simulated process/owner boundaries", async t => {
  const f = fixture(t);
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
  assert.equal(receipt.nativeExecution, false); assert.equal(receipt.financialAcceptance, false);
  assert.equal(f.commandCount(), 1);
  assert.deepEqual(f.calls, ["task16-migration-preflight", "prisma", "task16-migration-ledger", "access", "close-resource"]);
});

test("the native migration adapter is never inherited by an incomplete injected command descriptor", async t => {
  const f = fixture(t); f.adapters.migrateBaseline = {};
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE");
  assert.deepEqual(f.calls, []); assert.equal(receipt.nativeExecution, false);
});

test("all 202 exact source entries are required before invoking Prisma", async t => {
  const f = fixture(t); f.source.migrations.pop();
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_SOURCE_INVENTORY");
  assert.equal(receipt.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(f.commandCount(), 0); assert.deepEqual(f.calls, ["close-resource"]);
});

test("changed source metadata cannot silently select different migration bytes", async t => {
  const f = fixture(t); f.source.migrations[0].sha256 = "0".repeat(64);
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_SOURCE_CHANGED");
  assert.equal(f.commandCount(), 0); assert.ok(f.calls.includes("close-resource"));
});

for (const [field, value] of [["ownerRole", "postgres"], ["loginRole", "unbound_owner"], ["database", "foreign_database"], ["databaseOid", "99999"], ["systemIdentifier", "8234567890123456789"], ["tls", false], ["replication", "replica"], ["version", 150004]]) {
  test(`owner ${field} mismatch prevents the migration command`, async t => {
    const f = fixture(t); f.replies.preflight[field] = value;
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_MIGRATE_OWNER_IDENTITY");
    assert.equal(receipt.migrationOutcome, "NOT_ATTEMPTED");
    assert.equal(f.commandCount(), 0); assert.equal(f.calls.at(-1), "close-resource");
  });
}

test("an existing ledger is not treated as an invitation to resume or retry migrations", async t => {
  const f = fixture(t); f.replies.preflight.ledgerExists = true;
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_FRESH_DATABASE_REQUIRED");
  assert.equal(f.commandCount(), 0); assert.equal(f.calls.includes("access"), false);
});

test("a different resource source identity is rejected before any owner query", async t => {
  const f = fixture(t); const start = f.adapters.startResource;
  f.adapters.startResource = async context => { const resource = await start(context); f.receipt().sourceSha = "f".repeat(40); return resource; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  assert.deepEqual(f.calls, ["close-resource"]);
});

test("a missing owner TLS control result is an unimplemented prerequisite, not a bypass", async t => {
  const f = fixture(t); f.adapters.verifyOwnerTransport = async () => undefined;
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_OWNER_TRANSPORT");
  assert.equal(f.commandCount(), 0); assert.deepEqual(f.calls, ["close-resource"]);
});

for (const change of ["missing", "duplicate", "checksum", "unfinished", "rolled back"]) {
  test(`a ${change} ledger row cannot turn exit zero into verified migration completion`, async t => {
    const f = fixture(t);
    if (change === "missing") f.ledger.pop();
    if (change === "duplicate") f.ledger.push(f.ledger[0]);
    if (change === "checksum") f.ledger[0].sha256 = "0".repeat(64);
    if (change === "unfinished") f.ledger[0].finished = false;
    if (change === "rolled back") f.ledger[0].rolledBack = true;
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_MIGRATE_LEDGER_MISMATCH");
    assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("access"), false); assert.equal(f.calls.at(-1), "close-resource");
  });
}

test("a changed post-command cluster identity is unknown and blocks all later SQL", async t => {
  const f = fixture(t); f.replies.ledger.systemIdentifier = "8234567890123456789";
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_OWNER_IDENTITY");
  assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("access"), false);
});

test("matching mutations to both public resource IDs and its receipt cannot replace the initially witnessed container", async t => {
  const f = fixture(t); const original = f.adapters.migrateBaseline.command;
  f.adapters.migrateBaseline.command = async (...args) => {
    const result = await original(...args);
    f.receipt().containerId = "9".repeat(64); f.resource().containerId = f.receipt().containerId;
    return result;
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("task16-migration-ledger"), false); assert.equal(f.calls.includes("access"), false);
});

test("cancellation while the process returns exit zero remains unknown and never reaches ledger acceptance", async t => {
  const f = fixture(t); const controller = new AbortController(); f.options.signal = controller.signal;
  const original = f.adapters.migrateBaseline.command;
  f.adapters.migrateBaseline.command = async (...args) => { const result = await original(...args); controller.abort(); return result; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_ABORTED");
  assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("task16-migration-ledger"), false); assert.equal(f.calls.at(-1), "close-resource");
});

test("changing both an owned tool and its mutable descriptor after launch cannot replace the witnessed executable", async t => {
  const f = fixture(t); const original = f.adapters.migrateBaseline.command;
  f.adapters.migrateBaseline.command = async (...args) => {
    const result = await original(...args);
    fs.appendFileSync(f.source.inputs.tools.pnpm.path, "# changed during command\n");
    f.source.inputs.tools.pnpm.sha256 = hash(fs.readFileSync(f.source.inputs.tools.pnpm.path));
    return result;
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_TOOL_IDENTITY");
  assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("task16-migration-ledger"), false);
});

for (const condition of ["nonzero", "timeout", "unsettled", "oversized output", "lost acknowledgement"]) {
  test(`${condition} process outcome is never retried or allowed to reach access installation`, async t => {
    const f = fixture(t); const original = f.adapters.migrateBaseline.command;
    f.adapters.migrateBaseline.command = async (...args) => {
      const result = await original(...args);
      if (condition === "nonzero") return { ...result, code: 1, stderr: `private-url-password=${f.password()}` };
      if (condition === "timeout") return { ...result, timedOut: true };
      if (condition === "unsettled") return { ...result, actualSettled: false };
      if (condition === "oversized output") return { ...result, stdout: Buffer.alloc(1048577) };
      throw new Error(`private migration acknowledgement ${f.password()}`);
    };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "FAILED_CLOSED"); assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.commandCount(), 1); assert.equal(f.calls.includes("task16-migration-ledger"), false); assert.equal(f.calls.includes("access"), false);
    assert.equal(f.calls.at(-1), "close-resource");
    assert.equal(JSON.stringify(receipt).includes(f.password()), false);
  });
}

for (const boundary of ["transport", "owner preflight"]) {
  test(`an unsealed migration added at ${boundary} is rejected before Prisma launch`, async t => {
    const f = fixture(t);
    const directory = path.join(ROOT, "services/api/prisma/migrations/20990101000000_review_extra");
    assert.equal(fs.existsSync(directory), false);
    const add = () => { fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, "migration.sql"), "-- synthetic review marker only\n"); };
    t.after(() => { if (fs.existsSync(directory)) { assert.equal(fs.readFileSync(path.join(directory, "migration.sql"), "utf8"), "-- synthetic review marker only\n"); fs.unlinkSync(path.join(directory, "migration.sql")); fs.rmdirSync(directory); } });
    const original = f.adapters.verifyOwnerTransport;
    f.adapters.verifyOwnerTransport = async (...args) => {
      const result = await original(...args);
      if (boundary === "transport") add();
      else { const read = f.resource().execOwnerSql; f.resource().execOwnerSql = async (...sqlArgs) => { const row = await read(...sqlArgs); if (sqlArgs[1] === "task16-migration-preflight") add(); return row; }; }
      return result;
    };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_MIGRATE_SOURCE_INVENTORY");
    assert.equal(receipt.migrationOutcome, "NOT_ATTEMPTED"); assert.equal(f.commandCount(), 0); assert.equal(f.calls.at(-1), "close-resource");
  });
}

function processFixture(f, { noPid = false } = {}) {
  const child = new EventEmitter(); child.stdout = noPid ? undefined : new EventEmitter(); child.stderr = noPid ? undefined : new EventEmitter();
  child.pid = noPid ? undefined : 12345; child.unref = () => {};
  let alive = !noPid, spawned = false, clock = 0, sequence = 0;
  const timers = new Map(), signals = [];
  const process = {
    spawn: () => { spawned = true; return child; },
    groupSignal: (pid, signal) => { assert.equal(pid, 12345); signals.push(signal); },
    groupExists: pid => { assert.equal(pid, 12345); return alive; },
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimer: id => timers.delete(id)
  };
  f.adapters.migrateBaseline = { process };
  return { child, signals, spawned: () => spawned, gone: () => { alive = false; }, advance: ms => {
    const end = clock + ms;
    for (;;) { const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; clock = next[1].at; timers.delete(next[0]); next[1].callback(); }
    clock = end;
  } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("leader close during cancellation retains group escalation until absence is witnessed", async t => {
  const f = fixture(t), controller = new AbortController(); f.options.signal = controller.signal;
  const p = processFixture(f); let done = false;
  const run = runTask16RegisteredPg(f.options, f.adapters).then(receipt => { done = true; return receipt; });
  await flush(); assert.equal(p.spawned(), true);
  controller.abort(); p.child.emit("close", 0); await flush(); assert.equal(done, false);
  p.advance(1000); assert.deepEqual(p.signals, ["SIGTERM", "SIGKILL"]); await flush(); assert.equal(done, false);
  p.gone(); p.advance(100); const receipt = await run;
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_ABORTED"); assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(f.calls.at(-1), "close-resource"); assert.equal(receipt.nativeExecution, false);
});

for (const code of ["EMFILE", "ENFILE"]) {
  test(`${code} without PID or stdio still handles asynchronous error and closes resources`, async t => {
    const f = fixture(t), p = processFixture(f, { noPid: true });
    const run = runTask16RegisteredPg(f.options, f.adapters);
    await flush(); assert.equal(p.spawned(), true);
    await new Promise(resolve => queueMicrotask(() => { p.child.emit("error", Object.assign(new Error(code), { code })); p.child.emit("close", -1); resolve(); }));
    const receipt = await run;
    assert.equal(receipt.failureCode, "TASK16_MIGRATE_SPAWN_FAILED"); assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.deepEqual(p.signals, []); assert.equal(f.calls.at(-1), "close-resource"); assert.equal(f.calls.includes("access"), false);
    assert.equal(receipt.nativeExecution, false);
  });
}
for (const disappears of [true, false]) {
  test(`exit zero with a remaining group ${disappears ? "fails after group absence" : "fails at the hard deadline"}`, async t => {
    const f = fixture(t), p = processFixture(f); let done = false;
    const run = runTask16RegisteredPg(f.options, f.adapters).then(receipt => { done = true; return receipt; });
    await flush(); assert.equal(p.spawned(), true); p.child.emit("close", 0); await flush(); assert.equal(done, false);
    p.advance(1000); assert.deepEqual(p.signals, ["SIGTERM", "SIGKILL"]);
    if (disappears) { p.gone(); p.advance(100); } else p.advance(4000);
    const receipt = await run;
    assert.equal(receipt.failureCode, "TASK16_MIGRATE_PROCESS_REMAINS"); assert.equal(receipt.migrationOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.at(-1), "close-resource"); assert.equal(f.calls.includes("access"), false); assert.equal(receipt.nativeExecution, false);
  });
}
test("a normal process succeeds only after both close and owned group absence", async t => {
  const f = fixture(t), p = processFixture(f);
  const run = runTask16RegisteredPg(f.options, f.adapters); await flush(); assert.equal(p.spawned(), true);
  p.gone(); p.child.emit("close", 0);
  const receipt = await run;
  assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED"); assert.deepEqual(p.signals, []); assert.equal(receipt.nativeExecution, false);
});
test("an incomplete process boundary fails before any resource creation", async t => {
  const f = fixture(t); f.adapters.migrateBaseline = { process: { spawn: () => { throw new Error("must not be called"); } } };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "FAILED_CLOSED"); assert.deepEqual(f.calls, []); assert.equal(receipt.nativeExecution, false);
});
test("owner preflight cannot replace a sealed tool and its mutable descriptor before launch", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport;
  f.adapters.verifyOwnerTransport = async (...args) => {
    const result = await original(...args), read = f.resource().execOwnerSql;
    f.resource().execOwnerSql = async (...sqlArgs) => {
      const row = await read(...sqlArgs);
      if (sqlArgs[1] === "task16-migration-preflight") { fs.appendFileSync(f.source.inputs.tools.pnpm.path, "# callback mutation\n"); f.source.inputs.tools.pnpm.sha256 = hash(fs.readFileSync(f.source.inputs.tools.pnpm.path)); }
      return row;
    }; return result;
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_MIGRATE_TOOL_IDENTITY"); assert.equal(receipt.migrationOutcome, "NOT_ATTEMPTED"); assert.equal(f.commandCount(), 0); assert.equal(f.calls.at(-1), "close-resource");
});
