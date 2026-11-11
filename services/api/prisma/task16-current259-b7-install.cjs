'use strict';
const {assertCurrent259BusinessIssuer:businessIssuer}=require('./task16-current259-business-continuity.cjs');

const {createHash}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
// The ACL producer must load its original technical dependencies before owned resources.
const {claimCurrent259PaymentAcl}=require('./task16-current259-payment-acl-install.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {renderCurrent259CatalogRead,parseCurrent259CatalogRead,renderCurrent259B7Install}=require('./task16-current259-catalog.cjs');

const CODE='CURRENT259_B7_INSTALL';
const committed=new WeakMap();
const digest=value=>createHash('sha256').update(value).digest('hex');
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[0-9a-f]+$/u.test(value);
const xid=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=0xffffffffffffffffn;
const fault=stage=>Object.assign(new Error(`${CODE}_${stage}`),{code:`${CODE}_${stage}`});
const need=(ok,stage='INVALID')=>{if(!ok)throw fault(stage);};

function prepareCurrent259B7(input){
 const installSql=renderCurrent259B7Install(input);
 return Object.freeze({installSql,installSqlSha256:digest(installSql),executionAllowed:false,nativeAdmission:false});
}

function claimPlanAuthority(permit,handle,aclCompletion){
 let claim;
 try{
  // A later versioned launcher supplies this fixed import. Its issuer belongs
  // to the same process and the already consumed, exact single-run plan.
  const launcher=require('./task16-current259-payment-run-authorization.cjs');
  const slot=Object.getOwnPropertyDescriptor(launcher,'claimCurrent259B7WritePermit');
  need(slot&&Object.hasOwn(slot,'value')&&typeof slot.value==='function');
  claim=slot.value;
 }catch{throw fault('AUTHORITY_UNAVAILABLE');}
 try{
  const authority=claim(permit,handle,aclCompletion);
  need(authority&&!types.isProxy(authority)&&Object.isFrozen(authority));
  const fields=Object.getOwnPropertyDescriptors(authority);
  need(Reflect.ownKeys(fields).length===3&&['planSha256','check','consumeWrite'].every(name=>fields[name]&&Object.hasOwn(fields[name],'value')));
  const planSha256=fields.planSha256.value,check=fields.check.value,consumeWrite=fields.consumeWrite.value;
  need(hex(planSha256,64)&&typeof check==='function'&&typeof consumeWrite==='function'&&check()===true);
  return {planSha256,check,consumeWrite};
 }catch{throw fault('AUTHORITY_DENIED');}
}

function stableCatalog(row){
 const identity=Object.fromEntries(Object.entries(row.identity).filter(([key])=>key!=='backendPid'&&key!=='backendStart'));
 return {...row,identity};
}
const newBackend=(left,right)=>left.backendPid!==right.backendPid&&left.backendStart!==right.backendStart;

async function installCurrent259B7(aclCompletion,handle,permit){
 need(arguments.length===3&&handle&&typeof handle==='object'&&!types.isProxy(handle),'HANDLE');
 const authority=claimPlanAuthority(permit,handle,aclCompletion);
 const lease=claimCurrent259PaymentAcl(aclCompletion,handle);
 let writeAttempted=false;
 try{
  const view=claimCurrent259TechnicalResource(handle);
  const {source,completion,roleCompletion,request,catalogProof}=lease;
  const check=()=>{lease.check();view.check();need(authority.check()===true,'AUTHORITY_DENIED');};
  const checkContinuity=token=>{businessIssuer(token,handle);lease.checkContinuity(token);view.checkLifetime();need(authority.planSha256===binding.planSha256,'AUTHORITY_DENIED');};
  check();
  need(completion===aclCompletion&&completion.status==='CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION'&&xid(completion.installXid)&&
   equal(source,view.source)&&completion.sourceSha===source.candidateSha&&completion.runId===view.runId&&
   roleCompletion.sourceSha===source.candidateSha&&roleCompletion.runId===view.runId&&roleCompletion.containerId===view.resource.containerId&&
   request.phase==='before'&&request.identity.runId===view.runId&&request.identity.database===view.resource.databaseName&&
   request.source.candidateSha===source.candidateSha&&request.source.sealSha256===source.sourceSealSha256);
  const run=async(sql,phase)=>{
   const result=await view.resource.execOwnerSql(sql,phase);check();return result.stdout;
  };
  const beforeSql=renderCurrent259CatalogRead(request);
  check();
  const before=parseCurrent259CatalogRead(await run(beforeSql,'current259-b7-before'),request);
  need(equal(stableCatalog(before.raw),stableCatalog(catalogProof.raw))&&newBackend(before.raw.identity,catalogProof.raw.identity));
  const prepared=prepareCurrent259B7({source:request.source,identity:request.identity,nonce:request.nonce,before});
  const binding=Object.freeze({scope:'CURRENT259_DOCKER_B7_INSTALL',planSha256:authority.planSha256,
   sourceSha:source.candidateSha,sourceSealSha256:source.sourceSealSha256,runId:view.runId,containerId:view.resource.containerId,
   aclXid:completion.installXid,nonce:request.nonce,identity:Object.freeze({...request.identity}),
   beforeCatalogSha256:digest(JSON.stringify(before.raw)),beforeSqlSha256:digest(beforeSql),installSqlSha256:prepared.installSqlSha256});
  check();
  need(authority.consumeWrite(binding)===true,'AUTHORITY_DENIED');
  writeAttempted=true;
  const staged=parseCurrent259CatalogRead(await run(prepared.installSql,'current259-b7-install'),{...request,phase:'staged'},before);
  const writer=staged.raw.identity,installXid=staged.raw.writeXid;
  need(installXid!==completion.installXid&&newBackend(writer,before.raw.identity)&&newBackend(writer,catalogProof.raw.identity));
  const committedRequest={...request,phase:'committed',installXid};
  const committedSql=renderCurrent259CatalogRead(committedRequest);
  check();
  const committedProof=parseCurrent259CatalogRead(await run(committedSql,'current259-b7-committed'),committedRequest,staged);
  need([writer,before.raw.identity,catalogProof.raw.identity].every(row=>newBackend(row,committedProof.raw.identity)));
  check();
  const result=Object.freeze({status:'CURRENT259_B7_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:view.runId,
   installXid,readerOid:committedProof.raw.reader.oid,bodySha256:committedProof.raw.reader.bodySha256,
   planSha256:binding.planSha256,installSqlSha256:binding.installSqlSha256,executionAllowed:false,nativeAdmission:false});
  committed.set(result,{handle,source,roleCompletion,request,stagedProof:staged,committedProof,check,checkContinuity});
  return result;
 }catch{
  const error=fault(writeAttempted?'COMMIT_UNCONFIRMED':'NOT_ATTEMPTED');
  try{await closeCurrent259OwnedResource(handle);}catch{Object.defineProperty(error,'resourceCleanup',{value:'UNKNOWN',enumerable:true});}
  throw error;
 }
}

function claimCurrent259B7Installation(completion,handle){
 need(arguments.length===2&&completion&&!types.isProxy(completion)&&committed.has(completion),'HANDLE');
 const receipt=committed.get(completion);
 need(receipt.handle===handle,'HANDLE');
 committed.delete(completion);receipt.check();
 const {source,roleCompletion,request,stagedProof,committedProof,check,checkContinuity}=receipt;
 return Object.freeze({completion,source,roleCompletion,request,stagedProof,committedProof,check,checkContinuity});
}

module.exports=Object.freeze({prepareCurrent259B7,installCurrent259B7,claimCurrent259B7Installation});
