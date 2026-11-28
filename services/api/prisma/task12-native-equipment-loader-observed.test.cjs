'use strict';
// Explicit clean post-build component: original genuine module view only.
// No SDK instance/connect, Nest assembly/init/listen, qualification or resource.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const runChild=promisify(execFile),cases=['positive','shadow','getter','con18-shadow','con18-getter'];
const slot='withTask12NativeHostDocumentRoleServices';
async function observe(scenario){
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');
 const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
 const loader=loadCurrent259Client(observeCurrent259Build()),base=loader.loadGeneratedContractDocumentModules(),view=loader.loadCurrent261LocalLifecycleDocumentModules();
 const original=require(path.join(__dirname,'../dist/database/task12-generated-document-role-services.js'));
 const con18=require(path.join(__dirname,'../dist/database/task12-con18-withdrawal-case.js'));
 assert.equal(typeof base[slot],'function');assert.equal(typeof view[slot],'function');
 assert.equal(base[slot],original[slot]);assert.equal(view[slot],original[slot]);
 assert.equal(typeof view.runTask12Con18Withdrawal,'function');assert.equal(view.runTask12Con18Withdrawal,con18.runTask12Con18Withdrawal);
 if(scenario==='positive'){loader.check();return;}
 const target=scenario.startsWith('con18-')?con18:original,key=scenario.startsWith('con18-')?'runTask12Con18Withdrawal':slot;
 const descriptor=Object.getOwnPropertyDescriptor(target,key);let traps=0;
 try{
  Object.defineProperty(target,key,scenario.endsWith('getter')?{configurable:true,enumerable:true,get(){traps++;throw Error('MUST_NOT_EXECUTE');}}:{...descriptor,value(){}});
  assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED');assert.equal(traps,0);
 }finally{Object.defineProperty(target,key,descriptor);}
}
const selected=process.env.JG_TASK12_NATIVE_LOADER_OBSERVED_CASE;
if(selected!==undefined){
 assert.ok(cases.includes(selected));test('genuine native document role slot '+selected,()=>observe(selected));
}else{
 for(const scenario of cases)test('fresh-process genuine native document slot '+scenario,async()=>{
  const env={...process.env,JG_TASK12_NATIVE_LOADER_OBSERVED_CASE:scenario};delete env.NODE_TEST_CONTEXT;
  const result=await runChild(process.execPath,[__filename],{cwd:path.resolve(__dirname,'../../..'),env,timeout:120000,maxBuffer:1024*1024});
  assert.match(result.stdout,/# pass 1/u);assert.match(result.stdout,/# fail 0/u);assert.match(result.stdout,/# skipped 0/u);
 });
}
