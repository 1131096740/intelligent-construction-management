"use strict";
const TYPE_ACL = [
 {type:'public."OperatingLedgerFactWritePayloadV2"',typeOid:'41001',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false},
 {type:'public."OperatingLedgerImpactWritePayloadV2"',typeOid:'41002',ownerOid:'10000',grantor:'10000',grantee:'10000',privilege:'USAGE',grantable:false}
];
const SCHEMA205_RELATIONS = [
 {table:"ContractDraftAttachment",oid:"63001",kind:"r",rowSecurity:false,forceRowSecurity:false},
 {table:"ContractVersion",oid:"63002",kind:"r",rowSecurity:false,forceRowSecurity:false},
 {table:"FileObject",oid:"63003",kind:"r",rowSecurity:false,forceRowSecurity:false},
 {table:"jg_contract_direct_pending_binding_v1",oid:"63004",kind:"r",rowSecurity:false,forceRowSecurity:false}
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
    const temporary = fs.mkdtempSync("/private/tmp/jg-task16-baseline-acl-protocol-");
    t.after(() => fs.rmSync(temporary, { recursive: true }));
    const ca = path.join(temporary, "ca.crt");
    fs.writeFileSync(ca, "synthetic CA only\n", { mode: 0o600 });
    const migrations = fs.readdirSync(path.join(ROOT, "services/api/prisma/migrations")).filter(name => fs.existsSync(path.join(ROOT, "services/api/prisma/migrations", name, "migration.sql"))).sort().map(name => { const relative = `services/api/prisma/migrations/${name}/migration.sql`; const bytes = fs.readFileSync(path.join(ROOT, relative)); return { path: relative, sha256: hash(bytes), bytes: bytes.length }; });
    const manifestSources = fs.existsSync(path.join(ROOT, "services/api/prisma/task16-baseline-access.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "services/api/prisma/task16-baseline-access.json"), "utf8")).sources.map(row => row.path) : [];
    const code = ["services/api/prisma/task16-baseline-access.cjs", "services/api/prisma/task16-baseline-access.json", "services/api/prisma/task16-baseline-access.sql", ...manifestSources];
    const source = { candidateSha: "a".repeat(40), candidateRoot: ROOT, runtimeAdmission: { status: "INPUTS_AND_CODE_TREES_MATCHED" }, migrations, executionFiles: code.filter(p => fs.existsSync(path.join(ROOT, p))).map(p => ({ path: p, sha256: hash(fs.readFileSync(path.join(ROOT, p))) })), inputs: { docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } } };
    const options = { packetFile: path.join(temporary, "packet.json"), expectedPacketSha256: "b".repeat(64), inputsFile: path.join(temporary, "inputs.json"), expectedInputsSha256: "c".repeat(64), artifactsDir: path.join(temporary, "artifacts") };
    let resource, receipt, passwords;
    const calls = [], replies = {};
    const identity = { databaseOid: "16384", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", ownerOid: "10000", readOnly: "off", loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, tls: true, version: 160004, replication: "origin" };
    const adapters = { verifySource: async () => source, startResource: async (context) => {
            passwords = { ...context.credentials };
            receipt = { ...source.inputs.docker, sourceSha: source.candidateSha, runId: context.runId, containerId: "d".repeat(64), networkId: "e".repeat(64), port: 15432, databaseName: `jg_task01_${context.runId.replaceAll("-", "")}`, status: "started-awaiting-driver-verification", cleanup: { status: "pending" }, tls: { caSha256: hash(fs.readFileSync(ca)) } };
            resource = { containerId: receipt.containerId, networkId: receipt.networkId, databaseName: receipt.databaseName, port: receipt.port, caPath: ca, serverCertHashes: { caSha256: receipt.tls.caSha256 }, getReceipt: () => structuredClone(receipt), execOwnerSql: async (sql, label) => {
                    calls.push(label);
                    const phase = label === "task16-baseline-access-preflight" ? "preflight" : "committed";
                    const nonce = /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1];
                    return { stdout: JSON.stringify({ ...identity, database: receipt.databaseName, nonce, phase, schema204PhysicalVerified: true, schema205PhysicalVerified: true, schema205WitnessSha256: "8".repeat(64), schema205Relations: structuredClone(SCHEMA205_RELATIONS), schema205ScopeObjects:scopeFixture.scope(phase==="preflight"?"first":"baseline"), schema205Registry:scopeFixture.registry(phase==="preflight"?"first":"baseline"), schema205ScopeDelta:phase==="preflight"?null:scopeFixture.delta("baseline"), schema203Verified: true, schema203TypeAclWitness: structuredClone(TYPE_ACL), migrationLedger: migrations.map(row => ({ name: row.path.split("/").at(-2), sha256: row.sha256, finished: true, rolledBack: false })), restrictedAbsent: phase === "preflight", instrumentationAbsent: phase === "preflight", freshScope: phase === "preflight", matrixVerified: phase === "committed", guardVerified: phase === "committed", runtimeRole: "jg_task01_runtime", observerRole: "jg_task01_observer", runtimeOid: "20001", observerOid: "20002", ...replies[phase] }) };
                }, close: async () => { calls.push("close-resource"); receipt.status = "closed"; receipt.cleanup = { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true }; } };
            return resource;
        }, verifyOwnerTransport: async () => ({ status: "OWNER_TLS_CONTROLS_VERIFIED", ...identity, caSha256: hash(fs.readFileSync(ca)) }), migrateBaseline: async () => ({ status: "BASELINE_MIGRATIONS_LEDGER_VERIFIED", migrationCount: 205 }), installBaselineAccess: async (context) => { const { installTask16BaselineAccess } = require("./task16-baseline-access.cjs"); return installTask16BaselineAccess(context); }, installPreparedSql: async (context) => { assert.equal(context.baselineAccess.status, "BASELINE_ROLE_ACL_COMMIT_OBSERVED"); assert.equal(context.baselineAccess.runtimeOid, "20001"); assert.equal(context.baselineAccess.observerOid, "20002"); calls.push("seven-fragments"); }, installRegisteredAccess: async () => { }, connectRestrictedClients: async () => ({ close: async () => { } }), startApplication: async () => ({ close: async () => { } }), seedFixture: async () => ({}), runNormalCase: async () => ({ caseId: "registered.null-cross-company.commit", passed: true }) };
    return { options, adapters, calls, source, replies, resource: () => resource, receipt: () => receipt, passwords: () => passwords };
}
test("baseline role ACL preparation completes before the separate seven-fragment installer", async (t) => {
    const f = fixture(t);
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", receipt.failureCode);
    assert.equal(receipt.nativeExecution, false);
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "task16-baseline-access-transaction", "seven-fragments", "close-resource"]);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime), false);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().observer), false);
});
test("baseline preflight proves the final Schema205 file helper rather than its historical body", async t => {
    const f = fixture(t), start = f.adapters.startResource;
    f.adapters.startResource = async context => {
        const resource = await start(context);
        const owner = resource.execOwnerSql;
        resource.execOwnerSql = async (sql, label) => {
            if (label === "task16-baseline-access-preflight") {
                assert.match(sql, /34c8b2cc5f110c24d67eba3491d580d0f656b6c7bbf1fced769f929b648a8f90/u);
                assert.doesNotMatch(sql, /2dd031c00d7774dc6ff29376b6bd3f1b4a23579ac19f2a2c76e40ee788deb6c7/u);
            }
            return owner(sql, label);
        };
        return resource;
    };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", receipt.failureCode);
});
test("baseline witnesses the NEW trigger with exact definitions under the same safe deparse settings before and after commit", async t => {
    const f = fixture(t), start = f.adapters.startResource;
    const requests = [];
    f.adapters.startResource = async context => {
        const resource = await start(context), owner = resource.execOwnerSql;
        resource.execOwnerSql = async (sql, label) => {
            requests.push([label, sql]);
            return owner(sql, label);
        };
        return resource;
    };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", receipt.failureCode);
    const preflight = requests[0][1], committed = requests[1][1].split("\nCOMMIT;\n").at(-1);
    for (const sql of [preflight, committed]) {
        assert.ok(sql.includes("SET LOCAL search_path=pg_catalog,public,pg_temp;"), "fixed deparse path");
        assert.ok(sql.includes("SET LOCAL quote_all_identifiers=off;"), "fixed identifier quoting");
        assert.ok(sql.includes("pg_catalog.to_regtype('text')::oid=25"), "built-in text resolution");
        assert.ok(sql.includes("pg_catalog.pg_get_triggerdef(t.oid,false)"), "trigger-aware deparse");
        assert.ok(!/pg_get_expr\(\s*(?:[a-z_]+\.)?tgqual\b/u.test(sql), "NEW is never passed to the single-relation deparser");
        assert.ok(sql.includes(" EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding("), "exact qualified form");
        assert.ok(sql.includes(" EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding("), "exact unqualified form");
    }
});

test("baseline requires the Schema205 physical proof before its ACL transaction", async t => {
    const f = fixture(t);
    f.replies.preflight = { schema205PhysicalVerified: false };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SCHEMA205_PHYSICAL_PROOF");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "close-resource"]);
});

test("baseline rejects a Schema205 attachment table with RLS already enabled", async t => {
    const f = fixture(t);
    f.replies.preflight = { schema205Relations: SCHEMA205_RELATIONS.map(row =>
        row.table === "ContractDraftAttachment" ? { ...row, rowSecurity: true } : row) };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SCHEMA205_RELATIONS");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "close-resource"]);
});

test("baseline cannot replace the first column metadata with a different postcommit default", async t => {
    const f=fixture(t), changed=scopeFixture.scope("baseline");
    changed.columns.find(entry=>entry.table==="ContractDraftAttachment").row.defaultNode="unexpected";
    f.replies.committed={schema205ScopeObjects:changed};
    const receipt=await runTask16RegisteredPg(f.options,f.adapters);
    assert.equal(receipt.failureCode,"TASK16_ACCESS_SCHEMA205_OBJECTS_CHANGED");
    assert.equal(receipt.baselineAccessOutcome,"UNKNOWN_DO_NOT_RETRY");
    assert.deepEqual(f.calls,["task16-baseline-access-preflight","task16-baseline-access-transaction","close-resource"]);
});

for(const [phase,variant,change] of [
 ["preflight","target alias already exists",witness=>{witness.alias=scopeFixture.registry("seven").alias;}],
 ["committed","old public wrapper OID changes",witness=>{witness.publicRoutine.oid="63209";}],
 ["committed","third-party grant option is lost",witness=>{witness.publicRoutine.acl.at(-1)[3]=false;}],
 ["committed","schema default raw ACL changes",witness=>{witness.publicDefault.rawAcl=["unknown=X/jg_task01_owner"];}]
]){
 test(`B5 registry continuity rejects ${variant}`,async t=>{
  const f=fixture(t),witness=scopeFixture.registry(phase==="preflight"?"first":"baseline");
  change(witness);
  f.replies[phase]={schema205Registry:witness};
  const receipt=await runTask16RegisteredPg(f.options,f.adapters);
  assert.equal(receipt.failureCode,"TASK16_ACCESS_SCHEMA205_REGISTRY");
  assert.equal(receipt.baselineAccessOutcome,phase==="preflight"?"NOT_ATTEMPTED":"UNKNOWN_DO_NOT_RETRY");
  assert.deepEqual(f.calls,phase==="preflight"
   ?["task16-baseline-access-preflight","close-resource"]
   :["task16-baseline-access-preflight","task16-baseline-access-transaction","close-resource"]);
 });
}

test("baseline rejects an unproved schema203 caller and type boundary before any ACL DDL", async t => {
    const f = fixture(t);
    f.replies.preflight = { schema203Verified: false };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SCHEMA203_PROOF");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "close-resource"]);
});
test("a schema203 caller proof lost at commit remains unknown and cannot install fragments", async t => {
    const f = fixture(t);
    f.replies.committed = { schema203Verified: false };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SCHEMA203_PROOF");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "task16-baseline-access-transaction", "close-resource"]);
});
test("baseline preserves the first observed schema203 type ACL instead of adopting postcommit drift", async t => {
    const f = fixture(t);
    f.replies.committed = { schema203TypeAclWitness: [{ type: "owned-synthetic-type", grantable: true }] };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SCHEMA203_TYPE_ACL_CHANGED");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
    assert.equal(f.calls.at(-1), "close-resource");
});
for (const field of ["restrictedAbsent", "instrumentationAbsent", "freshScope"]) {
    test(`${field} must be positively observed before baseline DDL`, async (t) => {
        const f = fixture(t);
        f.replies.preflight = { [field]: false };
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_FRESH_SCOPE");
        assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
        assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "close-resource"]);
    });
}
for (const change of [{ databaseOid: "26384" }, { systemIdentifier: "8234567890123456789" }, { loginRole: "jg_task01_runtime" }, { replication: "replica" }, { tls: false }]) {
    test(`baseline preflight rejects identity drift ${JSON.stringify(change)}`, async (t) => {
        const f = fixture(t);
        f.replies.preflight = change;
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_DATABASE_IDENTITY");
        assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
        assert.equal(f.calls.includes("seven-fragments"), false);
        assert.equal(f.calls.at(-1), "close-resource");
    });
}
for (const field of ["matrixVerified", "guardVerified"]) {
    test(`a missing effective ${field} proof cannot admit seven-fragment installation`, async (t) => {
        const f = fixture(t);
        f.replies.committed = { [field]: false };
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_EFFECTIVE_MATRIX");
        assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
        assert.equal(f.calls.includes("seven-fragments"), false);
        assert.equal(f.calls.at(-1), "close-resource");
    });
}
const resourceChange = (f, change) => { const start = f.adapters.startResource; f.adapters.startResource = async (...args) => { const r = await start(...args); change(r); return r; }; };
test("an incomplete post-commit ledger remains unknown and stops before seven fragments", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const read = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { const result = await read(sql, label); if (label.endsWith("transaction")) {
        const row = JSON.parse(result.stdout);
        row.migrationLedger.pop();
        return { stdout: JSON.stringify(row) };
    } return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_MIGRATION_LEDGER");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
});
test("a lost baseline commit acknowledgement is not retried or called rolled back", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { if (label.endsWith("transaction")) {
        await exec(sql, label);
        throw Object.assign(new Error(sql), { code: "TASK16_ACCESS_SYNTHETIC_OWNER_FAILURE" });
    } return exec(sql, label); }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SYNTHETIC_OWNER_FAILURE");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.filter(c => c.endsWith("transaction")).length, 1);
    assert.equal(f.calls.includes("seven-fragments"), false);
    assert.equal(f.calls.at(-1), "close-resource");
    assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime), false);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().observer), false);
    assert.equal(JSON.stringify(receipt).includes("CREATE ROLE"), false);
});
test("cancellation while baseline commit acknowledgement arrives remains unknown", async (t) => {
    const f = fixture(t), controller = new AbortController();
    f.options.signal = controller.signal;
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { const result = await exec(sql, label); if (label.endsWith("transaction"))
        controller.abort(); return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_ABORTED");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
    assert.equal(f.calls.at(-1), "close-resource");
});
test("resource and receipt cannot both switch containers after the baseline preflight", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (...args) => { const result = await exec(...args); f.receipt().containerId = "f".repeat(64); r.containerId = f.receipt().containerId; return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_RESOURCE_IDENTITY");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.equal(f.calls.includes("task16-baseline-access-transaction"), false);
    assert.equal(f.calls.at(-1), "close-resource");
});
test("role OIDs must remain distinct from owner and each other", async (t) => {
    const f = fixture(t);
    f.replies.committed = { runtimeOid: "10000" };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_EFFECTIVE_MATRIX");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
});
test("unsealed baseline sources are rejected without an owner SQL call", async (t) => {
    const f = fixture(t);
    f.source.executionFiles[0].sha256 = "0".repeat(64);
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SOURCE_MEMBER");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.deepEqual(f.calls, ["close-resource"]);
});
test("the baseline transaction adapter receives the paired lock grant and guard protocol", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => {
        const exec = r.execOwnerSql;
        r.execOwnerSql = async (sql, label) => {
            if (label.endsWith("transaction")) {
                assert.ok(sql.includes('CREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion"'));
                assert.ok(sql.includes('ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only'));
                assert.ok(sql.includes("'task16 runtime cannot update contract version'"));
                assert.ok(sql.includes("COMMIT;\nBEGIN READ ONLY;\nSET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL quote_all_identifiers=off;\nSELECT pg_catalog.json_build_object"));
                assert.ok(!sql.includes('CREATE TABLE public."RegisteredPaymentFunding"'));
            }
            return exec(sql, label);
        };
    });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", receipt.failureCode);
    // This assertion only observes SQL handed to an explicit mock adapter. It does
    // not establish PostgreSQL parsing, physical row locking or UPDATE rejection.
});
test("preflight preserves the sealed POL275 legacy owner exceptions without granting that role to runtime", async t => {
    const f = fixture(t);
    resourceChange(f, r => {
        const exec = r.execOwnerSql;
        r.execOwnerSql = async (sql, label) => {
            if (label.endsWith("preflight")) {
                assert.ok(sql.includes('"ClearingReconciliationItem":"jg_pol275_owner"'));
                assert.ok(sql.includes('"ClearingReconciliationDecisionSeal":"jg_pol275_owner"'));
            }
            if (label.endsWith("transaction")) assert.equal(/GRANT\s+jg_pol275_owner\s+TO\s+jg_task01_runtime/iu.test(sql), false);
            return exec(sql, label);
        };
    });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED", receipt.failureCode);
    // This checks the explicit SQL adapter protocol, not live catalog ownership.
});

test("baseline version lock guard catalog proof excludes conditional and column filters",async t=>{
 const f=fixture(t);resourceChange(f,r=>{const exec=r.execOwnerSql;r.execOwnerSql=async(sql,label)=>{
  if(label==="task16-baseline-access-transaction"){
   const guards=[...sql.matchAll(/EXISTS\(SELECT 1 FROM pg_catalog\.pg_trigger t[^\n]{0,300}?WHERE t\.tgname='jg_task16_runtime_version_read_only'[^\n]{0,300}?t\.tgtype=19([^)]{0,100})/gu)];assert.ok(guards.length>0);
   for(const guard of guards)assert.equal(guard[1].startsWith(" AND t.tgqual IS NULL AND t.tgattr=''::int2vector"),true,"baseline version guard request must reject WHEN or UPDATE OF");
   assert.ok(sql.includes('CREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion"\nFOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_version_read_only();'));
  }return exec(sql,label);
 };});
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});

for(const observedReturnType of ['text','record'])test(`single-column TABLE catalog protocol ${observedReturnType} is compared with the source interface`,async t=>{
 const f=fixture(t),plan=JSON.parse(fs.readFileSync(path.join(ROOT,'services/api/prisma/task16-baseline-access.json'),'utf8'));
 const impact=plan.schema203.routines.find(row=>row.signature.startsWith('public."appendOperatingImpactThroughService"('));
 const fact=plan.schema203.routines.find(row=>row.signature.startsWith('public."appendOperatingFactThroughService"('));
 assert.equal(fact.returnType,'record');assert.equal(fact.returnsSet,true);assert.equal(impact.returnsSet,true);assert.deepEqual(impact.interface.argumentNames,['p_payload','p_actor_user_id','p_secret','id']);assert.deepEqual(impact.interface.argumentModes,['i','i','i','t']);assert.equal(impact.interface.allArgumentTypes.at(-1),'pg_catalog.text');
 let queries=0;resourceChange(f,r=>{const original=r.execOwnerSql;r.execOwnerSql=async(sql,label)=>{
  // This models the catalog metadata reply, not PostgreSQL or its SQL parser.
  assert.ok(sql.includes(JSON.stringify(plan.schema203.routines).replaceAll("'","''")),'the public owner protocol carries the exact source interface');queries++;
  const result=await original(sql,label),row=JSON.parse(result.stdout);row.schema203Verified=impact.returnType===observedReturnType;return{stdout:JSON.stringify(row)};
 };});
 const receipt=await runTask16RegisteredPg(f.options,f.adapters);
 if(observedReturnType==='text'){assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(queries,2);}
 else{assert.equal(receipt.failureCode,'TASK16_ACCESS_SCHEMA203_PROOF');assert.equal(receipt.baselineAccessOutcome,'NOT_ATTEMPTED');assert.equal(queries,1);assert.equal(f.calls.includes('seven-fragments'),false);}
 assert.equal(f.calls.at(-1),'close-resource');assert.equal(receipt.nativeExecution,false);
});
