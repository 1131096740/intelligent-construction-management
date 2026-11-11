'use strict';
// Only the original factory's private lease and the fresh-main business issuer
// can reach the fixed seed/cases. Importing does not construct/connect anything.
const {types,isDeepStrictEqual:equal}=require('node:util');
const {createHash,randomBytes}=require('node:crypto');
const path=require('node:path');
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
const authorization=require('./task16-current259-payment-run-authorization.cjs');
const {paymentLoopbackForScenario,isCurrent259PaymentLoopbackTopology}=require('./task16-current259-payment-loopback.cjs');
const {captureCurrent259DisconnectFailure,carryCurrent259DisconnectFailure}=require('./task16-current259-disconnect-failure.cjs');
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
const used=new WeakSet(),disconnectAttempts=new WeakMap();
async function executeCurrent259PaymentCase(lease,permit){
 const factory=require('./task16-current259-application-factory.cjs');
 need(factory.isCurrent259PaymentLease(lease)&&!used.has(lease));used.add(lease);
 let attempted=false,permission,disconnectStage;
 try{
  permission=authorization.claimCurrent259PaymentBusinessPermit(permit,lease.application,lease.handle);
  permission.check();lease.activateContinuity(permission.continuityToken);lease.check();
  const scope=permission.scope,cancellation=scope.scenario==='cancel-commit',disconnect=scope.scenario==='disconnect-commit-recovery';
  const recovery=disconnect&&scope.disconnectPhase==='recovery';
  if(disconnect)disconnectStage=recovery?'RECOVERY_PAYMENT':'ORIGINAL_PAYMENT_ATTEMPT';
  const faulting=cancellation||disconnect&&!recovery;
  need(cancellation||disconnect&&['attempt','recovery'].includes(scope.disconnectPhase)||['normal','response-loss'].includes(scope.scenario));
  const {session,loader,source}=lease,load=Object.getOwnPropertyDescriptor(loader,'loadPaymentModules')?.value;
  const faultName=disconnect?'disconnectCommit':'cancelCommit';
  const commitFault=Object.getOwnPropertyDescriptor(session,faultName)?.value;
  need(!faulting||typeof commitFault==='function');
  const prior=recovery?disconnectAttempts.get(scope.disconnectAttempt):undefined;
  if(recovery){
   need(prior&&prior.handle===lease.handle&&typeof scope.disconnectRollback==='object'&&scope.disconnectRollback);
   disconnectAttempts.delete(scope.disconnectAttempt);
  }
  need(typeof load==='function'&&qualifiedFetch);
  const original={...Object.fromEntries(['owner','runtime','observer','verifyFull','checkLight'].map(k=>[k,session[k]]))};
  const resource=snapshot(lease.resourceIdentity()),identity=snapshot(session.identity[0]);
  const loopback=paymentLoopbackForScenario(scope.scenario);
  need(resource.databaseName===identity.database&&Number.isInteger(resource.port));
  if(loopback){
   const {endpoint}=session,relay=resource.relay;
   need(resource.topology===loopback.topology&&endpoint.transport===loopback.topology&&
    typeof endpoint.relayId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(endpoint.relayId)&&
    endpoint.relayId===relay?.id&&relay.containerId===resource.containerId&&relay.host==='127.0.0.1'&&
    endpoint.host===relay.host&&endpoint.port===resource.port&&relay.port===resource.port);
  }else need(!isCurrent259PaymentLoopbackTopology(resource.topology)&&resource.port===session.endpoint.publishedPort);
  if(recovery)need(resource.runId===prior.runId&&resource.topology===prior.topology&&equal(resource.relay,prior.relay));
  const material=loadCurrent259CatalogMaterial(source);
  const check=()=>{
   permission.check();lease.check();
   need(session===lease.session&&loader===lease.loader&&source===lease.source&&Object.getOwnPropertyDescriptor(loader,'loadPaymentModules')?.value===load&&
    Object.keys(original).every(k=>session[k]===original[k])&&(!faulting||Object.getOwnPropertyDescriptor(session,faultName)?.value===commitFault)&&equal(lease.resourceIdentity(),resource)&&equal(session.identity[0],identity)&&
    Object.getOwnPropertyDescriptor(globalThis,'fetch')?.value===originalFetch);
  };
  check();await permission.verifyFull();await original.verifyFull.call(session);check();
  const modules=load.call(loader);check();
  const names=['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss'];
  if(cancellation)names.push('runRegisteredNullCrossCompanyCommitCancellation');
  if(disconnect)names.push(recovery?'runRegisteredNullCrossCompanyDisconnectRecovery':'runRegisteredNullCrossCompanyDisconnectAttempt');
  const methods=Object.fromEntries(names.map(k=>{const d=Object.getOwnPropertyDescriptor(modules,k);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function');return [k,d.value];}));
  const runId=resource.runId.replaceAll('-','').slice(0,12);
  const proof=Object.freeze({authorizationReference:scope.authorizationReference,runId,resourceRunId:resource.runId,databaseName:resource.databaseName,
   databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,host:'127.0.0.1',port:resource.port,
   ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:source.sealSha256,
   preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(r=>[path.basename(r.path),r.sha256]))),
   transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin:lease.application.origin,databaseRole:'jg_task01_runtime',sourceSealSha256:source.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})});
  const plan=prior?.plan??snapshot(methods.buildRegisteredPgFixturePlan(runId,scope.paidAt,scope.openingDate));check();
  const execution=Object.freeze({proof,owner:original.owner,runtime:original.runtime,observer:original.observer,
   password:prior?.password??randomBytes(32).toString('hex'),httpTimeoutMs:5000});
  const transport=async(target,init)=>{check();const url=new URL(target);need(url.origin===new URL(proof.application.origin).origin&&url.pathname.startsWith('/')&&!url.username&&!url.password&&!url.hash);const response=await originalFetch(target,init);check();return response;};
  attempted=true;
  const prepared=prior?.fixture??await methods.seedRegisteredPgFixture(execution,plan,Object.freeze({checkLight:check,fetch:transport}));check();
  const frozen=snapshot(prepared);need(equal(frozen.plan,plan)&&typeof frozen.accessToken==='string');
  await permission.verifyFull();await original.verifyFull.call(session);check();
  const checkPrepared=()=>{check();need(equal(snapshot(prepared),frozen)&&names.every(k=>Object.getOwnPropertyDescriptor(modules,k)?.value===methods[k]));};
  let armed=false,barrierUsed=false,faultSettled=false,postCount=0,resultReads=0,rollbackEvidence;
  const assertHttpRequest=(route,method)=>{
   checkPrepared();const ids=plan.ids;
   if(recovery){
    if(method==='GET'){
     need(resultReads===postCount&&resultReads<2&&route===`/payment-executions/results/${ids.requestKey}`);
     resultReads++;return;
    }
    need(method==='POST'&&resultReads===1&&postCount===0&&route===`/payment-executions/${ids.payment}/registrations`);
    postCount++;return;
   }
   if(faulting){
    if(method==='GET'){
     if(cancellation&&route===`/payment-executions/results/${ids.requestKey}`){
      need(faultSettled&&postCount===1&&resultReads===0);resultReads++;return;
     }
     need(!barrierUsed&&route===`/payment-executions/${ids.payment}/registration-options`);return;
    }
    need(armed&&postCount===0&&method==='POST'&&route===`/payment-executions/${ids.payment}/registrations`);
    postCount++;return;
   }
   need(method==='POST'&&route===`/payment-executions/${ids.payment}/registrations`||method==='GET'&&
    [ `/payment-executions/${ids.payment}/registration-options`,`/payment-executions/results/${ids.requestKey}`].includes(route));
  };
  const continuity=Object.freeze({checkLight:checkPrepared,fetch:transport,assertHttpRequest});
  const caseId='registered.null-cross-company.'+(scope.scenario==='normal'?'commit':scope.scenario);
  let result;
  if(faulting){
   const handler=disconnect?methods.runRegisteredNullCrossCompanyDisconnectAttempt:methods.runRegisteredNullCrossCompanyCommitCancellation;
   result=await handler(execution,frozen,continuity,async submit=>{
    checkPrepared();need(!barrierUsed&&typeof submit==='function');barrierUsed=true;
    const outcome=await commitFault.call(session,permission.continuityToken,async()=>{
     checkPrepared();need(!armed&&postCount===0);armed=true;
     try{await submit();}finally{armed=false;}
    });
    checkPrepared();need(postCount===1);
    if(cancellation){
     const confirmed=snapshot(outcome);
     const xid=confirmed.transactionId;
     need(confirmed.mode==='cancel-commit'&&confirmed.state==='commit-cancelled'&&
      confirmed.executionAllowed===false&&confirmed.nativeAdmission===false&&
      typeof xid==='string'&&/^[1-9][0-9]{0,9}$/u.test(xid)&&Number(xid)<=0xffffffff);
     rollbackEvidence=Object.freeze({fault:confirmed.state,observedXid32:xid,
      originalRequestKeySha256:createHash('sha256').update(plan.ids.requestKey).digest('hex')});
    }
    faultSettled=true;return outcome;
   });
   if(disconnect){
    checkPrepared();need(result&&typeof result==='object'&&Reflect.ownKeys(result).length===0&&barrierUsed&&postCount===1);
    await permission.verifyFull();checkPrepared();
    lease.finishContinuity(permission.continuityToken);permission.check();
    disconnectAttempts.set(result,Object.freeze({handle:lease.handle,password:execution.password,plan,fixture:frozen,
     runId:resource.runId,topology:resource.topology,relay:resource.relay}));
    return result;
   }
  }else if(recovery){
   result=await methods.runRegisteredNullCrossCompanyDisconnectRecovery(scope.disconnectRollback,execution,continuity);
  }else{
   const handler=scope.scenario==='normal'?methods.runRegisteredNullCrossCompanyCommit:methods.runRegisteredNullCrossCompanyResponseLoss;
   result=await handler(execution,frozen,continuity);
  }
  checkPrepared();await permission.verifyFull();await original.verifyFull.call(session);checkPrepared();
  need(result&&result.caseId===caseId&&result.passed===true);
  if(recovery)need(postCount===1&&resultReads===2&&result.rollbackObserved===true);
  if(cancellation)need(barrierUsed&&faultSettled&&postCount===1&&resultReads===1&&result.rollbackObserved===true&&result.originalResultUnconfirmed===true);
  else need([result.executionId,result.rootId].every(value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)));
  lease.finishContinuity(permission.continuityToken);permission.check();
  return Object.freeze({caseId,passed:true,...(cancellation?{rollbackObserved:true,originalResultUnconfirmed:true,rollbackEvidence}:{executionId:result.executionId,rootId:result.rootId}),...(recovery?{rollbackObserved:true}:{}),financialAcceptance:false});
 }catch(error){
  const detail=disconnectStage?captureCurrent259DisconnectFailure(error,disconnectStage):undefined;
  let cleanup='UNKNOWN_DO_NOT_CONTINUE';
  try{await lease.failClosed();cleanup='FIXED_CLOSE_RETURNED_NOT_FULL_PROOF';}catch{/* retain safe unknown */}
  const failure=Object.assign(new Error('CURRENT259_PAYMENT_CASE_FAILED_CLOSED'),{code:'CURRENT259_PAYMENT_CASE_FAILED_CLOSED',fixtureOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:cleanup==='UNKNOWN_DO_NOT_CONTINUE'?cleanup:'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF'});
  throw detail?carryCurrent259DisconnectFailure(failure,detail):failure;
 }
}
function runCurrent259PaymentCase(application,handle,permit){return require('./task16-current259-application-factory.cjs').consumeCurrent259PaymentApplication(application,handle,permit);}
module.exports=Object.freeze({runCurrent259PaymentCase,executeCurrent259PaymentCase});
