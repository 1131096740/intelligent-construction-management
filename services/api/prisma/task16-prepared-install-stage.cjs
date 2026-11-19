"use strict";
// Native handoff only. Tests enter through public run with explicit resources.
const path=require("node:path");
const {readQualifiedTask16File:read}=require("./task16-runtime-inputs.cjs");
const {installTask16RegisteredSql}=require("./task16-registered-sql-installer.cjs");
const KEYS=["runId","sourceSha","containerId","networkId","daemonId","endpoint","imageId","databaseName","port"];
const BASELINE="services/api/prisma/task16-baseline-access.json";
const STAGE="services/api/prisma/task16-prepared-install-stage.cjs";
const fault=code=>Object.assign(new Error(code),{code,installationOutcome:"NOT_ATTEMPTED"});
const need=(value,code)=>{if(!value)throw fault(code);};
async function installTask16PreparedStage(input){
 const resource=input.resource,source=structuredClone(input.source);const baseline=structuredClone(input.baselineAccess);
 const witness=structuredClone(input.resourceWitness);
 need(source?.runtimeAdmission?.status==="INPUTS_AND_CODE_TREES_MATCHED"&&typeof source.candidateRoot==="string"&&path.isAbsolute(source.candidateRoot),"TASK16_INSTALL_HANDOFF_SOURCE");
 need(baseline?.status==="BASELINE_ROLE_ACL_COMMIT_OBSERVED"&&baseline.sourceSha===source.candidateSha&&baseline.runtimeRole==="jg_task01_runtime"&&baseline.observerRole==="jg_task01_observer"&&[baseline.ownerOid,baseline.runtimeOid,baseline.observerOid].every(oid=>typeof oid==="string"&&/^[1-9][0-9]*$/u.test(oid))&&new Set([baseline.ownerOid,baseline.runtimeOid,baseline.observerOid]).size===3,"TASK16_INSTALL_HANDOFF_BASELINE");
 need(witness&&witness.runId===input.runId&&witness.sourceSha===source.candidateSha&&KEYS.every(key=>witness[key]!==undefined&&baseline.resourceWitness?.[key]===witness[key]),"TASK16_INSTALL_HANDOFF_RESOURCE");
 need(typeof resource?.getReceipt==="function"&&typeof resource.execOwnerSql==="function","TASK16_INSTALL_RESOURCE_ADAPTER");
 const current=resource.getReceipt();need(KEYS.every(key=>current[key]===witness[key]),"TASK16_INSTALL_HANDOFF_RESOURCE");
 const captures=[];
 for(const relative of [BASELINE,STAGE]){
  const rows=source.executionFiles?.filter(row=>row.path===relative);need(rows?.length===1,"TASK16_INSTALL_HANDOFF_SOURCE");
  const captured=read(path.join(source.candidateRoot,relative),{maxBytes:64*1024*1024,code:"TASK16_INSTALL_HANDOFF_SOURCE"});
  captures.push({path:path.join(source.candidateRoot,relative),identity:captured.identity,sha256:captured.sha256});
  need(captured.sha256===rows[0].sha256&&(relative!==BASELINE||captured.sha256===baseline.manifestSha256),"TASK16_INSTALL_HANDOFF_SOURCE");
 }
 need(baseline.databaseOid===input.ownerTransport?.databaseOid&&baseline.systemIdentifier===input.ownerTransport?.systemIdentifier,"TASK16_INSTALL_HANDOFF_DATABASE");
 const result=await installTask16RegisteredSql({resource,packetFile:input.options.packetFile,expectedPacketSha256:input.options.expectedPacketSha256,expectedResource:witness,ownerRole:"jg_task01_owner",runtimeRole:baseline.runtimeRole,authorizationReference:source.inputs.authorizationReference,expectedBaseline:{...baseline,candidateRoot:source.candidateRoot}});
 const completed=result.installedObjectWitness&&["relations","indexes","columns","constraints","triggers"].every(key=>Array.isArray(result.installedObjectWitness[key]))&&result.baselineContinuityVerified===true&&result.schema205WitnessSha256===baseline.schema205WitnessSha256&&result.runtimeOid===baseline.runtimeOid&&result.observerOid===baseline.observerOid&&result.ownerOid===baseline.ownerOid;
 if(!completed)throw Object.assign(fault("TASK16_INSTALL_HANDOFF_CONTINUITY"),{installationOutcome:"UNKNOWN_DO_NOT_RETRY"});
 for(const row of captures){
  let actual;try{actual=read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:"TASK16_INSTALL_HANDOFF_SOURCE"});}catch{throw Object.assign(fault("TASK16_INSTALL_HANDOFF_SOURCE"),{installationOutcome:"UNKNOWN_DO_NOT_RETRY"});}
  if(actual.sha256!==row.sha256)throw Object.assign(fault("TASK16_INSTALL_HANDOFF_SOURCE"),{installationOutcome:"UNKNOWN_DO_NOT_RETRY"});
 }
 return result;
}
module.exports={installTask16PreparedStage};
