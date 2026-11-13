#!/usr/bin/env node
'use strict';
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&
  Object.keys(require.cache).every(key=>key===__filename);
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {types}=require('node:util');

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fault=phase=>{const code='CURRENT261_LOCAL_LIFECYCLE_ONCE_'+phase;return Object.assign(new Error(code),{code});};
const need=(ok,phase)=>{if(!ok)throw fault(phase);};
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const SHA=/^[a-f0-9]{64}$/u;
const businessDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());

function writeExclusive(file,bytes,onOpen){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{onOpen?.();fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

function parseArgs(args){
 need((args.length===4||args.length===5&&args[4]==='--once')&&args[0]==='--plan'&&
  args[2]==='--expected-plan-sha256'&&SHA.test(args[3]),'ARGS');
 return {file:args[1],digest:args[3],once:args.length===5};
}

function checkHostEnv(){
 need(!Object.keys(process.env).some(key=>/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|COS_.*)$/u.test(key)),'HOST_ENV');
}

const reasonCodes=new Set([
 'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING','TASK12_OFFICIAL_DOCUMENT_SOURCE','TASK12_OFFICIAL_DOCUMENT_SCOPE','TASK12_OFFICIAL_DOCUMENT_DEADLINE','TASK12_OFFICIAL_DOCUMENT_READER',
 'CURRENT261_LOCAL_LIFECYCLE_HTTP','CURRENT259_LOADER_CHANGED',
 'CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT','CURRENT261_LOCAL_LIFECYCLE_OWNER_FACTS','CURRENT261_LOCAL_LIFECYCLE_OWNER_FAULT_UNKNOWN',
 'TASK01_RESOURCE_START_FAILED','CURRENT259_RESOURCE_CLEANUP_UNKNOWN','CURRENT259_BUILD_SOURCE_NOT_CLEAN',
 'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','LOCAL_MIGRATION_SQL_STAGE203_READBACK',
 'CURRENT259_ROLE_PROVISION_BEFORE','CURRENT259_ROLE_PROVISION_COMMIT_UNCONFIRMED',
 ...['PRESTATE_REJECTED','COMMIT_UNCONFIRMED','CLEANUP_UNCONFIRMED','COMMIT_AND_CLEANUP_UNCONFIRMED']
  .map(part=>'CURRENT259_ARCHIVE_INSTALL_'+part),
 ...['ORDINARY_ARCHIVE_ACL','DOCUMENT_ROLE_PROVISION','DOCUMENT_ACL_TRANSPORT','DOCUMENT_LOGIN']
  .flatMap(stage=>['PRESTATE_REJECTED','COMMIT_UNCONFIRMED'].map(part=>'CURRENT259_'+stage+'_'+part)),
 'CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED',
 ...['FRESH','ARGS','HOST_ENV','TIME','CONTINUITY','DEPENDENCIES','ATTEMPT','ATTEMPT_USED','RESULT','RUNTIME','RECEIPT']
  .map(part=>'CURRENT261_LOCAL_LIFECYCLE_ONCE_'+part),
 ...['DIRECTORY','DIGEST','SCOPE','CHANGED','RUN_ALREADY_USED','INPUT','RUNTIME']
  .map(part=>'CURRENT259_GENERATED_DRAFT_PLAN_'+part),
 ...['INPUT','SCOPE','ENV','CONTINUITY','CLEANUP_UNKNOWN','READER']
  .map(part=>'CURRENT259_GENERATED_DOCUMENT_RUNTIME_'+part),
 ...['INPUT','TEMPLATE','OPEN','SAVE','OWNER_BEGIN','GENERATE','PUBLIC_READBACK','OWNER_READBACK','RESULT']
  .map(part=>'CURRENT259_GENERATED_DOCUMENT_EXERCISE_'+part)
]);
const loginReasons=new Set([
 'PREIMAGE','POSTIMAGE','READBACK','OUTPUT','ROLE_PRODUCER','ROLE_HBA','ROLE_IDENTITY','ROLE_DRAIN','ROLE_CONSTRUCT',
 'ROLE_CLIENT','ROLE_CONNECT','ROLE_OWNER_READ','ROLE_ENTRY','ROLE_CLEANUP_UNKNOWN','ROLE_CLOSE_TIMEOUT','ROLE_APP',
 ...['HANDLE','DESCRIPTOR','PROVIDERS','MODULE','COMPILE','CREATE','INIT','LISTEN','HTTP','USE','CLOSE','TIMEOUT'].map(stage=>'ROLE_APP_'+stage)
]);

function safeReason(cause){
 let found;
 for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause);i++,cause=own(cause,'cause')){
  const code=own(cause,'code'),reason=own(cause,'reason'),exerciseCode=own(cause,'exerciseCode');
  if(reasonCodes.has(code))found=code;
  if(code==='CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED'&&loginReasons.has(reason))found='CURRENT259_DOCUMENT_LOGIN_'+reason;
  if(code==='CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED'&&reason==='ROLE_APP_HTTP'&&reasonCodes.has(exerciseCode)&&
   typeof exerciseCode==='string'&&exerciseCode.startsWith('CURRENT259_GENERATED_DOCUMENT_EXERCISE_'))found=exerciseCode;
 }
 return found;
}

const installerStages=Object.freeze({
 ARCHIVE:['CURRENT259_ARCHIVE_INSTALL_',new Set(['archive-install-before','archive-install-write','archive-install-committed',
  'current259-seven-before','archive-registered-write','archive-registered-committed'])],
 DOCUMENT_ORDINARY_ACL:['CURRENT259_ORDINARY_ARCHIVE_ACL_',new Set(['current259-ordinary-acl-before',
  'current259-ordinary-acl-write','current259-ordinary-acl-committed'])],
 DOCUMENT_ACL:['CURRENT259_DOCUMENT_ACL_TRANSPORT_',new Set(['BEFORE','WRITE','COMMITTED'])],
 APPLICATION:['CURRENT259_DOCUMENT_LOGIN_',new Set(['BEFORE','WRITE','COMMITTED','CONSUME'])]
});

function safeStage(cause,phase){
 if(!Object.hasOwn(installerStages,phase))return undefined;
 const [prefix,allowed]=installerStages[phase],code=own(cause,'code'),stage=own(cause,'phase');
 return reasonCodes.has(code)&&code.startsWith(prefix)&&allowed.has(stage)?stage:undefined;
}

function safeCleanup(cause,scopeEntered){
 let closed=false;
 for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause);i++,cause=own(cause,'cause')){
  const status=own(own(cause,'resourceReceipt'),'status'),code=own(cause,'code');
  if(own(own(cause,'resourceCleanup'),'status')==='UNKNOWN'||own(cause,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE'||own(cause,'ownerCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE'||
   own(cause,'clientCleanup')==='UNKNOWN'||own(cause,'environmentRestoration')==='UNKNOWN'||own(cause,'storageCleanup')==='UNKNOWN'||
   status==='cleanup_failed'||['CURRENT259_RESOURCE_CLEANUP_UNKNOWN','CURRENT259_GENERATED_DOCUMENT_RUNTIME_CLEANUP_UNKNOWN',
    'CURRENT259_ARCHIVE_INSTALL_CLEANUP_UNCONFIRMED','CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED'].includes(code))return 'UNKNOWN';
  closed ||= !scopeEntered&&code==='TASK01_RESOURCE_START_FAILED'&&status==='closed';
 }
 return closed?'CLOSED':scopeEntered?'OWNER_SCOPE_RETURNED':'UNKNOWN';
}

async function main(){
 let attempted=false,resourceEntered=false,scopeEntered=false,phase='PREFLIGHT',cleanup='NOT_STARTED';
 let writeReceipt,technicalFailure,failureStage,sevenFailure,firstFailure;
 const controller=new AbortController(),abort=()=>controller.abort();
 try{
  need(FRESH,'FRESH');
  const args=parseArgs(process.argv.slice(2));
  const {verifyCurrent261LocalLifecyclePlan}=require('../../../scripts/prepare-task12-current261-local-lifecycle.cjs');
  const checked=verifyCurrent261LocalLifecyclePlan(args.file,args.digest);
  const {plan}=checked,runtimeSha256=plan.runtime.sha256;
  need(checked.sha256===args.digest&&SHA.test(runtimeSha256)&&checked.runtime&&typeof checked.runtime==='object','RUNTIME');
  if(!args.once)return {status:'CURRENT261_LOCAL_LIFECYCLE_HOLD',planSha256:checked.sha256,runtimeSha256};
  checkHostEnv();
  need(businessDay()===plan.case.businessDate,'TIME');
  checked.check();

  const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
  const {withCurrent259FirstQ2LoopbackResource}=require('./task16-current259-owned-resource.cjs');
  const {createCurrent259TechnicalMigration,describeCurrent259TechnicalFailure}=require('./local-staged-current259-profile.cjs');
  const {provisionCurrent259Roles}=require('./task16-current259-role-provision.cjs');
  const {installCurrent259ArchiveAuthoritiesWithRegisteredFileSource}=require('./task16-current259-archive-install.cjs');
  const {installCurrent261GeneratedLifecycleOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
  const {provisionCurrent261GeneratedLifecycleDocumentRoles}=require('./task12-current259-document-role-provision.cjs');
  const {installCurrent261GeneratedLifecycleDocumentAcl,describeCurrent261DocumentAclFailure}=require('./task12-current259-document-acl-transport.cjs');
  const {withOfficialTask12DocumentRuntime}=require('./task12-current259-generated-document-runtime.cjs');
  const {withCurrent261LocalLifecyclePublicApplication}=require('./task12-current259-document-login.cjs');
  const {projectCurrent261LocalLifecycleOutcome}=require('./task12-current261-local-lifecycle-exercise.cjs');
  const {describeCurrent261LocalLifecycleHttpFailure}=require('./task12-current261-local-lifecycle-http.cjs');
  need([read,withCurrent259FirstQ2LoopbackResource,createCurrent259TechnicalMigration,describeCurrent259TechnicalFailure,provisionCurrent259Roles,
   installCurrent259ArchiveAuthoritiesWithRegisteredFileSource,installCurrent261GeneratedLifecycleOrdinaryAcl,
   provisionCurrent261GeneratedLifecycleDocumentRoles,installCurrent261GeneratedLifecycleDocumentAcl,withOfficialTask12DocumentRuntime,
   withCurrent261LocalLifecyclePublicApplication,projectCurrent261LocalLifecycleOutcome,describeCurrent261LocalLifecycleHttpFailure,describeCurrent261DocumentAclFailure]
   .every(fn=>typeof fn==='function'),'DEPENDENCIES');

  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  phase='ATTEMPT';
  need(!controller.signal.aborted&&fs.readdirSync(plan.run.root).length===0,'ATTEMPT_USED');
  const coordinates={planSha256:checked.sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id,runtimeSha256};
  const marker=Buffer.from(JSON.stringify({status:'CONSUMED',...coordinates})+'\n');
  writeReceipt=(status,proof)=>{
   const receipt={status,phase,...coordinates,relationship:'inside',contractTypeKey:'material_purchase',operating:false,storage:'LOCAL_ONLY',cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false,cleanup,...proof};
   try{writeExclusive(plan.run.receiptFile,Buffer.from(JSON.stringify(receipt)+'\n'));}
   catch{throw fault('RECEIPT');}
   return receipt;
  };
  writeExclusive(plan.run.attemptFile,marker,()=>{attempted=true;});
  const attempt=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_ATTEMPT'});
  need(attempt.sha256===hash(marker),'ATTEMPT');
  const check=()=>{
   need(!controller.signal.aborted&&businessDay()===plan.case.businessDate,'CONTINUITY');
   checked.check();
   need(read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,expectedIdentity:attempt.identity,
    code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_ATTEMPT'}).sha256===attempt.sha256,'ATTEMPT');
  };

  const stage=async(name,work)=>{
   phase=name;
   let value;
   try{check();value=await work();check();}
   catch(cause){
    if(!firstFailure)firstFailure={cause,phase:name,httpFailure:describeCurrent261LocalLifecycleHttpFailure(cause),
     documentAclFailure:name==='DOCUMENT_ACL'?describeCurrent261DocumentAclFailure(cause):undefined};
    if(name===phase){
     failureStage=safeStage(cause,name);
     try{
      if(name==='MIGRATE')technicalFailure=describeCurrent259TechnicalFailure(cause);
      const detail=failureStage==='current259-seven-before'?own(cause,'sevenFailure'):undefined;
      if(detail){
       const {describeCurrent259SevenPrestateCommandFailure}=require('./task16-current259-seven-install.cjs');
       sevenFailure=describeCurrent259SevenPrestateCommandFailure({code:own(detail,'causeCode'),sevenOwnerFailure:detail});
      }
     }catch{/* Keep the original failure when a diagnostic cannot be projected. */}
    }
    throw cause;
   }
   return value;
  };

  phase='RESOURCE';check();resourceEntered=true;
  const outcome=await withCurrent259FirstQ2LoopbackResource(checked.buildHandle,
   {artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,async handle=>{
    need(!scopeEntered,'RUNTIME');scopeEntered=true;
    const technical=await stage('MIGRATE',()=>createCurrent259TechnicalMigration(handle,controller.signal).migrate());
    const roles=await stage('ROLES',()=>provisionCurrent259Roles(technical,handle));
    const archive=await stage('ARCHIVE',()=>installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(roles,handle));
    const ordinary=await stage('DOCUMENT_ORDINARY_ACL',()=>installCurrent261GeneratedLifecycleOrdinaryAcl(archive,handle));
    const documentRoles=await stage('DOCUMENT_ROLES',()=>provisionCurrent261GeneratedLifecycleDocumentRoles(ordinary,handle));
    const acl=await stage('DOCUMENT_ACL',()=>installCurrent261GeneratedLifecycleDocumentAcl(documentRoles,handle));
    let runtimeEntered=false;
    const result=await stage('RUNTIME',()=>withOfficialTask12DocumentRuntime(checked.runtime,plan.runtime.runRoot,async()=>{
     need(!runtimeEntered,'RUNTIME');runtimeEntered=true;
     const projected=await stage('APPLICATION',async()=>{
      let invoked=false;
      const app=await withCurrent261LocalLifecyclePublicApplication(acl,handle,plan.case.id,controller.signal,outcome=>{
       need(!invoked,'RESULT');invoked=true;check();
       return outcome;
      });
      check();need(invoked,'RESULT');
      const projection=projectCurrent261LocalLifecycleOutcome(app);
      need(projection&&typeof projection==='object'&&!types.isProxy(projection)&&
       Object.getPrototypeOf(projection)===Object.prototype,'RESULT');
      return projection;
     });
     phase='RUNTIME_CLEANUP';
     return projected;
    }));
    need(runtimeEntered,'RUNTIME');
    phase='RESOURCE_CLEANUP';
    return result;
   });
  cleanup='CLOSED';phase='COMPLETE';check();
  need(scopeEntered&&outcome,'RESULT');
  return writeReceipt('CURRENT261_LOCAL_LIFECYCLE_PROTOCOL_COMPLETE',{outcome});
 }catch(cause){
  process.exitCode=1;
  if(resourceEntered&&cleanup!=='CLOSED')cleanup=safeCleanup(cause,scopeEntered);
  const primary=firstFailure?.cause??cause,reason=safeReason(primary);
  const proof={...(reason?{reason}:{}),...(firstFailure?{failurePhase:firstFailure.phase}:{}),
   ...(firstFailure?.httpFailure?{httpFailure:firstFailure.httpFailure}:{}),
   ...(firstFailure?.documentAclFailure?{documentAclFailure:firstFailure.documentAclFailure}:{}),
   ...(firstFailure&&cause!==primary?{secondaryReason:safeReason(cause)??'UNCLASSIFIED',secondaryPhase:'UNWIND'}:{}),
   ...(scopeEntered?{businessOutcome:'UNKNOWN'}:{}),...(technicalFailure?{technicalFailure}:{}),
   ...(failureStage?{failureStage}:{}),...(sevenFailure?{sevenFailure}:{})};
  let receiptWriteFailed=reason==='CURRENT261_LOCAL_LIFECYCLE_ONCE_RECEIPT';
  if(attempted&&writeReceipt&&!receiptWriteFailed){
   try{return writeReceipt('CURRENT261_LOCAL_LIFECYCLE_STOPPED',{attempted,...proof});}
   catch{receiptWriteFailed=true;}
  }
  return {status:'CURRENT261_LOCAL_LIFECYCLE_STOPPED',phase,attempted,cleanup,...proof,
   ...(receiptWriteFailed?{receiptWriteFailed:true}:{})};
 }finally{
  controller.abort();
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
 }
}
if(require.main===module)void main().then(result=>process.stdout.write(JSON.stringify(result)+'\n'));
