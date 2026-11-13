'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const entry=path.join(__dirname,'task12-current261-local-lifecycle-once.cjs'),id='12345678-1234-4234-8234-123456789012',digest='a'.repeat(64),runtimeDigest='b'.repeat(64);
const sha=v=>createHash('sha256').update(v).digest('hex'),today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function model(t,{once=true,failure,cleanupFailure=false,used=false,date=today()}={}){
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
  './task12-current259-document-login.cjs':{async withCurrent261LocalLifecyclePublicApplication(p,h,caseId,signal,use){assert.equal(p,'document-acl');assert.equal(h,handle);assert.equal(caseId,id);assert.equal(signal.aborted,false);calls.push('application');try{if(failure==='business')throw fault('CURRENT259_GENERATED_DOCUMENT_EXERCISE_RESULT');if(failure==='owner-cleanup')throw fault('CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT',{ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});return await use(outcome);}finally{calls.push('application-close');}}},
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
