"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,cleanupOwnedContainer,containerName}=require("./run-task398-shared-standard-local.cjs");
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
