"use strict";
// Task16 source case bridge only. No SDK, network or resource work on import.
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
const {takeTask16SeedHandoff:take,releaseTask16SeedHandoff:release,validateTask16SeedAdmission:validateSeed}=require('./task16-seed-fixture.cjs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..');
const fault=()=>Object.assign(new Error('TASK16_CASE_FAILED_CLOSED'),{code:'TASK16_CASE_FAILED_CLOSED'});
const need=ok=>{if(!ok)throw fault();};
const fixed=(context,key)=>{const d=Object.getOwnPropertyDescriptor(context,key);need(d&&d.writable===false&&d.configurable===false);return d.value;};
function validateTask16CaseAdmission(context){
 validateSeed(context);const first=fixed(context,'normalCaseAdmissionWitness'),build=fixed(context,'applicationBuildWitness');need(first&&first.entry?.path===path.join(ROOT,'services/api/dist/database/registered-payment-postgres.cases.js')&&first.entry.identity&&JSON.stringify(first.build)===JSON.stringify(build));need(first.build.candidateRoot===ROOT&&first.build.sourceSha===context.source.candidateSha&&first.build.sourceSealSha256===context.source.sealSha256&&read(first.entry.path,{maxBytes:64*1024*1024,expectedIdentity:first.entry.identity,code:'TASK16_CASE_ENTRY'}).sha256===first.entry.sha256);
 const paths=['services/api/prisma/task16-normal-case.cjs','services/api/prisma/run-task16-registered-pg-local.cjs','services/api/prisma/task16-runtime-inputs.cjs','services/api/prisma/task16-client-loader.cjs','services/api/prisma/task16-restricted-clients.cjs','services/api/prisma/task16-seed-fixture.cjs','services/api/src/database/registered-payment-postgres.cases.ts','services/api/src/database/registered-payment-postgres.fixture.ts'];
 need(first.sources?.length===paths.length&&first.sources.every((row,i)=>row.path===paths[i]&&row.identity&&context.source.executionFiles?.filter(member=>member.path===row.path&&member.sha256===row.sha256).length===1));for(const row of first.sources)need(read(path.join(ROOT,row.path),{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_CASE_SOURCE'}).sha256===row.sha256);return first;
}
const runs=new WeakMap();
async function runTask16NormalCase(context){
 const previous=runs.get(context);if(previous)throw Object.assign(fault(),{normalCaseOutcome:previous.wrote?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED'});
 const state={wrote:false};runs.set(context,state);let handoff;
 try{
  const admission=validateTask16CaseAdmission(context),life=fixed(context,'clientLifecycleWitness');need(life&&typeof life.loadNormalCaseModules==='function');const load=life.loadNormalCaseModules;handoff=take(context);const check=()=>{need(!context.signal.aborted&&context.clients===life.handle&&Object.getOwnPropertyDescriptor(life.handle,'loadNormalCaseModules')?.value===load&&JSON.stringify(context.source.runtimeAdmission.normalCase)===JSON.stringify(admission));validateTask16CaseAdmission(context);handoff.checkLight();};
  check();await handoff.verifyFull();check();const loaded=load();check();const plan=handoff.snapshot.plan;
  const assertHttpRequest=(route,method)=>{check();const options=`/payment-executions/${plan.ids.payment}/registration-options`,registration=`/payment-executions/${plan.ids.payment}/registrations`,result=`/payment-executions/results/${plan.ids.requestKey}`;need(method==='GET'&&(route===options||route===result)||method==='POST'&&route===registration);if(method==='POST')state.wrote=true;};
  const result=await loaded.runRegisteredNullCrossCompanyCommit(handoff.execution,handoff.snapshot,Object.freeze({checkLight:check,fetch:handoff.transport,assertHttpRequest}));check();await handoff.verifyFull();check();need(result?.caseId==='registered.null-cross-company.commit'&&result.passed===true);return result;
 }catch{throw Object.assign(fault(),{normalCaseOutcome:state.wrote?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED'});}finally{release(context);handoff=undefined;}
}
module.exports={runTask16NormalCase,validateTask16CaseAdmission};
