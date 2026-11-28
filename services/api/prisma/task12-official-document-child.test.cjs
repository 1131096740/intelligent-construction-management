'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOfficialDocumentChildBudget}=require('./task12-official-document-child.cjs');
test('child materials are checked on both sides and the operation keeps its first error',async()=>{
 let checks=0;const primary=Object.assign(new Error('first child exit'),{code:'CHILD_EXIT'});
 const budget=createOfficialDocumentChildBudget({checkMaterials(){if(++checks===2)throw Error('postcheck');},remainingTotalMilliseconds(){return 1000;}},1000);
 await assert.rejects(budget.run(async()=>{throw primary;}),error=>error===primary&&error.postcheckFailure.message==='postcheck');
 assert.equal(checks,2);
});
test('a failed material precheck never launches a child',async()=>{
 let ran=false;const budget=createOfficialDocumentChildBudget({checkMaterials(){throw Error('changed');},remainingTotalMilliseconds(){return 1000;}},1000);
 await assert.rejects(budget.run(async()=>{ran=true;}),/changed/u);assert.equal(ran,false);
});
test('precheck costs consume the fixed deadline instead of receiving a fresh child timeout',async()=>{
 const budget=createOfficialDocumentChildBudget({checkMaterials(){},remainingTotalMilliseconds(){return 1000;}},1,performance.now()-10);
 await assert.rejects(budget.run(async()=>assert.fail('expired must not start')),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});
});


test('later continuity errors never overwrite a child error that already carries an earlier postcheck',()=>{
 const {attachPostcheck}=require('./task12-official-document-child.cjs');
 const primary=Object.assign(Error('original child'),{code:'CHILD_EXIT'}),first=Error('first check'),later=Error('final check');
 assert.equal(attachPostcheck(primary,first),primary);
 const combined=attachPostcheck(primary,later);
 assert.equal(combined.cause,primary);assert.equal(primary.postcheckFailure,first);assert.deepEqual(combined.errors,[primary,later]);
});


function timedModel(){
 const fs=require('node:fs'),path=require('node:path');let clock=0;const holder={exports:{}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-official-document-child.cjs'),'utf8'))(
  name=>name==='node:perf_hooks'?{performance:{now:()=>clock}}:require(name),holder);
 return {api:holder.exports,advance(ms){clock+=ms;}};
}
test('fixed child budget separates precheck child and postcheck costs without refreshing its deadline',async()=>{
 const m=timedModel();let checks=0;const trace=[];
 const budget=m.api.createOfficialDocumentChildBudget({checkMaterials(){trace.push('full-check');m.advance(++checks===1?4:16);},remainingTotalMilliseconds(){return 1000;}},25);
 let original;try{await budget.run(async timeout=>{trace.push('child');assert.equal(timeout,21);m.advance(8);return 'done';});}catch(error){original=error;}
 assert.equal(original.code,'TASK12_OFFICIAL_DOCUMENT_DEADLINE');assert.deepEqual(trace,['full-check','child','full-check']);
 assert.deepEqual(budget.timing(),{status:'OBSERVED',setupMs:0,precheckMs:4,childMs:8,postcheckMs:16,elapsedMs:28,firstFailurePhase:'POSTCHECK',childOutcome:'RETURNED',postcheckOutcome:'THREW'});
 assert.equal(Object.isFrozen(budget.timing()),true);
});


test('qualification first failure projects finite child costs without replacing the original error',()=>{
 const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
 const source=fs.readFileSync(path.join(__dirname,'../../../scripts/qualify-task12-official-document-runtime.cjs'),'utf8');
 const firstFailure=new Function('types',source.slice(source.indexOf('function projectChildTiming('),source.indexOf('function errorLogs('))+';return firstFailure;')(types);
 const timing=Object.freeze({status:'OBSERVED',setupMs:1,precheckMs:4,childMs:8,postcheckMs:16,elapsedMs:29,firstFailurePhase:'POSTCHECK',childOutcome:'RETURNED',postcheckOutcome:'THREW'});
 const first=Object.assign(Error('TASK12_OFFICIAL_DOCUMENT_DEADLINE'),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});Object.defineProperty(first,'officialChildTiming',{value:timing});
 const observed=firstFailure(first);assert.equal(observed.code,first.code);assert.deepEqual(observed.childTiming,timing);assert.equal(observed.postcheckFailed,false);
 const wrapped=new AggregateError([first,Error('later')],'wrap',{cause:first});assert.deepEqual(firstFailure(wrapped).childTiming,timing);
 let traps=0;const accessor=Error('unknown');Object.defineProperty(accessor,'officialChildTiming',{get(){traps++;throw Error('PRIVATE');}});assert.equal(firstFailure(accessor).childTiming,undefined);
 for(const patch of [{elapsedMs:-1},{childMs:3600001},{childOutcome:'PRIVATE'},{firstFailurePhase:'PRIVATE'}, {postcheckMs:Infinity}]){const error=Error('unknown');Object.defineProperty(error,'officialChildTiming',{value:{...timing,...patch}});assert.equal(firstFailure(error).childTiming,undefined);}
 const error=Error('unknown');Object.defineProperty(error,'officialChildTiming',{value:new Proxy(timing,{get(){traps++;throw Error('PRIVATE');}})});assert.equal(firstFailure(error).childTiming,undefined);assert.equal(traps,0);
});


test('phase timings retain child first-error and later failed check independently',async()=>{
 const m=timedModel(),first=Error('child private'),later=Error('check private');let checks=0;
 const budget=m.api.createOfficialDocumentChildBudget({checkMaterials(){m.advance(2);if(++checks===2)throw later;},remainingTotalMilliseconds(){return 1000;}},25);
 await assert.rejects(budget.run(async()=>{m.advance(3);throw first;}),error=>error===first&&error.postcheckFailure===later);
 assert.deepEqual(budget.timing(),{status:'OBSERVED',setupMs:0,precheckMs:2,childMs:3,postcheckMs:2,elapsedMs:7,firstFailurePhase:'CHILD',childOutcome:'THREW',postcheckOutcome:'THREW'});
});
test('precheck timing never starts a child and successful timing changes no budget result',async()=>{
 const m=timedModel(),first=Error('precheck');let checks=0;
 const budget=m.api.createOfficialDocumentChildBudget({checkMaterials(){m.advance(2);if(++checks===1)throw first;},remainingTotalMilliseconds(){return 1000;}},25);
 await assert.rejects(budget.run(async()=>assert.fail('precheck failed')),error=>error===first);
 assert.deepEqual(budget.timing(),{status:'OBSERVED',setupMs:0,precheckMs:2,childMs:0,postcheckMs:0,elapsedMs:2,firstFailurePhase:'PRECHECK',childOutcome:'NOT_STARTED',postcheckOutcome:'NOT_STARTED'});
 assert.equal(await budget.run(async()=>{m.advance(3);return 'original result';}),'original result');
 assert.deepEqual(budget.timing(),{status:'OBSERVED',setupMs:2,precheckMs:2,childMs:3,postcheckMs:2,elapsedMs:9,firstFailurePhase:null,childOutcome:'RETURNED',postcheckOutcome:'RETURNED'});
});


test('actual inspector wrapper carries postcheck timings into terminal first failure without retrying the child',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util'),m=timedModel();
 const source=fs.readFileSync(path.join(__dirname,'../../../scripts/qualify-task12-official-document-runtime.cjs'),'utf8');
 const project=new Function('types',source.slice(source.indexOf('function projectChildTiming('),source.indexOf('function errorLogs('))+';return firstFailure;')(types);
 let checks=0,children=0;const writes=[];
 const scope={checkMaterials(){m.advance(++checks===1?4:16);},remainingTotalMilliseconds(){return 100000;},libreOfficeEnv:{HOME:'/owned/home',TMPDIR:'/owned/temp'},pythonSite:'/owned/site',inspectionFonts:[],pythonExecutable:'/owned/python',inspectorPath:'/owned/inspector'};
 const inspect=new Function('fs','path','performance','createOfficialDocumentChildBudget','sha','fixedWrite','exec','types','need',source.slice(source.indexOf('async function inspectPdf('),source.indexOf('async function rejectionBoundaries('))+';return inspectPdf;')(
  {mkdtempSync(){return '/owned/physical';},chmodSync(){},readFileSync(){return Buffer.from('model');}},path,{now:()=>0},
  (s,ms)=>{assert.equal(ms,25000);return m.api.createOfficialDocumentChildBudget(s,25);},()=> 'a'.repeat(64),(file)=>writes.push(file),
  async()=>{children++;m.advance(8);return {stdout:'{}',stderr:''};},types,assert.ok);
 let original;try{await inspect(scope,{runRoot:'/owned',profile:'model'},'java','/owned/pdf','/owned/docx','b'.repeat(64));}catch(error){original=error;}
 assert.equal(original.code,'TASK12_OFFICIAL_DOCUMENT_DEADLINE');assert.equal(checks,2);assert.equal(children,1);assert.deepEqual(writes,['/owned/physical/REQUEST.json']);
 assert.deepEqual(project(original).childTiming,{status:'OBSERVED',setupMs:0,precheckMs:4,childMs:8,postcheckMs:16,elapsedMs:28,firstFailurePhase:'POSTCHECK',childOutcome:'RETURNED',postcheckOutcome:'THREW'});
});
