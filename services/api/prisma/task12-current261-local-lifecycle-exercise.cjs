'use strict';
const {types}=require('node:util');
const outcomes=new WeakMap();
const need=(ok,phase)=>{if(!ok){const code='CURRENT261_LOCAL_LIFECYCLE_EXERCISE_'+phase;throw Object.assign(Error(code),{code});}};
async function exerciseCurrent261LocalLifecycle(key,http){
 need(arguments.length===2,'HANDLE');
 require('./task12-current261-local-lifecycle-http.cjs').assertCurrent261LocalLifecycleHttp(http);
 const {handle,proof,modules,config,check}=require('./task12-current259-document-login.cjs').takeCurrent261LocalLifecycleExerciseBridge(key);
 const owner=require('./task12-current261-local-lifecycle-owner.cjs');
 const {fixture,passwords,signal}=config;
 need(modules.isTask12LocalLifecycleFixture(fixture)&&signal&&!signal.aborted,'HANDLE');
 const runtime=modules.currentOfficialDocumentScope();
 need(runtime?.kind==='OFFICIAL_TOOL_RUNTIME'&&require('./task12-official-document-profiles.cjs').officialDocumentProfile(runtime.profile)&&runtime.source?.head===proof.sourceSha&&typeof runtime.readPdfDrawnText==='function','RUNTIME');
 const verify=()=>{check();http.check();need(!signal.aborted&&modules.currentOfficialDocumentScope()===runtime,'RUNTIME');};
 let window,first,result,receipt,hasFirst=false;
 try{
  verify();const {sourceDocx,originals}=config;
  window=await owner.beginCurrent261LocalLifecycleOwnerWindow(handle,proof,fixture);verify();
  const input=Object.freeze({fixture,passwords:Object.freeze(fixture.approval.users.map(u=>passwords[u.id])),sourceDocx,originals,bridge:http,signal,
   readPdfDrawnText:async(bytes,abort)=>{verify();const value=await runtime.readPdfDrawnText(bytes,abort);verify();return value;}});
  const signed=await modules.runTask12LocalLifecycleCase(input);verify();
  await owner.observeCurrent261LocalLifecycleOwner(window,signed);verify();
  await owner.installCurrent261LocalLifecycleAuditFault(window);verify();
  const rollback=await modules.expectTask12LocalLifecycleAuditRollback(signed);verify();
  await owner.observeCurrent261LocalLifecycleOwner(window,rollback);verify();
  await owner.removeCurrent261LocalLifecycleAuditFault(window);verify();
  result=await modules.finishTask12LocalLifecycleCase(rollback);verify();
  await owner.observeCurrent261LocalLifecycleOwner(window,result);verify();
 }catch(error){first=error;hasFirst=true;}
 finally{
  if(window){try{receipt=await owner.closeCurrent261LocalLifecycleOwnerWindow(window);}
   catch(error){if(hasFirst){
    try{need(first&&typeof first==='object'&&!types.isProxy(first),'CLEANUP_UNKNOWN');Object.defineProperty(first,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true,configurable:true});}
    catch{first=Object.assign(new Error('CURRENT261_LOCAL_LIFECYCLE_EXERCISE_CLEANUP_UNKNOWN',{cause:first}),{ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});}
   }else{first=error;hasFirst=true;}}}
 }
 if(hasFirst)throw first;verify();need(result&&receipt?.matched===true,'OWNER_CLOSE');
 const final=modules.claimTask12LocalLifecycleCheckpoint(result);
 const projection=Object.freeze({status:'CURRENT261_LOCAL_LIFECYCLE_LOCAL_ONLY_MATCHED',storage:'LOCAL_ONLY',
  projectId:final.projectId,versionId:final.versionId,sourceSha:proof.sourceSha,effectivePlanSha256:proof.effectivePlanSha256,
  pdfInspection:final.pdfInspection,
  ownerMatched:true,cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false,nativeAdmission:false,executionAllowed:false});
 const outcome=Object.freeze({});outcomes.set(outcome,projection);return outcome;
}
function projectCurrent261LocalLifecycleOutcome(outcome){
 need(arguments.length===1&&outcome&&!types.isProxy(outcome)&&outcomes.has(outcome),'OUTCOME');
 const result=outcomes.get(outcome);outcomes.delete(outcome);return result;
}
module.exports=Object.freeze({exerciseCurrent261LocalLifecycle,projectCurrent261LocalLifecycleOutcome});
