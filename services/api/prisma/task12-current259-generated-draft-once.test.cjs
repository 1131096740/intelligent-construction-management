'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');

test('the new no-credential plan and once entry expose their fixed preparation surfaces',()=>{
  const planFile=path.resolve(__dirname,'../../../scripts/prepare-task12-current259-generated-draft.cjs');
  const onceFile=path.join(__dirname,'task12-current259-generated-draft-once.cjs');
  assert.ok(fs.existsSync(planFile));
  assert.ok(fs.existsSync(onceFile));
  assert.equal(typeof require(planFile).prepareCurrent259GeneratedDraftPlan,'function');
  assert.equal(typeof require(planFile).verifyCurrent259GeneratedDraftPlan,'function');
});

const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const entry=path.join(__dirname,'task12-current259-generated-draft-once.cjs');
const source=fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,'');
const id='12345678-1234-4234-8234-123456789012';

function localPacket(t){
  const root=fs.mkdtempSync('/private/tmp/jg-generated-draft-once-model-');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const run=path.join(root,'run');
  fs.mkdirSync(run,{mode:0o700});
  return {root,run};
}

function planModel(t,root){
  const entry=path.resolve(__dirname,'../../../scripts/prepare-task12-current259-generated-draft.cjs');
  const mod={exports:{}};
  const material=Object.freeze({}),loader={verifyFull(){},witness(){return {
    source:{candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),
      profile:{ledgerSha256:'ebd6ee528e5eabd4b53abbd992c58637af70fee61f015a17f70b04cd55761598',prefix256Sha256:'e'.repeat(64),schemaSha256:'f'.repeat(64)}},
    build:{sdk:'synthetic'},host:{node:'synthetic'},engineCommit:'synthetic'
  };}};
  const ports={
    '../services/api/prisma/task16-current259-profile.cjs':require('./task16-current259-profile.cjs'),
    '../services/api/prisma/task12-current259-contract-login.cjs':{CURRENT259_FIRST_Q2_TRANSPORT:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS'},
    '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build:()=>material},
    '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(handle){assert.equal(handle,material);return loader;}},
    '../services/api/prisma/task12-current259-generated-document-runtime.cjs':{verifyCurrent259GeneratedDocumentRuntime(file,digest){
      const bytes=fs.readFileSync(file);
      assert.equal(digest,hash(bytes));
      return Object.freeze({inputSha256:digest});
    }},
    '../services/api/prisma/task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){
      assert.ok(file.startsWith(root+'/'));
      const bytes=fs.readFileSync(file),identity={ino:fs.lstatSync(file).ino};
      if(options.expectedIdentity)assert.deepEqual(options.expectedIdentity,identity);
      return {bytes,sha256:hash(bytes),identity};
    }},
  };
  new Function('require','module','__dirname',fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,''))(name=>ports[name]??require(name),mod,path.dirname(entry));
  return mod.exports;
}

test('the plan seals exact draft-only scope and rejects added credentials and wrong relationship',t=>{
  const {root,run}=localPacket(t),api=planModel(t,root);
  const options={packetRoot:root,daemonId:'generated-model-daemon',caseId:id,businessDate:'2026-11-12'};
  assert.throws(()=>api.prepareCurrent259GeneratedDraftPlan({...options,cos:{}}),/INPUT/u);
  const prepared=api.prepareCurrent259GeneratedDraftPlan(options);
  const verified=api.verifyCurrent259GeneratedDraftPlan(prepared.file,prepared.sha256);
  assert.deepEqual(verified.plan.case,{id,businessDate:'2026-11-12',relationship:'inside',contractTypeKey:'material_purchase',operating:false});
  assert.equal(verified.plan.scope.migrations,261);
  assert.equal(verified.plan.scope.stages[0],'technical261');
  assert.equal(verified.plan.scope.requests,5);
  assert.equal(verified.plan.scope.cos,false);assert.equal(verified.plan.scope.worker,false);
  assert.deepEqual(fs.readdirSync(run),[]);
  verified.check();
  const bad={...verified.plan,case:{...verified.plan.case,relationship:'outside'}};
  const bytes=Buffer.from(JSON.stringify(bad));fs.writeFileSync(prepared.file,bytes);
  assert.throws(verified.check,/CHANGED/u);
  assert.throws(()=>api.verifyCurrent259GeneratedDraftPlan(prepared.file,hash(bytes)),/SCOPE/u);
});

test('document plans pin the separate runtime and cannot be accepted by the original draft entry',t=>{
  const {root,run}=localPacket(t),api=planModel(t,root);
  const options={packetRoot:root,daemonId:'generated-model-daemon',caseId:id,businessDate:'2026-11-12'};
  const file=path.join(root,'runtime-input.json'),bytes=Buffer.from('{}');
  fs.writeFileSync(file,bytes,{mode:0o600});
  const runtime={file,sha256:hash(bytes)};
  assert.throws(()=>api.prepareCurrent259GeneratedDraftPlan({...options,runtime}),/INPUT/u);
  assert.throws(()=>api.prepareCurrent259GeneratedDocumentPlan({...options,runtime:{...runtime,command:[]}}),/RUNTIME/u);
  const prepared=api.prepareCurrent259GeneratedDocumentPlan({...options,runtime});
  assert.equal(prepared.status,'CURRENT259_GENERATED_DOCUMENT_PLAN_PREPARED_HOLD');
  const verified=api.verifyCurrent259GeneratedDocumentPlan(prepared.file,prepared.sha256);
  assert.deepEqual(verified.plan.runtime,runtime);
  assert.equal(verified.runtime.inputSha256,runtime.sha256);
  assert.equal(verified.plan.scope.worker,true);
  assert.equal(verified.plan.scope.cos,false);
  assert.deepEqual(fs.readdirSync(run),[]);
  assert.throws(()=>api.verifyCurrent259GeneratedDraftPlan(prepared.file,prepared.sha256),/INPUT/u);
  const draft=api.prepareCurrent259GeneratedDraftPlan(options);
  assert.throws(()=>api.verifyCurrent259GeneratedDocumentPlan(draft.file,draft.sha256),/INPUT/u);
  fs.writeFileSync(file,'[]');
  assert.throws(()=>api.verifyCurrent259GeneratedDocumentPlan(prepared.file,prepared.sha256));
});

function runModel(t,{once=true,used=false,failure,wrongResult=false}={}){
  const {root,run}=localPacket(t),calls=[],output=[];
  const attemptFile=path.join(run,'attempt.json'),receiptFile=path.join(run,'receipt.json');
  if(used)fs.writeFileSync(attemptFile,'existing-attempt',{mode:0o600});
  const plan={source:{candidateSha:'a'.repeat(40)},case:{id,businessDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())},
    resource:{daemonId:'synthetic-daemon'},run:{root:run,attemptFile,receiptFile,resourceDir:path.join(run,'resource')}};
  const digest='c'.repeat(64),module={exports:{}},handle=Object.freeze({}),buildHandle=Object.freeze({});
  const fakeProcess={argv:['node',entry,'--plan',path.join(root,'PLAN.json'),'--expected-plan-sha256',digest,...(once?['--once']:[])],
    execArgv:[],env:{},once(){},removeListener(){},stdout:{write(value){output.push(JSON.parse(value));}}};
  const migrationFailure=Object.assign(new Error('secret'),{cause:{code:'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'}});
  const next=(key,prior,expected)=>{assert.equal(prior,expected);calls.push(key);return Object.freeze({key});};
  const ports={
    '../../../scripts/prepare-task12-current259-generated-draft.cjs':{verifyCurrent259GeneratedDraftPlan(file,sha){
      assert.equal(file,path.join(root,'PLAN.json'));assert.equal(sha,digest);
      return {plan,sha256:digest,buildHandle,check(){}};
    }},
    './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){
      assert.equal(file,attemptFile);assert.equal(options.privateFile,true);
      return {sha256:hash(fs.readFileSync(file)),identity:{ino:fs.lstatSync(file).ino}};
    }},
    './task16-current259-owned-resource.cjs':{async withCurrent259FirstQ2LoopbackResource(build,options,signal,use){
      assert.equal(build,buildHandle);assert.equal(options.artifactsDir,plan.run.resourceDir);assert.equal(signal.aborted,false);
      assert.equal(JSON.parse(fs.readFileSync(attemptFile)).status,'CONSUMED');
      calls.push('resource');
      if(failure==='startup'){
        throw Object.assign(new Error('opaque'),{resourceReceipt:{status:'cleanup_failed'}});
      }
      try{return await use(handle);}finally{calls.push('cleanup');}
    }},
    './local-staged-current259-profile.cjs':{
      describeCurrent259TechnicalFailure(error){
        assert.equal(error,migrationFailure);
        return Object.freeze({stage:'CURSOR',controlPhase:'stage203-readback',relayCode:'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'});
      },
      createCurrent259TechnicalMigration(h){
      assert.equal(h,handle);
      return {migrate(){
        if(failure==='migration')throw migrationFailure;
        return next('migrate',h,handle);
      }};
    }},
    './task16-current259-role-provision.cjs':{provisionCurrent259Roles(p,h){
      assert.equal(h,handle);
      if(failure==='roles')throw Object.assign(new Error('secret'),{code:'CURRENT259_ROLE_PROVISION_COMMIT_UNCONFIRMED'});
      return next('roles',p.key,'migrate');
    }},
    './task16-current259-archive-install.cjs':{installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(p,h){
      assert.equal(h,handle);
      if(failure==='archive')throw Object.assign(new Error('secret'),{
        code:'CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED',phase:'archive-registered-committed'});
      if(failure==='archive-writer-strict')throw Object.assign(new Error('secret'),{
        code:'CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED',phase:'archive-registered-write',
        archiveWriteFailure:Object.freeze({sqlState:'P0002',section:'ARCHIVE_FINAL',
          routine:'jg_install_contract_direct_upward_v2',sourceLine:94,raw:'secret'})});
      if(failure==='archive-prestate')throw Object.assign(new Error('secret'),{
        code:'CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED',phase:'current259-seven-before',
        sevenFailure:Object.freeze({causeCode:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'P0001',
          guard:'CURRENT259_SEVEN_INSTALL_SCOPE',section:'SCOPE_GUARD',scopeReason:'OPERATING_FACT_ROUTINE',raw:'secret'})});
      return next('archive',p.key,'roles');
    }},
    './task16-current259-ordinary-archive-acl.cjs':{installCurrent259GeneratedDraftOrdinaryAcl(p,h){
      assert.equal(h,handle);
      if(failure==='acl')throw Object.assign(new Error('unknown'),{code:'CURRENT259_ORDINARY_ARCHIVE_ACL_PRESTATE_REJECTED',phase:'current259-ordinary-acl-before'});
      if(failure==='forged-acl')throw Object.assign(new Error('unknown'),{code:'CURRENT259_ORDINARY_ARCHIVE_ACL_PRESTATE_REJECTED',phase:'raw-foreign-detail'});
      return next('generated-acl',p.key,'archive');
    }},
    './task12-current259-contract-login.cjs':{withCurrent259GeneratedDraftAdmission(p,h,caseId){
      assert.equal(h,handle);assert.equal(p.key,'generated-acl');assert.equal(caseId,id);
      calls.push('draft');
      if(failure==='http')throw Object.assign(new Error('secret'),{code:'CURRENT259_CONTRACT_LOGIN_CONSUMER',
        generatedHttpFailure:Object.freeze({step:'WORKBENCH',httpStatus:500,raw:'secret'})});
      if(failure==='forged-http')throw Object.assign(new Error('secret'),{code:'CURRENT259_CONTRACT_LOGIN_CONSUMER',
        generatedHttpFailure:Object.freeze({step:'WORKBENCH',httpStatus:599})});
      return {status:'CURRENT259_GENERATED_DRAFT_PROTOCOL_AND_NEST_CLOSED',verifiedClients:5,httpSteps:5,storageAcceptance:wrongResult,
        executionAllowed:false,nativeAdmission:false,draft:{status:'DRAFT_ADMISSION_PROTOCOL_MATCHED',leaseRevision:1,projectId:id,
          contractId:id.replace(/^1/u,'2'),versionId:id.replace(/^1/u,'3')},seed:{seedRows:21,operating:false,seedXid:'901'}};
    }},
  };
  const load=name=>ports[name]??require(name);
  load.cache={[entry]:module};load.main=module;
  new Function('require','module','process','__filename',source)(load,module,fakeProcess,entry);
  const result=async()=>{
    for(let i=0;!output.length&&i<10;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(output.length,1);
    return output[0];
  };
  return {result,calls,run,attemptFile,receiptFile,process:fakeProcess};
}

test('default HOLD and a spent once directory never enter the physical producer',async t=>{
  const hold=runModel(t,{once:false});
  assert.equal((await hold.result()).status,'CURRENT259_GENERATED_DRAFT_HOLD');
  assert.deepEqual(hold.calls,[]);assert.deepEqual(fs.readdirSync(hold.run),[]);
  const used=runModel(t,{used:true});
  assert.equal((await used.result()).attempted,false);assert.deepEqual(used.calls,[]);
  assert.equal(fs.readFileSync(used.attemptFile,'utf8'),'existing-attempt');
});

test('once binds all fixed stages to one resource and records only draft evidence after cleanup',async t=>{
  const m=runModel(t);
  const result=await m.result();
  assert.equal(result.status,'CURRENT259_GENERATED_DRAFT_PROTOCOL_COMPLETE');
  assert.deepEqual(m.calls,['resource','migrate','roles','archive','generated-acl','draft','cleanup']);
  assert.equal(result.cleanup,'CLOSED');assert.equal(result.httpSteps,5);assert.equal(result.seedXid,'901');
  assert.deepEqual(JSON.parse(fs.readFileSync(m.receiptFile)),result);
});

test('first startup, migration, ACL or evidence failure consumes the attempt and stops at the exact phase',async t=>{
  for(const [failure,phase,reason] of [
    ['startup','RESOURCE',undefined],
    ['migration','MIGRATE','CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'],
    ['acl','GENERATED_DRAFT_ACL','CURRENT259_ORDINARY_ARCHIVE_ACL_PRESTATE_REJECTED'],
    ['result','COMPLETE',undefined],
  ]){
    const m=runModel(t,{failure,wrongResult:failure==='result'});
    const receipt=await m.result();
    assert.equal(receipt.status,'CURRENT259_GENERATED_DRAFT_STOPPED');assert.equal(receipt.phase,phase);
    assert.equal(receipt.reason,reason);assert.equal(m.process.exitCode,1);
    assert.equal(JSON.parse(fs.readFileSync(m.attemptFile)).status,'CONSUMED');
    if(failure!=='result')assert.ok(!m.calls.includes('draft'));
    if(failure==='startup')assert.equal(receipt.cleanup,'UNKNOWN');
  }
});

test('the receipt retains source-qualified migration detail and only fixed ACL and HTTP projections',async t=>{
  const migration=await runModel(t,{failure:'migration'}).result();
  assert.deepEqual(migration.technicalFailure,{stage:'CURSOR',controlPhase:'stage203-readback',relayCode:'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'});
  const acl=await runModel(t,{failure:'acl'}).result();
  assert.equal(acl.failureStage,'current259-ordinary-acl-before');
  const badAcl=await runModel(t,{failure:'forged-acl'}).result();
  assert.equal(badAcl.failureStage,undefined);
  const roles=await runModel(t,{failure:'roles'}).result();
  assert.equal(roles.reason,'CURRENT259_ROLE_PROVISION_COMMIT_UNCONFIRMED');
  const archive=await runModel(t,{failure:'archive'}).result();
  assert.equal(archive.failureStage,'archive-registered-committed');
  assert.equal(archive.reason,'CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED');
  assert.equal(archive.cleanup,'UNKNOWN');
  const writer=await runModel(t,{failure:'archive-writer-strict'}).result();
  assert.equal(writer.failureStage,'archive-registered-write');
  assert.deepEqual(writer.archiveWriteFailure,{sqlState:'P0002',section:'ARCHIVE_FINAL',
    routine:'jg_install_contract_direct_upward_v2',sourceLine:94});
  assert.doesNotMatch(JSON.stringify(writer),/secret|raw/u);
  const archivePrestate=await runModel(t,{failure:'archive-prestate'}).result();
  assert.equal(archivePrestate.failureStage,'current259-seven-before');
  assert.deepEqual(archivePrestate.sevenFailure,{phase:'current259-seven-before',boundary:'OWNER_SQL',
    causeCode:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'P0001',guard:'CURRENT259_SEVEN_INSTALL_SCOPE',
    section:'SCOPE_GUARD',scopeReason:'OPERATING_FACT_ROUTINE'});
  const http=await runModel(t,{failure:'http'}).result();
  assert.deepEqual(http.httpFailure,{step:'WORKBENCH',httpStatus:500});
  const badHttp=await runModel(t,{failure:'forged-http'}).result();
  assert.deepEqual(badHttp.httpFailure,{step:'WORKBENCH'});
});
