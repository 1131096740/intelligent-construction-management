'use strict';
// Protocol seam model only: no PG, SDK, socket or native admission.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function model(first,closeError){
 const calls=[],key={},http={check(){}},handle={},proof={sourceSha:'a'.repeat(40),effectivePlanSha256:'b'.repeat(64)},window={};
 const fixture=Object.freeze({approval:{users:[{id:'actor0'}]}}),result=Object.freeze({goal:'TASK12_FIRST_LOGIN_HTTP_RETURNED',actorUserId:'actor0',httpStatus:201,nativeAdmission:false,cleanupAccepted:false,full394Accepted:false});
 const modules={isTask12LocalLifecycleFixture:f=>f===fixture,async runTask12FirstLoginCase(input){calls.push('first-post');assert.equal(input.fixture,fixture);if(first)throw first;return result;}};
 const owner={async beginCurrent261FirstLoginOwnerWindow(){calls.push('owner-begin');return window;},async observeCurrent261FirstLoginOwner(w,value){assert.equal(w,window);calls.push(value===result?'owner-http-returned':'owner-http-failed');return{authObserved:true};},async closeCurrent261FirstLoginOwnerWindow(w){assert.equal(w,window);calls.push('owner-close');if(closeError)throw closeError;return Object.freeze({status:'CURRENT261_FIRST_LOGIN_OWNER_CLOSED',authObserved:true,full394Accepted:false});}};
 const grant={handle,proof,modules,config:{fixture,passwords:{actor0:'a'.repeat(64)},signal:new AbortController().signal},check(){}};
 const imports={'./task12-current261-local-lifecycle-http.cjs':{assertCurrent261FirstLoginHttp:h=>assert.equal(h,http)},'./task12-current259-document-login.cjs':{takeCurrent261FirstLoginExerciseBridge:k=>{assert.equal(k,key);return grant;}},'./task12-current261-first-login-owner.cjs':owner};
 const holder={exports:{}};new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-current261-first-login-exercise.cjs'),'utf8'))(name=>imports[name]??require(name),holder);
 return{api:holder.exports,calls,run:()=>holder.exports.exerciseCurrent261FirstLogin(key,http)};
}
test('fixed first login closes its independent owner without full lifecycle stages or admission',async()=>{
 const f=model(),outcome=await f.run();assert.deepEqual(f.calls,['owner-begin','first-post','owner-http-returned','owner-close']);
 assert.throws(()=>f.api.projectCurrent261FirstLoginOutcome({...outcome}),/OUTCOME/u);
 const r=f.api.projectCurrent261FirstLoginOutcome(outcome);assert.equal(r.goal,'TASK12_FIRST_LOGIN_HTTP_RETURNED');assert.equal(r.full394Accepted,false);assert.equal(r.nativeAdmission,false);assert.equal(r.cleanupAccepted,false);assert.equal(r.ownerClosed,true);
 assert.throws(()=>f.api.projectCurrent261FirstLoginOutcome(outcome),/OUTCOME/u);
});
test('500 retains original error and reads actual partial auth effects before closing, without retry',async()=>{
 const first=Object.assign(Error('original'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),f=model(first);
 await assert.rejects(f.run(),e=>e===first);assert.deepEqual(f.calls,['owner-begin','first-post','owner-http-failed','owner-close']);
 const facts=f.api.describeCurrent261FirstLoginOwnerObservation(first);assert.equal(facts.authObserved,true);assert.equal(facts.ownerClosed,true);assert.equal(facts.full394Accepted,false);
});
test('owner close failure preserves first error and UNKNOWN, never emits a success result',async()=>{
 const first=Error('first'),f=model(first,Error('close'));
 await assert.rejects(f.run(),e=>e===first&&e.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(f.calls.filter(c=>c==='first-post').length,1);
 assert.equal(f.api.describeCurrent261FirstLoginOwnerObservation(first).ownerClosed,false);
});
