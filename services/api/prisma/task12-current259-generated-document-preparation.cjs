'use strict';
const path=require('node:path');
const {withCurrent259ApplicationEnvironment}=require('./task16-current259-application-environment.cjs');
const {claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
const {readQualifiedTask16File}=require('./task16-runtime-inputs.cjs');

const TEMPLATE_SHA='44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd';
const TEMPLATE_BYTES=29389;
const TOPOLOGY='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const TEMPLATE=path.resolve(__dirname,'../assets/templates/material-purchase-real-v1.docx');
const attempted=new WeakSet();
const need=(ok,stage)=>{
 if(!ok){
  const code='CURRENT259_GENERATED_DOCUMENT_PREPARATION_'+stage;
  throw Object.assign(new Error(code),{code});
 }
};

async function prepareCurrent259GeneratedDocument(handle){
 need(arguments.length===1&&handle&&typeof handle==='object','ARGUMENTS');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,loader=view.loader;
 const load=Object.getOwnPropertyDescriptor(loader,'loadGeneratedContractDocumentModules')?.value;
 need(view.scope==='OWNED_RESOURCE_ONLY'&&resource.topology===TOPOLOGY&&typeof load==='function','RESOURCE');
 const check=()=>{
  view.check();
  need(claimCurrent259TechnicalResource(handle)===view&&view.resource===resource&&view.loader===loader&&
   Object.getOwnPropertyDescriptor(loader,'loadGeneratedContractDocumentModules')?.value===load,'CONTINUITY');
 };
 check();
 need(!attempted.has(handle),'REPLAY');
 attempted.add(handle);
 const material=await withCurrent259ApplicationEnvironment(handle,scope=>{
  check();scope.check();
  const modules=load.call(loader);
  check();scope.check();
  const observed=readQualifiedTask16File(TEMPLATE,{maxBytes:TEMPLATE_BYTES,collect:true,code:'CURRENT259_GENERATED_DOCUMENT_PREPARATION_TEMPLATE'});
  need(observed.sha256===TEMPLATE_SHA&&observed.bytes.length===TEMPLATE_BYTES,'TEMPLATE');
  const template=modules.verifyTask12MaterialTemplate(observed.bytes);
  check();scope.check();
  need(template.sha256===observed.sha256&&template.bytes===observed.bytes.length,'TEMPLATE');
  return {templateSha256:template.sha256,templateBytes:template.bytes};
 });
 check();
 return Object.freeze({status:'CURRENT259_GENERATED_DOCUMENT_ASSEMBLY_OBSERVED',...material,
  sourceSha:view.source.candidateSha,runId:view.runId,nativeAdmission:false,executionAllowed:false});
}

module.exports=Object.freeze({prepareCurrent259GeneratedDocument});
