"use strict";
// Fixed technical migration recipe only. Its token is not session/business admission.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {types,isDeepStrictEqual}=require('node:util');
const {randomBytes}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..'),ID='CURRENT259_OWNED_TECHNICAL_V1',OWNER='jg_task01_owner';
const FULL='d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const profiles=new WeakMap(),usedHandles=new WeakSet();
const need=ok=>{if(!ok)throw new Error('CURRENT259_TECHNICAL_PROFILE');};
function dataDescriptor(owner,key){need(owner&&!types.isProxy(owner));const d=Object.getOwnPropertyDescriptor(owner,key);need(d&&Object.hasOwn(d,'value'));return Object.freeze(d);}
function sameDescriptor(owner,key,expected){need(isDeepStrictEqual(dataDescriptor(owner,key),expected));}
const ownedPath=require.resolve('./task16-current259-owned-resource.cjs');
const ownedPreloaded=Boolean(require.cache[ownedPath]);
const ownedExports=require('./task16-current259-owned-resource.cjs'),ownedModule=require.cache[ownedPath];
const claimSlot=dataDescriptor(ownedExports,'claimCurrent259OwnedResource'),closeSlot=dataDescriptor(ownedExports,'closeCurrent259OwnedResource');
const claimCurrent259OwnedResource=claimSlot.value,closeCurrent259OwnedResource=closeSlot.value;
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
 for(const [owner,key,slot] of [[ownedExports,'claimCurrent259OwnedResource',claimSlot],[ownedExports,'closeCurrent259OwnedResource',closeSlot],[inputsExports,'readQualifiedTask16File',inputSlot],[commandExports,'runTask16BoundedCommand',commandSlot],[coreExports,'createLocalMigrationFixture',coreSlot]])sameDescriptor(owner,key,slot);
}
const SCHEMA_ENGINE_SHA='57b090d47b947dc9284379d9480d11ffe14fe63155e3da515b359f3aa7fa408a';
const CLI_SHA='ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388';
const plain=x=>x&&!types.isProxy(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
function resolveTechnicalProfile(token){
 need(token&&!types.isProxy(token)&&profiles.has(token));const p=profiles.get(token);p.check();return p;
}
function createCurrent259TechnicalMigration(handle,signal){
 need(arguments.length===1||arguments.length===2);
 if(signal!==undefined)need(signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===AbortSignal.prototype&&!Object.hasOwn(signal,"aborted"));
 const cancellation=new AbortController();
 const aborted=()=>signal!==undefined&&Object.getOwnPropertyDescriptor(AbortSignal.prototype,"aborted").get.call(signal);
 const onAbort=()=>{void stop().catch(()=>{});};

 // Fixed entry imports this module before the physical resource producer.
 bindings();
 const view=claimCurrent259OwnedResource(handle);need(!usedHandles.has(handle));usedHandles.add(handle);view.verifyFull();
 const source=view.source,build=view.build,resource=view.resource;
 need(source.profile.ledgerSha256===FULL&&source.profile.ledger.length===259&&build.node.path===process.execPath);
 const receipt=resource.getReceipt(),runId=view.runId,database='jg_task01_'+runId.replaceAll('-','');
 need(receipt.databaseName===database&&receipt.containerId===resource.containerId&&receipt.runId===runId);
 const frozenIdentity={runId,containerId:resource.containerId,networkId:resource.networkId,database,port:resource.port,name:receipt.containerName};
 let failed=false,started=false,closing,physicalAnchor;const sqlMaterials=[];let cliMaterial,nodeMaterial,engineMaterial;
 function stop(){
  failed=true;cancellation.abort();
  if(!closing){try{closing=Promise.resolve(closeCurrent259OwnedResource(handle));}catch(error){closing=Promise.reject(error);}closing.catch(()=>{});}
  return closing;
 }
 async function failedOutcome(primary){
  try{await stop();}catch{
   const failure=new Error('CURRENT259_TECHNICAL_CLEANUP_UNKNOWN');
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
 function check(){try{
  need(!failed&&!aborted()&&!cancellation.signal.aborted);bindings();view.check();view.verifyFull();need(view.source===source&&view.build===build&&view.resource===resource);
  const r=resource.getReceipt();need(isDeepStrictEqual({runId:r.runId,containerId:r.containerId,networkId:r.networkId,database:r.databaseName,port:r.port,name:r.containerName},frozenIdentity));
 }catch(error){void stop().catch(()=>{});throw error;}}
 const token=Object.freeze({kind:ID});
 const profile={id:ID,owner:OWNER,database,runId,check,
  recordMaterial:row=>{check();sqlMaterials.push(Object.freeze({kind:row.kind??"setup",beforeSha256:row.beforeSha256,afterSha256:row.afterSha256}));},
  options:{container:{id:resource.containerId,name:receipt.containerName,runId},databaseNames:[database],
   inspectContainer:async()=>{check();try{
    const cursor=await resource.captureLogCursor();check();need(plain(cursor)&&cursor.runId===runId&&cursor.containerId===resource.containerId);
    // A cursor's inspect accepts stopped resources. Only successful fixed Docker
    // exec + authenticated PG statement below proves this transport is live.
    const nonce=randomBytes(32).toString('hex');
    const sql=`SELECT jsonb_build_object('nonce','${nonce}','database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,
     'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,
     'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
     'clientAddress',inet_client_addr()::text,'serverAddress',inet_server_addr()::text,'serverPort',inet_server_port(),'backendPid',pg_backend_pid())
     FROM pg_database d WHERE d.datname=current_database();`;
    const live=await resource.execOwnerSql(sql,'current259-live-inspect');check();need(plain(live)&&typeof live.stdout==='string'&&Buffer.byteLength(live.stdout)<=8192);
    const row=JSON.parse(live.stdout.trim());need(plain(row)&&isDeepStrictEqual(Object.keys(row).sort(),['nonce','database','databaseOid','namespaceOid','ownerOid','actorOid','actor','sessionActor','systemIdentifier','tls','clientAddress','serverAddress','serverPort','backendPid'].sort()));
    need(row.nonce===nonce&&row.database===database&&row.actor===OWNER&&row.sessionActor===OWNER&&row.ownerOid==='10'&&row.actorOid==='10'&&row.tls===true&&row.clientAddress==='127.0.0.1'&&row.serverAddress==='127.0.0.1'&&row.serverPort===5432&&Number.isInteger(row.backendPid)&&row.backendPid>0&&row.backendPid<=2147483647);
    need([row.databaseOid,row.namespaceOid].every(x=>typeof x==='string'&&/^[1-9][0-9]{0,9}$/u.test(x)&&BigInt(x)<=0xffffffffn)&&typeof row.systemIdentifier==='string'&&/^[1-9][0-9]{0,19}$/u.test(row.systemIdentifier)&&BigInt(row.systemIdentifier)<=0xffffffffffffffffn);
    const anchor=Object.fromEntries(Object.entries(row).filter(([key])=>!['nonce','backendPid'].includes(key)));if(physicalAnchor)need(isDeepStrictEqual(anchor,physicalAnchor));else physicalAnchor=Object.freeze(anchor);
    return {id:resource.containerId,name:receipt.containerName,runId,running:true,publishedHost:'127.0.0.1',publishedPort:String(resource.port)};
   }catch(error){void stop().catch(()=>{});throw error;}},
   executeSql:async({database:target,phase,sql})=>{check();need(target===database);try{const safeSql="SET application_name='jg-current259-technical';\nSET log_min_error_statement='panic';\nSET log_error_verbosity='terse';\n"+sql;need(Buffer.byteLength(safeSql)<=16*1024*1024&&!safeSql.includes('\0'));const value=await resource.execOwnerSql(safeSql,'current259-'+phase);check();return value;}catch(error){void stop().catch(()=>{});throw error;}},
   deploy:async request=>{
    check();need(request.expectedFailure===undefined&&plain(request.runtimeEnv)&&Object.keys(request.runtimeEnv).length===0);
    const url=new URL(request.databaseUrl);need(url.username===OWNER&&url.hostname==='127.0.0.1'&&url.port===String(resource.port)&&decodeURIComponent(url.pathname.slice(1))===database);
    for(const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:resource.caPath,connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
    const tools=toolMaterials();check();
    const env={PATH:path.dirname(process.execPath),DATABASE_URL:url.toString(),PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1',PRISMA_SCHEMA_ENGINE_BINARY:tools.engine};
    try{const result=await runTask16BoundedCommand(process.execPath,[tools.cli,'migrate','deploy','--schema',request.schemaPath??path.join(__dirname,'schema.prisma')],{cwd:ROOT,env,signal:cancellation.signal,timeoutMs:180000,maxOutputBytes:1024*1024});
     check();toolMaterials();need(result.actualSettled===true&&result.code===0&&!result.timedOut);return {stdout:Buffer.from(result.stdout).toString('utf8'),stderr:Buffer.from(result.stderr).toString('utf8')};
    }catch(error){failed=true;throw error;}
   }}};
 profile.options.executeSqlStdin=profile.options.executeSql;
 profiles.set(token,profile);
 return Object.freeze({async migrate(){
  try{
   check();need(arguments.length===0&&!started);started=true;if(signal)EventTarget.prototype.addEventListener.call(signal,"abort",onAbort,{once:true});
   const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jg-current259-migrations-'));check();
   const fixture=createLocalMigrationFixture({technicalProfile:token,temporaryRoot});
   const url=new URL('postgresql://'+OWNER+'@127.0.0.1:'+resource.port+'/'+database);url.password=view.credentials().owner;url.searchParams.set('application_name','jg-current259-migrate');
   const result=await fixture.migrate({databaseUrl:url.toString(),runtimeEnv:{}});check();
   return Object.freeze({status:'CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION',executionAllowed:false,nativeAdmission:false,sourceSha:source.candidateSha,runId,containerId:resource.containerId,database,
    application:result.technicalApplication,sqlMaterials:Object.freeze(sqlMaterials.slice())});
  }catch(error){return await failedOutcome(error);}
  finally{if(signal)EventTarget.prototype.removeEventListener.call(signal,"abort",onAbort);}
 }});
}
const moduleApi=Object.freeze({createCurrent259TechnicalMigration,resolveTechnicalProfile});
module.exports=moduleApi;
