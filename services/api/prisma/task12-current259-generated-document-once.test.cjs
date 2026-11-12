'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const entry=path.join(__dirname,'task12-current259-generated-document-once.cjs');
const id='12345678-1234-4234-8234-123456789012';
const digest='c'.repeat(64),runtimeSha256='e'.repeat(64);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function model(t,{once=true,failure,used=false,env={},fresh=true,businessDate=today()}={}){
 const root=fs.mkdtempSync('/private/tmp/jg-document-once-model-');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=path.join(root,'run'),attemptFile=path.join(run,'attempt.json'),receiptFile=path.join(run,'receipt.json');
 fs.mkdirSync(run,{mode:0o700});
 if(used)fs.writeFileSync(attemptFile,'previous',{mode:0o600});
 const plan={source:{candidateSha:'a'.repeat(40)},case:{id,businessDate},resource:{daemonId:'synthetic-daemon'},
  runtime:{file:path.join(root,'runtime.json'),sha256:runtimeSha256},run:{root:run,attemptFile,receiptFile,resourceDir:path.join(run,'resource')}};
 const buildHandle={},handle={},runtimeEvidence={},runtime={},application={},exerciseOutput={secret:'must not print'};
 const calls=[],outputs=[],handlers=new Map();
 const fakeProcess={argv:['node',entry,'--plan',path.join(root,'PLAN.json'),'--expected-plan-sha256',digest,...(once?['--once']:[])],
  execArgv:fresh?[]:['--inspect'],env,once(name,listener){handlers.set(name,listener);},removeListener(name){handlers.delete(name);},
  stdout:{write(value){outputs.push(JSON.parse(value));}}};
 const mod={exports:{}};
 const fixedError=(code,other={})=>Object.assign(new Error('private payload'),{code,...other});
 const migrationError=fixedError('LOCAL_MIGRATION_SQL_STAGE203_READBACK',{cause:{code:'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'}});
 const advance=(name,prior,expected)=>{
  assert.equal(prior,expected);calls.push(name);
  if(failure==='marker-drift'&&name==='roles')fs.appendFileSync(attemptFile,'changed');
  if(failure===name)throw fixedError('UNKNOWN_CODE',{raw:'private payload'});
  return name;
 };
 const ports={
  '../../../scripts/prepare-task12-current259-generated-draft.cjs':{verifyCurrent259GeneratedDocumentPlan(file,hash){
   assert.equal(file,path.join(root,'PLAN.json'));assert.equal(hash,digest);
   return {plan,sha256:digest,buildHandle,runtime:runtimeEvidence,check(){}};
  }},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){
   assert.equal(file,attemptFile);assert.equal(options.privateFile,true);
   const identity={ino:fs.lstatSync(file).ino};
   if(options.expectedIdentity)assert.deepEqual(options.expectedIdentity,identity);
   return {sha256:sha(fs.readFileSync(file)),identity};
  }},
  './task16-current259-owned-resource.cjs':{async withCurrent259FirstQ2LoopbackResource(build,options,signal,use){
   assert.equal(build,buildHandle);assert.equal(options.artifactsDir,plan.run.resourceDir);assert.equal(options.daemonId,plan.resource.daemonId);
   assert.equal(signal.aborted,false);
   assert.equal(JSON.parse(fs.readFileSync(attemptFile)).status,'CONSUMED');
   calls.push('resource');
   if(failure==='resource')throw fixedError('TASK01_RESOURCE_START_FAILED',{resourceReceipt:{status:'closed',raw:'private payload'}});
   try{
    const value=await use(handle);
    if(failure==='receipt-write')fs.writeFileSync(receiptFile,'preexisting receipt',{mode:0o600});
    if(failure==='resource-close')throw fixedError('CURRENT259_RESOURCE_CLEANUP_UNKNOWN',{resourceCleanup:{status:'UNKNOWN'}});
    return value;
   }finally{calls.push('resource-close');}
  }},
  './local-staged-current259-profile.cjs':{
   createCurrent259TechnicalMigration(h,signal){
    assert.equal(h,handle);assert.equal(signal.aborted,false);
    return {migrate(){if(failure==='migrate'){calls.push('migrate');throw migrationError;}return advance('migrate',h,handle);}};
   },
   describeCurrent259TechnicalFailure(err){assert.equal(err,migrationError);return {stage:'CONTAINER_LOG_CURSOR',controlPhase:'stage203-readback'};}
  },
  './task16-current259-role-provision.cjs':{provisionCurrent259Roles(prior,h){assert.equal(h,handle);return advance('roles',prior,'migrate');}},
  './task16-current259-archive-install.cjs':{installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(prior,h){
   assert.equal(h,handle);
   if(failure==='archive-diagnostic'){
    calls.push('archive');
    throw fixedError('CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED',{phase:'current259-seven-before',
     sevenFailure:{causeCode:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'P0001',raw:'private payload'}});
   }
   return advance('archive',prior,'roles');
  }},
  './task16-current259-seven-install.cjs':{describeCurrent259SevenPrestateCommandFailure(err){
   assert.equal(err.code,'TASK01_RESOURCE_COMMAND_FAILED');assert.equal(err.sevenOwnerFailure.sqlState,'P0001');
   return {sqlState:'P0001'};
  }},
  './task16-current259-ordinary-archive-acl.cjs':{installCurrent259GeneratedDocumentOrdinaryAcl(prior,h){
   assert.equal(h,handle);return advance('ordinary-acl',prior,'archive');
  }},
  './task12-current259-document-role-provision.cjs':{provisionCurrent259GeneratedDocumentSaveRoles(prior,h){
   assert.equal(h,handle);return advance('document-roles',prior,'ordinary-acl');
  }},
  './task12-current259-document-acl-transport.cjs':{installCurrent259GeneratedDocumentAcl(prior,h){
   assert.equal(h,handle);return advance('document-acl',prior,'document-roles');
  }},
  './task12-current259-generated-document-runtime.cjs':{async withCurrent259GeneratedDocumentRuntime(evidence,runRoot,use){
   assert.equal(evidence,runtimeEvidence);assert.equal(runRoot,run);
   calls.push('runtime');
   if(failure==='runtime')throw fixedError('CURRENT259_GENERATED_DOCUMENT_RUNTIME_SCOPE');
   try{
    const value=await use(runtime);
    if(failure==='runtime-close')throw fixedError('CURRENT259_GENERATED_DOCUMENT_RUNTIME_CLEANUP_UNKNOWN',{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
    return value;
   }finally{calls.push('runtime-close');}
  }},
  './task12-current259-document-login.cjs':{async withCurrent259GeneratedDocumentPublicApplication(acl,h,caseId,use){
   assert.equal(acl,'document-acl');assert.equal(h,handle);assert.equal(caseId,id);
   calls.push('application');
   try{
    const result=await use(application);
    if(failure==='application-close')throw fixedError('CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',{
     phase:'CONSUME',reason:'ROLE_APP_CLOSE',appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE',raw:'private payload'});
    return result;
   }finally{calls.push('application-close');}
  }},
  './task12-current259-generated-document-exercise.cjs':{
   exerciseCurrent259GeneratedDocument(scope,r,{signal,businessDate:date}){
    assert.equal(scope,application);assert.equal(r,runtime);assert.equal(date,businessDate);assert.equal(signal.aborted,false);
    calls.push('exercise');
    if(failure==='exercise')throw fixedError('UNKNOWN_CODE',{cause:{code:'private payload'}});
    if(failure==='exercise-safe')throw fixedError('CURRENT259_GENERATED_DOCUMENT_EXERCISE_OWNER_READBACK',{raw:'private payload'});
    if(failure==='accessor')throw Object.defineProperties(new Error('private payload'),{
     code:{get(){assert.fail('error getter was invoked');}},
     reason:{get(){assert.fail('reason getter was invoked');}},
     cause:{get(){assert.fail('cause getter was invoked');}}
    });
    if(failure==='abort')handlers.get('SIGTERM')();
    return exerciseOutput;
   },
   projectCurrent259GeneratedDocumentOutcome(result){
    assert.equal(result,exerciseOutput);assert.equal(calls.at(-1),'application-close');calls.push('project');
    if(failure==='project')return undefined;
    return {generationId:id,matched:true};
   }
  }
 };
 const source=fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,'');
 const load=name=>ports[name]??require(name);
 load.cache={[entry]:mod};load.main=mod;
 new Function('require','module','process','__filename',source)(load,mod,fakeProcess,entry);
 return {calls,attemptFile,receiptFile,run,process:fakeProcess,handlers,async result(){
  for(let i=0;!outputs.length&&i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(outputs.length,1);return outputs[0];
 }};
}

test('HOLD is verify-only and leaves the independent run directory empty',async t=>{
 const m=model(t,{once:false});
 assert.deepEqual(await m.result(),{status:'CURRENT259_GENERATED_DOCUMENT_HOLD',planSha256:digest,runtimeSha256});
 assert.deepEqual(m.calls,[]);assert.deepEqual(fs.readdirSync(m.run),[]);
});

test('once uses the same owned handle and returns only the projected document result after all closes',async t=>{
 const m=model(t),receipt=await m.result();
 assert.deepEqual(m.calls,['resource','migrate','roles','archive','ordinary-acl','document-roles','document-acl',
  'runtime','application','exercise','application-close','project','runtime-close','resource-close']);
 assert.equal(receipt.status,'CURRENT259_GENERATED_DOCUMENT_PROTOCOL_COMPLETE');
 assert.equal(receipt.phase,'COMPLETE');assert.equal(receipt.cleanup,'CLOSED');
 assert.deepEqual(receipt.outcome,{generationId:id,matched:true});
 assert.equal(receipt.runtimeSha256,runtimeSha256);
 assert.deepEqual(JSON.parse(fs.readFileSync(m.receiptFile)),receipt);
 assert.deepEqual(JSON.parse(fs.readFileSync(m.attemptFile)),{status:'CONSUMED',planSha256:digest,sourceSha:'a'.repeat(40),caseId:id,runtimeSha256});
 assert.equal(fs.statSync(m.attemptFile).mode&0o777,0o600);assert.equal(fs.statSync(m.receiptFile).mode&0o777,0o600);
 assert.equal(m.handlers.size,0);assert.doesNotMatch(JSON.stringify(receipt),/secret|private payload/u);
});


test('stale business date, unqualified process, environment overrides and a spent marker never start resources',async t=>{
 for(const [options,reason] of [
  [{used:true},'ATTEMPT_USED'],[{businessDate:'2000-01-01'},'TIME'],[{fresh:false},'FRESH'],
  [{env:{HTTPS_PROXY:'private payload'}},'HOST_ENV']
 ]){
  const m=model(t,options),result=await m.result();
  assert.equal(result.status,'CURRENT259_GENERATED_DOCUMENT_STOPPED');
  assert.equal(result.reason,'CURRENT259_GENERATED_DOCUMENT_ONCE_'+reason);
  assert.equal(result.attempted,false);assert.equal(result.cleanup,'NOT_STARTED');
  assert.deepEqual(m.calls,[]);assert.equal(fs.existsSync(m.receiptFile),false);
  if(options.used)assert.equal(fs.readFileSync(m.attemptFile,'utf8'),'previous');
 }
});

test('each independent failure stops at its exact phase without any later business action',async t=>{
 const expected=[
  ['roles','ROLES','roles'],['archive','ARCHIVE','archive'],['ordinary-acl','DOCUMENT_ORDINARY_ACL','ordinary-acl'],
  ['document-roles','DOCUMENT_ROLES','document-roles'],['document-acl','DOCUMENT_ACL','document-acl'],
  ['runtime','RUNTIME','runtime'],['exercise','APPLICATION','exercise'],['abort','APPLICATION','exercise'],
  ['project','APPLICATION','project'],['marker-drift','ROLES','roles'],['accessor','APPLICATION','exercise']
 ];
 for(const [failure,phase,last] of expected){
  const m=model(t,{failure}),receipt=await m.result();
  assert.equal(receipt.status,'CURRENT259_GENERATED_DOCUMENT_STOPPED');
  assert.equal(receipt.phase,phase);assert.equal(receipt.attempted,true);
  assert.equal(m.calls.filter(name=>!name.endsWith('-close')).at(-1),last);
  assert.equal(m.calls.at(-1),'resource-close');
  assert.equal(m.process.exitCode,1);assert.equal(m.handlers.size,0);
  assert.equal(receipt.outcome,undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(m.receiptFile)),receipt);
  assert.doesNotMatch(JSON.stringify(receipt),/private payload|UNKNOWN_CODE/u);
 }
});

test('retains confirmed startup closure and distinguishes nested application, runtime and resource cleanup failures',async t=>{
 const expected=[
  ['resource','RESOURCE','CLOSED','TASK01_RESOURCE_START_FAILED'],
  ['application-close','APPLICATION','UNKNOWN','CURRENT259_DOCUMENT_LOGIN_ROLE_APP_CLOSE'],
  ['runtime-close','RUNTIME_CLEANUP','UNKNOWN','CURRENT259_GENERATED_DOCUMENT_RUNTIME_CLEANUP_UNKNOWN'],
  ['resource-close','RESOURCE_CLEANUP','UNKNOWN','CURRENT259_RESOURCE_CLEANUP_UNKNOWN']
 ];
 for(const [failure,phase,cleanup,reason] of expected){
  const m=model(t,{failure}),receipt=await m.result();
  assert.equal(receipt.phase,phase);assert.equal(receipt.cleanup,cleanup);assert.equal(receipt.reason,reason);
  assert.equal(receipt.outcome,undefined);assert.doesNotMatch(JSON.stringify(receipt),/private payload/u);
  if(failure==='application-close')assert.equal(receipt.failureStage,'CONSUME');
 }
});

test('keeps only established technical, seven-fragment and exercise diagnostics',async t=>{
 const migration=await model(t,{failure:'migrate'}).result();
 assert.equal(migration.phase,'MIGRATE');
 assert.equal(migration.reason,'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT');
 assert.deepEqual(migration.technicalFailure,{stage:'CONTAINER_LOG_CURSOR',controlPhase:'stage203-readback'});
 const archive=await model(t,{failure:'archive-diagnostic'}).result();
 assert.equal(archive.phase,'ARCHIVE');assert.equal(archive.failureStage,'current259-seven-before');
 assert.deepEqual(archive.sevenFailure,{sqlState:'P0001'});
 const exercise=await model(t,{failure:'exercise-safe'}).result();
 assert.equal(exercise.phase,'APPLICATION');
 assert.equal(exercise.reason,'CURRENT259_GENERATED_DOCUMENT_EXERCISE_OWNER_READBACK');
 assert.doesNotMatch(JSON.stringify({migration,archive,exercise}),/private payload/u);
});


test('receipt persistence failure preserves confirmed resource cleanup and never overwrites a file',async t=>{
 const m=model(t,{failure:'receipt-write'}),receipt=await m.result();
 assert.equal(receipt.status,'CURRENT259_GENERATED_DOCUMENT_STOPPED');
 assert.equal(receipt.reason,'CURRENT259_GENERATED_DOCUMENT_ONCE_RECEIPT');
 assert.equal(receipt.cleanup,'CLOSED');
 assert.equal(receipt.receiptWriteFailed,true);
 assert.equal(receipt.outcome,undefined);
 assert.equal(fs.readFileSync(m.receiptFile,'utf8'),'preexisting receipt');
});
