'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function model(failure,cleanupFailure,profile='TASK12_OFFICIAL_TEMURIN17_0_17_10_V1'){
 const calls=[],fixture={approval:{users:Array.from({length:8},(_,i)=>({id:'user'+i}))}},scope={kind:'OFFICIAL_TOOL_RUNTIME',profile,source:{head:'a'.repeat(40)},readPdfDrawnText:async()=>[]},tokens=[{},{},{}],summary={},window={};
 const modules={isTask12LocalLifecycleFixture:v=>v===fixture,currentOfficialDocumentScope:()=>scope,readTask12LocalLifecycleSourceDocx:()=>Buffer.from('model-docx'),createTask12LocalLifecycleOriginals:async()=>[Buffer.from('one'),Buffer.from('two')],
  async runTask12LocalLifecycleCase(input){calls.push('http-originals');assert.equal(input.fixture,fixture);assert.equal(input.passwords.length,8);if(failure!==undefined)throw failure;return tokens[0];},
  async expectTask12LocalLifecycleAuditRollback(token){assert.equal(token,tokens[0]);calls.push('http-rollback');return tokens[1];},async finishTask12LocalLifecycleCase(token){assert.equal(token,tokens[1]);calls.push('http-complete');return summary;},
  claimTask12LocalLifecycleCheckpoint(token){assert.equal(token,summary);return{projectId:'project',versionId:'version',generationIds:{first:'generation'}};}};
 const ownermodule={async beginCurrent261LocalLifecycleOwnerWindow(){calls.push('owner-begin');return window;},async observeCurrent261LocalLifecycleOwner(w,token){assert.equal(w,window);calls.push(token===tokens[0]?'owner-originals':token===tokens[1]?'owner-rollback':'owner-complete');},async installCurrent261LocalLifecycleAuditFault(){calls.push('fault-install');},async removeCurrent261LocalLifecycleAuditFault(){calls.push('fault-remove');},async closeCurrent261LocalLifecycleOwnerWindow(){calls.push('owner-close');if(cleanupFailure)throw cleanupFailure;return{matched:true};}};
 const key={},http={check(){}},grant={handle:{},proof:Object.freeze({sourceSha:'a'.repeat(40),effectivePlanSha256:'b'.repeat(64)}),modules,config:{fixture,sourceDocx:Buffer.from('model-docx'),originals:[Buffer.from('one'),Buffer.from('two')],passwords:Object.fromEntries(Array.from({length:8},(_,i)=>['user'+i,'password'+i])),signal:new AbortController().signal},check(){}};
 const imports={'./task12-current261-local-lifecycle-owner.cjs':ownermodule,'./task12-current261-local-lifecycle-http.cjs':{assertCurrent261LocalLifecycleHttp:b=>assert.equal(b,http)},'./task12-current259-document-login.cjs':{takeCurrent261LocalLifecycleExerciseBridge:k=>{assert.equal(k,key);return grant;}}};
 const holder={exports:{}};new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-current261-local-lifecycle-exercise.cjs'),'utf8'))(name=>imports[name]??require(name),holder);
 return{api:holder.exports,calls,run(){return holder.exports.exerciseCurrent261LocalLifecycle(key,http);}};
}
test('life exercise joins three public continuations to independent owner/fault stages and brands only a closed result',async()=>{
 const f=model(),result=await f.run();assert.deepEqual(f.calls,['owner-begin','http-originals','owner-originals','fault-install','http-rollback','owner-rollback','fault-remove','http-complete','owner-complete','owner-close']);
 assert.throws(()=>f.api.projectCurrent261LocalLifecycleOutcome({...result}),/OUTCOME/u);
 const receipt=f.api.projectCurrent261LocalLifecycleOutcome(result);assert.equal(receipt.cosAccepted,false);assert.equal(receipt.full394Accepted,false);assert.equal(receipt.pdfInspection.laterGenerationPdfSemanticInspection,false);
 assert.throws(()=>f.api.projectCurrent261LocalLifecycleOutcome(result),/OUTCOME/u);
});
test('life exercise preserves the first business error when independent owner cleanup is unknown',async()=>{
 const first=Object.assign(Error('FIRST_PUBLIC_FAILURE'),{code:'FIRST_PUBLIC_FAILURE'}),cleanup=Error('OWNER_CLOSE_UNKNOWN'),f=model(first,cleanup);
 await assert.rejects(f.run(),error=>error===first&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
 assert.deepEqual(f.calls,['owner-begin','http-originals','owner-close']);
});

test('a caller cannot issue an exercise outcome with a fake HTTP or source reader bridge',async()=>{
 const actual=require('./task12-current261-local-lifecycle-exercise.cjs');
 await assert.rejects(actual.exerciseCurrent261LocalLifecycle({},Object.freeze({check(){}})),/LIFECYCLE_HTTP/u);
});
test('a non-object first failure is retained as the cleanup wrapper cause',async()=>{
 const f=model(null,Error('CLEANUP_UNKNOWN'));
 await assert.rejects(f.run(),error=>error.cause===null&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
});


test('life exercise accepts the second fixed official context but no unknown profile',async()=>{
 const f=model(undefined,undefined,'TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2');await f.run();assert.ok(f.calls.includes('owner-complete'));
 const unknown=model(undefined,undefined,'arbitrary-runtime');await assert.rejects(unknown.run(),/RUNTIME/u);assert.deepEqual(unknown.calls,[]);
});
