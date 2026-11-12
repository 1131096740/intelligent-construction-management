#!/usr/bin/env node
'use strict';
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&
  Object.keys(require.cache).every(key=>key===__filename);
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {types}=require('node:util');
const {projectGeneratedDraftHttpFailure,projectGeneratedDraftAdmissionFailure}=require('./task12-current259-generated-draft-diagnostic.cjs');

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=phase=>Object.assign(new Error('CURRENT259_GENERATED_DRAFT_ONCE_'+phase),{code:'CURRENT259_GENERATED_DRAFT_ONCE_'+phase});
const need=(ok,phase)=>{if(!ok)throw error(phase);};
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function directorySync(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function writeExclusive(file,bytes,onOpen){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{onOpen?.();fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  directorySync(path.dirname(file));
}
function parseArgs(args){
  need((args.length===4||args.length===5&&args[4]==='--once')&&args[0]==='--plan'&&
    args[2]==='--expected-plan-sha256'&&/^[a-f0-9]{64}$/u.test(args[3]),'ARGS');
  return {file:args[1],digest:args[3],once:args.length===5};
}
function checkHostEnv(){
  need(!Object.keys(process.env).some(key=>/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|COS_.*)$/u.test(key)),'HOST_ENV');
}
const businessDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());

const reasons=new Set([
  'CURRENT259_GENERATED_DRAFT_PLAN_DIRECTORY','CURRENT259_GENERATED_DRAFT_PLAN_DIGEST','CURRENT259_GENERATED_DRAFT_PLAN_SCOPE',
  'CURRENT259_BUILD_SOURCE_NOT_CLEAN','CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','LOCAL_MIGRATION_SQL_STAGE203_READBACK',
  'CURRENT259_ORDINARY_ARCHIVE_ACL_PRESTATE_REJECTED','CURRENT259_ORDINARY_ARCHIVE_ACL_COMMIT_UNCONFIRMED',
  'CURRENT259_ROLE_PROVISION_BEFORE','CURRENT259_ROLE_PROVISION_COMMIT_UNCONFIRMED',
  'CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED','CURRENT259_ARCHIVE_INSTALL_COMMIT_UNCONFIRMED',
  'CURRENT259_ARCHIVE_INSTALL_CLEANUP_UNCONFIRMED','CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED',
  'CURRENT259_CONTRACT_LOGIN_SEED_BEFORE','CURRENT259_CONTRACT_LOGIN_SEED_WRITE','CURRENT259_CONTRACT_LOGIN_SEED_COMMITTED',
  'CURRENT259_FIRST_Q2_APP_GENERATED_HTTP'
]);
function safeReason(cause){
  let found;
  for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause);i++,cause=own(cause,'cause')){
    const code=own(cause,'code');
    if(reasons.has(code))found=code;
    if(code==='CURRENT259_CONTRACT_LOGIN_BEFORE'&&['PHYSICAL_ENDPOINT','ACL_PROFILE'].includes(own(cause,'stageFailure')))
      found='CONTRACT_LOGIN_'+own(cause,'stageFailure');
  }
  return found;
}
const installerStages=Object.freeze({
  ARCHIVE:new Set(['archive-install-before','archive-install-write','archive-install-committed','current259-seven-before','archive-registered-write','archive-registered-committed']),
  GENERATED_DRAFT_ACL:new Set(['current259-ordinary-acl-before','current259-ordinary-acl-write','current259-ordinary-acl-committed'])
});
function stageFailure(cause,phase){
  if(!Object.hasOwn(installerStages,phase))return undefined;
  const reason=own(cause,'code'),stage=own(cause,'phase');
  return reasons.has(reason)&&reason.startsWith(phase==='ARCHIVE'?'CURRENT259_ARCHIVE_INSTALL_':'CURRENT259_ORDINARY_ARCHIVE_ACL_')&&
    installerStages[phase].has(stage)?stage:undefined;
}

function safeCleanup(cause,scopeEntered){
  let completed=false;
  for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause);i++,cause=own(cause,'cause')){
    const status=own(own(cause,'resourceReceipt'),'status');
    const code=own(cause,'code');
    if(own(cause,'resourceCleanup')||own(cause,'appCleanupOutcome')||own(cause,'clientCleanup')==='UNKNOWN'||status==='cleanup_failed'||
      code==='CURRENT259_ARCHIVE_INSTALL_CLEANUP_UNCONFIRMED'||code==='CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED')
      return 'UNKNOWN';
    completed ||= status==='closed';
  }
  return scopeEntered||completed?'OWNER_SCOPE_RETURNED':'UNKNOWN';
}
function evidence(result){
  const draft=own(result,'draft'),seed=own(result,'seed');
  need(own(result,'status')==='CURRENT259_GENERATED_DRAFT_PROTOCOL_AND_NEST_CLOSED'&&own(result,'httpSteps')===5&&
    own(result,'verifiedClients')===5&&own(result,'storageAcceptance')===false&&own(result,'executionAllowed')===false&&
    own(result,'nativeAdmission')===false&&own(draft,'status')==='DRAFT_ADMISSION_PROTOCOL_MATCHED'&&own(draft,'leaseRevision')===1&&
    own(seed,'seedRows')===21&&own(seed,'operating')===false,'RESULT');
  const ids=['projectId','contractId','versionId'].map(key=>own(draft,key));
  const seedXid=own(seed,'seedXid');
  need(ids.every(value=>typeof value==='string'&&UUID.test(value))&&new Set(ids).size===3&&typeof seedXid==='string'&&
    /^[1-9][0-9]{0,19}$/u.test(seedXid)&&BigInt(seedXid)<=0xffffffffffffffffn,'RESULT');
  return {projectId:ids[0],contractId:ids[1],versionId:ids[2],leaseRevision:1,seedRows:21,seedXid,httpSteps:5,verifiedClients:5};
}

async function main(){
  let checked,attempted=false,resourceEntered=false,scopeEntered=false,phase='PREFLIGHT',cleanup='NOT_STARTED';
  const controller=new AbortController(),signal=()=>controller.abort();
  let writeReceipt,technicalFailure,httpFailure,admissionFailure,failureStage,sevenFailure,archiveWriteFailure;
  try{
    need(FRESH,'FRESH');
    const args=parseArgs(process.argv.slice(2));
    const {verifyCurrent259GeneratedDraftPlan}=require('../../../scripts/prepare-task12-current259-generated-draft.cjs');
    checked=verifyCurrent259GeneratedDraftPlan(args.file,args.digest);
    if(!args.once)return {status:'CURRENT259_GENERATED_DRAFT_HOLD',planSha256:args.digest};
    checkHostEnv();
    const plan=checked.plan;
    need(businessDay()===plan.case.businessDate,'TIME');
    checked.check();
    const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
    const {withCurrent259FirstQ2LoopbackResource}=require('./task16-current259-owned-resource.cjs');
    const {createCurrent259TechnicalMigration,describeCurrent259TechnicalFailure}=require('./local-staged-current259-profile.cjs');
    const {provisionCurrent259Roles}=require('./task16-current259-role-provision.cjs');
    const {installCurrent259ArchiveAuthoritiesWithRegisteredFileSource}=require('./task16-current259-archive-install.cjs');
    const {installCurrent259GeneratedDraftOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
    const {withCurrent259GeneratedDraftAdmission}=require('./task12-current259-contract-login.cjs');
    need([withCurrent259FirstQ2LoopbackResource,createCurrent259TechnicalMigration,describeCurrent259TechnicalFailure,provisionCurrent259Roles,
      installCurrent259ArchiveAuthoritiesWithRegisteredFileSource,installCurrent259GeneratedDraftOrdinaryAcl,
      withCurrent259GeneratedDraftAdmission].every(fn=>typeof fn==='function'),'DEPENDENCIES');
    process.once('SIGINT',signal);process.once('SIGTERM',signal);
    phase='ATTEMPT';
    need(!controller.signal.aborted&&fs.readdirSync(plan.run.root).length===0,'ATTEMPT_USED');
    const coordinates={planSha256:checked.sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id};
    const marker=Buffer.from(JSON.stringify({status:'CONSUMED',...coordinates})+'\n');
    writeExclusive(plan.run.attemptFile,marker,()=>{attempted=true;});
    const entry=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,code:'CURRENT259_GENERATED_DRAFT_ATTEMPT'});
    need(entry.sha256===hash(marker),'ATTEMPT');
    writeReceipt=(status,proof)=>{
      const receipt={status,phase,...coordinates,relationship:'inside',contractTypeKey:'material_purchase',
        operating:false,cleanup,...proof};
      writeExclusive(plan.run.receiptFile,Buffer.from(JSON.stringify(receipt)+'\n'));
      return receipt;
    };
    const check=()=>{
      need(!controller.signal.aborted&&businessDay()===plan.case.businessDate,'CONTINUITY');
      checked.check();
      need(read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,expectedIdentity:entry.identity,
        code:'CURRENT259_GENERATED_DRAFT_ATTEMPT'}).sha256===entry.sha256,'ATTEMPT');
    };
    const stage=async(name,work)=>{
      phase=name;check();
      let result;
      try{result=await work();}
      catch(error){
        if(name==='MIGRATE')technicalFailure=describeCurrent259TechnicalFailure(error);
        if(name==='GENERATED_DRAFT_ADMISSION'){
          admissionFailure=projectGeneratedDraftAdmissionFailure(own(error,'admissionFailure'));
          if(own(error,'code')==='CURRENT259_CONTRACT_LOGIN_CONSUMER')
            httpFailure=projectGeneratedDraftHttpFailure(own(error,'generatedHttpFailure'));
        }
        failureStage=stageFailure(error,name);
        if(failureStage==='archive-registered-write'){
          const {projectCurrent259ArchiveWriteFailure}=require('./enterprise-task01-resources.cjs');
          archiveWriteFailure=projectCurrent259ArchiveWriteFailure(own(error,'archiveWriteFailure'));
        }
        const detail=failureStage==='current259-seven-before'?own(error,'sevenFailure'):undefined;
        if(detail){
          const {describeCurrent259SevenPrestateCommandFailure}=require('./task16-current259-seven-install.cjs');
          sevenFailure=describeCurrent259SevenPrestateCommandFailure({
            code:own(detail,'causeCode'),sevenOwnerFailure:detail
          });
        }
        throw error;
      }
      check();return result;
    };
    phase='RESOURCE';check();resourceEntered=true;
    const result=await withCurrent259FirstQ2LoopbackResource(checked.buildHandle,
      {artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,async handle=>{
        scopeEntered=true;
        const technical=await stage('MIGRATE',()=>createCurrent259TechnicalMigration(handle,controller.signal).migrate());
        const roles=await stage('ROLES',()=>provisionCurrent259Roles(technical,handle));
        const archive=await stage('ARCHIVE',()=>installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(roles,handle));
        const acl=await stage('GENERATED_DRAFT_ACL',()=>installCurrent259GeneratedDraftOrdinaryAcl(archive,handle));
        return stage('GENERATED_DRAFT_ADMISSION',()=>withCurrent259GeneratedDraftAdmission(acl,handle,plan.case.id));
      });
    cleanup='CLOSED';phase='COMPLETE';check();
    return writeReceipt('CURRENT259_GENERATED_DRAFT_PROTOCOL_COMPLETE',evidence(result));
  }catch(cause){
    process.exitCode=1;
    if(resourceEntered&&cleanup!=='CLOSED')cleanup=safeCleanup(cause,scopeEntered);
    const reason=safeReason(cause),proof={...(reason?{reason}:{}),...(technicalFailure?{technicalFailure}:{}),
      ...(httpFailure?{httpFailure}:{}),...(admissionFailure?{admissionFailure}:{}),...(failureStage?{failureStage}:{}),...(sevenFailure?{sevenFailure}:{}),
      ...(archiveWriteFailure?{archiveWriteFailure}:{})};
    if(writeReceipt){
      try{return writeReceipt('CURRENT259_GENERATED_DRAFT_STOPPED',proof);}
      catch{cleanup='UNKNOWN';}
    }
    return {status:'CURRENT259_GENERATED_DRAFT_STOPPED',phase,attempted,cleanup,...proof};
  }finally{
    controller.abort();
    process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
  }
}
if(require.main===module)void main().then(result=>process.stdout.write(JSON.stringify(result)+'\n'));
