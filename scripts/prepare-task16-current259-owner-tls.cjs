#!/usr/bin/env node
'use strict';
// Offline source/build observation only. No resource start or client constructor.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {types,isDeepStrictEqual}=require('node:util');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
const {observeCurrent259Build}=require('../services/api/prisma/task16-current259-build.cjs');
const {loadCurrent259Client}=require('../services/api/prisma/task16-current259-client-loader.cjs');
const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const PURPOSE='current259-owner-tls-seven-closed-probes';
const ENTRY='services/api/prisma/run-task16-current259-owner-tls-local.cjs';
const ENDPOINT='unix:///Users/leoyang/.docker/run/docker.sock';
const IMAGE='sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d';
const SCOPE=Object.freeze({sdkProbeAttempts:7,healthySdkProbes:4,wrongCa:1,wrongSan:1,plaintext:1,ownerIdentityPsqlSessions:6,fixedIdentitySelects:14,bootstrapOwnerAndDatabase:true,certificatePreparationAndPeerReadiness:true,migrations:false,runtimeObserverRoleInstallation:false,businessWrites:false,liveSessionAdmission:false});
const LIMITS=Object.freeze({resourceMs:900000,ownerStageMs:600000,operationMs:30000,disconnectMs:10000,cpu:2,memoryBytes:1073741824,pids:256,pgdataBytes:536870912});
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function own(value,key){need(value&&!types.isProxy(value),'OWNER_TLS_PLAN_DATA');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'OWNER_TLS_PLAN_DATA');return d.value;}
function keys(value,names){need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===names.length,'OWNER_TLS_PLAN_DATA');return Object.fromEntries(names.map(k=>[k,own(value,k)]));}
function privateDirectory(dir){
 need(typeof dir==='string'&&dir.startsWith('/private/tmp/')&&path.normalize(dir)===dir&&dir!==ROOT&&!dir.startsWith(ROOT+path.sep)&&fs.realpathSync(dir)===dir,'OWNER_TLS_PLAN_DIRECTORY');
 let cursor=path.parse(dir).root;for(const part of dir.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);need(!fs.lstatSync(cursor).isSymbolicLink(),'OWNER_TLS_PLAN_DIRECTORY');}
 const st=fs.lstatSync(dir);need(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'OWNER_TLS_PLAN_DIRECTORY');
 return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]]));
}
function outsideFile(file){need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&file!==ROOT&&!file.startsWith(ROOT+path.sep),'OWNER_TLS_PLAN_PATH');privateDirectory(path.dirname(file));return file;}
function writeNew(file,bytes){
 outsideFile(file);let fd;
 try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
let observedMaterial;
function material(){
 if(observedMaterial){observedMaterial.loader.verifyFull();return observedMaterial;}
 const buildHandle=observeCurrent259Build(),loader=loadCurrent259Client(buildHandle);loader.verifyFull();const w=loader.witness();
 const observed=copy({source:{candidateSha:w.source.candidateSha,tree:w.source.tree,sourceSealSha256:w.source.sourceSealSha256,ledgerSha256:w.source.profile.ledgerSha256,prefix256Sha256:w.source.profile.prefix256Sha256,schemaSha256:w.source.profile.schemaSha256},build:w.build,host:w.host,engineCommit:w.engineCommit});
 observedMaterial=Object.freeze({buildHandle,loader,observed:freeze(observed)});return observedMaterial;
}
function expectedPlan(runRoot,daemonId,observed){
 need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId),'OWNER_TLS_PLAN_DAEMON');
 return {schemaVersion:1,purpose:PURPOSE,root:ROOT,entry:ENTRY,material:observed,resource:{endpoint:ENDPOINT,imageId:IMAGE,daemonId},run:{root:runRoot,identity:privateDirectory(runRoot),resourceDir:path.join(runRoot,'resource'),attemptFile:path.join(runRoot,'attempt.json'),receiptFile:path.join(runRoot,'receipt.json')},scope:{...SCOPE},limits:{...LIMITS}};
}
function prepareOwnerTlsPlan(options){
 need(arguments.length===1,'OWNER_TLS_PLAN_ARGUMENTS');const o=keys(options,['runRoot','daemonId','output']);outsideFile(o.output);
 const captured=material(),plan=expectedPlan(o.runRoot,o.daemonId,captured.observed);
 need(![plan.run.resourceDir,plan.run.attemptFile,plan.run.receiptFile].some(p=>fs.existsSync(p)),'OWNER_TLS_PLAN_RUN_ALREADY_USED');
 captured.loader.verifyFull();const bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');writeNew(o.output,bytes);
 return Object.freeze({status:'OWNER_TLS_PLAN_PREPARED_NO_RESOURCES',file:o.output,sha256:hash(bytes),candidateSha:plan.material.source.candidateSha});
}
function readOwnerTlsPlan(file,digest){
 need(arguments.length===2&&typeof digest==='string'&&/^[a-f0-9]{64}$/u.test(digest),'OWNER_TLS_PLAN_ARGUMENTS');outsideFile(file);
 const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:'OWNER_TLS_PLAN_FILE'});need(hash(data.bytes)===digest,'OWNER_TLS_PLAN_DIGEST');
 let plan;try{plan=JSON.parse(data.bytes.toString('utf8'));}catch{throw fault('OWNER_TLS_PLAN_JSON');}
 keys(plan,['schemaVersion','purpose','root','entry','material','resource','run','scope','limits']);
 need(plan.schemaVersion===1&&plan.purpose===PURPOSE&&plan.root===ROOT&&plan.entry===ENTRY,'OWNER_TLS_PLAN_SCOPE');
 keys(plan.material,['source','build','host','engineCommit']);const source=keys(plan.material.source,['candidateSha','tree','sourceSealSha256','ledgerSha256','prefix256Sha256','schemaSha256']);
 need(['candidateSha','tree'].every(k=>typeof source[k]==='string'&&/^[a-f0-9]{40}$/u.test(source[k]))&&['sourceSealSha256','ledgerSha256','prefix256Sha256','schemaSha256'].every(k=>typeof source[k]==='string'&&/^[a-f0-9]{64}$/u.test(source[k])),'OWNER_TLS_PLAN_SCOPE');
 keys(plan.run,['root','identity','resourceDir','attemptFile','receiptFile']);keys(plan.resource,['endpoint','imageId','daemonId']);
 need(plan.resource.endpoint===ENDPOINT&&plan.resource.imageId===IMAGE&&typeof plan.resource.daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(plan.resource.daemonId),'OWNER_TLS_PLAN_SCOPE');
 need(isDeepStrictEqual(plan.run.identity,privateDirectory(plan.run.root))&&plan.run.resourceDir===path.join(plan.run.root,'resource')&&plan.run.attemptFile===path.join(plan.run.root,'attempt.json')&&plan.run.receiptFile===path.join(plan.run.root,'receipt.json')&&isDeepStrictEqual(plan.scope,SCOPE)&&isDeepStrictEqual(plan.limits,LIMITS),'OWNER_TLS_PLAN_SCOPE');
 const info=freeze({path:file,sha256:digest,identity:data.identity});return Object.freeze({plan:freeze(plan),file:info});
}
function verifyOwnerTlsPlan(file,digest){
 need(arguments.length===2,'OWNER_TLS_PLAN_ARGUMENTS');const base=readOwnerTlsPlan(file,digest),captured=material();
 need(isDeepStrictEqual(base.plan,expectedPlan(base.plan.run.root,base.plan.resource.daemonId,captured.observed)),'OWNER_TLS_PLAN_MATERIAL_CHANGED');
 function check(){captured.loader.verifyFull();const current=read(file,{privateFile:true,maxBytes:512*1024,collect:true,expectedIdentity:base.file.identity,code:'OWNER_TLS_PLAN_FILE_CHANGED'});need(hash(current.bytes)===digest&&isDeepStrictEqual(base.plan.run.identity,privateDirectory(base.plan.run.root)),'OWNER_TLS_PLAN_FILE_CHANGED');}
 check();return Object.freeze({...base,buildHandle:captured.buildHandle,loader:captured.loader,check});
}
function parse(args){
 if(args.length===7&&args[0]==='--prepare'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output')return prepareOwnerTlsPlan({runRoot:args[2],daemonId:args[4],output:args[6]});
 if(args.length===5&&args[0]==='--verify'&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256'){const v=verifyOwnerTlsPlan(args[2],args[4]);return {status:'OWNER_TLS_PLAN_VERIFIED_NO_RESOURCES',candidateSha:v.plan.material.source.candidateSha,planSha256:args[4]};}
 throw fault('OWNER_TLS_PLAN_ARGUMENTS');
}
module.exports=Object.freeze({prepareOwnerTlsPlan,readOwnerTlsPlan,verifyOwnerTlsPlan});
if(require.main===module){try{process.stdout.write(JSON.stringify(parse(process.argv.slice(2)))+'\n');}catch(error){const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:typeof code==='string'&&/^OWNER_TLS_PLAN_[A-Z0-9_]+$/u.test(code)?code:'OWNER_TLS_PLAN_FAILED'})+'\n');process.exitCode=1;}}
