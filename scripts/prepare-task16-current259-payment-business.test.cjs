'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const noop=()=>{};
function fixture(t){
 const holder={exports:{}},oldFile=path.join(__dirname,'prepare-task16-current259-payment-install.test.cjs');
 new Function('require','module','__dirname',fs.readFileSync(oldFile,'utf8'))(name=>name==='node:test'?{test:noop}:require(name),holder,__dirname);
 const original=holder.exports.fixture(t),module={exports:{}},file=path.join(__dirname,'prepare-task16-current259-payment-business.cjs');
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
