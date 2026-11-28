'use strict';
const {types}=require('node:util');
const outcomes=new WeakMap(),observations=new WeakMap();
const own=(v,k)=>v&&typeof v==='object'&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
const need=(ok,part)=>{if(!ok){const code='CURRENT261_FIRST_LOGIN_EXERCISE_'+part;throw Object.assign(Error(code),{code});}};
function unknown(first){
 if(first&&typeof first==='object'&&!types.isProxy(first))try{Object.defineProperty(first,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true,configurable:true});return first;}catch{/* Preserve immutable cause below. */}
 return Object.assign(Error('CURRENT261_FIRST_LOGIN_EXERCISE_CLEANUP_UNKNOWN',{cause:first}),{code:'CURRENT261_FIRST_LOGIN_EXERCISE_CLEANUP_UNKNOWN',ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
}
async function exerciseCurrent261FirstLogin(key,http){
 need(arguments.length===2,'HANDLE');
 require('./task12-current261-local-lifecycle-http.cjs').assertCurrent261FirstLoginHttp(http);
 const {handle,proof,modules,config,check}=require('./task12-current259-document-login.cjs').takeCurrent261FirstLoginExerciseBridge(key);
 const owner=require('./task12-current261-first-login-owner.cjs'),{fixture,passwords,signal}=config;
 need(modules.isTask12LocalLifecycleFixture(fixture)&&signal&&!signal.aborted,'HANDLE');
 const verify=()=>{check();http.check();need(!signal.aborted,'SIGNAL');};
 let window,first,result,receipt,observed,observationAttempted=false,hasFirst=false;
 try{
  verify();window=await owner.beginCurrent261FirstLoginOwnerWindow(handle,proof,fixture);verify();
  result=await modules.runTask12FirstLoginCase(Object.freeze({fixture,passwords:Object.freeze(fixture.approval.users.map(u=>passwords[u.id])),bridge:http,signal}));
  verify();observationAttempted=true;observed=await owner.observeCurrent261FirstLoginOwner(window,result);verify();
 }catch(error){first=error;hasFirst=true;}
 finally{
  if(window){
   // A failed HTTP request can have committed auth writes. Observe once, never resend.
   if(!observationAttempted)try{observationAttempted=true;observed=await owner.observeCurrent261FirstLoginOwner(window,Object.freeze({goal:'TASK12_FIRST_LOGIN_HTTP_FAILED'}));}
   catch(error){if(!hasFirst){first=error;hasFirst=true;}}
   try{receipt=await owner.closeCurrent261FirstLoginOwnerWindow(window);}
   catch(error){if(hasFirst)first=unknown(first);else{first=unknown(error);hasFirst=true;}}
  }
 }
 if(hasFirst){
  if(first&&typeof first==='object'&&!types.isProxy(first))observations.set(first,Object.freeze({...(observed??{authObserved:false}),ownerClosed:receipt?.status==='CURRENT261_FIRST_LOGIN_OWNER_CLOSED',full394Accepted:false}));
  throw first;
 }
 verify();need(result?.goal==='TASK12_FIRST_LOGIN_HTTP_RETURNED'&&result.httpStatus===201&&result.actorUserId===fixture.approval.users[0].id&&
  result.nativeAdmission===false&&result.cleanupAccepted===false&&result.full394Accepted===false&&receipt?.status==='CURRENT261_FIRST_LOGIN_OWNER_CLOSED'&&receipt.authObserved===true,'OWNER_CLOSE');
 const projection=Object.freeze({...result,sourceSha:proof.sourceSha,effectivePlanSha256:proof.effectivePlanSha256,ownerClosed:true,authObservation:observed,storage:'LOCAL_ONLY',executionAllowed:false});
 const outcome=Object.freeze({});outcomes.set(outcome,projection);return outcome;
}
// Observation only: the original later projector owns the single delete.
function describeCurrent261FirstLoginReturnedOutcome(outcome){
 const unknown=()=>Object.freeze({status:'UNKNOWN'});
 if(arguments.length!==1||!outcome||typeof outcome!=='object'||types.isProxy(outcome))return unknown();
 const value=outcomes.get(outcome);if(!value)return unknown();
 const observation=own(value,'authObservation');
 if(own(value,'httpStatus')!==201||own(value,'ownerClosed')!==true||own(observation,'authObserved')!==true||
  ['nativeAdmission','cleanupAccepted','full394Accepted'].some(key=>own(value,key)!==false))return unknown();
 return Object.freeze({status:'OBSERVED',httpStatus:own(value,'httpStatus'),ownerClosed:own(value,'ownerClosed'),authObserved:own(observation,'authObserved'),
  nativeAdmission:own(value,'nativeAdmission'),cleanupAccepted:own(value,'cleanupAccepted'),full394Accepted:own(value,'full394Accepted')});
}
function projectCurrent261FirstLoginOutcome(outcome){
 need(arguments.length===1&&outcome&&!types.isProxy(outcome)&&outcomes.has(outcome),'OUTCOME');
 const result=outcomes.get(outcome);outcomes.delete(outcome);return result;
}
function describeCurrent261FirstLoginOwnerObservation(error){
 for(let i=0;i<8&&error&&typeof error==='object'&&!types.isProxy(error);i++,error=own(error,'cause'))if(observations.has(error))return observations.get(error);
}
module.exports=Object.freeze({describeCurrent261FirstLoginReturnedOutcome,exerciseCurrent261FirstLogin,projectCurrent261FirstLoginOutcome,describeCurrent261FirstLoginOwnerObservation});
