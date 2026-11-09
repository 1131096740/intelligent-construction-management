"use strict";
const TYPE_ACL = [
 {type:'public."OperatingLedgerFactWritePayloadV2"',typeOid:'41001',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false},
 {type:'public."OperatingLedgerImpactWritePayloadV2"',typeOid:'41002',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false}
];
const scopeFixture=require("./testdata/task16-schema205-scope-fixture.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
    const temporary = fs.mkdtempSync("/private/tmp/jg-task16-registered-acl-protocol-");
    t.after(() => fs.rmSync(temporary, { recursive: true }));
    const ca = path.join(temporary, "ca.crt");
    fs.writeFileSync(ca, "synthetic CA only\n", { mode: 0o600 });
    const migrations = fs.readdirSync(path.join(ROOT, "services/api/prisma/migrations")).filter(name => fs.existsSync(path.join(ROOT, "services/api/prisma/migrations", name, "migration.sql"))).sort().map(name => { const relative = `services/api/prisma/migrations/${name}/migration.sql`; const bytes = fs.readFileSync(path.join(ROOT, relative)); return { path: relative, sha256: hash(bytes), bytes: bytes.length }; });
    const manifestSources = fs.existsSync(path.join(ROOT, "services/api/prisma/task16-registered-access.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "services/api/prisma/task16-registered-access.json"), "utf8")).sources.map(row => row.path) : [];
    const code = ["services/api/prisma/task16-registered-access.cjs", "services/api/prisma/task16-registered-access.json", "services/api/prisma/task16-registered-access.sql", "services/api/prisma/task16-registered-access-check.cjs", "services/api/prisma/task16-registered-access-check.sql", "services/api/prisma/task16-baseline-access.json", ...manifestSources];
    const source = { candidateSha: "a".repeat(40), candidateRoot: ROOT, sealSha256:"d".repeat(64),runtimeAdmission: { status: "INPUTS_AND_CODE_TREES_MATCHED" }, migrations, executionFiles: [...new Set(code)].filter(p => fs.existsSync(path.join(ROOT, p))).map(p => ({ path: p, sha256: hash(fs.readFileSync(path.join(ROOT, p))) })), inputs: { docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } } };
    const options = { packetFile: path.join(temporary, "packet.json"), expectedPacketSha256: "b".repeat(64), inputsFile: path.join(temporary, "inputs.json"), expectedInputsSha256: "c".repeat(64), artifactsDir: path.join(temporary, "artifacts") };
    let resource, receipt, passwords;
    const calls = [], replies = {}, hooks = {};
    const identity = { databaseOid: "16384", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", ownerOid: "10000", readOnly: "off", loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, tls: true, version: 160004, replication: "origin" };
    const adapters = { verifySource: async () => source, startResource: async (context) => {
            passwords = { ...context.credentials };
            receipt = { ...source.inputs.docker, sourceSha: source.candidateSha, runId: context.runId, containerId: "d".repeat(64), networkId: "e".repeat(64), port: 15432, databaseName: `jg_task01_${context.runId.replaceAll("-", "")}`, status: "started-awaiting-driver-verification", cleanup: { status: "pending" }, tls: { caSha256: hash(fs.readFileSync(ca)) } };
            resource = { containerId: receipt.containerId, networkId: receipt.networkId, databaseName: receipt.databaseName, port: receipt.port, caPath: ca, serverCertHashes: { caSha256: receipt.tls.caSha256 }, getReceipt: () => structuredClone(receipt), execOwnerSql: async (sql, label) => {
                    calls.push(label);
                    if(hooks[label]) await hooks[label](sql);
                    const phase = label === "task16-registered-access-preflight" ? "preflight" : "committed";
                    const nonce = /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1];
                    return { stdout: JSON.stringify({ ...identity, database: receipt.databaseName, nonce, phase, migrationLedger: migrations.map(row => ({ name: row.path.split("/").at(-2), sha256: row.sha256, finished: true, rolledBack: false })), schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),schema203Verified:true,schema203TypeAclWitness:structuredClone(TYPE_ACL),functionsVerified:true,otherGranteeAclWitness:[],baselineGuardsVerified:true,newGuardsAbsent:phase==="preflight",matrixVerified:phase==="committed",guardVerified:phase==="committed",installedObjectWitness:{relations:[],indexes:[],columns:[],constraints:[],triggers:[]}, runtimeRole: "jg_task01_runtime", observerRole: "jg_task01_observer", runtimeOid: "20001", observerOid: "20002", ...replies[phase] }) };
                }, close: async () => { calls.push("close-resource"); receipt.status = "closed"; receipt.cleanup = { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true }; } };
            return resource;
        }, verifyOwnerTransport: async () => ({ status: "OWNER_TLS_CONTROLS_VERIFIED", ...identity, caSha256: hash(fs.readFileSync(ca)) }), migrateBaseline: async () => ({ status: "BASELINE_MIGRATIONS_LEDGER_VERIFIED", migrationCount: 205 }), installBaselineAccess: async context=>({schema203TypeAclWitness:structuredClone(TYPE_ACL),status:"BASELINE_ROLE_ACL_COMMIT_OBSERVED",schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("baseline"),schema205Registry:scopeFixture.registry("baseline"),ownerOid:"10000",sourceSha:source.candidateSha,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,runtimeRole:"jg_task01_runtime",observerRole:"jg_task01_observer",runtimeOid:"20001",observerOid:"20002",manifestSha256:hash(fs.readFileSync(path.join(ROOT,"services/api/prisma/task16-baseline-access.json"))),expectedMatrixSha256:hash(JSON.stringify([JSON.parse(fs.readFileSync(path.join(ROOT,"services/api/prisma/task16-baseline-access.json"),"utf8")).runtime,JSON.parse(fs.readFileSync(path.join(ROOT,"services/api/prisma/task16-baseline-access.json"),"utf8")).observer])),resourceWitness:structuredClone(context.resourceWitness)}),installPreparedSql:async context=>({status:"SQL_INSTALLATION_COMMIT_OBSERVED",candidateSha:source.candidateSha,packetSha256:options.expectedPacketSha256,sourceSealSha256:source.sealSha256,fragmentCount:7,databaseName:receipt.databaseName,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerRole:"jg_task01_owner",ownerOid:"10000",runtimeRole:"jg_task01_runtime",runtimeOid:"20001",observerRole:"jg_task01_observer",observerOid:"20002",baselineManifestSha256:context.baselineAccess.manifestSha256,baselineContinuityVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),schema205ScopeDelta:scopeFixture.delta("seven"),installedObjectWitness:{relations:[],indexes:[],columns:[],constraints:[],triggers:[]}}),installRegisteredAccess:async context=>require("./task16-registered-access.cjs").installTask16RegisteredAccess(context), connectRestrictedClients: async context => {calls.push("clients"); assert.equal(context.registeredAccess.status,"REGISTERED_ACL_COMMIT_OBSERVED");return {close:async()=>{}};}, startApplication: async () => ({ close: async () => { } }), seedFixture: async () => ({}), runNormalCase: async () => ({ caseId: "registered.null-cross-company.commit", passed: true }) };
    return { options, adapters, calls, source, replies, hooks, resource: () => resource, receipt: () => receipt, passwords: () => passwords };
}

test("registered ACL completes after the seven-fragment proof and before restricted clients",async t=>{
 const f=fixture(t);const receipt=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
 assert.deepEqual(f.calls,["task16-registered-access-preflight","task16-registered-access-transaction","clients","close-resource"]);
 assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime),false);
});
test("registered ACL rejects a replacement of the first Schema205 witness before DDL", async t => {
 const f=fixture(t);
 f.replies.preflight={schema205PhysicalVerified:true,schema205WitnessSha256:"9".repeat(64)};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(receipt.failureCode,"TASK16_REGISTERED_SCHEMA205_CONTINUITY");
 assert.equal(receipt.registeredAccessOutcome,"NOT_ATTEMPTED");
 assert.deepEqual(f.calls,["task16-registered-access-preflight","close-resource"]);
});
for(const phase of ["preflight","committed"]){
 test(`B6 registry continuity rejects raw public ACL drift at ${phase}`,async t=>{
  const f=fixture(t),witness=scopeFixture.registry("seven");
  witness.publicRoutine.rawAcl.reverse();
  f.replies[phase]={schema205Registry:witness};
  const receipt=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(receipt.failureCode,"TASK16_REGISTERED_SCHEMA205_REGISTRY");
  assert.equal(receipt.registeredAccessOutcome,phase==="preflight"?"NOT_ATTEMPTED":"UNKNOWN_DO_NOT_RETRY");
  assert.deepEqual(f.calls,phase==="preflight"
   ?["task16-registered-access-preflight","close-resource"]
   :["task16-registered-access-preflight","task16-registered-access-transaction","close-resource"]);
 });
}

test("registered ACL rejects a new type ACL that no longer matches the first B5 witness",async t=>{
 const f=fixture(t),prior=f.adapters.installBaselineAccess;
 f.adapters.installBaselineAccess=async c=>({...await prior(c),schema203TypeAclWitness:structuredClone(TYPE_ACL)});
 f.replies.preflight={schema204PhysicalVerified:true,schema205PhysicalVerified:true,schema205WitnessSha256:"8".repeat(64),schema205ScopeObjects:scopeFixture.scope("seven"),schema205Registry:scopeFixture.registry("seven"),schema203Verified:true,schema203TypeAclWitness:[{type:'synthetic-changed',grantee:'30000',grantable:true}]};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(receipt.failureCode,'TASK16_REGISTERED_SCHEMA203_TYPE_ACL_CONTINUITY');
 assert.equal(receipt.registeredAccessOutcome,'NOT_ATTEMPTED');
 assert.deepEqual(f.calls,['task16-registered-access-preflight','close-resource']);
});

for(const [field,value,code] of [["ownerOid","10001","TASK16_REGISTERED_DATABASE_IDENTITY"],["runtimeOid","20003","TASK16_REGISTERED_DATABASE_IDENTITY"],["observerOid","20004","TASK16_REGISTERED_DATABASE_IDENTITY"],["tls",false,"TASK16_REGISTERED_DATABASE_IDENTITY"],["functionsVerified",false,"TASK16_REGISTERED_FUNCTION_SOURCE"],["baselineGuardsVerified",false,"TASK16_REGISTERED_FUNCTION_SOURCE"],["newGuardsAbsent",false,"TASK16_REGISTERED_FRESH_GUARDS"],["migrationLedger",[],"TASK16_REGISTERED_LEDGER"],["installedObjectWitness",{columns:[{synthetic:"changed"}],constraints:[],triggers:[]},"TASK16_REGISTERED_OBJECT_WITNESS"]]){
 test(`preflight rejects ${field} drift and closes without installing`,async t=>{
  const f=fixture(t);f.replies.preflight={[field]:value};const receipt=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(receipt.failureCode,code);assert.equal(receipt.registeredAccessOutcome,"NOT_ATTEMPTED");assert.equal(receipt.stages.some(row=>row.name==="runNormalCase"),false);
  assert.deepEqual(f.calls,["task16-registered-access-preflight","close-resource"]);
 });
}
for(const [field,value] of [["ownerOid","10001"],["runtimeOid","20003"],["observerOid","20004"],["functionsVerified",false],["baselineGuardsVerified",false],["matrixVerified",false],["guardVerified",false],["installedObjectWitness",{columns:[],constraints:[],triggers:[{synthetic:"changed"}]}]]){
 test(`commit response ${field} drift stays unknown and is not retried`,async t=>{
  const f=fixture(t);f.replies.committed={[field]:value};const receipt=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(receipt.status,"FAILED_CLOSED");assert.equal(receipt.registeredAccessOutcome,"UNKNOWN_DO_NOT_RETRY");assert.equal(receipt.stages.some(row=>row.name==="runNormalCase"),false);
  assert.deepEqual(f.calls,["task16-registered-access-preflight","task16-registered-access-transaction","close-resource"]);
 });
}
test("seven-fragment proof without B5 continuity cannot enter registered SQL",async t=>{
 const f=fixture(t),previous=f.adapters.installPreparedSql;f.adapters.installPreparedSql=async c=>({...await previous(c),baselineContinuityVerified:false});
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.failureCode,"TASK16_REGISTERED_INSTALLATION_CONTINUITY");assert.equal(receipt.registeredAccessOutcome,"NOT_ATTEMPTED");assert.deepEqual(f.calls,["close-resource"]);
});
test("fake fresh resource and baseline cannot replace the first owned witness",async t=>{
 const f=fixture(t),previous=f.adapters.installPreparedSql;f.adapters.installPreparedSql=async c=>{const result=await previous(c);f.receipt().containerId="f".repeat(64);c.resource.containerId="f".repeat(64);c.baselineAccess.resourceWitness.containerId="f".repeat(64);return result;};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.failureCode,"TASK16_REGISTERED_RESOURCE_WITNESS");assert.equal(receipt.registeredAccessOutcome,"NOT_ATTEMPTED");assert.deepEqual(f.calls,["close-resource"]);
});
test("owner preflight await cannot swap resource methods or advance to installation",async t=>{
 const f=fixture(t);f.hooks["task16-registered-access-preflight"]=()=>{f.resource().execOwnerSql=async()=>{throw new Error("must not be called");};};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.failureCode,"TASK16_REGISTERED_RESOURCE_CHANGED");assert.equal(receipt.registeredAccessOutcome,"NOT_ATTEMPTED");assert.deepEqual(f.calls,["task16-registered-access-preflight","close-resource"]);
});
test("post-commit resource change does not report rollback or retry",async t=>{
 const f=fixture(t);f.hooks["task16-registered-access-transaction"]=()=>{f.receipt().networkId="f".repeat(64);};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.failureCode,"TASK16_REGISTERED_RESOURCE_IDENTITY");assert.equal(receipt.registeredAccessOutcome,"UNKNOWN_DO_NOT_RETRY");assert.deepEqual(f.calls,["task16-registered-access-preflight","task16-registered-access-transaction","close-resource"]);
});
test("sensitive adapter rejection is sanitized while preserving unknown and cleanup",async t=>{
 const f=fixture(t);f.hooks["task16-registered-access-transaction"]=sql=>{throw new Error(`synthetic secret ${f.passwords().runtime} ${sql}`);};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.failureCode,"TASK16_REGISTERED_FAILED_CLOSED");assert.equal(receipt.registeredAccessOutcome,"UNKNOWN_DO_NOT_RETRY");assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime),false);assert.equal(JSON.stringify(receipt).includes("CREATE FUNCTION"),false);assert.deepEqual(f.calls,["task16-registered-access-preflight","task16-registered-access-transaction","close-resource"]);
});
test("observed transaction protocol is delta-only and retains exact full-body proof",async t=>{
 const f=fixture(t);let observed;
 f.hooks["task16-registered-access-transaction"]=sql=>{observed=sql;};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED");
 // Observed adapter protocol only. These assertions do not execute or parse SQL.
 assert.ok(observed.length>200000);assert.equal(observed.includes("REVOKE ALL ON ALL TABLES"),false);assert.equal(observed.includes("CREATE ROLE"),false);
 assert.equal(observed.includes("jg_task16_runtime_reference_read_only"),true);assert.equal(observed.includes("p.prosrc=proof->>'body'"),true);
 const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"services/api/prisma/task16-registered-access.json"),"utf8"));
 assert.equal(manifest.functionProofs.length,80);assert.equal(manifest.runtime.tables.some(row=>row.table==="RegisteredContractHistoryRevision"),false);
 assert.deepEqual(manifest.observer.functions,["public.jg_task01_connection_identity()"]);
 assert.equal(manifest.runtime.functions.includes("public.jg_registered_timestamp_iso(timestamp with time zone)"),false);
 for(const table of ["UserPosition","ApprovalInstance","CompanyEntity"])assert.equal(manifest.lockOnlyGuards.some(row=>row.table===table),true);
});

test("owner SQL carries exactly the observer snapshot projection delta",async t=>{
 const f=fixture(t);let received;
 const observerDelta={role:"jg_task01_observer",tables:[
  {table:"FundAccountBalanceRegistration",select:["coveredExecutionIds"],insert:[],update:[]},
  {table:"RegisteredFundPaymentAllocation",select:["accountId","amountCents","executionId","sourceBatchId"],insert:[],update:[]},
  {table:"RegisteredPaymentEvent",select:["executionId"],insert:[],update:[]},
  {table:"RegisteredPaymentFunding",select:["actualPayerId","actualPayerKind","executionId","operatingLedgerEffectiveDateAtRegistration"],insert:[],update:[]}
 ],functions:[]};
 f.hooks["task16-registered-access-transaction"]=sql=>{received=sql;};
 f.adapters.connectRestrictedClients=async()=>{
  // Source-known snapshot projection/predicate contract observed on the owner
  // SQL wire; this mock neither parses SQL nor proves real SELECT privilege.
  assert.equal(received.includes(JSON.stringify(observerDelta)),true,"missing exact observer snapshot delta on owner wire");return{close:async()=>{}};
 };
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});

test("owner catalog request binds named inputs and TABLE output names types order and defaults",async t=>{
 const f=fixture(t);
 f.hooks["task16-registered-access-preflight"]=sql=>{
  // Observe only the SQL metadata request actually passed to the adapter.
  // No catalog response is claimed and no SQL is parsed/executed here.
  for(const predicate of ["p.proargnames","p.proargmodes","p.proallargtypes","p.pronargdefaults","p.proargdefaults IS NULL","p.provariadic"])
   assert.equal(sql.includes(predicate),true,`catalog interface predicate missing: ${predicate}`);
  for(const metadata of ['"argumentNames":["project_id","projectId","effectiveDate"]','"argumentModes":["i","t","t"]','"allArgumentTypes":["text","text","date"]','"argumentNames":["tableName","columnName","exclusive"]','"argumentNames":["execution_id","authority","before_update"]'])assert.equal(sql.includes(metadata),true,"source-declared function interface missing from catalog request");
 };
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});

test("every lock-only guard catalog request excludes WHEN and UPDATE OF filters",async t=>{
 const f=fixture(t);
 for(const phase of ["task16-registered-access-preflight","task16-registered-access-transaction"])f.hooks[phase]=sql=>{
  const guardPredicates=[...sql.matchAll(/EXISTS\(SELECT 1 FROM pg_catalog\.pg_trigger t[^\n]{0,300}?WHERE t\.tgname='jg_task16_runtime_[a-z_]+_read_only'[^\n]{0,300}?t\.tgtype=19([^)]{0,100})/gu)];assert.ok(guardPredicates.length>0);
  for(const match of guardPredicates)assert.equal(match[1].startsWith(" AND t.tgqual IS NULL AND t.tgattr=''::int2vector"),true,"conditional or column-filtered guard still admitted by owner catalog request");
  if(phase==='task16-registered-access-transaction')for(const [table,trigger] of [['UserPosition','jg_task16_runtime_user_position_read_only'],['ApprovalInstance','jg_task16_runtime_approval_read_only'],['CompanyEntity','jg_task16_runtime_company_read_only']]){
   assert.ok(sql.includes(`t.tgname='${trigger}' AND t.tgrelid='public."${table}"'::regclass AND t.tgfoid=pg_catalog.to_regprocedure('public.jg_task16_runtime_reference_read_only()') AND t.tgtype=19 AND t.tgqual IS NULL AND t.tgattr=''::int2vector`));
  }
 };
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});


test("B6 publishes the observed unrelated-grantee ACL witness for later clients",async t=>{
 const f=fixture(t);const witness=[{kind:"function",objectOid:"41001",columnNumber:0,grantor:"10000",grantee:"30001",privilege:"EXECUTE",grantable:false}];f.replies.committed={otherGranteeAclWitness:witness};
 f.adapters.connectRestrictedClients=async context=>{assert.deepEqual(context.registeredAccess.otherGranteeAclWitness,witness);return{close:async()=>{}};};
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});

test("registered SQL carries only the fixed runtime AuthRateLimit technical grant",async t=>{
 const f=fixture(t);f.hooks["task16-registered-access-transaction"]=sql=>{
  // Observe the actual owner wire; no SQL parsing/execution or real ACL claim.
  assert.equal(sql.includes('"table":"AuthRateLimit","select":["expiresAt","hits","key"],"insert":["expiresAt","hits","key"],"update":["hits"]'),true,'missing exact limiter scalar projection and write columns');
  assert.equal(sql.includes('"technicalAuthRateLimitDelete":true'),true,'missing explicit fixed technical DELETE in the matrix proof');
  assert.equal(sql.includes('GRANT DELETE ON TABLE public."AuthRateLimit" TO jg_task01_runtime;'),true,'missing the unique literal technical DELETE grant');
  assert.equal(sql.includes("role_name='jg_task01_runtime' AND rel.oid=pg_catalog.to_regclass('public.\"AuthRateLimit\"')"),true,'DELETE expectation is not fixed to this role and relation');
  assert.equal(sql.includes("expected:=final_stage AND role_name='jg_task01_runtime'"),true,'before must not receive the final technical DELETE');
  assert.equal(sql.includes("has_table_privilege(role_oid,rel.oid,'SELECT,INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')"),true,'Auth exception must not bypass other broad privileges');
  assert.equal(sql.includes("has_table_privilege(role_oid,rel.oid,'DELETE') IS DISTINCT FROM expected"),true,'every relation must compare DELETE in both directions');
  assert.equal(sql.includes("coalesce(role_plan->'technicalAuthRateLimitDelete'='true'::jsonb,false)"),true,'only the sealed boolean technical exception is accepted');
  assert.equal(sql.includes('a.grantee=0 OR (a.is_grantable'),true,'PUBLIC/grant option rejection remains');
 };
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});

for(const phase of ['preflight','committed'])test(`Schema204 physical metadata missing at ${phase} refuses the public ACL stage`,async t=>{
 const f=fixture(t);f.replies[phase]={schema204PhysicalVerified:false};
 const result=await runTask16RegisteredPg(f.options,f.adapters);
 assert.equal(result.failureCode,'TASK16_REGISTERED_SCHEMA204_PHYSICAL_PROOF');
 assert.equal(result.registeredAccessOutcome,phase==='preflight'?'NOT_ATTEMPTED':'UNKNOWN_DO_NOT_RETRY');
 assert.equal(f.calls.includes('clients'),false);assert.equal(f.calls.at(-1),'close-resource');
});

for(const kind of ['valid','missing','wrong-body','wrong-owner','wrong-oid','same-name-wrong-table','extra-copy','third-party-drift','preexisting'])test(`expanded archive catalog permits only proved B6 approval trigger delta: ${kind}`,async t=>{
 const f=fixture(t),old={indexes:[],relations:[{table:'ApprovalInstance',relationOid:'81000',ownerOid:'10000',rowSecurity:false}],columns:[],constraints:[],triggers:[{table:'ContractArchiveFile',name:'third_party_original',functionOid:'61000'}]};
 const install=f.adapters.installPreparedSql;f.adapters.installPreparedSql=async c=>({...await install(c),installedObjectWitness:structuredClone(old)});
 f.replies.preflight={installedObjectWitness:structuredClone(old),newGuardsAbsent:kind!=='preexisting'};
 f.hooks['task16-registered-access-transaction']=sql=>{
  // A finite independent catalog fixture observes this public SQL protocol;
  // it does not parse/execute SQL or implement a general PostgreSQL engine.
  const exact=["c.relname='ApprovalInstance'","t.tgname='jg_task16_runtime_approval_read_only'","t.tgfoid IS NOT DISTINCT FROM pg_catalog.to_regprocedure('public.jg_task16_runtime_reference_read_only()')","t.tgtype=19","t.tgenabled='A'","NOT t.tgisinternal","t.tgnargs=0","t.tgqual IS NULL","t.tgattr=''::int2vector","NOT t.tgdeferrable","NOT t.tginitdeferred"].every(word=>sql.includes(word));
  const proof=sql.indexOf("RAISE EXCEPTION 'task16 lock-only reference guard missing or changed'"),compare=sql.indexOf("RAISE EXCEPTION 'task16 installed object catalog changed'");
  assert.ok(proof>=0&&compare>proof,'full reference proof must precede normalized catalog equality');
  const after=structuredClone(old),added={table:'ApprovalInstance',name:'jg_task16_runtime_approval_read_only',functionOid:'62000',type:19,enabled:'A',args:0,when:null,columns:'',deferrable:false,initiallyDeferred:false};
  if(kind==='wrong-body'||kind==='wrong-owner'||kind==='missing'||kind==='wrong-oid'||kind==='same-name-wrong-table')throw new Error('bounded exact reference proof rejected');
  if(!exact)after.triggers.push(added);
  if(kind==='extra-copy')after.triggers.push({...added,name:'jg_task16_runtime_approval_read_only_extra'});
  if(kind==='third-party-drift')after.triggers[0].functionOid='61999';
  f.replies.committed={installedObjectWitness:after};
 };
 const result=await runTask16RegisteredPg(f.options,f.adapters);
 if(kind==='valid'){assert.equal(result.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',result.failureCode);assert.equal(f.calls.includes('clients'),true);}
 else{
  assert.equal(result.status,'FAILED_CLOSED');assert.equal(f.calls.includes('clients'),false);
  assert.equal(result.registeredAccessOutcome,kind==='preexisting'?'NOT_ATTEMPTED':'UNKNOWN_DO_NOT_RETRY');
  if(kind==='extra-copy'||kind==='third-party-drift')assert.equal(result.failureCode,'TASK16_REGISTERED_OBJECT_WITNESS');
 }
 assert.equal(f.calls.at(-1),'close-resource');
});
