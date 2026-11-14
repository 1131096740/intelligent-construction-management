'use strict';
// Public main-entry port fixture shared by source-flow and actual technical HTTP tests.
// It grants no PG/native/business authority.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{createRequire}=require('node:module');
const prismaDir=path.resolve(__dirname,'../prisma'),requireAtPrisma=createRequire(path.join(prismaDir,'task12-current261-local-lifecycle-once.test.cjs'));
const entry=path.join(prismaDir,'task12-current261-local-lifecycle-once.cjs'),id='12345678-1234-4234-8234-123456789012',digest='a'.repeat(64),runtimeDigest='b'.repeat(64);
const sha=v=>createHash('sha256').update(v).digest('hex'),today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function model(t,{once=true,failure,applicationFailure,cleanupFailure=false,used=false,date=today(),continuityProbe,httpFailureApi,applicationRun}={}){
 const root=fs.mkdtempSync('/private/tmp/jg-life-once-model-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=path.join(root,'lifecycle-run'),toolRun=path.join(root,'tool-run');fs.mkdirSync(run,{mode:0o700});fs.mkdirSync(toolRun,{mode:0o700});
 const plan={source:{candidateSha:'c'.repeat(40)},case:{id,businessDate:date},resource:{daemonId:'model-daemon'},runtime:{sha256:runtimeDigest,runRoot:toolRun},run:{root:run,resourceDir:path.join(run,'resource'),attemptFile:path.join(run,'attempt.json'),receiptFile:path.join(run,'receipt.json')}};
 plan.runtime.file=path.join(root,'runtime.json');fs.writeFileSync(plan.runtime.file,'runtime',{mode:0o600});
 fs.writeFileSync(path.join(root,'LIFECYCLE-PLAN.json'),JSON.stringify(plan),{mode:0o600});
 if(used)fs.writeFileSync(plan.run.attemptFile,'OLD');
 const build={},handle={},runtime={},outcome={},calls=[],outputs=[],listeners=new Map();let capturedToken,fullChecks=0,resolveOutput;const completed=new Promise(resolve=>{resolveOutput=resolve;});
 const processModel={argv:['node',entry,'--plan',path.join(root,'LIFECYCLE-PLAN.json'),'--expected-plan-sha256',digest,...(once?['--once']:[])],execArgv:[],env:{},once(k,v){listeners.set(k,v);},removeListener(k){listeners.delete(k);},stdout:{write(v){outputs.push(JSON.parse(v));resolveOutput();}}};
 const fault=(code,extra={})=>Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code,...extra});
 const step=(name,prior,expected)=>{assert.equal(prior,expected);calls.push(name);if(failure===name)throw fault('MODEL_UNKNOWN');return name;};
 const ports={
  '../../../scripts/prepare-task12-current261-local-lifecycle.cjs':{verifyCurrent261LocalLifecyclePlan(){calls.push('verify');if(failure==='pending')throw fault('TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING');return{plan,sha256:digest,buildHandle:build,runtime,check(){fullChecks++;}};}},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){const s=fs.lstatSync(file),identity={ino:s.ino};if(options.expectedIdentity)assert.deepEqual(options.expectedIdentity,identity);return{sha256:sha(fs.readFileSync(file)),identity};}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return Object.freeze({source:plan.source});},async withCurrent259FirstQ2LoopbackResource(b,options,signal,use){assert.equal(b,build);assert.equal(options.artifactsDir,plan.run.resourceDir);assert.equal(signal.aborted,false);assert.equal(fs.existsSync(plan.run.attemptFile),true);calls.push('resource');try{return await use(handle);}finally{calls.push('resource-close');if(cleanupFailure)throw fault('CURRENT259_RESOURCE_CLEANUP_UNKNOWN');}}},
  './local-staged-current259-profile.cjs':{createCurrent259TechnicalMigration(h){assert.equal(h,handle);return{migrate:()=>step('migrate',h,handle)};},describeCurrent259TechnicalFailure(){return{};}},
  './task16-current259-role-provision.cjs':{provisionCurrent259Roles:(p,h)=>{assert.equal(h,handle);return step('roles',p,'migrate');}},
  './task16-current259-archive-install.cjs':{installCurrent259ArchiveAuthoritiesWithRegisteredFileSource:(p,h)=>{assert.equal(h,handle);return step('archive',p,'roles');}},
  './task16-current259-ordinary-archive-acl.cjs':{installCurrent261GeneratedLifecycleOrdinaryAcl:(p,h)=>{assert.equal(h,handle);return step('ordinary',p,'archive');}},
  './task12-current259-document-role-provision.cjs':{provisionCurrent261GeneratedLifecycleDocumentRoles:(p,h)=>{assert.equal(h,handle);return step('document-roles',p,'ordinary');}},
  './task12-current259-document-acl-transport.cjs':{describeCurrent261DocumentAclFailure:requireAtPrisma('./task12-current259-document-acl-transport.cjs').describeCurrent261DocumentAclFailure,installCurrent261GeneratedLifecycleDocumentAcl:(p,h)=>{assert.equal(h,handle);const value=step('document-acl',p,'document-roles');if(failure==='dacl-diagnostic')throw fault('CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED',{phase:'WRITE',reason:'TASK01_RESOURCE_COMMAND_FAILED',documentAclWriteFailure:{sqlState:'42501',section:'COLUMN_GRANT',message:'PRIVATE_DO_NOT_PRINT'}});return value;}},
  './task12-current259-generated-document-runtime.cjs':{async withOfficialTask12DocumentRuntime(proof,root,use){assert.equal(proof,runtime);assert.equal(root,toolRun);calls.push('runtime');try{return await use({});}finally{calls.push('runtime-close');}}},
  './task12-current259-document-login.cjs':{async withCurrent261LocalLifecyclePublicApplication(p,h,caseId,signal,use,token){capturedToken=token;assert.equal(mod.exports.assertCurrent261ContractBusinessContinuity(token,h),true);if(continuityProbe)continuityProbe(mod.exports,token,h,plan);assert.equal(p,'document-acl');assert.equal(h,handle);assert.equal(caseId,id);assert.equal(signal.aborted,false);calls.push('application');try{if(applicationFailure)throw applicationFailure;if(failure==='business')throw fault('CURRENT259_GENERATED_DOCUMENT_EXERCISE_RESULT');if(applicationRun)await applicationRun();if(failure==='owner-cleanup')throw fault('CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT',{ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});return await use(outcome);}finally{calls.push('application-close');}}},
  ...(httpFailureApi?{'./task12-current261-local-lifecycle-http.cjs':httpFailureApi}:{}),
  './task12-current261-local-lifecycle-exercise.cjs':{projectCurrent261LocalLifecycleOutcome(value){assert.equal(value,outcome);assert.equal(calls.at(-1),'application-close');calls.push('project');return{status:'LOCAL_ONLY_MATCHED',storage:'LOCAL_ONLY',cosAccepted:false,full394Accepted:false};}}
 };
 const mod={filename:entry,exports:{}},load=name=>ports[name]??requireAtPrisma(name);load.main=mod;load.cache={[entry]:mod};
 const binder={exports:{}};new Function('require','module','__dirname',fs.readFileSync(path.join(prismaDir,'task16-current259-business-continuity.cjs'),'utf8'))(load,binder,prismaDir);ports['./task16-current259-business-continuity.cjs']=binder.exports;
 new Function('require','module','process','__filename',fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,''))(load,mod,processModel,entry);
 return{calls,plan,listeners,get token(){return capturedToken;},api:mod.exports,fullChecks:()=>fullChecks,async result(){let timer;try{await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MODEL_RESULT_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}assert.equal(outputs.length,1);return outputs[0];}};
}
module.exports=Object.freeze({model});
