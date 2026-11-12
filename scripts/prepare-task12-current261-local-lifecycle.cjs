#!/usr/bin/env node
'use strict';
// A separate purpose; the preview/Q2 plans never gain lifecycle authority.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const CODE='CURRENT261_LOCAL_LIFECYCLE_PLAN';
const need=(ok,part)=>{if(!ok){const code=CODE+'_'+part;throw Object.assign(new Error(code),{code});}};
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$','u').test(v);
const ENTRY='services/api/prisma/task12-current261-local-lifecycle-once.cjs',NAME='LIFECYCLE-PLAN.json';
const RESOURCE=Object.freeze({transport:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'});
const fixed=(value,keys)=>{
 need(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype,'INPUT');
 const d=Object.getOwnPropertyDescriptors(value);need(Reflect.ownKeys(d).length===keys.length,'INPUT');
 return Object.fromEntries(keys.map(k=>{need(d[k]&&Object.hasOwn(d[k],'value'),'INPUT');return [k,d[k].value];}));
};
function officialRuntime(runtime){
 runtime=fixed(runtime,['file','sha256']);need(typeof runtime.file==='string'&&path.isAbsolute(runtime.file)&&hex(runtime.sha256,64),'RUNTIME');
 const api=require('../services/api/prisma/task12-current259-generated-document-runtime.cjs');
 // The tool owner alone issues the private runtime brand. Missing/PENDING
 // exports fail before loading an SDK, writing a plan or opening resources.
 if(typeof api.observeOfficialTask12DocumentPublication!=='function'||typeof api.verifyOfficialTask12DocumentRuntime!=='function'||typeof api.withOfficialTask12DocumentRuntime!=='function'){
  const code='TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING';throw Object.assign(new Error(code),{code});
 }
 // This result deliberately carries no admission. The formal issuer runs only
 // after the fresh SDK loader has captured the same build's actual modules.
 api.observeOfficialTask12DocumentPublication(runtime.file,runtime.sha256);
 return {coordinates:runtime,api};
}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function directory(file){
 need(typeof file==='string'&&file.startsWith('/private/tmp/')&&path.normalize(file)===file,'DIRECTORY');
 let cursor='/';for(const piece of file.slice(1).split('/')){cursor=path.join(cursor,piece);need(!fs.lstatSync(cursor).isSymbolicLink(),'DIRECTORY');}
 const s=fs.lstatSync(file);need(s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&fs.realpathSync(file)===file,'DIRECTORY');
 return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,s[k]]));
}
function capture(){
 // Preserve the original loader/resource producer import order.
 require('../services/api/prisma/task12-current259-contract-login.cjs');
 const {observeCurrent259Build}=require('../services/api/prisma/task16-current259-build.cjs');
 const {loadCurrent259Client}=require('../services/api/prisma/task16-current259-client-loader.cjs');
 const handle=observeCurrent259Build(),loader=loadCurrent259Client(handle),w=loader.witness();
 const {describeCurrent261LocalLifecycle}=require('../services/api/prisma/task12-current261-local-lifecycle-scope.cjs');
 const scope=describeCurrent261LocalLifecycle(w.source);
 const source=freeze(JSON.parse(JSON.stringify({candidateSha:w.source.candidateSha,tree:w.source.tree,sourceSealSha256:w.source.sourceSealSha256,
  profile:w.source.profile,build:w.build,host:w.host,engineCommit:w.engineCommit})));
 const moduleView=loader.loadCurrent261LocalLifecycleDocumentModules();
 return {handle,loader,source,scope,moduleView};
}
function formalRuntime(observed,captured){
 const proof=observed.api.verifyOfficialTask12DocumentRuntime(observed.coordinates.file,observed.coordinates.sha256,captured.moduleView);
 captured.loader.verifyFull();
 need(proof&&proof.kind==='OFFICIAL_TOOL_RUNTIME'&&proof.profile==='TASK12_OFFICIAL_TEMURIN17_0_17_10_V1'&&proof.inputSha256===observed.coordinates.sha256&&proof.source?.head===captured.source.candidateSha&&proof.source?.tree===captured.source.tree&&hex(proof.source?.sha256,64)&&Number.isSafeInteger(proof.source?.files)&&proof.source.files>0&&['candidateLockSha256','buildSha256','materialSha256','machineReceiptSha256','physicalReviewSha256'].every(k=>hex(proof[k],64)),'RUNTIME_SOURCE');
 const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
 const input=read(observed.coordinates.file,{privateFile:true,maxBytes:512*1024,collect:true,code:CODE+'_RUNTIME_FILE'});
 need(input.sha256===observed.coordinates.sha256,'RUNTIME');
 let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes));}catch{need(false,'RUNTIME');}
 need(packet.purpose==='TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1'&&equal(packet.source,proof.source)&&typeof packet.runRoot==='string','RUNTIME');
 return {coordinates:observed.coordinates,proof,input,runRoot:packet.runRoot};
}
function planFor(input,verified,captured){
 const runtime=verified.coordinates;
 const {packetRoot,daemonId,caseId,businessDate}=input;
 need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId)&&typeof caseId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(caseId),'INPUT');
 need(typeof businessDate==='string'&&/^\d{4}-\d\d-\d\d$/u.test(businessDate),'INPUT');
 const day=new Date(businessDate+'T00:00:00Z');need(Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===businessDate,'INPUT');
 need(runtime.file===path.join(packetRoot,'runtime-input.json')&&verified.runRoot===path.join(packetRoot,'tool-run'),'RUNTIME');
 const root=path.join(packetRoot,'lifecycle-run');
 return {version:1,purpose:captured.scope.purpose,entry:ENTRY,source:captured.source,scope:captured.scope,
  packet:{root:packetRoot,identity:directory(packetRoot)},resource:{...RESOURCE,daemonId},
  case:{id:caseId,businessDate,relationship:'inside',contractTypeKey:'material_purchase',operating:false,storage:'LOCAL_ONLY'},
  runtime:{...runtime,profile:captured.scope.runtimeProfile,identity:verified.input.identity,runRoot:verified.runRoot,runIdentity:directory(verified.runRoot),sourceWitness:verified.proof.source,
   buildSha256:verified.proof.buildSha256,materialSha256:verified.proof.materialSha256,candidateLockSha256:verified.proof.candidateLockSha256,
   machineReceiptSha256:verified.proof.machineReceiptSha256,physicalReviewSha256:verified.proof.physicalReviewSha256},
  run:{root,identity:directory(root),resourceDir:path.join(root,'resource'),attemptFile:path.join(root,'attempt.json'),receiptFile:path.join(root,'receipt.json')}};
}
function writeNew(file,bytes){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
function prepareCurrent261LocalLifecyclePlan(options){
 need(arguments.length===1,'INPUT');const {runtime,...input}=fixed(options,['packetRoot','daemonId','caseId','businessDate','runtime']);
 const observed=officialRuntime(runtime),captured=capture(),verified=formalRuntime(observed,captured);
 const plan=planFor(input,verified,captured);need(fs.readdirSync(plan.run.root).length===0&&fs.readdirSync(plan.runtime.runRoot).length===0,'USED');
 const file=path.join(plan.packet.root,NAME),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');writeNew(file,bytes);
 return Object.freeze({status:'CURRENT261_LOCAL_LIFECYCLE_PLAN_PREPARED_HOLD',file,sha256:hash(bytes),candidateSha:plan.source.candidateSha});
}
function verifyCurrent261LocalLifecyclePlan(file,digest){
 need(arguments.length===2&&typeof file==='string'&&path.basename(file)===NAME&&hex(digest,64),'INPUT');
 const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
 directory(path.dirname(file));const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:CODE+'_FILE'});need(data.sha256===digest,'DIGEST');
 let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.bytes));}catch{need(false,'JSON');}
 const fields=fixed(raw,['version','purpose','entry','source','scope','packet','resource','case','runtime','run']);
 const runtime=fixed(fields.runtime,['file','sha256','profile','identity','runRoot','runIdentity','sourceWitness','buildSha256','materialSha256','candidateLockSha256','machineReceiptSha256','physicalReviewSha256']);need(runtime.profile==='TASK12_OFFICIAL_TEMURIN17_0_17_10_V1','RUNTIME');
 const observed=officialRuntime({file:runtime.file,sha256:runtime.sha256}),captured=capture(),verified=formalRuntime(observed,captured);
 const input={packetRoot:path.dirname(file),daemonId:fields.resource?.daemonId,caseId:fields.case?.id,businessDate:fields.case?.businessDate};
 const expected=planFor(input,verified,captured);need(equal(expected,fields),'SCOPE');
 need(fs.readdirSync(expected.runtime.runRoot).length===0,'USED');
 let failed=false;
 const check=()=>{need(!failed,'CHANGED');try{
  need(read(file,{privateFile:true,maxBytes:512*1024,expectedIdentity:data.identity,code:CODE+'_CHANGED'}).sha256===digest&&equal(planFor(input,verified,captured),expected),'CHANGED');
  need(read(runtime.file,{privateFile:true,maxBytes:512*1024,expectedIdentity:verified.input.identity,code:CODE+'_RUNTIME_CHANGED'}).sha256===runtime.sha256,'CHANGED');
  captured.loader.verifyFull();
 }catch{failed=true;need(false,'CHANGED');}};
 return Object.freeze({plan:freeze(expected),sha256:digest,buildHandle:captured.handle,runtime:verified.proof,check});
}
module.exports=Object.freeze({prepareCurrent261LocalLifecyclePlan,verifyCurrent261LocalLifecyclePlan});
