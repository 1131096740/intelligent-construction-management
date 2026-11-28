'use strict';
// Source description only. A description never authorizes a session or a run.
const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
const {describeCurrent261GeneratedLifecycleOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
const {describeCurrent261GeneratedLifecycleDocumentAcl}=require('./task12-current259-document-acl.cjs');
const {PROFILE,officialDocumentProfile}=require('./task12-official-document-profiles.cjs');
function describeCurrent261LocalLifecycle(source,runtimeProfile=PROFILE){
 if(arguments.length<1||arguments.length>2||!officialDocumentProfile(runtimeProfile))throw new Error('CURRENT261_LOCAL_LIFECYCLE_SCOPE');
 source=qualifyCurrent261GeneratedLifecycleSource(source);
 const ordinary=describeCurrent261GeneratedLifecycleOrdinaryAcl(source),document=describeCurrent261GeneratedLifecycleDocumentAcl(source);
 if(ordinary.effectivePlanSha256!==document.effectivePlanSha256||ordinary.installation!=='ARCHIVE261_REGISTERED_SEVEN'||document.installation!==ordinary.installation)
  throw new Error('CURRENT261_LOCAL_LIFECYCLE_SCOPE');
 return Object.freeze({purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',sourceSha:source.candidateSha,
  installation:ordinary.installation,effectivePlanSha256:ordinary.effectivePlanSha256,
  ordinaryRequirementsSha256:ordinary.requirementsSha256,documentProfileSha256:document.profileSha256,
  relationship:'inside',contractTypeKey:'material_purchase',operating:false,storage:'LOCAL_ONLY',
  runtimeProfile,resourceMs:3600000,httpMs:15000,httpRequests:600,httpJsonResponseBytes:512*1024,httpDocxBytes:25*1024*1024,httpPdfBytes:100000000,httpUploadBytes:8*1024*1024,
  stages:Object.freeze(['technical261','roles9','registeredArchive','lifecycleOrdinaryAcl','lifecycleDocumentRoles','lifecycleDocumentAcl',
   'officialDocumentRuntime','lifecycleFiveTls','publicMaterialTemplate','publicDraftGenerateSubmit','withdrawModifyRejectResubmit',
   'fiveConcurrentApprovals','seal','twoOriginalUploads','auditRollbackOriginalKeyRecovery','archiveIdempotency','publicDownload','independentOwnerReadback','ownedCleanup']),
  executionAllowed:false,nativeAdmission:false,cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false});
}
function describeCurrent261FirstLogin(source,runtimeProfile=PROFILE){
 if(arguments.length<1||arguments.length>2)throw new Error('CURRENT261_FIRST_LOGIN_SCOPE');
 const full=describeCurrent261LocalLifecycle(source,runtimeProfile);
 return Object.freeze({...full,purpose:'CURRENT261_FIRST_LOGIN_AUTH_ONLY_DIAGNOSTIC',executionPurpose:'AUTH_ONLY_DIAGNOSTIC',httpRequests:1,
  stages:Object.freeze(['diagnostic261','roles9','registeredArchive','lifecycleOrdinaryAcl','lifecycleDocumentRoles','lifecycleDocumentAcl','officialDocumentRuntime','lifecycleFiveTls','authOwnerBegin','firstActor0Login','authOwnerObserve','authOwnerClose','ownedCleanup'])});
}
function describeCurrent261LocalLifecycleCase(source,runtimeProfile,caseKey){
 if(arguments.length!==3)throw new Error('CURRENT261_LOCAL_LIFECYCLE_SCOPE');
 const selected=require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCase(caseKey);
 const full=describeCurrent261LocalLifecycle(source,runtimeProfile);
 return Object.freeze({...full,purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',caseKey:selected.key,
  relationship:selected.relationship,contractTypeKey:selected.contractTypeKey,
  stages:Object.freeze(full.stages.map(stage=>stage==='publicMaterialTemplate'&&selected.contractTypeKey==='equipment_rental'?'publicEquipmentTemplate':stage))});
}
module.exports=Object.freeze({describeCurrent261LocalLifecycle,describeCurrent261FirstLogin,describeCurrent261LocalLifecycleCase});
