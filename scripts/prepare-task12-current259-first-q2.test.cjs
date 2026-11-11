'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');

const parent=path.join(__dirname,'prepare-task12-current259-first-q2.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');

function model(t) {
  const packetRoot=fs.mkdtempSync('/private/tmp/jg-394-q2-plan-model-');
  t.after(()=>fs.rmSync(packetRoot,{recursive:true,force:true}));
  for(const name of ['run','cos'])fs.mkdirSync(path.join(packetRoot,name),{mode:0o700});
  const slots=['application-sts.json','observer-sts.json'];
  slots.forEach((slot,i)=>fs.writeFileSync(path.join(packetRoot,'cos',slot),'synthetic unreadable to verifier '+i,{mode:0o600}));
  const handle=Object.freeze({});
  const source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),
    profile:{ledgerSha256:'d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952',prefix256Sha256:'e'.repeat(64),schemaSha256:'f'.repeat(64)}};
  let full=0;
  const loader={verifyFull(){full++;},witness(){return {source,host:'darwin-arm64',engineCommit:'model-engine',build:{trees:['model']}};}};
  const slotsRead=[];
  const targets={
    '../services/api/prisma/task12-current259-contract-login.cjs':{CURRENT259_FIRST_Q2_TRANSPORT:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS'},
    '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build:()=>handle},
    '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(value){assert.equal(value,handle);return loader;}},
    '../services/api/prisma/task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){
      if(file.includes('/cos/')){slotsRead.push(file);assert.fail('secret content was opened during prepare or verify');}
      return read(file,options);
    }},
  };
  const holder={exports:{}},rq=name=>targets[name]??require(name);rq.main={};
  const sourceText=fs.readFileSync(parent,'utf8').replace(/^#![^\n]*\n/u,'');
  new Function('require','module','__dirname','__filename',sourceText)(rq,holder,__dirname,parent);
  return {api:holder.exports,slotsRead,full:()=>full,packetRoot,options:{packetRoot,daemonId:'synthetic-q2-daemon-12345',
    caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-11',operating:true,cos:{
      bucket:'jg-q2-isolated-1234567890',region:'ap-guangzhou',authorizationRef:'Q2-COS-isolated-model',expiresAt:'2026-11-12T05:00:00.000Z',
      canarySha256:digest('isolated canary'),canaryBytes:15,applicationSha256:digest('app pin'),observerSha256:digest('observer pin')}}};
}
module.exports={model};

test('preparation seals a Q2-only plan with both material file identities without opening them',t=>{
  const f=model(t);
  const saved=f.api.prepareCurrent259FirstQ2Plan(f.options);
  assert.equal(saved.status,'CURRENT259_FIRST_Q2_PLAN_PREPARED_HOLD');
  const verified=f.api.verifyCurrent259FirstQ2Plan(saved.file,saved.sha256);
  assert.equal(verified.plan.source.candidateSha,'a'.repeat(40));
  assert.equal(verified.plan.resource.daemonId,f.options.daemonId);
  assert.equal(verified.plan.resource.transport,'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS');
  assert.equal(verified.plan.case.operating,true);
  assert.match(verified.plan.cos.prefix,/^uploads\/idempotent\/[a-f0-9-]{36}\/$/u);
  assert.equal(verified.plan.cos.canary.key,verified.plan.cos.prefix+'q2-private-canary.bin');
  assert.deepEqual(verified.plan.scope.stages,['technical259','roles9','registeredArchive','ordinaryAcl','seededFiveTls','firstQ2Http','ownedCleanup']);
  assert.equal(verified.plan.scope.requests,9);
  assert.equal(verified.plan.scope.production,false);
  assert.deepEqual(fs.readdirSync(path.join(f.packetRoot,'run')),[]);
  assert.deepEqual(f.slotsRead,[]);
});

test('edited scope and changed material inode fail offline without secret access',t=>{
  const f=model(t);
  const saved=f.api.prepareCurrent259FirstQ2Plan(f.options);
  const plan=JSON.parse(fs.readFileSync(saved.file));
  plan.scope.requests=10;
  const changed=JSON.stringify(plan);
  fs.writeFileSync(saved.file,changed);
  assert.throws(()=>f.api.verifyCurrent259FirstQ2Plan(saved.file,digest(changed)),/PLAN_SCOPE/u);
  const second=model(t),sealed=second.api.prepareCurrent259FirstQ2Plan(second.options);
  const secret=path.join(second.packetRoot,'cos','observer-sts.json');
  fs.renameSync(secret,secret+'.retained');
  fs.writeFileSync(secret,'same-size but different inode!',{mode:0o600});
  assert.throws(()=>second.api.verifyCurrent259FirstQ2Plan(sealed.file,sealed.sha256),/PLAN_MATERIAL/u);
  assert.deepEqual(second.slotsRead,[]);
});

test('a caller getter, alternate endpoint or material symlink has no preparation authority',t=>{
  const f=model(t);
  const extra={...f.options};
  let getters=0;
  Object.defineProperty(extra,'send',{get(){getters++;return ()=>{};}});
  assert.throws(()=>f.api.prepareCurrent259FirstQ2Plan(extra),/PLAN_INPUT/u);
  assert.equal(getters,0);
  assert.throws(()=>f.api.prepareCurrent259FirstQ2Plan({...f.options,cos:{...f.options.cos,region:'evil.invalid'}}),/PLAN_INPUT/u);
  const secret=path.join(f.packetRoot,'cos','application-sts.json');
  fs.renameSync(secret,secret+'.retained');
  fs.symlinkSync(secret+'.retained',secret);
  assert.throws(()=>f.api.prepareCurrent259FirstQ2Plan(f.options),/PLAN_MATERIAL/u);
  assert.deepEqual(f.slotsRead,[]);
});


test('per-request continuity checks pinned plan and material without another full loader walk',t=>{
  const f=model(t);
  const saved=f.api.prepareCurrent259FirstQ2Plan(f.options);
  const verified=f.api.verifyCurrent259FirstQ2Plan(saved.file,saved.sha256);
  const full=f.full();
  for(let i=0;i<12;i++)verified.checkContinuity();
  assert.equal(f.full(),full);
  verified.check();
  assert.equal(f.full(),full+1);
  const file=verified.plan.cos.observer.file;
  fs.chmodSync(file,0o644);
  assert.throws(()=>verified.checkContinuity(),/PLAN_CHANGED/u);
  assert.deepEqual(f.slotsRead,[]);
});


test('a resealed plan cannot select the payment rollback relay or historical NAT transport',t=>{
  const f=model(t),saved=f.api.prepareCurrent259FirstQ2Plan(f.options);
  const plan=JSON.parse(fs.readFileSync(saved.file));
  for(const transport of ['UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS','UNVERIFIED_HOST_PUBLISHED_TLS']){
    const changed=JSON.stringify({...plan,resource:{...plan.resource,transport}});
    fs.writeFileSync(saved.file,changed);
    assert.throws(()=>f.api.verifyCurrent259FirstQ2Plan(saved.file,digest(changed)),/PLAN_SCOPE/u);
    assert.deepEqual(f.slotsRead,[]);
  }
});

test('the first outside direct-sign plan seals its own non-operating case and cannot impersonate Q2',t=>{
  const fixture=model(t);
  const options={...fixture.options,operating:false};
  const saved=fixture.api.prepareCurrent259FirstOutsideDirectPlan(options);
  const verified=fixture.api.verifyCurrent259FirstQ2Plan(saved.file,saved.sha256);
  assert.equal(verified.plan.purpose,'CURRENT259_FIRST_OUTSIDE_DIRECT_PRIVATE_COS');
  assert.deepEqual(verified.plan.case,{id:options.caseId,businessDate:options.businessDate,operating:false,relationship:'outside'});
  const {current259FirstQ2UploadPrefix}=require('../services/api/prisma/task12-current259-q2-fixture.cjs');
  assert.notEqual(verified.plan.cos.prefix,current259FirstQ2UploadPrefix(options.caseId));
  const changed={...verified.plan,case:{...verified.plan.case,relationship:'upward'}};
  fs.writeFileSync(saved.file,JSON.stringify(changed));
  assert.throws(()=>fixture.api.verifyCurrent259FirstQ2Plan(saved.file,digest(JSON.stringify(changed))),/PLAN_SCOPE/u);
  assert.throws(()=>fixture.api.prepareCurrent259FirstOutsideDirectPlan({...options,operating:true}),/PLAN_INPUT/u);
  assert.deepEqual(fixture.slotsRead,[]);
});

test('the fixed operating outside plan requires its own scope, input and upload prefix',t=>{
  const f=model(t);
  const sealed=f.api.prepareCurrent259FirstOutsideOperatingPlan(f.options);
  const {plan}=f.api.verifyCurrent259FirstQ2Plan(sealed.file,sealed.sha256);
  const fixture=require('../services/api/prisma/task12-current259-q2-fixture.cjs');
  assert.equal(plan.purpose,'CURRENT259_FIRST_OUTSIDE_OPERATING_PRIVATE_COS');
  assert.equal(plan.case.relationship,'outside');
  assert.equal(plan.case.operating,true);
  assert.notEqual(plan.cos.prefix,fixture.current259FirstOutsideDirectUploadPrefix(f.options.caseId));
  assert.notEqual(plan.cos.prefix,fixture.current259FirstQ2UploadPrefix(f.options.caseId));
  assert.ok(plan.scope.stages.includes('firstOutsideOperatingHttp'));
  const changed={...plan,case:{...plan.case,operating:false}};
  const bytes=JSON.stringify(changed);
  fs.writeFileSync(sealed.file,bytes);
  assert.throws(()=>f.api.verifyCurrent259FirstQ2Plan(sealed.file,digest(bytes)),/PLAN_INPUT/u);
  assert.deepEqual(f.slotsRead,[]);
});
