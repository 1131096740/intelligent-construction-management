'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
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
 let factory;const permissions=new WeakMap(),holder={exports:{}};
 const authorization={claimCurrent259PaymentBusinessPermit(permit,application,handle){
  const record=permissions.get(permit);permissions.delete(permit);
  assert.ok(record&&record.application===application&&record.handle===handle,'untrusted business token');
  return {scope:record.scope,check(){if(record.closed)throw new Error('closed permission');record.application.inspect();}};
 }};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-payment-case.cjs'),'utf8'))(
  name=>name==='./task16-current259-application-factory.cjs'?factory:name==='./task16-current259-payment-run-authorization.cjs'?authorization:require(name),holder);
 const f=owned(t,{...options,paymentModule:holder.exports});factory=f.api;
 return {...f,caseApi:holder.exports,issue(application,scope){const token=Object.freeze({});permissions.set(token,{application,handle:f.handle,scope:Object.freeze({...scope,authorizationReference:'synthetic-approved-model-only'})});return token;}};
}

function paymentModel(f,options={}){
 const runId='01234567-89ab-cdef-0123-456789abcdef';
 f.view.resource.getReceipt=()=>({runId,databaseName:f.session.identity[0].database,port:f.session.endpoint.publishedPort});
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
