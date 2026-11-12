'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const noop=()=>{};
function fixture(t,options){
 const holder={exports:{}},oldFile=path.join(__dirname,'prepare-task16-current259-payment-install.test.cjs');
 new Function('require','module','__dirname',fs.readFileSync(oldFile,'utf8'))(name=>name==='node:test'?{test:noop}:require(name),holder,__dirname);
 const original=holder.exports.fixture(t,options),module={exports:{}},file=path.join(__dirname,'prepare-task16-current259-payment-business.cjs');
 const local=name=>name==='./prepare-task16-current259-payment-install.cjs'?original.api:require(name);local.main={};
 new Function('require','module','__dirname','__filename',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(local,module,__dirname,file);
 return {...original,business:module.exports};
}
module.exports={fixture};
test('the fixed competition plan cannot be consumed by the normal business verifier or choose a role limit',t=>{
 const f=fixture(t),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 assert.throws(()=>f.business.prepareCurrent259PaymentBusinessPlan({...options,scenario:'competition'}));
 assert.throws(()=>f.business.prepareCurrent259PaymentCompetitionPlan({...options,runtimeConnectionLimit:3}));
 const saved=f.business.prepareCurrent259PaymentCompetitionPlan(options);
 const verified=f.business.verifyCurrent259PaymentCompetitionPlan(f.output,saved.sha256);
 assert.equal(verified.plan.purpose,'current259-payment-owned-two-actor-competition');
 assert.equal(verified.plan.case.scenario,'competition');
 assert.equal(verified.plan.scope.multiActorConcurrency,true);
 assert.equal(verified.plan.scope.databaseTransport,'PAYMENT_COMPETITION_LOOPBACK_TLS_V1');
 assert.deepEqual(verified.plan.scope.competition,{runtimeSessions:2,runtimePoolSize:1,httpTimeoutMs:5000,automaticRetry:false});
 assert.equal(verified.plan.scope.seedPostCount,4);
 assert.equal(verified.plan.scope.registrationPostCount,2);
 assert.equal(verified.plan.scope.commitFaults,false);
 assert.throws(()=>f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});
test('business plan is a distinct exact purpose/scenario and installation sidecar does not authorize business',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'response-loss',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verified=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(verified.plan.purpose,'current259-payment-owned-seed-and-case');
 assert.equal(verified.plan.case.scenario,'response-loss');assert.equal(verified.plan.scope.seedPostCount,3);assert.equal(verified.plan.scope.registrationPostCount,2);
 assert.equal(verified.plan.scope.businessWrites,true);assert.equal(verified.plan.scope.archiveActivation,false);
 assert.equal(verified.buildHandle,f.handle);assert.deepEqual(fs.readdirSync(f.runRoot),[]);
 const sidecar=f.api.readCurrent259PaymentInstallPlan(f.output+'.installation.json',verified.plan.installation.sha256);
 assert.equal(sidecar.plan.scope.businessWrites,false);assert.equal(sidecar.plan.run.attemptFile,verified.plan.run.attemptFile);
 assert.throws(()=>f.api.readCurrent259PaymentInstallPlan(f.output,saved.sha256));
});
for(const name of ['business','sidecar'])test(name+' same-byte file replacement poisons both-file verification permanently',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verifier=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256),target=name==='business'?f.output:f.output+'.installation.json',bytes=fs.readFileSync(target);
 fs.renameSync(target,target+'.old');fs.writeFileSync(target,bytes,{mode:0o600});
 assert.throws(()=>verifier.check());fs.unlinkSync(target);fs.renameSync(target+'.old',target);
 assert.throws(()=>verifier.check());assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});
test('a replaced material-parent directory cannot become a new baseline',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verifier=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256),old=f.base+'.old';
 fs.renameSync(f.base,old);fs.cpSync(old,f.base,{recursive:true});fs.chmodSync(f.base,0o700);
 try{assert.throws(()=>verifier.check());}finally{fs.rmSync(f.base,{recursive:true});fs.renameSync(old,f.base);}
 assert.throws(()=>verifier.check());
});
for(const [paidAt,openingDate]of [['2026-02-30','2026-02-01'],['2026-11-10','2026-11-11'],['9999-01-01','2026-11-01'],['2026-11-10T00:00:00Z','2026-11-09']])test('explicit dates must be valid Beijing business dates and not future: '+paidAt+'/'+openingDate,t=>{
 const f=fixture(t);
 assert.throws(()=>f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt,openingDate}));
 assert.equal(f.state.captures,0);assert.equal(fs.existsSync(f.output),false);
});

test('fixed disconnect recovery plan requires both separated application phases and no automatic retry',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({
  runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'disconnect-commit-recovery',paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const {plan}=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(plan.case.caseId,'registered.null-cross-company.disconnect-commit-recovery');
 assert.equal(plan.scope.commitFaults,'DISCONNECT_EXACT_COMMIT_ONCE');
 assert.equal(plan.scope.databaseTransport,'PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS_V1');
 assert.equal(plan.scope.registrationPostCount,2);
 assert.equal(plan.scope.commitDisconnection.httpTimeoutMs,5000);
 assert.equal(plan.scope.commitDisconnection.automaticRetry,false);
 assert.ok(plan.scope.stages.indexOf('retireOriginalRuntime')<plan.scope.stages.indexOf('confirmRollback'));
 assert.ok(plan.scope.stages.indexOf('confirmRollback')<plan.scope.stages.indexOf('replacementApplication'));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('cancellation authorizes one registration and one result read of the original key',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({
  runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'cancel-commit',paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const {plan}=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(plan.scope.registrationPostCount,1);
 assert.equal(plan.scope.commitCancellation.originalResultReadCount,1);
 assert.equal(plan.scope.commitCancellation.httpTimeoutMs,5000);
 assert.equal(plan.scope.commitCancellation.automaticRetry,false);
 assert.deepEqual(plan.scope.caseRoutes,[
  'GET /payment-executions/:paymentId/registration-options',
  'POST /payment-executions/:paymentId/registrations (initial)',
  'GET /payment-executions/results/:idempotencyKey (original key after confirmed rollback)'
 ]);
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

for(const [scenario,profile,other] of [
 ['normal','PAYMENT_NORMAL_LOOPBACK_TLS_V1','PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS_V1'],
 ['response-loss','PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS_V1','PAYMENT_NORMAL_LOOPBACK_TLS_V1']
])test('business plan fixes a distinct loopback transport and rejects a cross-scenario profile: '+scenario,t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,
  output:f.output,scenario,paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verified=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(verified.plan.scope.databaseTransport,profile);
 assert.equal(verified.plan.scope.registrationPostCount,2);
 assert.equal(verified.plan.scope.commitFaults,false);
 const raw=JSON.parse(fs.readFileSync(f.output,'utf8'));raw.scope.databaseTransport=other;
 const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');fs.writeFileSync(f.output,bytes);
 const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>f.business.verifyCurrent259PaymentBusinessPlan(f.output,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('changing the competition plan to another scenario transport never qualifies an attempt',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentCompetitionPlan({runRoot:f.runRoot,daemonId:f.daemonId,
  output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const plan=JSON.parse(fs.readFileSync(f.output,'utf8'));
 assert.equal(plan.scope.databaseTransport,'PAYMENT_COMPETITION_LOOPBACK_TLS_V1');
 plan.scope.databaseTransport='PAYMENT_NORMAL_LOOPBACK_TLS_V1';
 const bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');fs.writeFileSync(f.output,bytes);
 const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.notEqual(digest,saved.sha256);
 assert.throws(()=>f.business.verifyCurrent259PaymentCompetitionPlan(f.output,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('disconnect plan refuses another transport even when its JSON digest is recomputed',t=>{
 const f=fixture(t);
 f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,
  scenario:'disconnect-commit-recovery',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const raw=JSON.parse(fs.readFileSync(f.output,'utf8'));raw.scope.databaseTransport='FIRST_ROLLBACK_LOOPBACK_TLS_V1';
 const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');fs.writeFileSync(f.output,bytes);
 const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>f.business.verifyCurrent259PaymentBusinessPlan(f.output,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('attribution gap has a distinct verifier, resource profile and sole expected-rejection POST',t=>{
 const f=fixture(t),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 assert.throws(()=>f.business.prepareCurrent259PaymentBusinessPlan({...options,scenario:'attribution-gap'}));
 const saved=f.business.prepareCurrent259PaymentAttributionGapPlan(options);
 const {plan}=f.business.verifyCurrent259PaymentAttributionGapPlan(f.output,saved.sha256);
 assert.equal(plan.purpose,'current259-payment-owned-project-attribution-gap');
 assert.equal(plan.case.scenario,'attribution-gap');
 assert.equal(plan.case.handler,'runRegisteredProjectAttributionGap');
 assert.equal(plan.scope.databaseTransport,'PAYMENT_ATTRIBUTION_GAP_LOOPBACK_TLS_V1');
 assert.equal(plan.scope.registrationPostCount,1);
 assert.deepEqual(plan.scope.attributionGap,{expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false});
 assert.throws(()=>f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256));
 assert.throws(()=>f.business.verifyCurrent259PaymentCompetitionPlan(f.output,saved.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('attribution gap refuses a valid normal plan and a recomputed wrong refusal status',t=>{
 const f=fixture(t),options={runRoot:f.runRoot,daemonId:f.daemonId,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 const normal=f.business.prepareCurrent259PaymentBusinessPlan({...options,output:f.output+'.normal',scenario:'normal'});
 assert.throws(()=>f.business.verifyCurrent259PaymentAttributionGapPlan(normal.file,normal.sha256));
 const gap=f.business.prepareCurrent259PaymentAttributionGapPlan({...options,output:f.output+'.gap'});
 const raw=JSON.parse(fs.readFileSync(gap.file,'utf8'));
 raw.scope.attributionGap.expectedStatus=201;
 const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');fs.writeFileSync(gap.file,bytes);
 const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>f.business.verifyCurrent259PaymentAttributionGapPlan(gap.file,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('voucher seals only its fixed file set and cannot be verified as the earlier competition or business plans',t=>{
 const f=fixture(t),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 assert.throws(()=>f.business.prepareCurrent259PaymentBusinessPlan({...options,scenario:'competition-voucher'}));
 const saved=f.business.prepareCurrent259PaymentVoucherPlan(options);
 const {plan}=f.business.verifyCurrent259PaymentVoucherPlan(f.output,saved.sha256);
 assert.equal(plan.purpose,'current259-payment-owned-two-actor-voucher');
 assert.equal(plan.case.scenario,'competition-voucher');
 assert.equal(plan.scope.competition.runtimeSessions,2);
 assert.equal(plan.scope.supplementaryVoucher,true);
 assert.equal(plan.scope.databaseTransport,'PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS_V1');
 assert.equal(plan.scope.voucher.uploadPostCount,1);
 assert.equal(plan.scope.voucher.attachPostCount,1);
 assert.ok(plan.voucherMaterials.some(row=>row.path.endsWith('task16-current259-voucher-acl.requirements.json')));
 assert.ok(plan.voucherMaterials.every(row=>/^[0-9a-f]{64}$/u.test(row.sha256)));
 assert.throws(()=>f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256));
 assert.throws(()=>f.business.verifyCurrent259PaymentCompetitionPlan(f.output,saved.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('voucher and attribution-gap plans cannot verify each other in the combined entry',t=>{
 const f=fixture(t),options={runRoot:f.runRoot,daemonId:f.daemonId,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 const voucher=f.business.prepareCurrent259PaymentVoucherPlan({...options,output:f.output+'.voucher'});
 const gap=f.business.prepareCurrent259PaymentAttributionGapPlan({...options,output:f.output+'.gap'});
 assert.throws(()=>f.business.verifyCurrent259PaymentVoucherPlan(gap.file,gap.sha256));
 assert.throws(()=>f.business.verifyCurrent259PaymentAttributionGapPlan(voucher.file,voucher.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('ordinary payment261 binds its distinct plan and installation sidecar without competition or voucher authority',t=>{
 const f=fixture(t,{payment261:true}),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 for(const scenario of ['competition','competition-voucher','attribution-gap'])assert.throws(()=>f.business.prepareCurrent261PaymentBusinessPlan({...options,scenario}));
 assert.equal(fs.existsSync(f.output+'.installation.json'),false);
 const saved=f.business.prepareCurrent261PaymentBusinessPlan({...options,scenario:'normal'});
 assert.equal(saved.status,'PAYMENT261_BUSINESS_PLAN_PREPARED_NO_RESOURCES');
 const verified=f.business.verifyCurrent261PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(verified.plan.purpose,'current261-payment-owned-seed-and-case');
 assert.equal(verified.plan.scope.migrations,261);
 assert.equal(verified.plan.scope.paymentProfile,'TASK16_PAYMENT261_RUNTIME_V1');
 assert.equal(verified.plan.scope.archiveActivation,false);
 assert.equal(verified.plan.scope.multiActorConcurrency,false);
 const sidecar=f.api.readCurrent261PaymentInstallPlan(verified.plan.installation.path,verified.plan.installation.sha256);
 assert.equal(sidecar.plan.scope.businessWrites,false);
 for(const verify of [f.business.verifyCurrent259PaymentBusinessPlan,f.business.verifyCurrent259PaymentCompetitionPlan,
  f.business.verifyCurrent259PaymentVoucherPlan,f.api.verifyCurrent261PaymentInstallPlan])assert.throws(()=>verify(f.output,saved.sha256));
 assert.throws(()=>f.business.verifyCurrent261PaymentBusinessPlan(sidecar.file.path,sidecar.file.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('261 competition plan binds the exact ledger, sidecar, original pair and 5s budget',t=>{
 const f=fixture(t,{payment261:true}),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 assert.throws(()=>f.business.prepareCurrent261PaymentCompetitionPlan({...options,scenario:'competition'}));
 assert.throws(()=>f.business.prepareCurrent261PaymentCompetitionPlan({...options,runtimeConnectionLimit:3}));
 const saved=f.business.prepareCurrent261PaymentCompetitionPlan(options);
 assert.equal(saved.status,'PAYMENT261_COMPETITION_PLAN_PREPARED_NO_RESOURCES');
 const {plan}=f.business.verifyCurrent261PaymentCompetitionPlan(saved.file,saved.sha256);
 assert.equal(plan.purpose,'current261-payment-owned-two-actor-competition');
 assert.equal(plan.scope.paymentProfile,'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1');
 assert.equal(plan.scope.migrations,261);
 assert.equal(plan.scope.archiveActivation,false);
 assert.equal(plan.scope.supplementaryVoucher,false);
 assert.equal(plan.scope.databaseTransport,'PAYMENT_COMPETITION_LOOPBACK_TLS_V1');
 assert.deepEqual(plan.scope.competition,{runtimeSessions:2,runtimePoolSize:1,httpTimeoutMs:5000,automaticRetry:false});
 assert.equal(plan.scope.seedPostCount,4);
 assert.equal(plan.scope.registrationPostCount,2);
 assert.equal(plan.case.caseId,'registered.two-actor.payment-competition');
 const sidecar=f.api.readCurrent261PaymentInstallPlan(plan.installation.path,plan.installation.sha256,plan.scope.paymentProfile);
 assert.equal(sidecar.plan.scope.businessWrites,false);
 for(const verify of [f.business.verifyCurrent259PaymentCompetitionPlan,f.business.verifyCurrent261PaymentBusinessPlan,
  f.business.verifyCurrent259PaymentVoucherPlan,f.business.verifyCurrent259PaymentAttributionGapPlan])
  assert.throws(()=>verify(saved.file,saved.sha256));
 assert.throws(()=>f.business.verifyCurrent261PaymentCompetitionPlan(sidecar.file.path,sidecar.file.sha256));
 const row=JSON.parse(fs.readFileSync(saved.file));
 row.scope.paymentProfile='TASK16_PAYMENT261_RUNTIME_V1';
 const changed=JSON.stringify(row);
 fs.writeFileSync(saved.file,changed);
 const digest=require('node:crypto').createHash('sha256').update(changed).digest('hex');
 assert.throws(()=>f.business.verifyCurrent261PaymentCompetitionPlan(saved.file,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('261 voucher and attribution gap preserve their original requests and distinct sidecar authority',t=>{
 const f=fixture(t,{payment261:true}),options={runRoot:f.runRoot,daemonId:f.daemonId,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 const voucher=f.business.prepareCurrent261PaymentVoucherPlan({...options,output:f.output+'.voucher'});
 const gap=f.business.prepareCurrent261PaymentAttributionGapPlan({...options,output:f.output+'.gap'});
 assert.equal(voucher.status,'PAYMENT261_VOUCHER_PLAN_PREPARED_NO_RESOURCES');
 assert.equal(gap.status,'PAYMENT261_ATTRIBUTION_GAP_PLAN_PREPARED_NO_RESOURCES');
 const verifiedVoucher=f.business.verifyCurrent261PaymentVoucherPlan(voucher.file,voucher.sha256).plan;
 const verifiedGap=f.business.verifyCurrent261PaymentAttributionGapPlan(gap.file,gap.sha256).plan;
 assert.equal(verifiedVoucher.scope.paymentProfile,'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1');
 assert.equal(verifiedGap.scope.paymentProfile,'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1');
 assert.deepEqual(verifiedVoucher.scope.competition,{runtimeSessions:2,runtimePoolSize:1,httpTimeoutMs:5000,automaticRetry:false});
 assert.equal(verifiedVoucher.scope.voucher.uploadPostCount,1);
 assert.equal(verifiedVoucher.scope.voucher.attachPostCount,1);
 assert.equal(verifiedGap.scope.registrationPostCount,1);
 assert.deepEqual(verifiedGap.scope.attributionGap,{expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false});
 for(const plan of [verifiedVoucher,verifiedGap]){
  assert.equal(plan.scope.migrations,261);
  const sidecar=f.api.verifyCurrent261PaymentInstallPlan(plan.installation.path,plan.installation.sha256,plan.scope.paymentProfile);
  assert.equal(sidecar.plan.scope.businessWrites,false);
 }
 for(const [sealed,verifiers] of [[voucher,[f.business.verifyCurrent261PaymentAttributionGapPlan,f.business.verifyCurrent259PaymentVoucherPlan]],
  [gap,[f.business.verifyCurrent261PaymentVoucherPlan,f.business.verifyCurrent259PaymentAttributionGapPlan]]]){
  for(const verify of [...verifiers,f.business.verifyCurrent261PaymentCompetitionPlan,f.business.verifyCurrent261PaymentBusinessPlan])
   assert.throws(()=>verify(sealed.file,sealed.sha256));
 }
 const altered=JSON.parse(fs.readFileSync(voucher.file));
 altered.voucherMaterials[0].sha256='f'.repeat(64);
 const bytes=JSON.stringify(altered);fs.writeFileSync(voucher.file,bytes);
 const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>f.business.verifyCurrent261PaymentVoucherPlan(voucher.file,digest));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('261 competition follow-up is a distinct exact four-post case and old readers reject it',t=>{
 const f=fixture(t,{payment261:true}),options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'};
 const saved=f.business.prepareCurrent261PaymentCompetitionFollowUpPlan(options);
 const {plan}=f.business.verifyCurrent261PaymentCompetitionFollowUpPlan(saved.file,saved.sha256);
 assert.equal(plan.purpose,'current261-payment-owned-two-actor-competition-follow-up');
 assert.equal(plan.case.scenario,'competition-follow-up');
 assert.equal(plan.scope.registrationPostCount,4);
 assert.deepEqual(plan.scope.followUp,{actor:'ORIGINAL_LOSER',amountCents:'1000',company:'ORIGINAL_A',sameKeyReplay:true});
 assert.equal(plan.scope.competition.httpTimeoutMs,5000);
 for(const verify of [f.business.verifyCurrent261PaymentCompetitionPlan,f.business.verifyCurrent261PaymentVoucherPlan,
  f.business.verifyCurrent261PaymentBusinessPlan,f.business.verifyCurrent259PaymentCompetitionPlan])
  assert.throws(()=>verify(saved.file,saved.sha256));
 assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});

test('follow-up reader rejects original competition and rehashed changes to its fixed intent or counts',t=>{
 const old=fixture(t,{payment261:true}),options=f=>({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const saved=old.business.prepareCurrent261PaymentCompetitionPlan(options(old));
 assert.throws(()=>old.business.readCurrent261PaymentCompetitionFollowUpPlan(saved.file,saved.sha256));
 for(const change of [row=>row.scope.followUp.amountCents='2000',row=>row.scope.followUp.actor='ORIGINAL_WINNER',row=>row.scope.registrationPostCount=5,
  row=>row.case.handler='runRegisteredTwoActorPaymentCompetition',row=>row.scope.competition.httpTimeoutMs=30000]){
  const f=fixture(t,{payment261:true}),current=f.business.prepareCurrent261PaymentCompetitionFollowUpPlan(options(f));
  const row=JSON.parse(fs.readFileSync(current.file));change(row);const bytes=JSON.stringify(row);fs.writeFileSync(current.file,bytes);
  assert.throws(()=>f.business.readCurrent261PaymentCompetitionFollowUpPlan(current.file,require('node:crypto').createHash('sha256').update(bytes).digest('hex')));
 }
});
