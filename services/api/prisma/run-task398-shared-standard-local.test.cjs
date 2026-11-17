"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const {runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,signatureBindingCheckSql,cleanupOwnedContainer,containerName}=require("./run-task398-shared-standard-local.cjs");
const {createCiDynamicMigrationFixture}=require("./local-staged-ci-dynamic.cjs");

test("names the uniquely labelled container within the existing staged migration policy",()=>{
 const runId="11111111-2222-4333-8444-555555555555",name=containerName(runId);
 assert.equal(name,"jiangkong-task398-shared-11111111222243338444555555555555");
 assert.match(name,/^jiangkong-[a-z0-9-]+$/u);
 assert.doesNotThrow(()=>createCiDynamicMigrationFixture({ciFixture:"DYNAMIC_PAYMENT_EXECUTION_V1",container:{id:"a".repeat(64),name,runId},databaseNames:["jiangkong_payment_execution_concurrency"],temporaryRoot:"/private/tmp/task398-synthetic",dockerCommand:()=>{},deploy:()=>{}}));
 assert.throws(()=>containerName("not-a-run-id"),/TASK398_RUN_ID/u);
});

test("the isolated shared role composes existing cash and voucher plans without granting direct ledger writes",()=>{
 const plan=runtimePlan(),row=name=>plan.runtime.tables.find(item=>item.table===name);
 for(const name of ["OperatingLedgerWriteSecret","OperatingLedgerWriteContext","RegisteredContractHistoryRevision"])assert.equal(row(name),undefined);
 for(const name of ["OperatingFact","OperatingImpactEntry"]){assert.deepEqual(row(name).insert,[]);assert.deepEqual(row(name).update,[]);}
 assert.deepEqual(row("ApprovalInstance").update,["currentNodeIndex","frozenNodes","status","updatedAt"]);
 assert.ok(row("User").update.includes("signatureFileId"));
 assert.ok(row("RegisteredPaymentVoucher").insert.includes("executionId"));
 assert.ok(row("BusinessEntrySubmissionSnapshot").insert.includes("sceneKey"));
 assert.deepEqual(row("ContractDraftAttachment").select,["fileId","slotKey"]);
 assert.deepEqual(row("ContractDraftAttachment").insert,[]);assert.deepEqual(row("ContractDraftAttachment").update,[]);
 assert.deepEqual(row("ContractTakeoverCorrection").select,["attachmentFileId","correctionType","schemaVersion"]);
 assert.deepEqual(row("ContractTakeoverCorrection").insert,[]);assert.deepEqual(row("ContractTakeoverCorrection").update,[]);
 const signatureCheck=signatureBindingCheckSql();
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','fileId','SELECT'\)/u);
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','slotKey','SELECT'\)/u);
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
 assert.match(signatureCheck,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','INSERT,UPDATE,REFERENCES'\)/u);
 for(const column of ["attachmentFileId","correctionType","schemaVersion"])assert.ok(signatureCheck.includes(`has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','${column}','SELECT')`));
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractTakeoverCorrection"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
 assert.match(signatureCheck,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ContractTakeoverCorrection"','INSERT,UPDATE,REFERENCES'\)/u);
 const sql=columnGrants(plan);assert.doesNotMatch(sql,/GRANT (?:SELECT|INSERT|UPDATE) ON ALL TABLES/u);assert.doesNotMatch(sql,/\bxmin\b/u);
 assert.equal(technicalDeleteGrant(plan),'GRANT DELETE ON public."AuthRateLimit" TO jg_task01_runtime;');
 const missing=structuredClone(plan);delete missing.runtime.technicalAuthRateLimitDelete;assert.throws(()=>technicalDeleteGrant(missing),/TASK398_AUTH_RATE_DELETE/u);
 missing.runtime.technicalAuthRateLimitDelete=false;assert.throws(()=>technicalDeleteGrant(missing),/TASK398_AUTH_RATE_DELETE/u);
 const physical=technicalDeleteCheckSql();
 assert.match(physical,/has_table_privilege\('jg_task01_runtime','public\."AuthRateLimit"','DELETE'\)/u);
 assert.match(physical,/c\.oid<>'public\."AuthRateLimit"'::regclass/u);
 assert.match(physical,/NOT EXISTS[\s\S]*has_table_privilege\('jg_task01_runtime',c\.oid,'DELETE'\)/u);
 assert.match(physical,/NOT EXISTS[\s\S]*has_table_privilege\('jg_task01_observer',c\.oid,'DELETE'\)/u);
 assert.throws(()=>columnGrants({runtime:{tables:[{table:'x;DROP',select:['id'],insert:[],update:[]}]}}),/TASK398_IDENTIFIER/u);
});

test("the signature guard can read each schema-backed candidate in the migration registry",()=>{
 const plan=runtimePlan(),migrationRoot=path.join(__dirname,"migrations"),schema=fs.readFileSync(path.join(__dirname,"schema.prisma"),"utf8");
 const models=new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map(match=>match[1]));
 for(const directory of fs.readdirSync(migrationRoot)){
  const file=path.join(migrationRoot,directory,"migration.sql");if(!fs.existsSync(file))continue;
  const source=fs.readFileSync(file,"utf8");if(!source.includes("jg_file_business_binding_columns"))continue;
  for(const match of source.matchAll(/\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*(?:TRUE|FALSE)/giu)){
   if(models.has(match[1]))assert.ok(plan.runtime.tables.find(row=>row.table===match[1])?.select.includes(match[2]),`${directory}: ${match[1]}.${match[2]}`);
  }
 }
 const original=fs.readFileSync(path.join(migrationRoot,"20260728132000_contract_takeover_correction_ledger","migration.sql"),"utf8");
 const guard=original.slice(original.indexOf("CREATE OR REPLACE FUNCTION jg_has_exclusive_file_business_binding"),original.indexOf("CREATE OR REPLACE FUNCTION jg_enforce_exclusive_file_business_binding"));
 const start=guard.indexOf("AS $$")+5,end=guard.indexOf("$$;",start);
 assert.equal(createHash("sha256").update(guard.slice(start,end)).digest("hex"),"2dd031c00d7774dc6ff29376b6bd3f1b4a23579ac19f2a2c76e40ee788deb6c7");
 for(const column of ["attachmentFileId","correctionType","schemaVersion"])assert.ok(guard.includes(`"${column}"`));
 const rewrite=fs.readFileSync(path.join(migrationRoot,"20261109100000_contract_direct_pending_input_v1","migration.sql"),"utf8");
 assert.ok(rewrite.includes('FROM public."ContractDraftAttachment" WHERE "fileId"=candidate_file_id AND "slotKey"='));
 assert.ok(plan.runtime.tables.find(row=>row.table==="RegisteredPaymentVoucher").select.includes("fileId"));
 const requirements=require("./task16-current259-voucher-acl.requirements.json");
 for(const routine of requirements.routineSources)assert.ok(plan.runtime.functions.includes(routine.signature));
 assert.match(require("./contract-bank-runtime-fixture.cjs").renderTask398FileGuardGrant(),/jg_has_exclusive_file_business_binding/u);
});

test("resolves a lost launch ID by exact name and run label, without touching other containers",()=>{
 const id="a".repeat(64),other="b".repeat(64),calls=[];
 const scope={name:"jg398-shared-example",runId:"synthetic-run",list:()=>[id],inspect:()=>({id,name:"jg398-shared-example",runId:"synthetic-run"}),remove:value=>calls.push(value),confirmAbsent:()=>true};
 assert.equal(cleanupOwnedContainer({...scope,id:undefined}),"REMOVED");assert.deepEqual(calls,[id]);
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,list:()=>[]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,inspect:()=>({id,name:scope.name,runId:"other"})}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[other]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[id,other]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,list:()=>{throw new Error("lookup failure");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,inspect:()=>{throw new Error("inspect failure");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[]}),"ABSENT");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,remove:()=>{throw new Error("unknown");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,remove:()=>{},confirmAbsent:()=>false}),"UNKNOWN");
 assert.deepEqual(calls,[id]);
});
