'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const cancelOutcome=Object.freeze({mode:'cancel-commit',state:'commit-cancelled',transactionId:'9101',executionAllowed:false,nativeAdmission:false});
const noop=()=>{};
function owned(t,options={}){
 const module={exports:{}};
 const model=new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-application-factory-owned.test.cjs'),'utf8')+'\nreturn fixture;')(
  name=>name==='node:test'?{test:noop}:require(name),module,__dirname);
 return model(t,options);
}

test('owned application exposes no raw owner/session claim',async t=>{
 const f=owned(t);
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  assert.equal(f.api.claimCurrent259PaymentApplication,undefined);
  assert.equal(app.owner,undefined);assert.equal(app.session,undefined);assert.equal(app.loader,undefined);
  assert.throws(()=>f.api.consumeCurrent259PaymentApplication({...app},f.handle,{}));
  assert.throws(()=>f.api.consumeCurrent259PaymentApplication(app,{},{}));
 });
});
function caseFixture(t,options={}){
 let factory,f;const permissions=new WeakMap(),continuities=new WeakSet(),holder={exports:{}};
 const businessGuard=(token,h)=>{assert.ok(continuities.has(token));assert.equal(h,f.handle);};
 const authorization={claimCurrent259PaymentBusinessPermit(permit,application,handle){
  const record=permissions.get(permit);permissions.delete(permit);
  assert.ok(record&&record.application===application&&record.handle===handle,'untrusted business token');
  const continuityToken=Object.freeze({});continuities.add(continuityToken);
  return {scope:record.scope,continuityToken,...(f.session.effectiveAccessBinding?{effectiveAccessBinding:options.permissionBinding?options.permissionBinding(f.session.effectiveAccessBinding):f.session.effectiveAccessBinding}:{}),
   ...((options.ordinarySeedProfile??options.initialSeedProfile)!==undefined?{paymentProfile:options.ordinarySeedProfile??options.initialSeedProfile}:{}),verifyFull(){f.calls.push('permission-full');record.application.inspect();},check(){if(record.closed)throw new Error('closed permission');record.application.inspect();},
   ...(record.scope.scenario==='attribution-gap'?{recordAttributionGapFailure:stage=>f.calls.push(['gap-first-failure',stage])}:{}),
   ...(options.recordCaseFailure?{recordCaseFailure:options.recordCaseFailure}:{}),
   ...(options.ordinarySeedProfile?{seedProfile:options.ordinarySeedProfile}:{}),
   ...(options.initialSeedProfile&&record.scope.disconnectPhase==='attempt'?{seedProfile:options.initialSeedProfile}:{})};
 }};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-payment-case.cjs'),'utf8'))(
  name=>name==='./task16-current259-application-factory.cjs'?factory:name==='./task16-current259-payment-run-authorization.cjs'?authorization:require(name),holder);
 f=owned(t,{...options,...((options.ordinarySeedProfile??options.initialSeedProfile)==='TASK16_PAYMENT261_RUNTIME_V1'?{paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'}:{}),businessGuard,paymentModule:holder.exports});factory=f.api;
 f.view.checkLifetime=f.view.check;
 f.session.activateBusinessContinuity=token=>{businessGuard(token,f.handle);f.calls.push('activate-continuity');};
 f.session.deactivateBusinessContinuity=token=>{businessGuard(token,f.handle);f.calls.push('finish-continuity');};
 f.session.checkContinuity=token=>{businessGuard(token,f.handle);f.session.checkLight();};
 return {...f,caseApi:holder.exports,issue(application,scope){
  const profile=require('./task16-current259-payment-loopback.cjs').paymentLoopbackForScenario(options.transportScenario??scope.scenario);
  if(profile){
   const current=scope.disconnectPhase==='recovery'?f.otherSession:f.session;
   const {publishedPort,port}=current.endpoint;
   const relayId=scope.disconnectPhase==='recovery'&&options.replacementRelayDrift?
    'ab49e313-e3da-407f-b279-3d09caecfc3e':'12345678-1234-4234-8234-123456789012';
   current.endpoint={transport:profile.topology,relayId,host:'127.0.0.1',port:publishedPort??port};
   if(scope.disconnectPhase==='recovery'&&options.replacementRelayDrift)f.session.endpoint={...f.session.endpoint,relayId};
  }
  const token=Object.freeze({});permissions.set(token,{application,handle:f.handle,scope:Object.freeze({...scope,authorizationReference:'synthetic-approved-model-only'})});return token;
 }};
}

function paymentModel(f,options={}){
 const runId='01234567-89ab-cdef-0123-456789abcdef';
 f.view.resource.getReceipt=()=>{
  const endpoint=f.session.endpoint,containerId='a'.repeat(64);
  return {runId,containerId,databaseName:f.session.identity[0].database,port:endpoint.port??endpoint.publishedPort,
   ...(endpoint.transport?{topology:endpoint.transport,relay:{id:endpoint.relayId,containerId,host:endpoint.host,port:endpoint.port}}:{})};
 };
 f.view.resource.getReceiptContinuity=()=>f.view.resource.getReceipt();
 let builds=0,seeds=0,consumers=0,captured;
 const plan={runId:runId.replaceAll('-','').slice(0,12),paidAt:'2026-11-10',openingDate:'2026-11-09',ids:{payment:'0afc53ef-c7d6-4cca-aa7b-f0f10ff629c2',requestKey:'12345678-1234-4234-8234-123456789abc'}};
 const modules={
  buildRegisteredPgFixturePlan(run,paidAt,openingDate){builds++;assert.equal(run,plan.runId);assert.equal(paidAt,plan.paidAt);assert.equal(openingDate,plan.openingDate);return structuredClone(plan);},
  async seedRegisteredPgFixture(execution,input,continuity){seeds++;captured={execution,input,continuity};continuity.checkLight();
   assert.equal(execution.owner,f.session.owner);assert.equal(execution.runtime,f.session.runtime);assert.equal(execution.observer,f.session.observer);
   await options.onSeed?.(continuity);
   return {plan:structuredClone(input),accessToken:'private-model-token',companyARegistrationId:'a',companyBRegistrationId:'b',companyBSourceId:'s'};
  },
  async runRegisteredNullCrossCompanyCommit(execution,fixture,continuity){consumers++;assert.equal(execution,captured.execution);assert.deepEqual(fixture.plan,captured.input);assert.equal(fixture.accessToken,'private-model-token');
   continuity.assertHttpRequest('/payment-executions/'+plan.ids.payment+'/registrations','POST');
   await options.onCase?.(continuity,fixture);
   return {caseId:'registered.null-cross-company.commit',passed:true,executionId:'11111111-1111-4111-8111-111111111111',rootId:'22222222-2222-4222-8222-222222222222'};
  },
  async runRegisteredNullCrossCompanyResponseLoss(execution,fixture,continuity){const result=await modules.runRegisteredNullCrossCompanyCommit(execution,fixture,continuity);return {...result,caseId:'registered.null-cross-company.response-loss'};}
 };
 f.loader.loadPaymentModules=()=>modules;
 return {plan,modules,counts:()=>({builds,seeds,consumers}),captured:()=>captured};
}
for(const scenario of ['normal','response-loss'])test('one owned seed reaches the fixed original '+scenario+' consumer with the identical private tuple',async t=>{
 const f=caseFixture(t),m=paymentModel(f),api=f.caseApi;let result;
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  const permit=f.issue(app,{scenario,paidAt:m.plan.paidAt,openingDate:m.plan.openingDate});
  result=await api.runCurrent259PaymentCase(app,f.handle,permit);
  assert.throws(()=>api.runCurrent259PaymentCase(app,f.handle,permit));
 });
 assert.equal(result.caseId,'registered.null-cross-company.'+(scenario==='normal'?'commit':'response-loss'));
 assert.equal(result.passed,true);assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:1});
 assert.equal(JSON.stringify(result).includes(m.captured().execution.password),false);
 assert.equal(JSON.stringify(result).includes('private-model-token'),false);
});
test('the owned cancellation case uses the original session gate and publishes no committed IDs',async t=>{
 const f=caseFixture(t),m=paymentModel(f),trace=[];
 f.session.cancelCommit=async(token,submit)=>{f.session.checkContinuity(token);trace.push('ready');await submit();trace.push('owner-settled');return cancelOutcome;};
 m.modules.runRegisteredNullCrossCompanyCommitCancellation=async(execution,fixture,continuity,cancel)=>{
  assert.equal(execution,m.captured().execution);
  assert.equal(fixture.accessToken,'private-model-token');
  await cancel(async()=>{
   continuity.assertHttpRequest('/payment-executions/'+m.plan.ids.payment+'/registrations','POST');
   trace.push('post');
  });
  trace.push('observer');
  continuity.assertHttpRequest('/payment-executions/results/'+m.plan.ids.requestKey,'GET');
  trace.push('result');
  return {caseId:'registered.null-cross-company.cancel-commit',passed:true,rollbackObserved:true,originalResultUnconfirmed:true};
 };
 const result=await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'cancel-commit',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})));
 assert.deepEqual(trace,['ready','post','owner-settled','observer','result']);
 assert.deepEqual(result,{caseId:'registered.null-cross-company.cancel-commit',passed:true,rollbackObserved:true,originalResultUnconfirmed:true,financialAcceptance:false,
  rollbackEvidence:{fault:'commit-cancelled',observedXid32:'9101',originalRequestKeySha256:createHash('sha256').update(m.plan.ids.requestKey).digest('hex')}});
 assert.ok(!JSON.stringify(result).includes(m.plan.ids.requestKey));
});
for(const failure of [undefined,null,0,false])test('a falsey seed failure is permanently unknown and shuts the app before resource cleanup: '+String(failure),async t=>{
 const f=caseFixture(t),m=paymentModel(f,{onSeed(){throw failure;}}),api=f.caseApi;
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  const permit=f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate});
  await assert.rejects(api.runCurrent259PaymentCase(app,f.handle,permit),error=>error.fixtureOutcome==='UNKNOWN_DO_NOT_RETRY');
  assert.throws(()=>app.inspect());
  assert.throws(()=>api.runCurrent259PaymentCase(app,f.handle,permit));
 }));
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
 assert.equal(f.calls.filter(x=>x==='app-close').length,1);assert.equal(f.calls.filter(x=>x==='sessions-close').length,1);assert.equal(f.resourceCloses(),1);
 assert.ok(f.calls.indexOf('app-close')<f.calls.indexOf('sessions-close'));
});
test('plain JSON or a flipped native flag fails before any builder or seed and revokes the application',async t=>{
 const f=caseFixture(t),m=paymentModel(f);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await assert.rejects(f.caseApi.runCurrent259PaymentCase(app,f.handle,{native:true,scenario:'normal'}));
  assert.throws(()=>app.inspect());
 }));
 assert.deepEqual(m.counts(),{builds:0,seeds:0,consumers:0});assert.equal(f.resourceCloses(),1);
});
test('a case cannot route the fixed owned transport to another payment or method',async t=>{
 const f=caseFixture(t),m=paymentModel(f,{onCase(continuity){continuity.assertHttpRequest('/payment-executions/foreign/registrations','POST');}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}));
 }));
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:1});assert.equal(f.resourceCloses(),1);
});
test('full checks occur at the three quiet boundaries and never inside original seed or case continuity',async t=>{
 let busy=false;
 const f=caseFixture(t,{onFull(){assert.equal(busy,false,'full material check during a transaction/request');}});
 let m;
 m=paymentModel(f,{async onSeed(){
  busy=true;
  try{const c=m.captured().continuity;c.checkLight();await Promise.resolve();c.checkLight();
   assert.equal(f.calls.filter(x=>x==='permission-full').length,1);assert.equal(f.calls.filter(x=>x==='sessions-full').length,3);
  }finally{busy=false;}
 },async onCase(c){
  busy=true;
  try{c.checkLight();await Promise.resolve();c.checkLight();
   assert.equal(f.calls.filter(x=>x==='permission-full').length,2);assert.equal(f.calls.filter(x=>x==='sessions-full').length,4);
  }finally{busy=false;}
 }});
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})));
 assert.equal(f.calls.filter(x=>x==='permission-full').length,3);assert.equal(f.calls.filter(x=>x==='sessions-full').length,5);
 assert.deepEqual(f.calls.filter(x=>['activate-continuity','finish-continuity'].includes(x)),['activate-continuity','finish-continuity']);
});

for(const [mode,explicit261] of ['complete','complete-261','foreign-key','post-first','swapped-relay','resolved-key'].flatMap(mode=>mode==='complete-261'?[[mode,true]]:[[mode,false],[mode,true]]))
 test('A16 replacement uses the original seed, relay and key: '+mode+' '+(explicit261?'261':'259'),async t=>{
 const initialSeedProfile=explicit261?'TASK16_PAYMENT261_RUNTIME_V1':undefined;
 const f=caseFixture(t,{retirement:true,initialSeedProfile,replacementRelayDrift:mode==='swapped-relay'}),
  m=paymentModel(f,{onSeed(continuity){assert.equal(continuity.seedProfile,initialSeedProfile);assert.equal(typeof continuity.requestJson,initialSeedProfile?'function':'undefined');}});
 const rollback=Object.freeze({}),attempt=Object.freeze({}),trace=[],signal=new AbortController().signal;
 const options='/payment-executions/'+m.plan.ids.payment+'/registration-options';
 const post='/payment-executions/'+m.plan.ids.payment+'/registrations';
 const result='/payment-executions/results/'+m.plan.ids.requestKey;
 const scope={scenario:'disconnect-commit-recovery',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate};
 let faulted=false;
 const originalVerify=f.session.verifyFull;
 f.session.verifyFull=async()=>{assert.equal(faulted,false,'old runtime is never queried after the fault');return originalVerify();};
 f.session.disconnectCommit=async(token,submit)=>{
  f.session.checkContinuity(token);trace.push('fault-ready');
  await submit();
  faulted=true;
  return {mode:'disconnect-commit',state:'commit-disconnected',transactionId:'108',executionAllowed:false,nativeAdmission:false};
 };
 for(const key of ['activateBusinessContinuity','deactivateBusinessContinuity','checkContinuity'])f.otherSession[key]=f.session[key];
 m.modules.runRegisteredNullCrossCompanyDisconnectAttempt=async(execution,prepared,continuity,disconnect)=>{
  assert.equal(execution,m.captured().execution);assert.equal(prepared.accessToken,'private-model-token');
  assert.equal(typeof continuity.requestJson,initialSeedProfile?'function':'undefined');
  continuity.assertHttpRequest(options,'GET');
  const outcome=await disconnect(async()=>{continuity.assertHttpRequest(post,'POST');trace.push('original-post');});
  assert.equal(outcome.state,'commit-disconnected');
  return attempt;
 };
 m.modules.runRegisteredNullCrossCompanyDisconnectRecovery=async(proof,execution,continuity)=>{
  assert.equal(proof,rollback);
  assert.equal(execution.owner,f.session.owner);assert.equal(execution.observer,f.session.observer);
  assert.equal(execution.runtime,f.otherSession.runtime);
  assert.equal(execution.password,m.captured().execution.password);
  assert.equal(execution.httpTimeoutMs,5000);
  assert.equal(typeof continuity.requestJson,initialSeedProfile?'function':'undefined');
  if(mode==='post-first')continuity.assertHttpRequest(post,'POST');
  continuity.assertHttpRequest(mode==='foreign-key'?'/payment-executions/results/foreign':result,'GET');
  if(mode==='resolved-key')throw Object.assign(new Error('PG_CASE_DISCONNECT_KEY_ALREADY_RESOLVED'),{requestBody:'private key model'});
  continuity.assertHttpRequest(post,'POST');trace.push('recovery-post');
  continuity.assertHttpRequest(result,'GET');
  return {caseId:'registered.null-cross-company.disconnect-commit-recovery',passed:true,rollbackObserved:true,
   executionId:'11111111-1111-4111-8111-111111111111',rootId:'22222222-2222-4222-8222-222222222222'};
 };
 const first=await f.api.withCurrent259OwnedDisconnectApplication(f.proof,f.handle,signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{...scope,disconnectPhase:'attempt'})));
 assert.equal(first.value,attempt);
 assert.equal(f.api.claimCurrent259DisconnectApplicationClose(first.closeProof,f.proof,f.handle),'http://127.0.0.1:52124/');
 const recover=()=>f.api.withCurrent259OwnedApplication(f.secondProof,f.handle,signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{...scope,disconnectPhase:'recovery',disconnectAttempt:attempt,disconnectRollback:rollback})));
 if(mode==='complete'||mode==='complete-261'){
  assert.equal((await recover()).rollbackObserved,true);
  assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
  assert.deepEqual(trace,['fault-ready','original-post','recovery-post']);assert.equal(f.resourceCloses(),0);
 }else{
  await assert.rejects(recover(),error=>{
   assert.equal(error.code,'TASK16_APP_FAILED_CLOSED');
   const detail=require('./task16-current259-disconnect-failure.cjs').describeCurrent259DisconnectFailure(error);
   assert.deepEqual(detail,{stage:'RECOVERY_PAYMENT',code:mode==='resolved-key'?
    'PG_CASE_DISCONNECT_KEY_ALREADY_RESOLVED':'CURRENT259_PAYMENT_CASE_FAILED_CLOSED'});
   assert.doesNotMatch(JSON.stringify(detail),/private key/u);
   return true;
  });
  assert.deepEqual(trace,['fault-ready','original-post']);assert.equal(f.resourceCloses(),1);
 }
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
});

for(const mode of ['early','foreign','duplicate','missing','missing-fault','wrong-fault'])test('cancellation refuses the '+mode+' original-key result read',async t=>{
 const f=caseFixture(t),m=paymentModel(f);
 f.session.cancelCommit=async(token,submit)=>{f.session.checkContinuity(token);await submit();return mode==='missing-fault'?undefined:mode==='wrong-fault'?{...cancelOutcome,state:'commit-disconnected'}:cancelOutcome;};
 m.modules.runRegisteredNullCrossCompanyCommitCancellation=async(execution,fixture,continuity,cancel)=>{
  const resultRoute='/payment-executions/results/'+m.plan.ids.requestKey;
  if(mode==='early')continuity.assertHttpRequest(resultRoute,'GET');
  await cancel(async()=>continuity.assertHttpRequest('/payment-executions/'+m.plan.ids.payment+'/registrations','POST'));
  if(mode!=='missing')continuity.assertHttpRequest(mode==='foreign'?'/payment-executions/results/foreign':resultRoute,'GET');
  if(mode==='duplicate')continuity.assertHttpRequest(resultRoute,'GET');
  return {caseId:'registered.null-cross-company.cancel-commit',passed:true,rollbackObserved:true,originalResultUnconfirmed:true};
 };
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await assert.rejects(f.caseApi.runCurrent259PaymentCase(app,f.handle,
   f.issue(app,{scenario:'cancel-commit',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})),
   {code:'CURRENT259_PAYMENT_CASE_FAILED_CLOSED'});
 }),{code:'TASK16_APP_FAILED_CLOSED'});
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
});

for(const [scenario,transportScenario] of [['normal','response-loss'],['response-loss','normal']])
 test('a mismatched issued payment transport fails before any fixture or case: '+scenario,async t=>{
 const f=caseFixture(t,{transportScenario}),m=paymentModel(f);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  const permit=f.issue(app,{scenario,paidAt:m.plan.paidAt,openingDate:m.plan.openingDate});
  await assert.rejects(f.caseApi.runCurrent259PaymentCase(app,f.handle,permit),/CURRENT259_PAYMENT_CASE_FAILED_CLOSED/u);
 }));
 assert.deepEqual(m.counts(),{builds:0,seeds:0,consumers:0});
});

const gapScope=Object.freeze({scenario:'attribution-gap',caseId:'registered.project-attribution-gap',handler:'runRegisteredProjectAttributionGap',
 attributionGap:Object.freeze({expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false})});
function gapCaseModel(t,mode){
 const f=caseFixture(t,mode==='wrong-topology'?{transportScenario:'normal'}:{}),m=paymentModel(f);
 m.plan.ids.companyB='61345678-1234-4234-8234-123456789abc';
 m.modules.seedRegisteredPgAttributionGapFixture=async(...args)=>({
  ...await m.modules.seedRegisteredPgFixture(...args),
  attributionGap:{otherProjectId:'model-foreign-project',otherSourceId:'model-foreign-source'}
 });
 m.modules.runRegisteredProjectAttributionGap=async(execution,fixture,continuity)=>{
  const call=(method,route,body)=>{continuity.assertHttpRequest(route,method);continuity.assertHttpBody(route,method,body);};
  const failAt=stage=>{
   if(mode===stage){continuity.markAttributionGapStage?.(stage);throw new Error('raw private failing response');}
  };
  const {ids}=fixture.plan,account='company:'+ids.companyB,payment='/payment-executions/'+ids.payment;
  const original='/payment-executions/results/'+ids.requestKey,post=payment+'/registrations';
  failAt('PUBLIC_ACCOUNT');
  call('GET','/fund-accounts/'+account);
  call('GET',payment+'/registration-options');
  const command={idempotencyKey:ids.requestKey,expectedPaymentUpdatedAt:'2026-11-10T00:00:00.000Z',amountCents:'800',
   paidAt:m.plan.paidAt,scopeKey:account,expectedRegistrationId:'b',openingTreatment:'not_included',
   openingReason:'本次付款未计入核对期初',openingEvidence:'隔离PG合成项目归属差额',
   sourceAllocations:[{sourceBatchId:'s',amountCents:'500'},{sourceBatchId:'model-foreign-source',amountCents:'300'}],
   confirmationPassword:execution.password};
  if(mode==='wrong-source')command.sourceAllocations[1].sourceBatchId='s';
  if(mode==='extra-property')command.observationSelectionRef='foreign';
  failAt('REGISTRATION');
  call('POST',post,command);
  if(mode==='second-post')call('POST',post,command);
  failAt('ORIGINAL_RESULT');
  if(mode!=='omitted-result')call('GET',mode==='wrong-key'?original+'-drift':original);
  failAt('OWNER_AFTER');
  return {caseId:gapScope.caseId,passed:true,registrationStatus:409,projectAmountCents:'500',gapAmountCents:'300',originalResultUnconfirmed:true,
   ...(mode==='claimed-execution'?{executionId:'model-claimed-id'}:{})};
 };
 const invoke=async()=>f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>{
  const permit=f.issue(app,{...gapScope,paidAt:m.plan.paidAt,openingDate:m.plan.openingDate});
  return f.caseApi.runCurrent259PaymentCase(app,f.handle,permit);
 });
 return {f,m,invoke};
}
test('owned attribution-gap permission only publishes the rejection and hashed original key',async t=>{
 const {m,invoke}=gapCaseModel(t,'valid');
 const result=await invoke();
 assert.deepEqual(result,{caseId:gapScope.caseId,passed:true,
  attributionGapEvidence:{registrationStatus:409,projectAmountCents:'500',gapAmountCents:'300',originalResultUnconfirmed:true,
   originalRequestKeySha256:createHash('sha256').update(m.plan.ids.requestKey).digest('hex')},financialAcceptance:false});
 assert.equal(m.counts().seeds,1);
});
for(const mode of ['wrong-topology','wrong-source','extra-property','second-post','wrong-key','omitted-result','claimed-execution']){
 test('owned attribution-gap permission rejects '+mode,async t=>{
  const {m,invoke}=gapCaseModel(t,mode);
  await assert.rejects(invoke(),/TASK16_APP_FAILED_CLOSED/u);
  if(mode==='wrong-topology')assert.equal(m.counts().seeds,0);
 });
}


for(const stage of ['PUBLIC_ACCOUNT','REGISTRATION','ORIGINAL_RESULT','OWNER_AFTER']){
 test('the owned attribution-gap wrapper records the first failure at '+stage+' before closure',async t=>{
  const {f,invoke}=gapCaseModel(t,stage);
  await assert.rejects(invoke(),/TASK16_APP_FAILED_CLOSED/u);
  const failures=f.calls.filter(row=>Array.isArray(row)&&row[0]==='gap-first-failure');
  assert.deepEqual(failures,[['gap-first-failure',stage]]);
  assert.ok(f.calls.indexOf(failures[0])<f.calls.indexOf('app-close'));
  assert.equal(f.calls.filter(row=>row==='app-close').length,1);
  assert.equal(f.calls.filter(row=>row==='sessions-close').length,1);
 });
}

for(const [substage,subcode] of [['SEED_IDENTITY','PG_RESOURCE_RUNTIME_PRIVILEGES'],['SEED_OWNER_TRANSACTION','P2028'],['SEED_LOGIN','TIMEOUT']]){
 test('payment case retains the seed first failure before closing '+substage,async t=>{
  const seen=[],f=caseFixture(t,{recordCaseFailure:(...detail)=>seen.push(detail)});
  const m=paymentModel(f,{onSeed(continuity){
   continuity.recordSeedFailure(substage,subcode);
   throw Object.assign(new Error('private fixture payload'),{code:'TASK16_FIXTURE_FAILED_CLOSED'});
  }});
  await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
   await f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}));
  }));
  assert.deepEqual(seen,[[substage,subcode],['SEED_FIXTURE','TASK16_FIXTURE_FAILED_CLOSED']]);
  assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
  assert.ok(f.calls.includes('app-close'));
 });
}

for(const seedStage of ['SEED_LOGIN','SEED_OPENING'])test('seed '+seedStage+' binds its native fetch failure to the matching HTTP route',async t=>{
 const seen=[],f=caseFixture(t,{recordCaseFailure:(...detail)=>seen.push(detail)});
 const m=paymentModel(f,{async onSeed(continuity){
  try{
   const target=new URL('/auth/login',m.captured().execution.proof.application.origin);
   await continuity.fetch(target,{method:'POST',signal:AbortSignal.abort()});
  }catch(error){
   continuity.recordSeedFailure(seedStage,'HTTP_ABORTED');
   throw error;
  }
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}));
 }));
 assert.deepEqual(seen[0],seedStage==='SEED_LOGIN'?['SEED_LOGIN','HTTP_ABORTED',undefined,'FETCH']:['SEED_OPENING','HTTP_ABORTED']);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
});

for(const profile of [undefined,'TASK16_PAYMENT259_RUNTIME_V1','TASK16_PAYMENT261_RUNTIME_V1']){
 test('owned seed JSON capability requires the explicit ordinary261 profile '+profile,async t=>{
  const f=caseFixture(t,{ordinarySeedProfile:profile});
  const m=paymentModel(f,{onSeed(continuity){
   assert.equal(typeof continuity.requestJson,profile==='TASK16_PAYMENT261_RUNTIME_V1'?'function':'undefined');
  }});
  const run=()=>f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
   f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})));
  if(profile==='TASK16_PAYMENT259_RUNTIME_V1'){
   await assert.rejects(run());assert.deepEqual(m.counts(),{builds:0,seeds:0,consumers:0});
  }else{await run();assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:1});}
 });
}

test('owned seed JSON capability rejects a larger network budget before native fetch',async t=>{
 const seen=[],f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)});
 const m=paymentModel(f,{async onSeed(continuity){
  try{await continuity.requestJson(new URL('/auth/login',m.captured().execution.proof.application.origin),{method:'POST'},5001);}
  catch(error){continuity.recordSeedFailure('SEED_LOGIN',error.message);throw error;}
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen[0],['SEED_LOGIN','CURRENT259_PAYMENT_CASE_FAILED_CLOSED',undefined,'TARGET']);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
});

for(const scenario of ['normal','response-loss'])test('only explicit261 selected '+scenario+' receives JSON capability',async t=>{
 const f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1'});
 const m=paymentModel(f,{onCase(continuity){assert.equal(typeof continuity.requestJson,'function');}});
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario,paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})));
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:1});
});

for(const [name,code] of [['TimeoutError','TIMEOUT'],['AbortError','HTTP_ABORTED']])test('selected JSON preserves only fixed native '+name+' classification',async t=>{
 const seen=[],f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)});
 const m=paymentModel(f,{onCase(){throw new DOMException('private native response details',name);}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen,[['SELECTED_CASE',code]]);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:1});
});

for(const mode of ['missing','hash','profile','count'])test('normal261 case rejects '+mode+' permission binding before seed',async t=>{
 const f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',permissionBinding(binding){
  return mode==='missing'?undefined:{...binding,...(mode==='hash'?{accessPlanSha256:'0'.repeat(64)}:mode==='profile'?{paymentProfile:'TASK12_ARCHIVE261_SOURCE_V1'}:{insertAdditionCount:8})};
 }}),m=paymentModel(f);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(m.counts(),{builds:0,seeds:0,consumers:0});
});

for(const status of [200,503])test('seed post-response guard failure keeps the obtained HTTP status '+status+' and fixed original guard diagnostic',async t=>{
 const http=require('node:http'),seen=[];
 let f;
 const server=http.createServer((_request,response)=>{
  response.writeHead(status,{'content-type':'application/json','connection':'close'});response.end('{"privateBody":"never retain"}');
  f.view.check=()=>{throw Object.assign(new Error('private URL SQL token'),{code:'CURRENT259_RESOURCE_CLOSED'});};
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port;
 f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)});
 f.apps[0].server.address=()=>({address:'127.0.0.1',family:'IPv4',port});
 const m=paymentModel(f,{async onSeed(continuity){
  try{await continuity.requestJson(new URL('/auth/login',m.captured().execution.proof.application.origin),{method:'POST',headers:{connection:'close'}},5000);}
  catch(error){continuity.recordSeedFailure('SEED_LOGIN',error.code);throw error;}
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen[0],['SEED_LOGIN','TASK16_APP_FAILED_CLOSED',status,'AFTER_CHECK',
  {guardPhase:'RESOURCE_VIEW_SOURCE_METHODS',originCode:'CURRENT259_RESOURCE_CLOSED'}]);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});assert.doesNotMatch(JSON.stringify(seen),/private|never retain|URL SQL token/u);
});

test('seed malformed JSON retains the already obtained status at BODY without retaining the response body',async t=>{
 const http=require('node:http'),seen=[];
 const server=http.createServer((_request,response)=>{response.writeHead(500,{'content-type':'application/json','connection':'close'});response.end('private invalid SQL body URL token');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)}),port=server.address().port;
 f.apps[0].server.address=()=>({address:'127.0.0.1',family:'IPv4',port});
 const m=paymentModel(f,{async onSeed(continuity){
  try{await continuity.requestJson(new URL('/auth/login',m.captured().execution.proof.application.origin),{method:'POST',headers:{connection:'close'}},5000);}
  catch(error){continuity.recordSeedFailure('SEED_LOGIN',error.code);throw error;}
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen[0],['SEED_LOGIN',undefined,500,'BODY']);assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
 assert.doesNotMatch(JSON.stringify(seen),/private|SQL body|URL token/u);
});

test('a second same-route pre-transport guard failure cannot borrow the completed first opening status',async t=>{
 const http=require('node:http'),seen=[];let requests=0;
 const server=http.createServer((_request,response)=>{requests++;response.writeHead(201,{'content-type':'application/json','connection':'close'});response.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)}),port=server.address().port;
 f.apps[0].server.address=()=>({address:'127.0.0.1',family:'IPv4',port});
 const m=paymentModel(f,{async onSeed(continuity){
  const target=new URL('/fund-accounts/openings',m.captured().execution.proof.application.origin);
  const checked=async operation=>{continuity.checkLight();const value=await operation();continuity.checkLight();return value;};
  const first=await checked(()=>continuity.requestJson(target,{method:'POST',headers:{connection:'close'}},5000));
  assert.equal(first.response.status,201);
  f.view.check=()=>{throw Object.assign(new Error('private second-opening guard'),{code:'CURRENT259_RESOURCE_CLOSED'});};
  try{await checked(()=>continuity.requestJson(target,{method:'POST',headers:{connection:'close'}},5000));}
  catch(error){continuity.recordSeedFailure('SEED_OPENING',error.code,undefined,
   require('./task16-current259-payment-diagnostics.cjs').describePaymentDiagnostic(error));throw error;}
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen[0],['SEED_OPENING','TASK16_APP_FAILED_CLOSED',undefined,undefined,
  {guardPhase:'RESOURCE_VIEW_SOURCE_METHODS',originCode:'CURRENT259_RESOURCE_CLOSED'}]);
 assert.equal(requests,1);assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
});

test('completed transport still preserves the fixture explicit current status without reusing its observation',async t=>{
 const http=require('node:http'),seen=[];
 const server=http.createServer((_request,response)=>{response.writeHead(503,{'content-type':'application/json','connection':'close'});response.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const f=caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row)}),port=server.address().port;
 f.apps[0].server.address=()=>({address:'127.0.0.1',family:'IPv4',port});
 const m=paymentModel(f,{async onSeed(continuity){
  const current=await continuity.requestJson(new URL('/fund-accounts/openings',m.captured().execution.proof.application.origin),{method:'POST',headers:{connection:'close'}},5000);
  continuity.recordSeedFailure('SEED_OPENING','PG_FIXTURE_REAL_HTTP_OPENING',current.response.status);
  throw Object.assign(new Error('PG_FIXTURE_REAL_HTTP_OPENING'),{code:'PG_FIXTURE_REAL_HTTP_OPENING'});
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate}))));
 assert.deepEqual(seen[0],['SEED_OPENING','PG_FIXTURE_REAL_HTTP_OPENING',503]);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
});
