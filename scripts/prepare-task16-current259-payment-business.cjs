#!/usr/bin/env node
'use strict';
// Offline material only. Neither plan/sidecar is a native/business capability.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const base=require('./prepare-task16-current259-payment-install.cjs');
const {readQualifiedTask16File:read}=require('../services/api/prisma/task16-runtime-inputs.cjs');
const {paymentLoopbackForScenario}=require('../services/api/prisma/task16-current259-payment-loopback.cjs');
const PURPOSE='current259-payment-owned-seed-and-case';
const PAYMENT261=Object.freeze({purpose:'current261-payment-owned-seed-and-case',payment261:true});
const ATTRIBUTION_GAP_PURPOSE='current259-payment-owned-project-attribution-gap';
const COMPETITION_PURPOSE='current259-payment-owned-two-actor-competition';
const VOUCHER_PURPOSE='current259-payment-owned-two-actor-voucher';
const ENTRY='services/api/prisma/task16-current259-payment-run-authorization.cjs';
const SCENARIOS=Object.freeze({normal:Object.freeze({scenario:'normal',caseId:'registered.null-cross-company.commit',handler:'runRegisteredNullCrossCompanyCommit'}),
 'response-loss':Object.freeze({scenario:'response-loss',caseId:'registered.null-cross-company.response-loss',handler:'runRegisteredNullCrossCompanyResponseLoss'}),
 'cancel-commit':Object.freeze({scenario:'cancel-commit',caseId:'registered.null-cross-company.cancel-commit',handler:'runRegisteredNullCrossCompanyCommitCancellation'}),
 'disconnect-commit-recovery':Object.freeze({scenario:'disconnect-commit-recovery',caseId:'registered.null-cross-company.disconnect-commit-recovery',handler:'runRegisteredNullCrossCompanyDisconnectRecovery'})});
const COMPETITION=Object.freeze({scenario:'competition',caseId:'registered.two-actor.payment-competition',handler:'runRegisteredTwoActorPaymentCompetition'});
const ATTRIBUTION_GAP=Object.freeze({scenario:'attribution-gap',caseId:'registered.project-attribution-gap',handler:'runRegisteredProjectAttributionGap'});
const VOUCHER=Object.freeze({scenario:'competition-voucher',caseId:'registered.two-actor.payment-voucher',handler:'supplementCompetitionWinnerVoucher'});
const FIXED_PLANS=Object.freeze({competition:{purpose:COMPETITION_PURPOSE,selected:COMPETITION},
 'attribution-gap':{purpose:ATTRIBUTION_GAP_PURPOSE,selected:ATTRIBUTION_GAP},
 'competition-voucher':{purpose:VOUCHER_PURPOSE,selected:VOUCHER}});
const root=path.resolve(__dirname,'..');
const voucherFiles=Object.freeze([
 'services/api/prisma/task16-current259-voucher-acl.cjs',
 'services/api/prisma/task16-current259-voucher-acl.requirements.json',
 'services/api/prisma/task16-current259-payment-acl-install.cjs',
 'services/api/prisma/task16-current259-payment-run-authorization.cjs',
 'services/api/prisma/task16-current259-client-loader.cjs',
 'services/api/prisma/enterprise-task01-resources.cjs',
 'services/api/prisma/task16-current259-owned-resource.cjs',
 'services/api/prisma/task16-current259-payment-loopback.cjs',
 'services/api/prisma/task16-current259-live-sessions.cjs',
 'services/api/prisma/task16-current259-seven-install.cjs',
 'services/api/prisma/task16-current259-catalog.cjs',
 'services/api/prisma/task16-current259-b7-install.cjs',
 'services/api/prisma/task16-current259-payment-competition.cjs',
 'services/api/src/database/registered-payment-postgres.fixture.ts',
 'services/api/src/database/registered-payment-postgres.cases.ts',
]);
function voucherMaterials(){
 return voucherFiles.map(relative=>{
  const observed=read(path.join(root,relative),{maxBytes:2*1024*1024,code:'PAYMENT_BUSINESS_PLAN_VOUCHER_MATERIAL'});
  return {path:relative,sha256:observed.sha256,identity:observed.identity};
 });
}
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
function dates(scenario,paidAt,openingDate,profile){
 need(profile?.selected?scenario===profile.selected.scenario:Object.hasOwn(SCENARIOS,scenario));
 for(const v of [paidAt,openingDate]){need(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/u.test(v)&&v.slice(0,4)!=='0000');const d=new Date(v+'T00:00:00.000Z');need(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v);}
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 need(openingDate<=paidAt&&paidAt<=today);
 return {...(profile?.selected??SCENARIOS[scenario]),paidAt,openingDate};
}
function scope(installation,selected){const cancellation=selected.scenario==='cancel-commit',voucher=selected.scenario===VOUCHER.scenario,competition=voucher||selected.scenario===COMPETITION.scenario;
 if(selected.scenario===ATTRIBUTION_GAP.scenario)return {...installation.scope,
  stages:[...installation.scope.stages.slice(0,-1),'liveSessions','applicationEnvironment','ownedApplication','seedFixture','selectedCase','ownedCleanup'],
  databaseTransport:paymentLoopbackForScenario(selected.scenario).plan,
  applications:true,environmentPreparation:true,fixtures:true,businessWrites:true,liveSessionAdmission:false,financialAcceptance:false,
  seedPostCount:3,registrationPostCount:1,seedRoutes:['POST /auth/login','POST /fund-accounts/openings (company A)','POST /fund-accounts/openings (company B)'],
  caseRoutes:['GET /fund-accounts/:scopeKey','GET /payment-executions/:paymentId/registration-options',
   'POST /payment-executions/:paymentId/registrations (sole expected attribution rejection)','GET /payment-executions/results/:idempotencyKey'],
  ownerWrites:'ONE_FIXED_APPROVED_STATE_FIXTURE_TRANSACTION',observer:'FIXED_REPEATABLE_READ_READ_ONLY_CANONICAL_SNAPSHOT',
  ownerObservation:'FIXED_READ_ONLY_PROJECT_SOURCE_AND_NO_INFLOW',
  attributionGap:{expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false},
  approvalPath:false,commitFaults:false,multiActorConcurrency:false,supplementaryVoucher:false,corrections:false};
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
 if(competition)return {...installation.scope,stages:[...installation.scope.stages.slice(0,-1),'competitionLiveSessions','applicationEnvironment','ownedApplicationPair','seedTwoActorFixture','observeSamePaymentLock','selectedCase',...(voucher?['uploadWinnerVoucher','attachWinnerVoucher','verifyVoucherAndLedger']:[]),'ownedCleanup'],
  applications:true,environmentPreparation:true,fixtures:true,businessWrites:true,liveSessionAdmission:false,financialAcceptance:false,
  seedPostCount:4,registrationPostCount:2,seedRoutes:['POST /auth/login (finance)','POST /auth/login (comprehensive director)','POST /fund-accounts/openings (company A)','POST /fund-accounts/openings (company B)'],
  caseRoutes:['GET /payment-executions/work-items (both before and after)','GET /payment-executions/:paymentId/registration-options (both)',
   'POST /payment-executions/:paymentId/registrations (finance)','POST /payment-executions/:paymentId/registrations (comprehensive director)',
   'GET /payment-executions/results/:idempotencyKey (both original keys)',
   ...(voucher?['POST /payment-executions/:executionId/voucher-file-uploads (winner multipart)',
    'POST /payment-executions/:executionId/voucher (same winner and file)',
    'GET /payment-executions/results/:idempotencyKey (winner after attach)',
    'GET /payment-executions/recorded-items?paymentId=:paymentId (winner after attach)']:[])],
  ownerWrites:'ONE_FIXED_APPROVED_STATE_FIXTURE_TRANSACTION',ownerObservation:'FIXED_SAME_PAYMENT_ROW_LOCK_AND_TWO_TLS_BACKEND_WAITERS',
  observer:'FIXED_REPEATABLE_READ_READ_ONLY_CANONICAL_SNAPSHOT',approvalPath:false,commitFaults:false,
  databaseTransport:paymentLoopbackForScenario(selected.scenario).plan,
  multiActorConcurrency:true,competition:{runtimeSessions:2,runtimePoolSize:1,httpTimeoutMs:5000,automaticRetry:false},supplementaryVoucher:voucher,
  ...(voucher?{voucher:{uploadPostCount:1,attachPostCount:1,privateStorage:'DEDICATED_LOCAL',independentFileRead:'FIXED_OWNER_READ_ONLY'}}:{}),corrections:false};
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
 return prepare(options);
}
function prepareCurrent261PaymentBusinessPlan(options){
 need(arguments.length===1);return prepare(options,PAYMENT261);
}
function prepareCurrent259PaymentCompetitionPlan(options){
 need(arguments.length===1);
 return prepare(options,FIXED_PLANS.competition);
}
function prepareCurrent259PaymentAttributionGapPlan(options){
 need(arguments.length===1);
 return prepare(options,FIXED_PLANS['attribution-gap']);
}
function prepareCurrent259PaymentVoucherPlan(options){
 need(arguments.length==1);return prepare(options,FIXED_PLANS['competition-voucher']);
}
function prepare(options,profile){
 const o=fixed(options,['runRoot','daemonId','output','paidAt','openingDate',...(profile?.selected?[]:['scenario'])]);
 const selected=dates(profile?.selected?.scenario??o.scenario,o.paidAt,o.openingDate,profile),parentIdentity=parent(o.output);
 const reserved=['resource','attempt.json','receipt.json','receipt.json.pending'].map(x=>path.join(o.runRoot,x));need(!reserved.includes(o.output));
 const sidecar=o.output+'.installation.json';parent(sidecar);
 const prepareInstall=profile?.payment261?base.prepareCurrent261PaymentInstallPlan:base.prepareCurrent259PaymentInstallPlan;
 const readInstall=profile?.payment261?base.readCurrent261PaymentInstallPlan:base.readCurrent259PaymentInstallPlan;
 const installed=prepareInstall({runRoot:o.runRoot,daemonId:o.daemonId,output:sidecar});
 const captured=readInstall(sidecar,installed.sha256);
 const raw={schemaVersion:1,purpose:profile?.purpose??PURPOSE,entry:ENTRY,parentIdentity,installation:{path:sidecar,sha256:installed.sha256,identity:captured.file.identity,parentIdentity:parent(sidecar)},case:selected,scope:scope(captured.plan,selected),...(profile?.selected===VOUCHER?{voucherMaterials:voucherMaterials()}:{})};
 need(equal(parent(o.output),parentIdentity));const bytes=Buffer.from(JSON.stringify(raw,null,2)+'\n');writeNew(o.output,bytes);
 return Object.freeze({status:profile?.payment261?'PAYMENT261_BUSINESS_PLAN_PREPARED_NO_RESOURCES':'PAYMENT_BUSINESS_PLAN_PREPARED_NO_RESOURCES',file:o.output,sha256:hash(bytes),candidateSha:captured.plan.material.source.candidateSha});
}
function readCurrent259PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest);
}
function readCurrent261PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest,PAYMENT261);
}
function readCurrent259PaymentCompetitionPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest,FIXED_PLANS.competition);
}
function readCurrent259PaymentAttributionGapPlan(file,digest){
 need(arguments.length===2);return readPlan(file,digest,FIXED_PLANS['attribution-gap']);
}
function readCurrent259PaymentVoucherPlan(file,digest){
 need(arguments.length==2);return readPlan(file,digest,FIXED_PLANS['competition-voucher']);
}
function readPlan(file,digest,profile){
 need(typeof digest==='string'&&/^[a-f0-9]{64}$/u.test(digest));const parentIdentity=parent(file),data=capture(file);need(data.sha256===digest);
 const raw=JSON.parse(data.bytes.toString('utf8'));fixed(raw,['schemaVersion','purpose','entry','parentIdentity','installation','case','scope',...(profile?.selected===VOUCHER?['voucherMaterials']:[])]);
 const purpose=profile?.purpose??PURPOSE;
 need(raw.schemaVersion===1&&raw.purpose===purpose&&raw.entry===ENTRY&&equal(parentIdentity,raw.parentIdentity));
 const sidecar=fixed(raw.installation,['path','sha256','identity','parentIdentity']);need(sidecar.path===file+'.installation.json'&&equal(parent(sidecar.path),sidecar.parentIdentity));
 const side=capture(sidecar.path,sidecar.identity);need(side.sha256===sidecar.sha256);
 const readInstall=profile?.payment261?base.readCurrent261PaymentInstallPlan:base.readCurrent259PaymentInstallPlan;
 const original=readInstall(sidecar.path,sidecar.sha256);
 const selected=fixed(raw.case,['scenario','caseId','handler','paidAt','openingDate']);need(equal(selected,dates(selected.scenario,selected.paidAt,selected.openingDate,profile))&&equal(raw.scope,scope(original.plan,selected)));
 if(profile?.selected===VOUCHER)need(equal(raw.voucherMaterials,voucherMaterials()));
 const plan=freeze({...original.plan,purpose,entry:ENTRY,installation:sidecar,case:selected,scope:raw.scope,
  ...(profile?.selected===VOUCHER?{voucherMaterials:raw.voucherMaterials}:{})});
 const info=freeze({path:file,sha256:digest,identity:data.identity,parentIdentity});
 return Object.freeze({plan,file:info});
}
function verifyCurrent259PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest);
}
function verifyCurrent261PaymentBusinessPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest,PAYMENT261);
}
function verifyCurrent259PaymentCompetitionPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest,FIXED_PLANS.competition);
}
function verifyCurrent259PaymentAttributionGapPlan(file,digest){
 need(arguments.length===2);return verifyPlan(file,digest,FIXED_PLANS['attribution-gap']);
}
function verifyCurrent259PaymentVoucherPlan(file,digest){
 need(arguments.length==2);return verifyPlan(file,digest,FIXED_PLANS['competition-voucher']);
}
function verifyPlan(file,digest,profile){
 const saved=readPlan(file,digest,profile),p=saved.plan;
 const verifyInstall=profile?.payment261?base.verifyCurrent261PaymentInstallPlan:base.verifyCurrent259PaymentInstallPlan;
 const original=verifyInstall(p.installation.path,p.installation.sha256);
 let broken=false;
 function checkInputs(){try{need(!broken);const again=readPlan(file,digest,profile);need(equal(again,saved)&&equal(parent(file),saved.file.parentIdentity));capture(file,saved.file.identity);capture(p.installation.path,p.installation.identity);}catch(error){broken=true;throw error;}}
 function check(){try{need(!broken);original.check();checkInputs();}catch(error){broken=true;throw error;}}
 check();return Object.freeze({...saved,buildHandle:original.buildHandle,loader:original.loader,checkInputs,check});
}
function parse(args){
 if(args.length===13&&['--prepare','--prepare261'].includes(args[0])&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--scenario'&&args[9]==='--paid-at'&&args[11]==='--opening-date'){
  const preparePlan=args[0]==='--prepare261'?prepareCurrent261PaymentBusinessPlan:prepareCurrent259PaymentBusinessPlan;
  return preparePlan({runRoot:args[2],daemonId:args[4],output:args[6],scenario:args[8],paidAt:args[10],openingDate:args[12]});
 }
 if(args.length===11&&args[0]==='--prepare-competition'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--paid-at'&&args[9]==='--opening-date')return prepareCurrent259PaymentCompetitionPlan({runRoot:args[2],daemonId:args[4],output:args[6],paidAt:args[8],openingDate:args[10]});
 if(args.length===11&&args[0]==='--prepare-attribution-gap'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--paid-at'&&args[9]==='--opening-date')return prepareCurrent259PaymentAttributionGapPlan({runRoot:args[2],daemonId:args[4],output:args[6],paidAt:args[8],openingDate:args[10]});
 if(args.length===11&&args[0]==='--prepare-voucher'&&args[1]==='--run-root'&&args[3]==='--daemon-id'&&args[5]==='--output'&&args[7]==='--paid-at'&&args[9]==='--opening-date')return prepareCurrent259PaymentVoucherPlan({runRoot:args[2],daemonId:args[4],output:args[6],paidAt:args[8],openingDate:args[10]});
 if(args.length===5&&['--verify','--verify261'].includes(args[0])&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256'){
  const payment261=args[0]==='--verify261',verifyPlan=payment261?verifyCurrent261PaymentBusinessPlan:verifyCurrent259PaymentBusinessPlan;
  const v=verifyPlan(args[2],args[4]);return{status:payment261?'PAYMENT261_BUSINESS_PLAN_VERIFIED_NO_RESOURCES':'PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES',candidateSha:v.plan.material.source.candidateSha,planSha256:args[4]};
 }
 need(false);
}
module.exports=Object.freeze({prepareCurrent259PaymentBusinessPlan,readCurrent259PaymentBusinessPlan,verifyCurrent259PaymentBusinessPlan,
 prepareCurrent259PaymentCompetitionPlan,readCurrent259PaymentCompetitionPlan,verifyCurrent259PaymentCompetitionPlan,
 prepareCurrent259PaymentAttributionGapPlan,readCurrent259PaymentAttributionGapPlan,verifyCurrent259PaymentAttributionGapPlan,
 prepareCurrent259PaymentVoucherPlan,readCurrent259PaymentVoucherPlan,verifyCurrent259PaymentVoucherPlan,
 prepareCurrent261PaymentBusinessPlan,readCurrent261PaymentBusinessPlan,verifyCurrent261PaymentBusinessPlan});
if(require.main===module){try{process.stdout.write(JSON.stringify(parse(process.argv.slice(2)))+'\n');}catch{process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:'PAYMENT_BUSINESS_PLAN_FAILED_CLOSED'})+'\n');process.exitCode=1;}}
