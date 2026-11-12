#!/usr/bin/env node
'use strict';
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&
  Object.keys(require.cache).every(key=>key===__filename);
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {types}=require('node:util');
const {verifyCurrent259OutsideOperatingReceipt}=require('./task12-current259-outside-operating-proof.cjs');

const cosPermits=new WeakMap(),appPermits=new WeakMap();
let current,entered=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=phase=>Object.assign(new Error('CURRENT259_FIRST_Q2_ONCE_'+phase),{code:'CURRENT259_FIRST_Q2_ONCE_'+phase});
const need=(ok,phase)=>{if(!ok)throw error(phase);};
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const visible=(value,min,max)=>typeof value==='string'&&value.length>=min&&value.length<=max&&/^[!-~]+$/u.test(value);
function fixed(value,names,phase){
  need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===names.length&&
    names.every(name=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,name)??{},'value')),phase);
  return Object.fromEntries(names.map(name=>[name,own(value,name)]));
}
function claim(map,permit,phase){
  const grant=permit&&!types.isProxy(permit)&&map.get(permit);
  if(grant)map.delete(permit);
  need(grant&&grant.state===current&&current.active,'AUTHORITY');
  grant.state.check();
  need(grant.state.phase===phase,'AUTHORITY');
  return grant;
}
function claimCurrent259FirstQ2CosPermit(permit){
  need(arguments.length===1,'AUTHORITY');
  const grant=claim(cosPermits,permit,'COS_PREFLIGHT');
  return Object.freeze({plan:grant.state.plan.cos,outside:grant.state.plan.case.relationship==='outside',
    check:grant.state.check,signal:grant.state.controller.signal,
    application:grant.state.application,observer:grant.state.observer});
}
function claimCurrent259FirstQ2ApplicationPermit(permit,proof,handle,fixture){
  need(arguments.length===4,'AUTHORITY');
  const grant=claim(appPermits,permit,'APPLICATION');
  need(grant.proof===proof&&grant.handle===handle&&grant.fixture===fixture,'AUTHORITY');
  return Object.freeze({fixture,cosPlan:grant.state.plan.cos,cos:grant.state.cos,check:grant.state.check,signal:grant.state.controller.signal});
}
const api=Object.freeze({claimCurrent259FirstQ2CosPermit,claimCurrent259FirstQ2ApplicationPermit});
module.exports=api;

function directorySync(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function writeExclusive(file,bytes,onOpen){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{onOpen?.();fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  directorySync(path.dirname(file));
}
function parseArgs(args){
  need((args.length===4||args.length===5&&args[4]==='--once')&&args[0]==='--plan'&&
    args[2]==='--expected-plan-sha256'&&/^[a-f0-9]{64}$/u.test(args[3]),'ARGS');
  return {file:args[1],digest:args[3],once:args.length===5};
}
function checkHostEnv(){
  need(!Object.keys(process.env).some(key=>/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|COS_.*)$/u.test(key)),'HOST_ENV');
}
const businessDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function checkDate(plan){
  const today=businessDay();
  const expiry=Date.parse(plan.cos.expiresAt),now=Date.now();
  need(today===plan.case.businessDate&&expiry-now>=3900_000&&expiry-now<=86_400_000,'TIME');
}
function material(read,plan,purpose){
  const slot=plan.cos[purpose];
  const captured=read(slot.file,{privateFile:true,maxBytes:65536,collect:true,expectedIdentity:slot.identity,code:'CURRENT259_FIRST_Q2_ONCE_MATERIAL'});
  try{
    need(captured.sha256===slot.sha256,'MATERIAL');
    let row;
    try{row=JSON.parse(captured.bytes.toString('utf8'));}catch{throw error('MATERIAL');}
    const value=fixed(row,['version','purpose','authorizationRef','caseId','bucket','region','prefix','expiresAt',
      'secretId','secretKey','sessionToken'],'MATERIAL');
    need(value.version===1&&value.purpose===purpose&&value.caseId===plan.case.id&&
      ['authorizationRef','bucket','region','prefix','expiresAt'].every(key=>value[key]===plan.cos[key])&&
      visible(value.secretId,16,128)&&/^[A-Za-z0-9_-]+$/u.test(value.secretId)&&visible(value.secretKey,16,256)&&
      visible(value.sessionToken,32,8192),'MATERIAL');
    return Object.freeze({secretId:value.secretId,secretKey:value.secretKey,sessionToken:value.sessionToken});
  }finally{captured.bytes.fill(0);}
}
const receiptCounts={archives:1,evidenceFiles:1,physicalAliases:0,draftSlots:0,approvalRounds:0,sealTasks:0,
  operatingFacts:0,operatingImpacts:0,archiveAudits:1,uploadAudits:1,downloadTicketAudits:1,downloadAudits:1};
const receiptIds=['archiveId','contractId','versionId','fileId','actorId','idempotencyKey'];
const receiptHashes=['fileSha256','downloadSha256','cosCurrentGenerationSha256','cosCurrentContentSha256',
  'cosFixedGenerationSha256','cosFixedContentSha256','inputSha256','requestSha256','authoritySha256'];
const receiptKeys=[...receiptIds,'status','revision','effectiveAt','operatingMode','fileBytes','fileSha256','downloadBytes','downloadSha256',
  'cosCurrentGenerationSha256','cosCurrentContentSha256','cosCurrentBytes','cosFixedGenerationSha256','cosFixedContentSha256','cosFixedBytes',
  'inputSha256','requestSha256','authoritySha256',...Object.keys(receiptCounts)];
const isSha256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
// Reproduce the v1 length-prefixed public archive request from the safe receipt.
function archiveRequestSha256(row){
  const parts=['contract-direct-archive-request-v1','2','direct_signed',row.contractId,row.versionId,row.actorId,row.idempotencyKey,
    String(row.revision),row.inputSha256,'1',row.fileId,'true'];
  return hash(parts.map(value=>Buffer.byteLength(value,'utf8')+':'+value).join(''));
}
function validateReceiptEvidence(result,operating,fixture,outside){
  const outsideOperating=outside&&operating;
  const keys=outside?[...receiptKeys,'persistedGenerationSha256',...(outsideOperating?['operatingLedger']:[])]:receiptKeys;
  const evidence=fixed(own(result,'evidence'),keys,'RESULT'),evidenceSha256=own(result,'evidenceSha256');
  need(receiptIds.every(key=>typeof evidence[key]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(evidence[key]))&&
    receiptHashes.every(key=>isSha256(evidence[key]))&&evidence.status==='effective'&&evidence.revision===2&&
    typeof evidence.effectiveAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(evidence.effectiveAt)&&
    Number.isFinite(Date.parse(evidence.effectiveAt))&&evidence.operatingMode===(outsideOperating?'projection_required':operating?'internal_reference_only':'not_applicable')&&
    Number.isInteger(evidence.fileBytes)&&evidence.fileBytes>0&&evidence.fileBytes<=16384&&
    evidence.downloadBytes===evidence.fileBytes&&evidence.downloadSha256===evidence.fileSha256&&
    evidence.cosCurrentBytes===evidence.fileBytes&&evidence.cosFixedBytes===evidence.fileBytes&&
    evidence.cosCurrentContentSha256===evidence.fileSha256&&evidence.cosFixedContentSha256===evidence.fileSha256&&
    evidence.cosCurrentGenerationSha256===evidence.cosFixedGenerationSha256&&
    (!outside||evidence.persistedGenerationSha256===evidence.cosFixedGenerationSha256)&&
    evidence.actorId===fixture.actorId&&evidence.fileId===fixture.fileId&&evidence.idempotencyKey===fixture.idempotencyKey&&
    archiveRequestSha256(evidence)===evidence.requestSha256&&
    Object.entries(receiptCounts).every(([key,value])=>evidence[key]===
      (outsideOperating&&['operatingFacts','operatingImpacts'].includes(key)?1:value))&&
    (!outsideOperating||verifyCurrent259OutsideOperatingReceipt(evidence.operatingLedger))&&
    isSha256(evidenceSha256)&&hash(JSON.stringify(evidence))===evidenceSha256,'RESULT');
  return {evidence,evidenceSha256};
}
function writeReceipt(state,status,cleanup,proof){
  const receipt={status,phase:state.phase,planSha256:state.sha256,sourceSha:state.plan.source.candidateSha,
    caseId:state.plan.case.id,...(state.plan.case.relationship==='outside'?{relationship:'outside'}:{}),caseMode:state.plan.case.operating?'operating':'non-operating',cleanup,...proof};
  writeExclusive(state.plan.run.receiptFile,Buffer.from(JSON.stringify(receipt)+'\n'));
  return receipt;
}
function safeCleanup(primary,state){
  if(!state.resourceEntered)return 'NOT_STARTED';
  const receipt=own(primary,'resourceReceipt');
  return own(primary,'resourceCleanup')||own(primary,'appCleanupOutcome')||own(primary,'clientCleanup')==='UNKNOWN'||
    own(receipt,'status')==='cleanup_failed'?'UNKNOWN':'OWNER_SCOPE_RETURNED';
}
const preflightPlanReasons=Object.freeze({
  CURRENT259_FIRST_Q2_PLAN_DIRECTORY:'PLAN_DIRECTORY',
  CURRENT259_FIRST_Q2_PLAN_FILE:'PLAN_FILE',
  CURRENT259_FIRST_Q2_PLAN_DIGEST:'PLAN_DIGEST',
  CURRENT259_FIRST_Q2_PLAN_JSON:'PLAN_JSON',
  CURRENT259_FIRST_Q2_PLAN_SCOPE:'PLAN_SCOPE',
  CURRENT259_FIRST_Q2_PLAN_MATERIAL:'PLAN_MATERIAL',
  CURRENT259_FIRST_Q2_PLAN_CHANGED:'PLAN_CHANGED',
  CURRENT259_BUILD_SOURCE_NOT_CLEAN:'BUILD_SOURCE_NOT_CLEAN',
  CURRENT259_BUILD_SOURCE_CHANGED:'BUILD_SOURCE_CHANGED',
  CURRENT259_BUILD_TREE_CHANGED:'BUILD_TREE_CHANGED',
  CURRENT259_BUILD_ENVIRONMENT:'BUILD_ENVIRONMENT',
  CURRENT259_LOADER_CHANGED:'LOADER_CHANGED',
});
function preflightDetail(stage,cause){
  const code=own(cause,'code');
  const reason=(stage==='PLAN_VERIFY'||stage==='PLAN_RECHECK')&&typeof code==='string'&&Object.hasOwn(preflightPlanReasons,code)
    ?preflightPlanReasons[code]:undefined;
  return {preflightFailure:stage,...(reason?{preflightReason:reason}:{})};
}
async function main(){
  let state,checked,attempted=false,primary,cleanup='NOT_STARTED',preflight='FRESH';
  const signal=()=>{if(state)state.controller.abort();};
  try{
    need(FRESH&&!entered,'FRESH');entered=true;
    preflight='ARGS';
    const args=parseArgs(process.argv.slice(2));
    preflight='PLAN_IMPORT';
    const {verifyCurrent259FirstQ2Plan}=require('../../../scripts/prepare-task12-current259-first-q2.cjs');
    preflight='PLAN_VERIFY';
    checked=verifyCurrent259FirstQ2Plan(args.file,args.digest);
    const outside=checked.plan.case.relationship==='outside', outsideOperating=outside&&checked.plan.case.operating;
    const scenario=outsideOperating?'CURRENT259_FIRST_OUTSIDE_OPERATING':outside?'CURRENT259_FIRST_OUTSIDE_DIRECT':'CURRENT259_FIRST_Q2';
    if(args.once){
      preflight='HOST_ENV';checkHostEnv();
      preflight='TIME';checkDate(checked.plan);
      preflight='PLAN_RECHECK';checked.check();
    }
    preflight='DEPENDENCIES';
    const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
    const {openCurrent259FirstQ2Cos}=require('./task12-current259-first-q2-cos-native.cjs');
    const {withCurrent259FirstQ2LoopbackResource}=require('./task16-current259-owned-resource.cjs');
    const {createCurrent259TechnicalMigration}=require('./local-staged-current259-profile.cjs');
    const {provisionCurrent259Roles}=require('./task16-current259-role-provision.cjs');
    const {installCurrent259ArchiveAuthoritiesWithRegisteredFileSource}=require('./task16-current259-archive-install.cjs');
    const {installCurrent259OrdinaryArchiveAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
    const {withCurrent259FirstQ2SeededLogin,withCurrent259FirstQ2NativeApplication}=require('./task12-current259-contract-login.cjs');
    const {buildCurrent259FirstQ2Fixture,buildCurrent259FirstOutsideDirectFixture,buildCurrent259FirstOutsideOperatingFixture}=require('./task12-current259-q2-fixture.cjs');
    need([openCurrent259FirstQ2Cos,withCurrent259FirstQ2LoopbackResource,withCurrent259FirstQ2NativeApplication].every(fn=>typeof fn==='function'),'INCOMPLETE');
    const buildFixture=outsideOperating?buildCurrent259FirstOutsideOperatingFixture
      :outside?buildCurrent259FirstOutsideDirectFixture:buildCurrent259FirstQ2Fixture;
    need(typeof buildFixture==='function','INCOMPLETE');
    if(!args.once)return {status:scenario+'_HOLD',planSha256:args.digest};
    const plan=checked.plan,sha256=checked.sha256,controller=new AbortController();
    const marker=Buffer.from(JSON.stringify({status:'CONSUMED',planSha256:sha256,sourceSha:plan.source.candidateSha,caseId:plan.case.id})+'\n');
    preflight='RUN_DIRECTORY';
    need(fs.readdirSync(plan.run.root).length===0,'ATTEMPT_USED');
    preflight='ATTEMPT_WRITE';
    writeExclusive(plan.run.attemptFile,marker,()=>{attempted=true;});
    preflight='ATTEMPT_VERIFY';
    const evidence=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,code:'CURRENT259_FIRST_Q2_ONCE_ATTEMPT'});
    need(evidence.sha256===hash(marker),'ATTEMPT');
    state={plan,sha256,controller,active:true,resourceEntered:false,phase:'MATERIAL',check(){
      need(state.active&&state===current&&!controller.signal.aborted&&Date.now()<Date.parse(plan.cos.expiresAt)&&businessDay()===plan.case.businessDate,'CONTINUITY');
      checked.checkContinuity();
      need(read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,expectedIdentity:evidence.identity,
        code:'CURRENT259_FIRST_Q2_ONCE_ATTEMPT'}).sha256===evidence.sha256,'ATTEMPT');
    },checkFull(){state.check();checked.check();state.check();}};
    current=state;
    process.once('SIGINT',signal);process.once('SIGTERM',signal);
    state.check();
    state.application=material(read,plan,'application');
    state.observer=material(read,plan,'observer');
    need(['secretId','secretKey','sessionToken'].every(key=>state.application[key]!==state.observer[key]),'MATERIAL');
    state.phase='COS_PREFLIGHT';
    const permit=Object.freeze({});
    cosPermits.set(permit,{state});
    try{state.cos=await openCurrent259FirstQ2Cos(permit);}finally{cosPermits.delete(permit);}
    state.checkFull();
    state.phase='RESOURCE';state.resourceEntered=true;
    const receipt=await withCurrent259FirstQ2LoopbackResource(checked.buildHandle,{artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},
      controller.signal,async handle=>{
        const stage=async(name,use)=>{state.phase=name;state.checkFull();const value=await use();state.checkFull();return value;};
        const technical=await stage('MIGRATE',()=>createCurrent259TechnicalMigration(handle,controller.signal).migrate());
        const roles=await stage('ROLES',()=>provisionCurrent259Roles(technical,handle));
        const archive=await stage('ARCHIVE_AUTHORITIES',()=>installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(roles,handle));
        const acl=await stage('ORDINARY_ACL',()=>installCurrent259OrdinaryArchiveAcl(archive,handle));
        const fixture=outside?buildFixture(plan.case.id,plan.case.businessDate)
          :buildFixture(plan.case.id,plan.case.businessDate,plan.case.operating);
        need(fixture.uploadPrefix===plan.cos.prefix&&fixture.relationship===(outside?'outside':undefined)&&
          fixture.outsideOperating===(outsideOperating?true:undefined),'SCOPE');
        state.receiptFixture=Object.freeze({actorId:fixture.seed.User.id,fileId:fixture.original.fileId,idempotencyKey:fixture.archiveIdempotencyKey});
        return stage('SEEDED_LOGIN',()=>withCurrent259FirstQ2SeededLogin(acl,handle,fixture,async proof=>{
          state.phase='APPLICATION';
          state.checkFull();state.cos.check();
          const appPermit=Object.freeze({});
          appPermits.set(appPermit,{state,handle,proof,fixture});
          try{return await withCurrent259FirstQ2NativeApplication(proof,handle,appPermit);}finally{appPermits.delete(appPermit);}
        }));
      });
    cleanup='CLOSED';
    state.phase='COMPLETE';
    const proofSha256=own(receipt,'proofSha256');
    need(own(receipt,'status')===scenario+'_HTTP_AND_NEST_CLOSED'&&own(receipt,'httpSteps')===9&&
      own(receipt,'verifiedClients')===5&&own(receipt,'storageAcceptance')===true&&
      isSha256(proofSha256),'RESULT');
    const projected=validateReceiptEvidence(receipt,plan.case.operating,state.receiptFixture,outside);
    state.checkFull();
    return writeReceipt(state,scenario+'_ACCEPTANCE_COMPLETE',cleanup,{proofSha256,...projected});
  }catch(cause){
    primary=cause;
    process.exitCode=1;
    cleanup=state?safeCleanup(primary,state):'NOT_STARTED';
    if(attempted&&state){
      try{return writeReceipt(state,'CURRENT259_FIRST_Q2_STOPPED',cleanup);}catch{cleanup='UNKNOWN';}
    }
    return {status:'CURRENT259_FIRST_Q2_STOPPED',phase:state?.phase??'PREFLIGHT',attempted,cleanup,...(!state?preflightDetail(preflight,cause):{})};
  }finally{
    if(state){
      state.active=false;state.controller.abort();state.cos?.close();
      state.application=undefined;state.observer=undefined;current=undefined;
    }
    process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
  }
}
// The native COS consumer imports this module's frozen permit exports.
// Start after CommonJS has finished loading the entry to avoid a circular import.
if(require.main===module)void Promise.resolve().then(main).then(result=>process.stdout.write(JSON.stringify(result)+'\n'));
