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
const {current259FirstQ2UploadPrefix,current259FirstOutsideDirectUploadPrefix,current259FirstOutsideOperatingUploadPrefix}=require('../services/api/prisma/task12-current259-q2-fixture.cjs');

const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const ENTRY='services/api/prisma/task12-current259-first-q2-once.cjs';
const RESOURCE=Object.freeze({transport:CURRENT259_FIRST_Q2_TRANSPORT,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',
  imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'});
const PURPOSE='CURRENT259_FIRST_Q2_PRIVATE_COS';
const OUTSIDE_PURPOSE='CURRENT259_FIRST_OUTSIDE_DIRECT_PRIVATE_COS';
const OUTSIDE_OPERATING_PURPOSE='CURRENT259_FIRST_OUTSIDE_OPERATING_PRIVATE_COS';
const SCOPE=Object.freeze({stages:Object.freeze(['technical259','roles9','registeredArchive','ordinaryAcl','seededFiveTls','firstQ2Http','ownedCleanup']),
  migrations:259,requests:9,production:false,resourceMs:3600000,httpsMs:15000});
const OUTSIDE_SCOPE=Object.freeze({...SCOPE,stages:Object.freeze([...SCOPE.stages.slice(0,-2),'firstOutsideDirectHttp','ownedCleanup'])});
const OUTSIDE_OPERATING_SCOPE=Object.freeze({...SCOPE,stages:Object.freeze([...SCOPE.stages.slice(0,-2),'firstOutsideOperatingHttp','ownedCleanup'])});
const PROFILES=Object.freeze({
  upward:Object.freeze({purpose:PURPOSE,scope:SCOPE,uploadPrefix:current259FirstQ2UploadPrefix,status:'CURRENT259_FIRST_Q2'}),
  outside:Object.freeze({purpose:OUTSIDE_PURPOSE,scope:OUTSIDE_SCOPE,uploadPrefix:current259FirstOutsideDirectUploadPrefix,status:'CURRENT259_FIRST_OUTSIDE_DIRECT'}),
  'outside-operating':Object.freeze({purpose:OUTSIDE_OPERATING_PURPOSE,scope:OUTSIDE_OPERATING_SCOPE,
    uploadPrefix:current259FirstOutsideOperatingUploadPrefix,status:'CURRENT259_FIRST_OUTSIDE_OPERATING'}),
});
const MAX_MATERIAL=65536;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/u.test(value);
const fault=phase=>Object.assign(new Error('CURRENT259_FIRST_Q2_PLAN_'+phase),{code:'CURRENT259_FIRST_Q2_PLAN_'+phase});
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
function materialSlot(root,filename,sha256){
  const file=path.join(root,filename);
  let stat;
  try{stat=checkedPath(file,'MATERIAL');}catch{throw fault('MATERIAL');}
  need(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&
    stat.size>0&&stat.size<=MAX_MATERIAL&&hex(sha256,64),'MATERIAL');
  const identity=Object.fromEntries(['dev','ino','uid','gid','mode','size','mtimeMs','ctimeMs'].map(key=>[key,stat[key]]));
  return {file,sha256,identity};
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
function planFor(options,source,scenario){
  const profile=PROFILES[scenario],outside=scenario!=='upward';
  const {packetRoot,daemonId,caseId,businessDate,operating,cos}=fixed(options,['packetRoot','daemonId','caseId','businessDate','operating','cos']);
  need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId)&&typeof operating==='boolean'&&
    typeof businessDate==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)&&!businessDate.startsWith('0000'),'INPUT');
  const day=new Date(businessDate+'T00:00:00.000Z');
  need(Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===businessDate);
  need(!outside||operating===(scenario==='outside-operating'));
  const prefix=profile.uploadPrefix(caseId);
  const storage=fixed(cos,['bucket','region','authorizationRef','expiresAt','canarySha256','canaryBytes','applicationSha256','observerSha256']);
  need(typeof storage.bucket==='string'&&/^jg-q2-[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?-[0-9]{5,14}$/u.test(storage.bucket)&&
    typeof storage.region==='string'&&/^[a-z]{2}(?:-[a-z0-9]+){1,4}$/u.test(storage.region)&&storage.region.length<=63&&
    typeof storage.authorizationRef==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(storage.authorizationRef)&&
    typeof storage.expiresAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/u.test(storage.expiresAt)&&
    Number.isFinite(Date.parse(storage.expiresAt))&&new Date(storage.expiresAt).toISOString()===storage.expiresAt&&
    hex(storage.canarySha256,64)&&Number.isInteger(storage.canaryBytes)&&storage.canaryBytes>0&&storage.canaryBytes<=16384&&
    hex(storage.applicationSha256,64)&&hex(storage.observerSha256,64)&&storage.applicationSha256!==storage.observerSha256);
  const identity=directory(packetRoot,'DIRECTORY'),root=path.join(packetRoot,'run'),inputs=path.join(packetRoot,'cos');
  const runIdentity=directory(root,'DIRECTORY'),inputsIdentity=directory(inputs,'MATERIAL');
  const application=materialSlot(inputs,'application-sts.json',storage.applicationSha256);
  const observer=materialSlot(inputs,'observer-sts.json',storage.observerSha256);
  need(application.identity.dev!==observer.identity.dev||application.identity.ino!==observer.identity.ino,'MATERIAL');
  return {version:1,purpose:profile.purpose,entry:ENTRY,source,packet:{root:packetRoot,identity},
    resource:{...RESOURCE,daemonId},case:{id:caseId,businessDate,operating,...(outside?{relationship:'outside'}:{})},
    cos:{bucket:storage.bucket,region:storage.region,authorizationRef:storage.authorizationRef,expiresAt:storage.expiresAt,prefix,
      inputs:{root:inputs,identity:inputsIdentity},application,observer,
      canary:{key:prefix+'q2-private-canary.bin',sha256:storage.canarySha256,sizeBytes:storage.canaryBytes}},
    run:{root,identity:runIdentity,resourceDir:path.join(root,'resource'),attemptFile:path.join(root,'attempt.json'),
      receiptFile:path.join(root,'receipt.json')},scope:profile.scope};
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
function prepare(options,scenario){
  fixed(options,['packetRoot','daemonId','caseId','businessDate','operating','cos']);
  const captured=material(),plan=planFor(options,captured.source,scenario);
  need(fs.readdirSync(plan.run.root).length===0,'RUN_ALREADY_USED');
  const file=path.join(plan.packet.root,'PLAN.json'),bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');
  writeNew(file,bytes);
  return Object.freeze({status:PROFILES[scenario].status+'_PLAN_PREPARED_HOLD',file,sha256:hash(bytes),candidateSha:plan.source.candidateSha});
}
function prepareCurrent259FirstQ2Plan(options){
  need(arguments.length===1);
  return prepare(options,'upward');
}
function prepareCurrent259FirstOutsideDirectPlan(options){
  need(arguments.length===1);
  return prepare(options,'outside');
}
function prepareCurrent259FirstOutsideOperatingPlan(options){
  need(arguments.length===1);
  return prepare(options,'outside-operating');
}
function verifyCurrent259FirstQ2Plan(file,digest){
  need(arguments.length===2&&hex(digest,64)&&typeof file==='string'&&path.basename(file)==='PLAN.json');
  directory(path.dirname(file),'DIRECTORY');
  const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:'CURRENT259_FIRST_Q2_PLAN_FILE'});
  need(data.sha256===digest,'DIGEST');
  let raw;try{raw=JSON.parse(data.bytes.toString('utf8'));}catch{throw fault('JSON');}
  const fields=fixed(raw,['version','purpose','entry','source','packet','resource','case','cos','run','scope'],'SCOPE');
  const scenario=Object.keys(PROFILES).find(key=>PROFILES[key].purpose===fields.purpose);
  need(fields.version===1&&scenario&&fields.entry===ENTRY&&equal(fields.scope,PROFILES[scenario].scope),'SCOPE');
  const c=fields.cos,k=fields.case;
  need(c&&k&&fields.resource&&c.canary&&c.application&&c.observer,'SCOPE');
  const captured=material();
  const options={packetRoot:path.dirname(file),daemonId:fields.resource.daemonId,caseId:k.id,businessDate:k.businessDate,operating:k.operating,
    cos:{bucket:c.bucket,region:c.region,authorizationRef:c.authorizationRef,expiresAt:c.expiresAt,canarySha256:c.canary.sha256,
      canaryBytes:c.canary.sizeBytes,applicationSha256:c.application.sha256,observerSha256:c.observer.sha256}};
  const expected=planFor(options,captured.source,scenario);
  need(equal(expected.cos,fields.cos),'MATERIAL');
  need(equal(expected,fields),'SCOPE');
  let failed=false;
  function checkContinuity(){
    need(!failed,'CHANGED');
    try{
      need(read(file,{privateFile:true,maxBytes:512*1024,expectedIdentity:data.identity,code:'CURRENT259_FIRST_Q2_PLAN_CHANGED'}).sha256===digest&&
        equal(planFor(options,captured.source,scenario),expected),'CHANGED');
    }catch{failed=true;throw fault('CHANGED');}
  }
  function check(){
    checkContinuity();
    try{captured.loader.verifyFull();}catch{failed=true;throw fault('CHANGED');}
    checkContinuity();
  }
  return Object.freeze({plan:freeze(expected),sha256:digest,buildHandle:captured.handle,loader:captured.loader,check,checkContinuity});
}
module.exports=Object.freeze({prepareCurrent259FirstQ2Plan,prepareCurrent259FirstOutsideDirectPlan,prepareCurrent259FirstOutsideOperatingPlan,verifyCurrent259FirstQ2Plan});

if(require.main===module){
  try{
    const args=process.argv.slice(2);
    let result;
    if(args.length===3&&args[0]==='--prepare'&&args[1]==='--public-input'){
      const publicFile=args[2];
      const filename=path.basename(publicFile);
      const preparers={'Q2-PUBLIC-INPUT.json':prepareCurrent259FirstQ2Plan,
        'OUTSIDE-DIRECT-PUBLIC-INPUT.json':prepareCurrent259FirstOutsideDirectPlan,
        'OUTSIDE-DIRECT-OPERATING-PUBLIC-INPUT.json':prepareCurrent259FirstOutsideOperatingPlan};
      need(Object.hasOwn(preparers,filename));
      directory(path.dirname(publicFile),'DIRECTORY');
      const input=read(publicFile,{privateFile:true,maxBytes:16384,collect:true,code:'CURRENT259_FIRST_Q2_PLAN_INPUT'});
      const value=JSON.parse(input.bytes.toString('utf8'));
      need(value?.packetRoot===path.dirname(publicFile));
      result=preparers[filename](value);
    }else{
      need(args.length===5&&args[0]==='--verify'&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256');
      const checked=verifyCurrent259FirstQ2Plan(args[2],args[4]);
      const profile=Object.values(PROFILES).find(value=>value.purpose===checked.plan.purpose);
      result={status:profile.status+'_PLAN_VERIFIED_HOLD',planSha256:checked.sha256,candidateSha:checked.plan.source.candidateSha};
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stdout.write('{"status":"CURRENT259_FIRST_Q2_PLAN_REJECTED_HOLD"}\n');
    process.exitCode=1;
  }
}
