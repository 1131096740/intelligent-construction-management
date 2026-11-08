"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { installTask16RegisteredSql } = require("./task16-registered-sql-installer.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"];

function fixture(t) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-installer-offline-");
  const repo = path.join(temporary, "source");
  fs.mkdirSync(repo);
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  const directory = path.join(repo, "services/api/prisma/prepared/task16");
  fs.mkdirSync(directory, { recursive: true });
  names.forEach((name, index) => {
    const file = `services/api/prisma/prepared/task16/${name}`;
    const bytes = Buffer.from(`-- synthetic fragment ${index + 1}\nSELECT ${index + 1};\n`);
    fs.writeFileSync(path.join(repo, file), bytes);

  });
  function put(relative, value) { const file = path.join(repo, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
  if(fs.existsSync(path.join(__dirname,"task16-prepared-install-stage.cjs")))put("services/api/prisma/task16-prepared-install-stage.cjs",fs.readFileSync(path.join(__dirname,"task16-prepared-install-stage.cjs")));
  put("services/api/prisma/task16-baseline-access.json", fs.readFileSync(path.join(__dirname,"task16-baseline-access.json")));
  put("services/api/prisma/schema.prisma", "// synthetic only\n");
  put("services/api/prisma/migrations/migration_lock.toml", 'provider = "postgresql"\n');
  for (let index = 0; index < 204; index++) put(`services/api/prisma/migrations/${String(index).padStart(3, "0")}_synthetic/migration.sql`, `-- synthetic migration ${index}\n`);
  put("services/api/src/database/registered-payment-postgres.fixture.ts", "// synthetic, never imported\n");
  put("services/api/src/database/registered-payment-postgres.cases.ts", fs.readFileSync(path.join(__dirname, "../src/database/registered-payment-postgres.cases.ts")));
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  function git(...args) { return execFileSync("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: repo, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  git("init", "--quiet", "--template="); git("config", "user.name", "Task16 synthetic source"); git("config", "user.email", "task16@example.invalid"); git("add", "."); git("commit", "--quiet", "-m", "synthetic installer source");
  const candidateSha = git("rev-parse", "HEAD");
  const cli = path.resolve(__dirname, "../../../scripts/prepare-task16-registered-pg.cjs");
  const prepared = JSON.parse(execFileSync(process.execPath, [cli, "--prepare", "--repo", repo, "--candidate-sha", candidateSha, "--output", path.join(temporary, "packet")], { encoding: "utf8" }));
  const packetFile = path.join(temporary, "packet/packet.json");
  const packetBytes = fs.readFileSync(packetFile);
  const packet = JSON.parse(packetBytes);
  const resourceReceipt = { runId: "da49e313-e3da-407f-b279-3d09caecfc3e", sourceSha: packet.candidateSha, status: "started-awaiting-driver-verification", databaseName: "jg_task01_da49e313e3da407fb2793d09caecfc3e", containerId: "c".repeat(64), networkId: "d".repeat(64), daemonId: "synthetic-daemon-only", endpoint: "unix:///synthetic/docker.sock", imageId: "sha256:" + "e".repeat(64), port: 15432, cleanup: { status: "pending" } };
  const identity = { database: resourceReceipt.databaseName, databaseOid: "12345", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", ownerOid:"10000", installedObjectWitness:{relations:[],indexes:[],columns:[],constraints:[],triggers:[]}, loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, runtimeRole: "jg_task01_runtime", runtimeSafe: true, strictRuntimeSafe:true, runtimeOid:"20001", observerRole:"jg_task01_observer", observerOid:"20002", observerSafe:true, serverVersion: 160004, tls: true, replication: "origin", migrationLedger: packet.migrations.map(row => ({ name: row.path.split("/").at(-2), sha256: row.sha256, finished: true, rolledBack: false })) };
  const calls = [];
  const resource = {
    getReceipt: () => structuredClone(resourceReceipt),
    execOwnerSql: async (sql, label) => {
      calls.push({ sql, label });
      return { stdout: JSON.stringify({ ...identity, phase: label === "task16-install-preflight" ? "preflight" : "committed", nonce: /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1] }) + "\n" };
    }
  };
  const options = { resource, packetFile, expectedPacketSha256: prepared.packetSha256, ownerRole: "jg_task01_owner", runtimeRole: "jg_task01_runtime", authorizationReference: "synthetic-source-and-adapter-tests-only", expectedResource: { runId: resourceReceipt.runId, sourceSha: packet.candidateSha, containerId: resourceReceipt.containerId, networkId: resourceReceipt.networkId, daemonId: resourceReceipt.daemonId, endpoint: resourceReceipt.endpoint, imageId: resourceReceipt.imageId, databaseName: resourceReceipt.databaseName, port: resourceReceipt.port } };
  return { options, calls, identity, packet, resourceReceipt, repo, git };
}

test("authorized caller installs the exact seven fragments in one owner transaction after identity preflight", async t => {
  const f = fixture(t);
  const result = await installTask16RegisteredSql(f.options);
  assert.equal(result.status, "SQL_INSTALLATION_COMMIT_OBSERVED");
  assert.equal(result.financialAcceptance, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].label, "task16-install-preflight");
  assert.equal(f.calls[1].label, "task16-install-transaction");
  const sql = f.calls[1].sql;
  assert.ok(sql.startsWith("BEGIN;\n"));
  assert.equal((sql.match(/^BEGIN;$/gmu) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gmu) || []).length, 1);
  let cursor = 0;
  for (let index = 1; index <= 7; index++) {
    const at = sql.indexOf(`-- synthetic fragment ${index}\nSELECT ${index};\n`, cursor);
    assert.ok(at > cursor); cursor = at;
  }
  assert.ok(sql.indexOf("jg.task16_runtime_role") < sql.indexOf("-- synthetic fragment 1"));
  assert.ok(sql.indexOf("COMMIT;") > cursor);
  assert.ok(sql.indexOf("'committed'") > sql.indexOf("COMMIT;"));
});

test("source changed after sealing is rejected before the resource adapter is called", async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.repo, "services/api/prisma/prepared/task16/registered-funding.sql"), "-- changed after seal\n");
  await assert.rejects(installTask16RegisteredSql(f.options), error => error.installationOutcome === "NOT_ATTEMPTED");
  assert.equal(f.calls.length, 0);
});

test("an externally re-pinned but source-inconsistent packet cannot authorize installation", async t => {
  const f = fixture(t);
  f.packet.installation.fragments.reverse();
  delete f.packet.sealSha256; f.packet.sealSha256 = hash(JSON.stringify(f.packet));
  fs.writeFileSync(f.options.packetFile, JSON.stringify(f.packet));
  f.options.expectedPacketSha256 = hash(fs.readFileSync(f.options.packetFile));
  await assert.rejects(installTask16RegisteredSql(f.options), error => error.installationOutcome === "NOT_ATTEMPTED");
  assert.equal(f.calls.length, 0);
});

test("the expected packet digest is external and cannot be substituted by the packet seal", async t => {
  const f = fixture(t); f.options.expectedPacketSha256 = f.packet.sealSha256;
  await assert.rejects(installTask16RegisteredSql(f.options), error => error.installationOutcome === "NOT_ATTEMPTED");
  assert.equal(f.calls.length, 0);
});

test("identical owner/runtime roles are refused before any resource or SQL operation", async t => {
  const f = fixture(t); f.options.runtimeRole = f.options.ownerRole;
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_ROLE_SEPARATION", installationOutcome: "NOT_ATTEMPTED" });
  assert.equal(f.calls.length, 0);
});

test("missing actual authorization reference is refused, although a reference alone never proves approval", async t => {
  const f = fixture(t); delete f.options.authorizationReference;
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_AUTHORIZATION_REFERENCE", installationOutcome: "NOT_ATTEMPTED" });
  assert.equal(f.calls.length, 0);
});

for (const [field, value] of [["database", "unowned_database"], ["ownerRole", "postgres"], ["ownerIsDatabaseOwner", false], ["runtimeSafe", false], ["tls", false], ["replication", "replica"]]) {
  test(`preflight ${field} mismatch prevents the installation transaction`, async t => {
    const f = fixture(t); f.identity[field] = value;
    await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_DATABASE_IDENTITY", installationOutcome: "NOT_ATTEMPTED" });
    assert.equal(f.calls.length, 1);
  });
}

test("migration ledger with an unfinished row prevents installation", async t => {
  const f = fixture(t); f.identity.migrationLedger[0].finished = false;
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_MIGRATION_LEDGER", installationOutcome: "NOT_ATTEMPTED" });
  assert.equal(f.calls.length, 1);
});

test("resource container replacement after preflight prevents installation", async t => {
  const f = fixture(t); const execute = f.options.resource.execOwnerSql;
  f.options.resource.execOwnerSql = async (...args) => { const result = await execute(...args); f.resourceReceipt.containerId = "b".repeat(64); return result; };
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_RESOURCE_CHANGED", installationOutcome: "NOT_ATTEMPTED" });
  assert.equal(f.calls.length, 1);
});

test("SQL failure or lost acknowledgement remains unknown and is never retried or described as rollback", async t => {
  const f = fixture(t); const execute = f.options.resource.execOwnerSql;
  f.options.resource.execOwnerSql = async (...args) => {
    const result = await execute(...args);
    if (args[1] === "task16-install-transaction") throw new Error("untrusted driver stderr with private SQL");
    return result;
  };
  await assert.rejects(installTask16RegisteredSql(f.options), error => {
    assert.equal(error.code, "TASK16_INSTALL_FAILED_CLOSED");
    assert.equal(error.installationOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.ok(!error.message.includes("private SQL")); return true;
  });
  assert.equal(f.calls.length, 2);
});

test("a COMMIT receipt from a different cluster fails closed with unknown installation outcome", async t => {
  const f = fixture(t); const execute = f.options.resource.execOwnerSql;
  f.options.resource.execOwnerSql = async (...args) => {
    if (args[1] === "task16-install-transaction") f.identity.systemIdentifier = "8234567890123456789";
    return execute(...args);
  };
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_DATABASE_CHANGED", installationOutcome: "UNKNOWN_DO_NOT_RETRY" });
  assert.equal(f.calls.length, 2);
});

test("a success-shaped response without this call's receipt nonce is not accepted", async t => {
  const f = fixture(t); const execute = f.options.resource.execOwnerSql;
  f.options.resource.execOwnerSql = async (...args) => {
    const result = await execute(...args);
    if (args[1] === "task16-install-transaction") { const row = JSON.parse(result.stdout); row.nonce = "0".repeat(64); result.stdout = JSON.stringify(row); }
    return result;
  };
  await assert.rejects(installTask16RegisteredSql(f.options), { code: "TASK16_INSTALL_DATABASE_IDENTITY", installationOutcome: "UNKNOWN_DO_NOT_RETRY" });
  assert.equal(f.calls.length, 2);
});

test("the actual installation command checks runtime safety and the frozen migration ledger before its first fragment", async t => {
  const f = fixture(t); const execute = f.options.resource.execOwnerSql;
  let sawGuard = false;
  f.options.resource.execOwnerSql = async (sql, label) => {
    if (label === "task16-install-transaction") {
      const prefix = sql.slice(0, sql.indexOf("-- synthetic fragment 1"));
      assert.match(prefix, /LOCK TABLE public\._prisma_migrations IN SHARE MODE;/u);
      assert.match(prefix, /rolbypassrls/u);
      assert.match(prefix, /task16 installation migration ledger changed/u);
      assert.ok(prefix.includes(f.identity.migrationLedger[0].sha256));
      sawGuard = true;
    }
    return execute(sql, label);
  };
  await installTask16RegisteredSql(f.options);
  assert.equal(sawGuard, true);
});

function baseline(f) {
  return { status:"BASELINE_ROLE_ACL_COMMIT_OBSERVED",schema204PhysicalVerified:true, candidateRoot:f.repo, sourceSha:f.packet.candidateSha,
    manifestSha256:hash(fs.readFileSync(path.join(f.repo,"services/api/prisma/task16-baseline-access.json"))),
    databaseOid:f.identity.databaseOid, systemIdentifier:f.identity.systemIdentifier,
    ownerOid:"10000",runtimeRole:"jg_task01_runtime", observerRole:"jg_task01_observer", runtimeOid:"20001", observerOid:"20002" };
}
test("installer binds the supplied baseline role OIDs and manifest through commit",async t=>{
 const f=fixture(t);f.options.expectedBaseline=baseline(f);
 const result=await installTask16RegisteredSql(f.options);
 assert.equal(result.baselineContinuityVerified,true);assert.equal(result.runtimeOid,"20001");assert.equal(result.observerOid,"20002");
 assert.equal(f.calls.length,2);
});
test("legacy standalone installation explicitly has no baseline continuity proof",async t=>{
 const f=fixture(t);const result=await installTask16RegisteredSql(f.options);assert.equal(result.baselineContinuityVerified,false);
});
for(const field of ["runtimeOid","observerOid"]){
 test(`baseline ${field} drift in preflight stops before DDL`,async t=>{
  const f=fixture(t);f.options.expectedBaseline=baseline(f);f.identity[field]="30001";
  await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_BASELINE_ROLE_IDENTITY",installationOutcome:"NOT_ATTEMPTED"});assert.equal(f.calls.length,1);
 });
 test(`baseline ${field} drift while commit acknowledgement arrives remains unknown`,async t=>{
  const f=fixture(t);f.options.expectedBaseline=baseline(f);const exec=f.options.resource.execOwnerSql;
  f.options.resource.execOwnerSql=async(...args)=>{const result=await exec(...args);if(args[1]==="task16-install-transaction"){const row=JSON.parse(result.stdout);row[field]="30001";return{stdout:JSON.stringify(row)};}return result;};
  await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_BASELINE_ROLE_IDENTITY",installationOutcome:"UNKNOWN_DO_NOT_RETRY"});assert.equal(f.calls.length,2);
 });
}
test("baseline role checks are repeated inside the actual SQL adapter request",async t=>{
 const f=fixture(t);f.options.expectedBaseline=baseline(f);const exec=f.options.resource.execOwnerSql;
 f.options.resource.execOwnerSql=async(sql,label)=>{
  if(label==="task16-install-transaction"){
   assert.ok(sql.includes("baseline restricted identity changed"));assert.ok(sql.includes("IS DISTINCT FROM '20001'"));assert.ok(sql.includes("IS DISTINCT FROM '20002'"));
   throw new Error("synthetic SQL role-change guard rejection");
  }return exec(sql,label);
 };
 await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_FAILED_CLOSED",installationOutcome:"UNKNOWN_DO_NOT_RETRY"});
 // Observes the supplied SQL protocol and failure semantics, not real PG rejection.
});
test("a fragment substituted after owner preflight cannot reach the DDL request",async t=>{
 const f=fixture(t);f.options.expectedBaseline=baseline(f);const exec=f.options.resource.execOwnerSql;
 f.options.resource.execOwnerSql=async(...args)=>{const result=await exec(...args);if(args[1]==="task16-install-preflight"){
  const target=path.join(f.repo,"services/api/prisma/prepared/task16/registered-funding.sql");fs.renameSync(target,`${target}.owned-original`);fs.symlinkSync(`${target}.owned-original`,target);
 }return result;};
 await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_SOURCE_CAPTURE_CHANGED",installationOutcome:"NOT_ATTEMPTED"});assert.equal(f.calls.length,1);
});
test("caller mutation cannot replace the captured expected role identity",async t=>{
 const f=fixture(t);f.options.expectedBaseline=baseline(f);const exec=f.options.resource.execOwnerSql;
 f.options.resource.execOwnerSql=async(...args)=>{const result=await exec(...args);if(args[1]==="task16-install-preflight"){f.options.expectedBaseline.runtimeOid="30001";f.identity.runtimeOid="30001";}return result;};
 await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_BASELINE_ROLE_IDENTITY",installationOutcome:"UNKNOWN_DO_NOT_RETRY"});
});

test("the public run supplies the first immutable resource witness and baseline proof to native installation",async t=>{
 const f=fixture(t);const {runTask16RegisteredPg}=require("./run-task16-registered-pg-local.cjs");
 let baselineProof;
 const source={candidateSha:f.packet.candidateSha,candidateRoot:f.repo,sealSha256:f.packet.sealSha256,runtimeAdmission:{status:"INPUTS_AND_CODE_TREES_MATCHED"},executionFiles:f.packet.source.files,inputs:{authorizationReference:"synthetic only"}};
 const adapters={verifySource:async()=>source,startResource:async context=>{
  f.resourceReceipt.runId=context.runId;f.resourceReceipt.databaseName=`jg_task01_${context.runId.replaceAll("-","")}`;f.identity.database=f.resourceReceipt.databaseName;
  return {...f.options.resource,close:async()=>{f.resourceReceipt.status="closed";f.resourceReceipt.cleanup={status:"completed",containerAbsent:true,volumesAbsent:true,networkAbsent:true};}};
 },verifyOwnerTransport:async()=>({status:"OWNER_TLS_CONTROLS_VERIFIED",databaseOid:f.identity.databaseOid,systemIdentifier:f.identity.systemIdentifier}),migrateBaseline:async()=>({}),installBaselineAccess:async context=>{
  assert.equal(Object.isFrozen(context.resourceWitness),true);
  baselineProof={...baseline(f),ownerOid:"10000",resourceWitness:structuredClone(context.resourceWitness)};return baselineProof;
 },installPreparedSql:async context=>{const{installTask16PreparedStage}=require("./task16-prepared-install-stage.cjs");return installTask16PreparedStage(context);},installRegisteredAccess:async context=>{
  assert.equal(context.installation.baselineContinuityVerified,true);assert.equal(context.installation.runtimeOid,baselineProof.runtimeOid);assert.equal(context.installation.observerOid,baselineProof.observerOid);
 },connectRestrictedClients:async()=>({close:async()=>{}}),startApplication:async()=>({close:async()=>{}}),seedFixture:async()=>({}),runNormalCase:async()=>({caseId:"registered.null-cross-company.commit",passed:true})};
 const options={packetFile:f.options.packetFile,expectedPacketSha256:f.options.expectedPacketSha256,inputsFile:path.join(f.repo,"not-read-inputs.json"),expectedInputsSha256:"a".repeat(64),artifactsDir:path.join(f.repo,"not-created-artifacts")};
 const receipt=await runTask16RegisteredPg(options,adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED");assert.equal(receipt.nativeExecution,false);
});
test("a replacement receipt after baseline cannot replace the driver's first resource witness",async t=>{
 const f=fixture(t);const {runTask16RegisteredPg}=require("./run-task16-registered-pg-local.cjs");
 const source={candidateSha:f.packet.candidateSha,candidateRoot:f.repo,sealSha256:f.packet.sealSha256,runtimeAdmission:{status:"INPUTS_AND_CODE_TREES_MATCHED"},executionFiles:f.packet.source.files,inputs:{authorizationReference:"synthetic only"}};
 const adapters={verifySource:async()=>source,startResource:async context=>{
  f.resourceReceipt.runId=context.runId;f.resourceReceipt.databaseName=`jg_task01_${context.runId.replaceAll("-","")}`;f.identity.database=f.resourceReceipt.databaseName;
  return {...f.options.resource,close:async()=>{f.resourceReceipt.status="closed";f.resourceReceipt.cleanup={status:"completed",containerAbsent:true,volumesAbsent:true,networkAbsent:true};}};
 },verifyOwnerTransport:async()=>({databaseOid:f.identity.databaseOid,systemIdentifier:f.identity.systemIdentifier}),migrateBaseline:async()=>({}),installBaselineAccess:async context=>{
  assert.equal(Object.isFrozen(context.resourceWitness),true);f.resourceReceipt.containerId="f".repeat(64);
  return {...baseline(f),resourceWitness:{...context.resourceWitness,containerId:f.resourceReceipt.containerId}};
 },installPreparedSql:async context=>require("./task16-prepared-install-stage.cjs").installTask16PreparedStage(context),installRegisteredAccess:async()=>{throw new Error("must stop before registered ACL");},connectRestrictedClients:async()=>{throw new Error("must stop before clients");},startApplication:async()=>{},seedFixture:async()=>{},runNormalCase:async()=>({caseId:"registered.null-cross-company.commit",passed:true})};
 const options={packetFile:f.options.packetFile,expectedPacketSha256:f.options.expectedPacketSha256,inputsFile:path.join(f.repo,"not-read-inputs.json"),expectedInputsSha256:"a".repeat(64),artifactsDir:path.join(f.repo,"not-created-artifacts")};
 const receipt=await runTask16RegisteredPg(options,adapters);
 assert.equal(receipt.failureCode,"TASK16_INSTALL_HANDOFF_RESOURCE");assert.equal(receipt.installationOutcome,"NOT_ATTEMPTED");assert.equal(f.calls.length,0);assert.equal(receipt.resource.status,"closed");
});

test("owner preflight cannot replace the captured installation transport",async t=>{
 const f=fixture(t);f.options.expectedBaseline=baseline(f);const exec=f.options.resource.execOwnerSql;let replacementCalled=false;
 f.options.resource.execOwnerSql=async(...args)=>{const result=await exec(...args);if(args[1]==="task16-install-preflight")f.options.resource.execOwnerSql=async()=>{replacementCalled=true;throw new Error("replacement must not run");};return result;};
 await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_RESOURCE_METHOD_CHANGED",installationOutcome:"NOT_ATTEMPTED"});assert.equal(replacementCalled,false);assert.equal(f.calls.length,1);
});

for(const invalid of [null,false,0,""]){
 test(`an explicitly invalid baseline ${JSON.stringify(invalid)} is rejected before SQL`,async t=>{
  const f=fixture(t);f.options.expectedBaseline=invalid;
  await assert.rejects(installTask16RegisteredSql(f.options),{code:"TASK16_INSTALL_BASELINE_ARGUMENTS",installationOutcome:"NOT_ATTEMPTED"});assert.equal(f.calls.length,0);
 });
}
