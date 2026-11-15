'use strict';
// Explicit clean post-build component: original genuine module view only.
// No SDK instance/connect, Nest assembly/init/listen, qualification or resource.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const runChild=promisify(execFile),cases=['positive','shadow','getter'];
const slot='withTask12NativeHostDocumentRoleServices';
async function observe(scenario){
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');
 const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
 const loader=loadCurrent259Client(observeCurrent259Build()),base=loader.loadGeneratedContractDocumentModules(),view=loader.loadCurrent261LocalLifecycleDocumentModules();
 const original=require(path.join(__dirname,'../dist/database/task12-generated-document-role-services.js'));
 assert.equal(typeof base[slot],'function');assert.equal(typeof view[slot],'function');
 assert.equal(base[slot],original[slot]);assert.equal(view[slot],original[slot]);
 if(scenario==='positive'){loader.check();return;}
 const descriptor=Object.getOwnPropertyDescriptor(original,slot);let traps=0;
 try{
  Object.defineProperty(original,slot,scenario==='getter'?{configurable:true,enumerable:true,get(){traps++;throw Error('MUST_NOT_EXECUTE');}}:{...descriptor,value(){}});
  assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED');assert.equal(traps,0);
 }finally{Object.defineProperty(original,slot,descriptor);}
}
const selected=process.env.JG_TASK12_NATIVE_LOADER_OBSERVED_CASE;
if(selected!==undefined){
 assert.ok(cases.includes(selected));test('genuine native document role slot '+selected,()=>observe(selected));
}else{
 for(const scenario of cases)test('fresh-process genuine native document slot '+scenario,async()=>{
  const result=await runChild(process.execPath,['--test',__filename],{cwd:path.resolve(__dirname,'../../..'),env:{...process.env,JG_TASK12_NATIVE_LOADER_OBSERVED_CASE:scenario},timeout:120000,maxBuffer:1024*1024});
  assert.match(result.stdout,/# pass 1/u);assert.match(result.stdout,/# fail 0/u);assert.match(result.stdout,/# skipped 0/u);
 });
}
