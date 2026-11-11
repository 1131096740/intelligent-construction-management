#!/usr/bin/env node
'use strict';
// Offline material only. Neither plan/sidecar is a native/business capability.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const base=require('./prepare-task16-current259-payment-install.cjs');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
const {paymentLoopbackForScenario}=require('../services/api/prisma/task16-current259-payment-loopback.cjs');
const PURPOSE='current259-payment-owned-seed-and-case';
const COMPETITION_PURPOSE='current259-payment-owned-two-actor-competition';
const ENTRY='services/api/prisma/task16-current259-payment-run-authorization.cjs';
const SCENARIOS=Object.freeze({normal:Object.freeze({scenario:'normal',caseId:'registered.null-cross-company.commit',handler:'runRegisteredNullCrossCompanyCommit'}),
 'response-loss':Object.freeze({scenario:'response-loss',caseId:'registered.null-cross-company.response-loss',handler:'runRegisteredNullCrossCompanyResponseLoss'}),
 'cancel-commit':Object.freeze({scenario:'cancel-commit',caseId:'registered.null-cross-company.cancel-commit',handler:'runRegisteredNullCrossCompanyCommitCancellation'}),
 'disconnect-commit-recovery':Object.freeze({scenario:'disconnect-commit-recovery',caseId:'registered.null-cross-company.disconnect-commit-recovery',handler:'runRegisteredNullCrossCompanyDisconnectRecovery'})});
const COMPETITION=Object.freeze({scenario:'competition',caseId:'registered.two-actor.payment-competition',handler:'runRegisteredTwoActorPaymentCompetition'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=ok=>{if(!ok)throw Object.assign(new Error('PAYMENT_BUSINESS_PLAN_FAILED_CLOSED'),{code:'PAYMENT_BUSINESS_PLAN_FAILED_CLOSED'});};
function fixed(value,keys){need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);return Object.fromEntries(keys.map(k=>{const d=Object.getOwnPropertyDescriptor(value,k);need(d&&Object.hasOwn(d,'value'));return[k,d.value];}));}
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
function parent(file){
 need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&file.startsWith('/private/tmp/'));
 const dir=path.dirname(file);need(fs.realpathSync(dir)===dir);let cursor='/';for(const p of dir.slice(1).split('/')){cursor=path.join(cursor,p);need(!fs.lstatSync(cursor).isSymbolicLink());}
 const st=fs.lstatSync(dir);need(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0);
 return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]]));
}
function dates(scenario,paidAt,openingDate,competition){
 need(competition?scenario===COMPETITION.scenario:Object.hasOwn(SCENARIOS,scenario));
 for(const v of [paidAt,openingDate]){need(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/u.test(v)&&v.slice(0,4)!=='0000');const d=new Date(v+'T00:00:00.000Z');need(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v);}
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 need(openingDate<=paidAt&&paidAt<=today);
 return {...(competition?COMPETITION:SCENARIOS[scenario]),paidAt,openingDate};
}
function scope(installation,selected){const cancellation=selected.scenario==='cancel-commit',competition=selected.scenario===COMPETITION.scenario;
 if(selected.scenario==='disconnect-commit-recovery')return {...installation.scope,
  stages:[...installation.scope.stages.slice(0,-1),'liveSessions','applicationEnvironment','ownedApplication','seedFixture','disconnectOriginalCommit',
   'closeOriginalApplication','retireOriginalRuntime','confirmRollback','replacementApplication','recoverOriginalKey','ownedCleanup'],
  applications:true,environmentPreparation:true,fixtures:true,businessWrites:true,liveSessionAdmission:false,financialAcceptance:false,
  seedPostCount:3,registrationPostCount:2,seedRoutes:['POST /auth/login','POST /fund-accounts/openings (company A)','POST /fund-accounts/openings (company B)'],
  caseRoutes:['GET /payment-executions/:paymentId/registration-options','POST /payment-executions/:paymentId/registrations (initial)',
   'GET /payment-executions/results/:idempotencyKey (after confirmed rollback)',
   'POST /payment-executions/:paymentId/registrations (same frozen request after confirmed rollback)',
   'GET /payment-executions/results/:idempotencyKey (committed)'],
  ownerWrites:'ONE_FIXED_APPROVED_STATE_FIXTURE_TRANSACTION',observer:'FIXED_REPEATABLE_READ_READ_ONLY_CANONICAL_SNAPSHOT',
  approvalPath:false,commitFaults:'DISCONNECT_EXACT_COMMIT_ONCE',
  databaseTransport:paymentLoopbackForScenario(selected.scenario).plan,
  commitDisconnection:{owner:'ONE_FIXED_LOCK_TRANSACTION_AND_BOUNDED_READ_ONLY_READY',runtimeReplacements:1,httpTimeoutMs:5000,
   readyBudgetMs:5000,waitSeconds:12,settleSeconds:3,automaticRetry:false,confirmedRollbackRequired:true},
  multiActorConcurrency:false,supplementaryVoucher:false,corrections:false};
 if(competition)return {...installation.scope,stages:[...installation.scope.stages.slice(0,-1),'competitionLiveSessions','applicationEnvironment','ownedApplicationPair','seedTwoActorFixture','observeSamePaymentLock','selectedCase','ownedCleanup'],
  applications:true,environmentPreparation:true,fixtures:true,businessWrites:true,liveSessionAdmission:false,financialAcceptance:false,
  seedPostCount:4,registrationPostCount:2,seedRoutes:['POST /auth/login (finance)','POST /auth/login (comprehensive director)','POST /fund-accounts/openings (company A)','POST /fund-accounts/openings (company B)'],
  caseRoutes:['GET /payment-executions/work-items (both before and after)','GET /payment-executions/:paymentId/registration-options (both)',
   'POST /payment-executions/:paymentId/registrations (finance)','POST /payment-executions/:paymentId/registrations (comprehensive director)',
   'GET /payment-executions/results/:idempotencyKey (both original keys)'],
  ownerWrites:'ONE_FIXED_APPROVED_STATE_FIXTURE_TRANSACTION',ownerObservation:'FIXED_SAME_PAYMENT_ROW_LOCK_AND_TWO_TLS_BACKEND_WAITERS',
  observer:'FIXED_REPEATABLE_READ_READ_ONLY_CANONICAL_SNAPSHOT',approvalPath:false,commitFaults:false,
  databaseTransport:paymentLoopbackForScenario(COMPETITION.scenario).plan,
  multiActorConcurrency:true,competition:{runtimeSessions:2,runtimePoolSize:1,httpTimeoutMs:5000,automaticRetry:false},supplementaryVoucher:false,corrections:false};
 const loopback=paymentLoopbackForScenario(selected.scenario);
 return {...installation.scope,stages:[...installation.scope.stages.slice(0,-1),'liveSessions','applicationEnvironment','ownedApplication','seedFixture','selectedCase','ownedCleanup'],
 applications:true,environmentPreparation:true,fixtures:true,businessWrites:true,liveSessionAdmission:false,financialAcceptance:false,
 seedPostCount:3,registrationPostCount:cancellation?1:2,seedRoutes:['POST /auth/login','POST /fund-accounts/openings (company A)','POST /fund-accounts/openings (company B)'],
 caseRoutes:['GET /payment-executions/:paymentId/registration-options','POST /payment-executions/:paymentId/registrations (initial)',
  ...(cancellation?['GET /payment-executions/results/:idempotencyKey (original key after confirmed rollback)']:['POST /payment-executions/:paymentId/registrations (same-key replay)','GET /payment-executions/results/:idempotencyKey'])],
 ownerWrites:'ONE_FIXED_APPROVED_STATE_FIXTURE_TRANSACTION',observer:'FIXED_REPEATABLE_READ_READ_ONLY_CANONICAL_SNAPSHOT',
 approvalPath:false,commitFaults:cancellation?'CANCEL_EXACT_COMMIT_ONCE':false,
 ...(loopback?{databaseTransport:loopback.plan}:{}),
 ...(cancellation?{commitCancellation:{owner:'ONE_FIXED_LOCK_TRANSACTION_AND_BOUNDED_READ_ONLY_READY',httpTimeoutMs:5000,readyBudgetMs:5000,waitSeconds:12,settleSeconds:3,automaticRetry:false,disconnect:false,originalResultReadCount:1}}:{}),
 multiActorConcurrency:false,supplementaryVoucher:false,corrections:false};}
function capture(file,expected){const data=read(file,{privateFile:true,maxBytes:512*1024,collect:true,...(expected?{expectedIdentity:expected}:{}),code:'PAYMENT_BUSINESS_PLAN_FILE'});need(data.identity.uid===process.getuid());return data;}
function writeNew(file,bytes){parent(file);let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function prepareCurrent259PaymentBusinessPlan(options){
 need(arguments.length===1);
 return prepare(options,false);
}
function prepareCurrent259PaymentCompetitionPlan(options){
 need(arguments.length===1);
 return prepare(options,true);
}
function prepare(options,competition){
 const o=fixed(options,['runRoot','daemonId','output','paidAt','openingDate',...(competition?[]:['scenario'])]);
 const selected=dates(competition?COMPETITION.scenario:o.scenario,o.paidAt,o.openingDate,competition),parentIdentity=parent(o.output);
 const reserved=['resource','attempt.json','receipt.json','receipt.json.pending'].map(x=>path.join(o.runRoot,x));need(!reserved.includes(o.output));
 const sidecar=o.output+'.installation.json';parent(sidecar);
 const installed=base.prepareCurrent259PaymentInstallPlan({runRoot:o.runRoot,daemonId:o.daemonId,output:sidecar});
 const captured=base.readCurrent259PaymentInstallPlan(sidecar,installed.sha256);
 const raw={schemaVersion:1,purpose:competition?COMPETITION_PURPOSE:PURPOSE,entry:ENTRY,parentIdentity,installation:{path:sidecar,sha256:installed.sha256,identity:captured.file.identity,parentIdentity:parent(sidecar)},case:selected,scope:scope(captured.plan,selected)};
 need(equal(parent(o.output),parentIdentity));const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');writeNew(o.output,bytes);
 return Object.freeze({status:'PAYMENT_BUSINESS_PLAN_PREPARED_NO_RESOURCES',file:o.output,sha256:hash(bytes),candidateSha:captured.plan.material.source.candidateSha});
}
function readCurrent259PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest,false);
}
function readCurrent259PaymentCompetitionPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest,true);
}
function readPlan(file,digest,competition){
 need(typeof digest==='string'&&/^[a-f0-9]{64}$/u.test(digest));const parentIdentity=parent(file),data=capture(file);need(data.sha256===digest);
 const raw=JSON.parse(data.bytes.toString('utf8'));fixed(raw,['schemaVersion','purpose','entry','parentIdentity','installation','case','scope']);
 const purpose=competition?COMPETITION_PURPOSE:PURPOSE;
 need(raw.schemaVersion===1&&raw.purpose===purpose&&raw.entry===ENTRY&&equal(parentIdentity,raw.parentIdentity));
 const sidecar=fixed(raw.installation,['path','sha256','identity','parentIdentity']);need(sidecar.path===file+'.installation.json'&&equal(parent(sidecar.path),sidecar.parentIdentity));
 const side=capture(sidecar.path,sidecar.identity);need(side.sha256===sidecar.sha256);
 const original=base.readCurrent259PaymentInstallPlan(sidecar.path,sidecar.sha256);
 const selected=fixed(raw.case,['scenario','caseId','handler','paidAt','openingDate']);need(equal(selected,dates(selected.scenario,selected.paidAt,selected.openingDate,competition))&&equal(raw.scope,scope(original.plan,selected)));
 const plan=freeze({...original.plan,purpose,entry:ENTRY,installation:sidecar,case:selected,scope:raw.scope});
 const info=freeze({path:file,sha256:digest,identity:data.identity,parentIdentity});
 return Object.freeze({plan,file:info});
}
function verifyCurrent259PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest,false);
}
function verifyCurrent259PaymentCompetitionPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest,true);
}
function verifyPlan(file,digest,competition){
 const saved=readPlan(file,digest,competition),p=saved.plan;
 const original=base.verifyCurrent259PaymentInstallPlan(p.installation.path,p.installation.sha256);
 let broken=false;
 function checkInputs(){try{need(!broken);const again=readPlan(file,digest,competition);need(equal(again,saved)&&equal(parent(file),saved.file.parentIdentity));capture(file,saved.file.identity);capture(p.installation.path,p.installation.identity);}catch(error){broken=true;throw error;}}
 function check(){try{need(!broken);original.check();checkInputs();}catch(error){broken=true;throw error;}}
 check();return Object.freeze({...saved,buildHandle:original.buildHandle,loader:original.loader,checkInputs,check});
}
function parse(args){
 if(args.length===13&&args[0]==='--prepare'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--scenario'&&args[9]==='--paid-at'&&args[11]==='--opening-date')return prepareCurrent259PaymentBusinessPlan({runRoot:args[2],daemonId:args[4],output:args[6],scenario:args[8],paidAt:args[10],openingDate:args[12]});
 if(args.length===11&&args[0]==='--prepare-competition'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--paid-at'&&args[9]==='--opening-date')return prepareCurrent259PaymentCompetitionPlan({runRoot:args[2],daemonId:args[4],output:args[6],paidAt:args[8],openingDate:args[10]});
 if(args.length===5&&args[0]==='--verify'&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256'){const v=verifyCurrent259PaymentBusinessPlan(args[2],args[4]);return{status:'PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES',candidateSha:v.plan.material.source.candidateSha,planSha256:args[4]};}
 need(false);
}
module.exports=Object.freeze({prepareCurrent259PaymentBusinessPlan,readCurrent259PaymentBusinessPlan,verifyCurrent259PaymentBusinessPlan,
 prepareCurrent259PaymentCompetitionPlan,readCurrent259PaymentCompetitionPlan,verifyCurrent259PaymentCompetitionPlan});
if(require.main===module){try{process.stdout.write(JSON.stringify(parse(process.argv.slice(2)))+'\n');}catch{process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:'PAYMENT_BUSINESS_PLAN_FAILED_CLOSED'})+'\n');process.exitCode=1;}}
