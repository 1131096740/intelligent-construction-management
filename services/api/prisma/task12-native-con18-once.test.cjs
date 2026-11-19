'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const runner=require('./run-task12-native-con18-once.cjs');
test('equipment and CON18 plans reject the other purpose before accessing resources',()=>{
 const old=require('./run-task12-native-equipment-once.cjs');
 const plan=Object.fromEntries(['schemaVersion','purpose','runId','database','runRoot','rootIdentity','source','artifacts','dependencies','prismaTools','interfaces','binaryManifest','binaries','openssl','externalLibraries','node','security','limits','differences','officialRuntime'].map(key=>[key,null]));
 plan.schemaVersion=3;
 plan.purpose='TASK12_NATIVE_EQUIPMENT_FULL261_V1';
 assert.throws(()=>runner.validateNativeTask12EquipmentPlan(plan));
 plan.purpose='TASK12_NATIVE_CON18_WITHDRAWAL_V1';
 assert.throws(()=>old.validateNativeTask12EquipmentPlan(plan));
});
test('CON18 runner binds its dedicated purpose and qualifies case/capability/window interfaces',()=>{
 const text=fs.readFileSync(path.join(__dirname,'run-task12-native-con18-once.cjs'),'utf8');
 assert.match(text,/PURPOSE='TASK12_NATIVE_CON18_WITHDRAWAL_V1'/u);assert.match(text,/sourceCapture\(\)/u);assert.match(text,/official\.readPdfDrawnText\(bytes,abort\)/u);
 const specs=runner.inspectNativeTask16Interfaces();for(const file of ['task12-con18-native-capability.cjs','task12-con18-native-owner-window.cjs','task12-con18-loop-delay.cjs','task12-con18-withdrawal-case.js'])assert.ok(specs.some(row=>row.file.endsWith('/'+file)));
 const old=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');assert.match(old,/PURPOSE='TASK12_NATIVE_EQUIPMENT_FULL261_V1'/u);assert.doesNotMatch(old,/TASK12_NATIVE_CON18_WITHDRAWAL_V1/u);
});
test('cleanup failure is secondary and never replaces the first business exception',async()=>{
 const primary=Error('primary'),receipt={};let attempts=0;
 await assert.rejects(runner.closeTask12Con18WithPrimary({closeTask12Con18OwnerWindow:async()=>{attempts++;throw Error('cleanup');}},{},{failed:true,error:primary},receipt),error=>error===primary);
 assert.equal(attempts,1);assert.deepEqual(receipt,{ownerCleanup:'UNKNOWN_DO_NOT_CONTINUE'});
});
test('unmatched owner close cannot yield success and consumes only one close',async()=>{
 let attempts=0;await assert.rejects(runner.closeTask12Con18WithPrimary({closeTask12Con18OwnerWindow:async()=>{attempts++;return {matched:false};}},{},{failed:false},{}));assert.equal(attempts,1);
});
test('document observation never replaces the original failure or exposes read errors',async()=>{
 const api=require('./run-task12-native-con18-once.cjs'),first=Object.assign(Error('PRIVATE_FIRST'),{code:'TASK12_GENERATED_DOCUMENT_DOCUMENT'}),receipt={};let reads=0;
 const observer={async observeTask12Con18Document(){reads++;throw Error('PRIVATE_SQL');},async closeTask12Con18OwnerWindow(){return{matched:false};}};
 await api.observeTask12Con18Failure(observer,{},Object.freeze({}),first,receipt);assert.deepEqual(receipt.documentDiagnostic,{match:'UNAVAILABLE'});assert.equal(reads,1);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE/u);
 await assert.rejects(api.closeTask12Con18WithPrimary(observer,{}, {failed:true,error:first},receipt),e=>e===first);
 await api.observeTask12Con18Failure(observer,{},Object.freeze({}),Object.assign(Error('x'),{code:'OTHER'}),{});assert.equal(reads,1);
});
test('worker observation is released on success, failure and abort without replacing the outcome',async()=>{
 const {withCon18WorkerDiagnostic}=require('./run-task12-native-con18-once.cjs');
 for(const mode of ['success','failure','abort']){const controller=new AbortController(),worker={},token={},calls=[],error=Error('PRIVATE_FIRST');
  const api={armCon18WorkerDiagnostic(value){assert.equal(value,worker);calls.push('arm');return token;},closeCon18WorkerDiagnostic(value,actual){assert.equal(value,worker);assert.equal(actual,token);calls.push('close');}};
  const run=async actual=>{assert.equal(actual,token);if(mode==='abort')controller.abort();if(mode==='failure')throw error;return 'done';};
  if(mode==='failure')await assert.rejects(withCon18WorkerDiagnostic(api,worker,controller.signal,run),e=>e===error);else assert.equal(await withCon18WorkerDiagnostic(api,worker,controller.signal,run),'done');
  assert.deepEqual(calls,['arm','close']);
 }
});
test('worker observer arm and close errors cannot change the case result',async()=>{
 const {withCon18WorkerDiagnostic}=require('./run-task12-native-con18-once.cjs'),signal=new AbortController().signal;
 assert.equal(await withCon18WorkerDiagnostic({armCon18WorkerDiagnostic(){throw Error('private');}}, {},signal,async token=>token===undefined?'done':'bad'),'done');
 const failure=Error('first'),api={armCon18WorkerDiagnostic(){return{};},closeCon18WorkerDiagnostic(){throw Error('private');}};
 await assert.rejects(withCon18WorkerDiagnostic(api,{},signal,async()=>{throw failure;}),e=>e===failure);
});
