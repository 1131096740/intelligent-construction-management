"use strict";
// Fixed technical migration recipe only. Its token is not session/business admission.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {types,isDeepStrictEqual}=require('node:util');
const ROOT=path.resolve(__dirname,'../../..'),ID='CURRENT259_OWNED_TECHNICAL_V1',OWNER='jg_task01_owner';
const FULL='d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const profiles=new WeakMap(),usedHandles=new WeakSet();
const ownedPath=require.resolve('./task16-current259-owned-resource.cjs');
const ownedPreloaded=Boolean(require.cache[ownedPath]);
const ownedExports=require('./task16-current259-owned-resource.cjs'),ownedModule=require.cache[ownedPath];
const claimCurrent259OwnedResource=ownedExports.claimCurrent259OwnedResource;
const inputsPath=require.resolve('./task16-runtime-inputs.cjs');
const inputsExports=require('./task16-runtime-inputs.cjs'),inputsModule=require.cache[inputsPath];
const {readQualifiedTask16File}=inputsExports;
const commandPath=require.resolve('./task16-bounded-command.cjs');
const commandExports=require('./task16-bounded-command.cjs'),commandModule=require.cache[commandPath];
const {runTask16BoundedCommand}=commandExports;
const corePath=require.resolve('./local-staged-migrations.cjs');
const corePreloaded=Boolean(require.cache[corePath]);
const coreExports=require('./local-staged-migrations.cjs'),coreModule=require.cache[corePath];
const createLocalMigrationFixture=coreExports.createLocalMigrationFixture;
function bindings(){need(!ownedPreloaded&&!corePreloaded&&require.cache[__filename]===module&&module.exports===moduleApi&&require.cache[corePath]===coreModule&&coreModule.exports===coreExports&&coreExports.createLocalMigrationFixture===createLocalMigrationFixture&&require.cache[ownedPath]===ownedModule&&ownedModule.exports===ownedExports&&ownedExports.claimCurrent259OwnedResource===claimCurrent259OwnedResource&&require.cache[inputsPath]===inputsModule&&inputsModule.exports===inputsExports&&inputsExports.readQualifiedTask16File===readQualifiedTask16File&&require.cache[commandPath]===commandModule&&commandModule.exports===commandExports&&commandExports.runTask16BoundedCommand===runTask16BoundedCommand);}
const SCHEMA_ENGINE_SHA='57b090d47b947dc9284379d9480d11ffe14fe63155e3da515b359f3aa7fa408a';
const CLI_SHA='ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388';
const need=ok=>{if(!ok)throw new Error('CURRENT259_TECHNICAL_PROFILE');};
const plain=x=>x&&!types.isProxy(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
function resolveTechnicalProfile(token){
 need(token&&!types.isProxy(token)&&profiles.has(token));const p=profiles.get(token);p.check();return p;
}
function createCurrent259TechnicalMigration(handle,signal){
 need(arguments.length===1||arguments.length===2);
 if(signal!==undefined)need(signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===AbortSignal.prototype&&!Object.hasOwn(signal,"aborted"));
 const cancellation=new AbortController();
 const aborted=()=>signal!==undefined&&Object.getOwnPropertyDescriptor(AbortSignal.prototype,"aborted").get.call(signal);
 const onAbort=()=>cancellation.abort();

 // Fixed entry imports this module before the physical resource producer.
 bindings();
 const view=claimCurrent259OwnedResource(handle);need(!usedHandles.has(handle));usedHandles.add(handle);view.verifyFull();
 const source=view.source,build=view.build,resource=view.resource;
 need(source.profile.ledgerSha256===FULL&&source.profile.ledger.length===259&&build.node.path===process.execPath);
 const receipt=resource.getReceipt(),runId=view.runId,database='jg_task01_'+runId.replaceAll('-','');
 need(receipt.databaseName===database&&receipt.containerId===resource.containerId&&receipt.runId===runId);
 const frozenIdentity={runId,containerId:resource.containerId,networkId:resource.networkId,database,port:resource.port,name:receipt.containerName};
 let failed=false,started=false;const sqlMaterials=[];let cliMaterial,nodeMaterial,engineMaterial;
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
 }catch(error){failed=true;cancellation.abort();throw error;}}
 const token=Object.freeze({kind:ID});
 const profile={id:ID,owner:OWNER,database,runId,check,
  recordMaterial:row=>{check();sqlMaterials.push(Object.freeze({kind:row.kind??"setup",beforeSha256:row.beforeSha256,afterSha256:row.afterSha256}));},
  options:{container:{id:resource.containerId,name:receipt.containerName,runId},databaseNames:[database],
   inspectContainer:async()=>{check();return {id:resource.containerId,name:receipt.containerName,runId,running:true,publishedHost:'127.0.0.1',publishedPort:String(resource.port)};},
   executeSql:async({database:target,phase,sql})=>{check();need(target===database);try{const safeSql="SET application_name='jg-current259-technical';\nSET log_min_error_statement='panic';\nSET log_error_verbosity='terse';\n"+sql;need(Buffer.byteLength(safeSql)<=16*1024*1024&&!safeSql.includes('\0'));const value=await resource.execOwnerSql(safeSql,'current259-'+phase);check();return value;}catch(error){failed=true;cancellation.abort();throw error;}},
   deploy:async request=>{
    check();need(request.expectedFailure===undefined&&plain(request.runtimeEnv)&&Object.keys(request.runtimeEnv).length===0);
    const url=new URL(request.databaseUrl);need(url.username===OWNER&&url.hostname==='127.0.0.1'&&url.port===String(resource.port)&&decodeURIComponent(url.pathname.slice(1))===database);
    for(const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:resource.caPath,connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
    const tools=toolMaterials();check();
    const env={PATH:path.dirname(process.execPath),DATABASE_URL:url.toString(),PRISMA_HIDE_UPDATE_MESSAGE:'1',PRISMA_SCHEMA_ENGINE_BINARY:tools.engine};
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
  }catch(error){failed=true;cancellation.abort();throw error;}
  finally{if(signal)EventTarget.prototype.removeEventListener.call(signal,"abort",onAbort);}
 }});
}
const moduleApi=Object.freeze({createCurrent259TechnicalMigration,resolveTechnicalProfile});
module.exports=moduleApi;
