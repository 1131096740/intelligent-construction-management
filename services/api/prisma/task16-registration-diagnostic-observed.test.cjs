'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
// Explicit build-dependent local technical component; no PG/business admission.
// Actual Nest collector + original factory lease/case/receipt implementation.
// Only outer source/session/financial admission uses the existing labeled model.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const apiRequire=createRequire(path.join(__dirname,'../package.json'));
const common=apiRequire('@nestjs/common'),{NestFactory,APP_FILTER}=apiRequire('@nestjs/core');
const {Prisma}=apiRequire('@prisma/client');
const diagnostic=require('../dist/database/task16-registration-error-diagnostic.js');
let technicalError;
class TechnicalController {record(){throw technicalError;}}
common.Controller('payment-executions')(TechnicalController);
common.Post(':paymentId/registrations')(TechnicalController.prototype,'record',Object.getOwnPropertyDescriptor(TechnicalController.prototype,'record'));
class TechnicalModule {}
common.Module({controllers:[TechnicalController],providers:[diagnostic.Task16RegistrationErrorFilter,{provide:APP_FILTER,useExisting:diagnostic.Task16RegistrationErrorFilter}]})(TechnicalModule);
const modelFile=path.join(__dirname,'task16-current259-payment-case.test.cjs'),noop=()=>{};
const model=new Function('require','module','__dirname',fs.readFileSync(modelFile,'utf8')+'\nreturn {caseFixture,paymentModel};')(
 name=>name==='node:test'?{test:noop}:require(name),{exports:{}},__dirname);
const controllerFile=path.join(__dirname,'task16-current259-payment-run-authorization.test.cjs');
const controllerFixture=new Function('require','module','__dirname',fs.readFileSync(controllerFile,'utf8')+'\nreturn ordinaryBusinessFailureFixture;')(
 name=>name==='node:test'?{test:noop}:require(name),{exports:{}},__dirname);
const supportedCodes=['P1000','P1001','P1002','P1003','P1008','P1010','P1011','P1017','P2000','P2002','P2003','P2004','P2010','P2011','P2021','P2022','P2024','P2025','P2028','P2034'];
const supportedStates=['23502','23503','23505','42501','25006','25P02','40001','40P01','42P01','42703','57014'];
const technicalCases=[...supportedCodes.map(code=>({code,state:'42501'})),...supportedStates.map(state=>({code:'P2010',state})),
 ...['P1000','P1003'].map(code=>({code,initialization:true})),
 {code:'P9999',state:'PRIVATE',untrusted:true},
 ...['getter','proxy'].map(metaMode=>({code:'P2028',metaMode})),
 {code:'P2010',state:'42501',stale:true}];
for(const {code,state,initialization,untrusted,metaMode,stale}of technicalCases)test('actual collector through original private lease/case/receipt '+code+'/'+(state??metaMode??'initialization')+(stale?'/stale':'')+' (modeled admission)',async t=>{
 const app=await NestFactory.create(TechnicalModule,{logger:false});await app.listen(0,'127.0.0.1');t.after(()=>app.close());
 const seen=[];let traps=0;
 const meta={code:state,detail:'private'};
 if(metaMode==='getter')Object.defineProperty(meta,'code',{get(){traps++;throw Error('private getter');}});
 const metadata=metaMode==='proxy'?new Proxy(meta,{getOwnPropertyDescriptor(){traps++;throw Error('private proxy');}}):meta;
 technicalError=initialization?new Prisma.PrismaClientInitializationError('private technical fixture','fixture',code):new Prisma.PrismaClientKnownRequestError('private technical fixture',{code,clientVersion:'fixture',meta:metadata});
 t.after(()=>{technicalError=undefined;});
 const f=model.caseFixture(t,{ordinarySeedProfile:'TASK16_PAYMENT261_RUNTIME_V1',recordCaseFailure:(...row)=>seen.push(row),
  diagnostic:{Class:diagnostic.Task16RegistrationErrorFilter,filter:app.get(diagnostic.Task16RegistrationErrorFilter),server:app.getHttpServer(),arm:diagnostic.armTask16RegistrationError,take:diagnostic.takeTask16RegistrationError}});
 const m=model.paymentModel(f,{async onCase(c){c.markCaseGate('REGISTRATION_REQUEST');
  const result=await c.requestJson(new URL('/payment-executions/'+m.plan.ids.payment+'/registrations',await app.getUrl()),{method:'POST',headers:{'Content-Type':'application/json',connection:'close'},body:JSON.stringify({idempotencyKey:m.plan.ids.requestKey})},5000);
  assert.equal(result.response.status,500);assert.deepEqual(result.body,{statusCode:500,message:'Internal server error'});
  if(stale)await c.requestJson(new URL('/payment-executions/results/'+m.plan.ids.requestKey,await app.getUrl()),{method:'GET',headers:{connection:'close'}},5000);
  throw Object.assign(new Error('private original201 assertion'),{code:'PG_CASE_REGISTRATION_HTTP_STATUS',httpStatus:result.response.status,expectedHttpStatus:201});
 }});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await assert.rejects(f.caseApi.runCurrent259PaymentCase(app,f.handle,f.issue(app,{scenario:'normal',paidAt:m.plan.paidAt,openingDate:m.plan.openingDate})),error=>error.fixtureOutcome==='UNKNOWN_DO_NOT_RETRY');assert.throws(()=>app.inspect());
 }));
 assert.deepEqual(seen[0]?.[4],{httpStatus:500,expectedHttpStatus:201,...(!stale?{serverErrorKind:initialization?'INITIALIZATION_ERROR':'KNOWN_REQUEST_ERROR',
  ...(!untrusted?{serverPrismaCode:code}:{}),...(!initialization&&!metaMode&&!untrusted?{serverSqlState:state}:{})}:{}),caseGate:'REGISTRATION_REQUEST',errorKind:'ERROR'});
 assert.equal(traps,0);
 // Send this actual captured case result through the original controller's
 // first-failure projection and real JSON receipt writer, with modeled resource gates.
 const controller=controllerFixture(t,{caseFailure:new Error('private roundtrip primary'),onBusiness({lease}){
  lease.recordCaseFailure('SELECTED_CASE','PG_CASE_REGISTRATION_HTTP_STATUS',undefined,'RESPONSE_RETURNED',seen[0][4]);
 }});
 const outcome=await controller.done,receiptText=fs.readFileSync(path.join(controller.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(receiptText);
 assert.equal(outcome.status,'STOPPED');assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',code:'PG_CASE_REGISTRATION_HTTP_STATUS',httpPhase:'RESPONSE_RETURNED',...seen[0][4]});
 assert.doesNotMatch(receiptText,/private roundtrip primary|private technical fixture|private original201 assertion/);
 assert.doesNotMatch(JSON.stringify(seen),/private/);
});
