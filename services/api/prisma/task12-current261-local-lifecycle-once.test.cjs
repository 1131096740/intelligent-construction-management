'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const entry=path.join(__dirname,'task12-current261-local-lifecycle-once.cjs'),id='12345678-1234-4234-8234-123456789012',digest='a'.repeat(64),runtimeDigest='b'.repeat(64);
const sha=v=>createHash('sha256').update(v).digest('hex'),today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function model(t,{once=true,failure,applicationFailure,cleanupFailure=false,used=false,date=today()}={}){
 const root=fs.mkdtempSync('/private/tmp/jg-life-once-model-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=path.join(root,'lifecycle-run'),toolRun=path.join(root,'tool-run');fs.mkdirSync(run,{mode:0o700});fs.mkdirSync(toolRun,{mode:0o700});
 const plan={source:{candidateSha:'c'.repeat(40)},case:{id,businessDate:date},resource:{daemonId:'model-daemon'},runtime:{sha256:runtimeDigest,runRoot:toolRun},run:{root:run,resourceDir:path.join(run,'resource'),attemptFile:path.join(run,'attempt.json'),receiptFile:path.join(run,'receipt.json')}};
 if(used)fs.writeFileSync(plan.run.attemptFile,'OLD');
 const build={},handle={},runtime={},outcome={},calls=[],outputs=[],listeners=new Map();
 const processModel={argv:['node',entry,'--plan',path.join(root,'LIFECYCLE-PLAN.json'),'--expected-plan-sha256',digest,...(once?['--once']:[])],execArgv:[],env:{},once(k,v){listeners.set(k,v);},removeListener(k){listeners.delete(k);},stdout:{write(v){outputs.push(JSON.parse(v));}}};
 const fault=(code,extra={})=>Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code,...extra});
 const step=(name,prior,expected)=>{assert.equal(prior,expected);calls.push(name);if(failure===name)throw fault('MODEL_UNKNOWN');return name;};
 const ports={
  '../../../scripts/prepare-task12-current261-local-lifecycle.cjs':{verifyCurrent261LocalLifecyclePlan(){calls.push('verify');if(failure==='pending')throw fault('TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING');return{plan,sha256:digest,buildHandle:build,runtime,check(){}};}},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){const s=fs.lstatSync(file),identity={ino:s.ino};if(options.expectedIdentity)assert.deepEqual(options.expectedIdentity,identity);return{sha256:sha(fs.readFileSync(file)),identity};}},
  './task16-current259-owned-resource.cjs':{async withCurrent259FirstQ2LoopbackResource(b,options,signal,use){assert.equal(b,build);assert.equal(options.artifactsDir,plan.run.resourceDir);assert.equal(signal.aborted,false);assert.equal(fs.existsSync(plan.run.attemptFile),true);calls.push('resource');try{return await use(handle);}finally{calls.push('resource-close');if(cleanupFailure)throw fault('CURRENT259_RESOURCE_CLEANUP_UNKNOWN');}}},
  './local-staged-current259-profile.cjs':{createCurrent259TechnicalMigration(h){assert.equal(h,handle);return{migrate:()=>step('migrate',h,handle)};},describeCurrent259TechnicalFailure(){return{};}},
  './task16-current259-role-provision.cjs':{provisionCurrent259Roles:(p,h)=>{assert.equal(h,handle);return step('roles',p,'migrate');}},
  './task16-current259-archive-install.cjs':{installCurrent259ArchiveAuthoritiesWithRegisteredFileSource:(p,h)=>{assert.equal(h,handle);return step('archive',p,'roles');}},
  './task16-current259-ordinary-archive-acl.cjs':{installCurrent261GeneratedLifecycleOrdinaryAcl:(p,h)=>{assert.equal(h,handle);return step('ordinary',p,'archive');}},
  './task12-current259-document-role-provision.cjs':{provisionCurrent261GeneratedLifecycleDocumentRoles:(p,h)=>{assert.equal(h,handle);return step('document-roles',p,'ordinary');}},
  './task12-current259-document-acl-transport.cjs':{describeCurrent261DocumentAclFailure:require('./task12-current259-document-acl-transport.cjs').describeCurrent261DocumentAclFailure,installCurrent261GeneratedLifecycleDocumentAcl:(p,h)=>{assert.equal(h,handle);const value=step('document-acl',p,'document-roles');if(failure==='dacl-diagnostic')throw fault('CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED',{phase:'WRITE',reason:'TASK01_RESOURCE_COMMAND_FAILED',documentAclWriteFailure:{sqlState:'42501',section:'COLUMN_GRANT',message:'PRIVATE_DO_NOT_PRINT'}});return value;}},
  './task12-current259-generated-document-runtime.cjs':{async withOfficialTask12DocumentRuntime(proof,root,use){assert.equal(proof,runtime);assert.equal(root,toolRun);calls.push('runtime');try{return await use({});}finally{calls.push('runtime-close');}}},
  './task12-current259-document-login.cjs':{async withCurrent261LocalLifecyclePublicApplication(p,h,caseId,signal,use){assert.equal(p,'document-acl');assert.equal(h,handle);assert.equal(caseId,id);assert.equal(signal.aborted,false);calls.push('application');try{if(applicationFailure)throw applicationFailure;if(failure==='business')throw fault('CURRENT259_GENERATED_DOCUMENT_EXERCISE_RESULT');if(failure==='owner-cleanup')throw fault('CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT',{ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});return await use(outcome);}finally{calls.push('application-close');}}},
  './task12-current261-local-lifecycle-exercise.cjs':{projectCurrent261LocalLifecycleOutcome(value){assert.equal(value,outcome);assert.equal(calls.at(-1),'application-close');calls.push('project');return{status:'LOCAL_ONLY_MATCHED',storage:'LOCAL_ONLY',cosAccepted:false,full394Accepted:false};}}
 };
 const mod={exports:{}},load=name=>ports[name]??require(name);load.main=mod;load.cache={[entry]:mod};
 new Function('require','module','process','__filename',fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,''))(load,mod,processModel,entry);
 return{calls,plan,listeners,async result(){for(let n=0;!outputs.length&&n<30;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(outputs.length,1);return outputs[0];}};
}
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
