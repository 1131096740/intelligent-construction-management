#!/usr/bin/env node
'use strict';
// Fresh fixed CLI only. Import/default mode cannot create a resource. --once is
// an explicit execution request, never a replacement for external authorization.
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH')&&Object.keys(require.cache).every(file=>file===__filename);
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{types,isDeepStrictEqual}=require('node:util');
// Import this producer before its cached loader. No native operation on import.
const {withCurrent259OwnedResource,claimCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {verifyCurrent259OwnerTls,claimCurrent259OwnerTls}=require('./task16-current259-owner-tls.cjs');
const {readOwnerTlsPlan,verifyOwnerTlsPlan}=require('../../../scripts/prepare-task16-current259-owner-tls.cjs');
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
let onceAttempted=false;
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function data(value,key){if(!value||types.isProxy(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
function code(error){const value=data(error,'code');return typeof value==='string'&&/^(?:OWNER_TLS_(?:ONCE|PLAN)|CURRENT259_(?:OWNER|RESOURCE|BUILD|LOADER)|TASK01_RESOURCE)_[A-Z0-9_]+$/u.test(value)?value:'OWNER_TLS_ONCE_FAILED_CLOSED';}
function outcome(error,key,allowed){const value=data(error,key);return typeof value==='string'&&allowed.includes(value)?value:'UNKNOWN';}
function parse(args){
 need(Array.isArray(args)&&args.every(v=>typeof v==='string'),'OWNER_TLS_ONCE_ARGUMENTS');
 const once=args[0]==='--once',rest=once?args.slice(1):args;
 need(rest.length===4&&rest[0]==='--plan'&&rest[2]==='--expected-plan-sha256'&&/^[a-f0-9]{64}$/u.test(rest[3]),'OWNER_TLS_ONCE_ARGUMENTS');
 return {once,file:rest[1],sha256:rest[3]};
}
function checkRoot(plan){
 const root=plan.run.root;need(fs.realpathSync(root)===root,'OWNER_TLS_ONCE_DIRECTORY');const st=fs.lstatSync(root);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&['dev','ino','uid','gid','mode'].every(k=>st[k]===plan.run.identity[k]),'OWNER_TLS_ONCE_DIRECTORY');
}
function writeNew(plan,file,bytes){
 checkRoot(plan);need(path.dirname(file)===plan.run.root,'OWNER_TLS_ONCE_PATH');let fd;
 try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 const dir=fs.openSync(plan.run.root,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function publishReceipt(plan,receipt){
 const pending=plan.run.receiptFile+'.pending',bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');writeNew(plan,pending,bytes);
 // Atomic no-overwrite publish, unlike rename over an unknown existing file.
 fs.linkSync(pending,plan.run.receiptFile);fs.unlinkSync(pending);
 const dir=fs.openSync(plan.run.root,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 return digest(bytes);
}
function identity(raw){
 const result=Object.fromEntries(['runId','sourceSha','daemonId','endpoint','imageId','containerId','networkId','databaseName','port'].map(k=>[k,data(raw,k)]));
 need(typeof result.runId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(result.runId)&&['containerId','networkId'].every(k=>typeof result[k]==='string'&&/^[a-f0-9]{64}$/u.test(result[k]))&&result.databaseName==='jg_task01_'+result.runId.replaceAll('-','')&&Number.isInteger(result.port)&&result.port>0&&result.port<=65535,'OWNER_TLS_ONCE_RESOURCE_IDENTITY');return result;
}
function closedResult(raw){
 need(data(raw,'scope')==='CLOSED_OWNER_TLS_CONTROLS_ONLY','OWNER_TLS_ONCE_PROOF');const probes=data(raw,'probes');
 need(Array.isArray(probes)&&!types.isProxy(probes)&&probes.length===7&&probes.every(p=>data(p,'closed')===true),'OWNER_TLS_ONCE_PROOF');
 const result=Object.fromEntries(['scope','runId','database','databaseOid','systemIdentifier','ownerOid','caSha256','ownerRestorationOutcome','clientCleanupOutcome'].map(k=>[k,data(raw,k)]));
 result.probes=probes.map(p=>{
  const projected=Object.fromEntries(['kind','closed','prismaCode','certificateMarker'].filter(k=>data(p,k)!==undefined).map(k=>[k,data(p,k)])),source=data(p,'identity');
  if(source)projected.identity=Object.fromEntries(['database','databaseOid','systemIdentifier','effectiveRole','loginRole','effectiveOid','loginOid','ownerOid','pid','start','tls','version','encoding','replication','readOnly','defaultReadOnly','clientAddress','clientPort','serverAddress','serverPort'].map(k=>[k,data(source,k)]));return projected;
 });return result;
}
function finalResource(plan,created,attempted){
 if(!attempted)return {status:'not-attempted',identityBinding:'NOT_ATTEMPTED',cleanup:{status:'not-needed'}};
 checkRoot(plan);const file=path.join(plan.run.resourceDir,'resource-manifest.json');
 if(!fs.existsSync(file))return {status:'unconfirmed',identityBinding:'UNKNOWN',cleanup:{status:'UNKNOWN'}};
 const captured=read(file,{privateFile:true,maxBytes:1048576,collect:true,code:'OWNER_TLS_ONCE_FINAL_MANIFEST'});let final;try{final=JSON.parse(captured.bytes.toString('utf8'));}catch{throw fault('OWNER_TLS_ONCE_FINAL_MANIFEST');}
 if(!created)return {status:'unconfirmed',identityBinding:'UNCONFIRMED_MANIFEST_ONLY',cleanup:{status:'UNKNOWN'},manifestSha256:captured.sha256};
 need(Object.keys(created).every(k=>data(final,k)===created[k]),'OWNER_TLS_ONCE_RESOURCE_CHANGED');
 const cleanup=data(final,'cleanup'),verified=data(final,'status')==='closed'&&data(cleanup,'status')==='completed'&&['containerAbsent','volumesAbsent','networkAbsent'].every(k=>data(cleanup,k)===true);
 return {...created,status:verified?'closed':'unconfirmed',identityBinding:'ORIGINAL_LIVE_HANDLE_AND_FINAL_MANIFEST',cleanup:{status:verified?'completed':'UNKNOWN',containerAbsent:verified,volumesAbsent:verified,networkAbsent:verified},manifestSha256:captured.sha256,cleanupEvidence:'BOUND_ORIGINAL_CLOSE_AND_QUALIFIED_MANIFEST',independentDockerChecker:false};
}
async function runOwnerTlsCli(args){
 let request,basic,plan,checked,receipt,created,proofResult,started=false,marker=false,first,receiptSha,publicationStarted=false;
 const requestedOnce=Array.isArray(args)&&args[0]==='--once';
 try{
  request=parse(args);if(request.once)need(FRESH&&!onceAttempted,'OWNER_TLS_ONCE_FRESH_CLI_REQUIRED');
  basic=readOwnerTlsPlan(request.file,request.sha256);plan=basic.plan;
  if(!request.once){checked=verifyOwnerTlsPlan(request.file,request.sha256);checked.check();return {status:'OWNER_TLS_PLAN_VERIFIED_NO_RESOURCES',candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:false,resourcesExecuted:false};}
  onceAttempted=true;
  // Consume the durable attempt before source/build/tool preflight. A failed
  // preflight is not a refunded permission and never an automatic retry.
  try{writeNew(plan,plan.run.attemptFile,JSON.stringify({status:'STARTED',onceAttemptConsumed:true,expectedCandidateSha:plan.material.source.candidateSha,planSha256:request.sha256})+'\n');}catch(error){if(data(error,'code')==='EEXIST')throw fault('OWNER_TLS_ONCE_ALREADY_ATTEMPTED');throw error;}marker=true;
  receipt={schemaVersion:1,purpose:plan.purpose,expectedCandidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,status:'STOPPED',scope:plan.scope,limits:plan.limits,sourceMaterialVerified:false,resource:{status:'not-attempted',cleanup:{status:'not-needed'}},ownerTls:null,liveSessionAdmission:false,financialAcceptance:false,installed259:false};
  let controller,timer;const abort=()=>controller?.abort();
  try{
   need(!fs.existsSync(plan.run.receiptFile)&&!fs.existsSync(plan.run.receiptFile+'.pending'),'OWNER_TLS_ONCE_RECEIPT_EXISTS');
   checked=verifyOwnerTlsPlan(request.file,request.sha256);need(isDeepStrictEqual(checked.file.identity,basic.file.identity),'OWNER_TLS_ONCE_PLAN_REPLACED');checked.check();receipt.sourceMaterialVerified=true;
   need(!fs.existsSync(plan.run.resourceDir),'OWNER_TLS_ONCE_RESOURCE_CHILD_EXISTS');
   controller=new AbortController();process.once('SIGINT',abort);process.once('SIGTERM',abort);timer=setTimeout(abort,plan.limits.resourceMs);
   started=true;
   proofResult=await withCurrent259OwnedResource(checked.buildHandle,{artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,async handle=>{
    const owned=claimCurrent259OwnedResource(handle);created=identity(owned.resource.getReceipt());
    need(created.sourceSha===plan.material.source.candidateSha&&created.daemonId===plan.resource.daemonId&&created.endpoint===plan.resource.endpoint&&created.imageId===plan.resource.imageId,'OWNER_TLS_ONCE_RESOURCE_IDENTITY');
    const proof=await verifyCurrent259OwnerTls(handle);const closed=closedResult(claimCurrent259OwnerTls(proof,handle));
    need(closed.runId===created.runId&&closed.database===created.databaseName,'OWNER_TLS_ONCE_PROOF');return closed;
   });
   checked.check();receipt.ownerTls=proofResult;
  }catch(error){first=error;receipt.failureCode=code(error);receipt.ownerFailure={ownerRestorationOutcome:outcome(error,'ownerRestorationOutcome',['NOT_NEEDED','RESTORE_REQUIRED','CORRECT_PRESENTATION_RESTORED','UNKNOWN']),clientCleanupOutcome:outcome(error,'clientCleanupOutcome',['NOT_ATTEMPTED','DISCONNECTED','UNKNOWN']),resourceCleanupOutcome:outcome(error,'resourceCleanupOutcome',['NOT_NEEDED','CLOSED','UNKNOWN'])};}
  finally{if(timer)clearTimeout(timer);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  try{receipt.resource=finalResource(plan,created,started);}catch(error){if(!first){first=error;receipt.failureCode=code(error);}receipt.resource={...(created??{}),status:'unconfirmed',cleanup:{status:'UNKNOWN'}};}
  if(!first&&receipt.ownerTls&&receipt.resource.cleanup.status==='completed')receipt.status='OWNER_TLS_CLOSED_PROBES_AND_OWNED_CLEANUP_VERIFIED';
  else {receipt.status='STOPPED';receipt.failureCode??='OWNER_TLS_ONCE_CLEANUP_UNCONFIRMED';}
  publicationStarted=true;receiptSha=publishReceipt(plan,receipt);
  return {status:receipt.status,candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,receiptFile:plan.run.receiptFile,receiptSha256:receiptSha,onceAttemptConsumed:true,resourceCreationRequested:started,resourceExecutionOutcome:!started?'NOT_ATTEMPTED':created?'CREATED_HANDLE_OBSERVED':'UNKNOWN',failureCode:receipt.failureCode};
 }catch(error){
  // Never overwrite an earlier attempt/receipt to make a repeated run look new.
  if(marker&&plan&&!receiptSha&&!publicationStarted){
   const stopped=receipt??{schemaVersion:1,purpose:plan.purpose,expectedCandidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,scope:plan.scope,limits:plan.limits,liveSessionAdmission:false,financialAcceptance:false,installed259:false};
   stopped.status='STOPPED';stopped.failureCode??=code(first??error);stopped.resource??={status:'unconfirmed',cleanup:{status:'UNKNOWN'}};
   try{publicationStarted=true;receiptSha=publishReceipt(plan,stopped);}catch{ /* durable receipt outcome remains UNKNOWN; do not retry execution */ }
  }
  return {status:'STOPPED',failureCode:code(first??error),onceAttemptConsumed:requestedOnce,resourceCreationRequested:started,resourceExecutionOutcome:!started?'NOT_ATTEMPTED':created?'CREATED_HANDLE_OBSERVED':'UNKNOWN',receiptOutcome:receiptSha?'WRITTEN':'UNKNOWN',receiptFile:receiptSha?plan.run.receiptFile:undefined};
 }
}
const execution=require.main===module?runOwnerTlsCli(process.argv.slice(2)).then(result=>{const exit=result.status==='OWNER_TLS_PLAN_VERIFIED_NO_RESOURCES'||result.status==='OWNER_TLS_CLOSED_PROBES_AND_OWNED_CLEANUP_VERIFIED'?0:1;process.exitCode=exit;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(process.argv[2]==='--once')process.exit(exit);});return result;}):undefined;
module.exports=Object.freeze({runOwnerTlsCli,execution});
