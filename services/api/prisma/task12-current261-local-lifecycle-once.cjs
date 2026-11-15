#!/usr/bin/env node
'use strict';
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&
  Object.keys(require.cache).every(key=>key===__filename);
const fs=require('node:fs'),path=require('node:path'),NodeModule=require('node:module');
const nodeParentPrototype=NodeModule.prototype,nodeParentDescriptor=Object.freeze({...Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent')});
const {createHash}=require('node:crypto');
const {types}=require('node:util');

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fault=phase=>{const code='CURRENT261_LOCAL_LIFECYCLE_ONCE_'+phase;return Object.assign(new Error(code),{code});};
const need=(ok,phase)=>{if(!ok)throw fault(phase);};
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const SHA=/^[a-f0-9]{64}$/u;
const businessDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());

// Tokens are issued only by this fresh main after its genuine document ACL stage.
// The fixed binder can validate them; callers cannot register, mint or renew one.
const contractContinuities=new WeakMap();
let currentContractContinuity;
function assertCurrent261ContractBusinessContinuity(token,handle){need(arguments.length===2,'BUSINESS_CONTINUITY');return assertBusinessContinuity(token,handle,false);}
function assertCurrent261FirstLoginBusinessContinuity(token,handle){need(arguments.length===2,'BUSINESS_CONTINUITY');return assertBusinessContinuity(token,handle,true);}
function assertBusinessContinuity(token,handle,authOnly){
 const entry=token&&!types.isProxy(token)&&contractContinuities.get(token);
 need(entry&&entry.authOnly===authOnly,'BUSINESS_CONTINUITY');
 try{
  need(arguments.length===3&&FRESH&&entry&&entry===currentContractContinuity&&entry.active&&entry.handle===handle&&
   !entry.signal.aborted&&entry.acl===entry.binding.acl&&entry.build===entry.binding.build&&entry.source===entry.binding.source,'BUSINESS_CONTINUITY');
  entry.check();return true;
 }catch(error){if(entry)entry.active=false;throw error;}
}


function writeExclusive(file,bytes,onOpen){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{onOpen?.();fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

function parseArgs(args){
 const authOnly=args[0]==='--auth-only';if(authOnly)args=args.slice(1);
 let caseKey;if(args[0]==='--case'){need(!authOnly,'ARGS');caseKey=require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCase(args[1]).key;args=args.slice(2);}
 need((args.length===4||args.length===5&&args[4]==='--once')&&args[0]==='--plan'&&
  args[2]==='--expected-plan-sha256'&&SHA.test(args[3]),'ARGS');
 return {file:args[1],digest:args[3],once:args.length===5,authOnly,...(caseKey?{caseKey}:{})};
}

function checkHostEnv(){
 need(!Object.keys(process.env).some(key=>/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|COS_.*)$/u.test(key)),'HOST_ENV');
}

const reasonCodes=new Set([
 'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING','TASK12_OFFICIAL_DOCUMENT_SOURCE','TASK12_OFFICIAL_DOCUMENT_SCOPE','TASK12_OFFICIAL_DOCUMENT_DEADLINE','TASK12_OFFICIAL_DOCUMENT_READER',
 'CURRENT261_LOCAL_LIFECYCLE_HTTP','CURRENT259_LOADER_CHANGED',
 ...['HANDLE','SIGNAL','OWNER_CLOSE','OUTCOME','CLEANUP_UNKNOWN'].map(part=>'CURRENT261_FIRST_LOGIN_EXERCISE_'+part),
 ...['INPUT','HANDLE','FIXTURE','CONTINUITY','CLOSED','PENDING','OUTPUT','FACTS','BACKEND','PREIMAGE','PHASE','SCOPE'].map(part=>'CURRENT261_FIRST_LOGIN_OWNER_'+part),
 ...['INPUT','ABORTED','HTTP_STATUS','LOGIN'].map(part=>'TASK12_FIRST_LOGIN_CASE_'+part),
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

// Closed diagnostic values from the existing resource callgraph. They do
// not identify an HBA cause or grant execution; only login CONSUME may emit them.
const documentConsumeResourceReasons=new Set([
 'TASK01_RESOURCE_DOCUMENT_HBA_SCOPE','TASK01_RESOURCE_DOCUMENT_HBA_PREIMAGE',
 'TASK01_RESOURCE_DOCUMENT_HBA_READBACK','TASK01_RESOURCE_DOCUMENT_HBA_FILE',
 'TASK01_RESOURCE_DOCUMENT_HBA_RELOAD','TASK01_RESOURCE_DOCUMENT_HBA_PLAINTEXT',
 'TASK01_RESOURCE_ABORTED_OR_TIMEOUT','TASK01_RESOURCE_COMMAND_TIMEOUT','TASK01_RESOURCE_ABORTED',
 'TASK01_RESOURCE_OUTPUT_LIMIT','TASK01_RESOURCE_COMMAND_FAILED','TASK01_RESOURCE_DAEMON_CHANGED',
 'TASK01_RESOURCE_NETWORK_CHANGED','TASK01_RESOURCE_NETWORK_OTHER_OWNER','TASK01_RESOURCE_CONTAINER_CHANGED',
 'TASK01_RESOURCE_LIMITS_CHANGED','TASK01_RESOURCE_MOUNTS_CHANGED','TASK01_RESOURCE_PORT_CHANGED',
 'TASK01_RESOURCE_UNEXPECTED_IMAGE_VOLUME','TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED','TASK01_RESOURCE_SQL_INPUT_INVALID',
 'TASK01_RESOURCE_CLOSED','TASK01_RESOURCE_RECEIPT_PATH_CHANGED','TASK01_RESOURCE_METADATA_INVALID','TASK01_RESOURCE_OPERATION_FAILED'
]);
const documentScopePredicates=new Set(['ENTRY_FIRST_Q2','ENTRY_ARITY','ENTRY_CONTRACT_UNUSED','ENTRY_DOCUMENT_UNUSED','ENTRY_OPEN',
 'PROOF_OBJECT','LIVE_OPEN','LIVE_SIGNAL','PRIVATE_SCOPE','BIND_RUN','BIND_CONTAINER','BIND_SOURCE','LIFECYCLE_PLAN','ORDINARY_NAME','ROLE_COORDINATES']);
const documentScopeSubphases=new Set(['ENTRY','READ_BEFORE','READ_COMMITTED','WRITE','RELOAD','PLAINTEXT','FINAL_FILE']);
const documentPrivateScopeCodes=new Set([
  "CURRENT259_DOCUMENT_LOGIN_HANDLE", "CURRENT259_DOCUMENT_LOGIN_CONTINUITY", "CURRENT259_DOCUMENT_LOGIN_ROLE_RUNTIME",
  "CURRENT259_DOCUMENT_ACL_TRANSPORT_CONTINUITY", "CURRENT259_DOCUMENT_ROLE_PROVISION_CONTINUITY", "CURRENT259_ORDINARY_ARCHIVE_ACL_CONTINUITY",
  "CURRENT259_LOADER_CHANGED", "CURRENT259_RESOURCE_CLOSED", "CURRENT259_RESOURCE_ABORTED",
  "CURRENT259_RESOURCE_SIGNAL", "CURRENT259_RESOURCE_PRODUCER_CHANGED", "CURRENT259_RESOURCE_TOOL_CHANGED",
  "CURRENT259_RESOURCE_CHANGED", "CURRENT259_RESOURCE_IDENTITY", "CURRENT259_RESOURCE_PURPOSE",
  "CURRENT259_RESOURCE_TLS", "TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED", "TASK12_OFFICIAL_DOCUMENT_CONTINUITY",
  "TASK12_OFFICIAL_DOCUMENT_DEADLINE", "TASK12_OFFICIAL_DOCUMENT_MODULES"
]);
function safeDocumentScope(cause){
 const detail=own(cause,'documentHbaScope');
 if(!detail||typeof detail!=='object'||types.isProxy(detail))return undefined;
 const keys=Reflect.ownKeys(detail),predicate=own(detail,'predicate'),subphase=own(detail,'subphase');
 const hasPrivate=keys.length===3&&keys.includes('privateScopeCode'),privateScopeCode=hasPrivate?own(detail,'privateScopeCode'):undefined;
 if((keys.length!==2&&!hasPrivate)||!keys.includes('predicate')||!keys.includes('subphase')||
  !documentScopePredicates.has(predicate)||!documentScopeSubphases.has(subphase)||
  hasPrivate&&(predicate!=='PRIVATE_SCOPE'||!documentPrivateScopeCodes.has(privateScopeCode)))return undefined;
 return {scopePredicate:predicate,scopeSubphase:subphase,...(hasPrivate?{privateScopeCode}:undefined)};
}
const documentRelayCodes=new Set(['ABORTED','CONFIG','LIMIT','CHILD','STREAM','FRAME','HALF_CLOSE_TIMEOUT',
 'DEPLOY_DRAIN_TIMEOUT','DEPLOY_DRAIN_ACTIVE','LISTEN','CLOSED','CLEANUP'].map(part=>'CURRENT259_LOOPBACK_FORWARD_'+part));
const documentRelayCloseFields=['hostFin','stdinEnded','pgFin','stdoutEnded','cliClosed',
 'stdoutRawEnd','receiveSettled','cliExited','peerSocketDestroyed','peerEndReturned'];
const documentRelayFrameStages=new Set(['DATA_AFTER_FIN','OVERSIZED_LENGTH','TRAILING_AFTER_FIN','STDOUT_EOF_WITHOUT_FIN']);
function safeDocumentRelay(cause){
 const relayCode=own(cause,'relayCode');if(!documentRelayCodes.has(relayCode))return undefined;
 const result={relayCode};
 if(relayCode==='CURRENT259_LOOPBACK_FORWARD_FRAME'){
  const stage=own(cause,'relayFrameStage');
  if(documentRelayFrameStages.has(stage)){
   result.relayFrameStage=stage;const exit=own(cause,'relayChildExitCode');
   if(stage==='STDOUT_EOF_WITHOUT_FIN'&&Number.isInteger(exit)&&(exit===0||exit>=41&&exit<=48)){
    result.relayChildExitCode=exit;
    const sysread=own(cause,'relaySysreadExit');
    if(exit===47&&require('./task16-current259-relay-sysread.cjs').decodeRelaySysreadExit(sysread))result.relaySysreadExit=sysread;
   }
  }
 }
 if(['CURRENT259_LOOPBACK_FORWARD_FRAME','CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'].includes(relayCode)){
  const source=own(cause,'relayCloseState');
  const state=Object.fromEntries(documentRelayCloseFields.map(key=>[key,own(source,key)]));
  if(Object.values(state).every(value=>typeof value==='boolean'))result.relayCloseState=Object.freeze(state);
 }
 return result;
}
function safeDocumentLoginFailure(cause){
 const seen=new WeakSet();let documentConsume=false;
 for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause)&&!seen.has(cause);i++,cause=own(cause,'cause')){
  seen.add(cause);const code=own(cause,'code');
  if(code==='CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED'&&own(cause,'phase')==='CONSUME')documentConsume=true;
  if(documentConsume&&documentConsumeResourceReasons.has(code))return Object.freeze({phase:'CONSUME',resourceCode:code,
   ...(code==='TASK01_RESOURCE_DOCUMENT_HBA_SCOPE'?safeDocumentScope(cause):undefined),
   ...(code==='TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'?safeDocumentRelay(cause):undefined)});
 }
 return undefined;
}
const documentRoleStages=new Set(['ENTRY','SEED_BEFORE','SEED_WRITE','SEED_COMMITTED','ORIGINALS',
 'ROLE_CONNECT','ROLE_OBSERVE','OWNER_BEFORE','APPLICATION','ROLE_POSTCHECK','OWNER_AFTER']);
const documentRoleFields=['subphase','lastGuardMs','maxGuardMs','boundedTimeout','disconnectRejected','drainRejected'];
function safeDocumentRoleFailure(cause){
 const seen=new WeakSet();
 for(let i=0;i<6&&cause&&typeof cause==='object'&&!types.isProxy(cause)&&!seen.has(cause);i++,cause=own(cause,'cause')){
  seen.add(cause);
  if(own(cause,'code')!=='CURRENT259_DOCUMENT_LOGIN_CONSUME_FAILED'||own(cause,'phase')!=='CONSUME')continue;
  const detail=own(cause,'documentRoleFailure');
  if(!detail||typeof detail!=='object'||types.isProxy(detail))continue;
  const keys=Reflect.ownKeys(detail);if(keys.length!==documentRoleFields.length||!documentRoleFields.every(key=>keys.includes(key)))continue;
  const result=Object.fromEntries(documentRoleFields.map(key=>[key,own(detail,key)]));
  if(documentRoleStages.has(result.subphase)&&[result.lastGuardMs,result.maxGuardMs].every(ms=>Number.isSafeInteger(ms)&&ms>=0&&ms<=3600000)&&
   result.maxGuardMs>=result.lastGuardMs&&[result.boundedTimeout,result.disconnectRejected,result.drainRejected].every(value=>typeof value==='boolean'))return Object.freeze(result);
 }
 return undefined;
}
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

// Fixed diagnostic receiver only. It never reads the Error's public fields,
// grants a role, changes cleanup, or substitutes a failed business cause.
function captureAuthRoleFailureProjector(namespace,read,checkFile){
 const data=(v,k)=>{need(v&&!types.isProxy(v),'DEPENDENCIES');const d=Object.getOwnPropertyDescriptor(v,k);need(d&&Object.hasOwn(d,'value'),'DEPENDENCIES');return Object.freeze({...d});};
 const same=(v,k,d)=>{const now=data(v,k);need(['value','writable','enumerable','configurable'].every(f=>now[f]===d[f]),'DEPENDENCIES');return now.value;};
 const cacheSlot=data(require,'cache'),cache=cacheSlot.value,file=path.join(path.dirname(__filename),'task16-current259-role-provision.cjs'),slot=data(cache,file),role=slot.value;
 const metadata=mod=>{const filename=data(mod,'filename'),exports=data(mod,'exports');need(typeof filename.value==='string'&&path.isAbsolute(filename.value),'DEPENDENCIES');const cacheDescriptor=data(cache,filename.value);need(cacheDescriptor.value===mod&&!types.isProxy(exports.value),'DEPENDENCIES');return{mod,filename,exports,cacheDescriptor};};
 const parentOf=mod=>{need(!types.isProxy(mod)&&Object.getPrototypeOf(mod)===nodeParentPrototype&&!Object.getOwnPropertyDescriptor(mod,'parent'),'DEPENDENCIES');const now=Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent');need(now&&['get','set','enumerable','configurable'].every(k=>now[k]===nodeParentDescriptor[k])&&typeof nodeParentDescriptor.get==='function','DEPENDENCIES');return Reflect.apply(nodeParentDescriptor.get,mod,[]);};
 const roleMeta=metadata(role),parent=parentOf(role),parentMeta=metadata(parent);
 need(roleMeta.filename.value===file&&roleMeta.exports.value===namespace&&Object.isFrozen(namespace)&&own(role,'loaded')===true&&
  [__filename,path.join(path.dirname(__filename),'task16-current259-archive-install.cjs')].includes(parentMeta.filename.value),'DEPENDENCIES');
 const children=data(role,'children'),rows=children.value;need(Array.isArray(rows)&&!types.isProxy(rows),'DEPENDENCIES');
 const edges=Array.from({length:rows.length},(_,i)=>({slot:data(rows,String(i)),meta:metadata(data(rows,String(i)).value)}));
 const mainChildren=data(module,'children');need(Array.isArray(mainChildren.value)&&!types.isProxy(mainChildren.value),'DEPENDENCIES');
 const projector=data(namespace,'describeCurrent261AuthOnlyRoleFailure'),arity=data(projector.value,'length');need(typeof projector.value==='function'&&arity.value===1,'DEPENDENCIES');
 const material=read(file,{maxBytes:512*1024,code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_ROLE_PROJECTOR_SOURCE'});need(SHA.test(material.sha256)&&material.identity,'DEPENDENCIES');
 const verifyMeta=row=>{same(cache,row.filename.value,row.cacheDescriptor);same(row.mod,'filename',row.filename);same(row.mod,'exports',row.exports);};
 const verify=()=>{
  same(require,'cache',cacheSlot);verifyMeta(roleMeta);verifyMeta(parentMeta);need(parentOf(role)===parent,'DEPENDENCIES');same(role,'children',children);
  need(own(role,'loaded')===true&&rows.length===edges.length,'DEPENDENCIES');
  for(let i=0;i<edges.length;i++){same(rows,String(i),edges[i].slot);verifyMeta(edges[i].meta);}
  const mainRows=same(module,'children',mainChildren);let count=0;for(let i=0;i<mainRows.length;i++)if(data(mainRows,String(i)).value===role)count++;
  need(count===1,'DEPENDENCIES');same(namespace,'describeCurrent261AuthOnlyRoleFailure',projector);same(projector.value,'length',arity);checkFile(file,material.identity);
 };
 verify();
 const unknown=()=>Object.freeze({phase:'UNKNOWN',resourceCleanup:Object.freeze({status:'UNKNOWN'})});
 return error=>{try{
  verify();const result=projector.value(error);if(!result||types.isProxy(result)||!Object.isFrozen(result)||Reflect.ownKeys(result).length!==2)return unknown();
  const phase=own(result,'phase'),cleanup=own(result,'resourceCleanup');
  if(!['BEFORE','INSTALL','COMMITTED_READBACK','FINAL_CHECK'].includes(phase)||!cleanup||types.isProxy(cleanup)||!Object.isFrozen(cleanup)||Reflect.ownKeys(cleanup).length!==1||!['COMPLETED','UNKNOWN'].includes(own(cleanup,'status')))return unknown();
  return Object.freeze({phase,resourceCleanup:Object.freeze({status:own(cleanup,'status')})});
 }catch{return unknown();}};
}

function safeRoleDrainDiagnostic(result){
 const unknown=()=>Object.freeze({status:'UNKNOWN'});
 if(!result||typeof result!=='object'||types.isProxy(result)||!Object.isFrozen(result))return unknown();
 const keys=Reflect.ownKeys(result),status=own(result,'status');
 if(status==='UNKNOWN')return keys.length===1?Object.freeze({status:'UNKNOWN'}):unknown();
 const required=['status','resourceCode','relayCode'],optional=['relayFrameStage','relayChildExitCode','relaySysreadExit','relayCloseState'];
 if(status!=='OBSERVED'||!required.every(k=>keys.includes(k))||keys.some(k=>!required.includes(k)&&!optional.includes(k))||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(result,k),'value'))||own(result,'resourceCode')!=='TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED')return unknown();
 const code=own(result,'relayCode');if(!documentRelayCodes.has(code))return unknown();
 const value={status:'OBSERVED',resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:code};
 if(keys.includes('relayFrameStage')){const stage=own(result,'relayFrameStage');if(code!=='CURRENT259_LOOPBACK_FORWARD_FRAME'||!documentRelayFrameStages.has(stage))return unknown();value.relayFrameStage=stage;}
 if(keys.includes('relayChildExitCode')){const exit=own(result,'relayChildExitCode');if(value.relayFrameStage!=='STDOUT_EOF_WITHOUT_FIN'||!Number.isInteger(exit)||!(exit===0||exit>=41&&exit<=48))return unknown();value.relayChildExitCode=exit;}
 if(keys.includes('relaySysreadExit')){const exit=own(result,'relaySysreadExit');if(value.relayChildExitCode!==47||!Number.isInteger(exit)||exit<70||exit>75)return unknown();value.relaySysreadExit=exit;}
 if(keys.includes('relayCloseState')){
  const state=own(result,'relayCloseState');if(!['CURRENT259_LOOPBACK_FORWARD_FRAME','CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'].includes(code)||!state||typeof state!=='object'||types.isProxy(state)||!Object.isFrozen(state))return unknown();
  const stateKeys=Reflect.ownKeys(state);if(stateKeys.length!==documentRelayCloseFields.length||!documentRelayCloseFields.every(k=>stateKeys.includes(k)&&typeof own(state,k)==='boolean'))return unknown();
  value.relayCloseState=Object.freeze(Object.fromEntries(documentRelayCloseFields.map(k=>[k,own(state,k)])));
 }
 return Object.freeze(value);
}

function captureAuthDrainFailureProjector(namespace,read,checkFile){
 const data=(v,k)=>{need(v&&!types.isProxy(v),'DEPENDENCIES');const d=Object.getOwnPropertyDescriptor(v,k);need(d&&Object.hasOwn(d,'value'),'DEPENDENCIES');return Object.freeze({...d});};
 const same=(v,k,d)=>{const now=data(v,k);need(['value','writable','enumerable','configurable'].every(f=>now[f]===d[f]),'DEPENDENCIES');return now.value;};
 const cacheSlot=data(require,'cache'),cache=cacheSlot.value,file=path.join(path.dirname(__filename),'task12-current259-document-login.cjs'),slot=data(cache,file),role=slot.value;
 const metadata=mod=>{const filename=data(mod,'filename'),exports=data(mod,'exports');need(typeof filename.value==='string'&&path.isAbsolute(filename.value),'DEPENDENCIES');const cacheDescriptor=data(cache,filename.value);need(cacheDescriptor.value===mod&&!types.isProxy(exports.value),'DEPENDENCIES');return{mod,filename,exports,cacheDescriptor};};
 const parentOf=mod=>{need(!types.isProxy(mod)&&Object.getPrototypeOf(mod)===nodeParentPrototype&&!Object.getOwnPropertyDescriptor(mod,'parent'),'DEPENDENCIES');const now=Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent');need(now&&['get','set','enumerable','configurable'].every(k=>now[k]===nodeParentDescriptor[k])&&typeof nodeParentDescriptor.get==='function','DEPENDENCIES');return Reflect.apply(nodeParentDescriptor.get,mod,[]);};
 const roleMeta=metadata(role),parent=parentOf(role),parentMeta=metadata(parent);
 need(roleMeta.filename.value===file&&roleMeta.exports.value===namespace&&Object.isFrozen(namespace)&&own(role,'loaded')===true&&
  [__filename].includes(parentMeta.filename.value),'DEPENDENCIES');
 const children=data(role,'children'),rows=children.value;need(Array.isArray(rows)&&!types.isProxy(rows),'DEPENDENCIES');
 const edges=Array.from({length:rows.length},(_,i)=>({slot:data(rows,String(i)),meta:metadata(data(rows,String(i)).value)}));
 const lazyNames=['task12-official-document-profiles.cjs','task12-current259-document-application.cjs','task12-current261-first-login-exercise.cjs','task16-current259-relay-sysread.cjs'];
 const lazyMaterials=new Map(lazyNames.map(name=>{const file=path.join(path.dirname(__filename),name);const material=read(file,{maxBytes:512*1024,code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_DRAIN_PROJECTOR_SOURCE'});need(SHA.test(material.sha256)&&material.identity,'DEPENDENCIES');return[file,material];}));
 const helperFile=path.join(path.dirname(__filename),'task16-current259-relay-sysread.cjs'),helper=metadata(data(cache,helperFile).value),decoder=data(helper.exports.value,'decodeRelaySysreadExit'),decoderArity=data(decoder.value,'length');need(typeof decoder.value==='function'&&decoderArity.value===1&&own(helper.mod,'loaded')===true,'DEPENDENCIES');
 const mainChildren=data(module,'children');need(Array.isArray(mainChildren.value)&&!types.isProxy(mainChildren.value),'DEPENDENCIES');
 const projector=data(namespace,'describeCurrent261DocumentLoginDrainFailure'),arity=data(projector.value,'length');need(typeof projector.value==='function'&&arity.value===1,'DEPENDENCIES');
 const provenance=data(namespace,'describeCurrent261DocumentLoginDrainProvenance'),provenanceArity=data(provenance.value,'length');need(typeof provenance.value==='function'&&provenanceArity.value===0,'DEPENDENCIES');
 const material=read(file,{maxBytes:512*1024,code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_DRAIN_PROJECTOR_SOURCE'});need(SHA.test(material.sha256)&&material.identity,'DEPENDENCIES');
 const verifyMeta=row=>{same(cache,row.filename.value,row.cacheDescriptor);same(row.mod,'filename',row.filename);same(row.mod,'exports',row.exports);};
 const verify=()=>{
  same(require,'cache',cacheSlot);verifyMeta(roleMeta);verifyMeta(parentMeta);need(parentOf(role)===parent,'DEPENDENCIES');same(role,'children',children);
  need(own(role,'loaded')===true&&rows.length>=edges.length&&rows.length<=edges.length+lazyNames.length,'DEPENDENCIES');
  for(let i=0;i<edges.length;i++){same(rows,String(i),edges[i].slot);verifyMeta(edges[i].meta);}
  same(namespace,'describeCurrent261DocumentLoginDrainProvenance',provenance);same(provenance.value,'length',provenanceArity);
  const records=provenance.value();need(Array.isArray(records)&&!types.isProxy(records)&&Object.isFrozen(records)&&records.length<=lazyNames.length,'DEPENDENCIES');
  const pins=new Map(),recordKeys=['file','cache','module','filenameDescriptor','exportsDescriptor','cacheDescriptor','children','childIndex','childDescriptor','sourceIdentity','sourceSha256'];
  const fixedDescriptor=(record,key)=>{const descriptor=data(record,key).value;need(descriptor&&!types.isProxy(descriptor)&&Object.isFrozen(descriptor)&&Reflect.ownKeys(descriptor).length===4,'DEPENDENCIES');return Object.freeze(Object.fromEntries(['value','writable','enumerable','configurable'].map(k=>[k,data(descriptor,k).value])));};
  for(let i=0;i<records.length;i++){
   const record=data(records,String(i)).value;need(record&&!types.isProxy(record)&&Object.isFrozen(record)&&Reflect.ownKeys(record).length===recordKeys.length&&recordKeys.every(k=>Object.getOwnPropertyDescriptor(record,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(record,k),'value')),'DEPENDENCIES');
   const name=own(record,'file'),index=own(record,'childIndex');need(lazyMaterials.has(name)&&!pins.has(name)&&own(record,'cache')===cache&&own(record,'children')===rows&&Number.isSafeInteger(index)&&index>=0&&index<rows.length&&own(record,'sourceSha256')===lazyMaterials.get(name).sha256,'DEPENDENCIES');
   const mod=own(record,'module');same(cache,name,fixedDescriptor(record,'cacheDescriptor'));same(mod,'filename',fixedDescriptor(record,'filenameDescriptor'));same(mod,'exports',fixedDescriptor(record,'exportsDescriptor'));need(own(mod,'loaded')===true&&own(record,'module')===same(rows,String(index),fixedDescriptor(record,'childDescriptor')),'DEPENDENCIES');
   checkFile(name,lazyMaterials.get(name).identity);checkFile(name,own(record,'sourceIdentity'));pins.set(name,{mod,index});
  }
  const filenames=new Set(edges.map(row=>row.meta.filename.value));
  for(let i=edges.length;i<rows.length;i++){
   const edge=metadata(data(rows,String(i)).value),name=edge.filename.value,pinned=pins.get(name);need(pinned&&pinned.mod===edge.mod&&pinned.index===i&&!filenames.has(name),'DEPENDENCIES');filenames.add(name);
  }
  verifyMeta(helper);same(helper.exports.value,'decodeRelaySysreadExit',decoder);same(decoder.value,'length',decoderArity);need(own(helper.mod,'loaded')===true,'DEPENDENCIES');checkFile(helperFile,lazyMaterials.get(helperFile).identity);
  const mainRows=same(module,'children',mainChildren);let count=0;for(let i=0;i<mainRows.length;i++)if(data(mainRows,String(i)).value===role)count++;
  need(count===1,'DEPENDENCIES');same(namespace,'describeCurrent261DocumentLoginDrainFailure',projector);same(projector.value,'length',arity);checkFile(file,material.identity);
 };
 verify();
 return error=>{try{verify();const result=projector.value(error);verify();return safeRoleDrainDiagnostic(result);}catch{return Object.freeze({status:'UNKNOWN'});}};
}

function safeConsumerFacts(value){
 const unknown=()=>Object.freeze({status:'UNKNOWN'});
 if(!value||typeof value!=='object'||types.isProxy(value)||!Object.isFrozen(value))return unknown();
 const keys=Reflect.ownKeys(value),status=own(value,'status');if(status==='UNKNOWN')return unknown();
 const fields=['status','httpStatus','ownerClosed','authObserved','nativeAdmission','cleanupAccepted','full394Accepted'];
 if(keys.length!==fields.length||!fields.every(k=>keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'))||status!=='OBSERVED'||own(value,'httpStatus')!==201||own(value,'ownerClosed')!==true||own(value,'authObserved')!==true||['nativeAdmission','cleanupAccepted','full394Accepted'].some(k=>own(value,k)!==false))return unknown();
 return Object.freeze(Object.fromEntries(fields.map(k=>[k,own(value,k)])));
}
// The observer's body uses only its same-module private WeakMap. It never loads
// or visits the exercise's dynamic producer dependencies.
function captureAuthConsumerObservation(namespace,read,checkFile){
 const data=(v,k)=>{need(v&&!types.isProxy(v),'DEPENDENCIES');const d=Object.getOwnPropertyDescriptor(v,k);need(d&&Object.hasOwn(d,'value'),'DEPENDENCIES');return Object.freeze({...d});};
 const same=(v,k,d)=>{const now=data(v,k);need(['value','writable','enumerable','configurable'].every(f=>now[f]===d[f]),'DEPENDENCIES');return now.value;};
 const cacheSlot=data(require,'cache'),cache=cacheSlot.value,file=path.join(path.dirname(__filename),'task12-current261-first-login-exercise.cjs'),slot=data(cache,file),registered=slot.value;
 const filename=data(registered,'filename'),exports=data(registered,'exports'),children=data(registered,'children'),mainChildren=data(module,'children');
 need(filename.value===file&&exports.value===namespace&&!types.isProxy(namespace)&&Object.isFrozen(namespace)&&Array.isArray(children.value)&&!types.isProxy(children.value)&&Array.isArray(mainChildren.value)&&!types.isProxy(mainChildren.value),'DEPENDENCIES');
 const parentOf=()=>{need(!types.isProxy(registered)&&Object.getPrototypeOf(registered)===nodeParentPrototype&&!Object.getOwnPropertyDescriptor(registered,'parent'),'DEPENDENCIES');const current=Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent');need(current&&['get','set','enumerable','configurable'].every(k=>current[k]===nodeParentDescriptor[k]),'DEPENDENCIES');return Reflect.apply(nodeParentDescriptor.get,registered,[]);};
 const observer=data(namespace,'describeCurrent261FirstLoginReturnedOutcome'),consume=data(namespace,'projectCurrent261FirstLoginOutcome'),observerArity=data(observer.value,'length'),consumeArity=data(consume.value,'length');need(typeof observer.value==='function'&&typeof consume.value==='function'&&observerArity.value===1&&consumeArity.value===1,'DEPENDENCIES');
 const material=read(file,{maxBytes:512*1024,code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_CONSUMER_OBSERVER_SOURCE'});need(SHA.test(material.sha256)&&material.identity,'DEPENDENCIES');
 const verify=()=>{
  same(require,'cache',cacheSlot);same(cache,file,slot);same(registered,'filename',filename);same(registered,'exports',exports);same(registered,'children',children);need(own(registered,'loaded')===true&&parentOf()===module,'DEPENDENCIES');
  const rows=same(module,'children',mainChildren);let count=0;for(let i=0;i<rows.length;i++)if(data(rows,String(i)).value===registered)count++;need(count===1,'DEPENDENCIES');
  same(namespace,'describeCurrent261FirstLoginReturnedOutcome',observer);same(namespace,'projectCurrent261FirstLoginOutcome',consume);same(observer.value,'length',observerArity);same(consume.value,'length',consumeArity);checkFile(file,material.identity);
 };
 verify();return outcome=>{try{verify();const facts=observer.value(outcome);verify();return safeConsumerFacts(facts);}catch{return Object.freeze({status:'UNKNOWN'});}};
}

async function main(){
 let authOnly=false,attempted=false,resourceEntered=false,scopeEntered=false,phase='PREFLIGHT',cleanup='NOT_STARTED';
 let recordConsumerObservation,projectConsumerObservation,consumerObservation='UNKNOWN';
 let rememberControllerFirstFailure,recordFirstFailure,recordDrainDiagnostic,projectDrainFailure,diagnosticObservation='UNKNOWN',firstFailureObservation='UNKNOWN',firstFailureEvidenceWriteFailed=null;
 let writeReceipt,technicalFailure,failureStage,sevenFailure,firstFailure,receivedSignal=null,signalEvidenceWriteFailed=false,signalsArmed=false,recordSignal,describeOwnedBudget,budgetObservation;
 const observeBudget=value=>{try{return typeof describeOwnedBudget==='function'?describeOwnedBudget(value):undefined;}catch{return undefined;}};
 const controller=new AbortController();
 const onSignal=name=>{receivedSignal??=name;try{recordSignal?.(name);}catch{signalEvidenceWriteFailed=true;}controller.abort();};
 const onSigint=()=>onSignal('SIGINT'),onSigterm=()=>onSignal('SIGTERM');
 try{
  need(FRESH,'FRESH');
  const args=parseArgs(process.argv.slice(2));authOnly=args.authOnly;
  const {captureCurrent261ContractBusinessIssuer,captureCurrent261FirstLoginBusinessIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
  (authOnly?captureCurrent261FirstLoginBusinessIssuer:captureCurrent261ContractBusinessIssuer)();
  const {verifyCurrent261LocalLifecyclePlan,verifyCurrent261FirstLoginPlan,verifyCurrent261LifecycleCasePlan}=require('../../../scripts/prepare-task12-current261-local-lifecycle.cjs');
  const checked=(args.caseKey?verifyCurrent261LifecycleCasePlan:authOnly?verifyCurrent261FirstLoginPlan:verifyCurrent261LocalLifecyclePlan)(args.file,args.digest);
  const {plan}=checked,runtimeSha256=plan.runtime.sha256;
  need(args.caseKey===plan.case.key,'RUNTIME');
  need(plan.purpose===(authOnly?'CURRENT261_FIRST_LOGIN_AUTH_ONLY_DIAGNOSTIC':'CURRENT261_GENERATED_LIFECYCLE_LOCAL'),'RUNTIME');
  need(checked.sha256===args.digest&&SHA.test(runtimeSha256)&&checked.runtime&&typeof checked.runtime==='object','RUNTIME');
  if(!args.once)return {status:authOnly?'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_HOLD':'CURRENT261_LOCAL_LIFECYCLE_HOLD',planSha256:checked.sha256,runtimeSha256,...(authOnly?{executionPurpose:'AUTH_ONLY_DIAGNOSTIC'}:{})};
  // Only an original verified, initially unused run root can receive this
  // fixed evidence file. It grants no authority and never touches an old run.
  try{
   const root=plan.run.root,identity=fs.lstatSync(root,{bigint:true});
   need(fs.realpathSync(root)===root&&identity.isDirectory()&&!identity.isSymbolicLink()&&identity.uid===BigInt(require('node:process').getuid())&&(identity.mode&0o7777n)===0o700n&&fs.readdirSync(root).length===0,'FIRST_FAILURE');
   const coordinates=Object.freeze({planSha256:checked.sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id,runtimeSha256});
   recordFirstFailure=()=>{
    const now=fs.lstatSync(root,{bigint:true});
    need(fs.realpathSync(root)===root&&!now.isSymbolicLink()&&['dev','ino','mode','uid','gid'].every(k=>now[k]===identity[k]),'FIRST_FAILURE');
    writeExclusive(path.join(root,'first-failure.json'),Buffer.from(JSON.stringify({status:'FIRST_FAILURE_OBSERVED',observationBoundary:'CONTROLLER_FIRST_OBSERVED',purpose:plan.purpose,...coordinates,failurePhase:firstFailure.phase,reason:safeReason(firstFailure.cause)??'UNCLASSIFIED'})+'\n'));
   };
   recordDrainDiagnostic=diagnostic=>{
    const now=fs.lstatSync(root,{bigint:true});need(fs.realpathSync(root)===root&&!now.isSymbolicLink()&&['dev','ino','mode','uid','gid'].every(k=>now[k]===identity[k]),'FIRST_FAILURE');
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,status:diagnostic.status,observationBoundary:'CONTROLLER_OBSERVED_PRODUCER_DRAIN_FAILURE',purpose:plan.purpose,...coordinates,failurePhase:firstFailure.phase,diagnostic})+'\n');
    need(bytes.length<=4096,'FIRST_FAILURE');writeExclusive(path.join(root,'first-role-drain-diagnostic.json'),bytes);
   };
   recordConsumerObservation=facts=>{
    const now=fs.lstatSync(root,{bigint:true});need(fs.realpathSync(root)===root&&!now.isSymbolicLink()&&['dev','ino','mode','uid','gid'].every(k=>now[k]===identity[k]),'FIRST_FAILURE');
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,status:facts.status,observationBoundary:'CONTROLLER_CONSUMER_RETURNED',purpose:plan.purpose,...coordinates,phase:'CONSUMER_RETURNED_BEFORE_ROLE_POSTCHECK_AND_DRAIN',facts})+'\n');
    need(bytes.length<=4096,'FIRST_FAILURE');writeExclusive(path.join(root,'first-login-consumer-return.json'),bytes);
   };
  }catch{/* No stable owned empty root: persistence stays UNKNOWN. */}
  const rememberFirstFailure=(cause,observedPhase)=>{
   if(firstFailure)return false;
   firstFailure={cause,phase:observedPhase};
   if(recordFirstFailure){try{recordFirstFailure();firstFailureObservation='DURABLE_EVENT_RECORDED';firstFailureEvidenceWriteFailed=false;}catch{firstFailureEvidenceWriteFailed=true;}}
   if(authOnly&&observedPhase==='APPLICATION'&&firstFailureObservation==='DURABLE_EVENT_RECORDED'&&recordDrainDiagnostic){
    try{const diagnostic=projectDrainFailure?projectDrainFailure(cause):Object.freeze({status:'UNKNOWN'});recordDrainDiagnostic(diagnostic);diagnosticObservation=diagnostic.status==='OBSERVED'?'DURABLE_OBSERVED':'DURABLE_UNKNOWN';}catch{/* Diagnostic failure never replaces the latched original cause. */}
   }
   return true;
  };
  // This closure is available to the outer catch even for initialization or
  // RESOURCE failures that have no stage catch.
  rememberControllerFirstFailure=rememberFirstFailure;
  checkHostEnv();
  need(businessDay()===plan.case.businessDate,'TIME');
  checked.check();

  const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
  const {createCurrent259TechnicalMigration,createCurrent261AuthOnlyDiagnosticBootstrap,describeCurrent259TechnicalFailure}=require('./local-staged-current259-profile.cjs');
  const {withCurrent259FirstQ2LoopbackResource,claimCurrent259TechnicalResource,describeCurrent259OwnedResourceBudget}=require('./task16-current259-owned-resource.cjs');
  describeOwnedBudget=describeCurrent259OwnedResourceBudget;
  const roleNamespace=require('./task16-current259-role-provision.cjs');
  const {provisionCurrent259Roles,provisionCurrent261AuthOnlyDiagnosticRoles}=roleNamespace;
  const projectAuthRoleFailure=authOnly?captureAuthRoleFailureProjector(roleNamespace,read,checkCurrent259FileIdentity):undefined;
  const {installCurrent259ArchiveAuthoritiesWithRegisteredFileSource,installCurrent261AuthOnlyDiagnosticArchive}=require('./task16-current259-archive-install.cjs');
  const {installCurrent261GeneratedLifecycleOrdinaryAcl,installCurrent261AuthOnlyDiagnosticOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
  const {provisionCurrent261GeneratedLifecycleDocumentRoles,provisionCurrent261AuthOnlyDiagnosticDocumentRoles}=require('./task12-current259-document-role-provision.cjs');
  const {installCurrent261GeneratedLifecycleDocumentAcl,installCurrent261AuthOnlyDiagnosticDocumentAcl,describeCurrent261DocumentAclFailure}=require('./task12-current259-document-acl-transport.cjs');
  const {withOfficialTask12DocumentRuntime}=require('./task12-current259-generated-document-runtime.cjs');
  const loginNamespace=require('./task12-current259-document-login.cjs');
  const {withCurrent261LocalLifecyclePublicApplication,withCurrent261FirstLoginPublicApplication}=loginNamespace;
  const {projectCurrent261LocalLifecycleOutcome}=require('./task12-current261-local-lifecycle-exercise.cjs');
  const firstLoginNamespace=authOnly?require('./task12-current261-first-login-exercise.cjs'):undefined;
  const {projectCurrent261FirstLoginOutcome,describeCurrent261FirstLoginOwnerObservation}=firstLoginNamespace??{};
  if(authOnly)try{projectConsumerObservation=captureAuthConsumerObservation(firstLoginNamespace,read,checkCurrent259FileIdentity);}catch{/* Optional observer initialization stays UNKNOWN; mandatory assembly remains outside. */}
  const {describeCurrent261LocalLifecycleHttpFailure}=require('./task12-current261-local-lifecycle-http.cjs');
  projectDrainFailure=authOnly?captureAuthDrainFailureProjector(loginNamespace,read,checkCurrent259FileIdentity):undefined;
  const migration=authOnly?createCurrent261AuthOnlyDiagnosticBootstrap:createCurrent259TechnicalMigration,rolesProducer=authOnly?provisionCurrent261AuthOnlyDiagnosticRoles:provisionCurrent259Roles,archiveProducer=authOnly?installCurrent261AuthOnlyDiagnosticArchive:installCurrent259ArchiveAuthoritiesWithRegisteredFileSource,ordinaryProducer=authOnly?installCurrent261AuthOnlyDiagnosticOrdinaryAcl:installCurrent261GeneratedLifecycleOrdinaryAcl,documentRolesProducer=authOnly?provisionCurrent261AuthOnlyDiagnosticDocumentRoles:provisionCurrent261GeneratedLifecycleDocumentRoles,aclProducer=authOnly?installCurrent261AuthOnlyDiagnosticDocumentAcl:installCurrent261GeneratedLifecycleDocumentAcl,application=authOnly?withCurrent261FirstLoginPublicApplication:withCurrent261LocalLifecyclePublicApplication,projectOutcome=authOnly?projectCurrent261FirstLoginOutcome:projectCurrent261LocalLifecycleOutcome;
  need([migration,rolesProducer,archiveProducer,ordinaryProducer,documentRolesProducer,aclProducer,application,projectOutcome,...(authOnly?[describeCurrent261FirstLoginOwnerObservation]:[]),read,withCurrent259FirstQ2LoopbackResource,describeCurrent259TechnicalFailure,
   installCurrent259ArchiveAuthoritiesWithRegisteredFileSource,installCurrent261GeneratedLifecycleOrdinaryAcl,
   provisionCurrent261GeneratedLifecycleDocumentRoles,installCurrent261GeneratedLifecycleDocumentAcl,withOfficialTask12DocumentRuntime,
   withCurrent261LocalLifecyclePublicApplication,projectCurrent261LocalLifecycleOutcome,describeCurrent261LocalLifecycleHttpFailure,describeCurrent261DocumentAclFailure]
   .every(fn=>typeof fn==='function'),'DEPENDENCIES');

  recordSignal=name=>writeExclusive(path.join(plan.run.root,'received-'+name+'.json'),Buffer.from(JSON.stringify({status:'RECEIVED_PROCESS_SIGNAL',receivedSignal:name,planSha256:checked.sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id,runtimeSha256})+'\n'));
  process.once('SIGINT',onSigint);process.once('SIGTERM',onSigterm);signalsArmed=true;
  phase='ATTEMPT';
  need(!controller.signal.aborted&&fs.readdirSync(plan.run.root).length===0,'ATTEMPT_USED');
  const coordinates={planSha256:checked.sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id,runtimeSha256};
  const marker=Buffer.from(JSON.stringify({status:'CONSUMED',...coordinates})+'\n');
  writeReceipt=(status,proof)=>{
   const receipt={status,phase,...coordinates,firstFailureObservation,firstFailureEvidenceWriteFailed,receivedSignal,signalEvidenceWriteFailed,signalObservation:signalsArmed?'HANDLERS_INSTALLED':'UNKNOWN',...(budgetObservation??{budgetReason:null,cleanupBudgetReason:null,budgetEvidenceWriteFailed:null,budgetObservation:'UNKNOWN'}),...(authOnly?{executionPurpose:'AUTH_ONLY_DIAGNOSTIC',diagnosticObservation,consumerObservation}:{}),relationship:'inside',contractTypeKey:'material_purchase',operating:false,storage:'LOCAL_ONLY',cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false,cleanup,...proof};
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

  const inputFiles=[args.file,plan.runtime.file,plan.run.attemptFile];
  const inputSnapshots=inputFiles.map(file=>{
   const stat=fs.lstatSync(file,{bigint:true});
   return {file,identity:Object.freeze(Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]))) };
  });
  // Directory timestamps legitimately change as this run writes receipts. Preserve
  // canonical ownership/mode and dev+ino; regular inputs retain ns mtime+ctime.
  const parentSnapshots=new Map();
  for(const file of inputFiles)for(let dir=path.dirname(file);;dir=path.dirname(dir)){
   const stat=fs.lstatSync(dir,{bigint:true});need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(dir)===dir,'CONTINUITY');
   parentSnapshots.set(dir,Object.freeze(Object.fromEntries(['dev','ino','mode','uid','gid'].map(key=>[key,String(stat[key])]))));
   if(dir===path.dirname(dir))break;
  }
  const checkInputs=()=>{
   need(!controller.signal.aborted&&businessDay()===plan.case.businessDate,'CONTINUITY');
   for(const row of inputSnapshots)checkCurrent259FileIdentity(row.file,row.identity);
   for(const [dir,identity]of parentSnapshots){const stat=fs.lstatSync(dir,{bigint:true});
    need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(dir)===dir&&Object.keys(identity).every(key=>String(stat[key])===identity[key]),'CONTINUITY');
   }
   need(read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,expectedIdentity:attempt.identity,
    code:'CURRENT261_LOCAL_LIFECYCLE_ONCE_ATTEMPT'}).sha256===attempt.sha256,'ATTEMPT');
  };

  const stage=async(name,work)=>{
   phase=name;
   let value;
   try{check();value=await work();check();}
   catch(cause){
    rememberFirstFailure(cause,name);
    if(Object.is(firstFailure.cause,cause)&&firstFailure.phase===name){
     // Publication precedes optional diagnostics and controller unwind. A
     // producer may already have performed its own cleanup before throwing.
     try{firstFailure.httpFailure=describeCurrent261LocalLifecycleHttpFailure(cause);}catch{}
     try{firstFailure.documentAclFailure=name==='DOCUMENT_ACL'?describeCurrent261DocumentAclFailure(cause):undefined;}catch{}
     try{firstFailure.documentLoginFailure=name==='APPLICATION'?safeDocumentLoginFailure(cause):undefined;}catch{}
     try{firstFailure.documentRoleFailure=name==='APPLICATION'?safeDocumentRoleFailure(cause):undefined;}catch{}
     try{firstFailure.authOwnerObservation=authOnly&&name==='APPLICATION'?describeCurrent261FirstLoginOwnerObservation(cause):undefined;}catch{}
     try{firstFailure.authRoleFailure=authOnly&&name==='ROLES'?projectAuthRoleFailure(cause):undefined;}catch{}
    }
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
    const technical=await stage('MIGRATE',()=>migration(handle,controller.signal).migrate());
    const roles=await stage('ROLES',()=>rolesProducer(technical,handle));
    const archive=await stage('ARCHIVE',()=>archiveProducer(roles,handle));
    const ordinary=await stage('DOCUMENT_ORDINARY_ACL',()=>ordinaryProducer(archive,handle));
    const documentRoles=await stage('DOCUMENT_ROLES',()=>documentRolesProducer(ordinary,handle));
    const acl=await stage('DOCUMENT_ACL',()=>aclProducer(documentRoles,handle));
    let runtimeEntered=false;
    const result=await stage('RUNTIME',()=>withOfficialTask12DocumentRuntime(checked.runtime,plan.runtime.runRoot,async()=>{
     need(!runtimeEntered,'RUNTIME');runtimeEntered=true;
     const projected=await stage('APPLICATION',async()=>{
      let invoked=false;
      const view=claimCurrent259TechnicalResource(handle);
      const token=Object.freeze({}),binding=Object.freeze({acl,build:checked.buildHandle,source:plan.source});
      const entry={active:true,authOnly,handle,signal:controller.signal,acl,build:checked.buildHandle,source:plan.source,binding,
       check:()=>{need(phase==='APPLICATION'&&view.source.candidateSha===plan.source.candidateSha,'BUSINESS_CONTINUITY');checkInputs();}};
      need(!currentContractContinuity,'BUSINESS_CONTINUITY');
      contractContinuities.set(token,entry);currentContractContinuity=entry;
      let app;
      try{app=await application(acl,handle,plan.case.id,controller.signal,outcome=>{
       need(!invoked,'RESULT');invoked=true;check();
       if(authOnly&&recordConsumerObservation){try{const facts=projectConsumerObservation?projectConsumerObservation(outcome):Object.freeze({status:'UNKNOWN'});recordConsumerObservation(facts);consumerObservation=facts.status==='OBSERVED'?'DURABLE_OBSERVED':'DURABLE_UNKNOWN';}catch{/* Observation cannot alter the original opaque callback result. */}}
       return outcome;
      },token,...(args.caseKey?[args.caseKey]:[]));}catch(cause){rememberFirstFailure(cause,'APPLICATION');throw cause;}
      finally{entry.active=false;contractContinuities.delete(token);currentContractContinuity=undefined;}
      check();need(invoked,'RESULT');
      const projection=projectOutcome(app);
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
  budgetObservation=observeBudget(outcome);cleanup='CLOSED';phase='COMPLETE';check();
  need(scopeEntered&&outcome,'RESULT');
  return writeReceipt(authOnly?'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_COMPLETE':'CURRENT261_LOCAL_LIFECYCLE_PROTOCOL_COMPLETE',{outcome});
 }catch(cause){
  if(!firstFailure){
   if(rememberControllerFirstFailure)rememberControllerFirstFailure(cause,phase);
   else firstFailure={cause,phase}; // Preplan/unstable coordinates remain UNKNOWN.
  }
  budgetObservation=observeBudget(cause);process.exitCode=1;
  if(resourceEntered&&cleanup!=='CLOSED')cleanup=safeCleanup(cause,scopeEntered);
  const primary=firstFailure?firstFailure.cause:cause,reason=safeReason(primary);
  const proof={...(reason?{reason}:{}),...(firstFailure?{failurePhase:firstFailure.phase}:{}),
   ...(firstFailure?.httpFailure?{httpFailure:firstFailure.httpFailure}:{}),
   ...(firstFailure?.documentAclFailure?{documentAclFailure:firstFailure.documentAclFailure}:{}),
   ...(firstFailure?.documentLoginFailure?{documentLoginFailure:firstFailure.documentLoginFailure}:{}),
   ...(firstFailure?.documentRoleFailure?{documentRoleFailure:firstFailure.documentRoleFailure}:{}),
   ...(firstFailure?.authOwnerObservation?{authOwnerObservation:firstFailure.authOwnerObservation}:{}),
   ...(firstFailure?.authRoleFailure?{authRoleFailure:firstFailure.authRoleFailure}:{}),
   ...(firstFailure&&cause!==primary?{secondaryReason:safeReason(cause)??'UNCLASSIFIED',secondaryPhase:'UNWIND'}:{}),
   ...(scopeEntered?{businessOutcome:'UNKNOWN'}:{}),...(technicalFailure?{technicalFailure}:{}),
   ...(failureStage?{failureStage}:{}),...(sevenFailure?{sevenFailure}:{})};
  let receiptWriteFailed=reason==='CURRENT261_LOCAL_LIFECYCLE_ONCE_RECEIPT';
  if(attempted&&writeReceipt&&!receiptWriteFailed){
   try{return writeReceipt(authOnly?'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_STOPPED':'CURRENT261_LOCAL_LIFECYCLE_STOPPED',{attempted,...proof});}
   catch{receiptWriteFailed=true;}
  }
  return {status:authOnly?'CURRENT261_FIRST_LOGIN_DIAGNOSTIC_STOPPED':'CURRENT261_LOCAL_LIFECYCLE_STOPPED',phase,attempted,cleanup,firstFailureObservation,firstFailureEvidenceWriteFailed,receivedSignal,signalEvidenceWriteFailed,signalObservation:signalsArmed?'HANDLERS_INSTALLED':'UNKNOWN',...(budgetObservation??{budgetReason:null,cleanupBudgetReason:null,budgetEvidenceWriteFailed:null,budgetObservation:'UNKNOWN'}),...(authOnly?{diagnosticObservation,consumerObservation}:{}),...proof,
   ...(receiptWriteFailed?{receiptWriteFailed:true}:{})};
 }finally{
  controller.abort();
  process.removeListener('SIGINT',onSigint);process.removeListener('SIGTERM',onSigterm);
 }
}
module.exports=Object.freeze({assertCurrent261ContractBusinessContinuity,assertCurrent261FirstLoginBusinessContinuity});
if(require.main===module)void main().then(result=>process.stdout.write(JSON.stringify(result)+'\n'));
