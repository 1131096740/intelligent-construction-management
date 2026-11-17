"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {runtimePlan,columnGrants,cleanupOwnedContainer}=require("./run-task398-shared-standard-local.cjs");

test("the isolated shared role composes existing cash and voucher plans without granting direct ledger writes",()=>{
 const plan=runtimePlan(),row=name=>plan.runtime.tables.find(item=>item.table===name);
 for(const name of ["OperatingLedgerWriteSecret","OperatingLedgerWriteContext","RegisteredContractHistoryRevision"])assert.equal(row(name),undefined);
 for(const name of ["OperatingFact","OperatingImpactEntry"]){assert.deepEqual(row(name).insert,[]);assert.deepEqual(row(name).update,[]);}
 assert.deepEqual(row("ApprovalInstance").update,["currentNodeIndex","frozenNodes","status","updatedAt"]);
 assert.ok(row("User").update.includes("signatureFileId"));
 assert.ok(row("RegisteredPaymentVoucher").insert.includes("executionId"));
 assert.ok(row("BusinessEntrySubmissionSnapshot").insert.includes("sceneKey"));
 const sql=columnGrants(plan);assert.doesNotMatch(sql,/GRANT (?:SELECT|INSERT|UPDATE) ON ALL TABLES/u);assert.doesNotMatch(sql,/\bxmin\b/u);
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
