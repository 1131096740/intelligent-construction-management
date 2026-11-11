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
  return {scope:record.scope,continuityToken,verifyFull(){f.calls.push('permission-full');record.application.inspect();},check(){if(record.closed)throw new Error('closed permission');record.application.inspect();}};
 }};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-payment-case.cjs'),'utf8'))(
  name=>name==='./task16-current259-application-factory.cjs'?factory:name==='./task16-current259-payment-run-authorization.cjs'?authorization:require(name),holder);
 f=owned(t,{...options,businessGuard,paymentModule:holder.exports});factory=f.api;
 f.view.checkLifetime=f.view.check;
 f.session.activateBusinessContinuity=token=>{businessGuard(token,f.handle);f.calls.push('activate-continuity');};
 f.session.deactivateBusinessContinuity=token=>{businessGuard(token,f.handle);f.calls.push('finish-continuity');};
 f.session.checkContinuity=token=>{businessGuard(token,f.handle);f.session.checkLight();};
 return {...f,caseApi:holder.exports,issue(application,scope){
  const profile=require('./task16-current259-payment-loopback.cjs').paymentLoopbackForScenario(options.transportScenario??scope.scenario);
  if(profile){
   const {publishedPort,port}=f.session.endpoint;
   f.session.endpoint={transport:profile.topology,relayId:'12345678-1234-4234-8234-123456789012',host:'127.0.0.1',port:publishedPort??port};
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
   await options.onSeed?.();
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

test('A16 recovery uses the replacement application with exactly the original seed and password',async t=>{
 const f=caseFixture(t,{retirement:true}),m=paymentModel(f);
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
  continuity.assertHttpRequest(result,'GET');
  continuity.assertHttpRequest(post,'POST');trace.push('recovery-post');
  continuity.assertHttpRequest(result,'GET');
  return {caseId:'registered.null-cross-company.disconnect-commit-recovery',passed:true,rollbackObserved:true,
   executionId:'11111111-1111-4111-8111-111111111111',rootId:'22222222-2222-4222-8222-222222222222'};
 };
 const first=await f.api.withCurrent259OwnedDisconnectApplication(f.proof,f.handle,signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{...scope,disconnectPhase:'attempt'})));
 assert.equal(first.value,attempt);
 assert.equal(f.api.claimCurrent259DisconnectApplicationClose(first.closeProof,f.proof,f.handle),'http://127.0.0.1:52124/');
 const recovered=await f.api.withCurrent259OwnedApplication(f.secondProof,f.handle,signal,app=>
  f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{...scope,disconnectPhase:'recovery',disconnectAttempt:attempt,disconnectRollback:rollback})));
 assert.equal(recovered.rollbackObserved,true);
 assert.deepEqual(trace,['fault-ready','original-post','recovery-post']);
 assert.deepEqual(m.counts(),{builds:1,seeds:1,consumers:0});
 assert.equal(f.resourceCloses(),0);
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
