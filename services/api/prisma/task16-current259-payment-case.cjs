'use strict';
// Only the original factory's private lease and the fresh-main business issuer
// can reach the fixed seed/cases. Importing does not construct/connect anything.
const {types,isDeepStrictEqual:equal}=require('node:util');
const {createHash,randomBytes}=require('node:crypto');
const path=require('node:path');
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
const {isCurrentPaymentRuntimeMode}=require('./task16-current261-competition-profile.cjs');
const {requestCurrent261SeedJson}=require('./task16-current261-seed-json.cjs');
const authorization=require('./task16-current259-payment-run-authorization.cjs');
const {describePaymentDiagnostic,filterPaymentDiagnostic}=require('./task16-current259-payment-diagnostics.cjs');
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
 let attempted=false,permission,disconnectStage,attributionGapStage,httpPhase,httpRoute,observedHttpStatus,httpDiagnostic,caseStage='PERMIT_CLAIM';
 try{
  permission=authorization.claimCurrent259PaymentBusinessPermit(permit,lease.application,lease.handle);
  caseStage='CONTINUITY_ACTIVATION';
  permission.check();lease.activateContinuity(permission.continuityToken);lease.check();
  caseStage='CASE_SETUP';
  const scope=permission.scope,cancellation=scope.scenario==='cancel-commit',disconnect=scope.scenario==='disconnect-commit-recovery';
  const attributionGap=scope.scenario==='attribution-gap';
  const gapScope={expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false};
  if(attributionGap){
   attributionGapStage='CASE_SETUP';
   need(scope.caseId==='registered.project-attribution-gap'&&scope.handler==='runRegisteredProjectAttributionGap'&&
    equal(scope.attributionGap,gapScope)&&typeof permission.recordAttributionGapFailure==='function');
  }
  const recovery=disconnect&&scope.disconnectPhase==='recovery';
  if(disconnect)disconnectStage=recovery?'RECOVERY_PAYMENT':'ORIGINAL_PAYMENT_ATTEMPT';
  const faulting=cancellation||disconnect&&!recovery;
  need(attributionGap||cancellation||disconnect&&['attempt','recovery'].includes(scope.disconnectPhase)||['normal','response-loss'].includes(scope.scenario));
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
  const material=loadCurrent259CatalogMaterial(source,permission.paymentProfile);
  need(equal(permission.effectiveAccessBinding,material.effectiveAccessBinding)&&
   equal(lease.effectiveAccessBinding,material.effectiveAccessBinding)&&equal(session.effectiveAccessBinding,material.effectiveAccessBinding));
  if(material.effectiveAccessBinding)need(session.paymentProfile===permission.paymentProfile);
  const check=()=>{
   permission.check();lease.check();
   need(session===lease.session&&loader===lease.loader&&source===lease.source&&Object.getOwnPropertyDescriptor(loader,'loadPaymentModules')?.value===load&&
    Object.keys(original).every(k=>session[k]===original[k])&&(!faulting||Object.getOwnPropertyDescriptor(session,faultName)?.value===commitFault)&&equal(lease.resourceIdentity(),resource)&&equal(session.identity[0],identity)&&
    Object.getOwnPropertyDescriptor(globalThis,'fetch')?.value===originalFetch&&equal(permission.effectiveAccessBinding,material.effectiveAccessBinding)&&equal(lease.effectiveAccessBinding,material.effectiveAccessBinding)&&equal(session.effectiveAccessBinding,material.effectiveAccessBinding));
  };
  caseStage='PRE_SEED_AUTHORITY';
  check();await permission.verifyFull();
  caseStage='PRE_SEED_LIVE';
  await original.verifyFull.call(session);check();
  caseStage='CASE_SETUP';
  const modules=load.call(loader);check();
  const names=attributionGap?['buildRegisteredPgFixturePlan','seedRegisteredPgAttributionGapFixture','runRegisteredProjectAttributionGap']:
   ['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss'];
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
  const checkHttpTarget=target=>{
   httpRoute=undefined;observedHttpStatus=undefined;httpDiagnostic=undefined;httpPhase='BEFORE_CHECK';check();
   httpPhase='TARGET';
   const url=new URL(target);httpRoute=url.pathname;
   need(url.origin===new URL(proof.application.origin).origin&&url.pathname.startsWith('/')&&!url.username&&!url.password&&!url.hash);
  };
  const transport=async(target,init)=>{
   try{
    checkHttpTarget(target);
    httpPhase='FETCH';
    const response=await originalFetch(target,init);
    observedHttpStatus=response.status;
    httpPhase='AFTER_CHECK';check();
    httpPhase='RESPONSE_RETURNED';
    return response;
   }catch(error){httpDiagnostic??=describePaymentDiagnostic(error);throw error;}
  };
  const requestJson=async(target,init,timeoutMs)=>{
   try{
    checkHttpTarget(target);
    need(timeoutMs===5000&&timeoutMs===execution.httpTimeoutMs&&!Object.hasOwn(init,'signal'));
    httpPhase='FETCH';
    const result=await requestCurrent261SeedJson(target,init,timeoutMs,status=>{httpPhase='BODY';observedHttpStatus=status;});
    httpPhase='AFTER_CHECK';check();
    httpPhase='RESPONSE_RETURNED';
    return result;
   }catch(error){httpDiagnostic??=describePaymentDiagnostic(error);throw error;}
  };
  attempted=true;
  const seed=attributionGap?methods.seedRegisteredPgAttributionGapFixture:methods.seedRegisteredPgFixture;
  caseStage='SEED_FIXTURE';
  const prepared=prior?.fixture??await seed(execution,plan,Object.freeze({checkLight:check,fetch:transport,
   ...(permission.seedProfile?{seedProfile:permission.seedProfile}:{}),
   ...(permission.seedProfile!==undefined&&isCurrentPaymentRuntimeMode(permission.seedProfile,false)?{requestJson}:{}),
   ...(permission.recordCaseFailure?{recordSeedFailure(stage,code,httpStatus,diagnostic){
    const currentHttp=httpPhase==='BEFORE_CHECK'||httpPhase==='TARGET'||
     stage==='SEED_LOGIN'&&httpRoute==='/auth/login'||stage==='SEED_OPENING'&&httpRoute==='/fund-accounts/openings';
    const detail=httpDiagnostic??filterPaymentDiagnostic(diagnostic),hasDetail=detail&&Object.keys(detail).length>0;
    // A returned transport observation can belong to the preceding opening
    // when the next checked() fails before requestJson starts. Only an active
    // boundary may supply its observation; otherwise trust no prior request.
    if(httpPhase&&httpPhase!=='RESPONSE_RETURNED'&&currentHttp){
     const status=observedHttpStatus??httpStatus;
     if(hasDetail)permission.recordCaseFailure(stage,code,status,httpPhase,detail);
     else permission.recordCaseFailure(stage,code,status,httpPhase);
    }else if(hasDetail)permission.recordCaseFailure(stage,code,httpStatus,undefined,detail);
    else permission.recordCaseFailure(...arguments);
   }}:{})}));check();
  const frozen=snapshot(prepared);need(equal(frozen.plan,plan)&&typeof frozen.accessToken==='string');
  caseStage='POST_SEED_AUTHORITY';
  await permission.verifyFull();
  caseStage='POST_SEED_LIVE';
  await original.verifyFull.call(session);check();
  httpPhase=undefined;httpRoute=undefined;
  caseStage='SELECTED_CASE';
  const checkPrepared=()=>{check();need(equal(snapshot(prepared),frozen)&&names.every(k=>Object.getOwnPropertyDescriptor(modules,k)?.value===methods[k]));};
  let armed=false,barrierUsed=false,faultSettled=false,postCount=0,resultReads=0,rollbackEvidence;
  const gapRoutes=attributionGap?[
   ['GET',`/fund-accounts/company:${plan.ids.companyB}`],
   ['GET',`/payment-executions/${plan.ids.payment}/registration-options`],
   ['POST',`/payment-executions/${plan.ids.payment}/registrations`],
   ['GET',`/payment-executions/results/${plan.ids.requestKey}`]
  ]:undefined;
  let gapRouteIndex=0,gapBodiesChecked=0;
  const assertHttpBody=(route,method,body)=>{
   checkPrepared();
   need(equal(gapRoutes[gapBodiesChecked],[method,route])&&gapRouteIndex===gapBodiesChecked+1);
   if(method==='POST'){
    const command=snapshot(body);
    need(typeof command.expectedPaymentUpdatedAt==='string'&&Number.isFinite(Date.parse(command.expectedPaymentUpdatedAt)));
    need(equal(command,{
     idempotencyKey:plan.ids.requestKey,expectedPaymentUpdatedAt:command.expectedPaymentUpdatedAt,amountCents:gapScope.paymentAmountCents,
     paidAt:plan.paidAt,scopeKey:`company:${plan.ids.companyB}`,expectedRegistrationId:frozen.companyBRegistrationId,
     openingTreatment:'not_included',openingReason:'本次付款未计入核对期初',openingEvidence:'隔离PG合成项目归属差额',
     sourceAllocations:[{sourceBatchId:frozen.companyBSourceId,amountCents:gapScope.projectAmountCents},
      {sourceBatchId:frozen.attributionGap.otherSourceId,amountCents:gapScope.gapAmountCents}],
     confirmationPassword:execution.password
    }));
   }else need(body===undefined);
   gapBodiesChecked++;
  };
  const assertHttpRequest=(route,method)=>{
   checkPrepared();const ids=plan.ids;
   if(attributionGap){
    need(gapRouteIndex===gapBodiesChecked&&equal(gapRoutes[gapRouteIndex],[method,route]));
    gapRouteIndex++;return;
   }
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
  const continuity=Object.freeze({checkLight:checkPrepared,fetch:transport,assertHttpRequest,
   ...(permission.paymentProfile!==undefined&&isCurrentPaymentRuntimeMode(permission.paymentProfile,false)?{requestJson}:{}),
   ...(attributionGap?{assertHttpBody,markAttributionGapStage(stage){attributionGapStage=stage;}}:{})});
  const caseId=attributionGap?'registered.project-attribution-gap':'registered.null-cross-company.'+(scope.scenario==='normal'?'commit':scope.scenario);
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
  }else if(attributionGap){
   result=await methods.runRegisteredProjectAttributionGap(execution,frozen,continuity);
   attributionGapStage='CASE_FINAL';
  }else{
   const handler=scope.scenario==='normal'?methods.runRegisteredNullCrossCompanyCommit:methods.runRegisteredNullCrossCompanyResponseLoss;
   result=await handler(execution,frozen,continuity);
  }
  caseStage='FINAL';
  checkPrepared();await permission.verifyFull();await original.verifyFull.call(session);checkPrepared();
  need(result&&result.caseId===caseId&&result.passed===true);
  if(recovery)need(postCount===1&&resultReads===2&&result.rollbackObserved===true);
  let attributionGapEvidence;
  if(attributionGap){
   need(gapRouteIndex===gapRoutes.length&&gapBodiesChecked===gapRoutes.length&&
    result.registrationStatus===gapScope.expectedStatus&&result.originalResultUnconfirmed===true&&result.projectAmountCents===gapScope.projectAmountCents&&
    result.gapAmountCents===gapScope.gapAmountCents&&!Object.hasOwn(result,'executionId')&&!Object.hasOwn(result,'rootId'));
   attributionGapEvidence=Object.freeze({registrationStatus:result.registrationStatus,projectAmountCents:result.projectAmountCents,gapAmountCents:result.gapAmountCents,
    originalRequestKeySha256:createHash('sha256').update(plan.ids.requestKey).digest('hex'),originalResultUnconfirmed:true});
  }else if(cancellation)need(barrierUsed&&faultSettled&&postCount===1&&resultReads===1&&result.rollbackObserved===true&&result.originalResultUnconfirmed===true);
  else need([result.executionId,result.rootId].every(value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)));
  lease.finishContinuity(permission.continuityToken);permission.check();
  return Object.freeze({caseId,passed:true,...(cancellation?{rollbackObserved:true,originalResultUnconfirmed:true,rollbackEvidence}:attributionGap?{attributionGapEvidence}:{executionId:result.executionId,rootId:result.rootId}),...(recovery?{rollbackObserved:true}:{}),financialAcceptance:false});
 }catch(error){
  let code=error&&typeof error==='object'&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;
  if(typeof code!=='string'&&error&&typeof error==='object'&&!types.isProxy(error)){
   try{
    const name=Object.getOwnPropertyDescriptor(DOMException.prototype,'name').get.call(error);
    code=name==='TimeoutError'?'TIMEOUT':name==='AbortError'?'HTTP_ABORTED':undefined;
   }catch{/* A diagnostic projection never replaces the original failure. */}
  }
  const diagnostic=describePaymentDiagnostic(error);
  if(caseStage==='SELECTED_CASE'&&httpPhase){
   if(diagnostic)permission?.recordCaseFailure?.(caseStage,code,undefined,httpPhase,diagnostic);
   else permission?.recordCaseFailure?.(caseStage,code,undefined,httpPhase);
  }else if(diagnostic)permission?.recordCaseFailure?.(caseStage,code,undefined,undefined,diagnostic);
  else permission?.recordCaseFailure?.(caseStage,code);
  if(attributionGapStage)permission?.recordAttributionGapFailure?.(attributionGapStage);
  const detail=disconnectStage?captureCurrent259DisconnectFailure(error,disconnectStage):undefined;
  let cleanup='UNKNOWN_DO_NOT_CONTINUE';
  try{await lease.failClosed();cleanup='FIXED_CLOSE_RETURNED_NOT_FULL_PROOF';}catch{/* retain safe unknown */}
  const failure=Object.assign(new Error('CURRENT259_PAYMENT_CASE_FAILED_CLOSED'),{code:'CURRENT259_PAYMENT_CASE_FAILED_CLOSED',fixtureOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:cleanup==='UNKNOWN_DO_NOT_CONTINUE'?cleanup:'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF'});
  throw detail?carryCurrent259DisconnectFailure(failure,detail):failure;
 }
}
function runCurrent259PaymentCase(application,handle,permit){return require('./task16-current259-application-factory.cjs').consumeCurrent259PaymentApplication(application,handle,permit);}
module.exports=Object.freeze({runCurrent259PaymentCase,executeCurrent259PaymentCase});
