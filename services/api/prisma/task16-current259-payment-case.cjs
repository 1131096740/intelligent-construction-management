'use strict';
// Only the original factory's private lease and the fresh-main business issuer
// can reach the fixed seed/cases. Importing does not construct/connect anything.
const {types,isDeepStrictEqual:equal}=require('node:util');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
const authorization=require('./task16-current259-payment-run-authorization.cjs');
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');
const originalFetch=fetchDescriptor?.value;
const builtin=process.binding('natives')['internal/bootstrap/web/exposed-window-or-worker'];
const qualifiedFetch=typeof originalFetch==='function'&&typeof builtin==='string'&&builtin.includes(Function.prototype.toString.call(originalFetch));
const need=ok=>{if(!ok)throw new Error('CURRENT259_PAYMENT_CASE_FAILED_CLOSED');};
function snapshot(value){
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const ds=Object.getOwnPropertyDescriptors(value);need(Reflect.ownKeys(ds).every(k=>typeof k==='string'&&Object.hasOwn(ds[k],'value')));
 if(Array.isArray(value))return Object.freeze(Array.from({length:value.length},(_,i)=>snapshotValue(ds[i]?.value)));
 need(Object.getPrototypeOf(value)===Object.prototype);
 return Object.freeze(Object.fromEntries(Object.keys(ds).map(k=>[k,snapshotValue(ds[k].value)])));
}
function snapshotValue(value){return value!==null&&typeof value==='object'?snapshot(value):value;}
const used=new WeakSet();
async function executeCurrent259PaymentCase(lease,permit){
 const factory=require('./task16-current259-application-factory.cjs');
 need(factory.isCurrent259PaymentLease(lease)&&!used.has(lease));used.add(lease);
 let attempted=false,permission;
 try{
  permission=authorization.claimCurrent259PaymentBusinessPermit(permit,lease.application,lease.handle);
  permission.check();lease.check();
  const {session,loader,source}=lease,load=Object.getOwnPropertyDescriptor(loader,'loadPaymentModules')?.value;
  need(typeof load==='function'&&qualifiedFetch);
  const original={...Object.fromEntries(['owner','runtime','observer','verifyFull','checkLight'].map(k=>[k,session[k]]))};
  const resource=snapshot(lease.resourceIdentity()),identity=snapshot(session.identity[0]);
  need(resource.databaseName===identity.database&&Number.isInteger(resource.port)&&resource.port===session.endpoint.publishedPort);
  const material=loadCurrent259CatalogMaterial(source);
  const check=()=>{
   permission.check();lease.check();
   need(session===lease.session&&loader===lease.loader&&source===lease.source&&Object.getOwnPropertyDescriptor(loader,'loadPaymentModules')?.value===load&&
    Object.keys(original).every(k=>session[k]===original[k])&&equal(lease.resourceIdentity(),resource)&&equal(session.identity[0],identity)&&
    Object.getOwnPropertyDescriptor(globalThis,'fetch')?.value===originalFetch);
  };
  check();await original.verifyFull.call(session);check();
  const modules=load.call(loader);check();
  const names=['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss'];
  const methods=Object.fromEntries(names.map(k=>{const d=Object.getOwnPropertyDescriptor(modules,k);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function');return [k,d.value];}));
  const scope=permission.scope,runId=resource.runId.replaceAll('-','').slice(0,12);
  const proof=Object.freeze({authorizationReference:scope.authorizationReference,runId,resourceRunId:resource.runId,databaseName:resource.databaseName,
   databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,host:'127.0.0.1',port:resource.port,
   ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:source.sealSha256,
   preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(r=>[path.basename(r.path),r.sha256]))),
   transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin:lease.application.origin,databaseRole:'jg_task01_runtime',sourceSealSha256:source.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})});
  const plan=snapshot(methods.buildRegisteredPgFixturePlan(runId,scope.paidAt,scope.openingDate));check();
  const execution=Object.freeze({proof,owner:original.owner,runtime:original.runtime,observer:original.observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000});
  const transport=async(target,init)=>{check();const url=new URL(target);need(url.origin===new URL(proof.application.origin).origin&&url.pathname.startsWith('/')&&!url.username&&!url.password&&!url.hash);const response=await originalFetch(target,init);check();return response;};
  attempted=true;
  const prepared=await methods.seedRegisteredPgFixture(execution,plan,Object.freeze({checkLight:check,fetch:transport}));check();
  const frozen=snapshot(prepared);need(equal(frozen.plan,plan)&&typeof frozen.accessToken==='string');
  await original.verifyFull.call(session);check();
  const checkPrepared=()=>{check();need(equal(snapshot(prepared),frozen)&&names.every(k=>Object.getOwnPropertyDescriptor(modules,k)?.value===methods[k]));};
  const assertHttpRequest=(route,method)=>{
   checkPrepared();const ids=plan.ids;
   need(method==='POST'&&route===`/payment-executions/${ids.payment}/registrations`||method==='GET'&&
    [ `/payment-executions/${ids.payment}/registration-options`,`/payment-executions/results/${ids.requestKey}`].includes(route));
  };
  const handler=scope.scenario==='normal'?methods.runRegisteredNullCrossCompanyCommit:methods.runRegisteredNullCrossCompanyResponseLoss;
  need(['normal','response-loss'].includes(scope.scenario));
  const result=await handler(execution,frozen,Object.freeze({checkLight:checkPrepared,fetch:transport,assertHttpRequest}));checkPrepared();
  await original.verifyFull.call(session);checkPrepared();
  const caseId=scope.scenario==='normal'?'registered.null-cross-company.commit':'registered.null-cross-company.response-loss';
  need(result&&result.caseId===caseId&&result.passed===true&&[result.executionId,result.rootId].every(value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)));
  return Object.freeze({caseId,passed:true,executionId:result.executionId,rootId:result.rootId,financialAcceptance:false});
 }catch{
  let cleanup='UNKNOWN_DO_NOT_CONTINUE';
  try{await lease.failClosed();cleanup='FIXED_CLOSE_RETURNED_NOT_FULL_PROOF';}catch{/* retain safe unknown */}
  throw Object.assign(new Error('CURRENT259_PAYMENT_CASE_FAILED_CLOSED'),{code:'CURRENT259_PAYMENT_CASE_FAILED_CLOSED',fixtureOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:cleanup==='UNKNOWN_DO_NOT_CONTINUE'?cleanup:'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF'});
 }
}
function runCurrent259PaymentCase(application,handle,permit){return require('./task16-current259-application-factory.cjs').consumeCurrent259PaymentApplication(application,handle,permit);}
module.exports=Object.freeze({runCurrent259PaymentCase,executeCurrent259PaymentCase});
