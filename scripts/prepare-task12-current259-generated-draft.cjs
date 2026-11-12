#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
// The real lineage must capture the original loader before anything else.
const {CURRENT259_FIRST_Q2_TRANSPORT}=require('../services/api/prisma/task12-current259-contract-login.cjs');
const {observeCurrent259Build}=require('../services/api/prisma/task16-current259-build.cjs');
const {loadCurrent259Client}=require('../services/api/prisma/task16-current259-client-loader.cjs');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
const {currentArchiveLedgerSize}=require('../services/api/prisma/task16-current259-profile.cjs');
const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const ENTRY='services/api/prisma/task12-current259-generated-draft-once.cjs';
const RESOURCE=Object.freeze({transport:CURRENT259_FIRST_Q2_TRANSPORT,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',
  imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'});

const PURPOSE='CURRENT259_GENERATED_DRAFT_LOCAL';
const SCOPE=Object.freeze({stages:Object.freeze(['technical259','roles9','registeredArchive','generatedDraftAcl','seededFiveTls','generatedDraftHttp','ownedCleanup']),
  migrations:259,requests:5,production:false,resourceMs:3600000,httpMs:15000,cos:false,worker:false,approval:false});
const DOCUMENT=Object.freeze({
  purpose:'CURRENT259_GENERATED_DOCUMENT_LOCAL',
  entry:'services/api/prisma/task12-current259-generated-document-once.cjs',
  planName:'DOCUMENT-PLAN.json',
  scope:Object.freeze({
    stages:Object.freeze(['technical259','roles9','registeredArchive','ordinaryDocumentAcl','documentRoles','documentAcl',
      'pinnedDocumentRuntime','publicTemplateDraftSaveGenerateReadback','independentOwnerReadback','ownedCleanup']),
    migrations:259,production:false,resourceMs:3600000,cos:false,worker:true,approval:false
  })
});
const DRAFT=Object.freeze({purpose:PURPOSE,entry:ENTRY,planName:'PLAN.json',scope:SCOPE});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/u.test(value);
const fault=phase=>Object.assign(new Error('CURRENT259_GENERATED_DRAFT_PLAN_'+phase),{code:'CURRENT259_GENERATED_DRAFT_PLAN_'+phase});
const need=(ok,phase='INPUT')=>{if(!ok)throw fault(phase);};
function fixed(input,keys,phase='INPUT'){
  need(input&&!types.isProxy(input)&&Object.getPrototypeOf(input)===Object.prototype&&Reflect.ownKeys(input).length===keys.length,phase);
  return Object.fromEntries(keys.map(key=>{
    const d=Object.getOwnPropertyDescriptor(input,key);
    need(d&&Object.hasOwn(d,'value'),phase);
    return [key,d.value];
  }));
}
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function checkedPath(file,phase){
  need(typeof file==='string'&&file.startsWith('/private/tmp/')&&path.normalize(file)===file&&
    file!==ROOT&&!file.startsWith(ROOT+path.sep),phase);
  let cursor='/';
  for(const part of file.slice(1).split('/')){
    cursor=path.join(cursor,part);
    need(!fs.lstatSync(cursor).isSymbolicLink(),phase);
  }
  need(fs.realpathSync(file)===file,phase);
  return fs.lstatSync(file);
}
function directory(dir,phase){
  let stat;
  try{stat=checkedPath(dir,phase);}catch{throw fault(phase);}
  need(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,phase);
  return Object.fromEntries(['dev','ino','uid','gid','mode'].map(key=>[key,stat[key]]));
}
let build;
function material(){
  if(!build){
    const handle=observeCurrent259Build(),loader=loadCurrent259Client(handle);
    const w=loader.witness(),s=w.source;
    build={handle,loader,source:freeze(JSON.parse(JSON.stringify({
      candidateSha:s.candidateSha,tree:s.tree,sourceSealSha256:s.sourceSealSha256,ledgerSha256:s.profile.ledgerSha256,
      prefix256Sha256:s.profile.prefix256Sha256,schemaSha256:s.profile.schemaSha256,
      build:w.build,host:w.host,engineCommit:w.engineCommit
    })))};
  }
  build.loader.verifyFull();
  return build;
}

function archiveScope(scope,source){
  const migrations=currentArchiveLedgerSize(source.ledgerSha256);
  return {...scope,migrations,stages:[`technical${migrations}`,...scope.stages.slice(1)]};
}
function planFor(options,source,protocol,runtime){
  const {packetRoot,daemonId,caseId,businessDate}=fixed(options,['packetRoot','daemonId','caseId','businessDate']);
  need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId)&&typeof caseId==='string'&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(caseId)&&
    typeof businessDate==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)&&!businessDate.startsWith('0000'));
  const day=new Date(businessDate+'T00:00:00.000Z');
  need(Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===businessDate);
  const root=path.join(packetRoot,'run');
  return {version:1,purpose:protocol.purpose,entry:protocol.entry,source,packet:{root:packetRoot,identity:directory(packetRoot,'DIRECTORY')},
    resource:{...RESOURCE,daemonId},case:{id:caseId,businessDate,relationship:'inside',contractTypeKey:'material_purchase',operating:false},
    run:{root,identity:directory(root,'DIRECTORY'),resourceDir:path.join(root,'resource'),
      attemptFile:path.join(root,'attempt.json'),receiptFile:path.join(root,'receipt.json')},scope:archiveScope(protocol.scope,source),
    ...(runtime?{runtime}:{})};
}
function writeNew(file,bytes){
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

function prepareCurrent259GeneratedDraftPlan(options){
  need(arguments.length===1);
  return preparePlan(options,DRAFT);
}

function documentRuntime(input,packetRoot){
  const runtime=fixed(input,['file','sha256'],'RUNTIME');
  need(runtime.file===path.join(packetRoot,'runtime-input.json')&&hex(runtime.sha256,64)&&
    checkedPath(runtime.file,'RUNTIME').isFile(),'RUNTIME');
  const data=read(runtime.file,{privateFile:true,maxBytes:64*1024,code:'CURRENT259_GENERATED_DOCUMENT_RUNTIME_INPUT'});
  need(data.sha256===runtime.sha256,'RUNTIME');
  const {verifyCurrent259GeneratedDocumentRuntime}=require('../services/api/prisma/task12-current259-generated-document-runtime.cjs');
  return {coordinates:runtime,identity:data.identity,verified:verifyCurrent259GeneratedDocumentRuntime(runtime.file,runtime.sha256)};
}

function prepareCurrent259GeneratedDocumentPlan(options){
  need(arguments.length===1);
  const {runtime,...common}=fixed(options,['packetRoot','daemonId','caseId','businessDate','runtime']);
  need(typeof common.packetRoot==='string','DIRECTORY');
  return preparePlan(common,DOCUMENT,documentRuntime(runtime,common.packetRoot).coordinates);
}

function preparePlan(options,protocol,runtime){
  const captured=material(),plan=planFor(options,captured.source,protocol,runtime);
  need(fs.readdirSync(plan.run.root).length===0,'RUN_ALREADY_USED');
  const file=path.join(plan.packet.root,protocol.planName),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');
  writeNew(file,bytes);
  return Object.freeze({status:`${protocol.purpose.slice(0,-6)}_PLAN_PREPARED_HOLD`,file,sha256:hash(bytes),candidateSha:plan.source.candidateSha});
}

function verifyCurrent259GeneratedDraftPlan(file,digest){
  need(arguments.length===2);
  return verifyPlan(file,digest,DRAFT);
}

function verifyCurrent259GeneratedDocumentPlan(file,digest){
  need(arguments.length===2);
  return verifyPlan(file,digest,DOCUMENT);
}

function verifyPlan(file,digest,protocol){
  need(hex(digest,64)&&typeof file==='string'&&path.basename(file)===protocol.planName);
  directory(path.dirname(file),'DIRECTORY');
  const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:'CURRENT259_GENERATED_DRAFT_PLAN_FILE'});
  need(data.sha256===digest,'DIGEST');
  let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.bytes));}catch{throw fault('JSON');}
  const document=protocol===DOCUMENT;
  const fields=fixed(raw,['version','purpose','entry','source','packet','resource','case','run','scope',...(document?['runtime']:[])],'SCOPE');
  need(fields.version===1&&fields.purpose===protocol.purpose&&fields.entry===protocol.entry,'SCOPE');
  const runtime=document?documentRuntime(fields.runtime,path.dirname(file)):undefined;
  const captured=material();
  const options={packetRoot:path.dirname(file),daemonId:fields.resource?.daemonId,caseId:fields.case?.id,businessDate:fields.case?.businessDate};
  const expected=planFor(options,captured.source,protocol,runtime?.coordinates);
  need(equal(expected,fields),'SCOPE');
  let failed=false;
  function checkContinuity(){
    need(!failed,'CHANGED');
    try{
      need(read(file,{privateFile:true,maxBytes:512*1024,expectedIdentity:data.identity,code:'CURRENT259_GENERATED_DRAFT_PLAN_CHANGED'}).sha256===digest&&
        equal(planFor(options,captured.source,protocol,runtime?.coordinates),expected),'CHANGED');
      if(runtime){
        need(read(runtime.coordinates.file,{privateFile:true,maxBytes:64*1024,expectedIdentity:runtime.identity,
          code:'CURRENT259_GENERATED_DOCUMENT_RUNTIME_CHANGED'}).sha256===runtime.coordinates.sha256,'CHANGED');
      }
    }catch{failed=true;throw fault('CHANGED');}
  }
  function check(){
    checkContinuity();
    try{captured.loader.verifyFull();}catch{failed=true;throw fault('CHANGED');}
    checkContinuity();
  }
  return Object.freeze({plan:freeze(expected),sha256:digest,buildHandle:captured.handle,check,checkContinuity,
    ...(runtime?{runtime:runtime.verified}:{})});
}
module.exports=Object.freeze({prepareCurrent259GeneratedDraftPlan,verifyCurrent259GeneratedDraftPlan,
  prepareCurrent259GeneratedDocumentPlan,verifyCurrent259GeneratedDocumentPlan});

if(require.main===module){
  try{
    const args=process.argv.slice(2);
    let result;
    const document=args[0]==='--prepare-document'||args[0]==='--verify-document';
    const protocol=document?DOCUMENT:DRAFT;
    if(args.length===3&&['--prepare','--prepare-document'].includes(args[0])&&args[1]==='--public-input'){
      const file=args[2];
      need(path.basename(file)===(document?'GENERATED-DOCUMENT-PUBLIC-INPUT.json':'GENERATED-DRAFT-PUBLIC-INPUT.json'));
      directory(path.dirname(file),'DIRECTORY');
      const input=read(file,{privateFile:true,maxBytes:16384,collect:true,code:'CURRENT259_GENERATED_DRAFT_PLAN_INPUT'});
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes));
      need(value?.packetRoot===path.dirname(file));
      result=(document?prepareCurrent259GeneratedDocumentPlan:prepareCurrent259GeneratedDraftPlan)(value);
    }else{
      need(args.length===5&&['--verify','--verify-document'].includes(args[0])&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256');
      const checked=verifyPlan(args[2],args[4],protocol);
      result={status:`${protocol.purpose.slice(0,-6)}_PLAN_VERIFIED_HOLD`,planSha256:checked.sha256,candidateSha:checked.plan.source.candidateSha};
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    const document=['--prepare-document','--verify-document'].includes(process.argv[2]);
    process.stdout.write(JSON.stringify({status:document?'CURRENT259_GENERATED_DOCUMENT_PLAN_REJECTED_HOLD':'CURRENT259_GENERATED_DRAFT_PLAN_REJECTED_HOLD'})+'\n');
    process.exitCode=1;
  }
}
