"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t, sourceVariant) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-migration-protocol-");
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  let root = ROOT, run = runTask16RegisteredPg;
  if (sourceVariant) {
    root = path.join(temporary,"candidate");
    const from = path.join(ROOT,"services/api/prisma");
    const to = path.join(root,"services/api/prisma");
    fs.mkdirSync(to,{recursive:true});
    for(const file of fs.readdirSync(from)){
      if(file.endsWith(".cjs")&&!file.endsWith(".test.cjs"))fs.copyFileSync(path.join(from,file),path.join(to,file));
    }
    fs.copyFileSync(path.join(from,"schema.prisma"),path.join(to,"schema.prisma"));
    fs.cpSync(path.join(from,"migrations"),path.join(to,"migrations"),{recursive:true});
    const dir=path.join(to,"migrations");
    const old=path.join(dir,fs.readdirSync(dir,{withFileTypes:true}).find(row=>row.isDirectory()).name,"migration.sql");
    const lock=path.join(dir,"migration_lock.toml");
    if(sourceVariant==="old content")fs.appendFileSync(old,"\n-- changed historical bytes\n");
    if(sourceVariant==="old Git mode")fs.chmodSync(old,0o755);
    if(sourceVariant==="lock content")fs.appendFileSync(lock,"\n# changed lock\n");
    if(sourceVariant==="missing lock")fs.unlinkSync(lock);
    if(sourceVariant==="resealed Schema bytes")fs.appendFileSync(path.join(to,"schema.prisma"),"\n// locally resealed bytes\n");
    if(sourceVariant==="Schema executable mode")fs.chmodSync(path.join(to,"schema.prisma"),0o755);
    if(sourceVariant==="migration205 executable mode")fs.chmodSync(path.join(dir,"20261109100000_contract_direct_pending_input_v1/migration.sql"),0o755);
    run=require(path.join(to,"run-task16-registered-pg-local.cjs")).runTask16RegisteredPg;
  }
  const pnpm = path.join(temporary, "pnpm"); fs.writeFileSync(pnpm, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  const ca = path.join(temporary, "ca.crt"); fs.writeFileSync(ca, "synthetic CA bytes only\n", { mode: 0o600 });
  const migrations = fs.readdirSync(path.join(root, "services/api/prisma/migrations")).filter(name => fs.existsSync(path.join(root, "services/api/prisma/migrations", name, "migration.sql"))).sort().map(name => {
    const relative = `services/api/prisma/migrations/${name}/migration.sql`; const bytes = fs.readFileSync(path.join(root, relative));
    return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
  });
  const schemaPath = "services/api/prisma/schema.prisma";
  const source = { candidateSha: "a".repeat(40), candidateRoot: root, sealSha256: "b".repeat(64), migrations,
    schema: { path: schemaPath, bytes: fs.statSync(path.join(root, schemaPath)).size, sha256: hash(fs.readFileSync(path.join(root, schemaPath))) },
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
    assert.deepEqual(args, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy", "--schema", path.join(root, schemaPath)]);
    assert.equal(control.cwd, root); assert.equal(control.timeoutMs, 180000); assert.equal(control.maxOutputBytes, 1048576);
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
  return { run, options, adapters, calls, source, identity, ledger, replies, commandCount: () => commandCount, resource: () => resource, receipt: () => receipt, password: () => password };
}

test("the public run admits the Schema205 inventory but rejects unimplemented caller supply before owner SQL or child command", async t => {
  const f=fixture(t);const result=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(result.status,'FAILED_CLOSED');assert.equal(result.failureCode,'TASK16_MIGRATE_SCHEMA204_CALLABILITY_NOT_IMPLEMENTED');
  assert.equal(result.migrationOutcome,'NOT_ATTEMPTED');assert.equal(result.nativeExecution,false);assert.equal(result.financialAcceptance,false);
  assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

test("a resource receipt and handle changed together during TLS verification cannot reach migration caller supply", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    const changed = { containerId: "7".repeat(64), networkId: "8".repeat(64), port: 15433 };
    Object.assign(f.receipt(), changed);
    Object.assign(f.resource(), changed);
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(result.failureCode, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(result.nativeExecution, false);
  assert.equal(f.commandCount(), 0);
  assert.deepEqual(f.calls, ["close-resource"]);
  assert.deepEqual(result.cleanupFailures, ["resource-proof"]);
});

test("a getter-backed migration endpoint is rejected without invoking it", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  let reads = 0;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    const port = f.resource().port;
    Object.defineProperty(f.resource(), "port", { configurable: true, get() { reads++; return port; } });
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(reads, 0);
  assert.equal(result.failureCode, "TASK16_MIGRATE_RESOURCE_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(result.nativeExecution, false);
  assert.equal(f.commandCount(), 0);
  assert.deepEqual(f.calls, ["close-resource"]);
  assert.deepEqual(result.cleanupFailures, []);
});

test("a getter-backed migration CA digest is rejected without invoking it", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  let reads = 0;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    const hashes = f.resource().serverCertHashes;
    const caSha256 = hashes.caSha256;
    Object.defineProperty(hashes, "caSha256", { configurable: true, get() { reads++; return caSha256; } });
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(reads, 0);
  assert.equal(result.failureCode, "TASK16_MIGRATE_CA_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(result.nativeExecution, false);
  assert.equal(f.commandCount(), 0);
  assert.deepEqual(f.calls, ["close-resource"]);
  assert.deepEqual(result.cleanupFailures, []);
});

test("a substituted resource handle with matching IDs cannot take over migration or cleanup", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    context.resource = { ...f.resource(), close: async () => { f.calls.push("close-replacement"); } };
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(result.failureCode, "TASK16_DRIVER_RESOURCE_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(result.resource.status, "closed");
  assert.deepEqual(result.cleanupFailures, []);
  assert.deepEqual(f.calls, ["close-resource"]);
});

test("a replaced owner method cannot reach migration and cannot replace the original cleanup callback", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    f.resource().execOwnerSql = async () => { f.calls.push("replacement-owner-sql"); };
    f.resource().close = async () => { f.calls.push("close-replacement"); };
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(result.failureCode, "TASK16_DRIVER_RESOURCE_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.deepEqual(result.cleanupFailures, []);
  assert.deepEqual(f.calls, ["close-resource"]);
});

test("a getter-backed replacement receipt is never called at migration or cleanup", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  let reads = 0;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    Object.defineProperty(f.resource(), "getReceipt", { configurable: true, get() { reads++; throw new Error("tripwire"); } });
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(result.failureCode, "TASK16_DRIVER_RESOURCE_IDENTITY");
  assert.equal(reads, 0);
  assert.equal(result.resource.status, "closed");
  assert.deepEqual(result.cleanupFailures, []);
  assert.deepEqual(f.calls, ["close-resource"]);
});

test("a same-byte CA replacement during TLS cannot reach migration caller supply", async t => {
  const f = fixture(t);
  const verify = f.adapters.verifyOwnerTransport;
  f.adapters.verifyOwnerTransport = async context => {
    const transport = await verify(context);
    const ca = f.resource().caPath;
    fs.copyFileSync(ca, ca + ".replacement");
    fs.renameSync(ca + ".replacement", ca);
    return transport;
  };
  const result = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(result.failureCode, "TASK16_MIGRATE_CA_IDENTITY");
  assert.equal(result.migrationOutcome, "NOT_ATTEMPTED");
  assert.equal(f.commandCount(), 0);
  assert.deepEqual(f.calls, ["close-resource"]);
});

for(const variant of ["old content","old Git mode","lock content","missing lock"]) {
  test(`migration rejects independently altered trusted history before owner SQL or child: ${variant}`,async t=>{
    const f=fixture(t,variant);
    const receipt=await f.run(f.options,f.adapters);
    assert.equal(receipt.failureCode,"TASK16_MIGRATE_TRUSTED_HISTORY");
    assert.equal(receipt.migrationOutcome,"NOT_ATTEMPTED");
    assert.equal(f.commandCount(),0);
    assert.deepEqual(f.calls,["close-resource"]);
  });
}

test("source metadata cannot opt into Schema204 or Schema205 callability supply", async t => {
  const f=fixture(t);f.source.schema204Callability={status:'QUALIFIED',applicationRoleOid:'10000',fileCallerOids:[10000],implemented:true};
  f.source.schema205Callability=structuredClone(f.source.schema204Callability);
  const result=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(result.failureCode,'TASK16_MIGRATE_SCHEMA204_CALLABILITY_NOT_IMPLEMENTED');assert.equal(result.migrationOutcome,'NOT_ATTEMPTED');
  assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

for(const [variant,code] of [
  ["resealed Schema bytes","TASK16_MIGRATE_SCHEMA"],
  ["Schema executable mode","TASK16_MIGRATE_SCHEMA"],
  ["migration205 executable mode","TASK16_MIGRATE_SOURCE_CHANGED"]
])test(`baseline rejects ${variant} even when the candidate digest is recalculated`,async t=>{
  const f=fixture(t,variant);
  const receipt=await f.run(f.options,f.adapters);
  assert.equal(receipt.failureCode,code);
  assert.equal(receipt.migrationOutcome,"NOT_ATTEMPTED");
  assert.equal(f.commandCount(),0);
  assert.deepEqual(f.calls,["close-resource"]);
});

test("incomplete injected command never inherits a native migration adapter",async t=>{
 const f=fixture(t);f.adapters.migrateBaseline={};const result=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(result.failureCode,'TASK16_DRIVER_CAPABILITIES_INCOMPLETE');assert.deepEqual(f.calls,[]);
});

for(const count of [203,205])test(`exact204 inventory rejects ${count} before callability gate`,async t=>{
 const f=fixture(t);if(count===203)f.source.migrations.pop();else f.source.migrations.push({...f.source.migrations.at(-1)});
 const result=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(result.failureCode,'TASK16_MIGRATE_SOURCE_INVENTORY');
 assert.equal(result.migrationOutcome,'NOT_ATTEMPTED');assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

test("changed migration bytes are rejected before the fixed unavailable capability",async t=>{
 const f=fixture(t);f.source.migrations[0].sha256='0'.repeat(64);const result=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(result.failureCode,'TASK16_MIGRATE_SOURCE_CHANGED');assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

test("changed Schema identity is rejected before the fixed unavailable capability",async t=>{
 const f=fixture(t);f.source.schema.sha256='0'.repeat(64);const result=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(result.failureCode,'TASK16_MIGRATE_SCHEMA');assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

test("resource source identity cannot be replaced before callability rejection",async t=>{
 const f=fixture(t),start=f.adapters.startResource;f.adapters.startResource=async c=>{const r=await start(c);f.receipt().sourceSha='f'.repeat(40);return r;};
 const result=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(result.failureCode,'TASK16_MIGRATE_RESOURCE_IDENTITY');assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});

test("missing owner transport is rejected before callability rejection",async t=>{
 const f=fixture(t);f.adapters.verifyOwnerTransport=async()=>undefined;
 const result=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(result.failureCode,'TASK16_MIGRATE_OWNER_TRANSPORT');assert.equal(f.commandCount(),0);assert.deepEqual(f.calls,['close-resource']);
});
