'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const entry=path.join(__dirname,'task12-current259-first-q2-once.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function model(t,{once=true,used=false,drift=false,alterEvidence=false,forgeInput=false,forgeKey=false,forgeGeneration=false,forgeFixedBytes=false,outside=false,operating=false,wrongScenario=false,persistedDrift=false,wrongLedgerXmin=false,failureKind,preflight,identity=false}={}){
  const root=fs.mkdtempSync('/private/tmp/jg-394-once-model-');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runRoot=path.join(root,'run');fs.mkdirSync(runRoot,{mode:0o700});
  const caseId='12345678-1234-4234-8234-123456789012';
  const attemptFile=path.join(runRoot,'attempt.json'),receiptFile=path.join(runRoot,'receipt.json');
  if(used)fs.writeFileSync(attemptFile,'existing-attempt',{mode:0o600});
  const today='2026-11-11';
  const cos={bucket:'jg-q2-isolated-1234567890',region:'ap-guangzhou',authorizationRef:'q2-model',
    expiresAt:preflight==='TIME'?'2026-11-11T13:45:00.000Z':'2026-11-12T04:00:00.000Z',prefix:'uploads/idempotent/12345678-1234-4234-8234-123456789012/',
    canary:{key:'model-canary',sizeBytes:1,sha256:'f'.repeat(64)}};
  const slots={};
  for(const [index,purpose] of ['application','observer'].entries()){
    const file=path.join(root,purpose+'.json');
    const bytes=Buffer.from(JSON.stringify({version:1,purpose,authorizationRef:cos.authorizationRef,caseId,
      bucket:cos.bucket,region:cos.region,prefix:cos.prefix,expiresAt:cos.expiresAt,secretId:'TMP'+String(index).repeat(24),
      secretKey:String(index+3).repeat(32),sessionToken:String(index+7).repeat(40)}));
    slots[file]=bytes;
    cos[purpose]={file,sha256:drift&&index===0?'f'.repeat(64):digest(bytes),identity:{mode:0o600}};
  }
  const plan={...(identity?{scope:{identityProfile:'TASK12_UPWARD_Q2_TLS_IDENTITY_V2'}}:{}),purpose:outside&&operating?'CURRENT259_FIRST_OUTSIDE_OPERATING_PRIVATE_COS'
      :outside?'CURRENT259_FIRST_OUTSIDE_DIRECT_PRIVATE_COS':'CURRENT259_FIRST_Q2_PRIVATE_COS',source:{candidateSha:'a'.repeat(40)},
    case:{id:caseId,businessDate:today,operating,...(outside?{relationship:'outside'}:{})},cos,resource:{daemonId:'model-daemon-12345',transport:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS'},
    run:{root:runRoot,attemptFile,receiptFile,resourceDir:path.join(runRoot,'resource')}};
  const sha256='c'.repeat(64),calls=[],proof=Object.freeze({}),completion=Object.freeze({}),handle=Object.freeze({}),
    fixture=Object.freeze({...(outside?{relationship:'outside'}:{}),...(outside&&operating?{outsideOperating:true}:{}),uploadPrefix:cos.prefix,archiveIdempotencyKey:caseId,seed:{User:{id:caseId}},original:{fileId:caseId}});
  const inputSha256='e'.repeat(64);
  const requestParts=['contract-direct-archive-request-v1','2','direct_signed',caseId,caseId,caseId,caseId,'2',inputSha256,'1',caseId,'true'];
  const requestSha256=digest(requestParts.map(value=>Buffer.byteLength(value,'utf8')+':'+value).join(''));
  const evidence={archiveId:caseId,contractId:caseId,versionId:caseId,fileId:caseId,actorId:caseId,idempotencyKey:caseId,status:'effective',revision:2,
    effectiveAt:'2026-11-11T02:00:00.000Z',operatingMode:outside&&operating?'projection_required':'not_applicable',fileBytes:5,fileSha256:'a'.repeat(64),
    downloadBytes:5,downloadSha256:'a'.repeat(64),
    cosCurrentGenerationSha256:'b'.repeat(64),cosCurrentContentSha256:'a'.repeat(64),cosCurrentBytes:5,
    cosFixedGenerationSha256:'b'.repeat(64),cosFixedContentSha256:'a'.repeat(64),cosFixedBytes:5,
    inputSha256,requestSha256,authoritySha256:'a'.repeat(64),archives:1,evidenceFiles:1,physicalAliases:0,draftSlots:0,
    approvalRounds:0,sealTasks:0,operatingFacts:Number(outside&&operating),operatingImpacts:Number(outside&&operating),archiveAudits:1,uploadAudits:1,downloadTicketAudits:1,downloadAudits:1};
  if(outside)evidence.persistedGenerationSha256=(persistedDrift?'f':'b').repeat(64);
  if(outside&&operating)evidence.operatingLedger={
    factId:'12345678-1234-4234-8234-123456789023',impactId:'12345678-1234-4234-8234-123456789024',
    factKind:'downstream_contract',impactKind:'contract_commitment_reference',amountYuan:'100.0054',direction:'increase',
    intentPayloadSha256:'c'.repeat(64),issuedXmin:'802',transactionId:'803',commitStatus:'committed',
    xmins:{archive:'803',version:'803',evidence:'803',audit:'803',intentUse:'803',fact:'803',impact:wrongLedgerXmin?'804':'803'}
  };
  if(forgeInput)evidence.inputSha256='f'.repeat(64);
  if(forgeKey){
    evidence.idempotencyKey='12345678-1234-4234-8234-123456789099';
    const parts=requestParts.slice();
    parts[6]=evidence.idempotencyKey;
    evidence.requestSha256=digest(parts.map(value=>Buffer.byteLength(value,'utf8')+':'+value).join(''));
  }
  if(forgeGeneration)evidence.cosCurrentGenerationSha256='d'.repeat(64);
  if(forgeFixedBytes)evidence.cosFixedBytes=4;
  const evidenceSha256=digest(JSON.stringify(evidence));
  if(alterEvidence)evidence.downloadSha256='d'.repeat(64);
  const appReceipt=Object.freeze({evidence,evidenceSha256,status:outside&&!wrongScenario?(operating?'CURRENT259_FIRST_OUTSIDE_OPERATING_HTTP_AND_NEST_CLOSED'
    :'CURRENT259_FIRST_OUTSIDE_DIRECT_HTTP_AND_NEST_CLOSED'):'CURRENT259_FIRST_Q2_HTTP_AND_NEST_CLOSED',httpSteps:9,verifiedClients:5,storageAcceptance:true,proofSha256:'b'.repeat(64)});
  const proc={argv:['node',entry,'--plan',path.join(root,'PLAN.json'),'--expected-plan-sha256',sha256,...(identity?['--identity261-v2']:[]),...(once?['--once']:[])],
    execArgv:preflight==='FRESH'?['--synthetic']:[],env:preflight==='HOST_ENV'?{HTTPS_PROXY:'sensitive-synthetic-value'}:{},getuid:process.getuid,stdout:{write:value=>calls.push(JSON.parse(value))},once(){},removeListener(){}};
  if(preflight==='ARGS')proc.argv[4]='--synthetic-path-token';
  const holder={exports:{}};
  const permitUse={},checks=[];
  const ports={
    './task12-current259-identity-authority.cjs':{captureIdentityMain(){}},
    '../../../scripts/prepare-task12-current259-first-q2.cjs':{verifyCurrent259FirstQ2Plan(){
      if(preflight==='PLAN_VERIFY')throw Object.assign(new Error('sensitive-synthetic-value'),{code:'CURRENT259_FIRST_Q2_PLAN_MATERIAL'});
      return {plan,sha256,buildHandle:{},check(){if(preflight==='PLAN_RECHECK')throw new Error('sensitive-synthetic-value');checks.push('full');},
        checkContinuity(){checks.push('light');}};
    }},
    './task16-runtime-inputs.cjs':{readQualifiedTask16File(file){
      if(file===attemptFile){const bytes=fs.readFileSync(file);return {bytes,sha256:digest(bytes),identity:{mode:0o600}};}
      assert.ok(fs.existsSync(attemptFile),'secrets open only after O_EXCL marker');
      assert.ok(Object.hasOwn(slots,file));
      calls.push('material');
      const bytes=Buffer.from(slots[file]);return {bytes,sha256:digest(bytes)};
    }},
    './task12-current259-first-q2-cos-native.cjs':{async openCurrent259FirstQ2Cos(permit){
      calls.push('cos');permitUse.cos=permit;
      const scope=holder.exports.claimCurrent259FirstQ2CosPermit(permit);
      assert.equal(scope.plan,cos);assert.equal(scope.outside,outside);
      assert.throws(()=>holder.exports.claimCurrent259FirstQ2CosPermit(permit),/AUTHORITY/u);
      return Object.freeze({environment:()=>({}),check(){},read(){},close(){}});
    }},
    './task16-current259-owned-resource.cjs':{async withCurrent259FirstQ2LoopbackResource(build,requested,signal,use){
      calls.push('resource');assert.equal(requested.artifactsDir,plan.run.resourceDir);
      if(failureKind==='starter')throw Object.assign(new Error('synthetic'),{resourceReceipt:{status:'cleanup_failed'}});
      if(failureKind==='client')throw Object.assign(new Error('synthetic'),{clientCleanup:'UNKNOWN'});
      const result=await use(handle);calls.push('cleanup');return result;
    }},
    './local-staged-current259-profile.cjs':{createCurrent259TechnicalMigration(seen){assert.equal(seen,handle);return {async migrate(){calls.push('migrate');return completion;}};}},
    './task16-current259-role-provision.cjs':{async provisionCurrent259Roles(seen,h){assert.equal(h,handle);assert.equal(seen,completion);calls.push('roles');return completion;}},
    './task16-current259-archive-install.cjs':{async installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(){calls.push('archive');return completion;}},
    './task16-current259-ordinary-archive-acl.cjs':{async installCurrent259OrdinaryArchiveAcl(){calls.push('acl');return completion;}},
    './task12-current259-q2-fixture.cjs':{buildCurrent259FirstQ2Fixture(id,day,operating){
      assert.equal(outside,false);assert.equal(id,caseId);assert.equal(day,today);assert.equal(operating,false);return fixture;
    },buildCurrent259FirstOutsideDirectFixture(id,day){
      assert.equal(outside,true);assert.equal(operating,false);assert.equal(id,caseId);assert.equal(day,today);calls.push('outside-fixture');return fixture;
    },buildCurrent259FirstOutsideOperatingFixture(id,day){
      assert.equal(outside&&operating,true);assert.equal(id,caseId);assert.equal(day,today);calls.push('outside-operating-fixture');return fixture;
    }},
    './task12-current259-contract-login.cjs':{async withCurrent259FirstQ2SeededLogin(acl,seen,supplied,use){
      assert.equal(acl,completion);assert.equal(seen,handle);assert.equal(supplied,fixture);calls.push('seeded');return use(proof);
    },async withCurrent259FirstQ2NativeApplication(p,h,permit){
      assert.equal(p,proof);assert.equal(h,handle);calls.push('app');permitUse.application=permit;
      const scope=holder.exports.claimCurrent259FirstQ2ApplicationPermit(permit,proof,handle,fixture);
      assert.equal(scope.fixture,fixture);assert.equal(scope.cosPlan,cos);
      const full=checks.filter(event=>event==='full').length;
      for(let i=0;i<12;i++)scope.check();
      assert.equal(checks.filter(event=>event==='full').length,full);
      return appReceipt;
    }}
  };
  if(identity){
    const plans=ports['../../../scripts/prepare-task12-current259-first-q2.cjs'];
    plans.verifyCurrent261UpwardIdentityPlan=plans.verifyCurrent259FirstQ2Plan;
    plans.verifyCurrent259FirstQ2Plan=()=>{throw new Error('old verifier cannot read new plan');};
    const physical=ports['./task16-current259-owned-resource.cjs'];
    physical.withCurrent259Identity261Resource=async(build,requested,signal,permit,use)=>{
      const scope={...requested,sourceSha:plan.source.candidateSha,signal};
      assert.equal(holder.exports.claimIdentity261Resource({...permit},scope),undefined);
      assert.equal(holder.exports.claimIdentity261Resource(permit,{...scope,daemonId:'wrong-daemon'}),undefined);
      assert.equal(holder.exports.claimIdentity261Resource(permit,scope).profile,plan.scope.identityProfile);
      assert.equal(holder.exports.claimIdentity261Resource(permit,scope),undefined);
      return physical.withCurrent259FirstQ2LoopbackResource(build,requested,signal,use);
    };
    const logins=ports['./task12-current259-contract-login.cjs'];
    logins.withCurrent261UpwardIdentitySeededLogin=async(acl,h,f,caseId,permit,use)=>{
      const scope={profile:plan.scope.identityProfile,caseId,sourceSha:plan.source.candidateSha};
      assert.equal(holder.exports.claimIdentity261Stage({...permit},h,scope),false);
      assert.equal(holder.exports.claimIdentity261Stage(permit,{},scope),false);
      assert.equal(holder.exports.claimIdentity261Stage(permit,h,scope),true);
      assert.equal(holder.exports.claimIdentity261Stage(permit,h,scope),false);
      const result=await logins.withCurrent259FirstQ2SeededLogin(acl,h,f,use);
      const names=['jg_fixture_app_'+'c'.repeat(24),'jg_c259_outside_issuer_login','jg_c259_outside_executor_login',
        'jg_c259_upward_issuer_login','jg_c259_upward_runtime_login'];
      return {...result,identityQualification:{profile:plan.scope.identityProfile,
        clients:names.map(name=>({name,identityVerified:true,closeKind:'CLOSED_BY_RESET',backendGone:true}))}};
    };
  }
  const rq=name=>{
    if(preflight==='PLAN_IMPORT'&&name==='../../../scripts/prepare-task12-current259-first-q2.cjs')throw new Error('sensitive-synthetic-value');
    if(preflight==='DEPENDENCIES'&&name==='./task12-current259-first-q2-cos-native.cjs')throw new Error('sensitive-synthetic-value');
    if(preflight==='Q2_PRODUCER'&&name==='./task16-current259-owned-resource.cjs')
      return {withCurrent259TechnicalResource:()=>assert.fail('legacy producer must not be used')};
    return Object.hasOwn(ports,name)?ports[name]:require(name);
  };
  rq.main=holder;rq.cache={[entry]:holder};rq.resolve=name=>name;
  const clock=class extends Date{
    constructor(...args){super(...(args.length?args:['2026-11-11T13:00:00.000Z']));}
    static now(){return +new Date('2026-11-11T13:00:00.000Z');}
  };
  const run=()=>new Function('require','module','__filename','process','Date',fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,''))
    (rq,holder,entry,proc,clock);
  return {run,calls,proc,holder,attemptFile,receiptFile,permitUse,checks};
}
const settled=async f=>{await f.run();for(let n=0;n<25&&!f.calls.some(v=>typeof v==='object');n++)await new Promise(resolve=>setImmediate(resolve));};

test('default verification stays HOLD and a pre-existing marker prevents private material or resource access',async t=>{
  const hold=model(t,{once:false});
  hold.run();
  assert.deepEqual(hold.calls,[]);
  assert.deepEqual(hold.checks,[]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hold.calls[0].status,'CURRENT259_FIRST_Q2_HOLD');
  assert.equal(fs.existsSync(hold.attemptFile),false);
  const used=model(t,{used:true});await settled(used);
  assert.equal(used.calls.some(value=>typeof value==='string'),false);
  assert.equal(fs.readFileSync(used.attemptFile,'utf8'),'existing-attempt');
});

test('wrong material digest consumes the sole attempt without reaching any network or database port',async t=>{
  const bad=model(t,{drift:true});await settled(bad);
  assert.deepEqual(bad.calls.filter(value=>typeof value==='string'),['material']);
  assert.equal(fs.existsSync(bad.attemptFile),true);
  assert.equal(fs.existsSync(bad.receiptFile),true);
});

test('a fresh exact once connects one scope and revokes both one-use permissions after owned cleanup',async t=>{
  const good=model(t);await settled(good);
  assert.deepEqual(good.calls.filter(value=>typeof value==='string'),['material','material','cos','resource','migrate','roles','archive','acl','seeded','app','cleanup']);
  assert.throws(()=>good.holder.exports.claimCurrent259FirstQ2CosPermit(good.permitUse.cos),/AUTHORITY/u);
  const receipt=JSON.parse(fs.readFileSync(good.receiptFile,'utf8'));
  assert.equal(receipt.status,'CURRENT259_FIRST_Q2_ACCEPTANCE_COMPLETE');
  assert.equal(receipt.proofSha256,'b'.repeat(64));
  assert.ok(good.checks.filter(event=>event==='full').length>=2);
  assert.ok(good.checks.filter(event=>event==='light').length>=12);
  assert.equal(receipt.evidence.archiveId,'12345678-1234-4234-8234-123456789012');
  assert.equal(receipt.evidence.downloadSha256,receipt.evidence.fileSha256);
  const e=receipt.evidence;
  const parts=['contract-direct-archive-request-v1','2','direct_signed',e.contractId,e.versionId,e.actorId,e.idempotencyKey,
    String(e.revision),e.inputSha256,'1',e.fileId,'true'];
  assert.equal(digest(parts.map(value=>Buffer.byteLength(value,'utf8')+':'+value).join('')),e.requestSha256);
  assert.equal(e.cosCurrentGenerationSha256,e.cosFixedGenerationSha256);
  assert.equal(e.cosCurrentContentSha256,e.fileSha256);
  assert.equal(e.cosFixedContentSha256,e.downloadSha256);
  assert.equal(receipt.evidenceSha256,digest(JSON.stringify(receipt.evidence)));
  assert.doesNotMatch(fs.readFileSync(good.receiptFile,'utf8'),/secretKey|sessionToken|postgresql:|TMP0/u);
});


test('a mutated projection after the original proof does not publish acceptance',async t=>{
  const changed=model(t,{alterEvidence:true});
  await settled(changed);
  const receipt=JSON.parse(fs.readFileSync(changed.receiptFile,'utf8'));
  assert.equal(receipt.status,'CURRENT259_FIRST_Q2_STOPPED');
  assert.equal(receipt.evidence,undefined);
});


test('failed physical startup cleanup or unproved client cleanup stays UNKNOWN',async t=>{
  for(const failureKind of ['starter','client']){
    const failed=model(t,{failureKind});
    await settled(failed);
    const receipt=JSON.parse(fs.readFileSync(failed.receiptFile,'utf8'));
    assert.equal(receipt.status,'CURRENT259_FIRST_Q2_STOPPED');
    assert.equal(receipt.cleanup,'UNKNOWN');
  }
});


test('a resealed projection with a forged input, key or separate COS generation does not publish acceptance',async t=>{
  for(const flag of ['forgeInput','forgeKey','forgeGeneration','forgeFixedBytes']){
    const changed=model(t,{[flag]:true});
    await settled(changed);
    const receipt=JSON.parse(fs.readFileSync(changed.receiptFile,'utf8'));
    assert.equal(receipt.status,'CURRENT259_FIRST_Q2_STOPPED');
    assert.equal(receipt.evidence,undefined);
  }
});


test('before the marker, only the fixed failing stage and allowlisted plan reason are reported',async t=>{
  for(const stage of ['FRESH','ARGS','PLAN_IMPORT','PLAN_VERIFY','HOST_ENV','TIME','PLAN_RECHECK','DEPENDENCIES','RUN_DIRECTORY']){
    const failed=model(t,{preflight:stage,used:stage==='RUN_DIRECTORY'});
    await settled(failed);
    assert.deepEqual(failed.calls,[{status:'CURRENT259_FIRST_Q2_STOPPED',phase:'PREFLIGHT',attempted:false,cleanup:'NOT_STARTED',
      preflightFailure:stage,...(stage==='PLAN_VERIFY'?{preflightReason:'PLAN_MATERIAL'}:{})}]);
    assert.equal(fs.existsSync(failed.receiptFile),false);
    assert.equal(fs.existsSync(failed.attemptFile),stage==='RUN_DIRECTORY');
    assert.doesNotMatch(JSON.stringify(failed.calls),/sensitive-synthetic-value|synthetic-path-token|HTTPS_PROXY/u);
  }
});


test('the fixed Q2 producer is required before marking an attempt or reading materials',async t=>{
  for(const once of [false,true]){
    const f=model(t,{preflight:'Q2_PRODUCER',once});
    await settled(f);
    assert.deepEqual(f.calls,[{status:'CURRENT259_FIRST_Q2_STOPPED',phase:'PREFLIGHT',attempted:false,cleanup:'NOT_STARTED',
      preflightFailure:'DEPENDENCIES'}]);
    assert.equal(fs.existsSync(f.attemptFile),false);
  }
});

test('one verified outside plan runs its own fixed fixture and will not publish a Q2 completion',async t=>{
  const hold=model(t,{outside:true,once:false});
  await settled(hold);
  assert.equal(hold.calls[0].status,'CURRENT259_FIRST_OUTSIDE_DIRECT_HOLD');
  assert.equal(fs.existsSync(hold.attemptFile),false);
  const good=model(t,{outside:true});
  await settled(good);
  const result=JSON.parse(fs.readFileSync(good.receiptFile,'utf8'));
  assert.equal(result.status,'CURRENT259_FIRST_OUTSIDE_DIRECT_ACCEPTANCE_COMPLETE');
  assert.equal(result.relationship,'outside');
  assert.equal(result.caseMode,'non-operating');
  assert.deepEqual(good.calls.filter(call=>typeof call==='string'),
    ['material','material','cos','resource','migrate','roles','archive','acl','outside-fixture','seeded','app','cleanup']);
  const wrong=model(t,{outside:true,wrongScenario:true});
  await settled(wrong);
  const stopped=JSON.parse(fs.readFileSync(wrong.receiptFile,'utf8'));
  assert.equal(stopped.status,'CURRENT259_FIRST_Q2_STOPPED');
  assert.equal(stopped.relationship,'outside');
  assert.equal(stopped.evidence,undefined);
});

test('outside once publishes three agreeing generation digests and rejects a resealed persisted drift',async t=>{
  const valid=model(t,{outside:true});await settled(valid);
  const result=JSON.parse(fs.readFileSync(valid.receiptFile,'utf8'));
  assert.equal(result.status,'CURRENT259_FIRST_OUTSIDE_DIRECT_ACCEPTANCE_COMPLETE');
  assert.equal(result.evidence.persistedGenerationSha256,'b'.repeat(64));
  assert.equal(result.evidence.persistedGenerationSha256,result.evidence.cosCurrentGenerationSha256);
  assert.equal(result.evidence.persistedGenerationSha256,result.evidence.cosFixedGenerationSha256);
  const drift=model(t,{outside:true,persistedDrift:true});await settled(drift);
  const stopped=JSON.parse(fs.readFileSync(drift.receiptFile,'utf8'));
  assert.equal(stopped.status,'CURRENT259_FIRST_Q2_STOPPED');
  assert.equal(stopped.evidence,undefined);
});

test('the operating once publishes a bounded ledger proof only after matching archive and ledger xmins',async t=>{
  const good=model(t,{outside:true,operating:true});await settled(good);
  assert.ok(good.calls.includes('outside-operating-fixture'));
  const receipt=JSON.parse(fs.readFileSync(good.receiptFile,'utf8'));
  assert.equal(receipt.status,'CURRENT259_FIRST_OUTSIDE_OPERATING_ACCEPTANCE_COMPLETE');
  assert.equal(receipt.evidence.operatingFacts,1);
  assert.equal(receipt.evidence.operatingLedger.amountYuan,'100.0054');
  assert.equal(receipt.evidence.operatingLedger.commitStatus,'committed');
  assert.equal(receipt.evidence.operatingLedger.xmins.impact,receipt.evidence.operatingLedger.xmins.archive);
  assert.doesNotMatch(JSON.stringify(receipt),/payloadText|secretKey|objectKey|downloadUrl/u);
  const drift=model(t,{outside:true,operating:true,wrongLedgerXmin:true});await settled(drift);
  const stopped=JSON.parse(fs.readFileSync(drift.receiptFile,'utf8'));
  assert.equal(stopped.status,'CURRENT259_FIRST_Q2_STOPPED');
  assert.equal(stopped.evidence,undefined);
});

test('identity261 upward preserves every original COS, stage and public request assertion with distinct stage permits',async t=>{
 const f=model(t,{identity:true});await settled(f);
 const receipt=JSON.parse(fs.readFileSync(f.receiptFile,'utf8'));
 assert.equal(receipt.status,'CURRENT261_FIRST_Q2_IDENTITY_V2_ACCEPTANCE_COMPLETE');
 assert.equal(receipt.identityQualification.clients.length,5);
 assert.deepEqual(f.calls.filter(value=>typeof value==='string'),['material','material','cos','resource','migrate','roles','archive','acl','seeded','app','cleanup']);
});
