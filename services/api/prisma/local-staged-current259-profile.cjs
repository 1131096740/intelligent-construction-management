"use strict";
const {assertCurrent259BusinessIssuer:businessIssuer}=require('./task16-current259-business-continuity.cjs');
// Fixed technical migration recipe only. Its token is not session/business admission.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {types,isDeepStrictEqual}=require('node:util');
const {randomBytes}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..'),ID='CURRENT259_OWNED_TECHNICAL_V1',OWNER='jg_task01_owner';
const {isExactCurrentArchiveProfile}=require('./task16-current259-profile.cjs');
const profiles=new WeakMap(),usedHandles=new WeakSet(),supplies=new WeakMap(),failures=new WeakMap();
const need=ok=>{if(!ok)throw new Error('CURRENT259_TECHNICAL_PROFILE');};
function dataDescriptor(owner,key){need(owner&&!types.isProxy(owner));const d=Object.getOwnPropertyDescriptor(owner,key);need(d&&Object.hasOwn(d,'value'));return Object.freeze(d);}
function sameDescriptor(owner,key,expected){need(isDeepStrictEqual(dataDescriptor(owner,key),expected));}
const ownedPath=require.resolve('./task16-current259-owned-resource.cjs');
const ownedPreloaded=Boolean(require.cache[ownedPath]);
const ownedExports=require('./task16-current259-owned-resource.cjs'),ownedModule=require.cache[ownedPath];
const claimSlot=dataDescriptor(ownedExports,'claimCurrent259TechnicalResource'),closeSlot=dataDescriptor(ownedExports,'closeCurrent259OwnedResource');
const claimCurrent259TechnicalResource=claimSlot.value,closeCurrent259OwnedResource=closeSlot.value;
const inputsPath=require.resolve('./task16-runtime-inputs.cjs');
const inputsExports=require('./task16-runtime-inputs.cjs'),inputsModule=require.cache[inputsPath];
const inputSlot=dataDescriptor(inputsExports,'readQualifiedTask16File'),readQualifiedTask16File=inputSlot.value;
const commandPath=require.resolve('./task16-bounded-command.cjs');
const commandExports=require('./task16-bounded-command.cjs'),commandModule=require.cache[commandPath];
const commandSlot=dataDescriptor(commandExports,'runTask16BoundedCommand'),runTask16BoundedCommand=commandSlot.value;
const corePath=require.resolve('./local-staged-migrations.cjs');
const corePreloaded=Boolean(require.cache[corePath]);
const coreExports=require('./local-staged-migrations.cjs'),coreModule=require.cache[corePath];
const coreSlot=dataDescriptor(coreExports,'createLocalMigrationFixture'),createLocalMigrationFixture=coreSlot.value;
const modules=[[ownedPath,ownedModule,ownedExports],[inputsPath,inputsModule,inputsExports],[commandPath,commandModule,commandExports],[corePath,coreModule,coreExports]].map(([file,loaded,exports])=>({file,loaded,exports,slot:dataDescriptor(loaded,'exports')}));
function bindings(){
 need(!ownedPreloaded&&!corePreloaded&&dataDescriptor(require.cache,__filename).value===module&&dataDescriptor(module,'exports').value===moduleApi);
 for(const {file,loaded,exports,slot} of modules){need(dataDescriptor(require.cache,file).value===loaded&&slot.value===exports);sameDescriptor(loaded,'exports',slot);}
 for(const [owner,key,slot] of [[ownedExports,'claimCurrent259TechnicalResource',claimSlot],[ownedExports,'closeCurrent259OwnedResource',closeSlot],[inputsExports,'readQualifiedTask16File',inputSlot],[commandExports,'runTask16BoundedCommand',commandSlot],[coreExports,'createLocalMigrationFixture',coreSlot]])sameDescriptor(owner,key,slot);
}
const SCHEMA_ENGINE_SHA='57b090d47b947dc9284379d9480d11ffe14fe63155e3da515b359f3aa7fa408a';
const CLI_SHA='ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388';
const DEPLOY_PREFIXES=new Set(['203','205','213','215','218','221']);
const PRISMA_FAILURES=new Set(['P1000','P1001','P1002','P1003','P1008','P1009','P1010','P1011','P1012','P1013',
 'P1014','P1015','P1016','P1017','P3000','P3005','P3006','P3009','P3014','P3015','P3018','P3020','P3022']);
const SQL_STATES=new Set(['08001','08003','08006','22000','22001','22003','22P02','23502','23503','23505','23514',
 '25001','25006','28000','28P01','3D000','40001','40P01','42501','42601','42701','42703','42704','42710','42725',
 '42804','42883','42P01','42P07','42P16','55P03','57014','57P01','P0001','XX000']);
const COMMAND_FAILURES=new Set(['ABORTED','SPAWN_FAILED','PROCESS_REMAINS','TIMEOUT','OUTPUT_LIMIT']);
function ownErrorField(error,key){
 if(!error||typeof error!=='object'||types.isProxy(error))return undefined;
 return Object.getOwnPropertyDescriptor(error,key)?.value;
}
const ownErrorCode=error=>ownErrorField(error,'code');
const CONTROL_PHASE=/^(?:preflight|qualification-setup|qualification-cleanup|cleanup-readback|post-qualification|complete-readback|stage(?:203|205|213|215|218|221)-readback|tail(?:213|215|218|221)-(?:before|supply|readback))$/u;
const CONTROL_BOUNDARIES=new Set(['BEFORE_READ','SQL','AFTER_READ','READBACK']);
const COMMAND_KINDS=new Set(['timeout','aborted','output-limit','spawn-error','signal-exit','nonzero-exit']);
const CURSOR_STAGES=new Set(['CURSOR_DAEMON','CURSOR_OWNERSHIP','CURSOR_LOG_READ']);
const LOCAL_FAILURE=/^LOCAL_MIGRATION_(?:CONTAINER_IDENTITY|CONTAINER_PORT|INPUT|TARGET|SCHEMA|SOURCE|SOURCE_PREFIX|SOURCE_204_205|PREFIX_CACHE|READBACK|CONTROL|DATABASE_IDENTITY|ROLE_PROVENANCE|CURRENT259_FRESH_FULL_ONLY|STAGE203|STAGE205|CLEANUP|TAIL_PREFIX|TAIL_READBACK|TAIL_QUALIFICATION|TAIL_STDIN_PORT|COMPLETION|STOPPED|PARTIAL_QUALIFICATION|PARTIAL_TAIL_QUALIFICATION|TAIL(?:213|215|218|221)_[A-Z0-9_]{1,30}|SQL_(?:PREFLIGHT|QUALIFICATION_SETUP|QUALIFICATION_CLEANUP|CLEANUP_READBACK|POST_QUALIFICATION|COMPLETE_READBACK|STAGE(?:203|205|213|215|218|221)_READBACK|TAIL(?:213|215|218|221)_(?:BEFORE|SUPPLY|READBACK)))$/u;
const TECHNICAL_CODE=/^(?:TASK01_RESOURCE_(?:ABORTED|ABORTED_OR_TIMEOUT|COMMAND_FAILED|COMMAND_TIMEOUT|CONTAINER_CHANGED|DAEMON_CHANGED|IMAGE_CHANGED|LIMITS_CHANGED|LOOPBACK_FORWARD_FAILED|LOG_WINDOW_CHANGED|LOG_WINDOW_INVALID|METADATA_INVALID|MOUNTS_CHANGED|NETWORK_CHANGED|NETWORK_OTHER_OWNER|OPERATION_FAILED|OUTPUT_LIMIT|PORT_CHANGED|SQL_INPUT_INVALID)|CURRENT259_(?:RESOURCE_(?:ABORTED|CLOSED|CHANGED|DESCRIPTOR|IDENTITY|PRODUCER_CHANGED|PURPOSE|TLS|TOOL_CHANGED)|BUILD_[A-Z0-9_]{1,40}|LOADER_[A-Z0-9_]{1,40}))$/u;
const RELAY_CODE=/^CURRENT259_LOOPBACK_FORWARD_(?:ABORTED|CONFIG|LIMIT|CHILD|STREAM|FRAME|HALF_CLOSE_TIMEOUT|DEPLOY_DRAIN_TIMEOUT|DEPLOY_DRAIN_ACTIVE|LISTEN|CLOSED|CLEANUP)$/u;
function fixedLocalFailure(error){
 const message=ownErrorField(error,'message');
 return typeof message==='string'&&LOCAL_FAILURE.test(message)?message:undefined;
}
function describeCurrent259TechnicalFailure(error){
 return failures.get(error);
}
function deploymentFault(phase,kind){
 const code='CURRENT259_TECHNICAL_DEPLOY_'+phase+'_'+kind;
 const error=Object.assign(new Error(code),{code});
 const prisma=/^(P[0-9]{4})(?:_SQLSTATE_([0-9A-Z]{5}))?$/u.exec(kind);
 failures.set(error,Object.freeze({stage:'PRISMA_DEPLOY',prefixMigrations:phase==='UNCLASSIFIED'?null:Number(phase),
  kind:prisma?'PRISMA_REJECTED':kind,...(prisma?{prismaCode:prisma[1],...(prisma[2]?{sqlState:prisma[2]}:{})}:{})}));
 return error;
}
function deploymentResult(result){
 if(result?.actualSettled!==true)return 'UNSETTLED';
 if(result.timedOut)return 'TIMEOUT';
 if(result.code===0)return undefined;
 if(result.code===null)return 'SIGNALLED';
 // Prisma's fixed diagnostic headers only. No raw child output becomes an
 // exception cause, receipt, log, or status field.
 const streams=[result.stderr,result.stdout];
 if(!streams.every(stream=>Buffer.isBuffer(stream))||
  streams.reduce((size,stream)=>size+stream.length,0)>1024*1024)return 'NONZERO';
 for(const stream of streams){
  const text=stream.toString('utf8').replace(/\x1b\[[0-9;]{1,24}m/gu,'');
  const match=/^(?:Error: )?(P[0-9]{4})(?::|[ \t]*\r?$)/mu.exec(text);
  if(!match||!PRISMA_FAILURES.has(match[1]))continue;
  const prisma=match[1];
  if(prisma!=='P3018'&&prisma!=='P3006')return prisma;
  const state=/^Database error code: ([0-9A-Z]{5})[ \t]*\r?$/mu.exec(text.slice(match.index+match[0].length))?.[1];
  return SQL_STATES.has(state)?prisma+'_SQLSTATE_'+state:prisma;
 }
 return 'NONZERO';
}
const plain=x=>x&&!types.isProxy(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
function resolveTechnicalProfile(token){
 need(token&&!types.isProxy(token)&&profiles.has(token));const p=profiles.get(token);p.check();return p;
}
// Only metadata crosses the completion boundary; no resource, credentials or IO.
function frozenMetadata(value){
 if(value===null||['string','boolean','number'].includes(typeof value))return value;
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const descriptors=Object.getOwnPropertyDescriptors(value);need(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
 if(Array.isArray(value))return Object.freeze(Array.from({length:descriptors.length.value},(_,i)=>{need(descriptors[i]);return frozenMetadata(descriptors[i].value);}));
 need(Object.getPrototypeOf(value)===Object.prototype);
 return Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([key,row])=>[key,frozenMetadata(row.value)])));
}
function claimCurrent259TechnicalSupply(result,handle){
 need(arguments.length===2&&result&&!types.isProxy(result)&&supplies.has(result));
 const supply=supplies.get(result);need(supply.handle===handle);supplies.delete(result);
 supply.check();return Object.freeze({source:supply.source,completion:result,check:supply.check,checkContinuity:supply.checkContinuity});
}
function createCurrent259TechnicalMigration(handle,signal){
 need(arguments.length===1||arguments.length===2);
 if(signal!==undefined)need(signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===AbortSignal.prototype&&!Object.hasOwn(signal,"aborted"));
 const cancellation=new AbortController();
 const aborted=()=>signal!==undefined&&Object.getOwnPropertyDescriptor(AbortSignal.prototype,"aborted").get.call(signal);
 const onAbort=()=>{void stop().catch(()=>{});};

 // Fixed entry imports this module before the physical resource producer.
 bindings();
 const view=claimCurrent259TechnicalResource(handle);need(!usedHandles.has(handle));usedHandles.add(handle);view.verifyFull();
 const beginPrismaRelayDrain=Object.getOwnPropertyDescriptor(view,'beginPrismaRelayDrain')?.value;
 need(view.resource.topology!=='UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS'||typeof beginPrismaRelayDrain==='function');
 need(view.purpose==='CURRENT259_TECHNICAL_MIGRATIONS_V1'&&view.deadlineMs===3600000);
 const source=view.source,build=view.build,resource=view.resource;
 need(isExactCurrentArchiveProfile(source.profile)&&build.node.path===process.execPath);
 const receipt=resource.getReceipt(),runId=view.runId,database='jg_task01_'+runId.replaceAll('-','');
 need(receipt.databaseName===database&&receipt.containerId===resource.containerId&&receipt.runId===runId);
 const frozenIdentity={runId,containerId:resource.containerId,networkId:resource.networkId,database,port:resource.port,name:receipt.containerName};
 let failed=false,started=false,closing,physicalAnchor;const sqlMaterials=[];let cliMaterial,nodeMaterial,engineMaterial;
 let recording=false,stage='INITIAL_CHECK',controlPhase,controlBoundary,firstFailure,lastSuccessfulDeployPrefix=null,prismaExitZeroPrefix;
 function recordControlPhase(phase,boundary){
  need(typeof phase==='string'&&CONTROL_PHASE.test(phase)&&CONTROL_BOUNDARIES.has(boundary));
  controlPhase=phase;controlBoundary=boundary;stage='CONTROL_'+boundary;
 }
 function remember(error,checkGate){
  if(!recording||firstFailure)return;
  const code=ownErrorCode(error),relayCode=ownErrorField(error,'relayCode');
  const commandKind=ownErrorField(error,'commandKind'),cursorStage=ownErrorField(error,'cursorStage');
  const relayCloseSource=ownErrorField(error,'relayCloseState');
  const relayCloseState=(relayCode==='CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT'||relayCode==='CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT')&&Object.fromEntries(
   ['hostFin','stdinEnded','pgFin','stdoutEnded','cliClosed','stdoutRawEnd','receiveSettled','cliExited','peerSocketDestroyed','peerEndReturned']
    .map(key=>[key,ownErrorField(relayCloseSource,key)]));
  firstFailure=Object.freeze({stage,...(controlPhase?{controlPhase,controlBoundary}:{}),...(checkGate?{checkGate}:{}),
   ...(typeof code==='string'&&TECHNICAL_CODE.test(code)?{causeCode:code}:{}),
   ...(typeof relayCode==='string'&&RELAY_CODE.test(relayCode)?{relayCode}:{}),
   ...(relayCloseState&&Object.values(relayCloseState).every(value=>typeof value==='boolean')?{relayCloseState:Object.freeze(relayCloseState)}:{}),
   ...(COMMAND_KINDS.has(commandKind)?{commandKind}:{}),...(CURSOR_STAGES.has(cursorStage)?{cursorStage}:{}),
   ...(stage==='PRISMA_RELAY_DRAIN'?{prismaExitZeroPrefix}:{}),lastSuccessfulDeployPrefix});
 }
 function bindFailure(error){
  if(!recording)return;
  remember(error);
  if(!firstFailure||!error||typeof error!=='object'||types.isProxy(error))return;
  const deployment=describeCurrent259TechnicalFailure(error),localCode=fixedLocalFailure(error);
  failures.set(error,Object.freeze({...firstFailure,...deployment,...(localCode?{localCode}:{})}));
 }
 function stop(){
  failed=true;cancellation.abort();
  if(signal)EventTarget.prototype.removeEventListener.call(signal,"abort",onAbort);
  if(!closing){try{closing=Promise.resolve(closeCurrent259OwnedResource(handle));}catch(error){closing=Promise.reject(error);}closing.catch(()=>{});}
  return closing;
 }
 async function failedOutcome(primary){
  try{await stop();}catch{
   const failure=new Error('CURRENT259_TECHNICAL_CLEANUP_UNKNOWN');
   const detail=describeCurrent259TechnicalFailure(primary);
   if(detail){
    Object.defineProperty(failure,'code',{value:ownErrorCode(primary),enumerable:true});
    failures.set(failure,detail);
   }
   Object.defineProperty(failure,'cause',{value:primary});
   Object.defineProperty(failure,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});throw failure;
  }
  throw primary;
 }
 function toolMaterials(){
  const cli=fs.realpathSync(path.join(ROOT,"services/api/node_modules/prisma/build/index.js"));need(cli.startsWith(ROOT+path.sep));
  const observed=readQualifiedTask16File(cli,{maxBytes:4*1024*1024,expectedIdentity:cliMaterial?.identity,code:"CURRENT259_TECHNICAL_CLI"});need(observed.sha256===CLI_SHA);
  const node=readQualifiedTask16File(process.execPath,{maxBytes:512*1024*1024,executable:true,expectedIdentity:nodeMaterial?.identity,code:"CURRENT259_TECHNICAL_NODE"});need(node.sha256===build.node.sha256);
  const engine=fs.realpathSync(path.join(ROOT,'node_modules/.pnpm/@prisma+engines@5.22.0/node_modules/@prisma/engines/schema-engine-darwin-arm64'));need(engine.startsWith(ROOT+path.sep));
  const capturedEngine=readQualifiedTask16File(engine,{maxBytes:64*1024*1024,executable:true,expectedIdentity:engineMaterial?.identity,code:'CURRENT259_TECHNICAL_ENGINE'});need(capturedEngine.sha256===SCHEMA_ENGINE_SHA);
  cliMaterial=observed;nodeMaterial=node;engineMaterial=capturedEngine;return {cli,engine};
 }
 function check(){
  let gate='ACTIVE';
  try{
   need(!failed&&!aborted()&&!cancellation.signal.aborted);
   gate='IMPORTS';bindings();
   gate='OWNED_RESOURCE';view.check();
   gate='FULL_SOURCE';view.verifyFull();
   gate='RESOURCE_IDENTITY';need(view.source===source&&view.build===build&&view.resource===resource);
   const r=resource.getReceipt();need(r.purpose==='CURRENT259_TECHNICAL_MIGRATIONS_V1'&&r.limits?.totalDeadlineMs===3600000);need(isDeepStrictEqual({runId:r.runId,containerId:r.containerId,networkId:r.networkId,database:r.databaseName,port:r.port,name:r.containerName},frozenIdentity));
  }catch(error){remember(error,gate);void stop().catch(()=>{});throw error;}
 }
 function checkContinuity(businessToken){try{
  businessIssuer(businessToken,handle);need(!failed&&!aborted()&&!cancellation.signal.aborted);bindings();view.checkContinuity(businessToken);
  need(view.source===source&&view.build===build&&view.resource===resource);
  const r=resource.getReceiptContinuity(businessToken);need(r.purpose==='CURRENT259_TECHNICAL_MIGRATIONS_V1'&&r.limits?.totalDeadlineMs===3600000);
  need(isDeepStrictEqual({runId:r.runId,containerId:r.containerId,networkId:r.networkId,database:r.databaseName,port:r.port,name:r.containerName},frozenIdentity));
 }catch(error){void stop().catch(()=>{});throw error;}}
 const token=Object.freeze({kind:ID});
 const profile={id:ID,owner:OWNER,database,runId,check,recordControlPhase,
  ledger:source.profile.ledger,
  recordMaterial:row=>{check();sqlMaterials.push(Object.freeze({kind:row.kind??"setup",beforeSha256:row.beforeSha256,afterSha256:row.afterSha256}));},
  options:{container:{id:resource.containerId,name:receipt.containerName,runId},databaseNames:[database],
   inspectContainer:async()=>{
    const previousStage=stage;
    try{
    stage='CONTAINER_BEFORE_CURSOR_CHECK';check();
    stage='CONTAINER_LOG_CURSOR';const cursor=await resource.captureLogCursor();
    stage='CONTAINER_AFTER_CURSOR_CHECK';check();
    stage='CONTAINER_CURSOR_IDENTITY';need(plain(cursor)&&cursor.runId===runId&&cursor.containerId===resource.containerId);
    // A cursor's inspect accepts stopped resources. Only successful fixed Docker
    // exec + authenticated PG statement below proves this transport is live.
    const nonce=randomBytes(32).toString('hex');
    const sql=`SELECT jsonb_build_object('nonce','${nonce}','database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,
     'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,
     'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
     'clientAddress',pg_catalog.host(pg_catalog.inet_client_addr()),'serverAddress',pg_catalog.host(pg_catalog.inet_server_addr()),'serverPort',inet_server_port(),'backendPid',pg_backend_pid())
     FROM pg_database d WHERE d.datname=current_database();`;
    stage='CONTAINER_OWNER_TLS_SQL';const live=await resource.execOwnerSql(sql,'current259-live-inspect');
    stage='CONTAINER_AFTER_OWNER_TLS_CHECK';check();
    stage='CONTAINER_OWNER_TLS_IDENTITY';need(plain(live)&&typeof live.stdout==='string'&&Buffer.byteLength(live.stdout)<=8192);
    const row=JSON.parse(live.stdout.trim());need(plain(row)&&isDeepStrictEqual(Object.keys(row).sort(),['nonce','database','databaseOid','namespaceOid','ownerOid','actorOid','actor','sessionActor','systemIdentifier','tls','clientAddress','serverAddress','serverPort','backendPid'].sort()));
    need(row.nonce===nonce&&row.database===database&&row.actor===OWNER&&row.sessionActor===OWNER&&row.ownerOid==='10'&&row.actorOid==='10'&&row.tls===true&&row.clientAddress==='127.0.0.1'&&row.serverAddress==='127.0.0.1'&&row.serverPort===5432&&Number.isInteger(row.backendPid)&&row.backendPid>0&&row.backendPid<=2147483647);
    need([row.databaseOid,row.namespaceOid].every(x=>typeof x==='string'&&/^[1-9][0-9]{0,9}$/u.test(x)&&BigInt(x)<=0xffffffffn)&&typeof row.systemIdentifier==='string'&&/^[1-9][0-9]{0,19}$/u.test(row.systemIdentifier)&&BigInt(row.systemIdentifier)<=0xffffffffffffffffn);
    const anchor=Object.fromEntries(Object.entries(row).filter(([key])=>!['nonce','backendPid'].includes(key)));if(physicalAnchor)need(isDeepStrictEqual(anchor,physicalAnchor));else physicalAnchor=Object.freeze(anchor);
    stage=previousStage;
    return {id:resource.containerId,name:receipt.containerName,runId,running:true,publishedHost:'127.0.0.1',publishedPort:String(resource.port)};
   }catch(error){remember(error);void stop().catch(()=>{});throw error;}},
   executeSql:async({database:target,phase,sql})=>{
    try{
     stage='CONTROL_BEFORE_SQL_CHECK';check();need(target===database);
     const safeSql="SET application_name='jg-current259-technical';\nSET log_min_error_statement='panic';\nSET log_error_verbosity='terse';\n"+sql;
     need(Buffer.byteLength(safeSql)<=16*1024*1024&&!safeSql.includes('\0'));
     stage='CONTROL_OWNER_SQL';const value=await resource.execOwnerSql(safeSql,'current259-'+phase);
     stage='CONTROL_AFTER_SQL_CHECK';check();stage='CONTROL_SQL';return value;
    }catch(error){remember(error);void stop().catch(()=>{});throw error;}
   },
   deploy:async request=>{
    controlPhase=undefined;controlBoundary=undefined;stage='PRISMA_PRECHECK';
    check();need(request.expectedFailure===undefined&&plain(request.runtimeEnv)&&Object.keys(request.runtimeEnv).length===0);
    const url=new URL(request.databaseUrl);need(url.username===OWNER&&url.hostname==='127.0.0.1'&&url.port===String(resource.port)&&decodeURIComponent(url.pathname.slice(1))===database);
    for(const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:resource.caPath,connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
    stage='PRISMA_TOOL_QUALIFICATION';const tools=toolMaterials();check();
    const env={PATH:path.dirname(process.execPath),DATABASE_URL:url.toString(),PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1',PRISMA_SCHEMA_ENGINE_BINARY:tools.engine};
    const prefix=request.schemaPath===undefined?'259':path.basename(path.dirname(request.schemaPath));
    const phase=prefix==='259'||DEPLOY_PREFIXES.has(prefix)?prefix:'UNCLASSIFIED';
    try{
     stage='PRISMA_RELAY_PRECHECK';
     const waitForRelay=beginPrismaRelayDrain?.call(view);
     need(!beginPrismaRelayDrain||typeof waitForRelay==='function');
     stage='PRISMA_DEPLOY';
     let result;
     try{result=await runTask16BoundedCommand(process.execPath,[tools.cli,'migrate','deploy','--schema',request.schemaPath??path.join(__dirname,'schema.prisma')],{cwd:ROOT,env,signal:cancellation.signal,timeoutMs:180000,maxOutputBytes:1024*1024});}
     catch(error){
      const code=ownErrorCode(error),kind=typeof code==='string'&&code.startsWith('TASK16_MIGRATE_')?code.slice(15):undefined;
      throw deploymentFault(phase,COMMAND_FAILURES.has(kind)?kind:'COMMAND_FAILED');
     }
     const resultFailure=deploymentResult(result);
     if(resultFailure)throw deploymentFault(phase,resultFailure);
     if(waitForRelay){
      stage='PRISMA_RELAY_DRAIN';prismaExitZeroPrefix=phase==='UNCLASSIFIED'?null:Number(phase);
      await waitForRelay();
     }
     stage='PRISMA_POSTCHECK';
     try{check();toolMaterials();}
     catch{throw deploymentFault(phase,'POST_SUCCESS_VERIFICATION');}
     const output={stdout:Buffer.from(result.stdout).toString('utf8'),stderr:Buffer.from(result.stderr).toString('utf8')};
     if(phase!=='UNCLASSIFIED')lastSuccessfulDeployPrefix=Number(phase);
     stage='AFTER_PRISMA_DEPLOY';
     return output;
    }catch(error){failed=true;throw error;}
   }}};
 profile.options.executeSqlStdin=profile.options.executeSql;
 profiles.set(token,profile);
 return Object.freeze({async migrate(){
  let supplied=false;
  try{
   recording=!started;check();need(arguments.length===0&&!started);started=true;if(signal)EventTarget.prototype.addEventListener.call(signal,"abort",onAbort,{once:true});
   stage='MIGRATION_FIXTURE';const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jg-current259-migrations-'));check();
   const fixture=createLocalMigrationFixture({technicalProfile:token,temporaryRoot});
   const url=new URL('postgresql://'+OWNER+'@127.0.0.1:'+resource.port+'/'+database);url.password=view.credentials().owner;url.searchParams.set('application_name','jg-current259-migrate');
   stage='CORE_MIGRATE';const result=await fixture.migrate({databaseUrl:url.toString(),runtimeEnv:{}});
   stage='FINAL_CHECK';controlPhase=undefined;controlBoundary=undefined;check();
   const completion=Object.freeze({status:'CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION',executionAllowed:false,nativeAdmission:false,sourceSha:source.candidateSha,runId,containerId:resource.containerId,database,
    application:result.technicalApplication,databaseIdentity:Object.freeze({...physicalAnchor}),sqlMaterials:Object.freeze(sqlMaterials.slice())});
   supplies.set(completion,{handle,source:frozenMetadata(source),check,checkContinuity});supplied=true;return completion;
  }catch(error){bindFailure(error);return await failedOutcome(error);}
  // The same once listener protects the completed result before and after claim.
  // The original owned scope still revokes and closes independently on exit.
  finally{recording=false;if(signal&&!supplied)EventTarget.prototype.removeEventListener.call(signal,"abort",onAbort);}
 }});
}
const moduleApi=Object.freeze({createCurrent259TechnicalMigration,resolveTechnicalProfile,claimCurrent259TechnicalSupply,describeCurrent259TechnicalFailure});
module.exports=moduleApi;
