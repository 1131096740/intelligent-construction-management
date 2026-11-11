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
const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const ENTRY='services/api/prisma/task12-current259-generated-draft-once.cjs';
const RESOURCE=Object.freeze({transport:CURRENT259_FIRST_Q2_TRANSPORT,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',
  imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'});

const PURPOSE='CURRENT259_GENERATED_DRAFT_LOCAL';
const SCOPE=Object.freeze({stages:Object.freeze(['technical259','roles9','registeredArchive','generatedDraftAcl','seededFiveTls','generatedDraftHttp','ownedCleanup']),
  migrations:259,requests:5,production:false,resourceMs:3600000,httpMs:15000,cos:false,worker:false,approval:false});
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

function planFor(options,source){
  const {packetRoot,daemonId,caseId,businessDate}=fixed(options,['packetRoot','daemonId','caseId','businessDate']);
  need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId)&&typeof caseId==='string'&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(caseId)&&
    typeof businessDate==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)&&!businessDate.startsWith('0000'));
  const day=new Date(businessDate+'T00:00:00.000Z');
  need(Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===businessDate);
  const root=path.join(packetRoot,'run');
  return {version:1,purpose:PURPOSE,entry:ENTRY,source,packet:{root:packetRoot,identity:directory(packetRoot,'DIRECTORY')},
    resource:{...RESOURCE,daemonId},case:{id:caseId,businessDate,relationship:'inside',contractTypeKey:'material_purchase',operating:false},
    run:{root,identity:directory(root,'DIRECTORY'),resourceDir:path.join(root,'resource'),
      attemptFile:path.join(root,'attempt.json'),receiptFile:path.join(root,'receipt.json')},scope:SCOPE};
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
  fixed(options,['packetRoot','daemonId','caseId','businessDate']);
  const captured=material(),plan=planFor(options,captured.source);
  need(fs.readdirSync(plan.run.root).length===0,'RUN_ALREADY_USED');
  const file=path.join(plan.packet.root,'PLAN.json'),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');
  writeNew(file,bytes);
  return Object.freeze({status:'CURRENT259_GENERATED_DRAFT_PLAN_PREPARED_HOLD',file,sha256:hash(bytes),candidateSha:plan.source.candidateSha});
}

function verifyCurrent259GeneratedDraftPlan(file,digest){
  need(arguments.length===2&&hex(digest,64)&&typeof file==='string'&&path.basename(file)==='PLAN.json');
  directory(path.dirname(file),'DIRECTORY');
  const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:'CURRENT259_GENERATED_DRAFT_PLAN_FILE'});
  need(data.sha256===digest,'DIGEST');
  let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.bytes));}catch{throw fault('JSON');}
  const fields=fixed(raw,['version','purpose','entry','source','packet','resource','case','run','scope'],'SCOPE');
  need(fields.version===1&&fields.purpose===PURPOSE&&fields.entry===ENTRY&&equal(fields.scope,SCOPE),'SCOPE');
  const captured=material();
  const options={packetRoot:path.dirname(file),daemonId:fields.resource?.daemonId,caseId:fields.case?.id,businessDate:fields.case?.businessDate};
  const expected=planFor(options,captured.source);
  need(equal(expected,fields),'SCOPE');
  let failed=false;
  function checkContinuity(){
    need(!failed,'CHANGED');
    try{
      need(read(file,{privateFile:true,maxBytes:512*1024,expectedIdentity:data.identity,code:'CURRENT259_GENERATED_DRAFT_PLAN_CHANGED'}).sha256===digest&&
        equal(planFor(options,captured.source),expected),'CHANGED');
    }catch{failed=true;throw fault('CHANGED');}
  }
  function check(){
    checkContinuity();
    try{captured.loader.verifyFull();}catch{failed=true;throw fault('CHANGED');}
    checkContinuity();
  }
  return Object.freeze({plan:freeze(expected),sha256:digest,buildHandle:captured.handle,check,checkContinuity});
}
module.exports=Object.freeze({prepareCurrent259GeneratedDraftPlan,verifyCurrent259GeneratedDraftPlan});

if(require.main===module){
  try{
    const args=process.argv.slice(2);
    let result;
    if(args.length===3&&args[0]==='--prepare'&&args[1]==='--public-input'){
      const file=args[2];
      need(path.basename(file)==='GENERATED-DRAFT-PUBLIC-INPUT.json');
      directory(path.dirname(file),'DIRECTORY');
      const input=read(file,{privateFile:true,maxBytes:16384,collect:true,code:'CURRENT259_GENERATED_DRAFT_PLAN_INPUT'});
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes));
      need(value?.packetRoot===path.dirname(file));
      result=prepareCurrent259GeneratedDraftPlan(value);
    }else{
      need(args.length===5&&args[0]==='--verify'&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256');
      const checked=verifyCurrent259GeneratedDraftPlan(args[2],args[4]);
      result={status:'CURRENT259_GENERATED_DRAFT_PLAN_VERIFIED_HOLD',planSha256:checked.sha256,candidateSha:checked.plan.source.candidateSha};
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stdout.write('{"status":"CURRENT259_GENERATED_DRAFT_PLAN_REJECTED_HOLD"}\n');
    process.exitCode=1;
  }
}
