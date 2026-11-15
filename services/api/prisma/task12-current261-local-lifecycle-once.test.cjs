'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {model}=require('../test-support/task12-lifecycle-main-model.cjs');
test('life pending qualification fails before attempt or any owned resource',async t=>{
 const f=model(t,{failure:'pending'}),r=await f.result();assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_STOPPED');assert.equal(r.reason,'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING');assert.deepEqual(f.calls,['verify']);assert.equal(fs.readdirSync(f.plan.run.root).length,0);
});
test('life once consumes exactly one real producer chain, separate tool root and branded outcome',async t=>{
 const f=model(t),r=await f.result();assert.deepEqual(f.calls,['verify','resource','migrate','roles','archive','ordinary','document-roles','document-acl','runtime','application','application-close','project','runtime-close','resource-close']);
 assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_PROTOCOL_COMPLETE');assert.equal(r.cleanup,'CLOSED');assert.equal(r.outcome.full394Accepted,false);assert.equal(r.storage,'LOCAL_ONLY');
 assert.deepEqual(JSON.parse(fs.readFileSync(f.plan.run.receiptFile)),r);assert.equal(f.listeners.size,0);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});
test('spent attempt and old business date never start resources or overwrite old markers',async t=>{
 for(const options of [{used:true},{date:'2000-01-01'}]){const f=model(t,options),r=await f.result();assert.equal(r.attempted,false);assert.deepEqual(f.calls,['verify']);if(options.used)assert.equal(fs.readFileSync(f.plan.run.attemptFile,'utf8'),'OLD');}
});
test('every producer failure stops the chain once and retains independent cleanup',async t=>{
 for(const failure of ['migrate','roles','archive','ordinary','document-roles','document-acl']){const f=model(t,{failure}),r=await f.result();assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_STOPPED');assert.equal(r.outcome,undefined);assert.equal(f.calls.at(-1),'resource-close');assert.equal(f.calls.filter(v=>v===failure).length,1);assert.equal(f.calls.includes('application'),false);}
});
test('unknown owner cleanup is never a successful local-only receipt',async t=>{
 const f=model(t,{failure:'owner-cleanup'}),r=await f.result();assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_STOPPED');assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.outcome,undefined);assert.equal(f.calls.includes('project'),false);
});

test('life business failure remains primary when resource cleanup replaces the thrown error',async t=>{
 const f=model(t,{failure:'business',cleanupFailure:true}),r=await f.result();
 assert.equal(r.reason,'CURRENT259_GENERATED_DOCUMENT_EXERCISE_RESULT');
 assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');
 assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');assert.equal(r.outcome,undefined);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});

test('DACL fixed SQLSTATE remains the primary stage detail when outer cleanup fails',async t=>{
 const f=model(t,{failure:'dacl-diagnostic',cleanupFailure:true}),r=await f.result();
 assert.equal(r.reason,'CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED');
 assert.deepEqual(r.documentAclFailure,{phase:'WRITE',reason:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'42501',section:'COLUMN_GRANT'});
 assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');assert.equal(r.cleanup,'UNKNOWN');
 assert.equal(f.calls.includes('application'),false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});

const hbaFailureCodes=['SCOPE','PREIMAGE','READBACK','FILE','RELOAD','PLAINTEXT'].map(part=>'TASK01_RESOURCE_DOCUMENT_HBA_'+part);
function consumeFailure(cause,phase='CONSUME'){
 const error=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase});
 if(cause!==undefined)Object.defineProperty(error,'cause',{value:cause});return error;
}
test('fixed HBA producer failures remain primary only inside the original consume context',async t=>{
 for(const code of hbaFailureCodes){
  const f=model(t,{applicationFailure:consumeFailure(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code})),cleanupFailure:true});
  const r=await f.result();assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:code});assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.failureStage,'CONSUME');
  assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
  assert.equal(r.outcome,undefined);assert.equal(f.calls.includes('project'),false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
 }
});
test('HBA-looking codes outside consume, prefixes, getters and proxies never become HBA diagnostics',async t=>{
 let getterReads=0;const getter={};Object.defineProperty(getter,'code',{get(){getterReads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 const causeGetter={code:'UNKNOWN'};Object.defineProperty(causeGetter,'cause',{get(){getterReads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 const proxy=new Proxy({code:hbaFailureCodes[0]},{getOwnPropertyDescriptor(){throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const inner of [{code:'TASK01_RESOURCE_DOCUMENT_HBA_PREFIX_UNKNOWN'},{code:'TASK01_RESOURCE_COMMAND_FAILED_PREFIX_UNKNOWN'},getter,causeGetter,proxy]){
  const r=await model(t,{applicationFailure:consumeFailure(inner),cleanupFailure:true}).result();
  assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(r.documentLoginFailure,undefined);assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');
  assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
 }
 for(const phase of ['WRITE',undefined]){
  const e=consumeFailure({code:hbaFailureCodes[0]},phase);if(phase===undefined)delete e.phase;
  const r=await model(t,{applicationFailure:e}).result();assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(r.documentLoginFailure,undefined);
 }
 const r=await model(t,{applicationFailure:{code:hbaFailureCodes[0]}}).result();assert.equal(r.reason,undefined);assert.equal(r.documentLoginFailure,undefined);
 const cyclic=consumeFailure(undefined);Object.defineProperty(cyclic,'cause',{value:cyclic});
 const cr=await model(t,{applicationFailure:cyclic}).result();assert.equal(cr.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(cr.documentLoginFailure,undefined);
 let deep={code:hbaFailureCodes[0]};for(let i=0;i<6;i++){const next={};Object.defineProperty(next,'cause',{value:deep});deep=next;}
 const dr=await model(t,{applicationFailure:consumeFailure(deep)}).result();assert.equal(dr.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(dr.documentLoginFailure,undefined);
 assert.equal(getterReads,0);
});

const sharedConsumeResourceCodes=[
 'TASK01_RESOURCE_ABORTED_OR_TIMEOUT','TASK01_RESOURCE_COMMAND_TIMEOUT','TASK01_RESOURCE_ABORTED',
 'TASK01_RESOURCE_OUTPUT_LIMIT','TASK01_RESOURCE_COMMAND_FAILED','TASK01_RESOURCE_DAEMON_CHANGED',
 'TASK01_RESOURCE_NETWORK_CHANGED','TASK01_RESOURCE_NETWORK_OTHER_OWNER','TASK01_RESOURCE_CONTAINER_CHANGED',
 'TASK01_RESOURCE_LIMITS_CHANGED','TASK01_RESOURCE_MOUNTS_CHANGED','TASK01_RESOURCE_PORT_CHANGED',
 'TASK01_RESOURCE_UNEXPECTED_IMAGE_VOLUME','TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED','TASK01_RESOURCE_SQL_INPUT_INVALID',
 'TASK01_RESOURCE_CLOSED','TASK01_RESOURCE_RECEIPT_PATH_CHANGED','TASK01_RESOURCE_METADATA_INVALID','TASK01_RESOURCE_OPERATION_FAILED'
];
test('existing shared consume-resource codes supplement the primary without claiming an HBA cause',async t=>{
 for(const code of sharedConsumeResourceCodes){
  const r=await model(t,{applicationFailure:consumeFailure(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code})),cleanupFailure:true}).result();
  assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.failureStage,'CONSUME');
  assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:code});assert.deepEqual(Object.keys(r.documentLoginFailure),['phase','resourceCode']);
  assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
  assert.equal(r.outcome,undefined);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
  const outside=await model(t,{applicationFailure:consumeFailure({code},'WRITE')}).result();assert.equal(outside.documentLoginFailure,undefined);
 }
 const bare=await model(t,{applicationFailure:{code:'TASK01_RESOURCE_COMMAND_FAILED'}}).result();assert.equal(bare.documentLoginFailure,undefined);
});

test('scope predicate details supplement CONSUME without changing primary, cleanup or unknown',async t=>{
 const detail=Object.freeze({predicate:'PRIVATE_SCOPE',subphase:'READ_BEFORE'});
 const cause={code:hbaFailureCodes[0],documentHbaScope:detail};
 const r=await model(t,{applicationFailure:consumeFailure(cause),cleanupFailure:true}).result();
 assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:hbaFailureCodes[0],scopePredicate:'PRIVATE_SCOPE',scopeSubphase:'READ_BEFORE'});
 assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');
 assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
 let reads=0;const getter={};Object.defineProperty(getter,'predicate',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 const proxy=new Proxy(detail,{getOwnPropertyDescriptor(){throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const bad of [{predicate:'PRIVATE_SCOPE_UNKNOWN',subphase:'ENTRY'}, {predicate:'PRIVATE_SCOPE',subphase:'DYNAMIC_ID'},getter,proxy,
  {predicate:'PRIVATE_SCOPE',subphase:'ENTRY',password:'PRIVATE_DO_NOT_PRINT'}]){
  const result=await model(t,{applicationFailure:consumeFailure({code:hbaFailureCodes[0],documentHbaScope:bad})}).result();
  assert.deepEqual(result.documentLoginFailure,{phase:'CONSUME',resourceCode:hbaFailureCodes[0]});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DO_NOT_PRINT/u);
 }
 assert.equal(reads,0);
 const other=await model(t,{applicationFailure:consumeFailure({code:'TASK01_RESOURCE_COMMAND_FAILED',documentHbaScope:detail})}).result();
 assert.deepEqual(other.documentLoginFailure,{phase:'CONSUME',resourceCode:'TASK01_RESOURCE_COMMAND_FAILED'});
});

const privateScopeCodes=["CURRENT259_DOCUMENT_LOGIN_HANDLE", "CURRENT259_DOCUMENT_LOGIN_CONTINUITY", "CURRENT259_DOCUMENT_LOGIN_ROLE_RUNTIME", "CURRENT259_DOCUMENT_ACL_TRANSPORT_CONTINUITY", "CURRENT259_DOCUMENT_ROLE_PROVISION_CONTINUITY", "CURRENT259_ORDINARY_ARCHIVE_ACL_CONTINUITY", "CURRENT259_LOADER_CHANGED", "CURRENT259_RESOURCE_CLOSED", "CURRENT259_RESOURCE_ABORTED", "CURRENT259_RESOURCE_SIGNAL", "CURRENT259_RESOURCE_PRODUCER_CHANGED", "CURRENT259_RESOURCE_TOOL_CHANGED", "CURRENT259_RESOURCE_CHANGED", "CURRENT259_RESOURCE_IDENTITY", "CURRENT259_RESOURCE_PURPOSE", "CURRENT259_RESOURCE_TLS", "TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED", "TASK12_OFFICIAL_DOCUMENT_CONTINUITY", "TASK12_OFFICIAL_DOCUMENT_DEADLINE", "TASK12_OFFICIAL_DOCUMENT_MODULES"];
test('private scope codes supplement only exact consume scope and preserve first plus secondary',async t=>{
 for(const code of privateScopeCodes){
  const r=await model(t,{applicationFailure:consumeFailure({code:hbaFailureCodes[0],documentHbaScope:{predicate:'PRIVATE_SCOPE',subphase:'PLAINTEXT',privateScopeCode:code}}),cleanupFailure:true}).result();
  assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:hbaFailureCodes[0],scopePredicate:'PRIVATE_SCOPE',scopeSubphase:'PLAINTEXT',privateScopeCode:code});
  assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
 }
 let reads=0;const getter={predicate:'PRIVATE_SCOPE',subphase:'ENTRY'};Object.defineProperty(getter,'privateScopeCode',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const detail of [getter,{predicate:'PRIVATE_SCOPE',subphase:'ENTRY',privateScopeCode:'EACCES'},{predicate:'PRIVATE_SCOPE',subphase:'ENTRY',privateScopeCode:'CURRENT259_LOADER_CHANGED_PREFIX'},{predicate:'BIND_SOURCE',subphase:'ENTRY',privateScopeCode:'CURRENT259_LOADER_CHANGED'}]){
  const r=await model(t,{applicationFailure:consumeFailure({code:hbaFailureCodes[0],documentHbaScope:detail})}).result();assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:hbaFailureCodes[0]});assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
 }assert.equal(reads,0);
});

test('role cleanup uncertainty preserves a closed nested relay failure without exposing private data',async t=>{
 const raw=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
 Object.defineProperties(raw,{relayCode:{value:'CURRENT259_LOOPBACK_FORWARD_FRAME'},relayFrameStage:{value:'STDOUT_EOF_WITHOUT_FIN'},relayChildExitCode:{value:47}});
 const e=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase:'CONSUME',reason:'ROLE_CLEANUP_UNKNOWN',appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
 Object.defineProperty(e,'cause',{value:raw});
 const r=await model(t,{applicationFailure:e}).result();
 assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_ROLE_CLEANUP_UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
 assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47});
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});
test('relay diagnostics reject unknown values and accessors and require matching frame context',async t=>{
 let reads=0;
 const accessor={};Object.defineProperty(accessor,'relayCode',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const detail of [accessor,{relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME_BAD'},{relayCode:new String('CURRENT259_LOOPBACK_FORWARD_FRAME')},new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE_DO_NOT_PRINT');}})]){
  const raw=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
  Object.defineProperties(raw,Object.getOwnPropertyDescriptors(detail));
  const r=await model(t,{applicationFailure:consumeFailure(raw)}).result();
  assert.deepEqual(r.documentLoginFailure,{phase:'CONSUME',resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
 }
 assert.equal(reads,0);
 for(const detail of [
  {relayCode:'CURRENT259_LOOPBACK_FORWARD_CLOSED',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47},
  {relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'PRIVATE_DO_NOT_PRINT',relayChildExitCode:47},
  {relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:49}]){
  const raw=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'},detail);
  const r=await model(t,{applicationFailure:consumeFailure(raw)}).result();
  assert.equal(r.documentLoginFailure.relayCode,detail.relayCode);assert.equal(r.documentLoginFailure.relayChildExitCode,undefined);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
 }
});
test('nested relay diagnostics retain only reserved sysread classes and fixed boolean close state',async t=>{
 const state={hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:true,cliClosed:true,stdoutRawEnd:true,receiveSettled:false,cliExited:true,peerSocketDestroyed:true,peerEndReturned:false,private:'PRIVATE_DO_NOT_PRINT'};
 const raw=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,relayCloseState:state});
 const r=await model(t,{applicationFailure:consumeFailure(raw)}).result();
 assert.equal(r.documentLoginFailure.relaySysreadExit,70);
 assert.deepEqual(r.documentLoginFailure.relayCloseState,{hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:true,cliClosed:true,stdoutRawEnd:true,receiveSettled:false,cliExited:true,peerSocketDestroyed:true,peerEndReturned:false});
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});
test('reserved sysread and close diagnostics reject malformed or mismatched metadata',async t=>{
 let reads=0;const getter={};Object.defineProperty(getter,'hostFin',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const exit of [70,71,72,73,74,75,69,76,'70']){
  const raw={code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:exit,relayCloseState:getter};
  const r=await model(t,{applicationFailure:consumeFailure(raw)}).result();
  assert.equal(r.documentLoginFailure.relaySysreadExit,typeof exit==='number'&&exit>=70&&exit<=75?exit:undefined);
  assert.equal(r.documentLoginFailure.relayCloseState,undefined);
 }
 for(const patch of [{relayChildExitCode:0},{relayFrameStage:'DATA_AFTER_FIN'},{relayCode:'CURRENT259_LOOPBACK_FORWARD_CLOSED'}]){
  const raw={code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,...patch};
  const r=await model(t,{applicationFailure:consumeFailure(raw)}).result();assert.equal(r.documentLoginFailure.relaySysreadExit,undefined);
 }
 assert.equal(reads,0);
});
test('consumer phase diagnostics survive cleanup uncertainty with closed timing and disposition fields',async t=>{
 const detail={subphase:'OWNER_BEFORE',lastGuardMs:6123,maxGuardMs:7000,boundedTimeout:false,disconnectRejected:false,drainRejected:true};
 const e=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase:'CONSUME',reason:'ROLE_CLEANUP_UNKNOWN',documentRoleFailure:detail});
 const r=await model(t,{applicationFailure:e}).result();
 assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_ROLE_CLEANUP_UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');
 assert.deepEqual(r.documentRoleFailure,detail);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
});

test('consumer diagnostics reject arbitrary stages, timing ranges, getters, and extra private values',async t=>{
 const valid={subphase:'SEED_COMMITTED',lastGuardMs:5000,maxGuardMs:6000,boundedTimeout:false,disconnectRejected:false,drainRejected:true};
 let reads=0;const getter={...valid};Object.defineProperty(getter,'lastGuardMs',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const detail of [{...valid,subphase:'PRIVATE_DO_NOT_PRINT'},{...valid,lastGuardMs:-1},{...valid,maxGuardMs:4999},{...valid,maxGuardMs:3600001},{...valid,lastGuardMs:1.2},{...valid,drainRejected:'true'},{...valid,secret:'PRIVATE_DO_NOT_PRINT'},getter,new Proxy(valid,{ownKeys(){throw Error('PRIVATE_DO_NOT_PRINT');}})]){
  const e=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase:'CONSUME',reason:'ROLE_CLEANUP_UNKNOWN',documentRoleFailure:detail});
  const r=await model(t,{applicationFailure:e}).result();assert.equal(r.documentRoleFailure,undefined);assert.equal(r.businessOutcome,'UNKNOWN');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DO_NOT_PRINT/u);
 }
 assert.equal(reads,0);
 const outside=Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase:'WRITE',documentRoleFailure:valid});
 assert.equal((await model(t,{applicationFailure:outside}).result()).documentRoleFailure,undefined);
});

test('actual fresh contract main issues a private token only for its own ACL application and revokes after success',async t=>{
 const f=model(t,{continuityProbe(api,token,handle){
  assert.equal(Object.isFrozen(token),true);
  assert.throws(()=>api.assertCurrent261ContractBusinessContinuity(Object.freeze({}),handle));
  assert.equal(api.assertCurrent261ContractBusinessContinuity(token,handle),true);
 }});const r=await f.result();assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_PROTOCOL_COMPLETE');
 assert.equal(f.fullChecks(),21,'full preflight, all eight stage entry/exits, business callback, projection and final completion checks remain');
 assert.throws(()=>f.api.assertCurrent261ContractBusinessContinuity(f.token,{}));
});
test('actual fresh contract main revokes on application failure and refuses modified input/parent identity',async t=>{
 for(const mutation of ['throw','plan-bytes','parent']){
  const f=model(t,{continuityProbe(api,token,handle,plan){
   if(mutation==='throw')throw new Error('PRIVATE_DO_NOT_PRINT');
   if(mutation==='plan-bytes')fs.appendFileSync(path.join(path.dirname(plan.run.root),'LIFECYCLE-PLAN.json'),' ');
   else{const root=plan.run.root;fs.renameSync(root,root+'-old');fs.mkdirSync(root,{mode:0o700});fs.renameSync(path.join(root+'-old','attempt.json'),plan.run.attemptFile);}
   assert.throws(()=>api.assertCurrent261ContractBusinessContinuity(token,handle));
   throw new Error('PRIVATE_DO_NOT_PRINT');
  }});const r=await f.result();assert.equal(r.status,'CURRENT261_LOCAL_LIFECYCLE_STOPPED');
  assert.throws(()=>f.api.assertCurrent261ContractBusinessContinuity(f.token,{}));
 }
});

test('shared main model uses an exclusive canonical TMPDIR when the platform private temp prefix is unavailable',async t=>{
 const os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'jg-life-model-tmpdir-'));
 t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const helper=path.resolve(__dirname,'../test-support/task12-lifecycle-main-model.cjs');
 const child=String.raw`
  const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
  const helper=process.argv[1],callbacks=[],modulePort={exports:{}};
  // Only this fixture's filesystem port models the absent platform path. The
  // host filesystem, globals, production checks and other tests stay untouched.
  const fsPort={...fs,mkdtempSync(prefix,...args){
   if(prefix==='/private/tmp/jg-life-once-model-')throw Object.assign(Error('SIMULATED_PLATFORM_TEMP_UNAVAILABLE'),{code:'ENOENT'});
   return fs.mkdtempSync(prefix,...args);
  }};
  new Function('require','module','__dirname',fs.readFileSync(helper,'utf8'))(name=>name==='node:fs'?fsPort:require(name),modulePort,path.dirname(helper));
  (async()=>{try{
   const f=modulePort.exports.model({after(fn){callbacks.push(fn);}}),result=await f.result();
   const root=path.dirname(f.plan.run.root),canonical=fs.realpathSync(process.env.TMPDIR);
   assert.equal(path.dirname(root),canonical);assert.ok(path.basename(root).startsWith('jg-life-once-model-'));
   assert.equal(fs.realpathSync(root),root);assert.equal(result.status,'CURRENT261_LOCAL_LIFECYCLE_PROTOCOL_COMPLETE');assert.equal(result.outcome.full394Accepted,false);
  }finally{for(const cleanup of callbacks.reverse())cleanup();}})().catch(error=>{console.error(error);process.exitCode=1;});
 `;
 const result=await promisify(execFile)(process.execPath,['-e',child,helper],{env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:temporary,LANG:'en_US.UTF-8'},timeout:10000,maxBuffer:1024*1024});
 assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.deepEqual(fs.readdirSync(temporary),[]);
});

test('fixed auth-only main uses its diagnostic producers and independent close, preserving one-shot and full-purpose separation',async t=>{
 const f=model(t,{authOnly:true}),r=await f.result();assert.equal(r.status,'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_COMPLETE');assert.equal(r.cleanup,'CLOSED');assert.equal(r.executionPurpose,'AUTH_ONLY_DIAGNOSTIC');
 assert.deepEqual(f.calls,['verify','resource','auth-bootstrap','roles','archive','ordinary','document-roles','document-acl','runtime','application','application-close','project-auth','runtime-close','resource-close']);
 assert.equal(r.outcome.goal,'TASK12_FIRST_LOGIN_HTTP_RETURNED');assert.equal(r.outcome.full394Accepted,false);assert.equal(r.outcome.cleanupAccepted,false);assert.equal(r.outcome.nativeAdmission,false);
 assert.deepEqual(JSON.parse(fs.readFileSync(f.plan.run.receiptFile)),r);assert.throws(()=>f.api.assertCurrent261FirstLoginBusinessContinuity(f.token,{}));
});

test('auth-only HOLD performs no attempt and a failed request retains its independent owner observation',async t=>{
 const held=model(t,{authOnly:true,once:false}),h=await held.result();assert.equal(h.status,'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_HOLD');assert.deepEqual(held.calls,['verify']);assert.equal(fs.readdirSync(held.plan.run.root).length,0);
 const observation=Object.freeze({authObserved:true,httpReturned:false,effects:Object.freeze({actorLastLogin:1,actorRefresh:0}),ownerClosed:true,full394Accepted:false}),first=Object.assign(Error('model-first-auth'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'});
 const f=model(t,{authOnly:true,applicationFailure:first,authOwnerObservation:observation}),r=await f.result();assert.equal(r.status,'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_STOPPED');assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.businessOutcome,'UNKNOWN');assert.deepEqual(r.authOwnerObservation,observation);assert.equal(r.full394Accepted,false);assert.equal(r.outcome,undefined);assert.equal(f.calls.filter(v=>v==='application').length,1);
});

for(const receivedSignal of ['SIGINT','SIGTERM'])test('actual '+receivedSignal+' handler persists its independent finite event with durable file and directory boundary',async t=>{
 const fsyncEvents=[],first=Object.assign(Error('CONTROLLED_FIRST'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),f=model(t,{authOnly:true,signalDuringApplication:receivedSignal,applicationFailure:first,fsyncEvents}),r=await f.result();
 assert.equal(r.receivedSignal,receivedSignal);assert.equal(r.signalEvidenceWriteFailed,false);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.full394Accepted,false);
 const file=path.join(f.plan.run.root,'received-'+receivedSignal+'.json'),event=JSON.parse(fs.readFileSync(file));assert.equal(event.receivedSignal,receivedSignal);assert.equal(event.status,'RECEIVED_PROCESS_SIGNAL');assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.ok(fsyncEvents.some((kind,i)=>kind==='file'&&fsyncEvents[i+1]==='directory'));
});
test('signal evidence collision cannot overwrite a file or replace the original first error',async t=>{
 const first=Object.assign(Error('CONTROLLED_FIRST'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),f=model(t,{authOnly:true,signalDuringApplication:'SIGTERM',applicationFailure:first,signalEvidenceCollision:true}),r=await f.result();
 assert.equal(r.receivedSignal,'SIGTERM');assert.equal(r.signalEvidenceWriteFailed,true);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(fs.readFileSync(path.join(f.plan.run.root,'received-SIGTERM.json'),'utf8'),'ORIGINAL_EVENT');
});

test('actual resource budget observation is separate from original first error, postcheck and cleanup-secondary outcome',async t=>{
 const first=Object.assign(Error('MODEL_FIRST_500'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),budgetEvidence=Object.freeze({budgetReason:null,cleanupBudgetReason:'CLEANUP_COMMAND_TIMEOUT',budgetEvidenceWriteFailed:false,budgetObservation:'DURABLE_EVENT_RECORDED'});
 const f=model(t,{authOnly:true,applicationFailure:first,cleanupFailure:true,budgetEvidence}),r=await f.result();assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.cleanupBudgetReason,'CLEANUP_COMMAND_TIMEOUT');assert.equal(r.budgetReason,null);assert.equal(r.receivedSignal,null);assert.equal(r.budgetObservation,'DURABLE_EVENT_RECORDED');
 const g=model(t,{authOnly:true,applicationFailure:first}),normal=await g.result();assert.equal(normal.budgetObservation,'UNKNOWN');assert.equal(normal.budgetReason,null);assert.equal(normal.receivedSignal,null);
});

test('actual fresh producer imports follow the main source order before rejecting an unregistered handle, never loosening preload gates',()=>{
 const {execFileSync}=require('node:child_process');
 const source=`const fs=require('node:fs'),path=require('node:path'),root=process.cwd(),main=fs.readFileSync(path.join(root,'services/api/prisma/task12-current261-local-lifecycle-once.cjs'),'utf8');
 const start=main.indexOf('async function main()'),owned=main.indexOf("=require('./task16-current259-owned-resource.cjs')",start),profile=main.indexOf("=require('./local-staged-current259-profile.cjs')",start);
 const files=owned<profile?['task16-current259-owned-resource.cjs','local-staged-current259-profile.cjs']:['local-staged-current259-profile.cjs','task16-current259-owned-resource.cjs'];
 for(const file of files)require(path.join(root,'services/api/prisma',file));let code;
 try{require(path.join(root,'services/api/prisma/local-staged-current259-profile.cjs')).createCurrent261AuthOnlyDiagnosticBootstrap(Object.freeze({}));}catch(error){code=error.code??error.message;}
 process.stdout.write(JSON.stringify({files,code,sdkLoaded:Object.keys(require.cache).some(p=>p.includes('/node_modules/@prisma/client/'))}));`;
 const row=JSON.parse(execFileSync(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'../../..'),encoding:'utf8'}));
 assert.equal(row.code,'CURRENT259_RESOURCE_HANDLE');assert.equal(row.sdkLoaded,false);assert.equal(row.files[0],'local-staged-current259-profile.cjs');
});

test('auth ROLES same original error yields only its fixed private phase and independent cleanup status',async t=>{
 const first=Object.freeze(Object.assign(Error('DO_NOT_PRINT'),{code:'CURRENT259_LOCAL_ROLE_UNKNOWN'})),facts=Object.freeze({phase:'INSTALL',resourceCleanup:Object.freeze({status:'COMPLETED'})});
 const f=model(t,{authOnly:true,roleFailure:first,roleFailureFacts:facts}),r=await f.result();assert.deepEqual(r.authRoleFailure,facts);assert.equal(r.businessOutcome,'UNKNOWN');assert.equal(r.full394Accepted,false);assert.equal(r.outcome,undefined);assert.ok(!JSON.stringify(r).includes('DO_NOT_PRINT'));
});
test('role projector module getter/proxy substitution and absent private fact remain UNKNOWN without traps or replaced first cause',async t=>{
 for(const mutation of ['getter','proxy','missing']){
  let traps=0;const first=Object.assign(Error('FIRST'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),facts=Object.freeze({phase:'BEFORE',resourceCleanup:Object.freeze({status:'UNKNOWN'})});
  const f=model(t,{authOnly:true,roleFailure:first,roleFailureFacts:mutation==='missing'?undefined:facts,beforeAuthRoles(mod){if(mutation==='getter')Object.defineProperty(mod,'exports',{get(){traps++;return{};}});if(mutation==='proxy')mod.exports=new Proxy(mod.exports,{get(){traps++;}});}}),r=await f.result();
  assert.deepEqual(r.authRoleFailure,{phase:'UNKNOWN',resourceCleanup:{status:'UNKNOWN'}});assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(traps,0);
 }
});


test('first failure is independently durable at controller observation before outer unwind',async t=>{
 const original=Object.freeze(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}));
 const open=fs.openSync,sync=fs.fsyncSync;let f,seen,firstFd,directoryPending=false;const events=[];
 fs.openSync=function(file,...args){const fd=Reflect.apply(open,this,[file,...args]);if(typeof file==='string'&&file.endsWith('/first-failure.json')&&typeof args[0]==='number'&&(args[0]&fs.constants.O_CREAT)!==0){firstFd=fd;events.push('exclusive-open');assert.equal(f.calls.includes('runtime-close'),false);assert.equal(f.calls.includes('resource-close'),false);}return fd;};
 fs.fsyncSync=function(fd){const result=Reflect.apply(sync,this,[fd]);if(fd===firstFd){events.push('file-fsync');directoryPending=true;firstFd=undefined;}else if(directoryPending&&fs.fstatSync(fd).isDirectory()){events.push('directory-fsync');directoryPending=false;assert.equal(f.calls.includes('resource-close'),false);}return result;};
 t.after(()=>{fs.openSync=open;fs.fsyncSync=sync;});
 f=model(t,{authOnly:true,applicationFailure:original,cleanupFailure:true,httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){seen=error;return undefined;}}});const result=await f.result();
 const file=path.join(f.plan.run.root,'first-failure.json'),record=JSON.parse(fs.readFileSync(file));
 assert.equal(seen,original);assert.equal(result.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(result.failurePhase,'APPLICATION');assert.equal(result.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');
 assert.deepEqual(events,['exclusive-open','file-fsync','directory-fsync']);assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(record.purpose,'CURRENT261_FIRST_LOGIN_AUTH_ONLY_DIAGNOSTIC');assert.equal(record.status,'FIRST_FAILURE_OBSERVED');assert.equal(record.observationBoundary,'CONTROLLER_FIRST_OBSERVED');assert.equal(record.failurePhase,'APPLICATION');assert.equal(record.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');
 assert.equal(record.sourceSha,f.plan.source.candidateSha);assert.equal(record.caseId,f.plan.case.id);assert.equal(record.runtimeSha256,f.plan.runtime.sha256);assert.equal(record.planSha256,'a'.repeat(64));assert.equal(result.firstFailureObservation,'DURABLE_EVENT_RECORDED');assert.equal(result.firstFailureEvidenceWriteFailed,false);
 assert.doesNotMatch(JSON.stringify(record),/PRIVATE_DO_NOT_PRINT/u);
});

function firstFailureIo(t,point){
 const slots=Object.fromEntries(['openSync','writeFileSync','fsyncSync','closeSync'].map(k=>[k,fs[k]])),fds=new Map();let root,opens=0;
 const io=()=>Object.assign(Error('PRIVATE_IO_DO_NOT_PRINT'),{code:'EIO'});
 fs.openSync=function(file,flags,...args){
  const first=typeof file==='string'&&file.endsWith('/first-failure.json')&&typeof flags==='number'&&(flags&fs.constants.O_CREAT)!==0;
  if(first){root=path.dirname(file);opens++;assert.ok(flags&fs.constants.O_EXCL);assert.ok(flags&fs.constants.O_NOFOLLOW);if(point==='open')throw io();}
  const directory=file===root&&typeof flags==='number'&&(flags&fs.constants.O_NOFOLLOW)!==0;
  if(directory&&point==='directory-open')throw io();const fd=Reflect.apply(slots.openSync,this,[file,flags,...args]);if(first||directory)fds.set(fd,first?'file':'directory');return fd;
 };
 fs.writeFileSync=function(file,...args){if(fds.get(file)==='file'&&point==='write')throw io();return Reflect.apply(slots.writeFileSync,this,[file,...args]);};
 fs.fsyncSync=function(fd){if(point&&fds.get(fd)===point)throw io();return Reflect.apply(slots.fsyncSync,this,[fd]);};
 fs.closeSync=function(fd){fds.delete(fd);return Reflect.apply(slots.closeSync,this,[fd]);};
 t.after(()=>Object.assign(fs,slots));return{opens:()=>opens};
}

test('first failure write/fsync/directory errors remain UNKNOWN without replacing primary or retrying',async t=>{
 for(const point of ['open','write','file','directory-open','directory'])await t.test(point,async st=>{
  const io=firstFailureIo(st,point),original=Object.freeze(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}));let observed;
  const f=model(st,{authOnly:true,applicationFailure:original,cleanupFailure:true,httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){observed=error;return undefined;}}}),r=await f.result();
  assert.equal(observed,original);assert.equal(io.opens(),1);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.cleanup,'UNKNOWN');assert.equal(r.firstFailureObservation,'UNKNOWN');assert.equal(r.firstFailureEvidenceWriteFailed,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_.*DO_NOT_PRINT/u);
 });
});

test('first-file collision preserves prior bytes and later unwind never retries or overwrites',async t=>{
 const io=firstFailureIo(t),original=Object.freeze(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}));let f;
 f=model(t,{authOnly:true,roleFailure:original,cleanupFailure:true,beforeAuthRoles(){fs.writeFileSync(path.join(f.plan.run.root,'first-failure.json'),'PRIOR_IMMUTABLE_EVENT',{flag:'wx',mode:0o600});}});const r=await f.result();
 assert.equal(io.opens(),1);assert.equal(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json'),'utf8'),'PRIOR_IMMUTABLE_EVENT');assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.failurePhase,'ROLES');assert.equal(r.firstFailureObservation,'UNKNOWN');assert.equal(r.firstFailureEvidenceWriteFailed,true);assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');
});

test('diagnostic observer failure cannot replace the first cause or the file already fsynced before it',async t=>{
 const original=Object.freeze(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}));let f,bytes,calls=0;
 f=model(t,{authOnly:true,applicationFailure:original,cleanupFailure:true,httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){calls++;assert.equal(error,original);assert.equal(f.calls.includes('resource-close'),false);bytes=fs.readFileSync(path.join(f.plan.run.root,'first-failure.json'));throw Error('PRIVATE_OBSERVER_DO_NOT_PRINT');}}});const r=await f.result();
 assert.equal(calls,1);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');assert.deepEqual(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json')),bytes);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_OBSERVER/u);
});

test('primitive and hostile first causes stay original identities and finite without invoking getters or proxy traps',async t=>{
 let traps=0;const hostile={};for(const key of ['code','message','cause','stack'])Object.defineProperty(hostile,key,{get(){traps++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 const proxy=new Proxy({},{get(){traps++;throw Error('PRIVATE_DO_NOT_PRINT');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_DO_NOT_PRINT');},ownKeys(){traps++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const original of [0,null,undefined,'PRIVATE_PRIMITIVE_DO_NOT_PRINT',hostile,proxy]){
  let seen;const f=model(t,{applicationRun:async()=>{throw original;},cleanupFailure:true,httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){seen=error;return undefined;}}}),r=await f.result(),event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json')));
  assert.equal(seen,original);assert.equal(event.reason,'UNCLASSIFIED');assert.equal(event.failurePhase,'APPLICATION');assert.equal(r.reason,undefined);assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');assert.doesNotMatch(JSON.stringify(event),/PRIVATE/u);
 }
 assert.equal(traps,0);
});

test('outer RESOURCE failure is recorded at its earliest controller catch before any resource is created',async t=>{
 const original=Object.freeze(Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'CURRENT259_LOADER_CHANGED'})),read=fs.readFileSync;let count=0;
 fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.endsWith('/attempt.json')&&++count===2)throw original;return Reflect.apply(read,this,[file,...args]);};t.after(()=>{fs.readFileSync=read;});
 const f=model(t,{authOnly:true}),r=await f.result(),event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json')));assert.equal(f.calls.includes('resource'),false);assert.equal(event.failurePhase,'RESOURCE');assert.equal(event.reason,'CURRENT259_LOADER_CHANGED');assert.equal(r.failurePhase,'RESOURCE');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');
});

test('a producer cleanup-only error is first observed afterwards and never represented as earlier than producer cleanup',async t=>{
 const f=model(t,{authOnly:true,cleanupFailure:true}),r=await f.result(),event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json')));assert.equal(event.failurePhase,'RESOURCE_CLEANUP');assert.equal(event.observationBoundary,'CONTROLLER_FIRST_OBSERVED');assert.equal(r.reason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');assert.equal(f.calls.at(-1),'resource-close');
});

test('success creates no first-failure file and preplan or spent-run failures remain UNKNOWN without touching old runs',async t=>{
 const success=model(t,{authOnly:true});assert.equal((await success.result()).status,'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_COMPLETE');assert.equal(fs.existsSync(path.join(success.plan.run.root,'first-failure.json')),false);
 for(const options of [{authOnly:true,failure:'pending'},{authOnly:true,used:true}]){const f=model(t,options),r=await f.result();assert.equal(r.firstFailureObservation,'UNKNOWN');assert.equal(r.firstFailureEvidenceWriteFailed,null);assert.equal(fs.existsSync(path.join(f.plan.run.root,'first-failure.json')),false);assert.equal(f.calls.includes('resource'),false);}
});


test('first-file file and directory fsync occur before controller token revoke, then original revoke remains',async t=>{
 const sync=fs.fsyncSync,open=fs.openSync;let f,handle,token,eventFileFd,waitDirectory=false;const active=[];
 fs.openSync=function(file,flags,...args){const fd=Reflect.apply(open,this,[file,flags,...args]);if(typeof file==='string'&&file.endsWith('/first-failure.json')&&typeof flags==='number'&&(flags&fs.constants.O_CREAT)!==0)eventFileFd=fd;return fd;};
 fs.fsyncSync=function(fd){const result=Reflect.apply(sync,this,[fd]);if(fd===eventFileFd||waitDirectory&&fs.fstatSync(fd).isDirectory()){let alive=false;try{alive=f.api.assertCurrent261ContractBusinessContinuity(token,handle)===true;}catch{}active.push(alive);waitDirectory=fd===eventFileFd;eventFileFd=undefined;}return result;};t.after(()=>{fs.openSync=open;fs.fsyncSync=sync;});
 f=model(t,{failure:'business',cleanupFailure:true,continuityProbe(api,tok,h){token=tok;handle=h;}});const r=await f.result();assert.deepEqual(active,[true,true]);assert.throws(()=>f.api.assertCurrent261ContractBusinessContinuity(token,handle));assert.equal(r.reason,'CURRENT259_GENERATED_DOCUMENT_EXERCISE_RESULT');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');
});


const drainEvent='first-role-drain-diagnostic.json';
const drainFacts=()=>Object.freeze({status:'OBSERVED',resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,relayCloseState:Object.freeze(Object.fromEntries(['hostFin','stdinEnded','pgFin','stdoutEnded','cliClosed','stdoutRawEnd','receiveSettled','cliExited','peerSocketDestroyed','peerEndReturned'].map(k=>[k,false])))});
test('first Auth catch durably publishes a separate finite drain diagnostic before revoke and later cleanup',async t=>{
 const original=Object.freeze(Object.assign(Error('PRIVATE_ORIGINAL'),{code:'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',phase:'CONSUME',reason:'ROLE_CLEANUP_UNKNOWN'}));
 const open=fs.openSync,sync=fs.fsyncSync;let f,token,handle,eventFd,directory=false;const order=[];
 fs.openSync=function(file,flags,mode){const fd=Reflect.apply(open,this,[file,flags,mode]);if(path.basename(String(file))===drainEvent&&typeof flags==='number'&&(flags&fs.constants.O_WRONLY)){assert.ok(flags&fs.constants.O_EXCL);assert.ok(flags&fs.constants.O_NOFOLLOW);order.push('exclusive');eventFd=fd;assert.equal(fs.existsSync(path.join(f.plan.run.root,'first-failure.json')),true);}return fd;};
 fs.fsyncSync=function(fd){const result=Reflect.apply(sync,this,[fd]);if(fd===eventFd||directory&&fs.fstatSync(fd).isDirectory()){assert.equal(f.api.assertCurrent261FirstLoginBusinessContinuity(token,handle),true);assert.equal(f.calls.includes('resource-close'),false);order.push(fd===eventFd?'file':'directory');directory=fd===eventFd;eventFd=undefined;}return result;};
 t.after(()=>{fs.openSync=open;fs.fsyncSync=sync;});
 f=model(t,{authOnly:true,applicationFailure:original,drainFailureFacts:drainFacts(),cleanupFailure:true,continuityProbe(api,tok,h){token=tok;handle=h;}});const r=await f.result();
 const event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,drainEvent)));
 assert.deepEqual(order,['exclusive','file','directory']);assert.equal(fs.statSync(path.join(f.plan.run.root,drainEvent)).mode&0o777,0o600);
 assert.deepEqual(Object.keys(event),['schemaVersion','status','observationBoundary','purpose','planSha256','sourceSha','caseId','runtimeSha256','failurePhase','diagnostic']);
 assert.equal(event.schemaVersion,1);assert.equal(event.status,'OBSERVED');assert.equal(event.observationBoundary,'CONTROLLER_OBSERVED_PRODUCER_DRAIN_FAILURE');assert.equal(event.purpose,f.plan.purpose);assert.equal(event.failurePhase,'APPLICATION');assert.equal(event.planSha256,'a'.repeat(64));assert.equal(event.sourceSha,f.plan.source.candidateSha);assert.equal(event.caseId,f.plan.case.id);assert.equal(event.runtimeSha256,f.plan.runtime.sha256);assert.deepEqual(event.diagnostic,drainFacts());
 assert.equal(r.reason,'CURRENT259_DOCUMENT_LOGIN_ROLE_CLEANUP_UNKNOWN');assert.equal(r.diagnosticObservation,'DURABLE_OBSERVED');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.businessOutcome,'UNKNOWN');assert.equal(f.calls.filter(v=>v==='drain-project').length,1);assert.equal(f.calls.includes('project-auth'),false);assert.throws(()=>f.api.assertCurrent261FirstLoginBusinessContinuity(token,handle));assert.doesNotMatch(JSON.stringify(event),/PRIVATE_/u);
});


test('fixed Auth drain closure rejects cache exports children and helper mutations before accessor traps',async t=>{
 for(const mutation of ['exports-getter','exports-proxy','cache-getter','cache-proxy','child-getter','child-foreign','helper-getter'])await t.test(mutation,async st=>{
  let traps=0;const getter=()=>{traps++;throw Error('PRIVATE_TRAP');};
  const original=Object.assign(Error('PRIVATE_PRIMARY'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'});
  const f=model(st,{authOnly:true,applicationFailure:original,drainFailureFacts:drainFacts(),beforeAuthApplication(mod,cache){
   if(mutation==='exports-getter')Object.defineProperty(mod,'exports',{get:getter});
   if(mutation==='exports-proxy')mod.exports=new Proxy(mod.exports,{get:getter,getOwnPropertyDescriptor:getter,ownKeys:getter});
   if(mutation==='cache-getter')Object.defineProperty(cache,mod.filename,{get:getter});
   if(mutation==='cache-proxy')cache[mod.filename]=new Proxy(mod,{get:getter,getOwnPropertyDescriptor:getter,ownKeys:getter});
   if(mutation==='child-getter')Object.defineProperty(mod.children,'0',{get:getter});
   if(mutation==='child-foreign')mod.children.push({filename:'/PRIVATE_FOREIGN',exports:{}});
   if(mutation==='helper-getter')Object.defineProperty(cache[path.join(path.dirname(mod.filename),'task16-current259-relay-sysread.cjs')],'exports',{get:getter});
  }});const r=await f.result(),event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,drainEvent)));
  assert.equal(event.status,'UNKNOWN');assert.deepEqual(event.diagnostic,{status:'UNKNOWN'});assert.equal(r.diagnosticObservation,'DURABLE_UNKNOWN');assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(f.calls.includes('drain-project'),false);assert.equal(traps,0);
 });
});

test('absent throwing or hostile finite drain readers persist UNKNOWN without raw fields or primary replacement',async t=>{
 let traps=0;const getter=Object.defineProperty({status:'OBSERVED',resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'},'relayCode',{get(){traps++;throw Error('PRIVATE_GETTER');}});
 const proxy=new Proxy({},{ownKeys(){traps++;throw Error('PRIVATE_PROXY');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_PROXY');}});
 for(const facts of [undefined,Object.freeze({status:'UNKNOWN'}),Object.freeze({...drainFacts(),secret:'PRIVATE_SECRET'}),Object.freeze(getter),Object.freeze({...drainFacts(),relaySysreadExit:99}),proxy]){
  const original=Object.assign(Error('PRIVATE_PRIMARY'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),f=model(t,{authOnly:true,applicationFailure:original,drainFailureFacts:facts,cleanupFailure:true}),r=await f.result();
  const event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,drainEvent)));assert.deepEqual(event.diagnostic,{status:'UNKNOWN'});assert.equal(event.status,'UNKNOWN');assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.diagnosticObservation,'DURABLE_UNKNOWN');assert.doesNotMatch(JSON.stringify(event),/PRIVATE_/u);
 }
 const f=model(t,{authOnly:true,applicationFailure:Object.assign(Error('PRIVATE'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),drainReaderThrows:true}),r=await f.result();assert.equal(r.diagnosticObservation,'DURABLE_UNKNOWN');assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(traps,0);
});

test('drain event IO failure never retries or changes first bytes primary phase or later cleanup',async t=>{
 for(const point of ['open','write','file','directory','exists'])await t.test(point,async st=>{
  const slots={open:fs.openSync,write:fs.writeFileSync,sync:fs.fsyncSync,close:fs.closeSync};let f,eventFd,eventStarted=false,opens=0,firstBytes;
  const fail=()=>Object.assign(Error('PRIVATE_IO'),{code:'EIO'});
  fs.openSync=function(file,flags,mode){if(path.basename(String(file))===drainEvent&&typeof flags==='number'&&(flags&fs.constants.O_WRONLY)){opens++;firstBytes=fs.readFileSync(path.join(f.plan.run.root,'first-failure.json'));if(point==='open')throw fail();eventStarted=true;const fd=Reflect.apply(slots.open,this,[file,flags,mode]);eventFd=fd;return fd;}return Reflect.apply(slots.open,this,[file,flags,mode]);};
  fs.writeFileSync=function(file,...args){if(eventStarted&&point==='write'&&file===eventFd){eventStarted=false;throw fail();}return Reflect.apply(slots.write,this,[file,...args]);};
  fs.fsyncSync=function(fd){if(eventStarted&&(point==='file'&&fd===eventFd||point==='directory'&&fs.fstatSync(fd).isDirectory())){eventStarted=false;throw fail();}return Reflect.apply(slots.sync,this,[fd]);};
  fs.closeSync=function(fd){if(fd===eventFd)eventFd=undefined;return Reflect.apply(slots.close,this,[fd]);};
  st.after(()=>{fs.openSync=slots.open;fs.writeFileSync=slots.write;fs.fsyncSync=slots.sync;fs.closeSync=slots.close;});
  const original=Object.freeze(Object.assign(Error('PRIVATE_PRIMARY'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}));let observed;
  f=model(st,{authOnly:true,applicationFailure:original,drainFailureFacts:drainFacts(),cleanupFailure:true,beforeAuthApplication(){if(point==='exists')Reflect.apply(slots.write,fs,[path.join(f.plan.run.root,drainEvent),'PRIOR_IMMUTABLE',{flag:'wx',mode:0o600}]);},httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){observed=error;}}});const r=await f.result();
  assert.equal(observed,original);assert.equal(opens,1);assert.deepEqual(fs.readFileSync(path.join(f.plan.run.root,'first-failure.json')),firstBytes);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.diagnosticObservation,'UNKNOWN');assert.equal(r.firstFailureObservation,'DURABLE_EVENT_RECORDED');assert.equal(r.firstFailureEvidenceWriteFailed,false);
  if(point==='exists')assert.equal(fs.readFileSync(path.join(f.plan.run.root,drainEvent),'utf8'),'PRIOR_IMMUTABLE');
 });
});

test('success full-purpose and earlier nonapplication failures never mint a drain event',async t=>{
 for(const options of [{authOnly:true},{failure:'business'},{authOnly:true,roleFailure:Object.assign(Error('PRIVATE'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'})}]){
  const f=model(t,options),r=await f.result();assert.equal(fs.existsSync(path.join(f.plan.run.root,drainEvent)),false);assert.equal(f.calls.includes('drain-project'),false);if(options.authOnly)assert.equal(r.diagnosticObservation,'UNKNOWN');
 }
});


test('fresh Node genuine import-only Module closure accepts original lazy edges and rejects an extra same-directory edge',t=>{
 const {spawnSync}=require('node:child_process');
 const script=String.raw`
  const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Module}=require('node:module');
  const entry=process.argv[1],dir=path.dirname(entry),main=new Module(entry,module);main.filename=entry;main.paths=Module._nodeModulePaths(dir);require.cache[entry]=main;
  const source=fs.readFileSync(entry,'utf8'),prefix=source.slice(0,source.indexOf('async function main(){'));
  main._compile(prefix+"\nmodule.exports={captureAuthDrainFailureProjector};",entry);main.loaded=true;
  const owned=path.join(dir,'task16-current259-owned-resource.cjs');assert.equal(Boolean(require.cache[owned]),false);
  main.require('./local-staged-current259-profile.cjs');main.require('./task16-current259-owned-resource.cjs');
  const namespace=main.require('./task12-current259-document-login.cjs');main.require('./task12-current261-first-login-exercise.cjs');main.require('./task12-current261-local-lifecycle-http.cjs');
  const read=main.require('./task16-runtime-inputs.cjs').readQualifiedTask16File,checkFile=main.require('./task16-current259-business-continuity.cjs').checkCurrent259FileIdentity;
  let checks=0;const reader=main.exports.captureAuthDrainFailureProjector(namespace,read,(file,identity)=>{checkFile(file,identity);checks++;});
  const login=require.cache[path.join(dir,'task12-current259-document-login.cjs')];assert.equal(login.parent,main);
  checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});const initialChecks=checks;assert.ok(initialChecks>=4);
  for(const name of ['task12-official-document-profiles.cjs','task12-current259-document-application.cjs','task12-current261-first-login-exercise.cjs','task16-current259-relay-sysread.cjs'])login.require('./'+name);
  checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.ok(checks>initialChecks);
  const legitimateChecks=checks;let traps=0;const trap=()=>{traps++;throw Error('PRIVATE_TRAP');};
  const exportSlot=Object.getOwnPropertyDescriptor(login,'exports');Object.defineProperty(login,'exports',{get:trap});checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.equal(checks,0);Object.defineProperty(login,'exports',exportSlot);
  login.exports=new Proxy(namespace,{get:trap,getOwnPropertyDescriptor:trap,ownKeys:trap});checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.equal(checks,0);Object.defineProperty(login,'exports',exportSlot);
  const childSlot=Object.getOwnPropertyDescriptor(login.children,'0');Object.defineProperty(login.children,'0',{get:trap});checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.equal(checks,0);Object.defineProperty(login.children,'0',childSlot);assert.equal(traps,0);
  const appFile=path.join(dir,'task12-current259-document-application.cjs'),appIndex=login.children.findIndex(row=>row.filename===appFile),app=login.children[appIndex],forged=Object.assign(new Module(appFile,main),{filename:appFile,loaded:true,exports:app.exports});
  login.children[appIndex]=forged;require.cache[appFile]=forged;checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.equal(checks<legitimateChecks,true);login.children[appIndex]=app;require.cache[appFile]=app;
  login.require('./task12-current261-first-login-owner.cjs');checks=0;assert.deepEqual(reader(undefined),{status:'UNKNOWN'});assert.equal(checks<legitimateChecks,true);
  process.stdout.write(JSON.stringify({initialChecks,legitimateChecks,extraEdgeRejected:true,ownedAbsentBeforeProfile:true,importsOnly:true}));
 `;
 const result=spawnSync(process.execPath,['-e',script,path.join(__dirname,'task12-current261-local-lifecycle-once.cjs')],{encoding:'utf8',timeout:15000,maxBuffer:128*1024});
 assert.equal(result.status,0,result.stderr);const proof=JSON.parse(result.stdout);assert.equal(proof.extraEdgeRejected,true);assert.equal(proof.importsOnly,true);t.diagnostic(JSON.stringify(proof));
});


test('Auth primitive proxy and hostile first causes keep identity and publish only UNKNOWN diagnostic',async t=>{
 let traps=0;const hostile={};for(const key of ['code','cause','message','stack'])Object.defineProperty(hostile,key,{get(){traps++;throw Error('PRIVATE_GETTER');}});
 const proxy=new Proxy({},{get(){traps++;throw Error('PRIVATE_PROXY');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_PROXY');},ownKeys(){traps++;throw Error('PRIVATE_PROXY');}});
 for(const original of [undefined,null,0,'PRIVATE_SECRET',hostile,proxy]){
  let seen;const f=model(t,{authOnly:true,applicationRun:async()=>{throw original;},cleanupFailure:true,httpFailureApi:{describeCurrent261LocalLifecycleHttpFailure(error){seen=error;}}}),r=await f.result();
  assert.equal(seen,original);assert.equal(r.failurePhase,'APPLICATION');assert.equal(r.businessOutcome,'UNKNOWN');assert.equal(r.secondaryReason,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(r.diagnosticObservation,'DURABLE_UNKNOWN');const event=JSON.parse(fs.readFileSync(path.join(f.plan.run.root,drainEvent)));assert.deepEqual(event.diagnostic,{status:'UNKNOWN'});assert.doesNotMatch(JSON.stringify(event),/PRIVATE_/u);
 }
 assert.equal(traps,0);
});

test('failed original first-file durability skips the drain event without changing the primary',async t=>{
 const io=firstFailureIo(t,'file'),original=Object.assign(Error('PRIVATE'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),f=model(t,{authOnly:true,applicationFailure:original,drainFailureFacts:drainFacts(),cleanupFailure:true}),r=await f.result();
 assert.equal(io.opens(),1);assert.equal(r.firstFailureObservation,'UNKNOWN');assert.equal(r.firstFailureEvidenceWriteFailed,true);assert.equal(r.diagnosticObservation,'UNKNOWN');assert.equal(fs.existsSync(path.join(f.plan.run.root,drainEvent)),false);assert.equal(f.calls.includes('drain-project'),false);assert.equal(r.reason,'CURRENT261_LOCAL_LIFECYCLE_HTTP');
});
