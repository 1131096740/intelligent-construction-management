'use strict';
const {isDeepStrictEqual:equal}=require('node:util');
const {validateOfficialDocumentFidelity,validateOfficialOfficeFidelity,validateOfficialMergedFidelity}=require('./task12-official-document-fidelity.cjs');
const {officialDocumentProfile}=require('./task12-official-document-profiles.cjs');
const fault=part=>Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_'+part),{code:'TASK12_OFFICIAL_DOCUMENT_'+part});
const need=value=>{if(!value)throw fault('REGISTRY');};
const keys=(value,names)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===names.slice().sort().join(',');
/** Registered file data is not authority. The source-bound private verifier
 * alone can turn checked data and actual unchanged material into a capability. */
function validateOfficialQualificationRegistration(input){
 const registry=input?.registry,descriptor=officialDocumentProfile(registry?.profile);
 need(keys(registry,['version','profile','qualification'])&&registry.version===1&&descriptor);
 if(registry.qualification===null)throw fault('QUALIFICATION_PENDING');
 need(keys(registry.qualification,['machineReceipt','physicalReview']));
 const {machine,physical,currentSource,currentControls,runtimeInput,reports}=input;
 need(runtimeInput?.profile===descriptor.profile&&input.qualifiedPlan?.profile===descriptor.profile);
 need(keys(machine,['version','status','profile','runtimeAuthority','plan','source','hostBoundary','toolControls','candidateLockSha256','buildSha256','materialSha256','boundaries','actions','physicalReview','elapsedMs'])&&
  machine.version===1&&machine.status==='MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING'&&machine.profile===descriptor.profile&&machine.runtimeAuthority===false);
 need(keys(machine.hostBoundary,['platform','arch','release','version'])&&machine.hostBoundary.platform==='darwin'&&machine.hostBoundary.arch==='arm64'&&equal(machine.hostBoundary,input.currentHost));
 const q=registry.qualification;
 for(const [name,expected] of [['machineReceipt',input.machineSha256],['physicalReview',input.physicalSha256]])need(keys(q[name],['path','sha256'])&&q[name].sha256===expected&&/^[a-f0-9]{64}$/u.test(expected));
 need(keys(machine.plan,['path','sha256'])&&machine.plan.sha256===input.qualifiedPlanSha256&&runtimeInput.qualificationPlanSha256===input.qualifiedPlanSha256);
 need(equal(machine.source,input.qualifiedPlan.source)&&equal(runtimeInput.source,currentSource)&&equal(currentControls.source,currentSource));
 need(keys(machine.toolControls,['sha256','files'])&&machine.toolControls.sha256===currentControls.sha256&&machine.toolControls.files===currentControls.files);
 need(machine.candidateLockSha256===descriptor.lockSha256&&machine.buildSha256===input.buildSha256&&machine.materialSha256===input.materialSha256&&runtimeInput.qualificationRegistrySha256===input.registrySha256);
 need(keys(machine.boundaries,['foreignSnapshotRejected','malformedDocxRejected','externalRelationshipRejected','activeFieldRejected','noNegativeConverterScratchCreated'])&&Object.values(machine.boundaries).every(value=>value===true));
 need(keys(machine.actions,['java','office','normalized'])&&keys(machine.physicalReview,['status','exactPageCountsReviewed','signatureAndPaginationReviewed'])&&machine.physicalReview.status==='PENDING'&&machine.physicalReview.exactPageCountsReviewed===false&&machine.physicalReview.signatureAndPaginationReviewed===false&&Number.isFinite(machine.elapsedMs)&&machine.elapsedMs>=0&&machine.elapsedMs<=315000);
 const verdicts={java:validateOfficialDocumentFidelity(reports.java,machine.actions.java.pdfSha256),office:validateOfficialOfficeFidelity(reports.office,machine.actions.office.pdfSha256),normalized:validateOfficialMergedFidelity(reports.normalized,reports.java,reports.office,machine.actions.normalized.pdfSha256)};
 for(const name of ['java','office','normalized']){
  const action=machine.actions[name];need(keys(action,['pdfPath','pdfSha256','physicalPath','physicalSha256','pageCount','verdict'])&&equal(action.verdict,verdicts[name])&&action.pageCount===reports[name].pageCount);
 }
 need(keys(physical,['version','profile','status','machineReceiptSha256','source','toolControlsSha256','pdfs','exactPageCountsReviewed','signatureAndPaginationReviewed','reviewer','reviewedAt'])&&physical.version===1&&physical.profile===descriptor.profile&&physical.status==='INDEPENDENT_PHYSICAL_REVIEW_PASSED'&&physical.machineReceiptSha256===input.machineSha256&&equal(physical.source,machine.source)&&physical.toolControlsSha256===currentControls.sha256&&physical.exactPageCountsReviewed===true&&physical.signatureAndPaginationReviewed===true);
 need(typeof physical.reviewer==='string'&&physical.reviewer.length>0&&physical.reviewer.length<=100&&typeof physical.reviewedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(physical.reviewedAt)&&Number.isFinite(Date.parse(physical.reviewedAt))&&keys(physical.pdfs,['java','office','normalized']));
 for(const name of ['java','office','normalized'])need(keys(physical.pdfs[name],['sha256','pageCount'])&&physical.pdfs[name].sha256===machine.actions[name].pdfSha256&&physical.pdfs[name].pageCount===machine.actions[name].pageCount);
 return Object.freeze({status:'REGISTERED_DATA_MATCHED_NOT_AUTHORITY',runtimeAuthority:false});
}
module.exports=Object.freeze({validateOfficialQualificationRegistration});
