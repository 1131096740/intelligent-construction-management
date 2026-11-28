#!/usr/bin/env node
'use strict';
// Offline source/build observation only. No resource start or client constructor.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {types,isDeepStrictEqual}=require('node:util');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
require('../services/api/prisma/task16-current259-payment-run-authorization.cjs');
const {PAYMENT259_LEDGER_SHA256,PAYMENT261_LEDGER_SHA256,PAYMENT261_RUNTIME_PROFILE}=require('../services/api/prisma/task16-current259-profile.cjs');
const {loadCurrent259CatalogMaterial}=require('../services/api/prisma/task16-current259-catalog.cjs');
const {isCurrentPaymentRuntimeMode}=require('../services/api/prisma/task16-current261-competition-profile.cjs');
const {observeCurrent259Build}=require('../services/api/prisma/task16-current259-build.cjs');
const {loadCurrent259Client}=require('../services/api/prisma/task16-current259-client-loader.cjs');
const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const PURPOSE='current259-payment-technical-install-through-b7';
const PFQ_PURPOSE='current259-pfq-composition-and-concurrency';
const PAYMENT261_PURPOSE='current261-payment-technical-install-through-b7';
const ENTRY='services/api/prisma/task16-current259-payment-run-authorization.cjs';
const ENDPOINT='unix:///Users/leoyang/.docker/run/docker.sock';
const IMAGE='sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d';
const SCOPE=Object.freeze({
 stages:Object.freeze(['technical259','roles9','sevenFragments','paymentAcl','b7','ownedCleanup']),
 migrations:259,roles:Object.freeze(['jg_c259_outside_executor_login','jg_c259_outside_executor_owner','jg_c259_outside_issuer_login','jg_c259_outside_issuer_owner','jg_c259_upward_issuer_login','jg_c259_upward_issuer_owner','jg_c259_upward_runtime_login','jg_task01_observer','jg_task01_runtime']),
 ordinaryApplication:'PRESERVE_ORIGINAL_OID_LOGIN_NULL_PASSWORD_LIMIT0',dedicatedRoleCredentials:'NULL_PASSWORDS',runtimeObserverCredentials:'ORIGINAL_RESOURCE_PRIVATE_SCRAM',
 archiveActivation:false,applications:false,environmentPreparation:false,fixtures:false,businessWrites:false,liveSessionAdmission:false,financialAcceptance:false
});
const PFQ_SCOPE=Object.freeze({...SCOPE,stages:Object.freeze([...SCOPE.stages.slice(0,-1),'pfqConcurrency','ownedCleanup']),
 databaseTransport:'FIRST_ROLLBACK_LOOPBACK_TLS_V1',fixtures:true,businessWrites:true,
 pfqCases:13,pfqJestFile:'src/database/project-financing-quota-concurrency.spec.ts'});
const PAYMENT261_SCOPE=Object.freeze({...SCOPE,stages:Object.freeze(['technical261',...SCOPE.stages.slice(1)]),
 migrations:261,paymentProfile:PAYMENT261_RUNTIME_PROFILE});
const INSTALL=Object.freeze({purpose:PURPOSE,scope:SCOPE,ledgerSha256:PAYMENT259_LEDGER_SHA256,status:'PAYMENT_INSTALL_PLAN'});
const PFQ=Object.freeze({purpose:PFQ_PURPOSE,scope:PFQ_SCOPE,ledgerSha256:PAYMENT259_LEDGER_SHA256,status:'PFQ_COMPOSITION_PLAN'});
const PAYMENT261=Object.freeze({purpose:PAYMENT261_PURPOSE,scope:PAYMENT261_SCOPE,ledgerSha256:PAYMENT261_LEDGER_SHA256,status:'PAYMENT261_INSTALL_PLAN'});
const LIMITS=Object.freeze({resourceMs:3600000,migrationDeployMs:180000,ownerSqlMs:120000,sqlInputBytes:16777216,cpu:2,memoryBytes:1073741824,pids:256,pgdataBytes:536870912});
const TOOLS=Object.freeze({docker:{path:'/Applications/Docker.app/Contents/Resources/bin/docker',sha256:'6c3c88771987b73d66d0664b22800f46c827f96db67579594d39163ab88e8c40'},openssl:{path:'/opt/homebrew/Cellar/openssl@3/3.6.3/bin/openssl',sha256:'103fc7706cf6646f226d96f29242d81890363499afc730e7ef1fadd64b3a123c'}});
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function own(value,key){need(value&&!types.isProxy(value),'PAYMENT_INSTALL_PLAN_DATA');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'PAYMENT_INSTALL_PLAN_DATA');return d.value;}
function keys(value,names){need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===names.length,'PAYMENT_INSTALL_PLAN_DATA');return Object.fromEntries(names.map(k=>[k,own(value,k)]));}
function privateDirectory(dir){
 need(typeof dir==='string'&&dir.startsWith('/private/tmp/')&&path.normalize(dir)===dir&&dir!==ROOT&&!dir.startsWith(ROOT+path.sep)&&fs.realpathSync(dir)===dir,'PAYMENT_INSTALL_PLAN_DIRECTORY');
 let cursor=path.parse(dir).root;for(const part of dir.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);need(!fs.lstatSync(cursor).isSymbolicLink(),'PAYMENT_INSTALL_PLAN_DIRECTORY');}
 const st=fs.lstatSync(dir);need(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PAYMENT_INSTALL_PLAN_DIRECTORY');
 return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]]));
}
function outsideFile(file){need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&file!==ROOT&&!file.startsWith(ROOT+path.sep),'PAYMENT_INSTALL_PLAN_PATH');privateDirectory(path.dirname(file));return file;}
function writeNew(file,bytes){
 outsideFile(file);let fd;
 try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function toolsCheck(expected){
 const result={};
 for(const [name,spec]of Object.entries(TOOLS)){
  need(fs.realpathSync(spec.path)===spec.path,'PAYMENT_INSTALL_PLAN_TOOL');
  const capture=read(spec.path,{maxBytes:128*1024*1024,code:'PAYMENT_INSTALL_PLAN_TOOL'});
  need(capture.sha256===spec.sha256,'PAYMENT_INSTALL_PLAN_TOOL');
  result[name]={...spec,identity:capture.identity};
 }
 if(expected)need(isDeepStrictEqual(result,expected),'PAYMENT_INSTALL_PLAN_TOOL');
 return result;
}
const observedMaterials=new Map();
function material(paymentProfile){
 const cached=observedMaterials.get(paymentProfile);
 if(cached){cached.loader.verifyFull();toolsCheck(cached.observed.tools);return cached;}
 const buildHandle=observeCurrent259Build(),loader=loadCurrent259Client(buildHandle);loader.verifyFull();const w=loader.witness();
 if(paymentProfile!==undefined)need(w.source.profile.ledgerSha256===PAYMENT261_LEDGER_SHA256,'PAYMENT_INSTALL_PLAN_SCOPE');
 const source=w.source,profile=source.profile;
 const catalog=loadCurrent259CatalogMaterial({candidateSha:source.candidateSha,sealSha256:source.sourceSealSha256,schemaSha256:profile.schemaSha256,migrations:profile.ledger.map(row=>({path:'services/api/prisma/migrations/'+row.name+'/migration.sql',sha256:row.sha256}))},paymentProfile);
 const tools=toolsCheck();
 const observed=copy({tools,installation:{registeredManifestSha256:catalog.registeredManifestSha256,...(catalog.effectiveAccessBinding?{effectiveAccessBinding:catalog.effectiveAccessBinding}:{}),sevenFragments:catalog.sevenFragments,readerBodySha256:catalog.readerBodySha256,readerSqlSha256:catalog.readerSqlSha256},source:{candidateSha:w.source.candidateSha,tree:w.source.tree,sourceSealSha256:w.source.sourceSealSha256,ledgerSha256:w.source.profile.ledgerSha256,prefix256Sha256:w.source.profile.prefix256Sha256,schemaSha256:w.source.profile.schemaSha256},build:w.build,host:w.host,engineCommit:w.engineCommit});
 const result=Object.freeze({buildHandle,loader,observed:freeze(observed)});observedMaterials.set(paymentProfile,result);return result;
}
function expectedPlan(runRoot,daemonId,observed,profile){
 need(typeof daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(daemonId),'PAYMENT_INSTALL_PLAN_DAEMON');
 need(observed.source.ledgerSha256===profile.ledgerSha256,'PAYMENT_INSTALL_PLAN_SCOPE');
 return {schemaVersion:1,purpose:profile.purpose,root:ROOT,entry:ENTRY,material:observed,resource:{endpoint:ENDPOINT,imageId:IMAGE,daemonId},run:{root:runRoot,identity:privateDirectory(runRoot),resourceDir:path.join(runRoot,'resource'),attemptFile:path.join(runRoot,'attempt.json'),receiptFile:path.join(runRoot,'receipt.json')},scope:{...profile.scope},limits:{...LIMITS}};
}
function prepareCurrent259PaymentInstallPlan(options){
 need(arguments.length===1,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return prepare(options,INSTALL);
}
function prepareCurrent259PfqCompositionPlan(options){
 need(arguments.length===1,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return prepare(options,PFQ);
}
function payment261Plan(paymentProfile){
 need(paymentProfile!==undefined&&(isCurrentPaymentRuntimeMode(paymentProfile,false)||isCurrentPaymentRuntimeMode(paymentProfile,true)),'PAYMENT_INSTALL_PLAN_SCOPE');
 return {...PAYMENT261,scope:{...PAYMENT261.scope,paymentProfile}};
}
function prepareCurrent261PaymentInstallPlan(options,paymentProfile=PAYMENT261_RUNTIME_PROFILE){
 need(arguments.length===1||arguments.length===2,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return prepare(options,payment261Plan(paymentProfile));
}
function prepare(options,profile){
 const o=keys(options,['runRoot','daemonId','output']);outsideFile(o.output);
 const captured=material(profile.scope.paymentProfile),plan=expectedPlan(o.runRoot,o.daemonId,captured.observed,profile);
 need(![plan.run.resourceDir,plan.run.attemptFile,plan.run.receiptFile,plan.run.receiptFile+'.pending'].includes(o.output),'PAYMENT_INSTALL_PLAN_OUTPUT_RESERVED');
 need(![plan.run.resourceDir,plan.run.attemptFile,plan.run.receiptFile].some(p=>fs.existsSync(p)),'PAYMENT_INSTALL_PLAN_RUN_ALREADY_USED');
 captured.loader.verifyFull();const bytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');writeNew(o.output,bytes);
 return Object.freeze({status:profile.status+'_PREPARED_NO_RESOURCES',file:o.output,sha256:hash(bytes),candidateSha:plan.material.source.candidateSha});
}
function readCurrent259PaymentInstallPlan(file,digest){
 need(arguments.length===2,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return readPlan(file,digest,INSTALL);
}
function readCurrent259PfqCompositionPlan(file,digest){
 need(arguments.length===2,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return readPlan(file,digest,PFQ);
}
function readCurrent261PaymentInstallPlan(file,digest,paymentProfile=PAYMENT261_RUNTIME_PROFILE){
 need(arguments.length===2||arguments.length===3,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return readPlan(file,digest,payment261Plan(paymentProfile));
}
function readPlan(file,digest,profile){
 need(typeof digest==='string'&&/^[a-f0-9]{64}$/u.test(digest),'PAYMENT_INSTALL_PLAN_ARGUMENTS');outsideFile(file);
 const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,code:'PAYMENT_INSTALL_PLAN_FILE'});need(hash(data.bytes)===digest,'PAYMENT_INSTALL_PLAN_DIGEST');
 let plan;try{plan=JSON.parse(data.bytes.toString('utf8'));}catch{throw fault('PAYMENT_INSTALL_PLAN_JSON');}
 keys(plan,['schemaVersion','purpose','root','entry','material','resource','run','scope','limits']);
 need(plan.schemaVersion===1&&plan.purpose===profile.purpose&&plan.root===ROOT&&plan.entry===ENTRY,'PAYMENT_INSTALL_PLAN_SCOPE');
 keys(plan.material,['source','build','host','engineCommit','installation','tools']);const source=keys(plan.material.source,['candidateSha','tree','sourceSealSha256','ledgerSha256','prefix256Sha256','schemaSha256']);
 need(source.ledgerSha256===profile.ledgerSha256&&['candidateSha','tree'].every(k=>typeof source[k]==='string'&&/^[a-f0-9]{40}$/u.test(source[k]))&&['sourceSealSha256','ledgerSha256','prefix256Sha256','schemaSha256'].every(k=>typeof source[k]==='string'&&/^[a-f0-9]{64}$/u.test(source[k])),'PAYMENT_INSTALL_PLAN_SCOPE');
 keys(plan.run,['root','identity','resourceDir','attemptFile','receiptFile']);keys(plan.resource,['endpoint','imageId','daemonId']);
 need(plan.resource.endpoint===ENDPOINT&&plan.resource.imageId===IMAGE&&typeof plan.resource.daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(plan.resource.daemonId),'PAYMENT_INSTALL_PLAN_SCOPE');
 need(isDeepStrictEqual(plan.run.identity,privateDirectory(plan.run.root))&&plan.run.resourceDir===path.join(plan.run.root,'resource')&&plan.run.attemptFile===path.join(plan.run.root,'attempt.json')&&plan.run.receiptFile===path.join(plan.run.root,'receipt.json')&&isDeepStrictEqual(plan.scope,profile.scope)&&isDeepStrictEqual(plan.limits,LIMITS),'PAYMENT_INSTALL_PLAN_SCOPE');
 const info=freeze({path:file,sha256:digest,identity:data.identity});return Object.freeze({plan:freeze(plan),file:info});
}
function verifyCurrent259PaymentInstallPlan(file,digest){
 need(arguments.length===2,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return verifyPlan(file,digest,INSTALL);
}
function verifyCurrent259PfqCompositionPlan(file,digest){
 need(arguments.length===2,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return verifyPlan(file,digest,PFQ);
}
function verifyCurrent261PaymentInstallPlan(file,digest,paymentProfile=PAYMENT261_RUNTIME_PROFILE){
 need(arguments.length===2||arguments.length===3,'PAYMENT_INSTALL_PLAN_ARGUMENTS');return verifyPlan(file,digest,payment261Plan(paymentProfile));
}
function verifyPlan(file,digest,profile){
 const base=readPlan(file,digest,profile),captured=material(profile.scope.paymentProfile);
 need(isDeepStrictEqual(base.plan,expectedPlan(base.plan.run.root,base.plan.resource.daemonId,captured.observed,profile)),'PAYMENT_INSTALL_PLAN_MATERIAL_CHANGED');
 function check(){captured.loader.verifyFull();toolsCheck(captured.observed.tools);const current=read(file,{privateFile:true,maxBytes:512*1024,collect:true,expectedIdentity:base.file.identity,code:'PAYMENT_INSTALL_PLAN_FILE_CHANGED'});need(hash(current.bytes)===digest&&isDeepStrictEqual(base.plan.run.identity,privateDirectory(base.plan.run.root)),'PAYMENT_INSTALL_PLAN_FILE_CHANGED');}
 check();return Object.freeze({...base,buildHandle:captured.buildHandle,loader:captured.loader,check});
}
function parse(args){
 if(args.length===7&&args[0]==='--prepare-pfq-composition'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output')return prepareCurrent259PfqCompositionPlan({runRoot:args[2],daemonId:args[4],output:args[6]});
 if(args.length===7&&['--prepare','--prepare261'].includes(args[0])&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'){
  const preparePlan=args[0]==='--prepare261'?prepareCurrent261PaymentInstallPlan:prepareCurrent259PaymentInstallPlan;
  return preparePlan({runRoot:args[2],daemonId:args[4],output:args[6]});
 }
 if(args.length===5&&['--verify','--verify261'].includes(args[0])&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256'){
  const payment261=args[0]==='--verify261',verifyPlan=payment261?verifyCurrent261PaymentInstallPlan:verifyCurrent259PaymentInstallPlan;
  const v=verifyPlan(args[2],args[4]);return {status:(payment261?PAYMENT261:INSTALL).status+'_VERIFIED_NO_RESOURCES',candidateSha:v.plan.material.source.candidateSha,planSha256:args[4]};
 }
 throw fault('PAYMENT_INSTALL_PLAN_ARGUMENTS');
}
module.exports=Object.freeze({prepareCurrent259PaymentInstallPlan,readCurrent259PaymentInstallPlan,verifyCurrent259PaymentInstallPlan,
 prepareCurrent259PfqCompositionPlan,readCurrent259PfqCompositionPlan,verifyCurrent259PfqCompositionPlan,
 prepareCurrent261PaymentInstallPlan,readCurrent261PaymentInstallPlan,verifyCurrent261PaymentInstallPlan});
if(require.main===module){try{process.stdout.write(JSON.stringify(parse(process.argv.slice(2)))+'\n');}catch(error){const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:typeof code==='string'&&/^PAYMENT_INSTALL_PLAN_[A-Z0-9_]+$/u.test(code)?code:'PAYMENT_INSTALL_PLAN_FAILED'})+'\n');process.exitCode=1;}}
