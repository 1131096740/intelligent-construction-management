'use strict';
// Source description only. A description never authorizes a session or a run.
const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
const {describeCurrent261GeneratedLifecycleOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
const {describeCurrent261GeneratedLifecycleDocumentAcl}=require('./task12-current259-document-acl.cjs');
function describeCurrent261LocalLifecycle(source){
 if(arguments.length!==1)throw new Error('CURRENT261_LOCAL_LIFECYCLE_SCOPE');
 source=qualifyCurrent261GeneratedLifecycleSource(source);
 const ordinary=describeCurrent261GeneratedLifecycleOrdinaryAcl(source),document=describeCurrent261GeneratedLifecycleDocumentAcl(source);
 if(ordinary.effectivePlanSha256!==document.effectivePlanSha256||ordinary.installation!=='ARCHIVE261_REGISTERED_SEVEN'||document.installation!==ordinary.installation)
  throw new Error('CURRENT261_LOCAL_LIFECYCLE_SCOPE');
 return Object.freeze({purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',sourceSha:source.candidateSha,
  installation:ordinary.installation,effectivePlanSha256:ordinary.effectivePlanSha256,
  ordinaryRequirementsSha256:ordinary.requirementsSha256,documentProfileSha256:document.profileSha256,
  relationship:'inside',contractTypeKey:'material_purchase',operating:false,storage:'LOCAL_ONLY',
  runtimeProfile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',resourceMs:3600000,httpMs:15000,httpRequests:600,httpJsonResponseBytes:512*1024,httpDocxBytes:25*1024*1024,httpPdfBytes:100000000,httpUploadBytes:8*1024*1024,
  stages:Object.freeze(['technical261','roles9','registeredArchive','lifecycleOrdinaryAcl','lifecycleDocumentRoles','lifecycleDocumentAcl',
   'officialDocumentRuntime','lifecycleFiveTls','publicMaterialTemplate','publicDraftGenerateSubmit','withdrawModifyRejectResubmit',
   'fiveConcurrentApprovals','seal','twoOriginalUploads','auditRollbackOriginalKeyRecovery','archiveIdempotency','publicDownload','independentOwnerReadback','ownedCleanup']),
  executionAllowed:false,nativeAdmission:false,cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false});
}
module.exports=Object.freeze({describeCurrent261LocalLifecycle});
