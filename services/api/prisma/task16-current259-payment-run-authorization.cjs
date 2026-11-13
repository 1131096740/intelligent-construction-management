#!/usr/bin/env node
'use strict';
// This sole fresh-main entry owns installation and the in-memory B7 permission.
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH')&&Object.keys(require.cache).every(file=>file===__filename);
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const {performance}=require('node:perf_hooks');
const {paymentLoopbackForScenario}=require('./task16-current259-payment-loopback.cjs');
const {PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');
const {PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
const ONCE_OPTIONS=Object.freeze(['--once','--business-once','--competition-once','--attribution-gap-once','--voucher-once','--pfq-composition-once','--install261-once','--business261-once','--competition261-once','--competition-follow-up261-once','--voucher261-once','--attribution-gap261-once']);
const permissions=new WeakMap(),businessPermissions=new WeakMap(),attributionGapPermissions=new WeakMap(),voucherBusinessPermissions=new WeakMap(),businessContinuities=new WeakMap();
const payment261RolePermissions=new WeakMap(),competitionRolePermissions=new WeakMap(),competitionLivePermissions=new WeakMap(),disconnectLivePermissions=new WeakMap(),voucherAclPermissions=new WeakMap();
const attributionGapFailureCodes=new Map([
 ['CASE_SETUP','PG_CASE_ATTRIBUTION_GAP_SETUP'],
 ['OBSERVER_BEFORE','PG_CASE_ATTRIBUTION_GAP_BEFORE'],
 ['OWNER_BEFORE','PG_CASE_ATTRIBUTION_GAP_OWNER_READ'],
 ['BEFORE_STATE','PG_CASE_ATTRIBUTION_GAP_BEFORE'],
 ['PUBLIC_ACCOUNT','PG_CASE_ATTRIBUTION_GAP_PUBLIC_BALANCES'],
 ['PUBLIC_OPTIONS','PG_CASE_ATTRIBUTION_GAP_OPTIONS'],
 ['REGISTRATION','PG_CASE_ATTRIBUTION_GAP_EXPECTED_CONFLICT'],
 ['ORIGINAL_RESULT','PG_CASE_ATTRIBUTION_GAP_ORIGINAL_RESULT'],
 ['OBSERVER_AFTER','PG_CASE_ATTRIBUTION_GAP_OBSERVER_READ'],
 ['OWNER_AFTER','PG_CASE_ATTRIBUTION_GAP_OWNER_READ'],
 ['FINANCIAL_COMPARISON','PG_CASE_ATTRIBUTION_GAP_LEDGER_CHANGED'],
 ['CASE_FINAL','PG_CASE_ATTRIBUTION_GAP_FINAL']
]);
const voucherFailureCodes=new Map([
 ['COMPETITION','CURRENT259_PAYMENT_VOUCHER_COMPETITION'],
 ['LEDGER_BEFORE','CURRENT259_PAYMENT_VOUCHER_LEDGER_READ'],
 ['OWNER_BEFORE','CURRENT259_PAYMENT_VOUCHER_OWNER_READ'],
 ['MULTIPART_UPLOAD','CURRENT259_PAYMENT_VOUCHER_MULTIPART_UPLOAD'],
 ['ATTACH','CURRENT259_PAYMENT_VOUCHER_ATTACH'],
 ['ORIGINAL_RESULT','CURRENT259_PAYMENT_VOUCHER_ORIGINAL_RESULT'],
 ['RECORDED_ITEMS','CURRENT259_PAYMENT_VOUCHER_RECORDED_ITEMS'],
 ['OWNER_AFTER','CURRENT259_PAYMENT_VOUCHER_OWNER_READ'],
 ['STORAGE_BYTES','CURRENT259_PAYMENT_VOUCHER_STORAGE_BYTES'],
 ['LEDGER_AFTER','CURRENT259_PAYMENT_VOUCHER_LEDGER_DRIFT'],
 ['FINAL_VERIFY','CURRENT259_PAYMENT_VOUCHER_FINAL_VERIFY']
]);
const caseFailureStages=new Set(['APPLICATION_LEASE','PERMIT_CLAIM','CONTINUITY_ACTIVATION','CASE_SETUP',
 'PRE_SEED_AUTHORITY','PRE_SEED_LIVE','SEED_FIXTURE','SEED_IDENTITY','SEED_PREPARE','SEED_OWNER_TRANSACTION',
 'SEED_LOGIN','SEED_OPENING','POST_SEED_AUTHORITY','POST_SEED_LIVE','SELECTED_CASE','FINAL']);
const {isPaymentFailureCode,filterPaymentDiagnostic}=require('./task16-current259-payment-diagnostics.cjs');
const caseFailureCodes=Object.freeze({has:isPaymentFailureCode});
const secondaryFailureCodes=new Set(['CURRENT259_RESOURCE_CLEANUP_UNKNOWN','PAYMENT_INSTALL_ONCE_RESOURCE_CHANGED',
 'PAYMENT_INSTALL_ONCE_RESOURCE_IDENTITY','PAYMENT_INSTALL_ONCE_MANIFEST','PAYMENT_INSTALL_ONCE_PROGRESS_ROOT',
 'PAYMENT_INSTALL_ONCE_PROGRESS_WRITE','PAYMENT_INSTALL_ONCE_ABORTED_UNSETTLED','PAYMENT_INSTALL_ONCE_CLOSED',
 'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT','PAYMENT_INSTALL_ONCE_CLEANUP_UNCONFIRMED']);
const diagnosticCode=code=>isPaymentFailureCode(code)||secondaryFailureCodes.has(code)?code:'PAYMENT_INSTALL_ONCE_FAILED_CLOSED';
const seedHttpPhases=new Set(['BEFORE_CHECK','TARGET','FETCH','BODY','AFTER_CHECK','RESPONSE_RETURNED']);
const seedHttpStatuses=new Set([200,201,400,401,403,404,409,422,429,500,503]);
function recordCaseFailure(entry,stage,code,httpStatus,httpPhase,diagnostic){
 if(entry?.recordCaseFailure&&caseFailureStages.has(stage))entry.caseFailure??=Object.freeze({stage,
  ...(caseFailureCodes.has(code)?{code}:{}),
  ...((stage==='SEED_LOGIN'||stage==='SEED_OPENING')&&seedHttpStatuses.has(httpStatus)?{httpStatus}:{}),
  ...((stage==='SEED_LOGIN'||stage==='SEED_OPENING'||stage==='SELECTED_CASE')&&seedHttpPhases.has(httpPhase)?{httpPhase}:{}),...filterPaymentDiagnostic(diagnostic)});
}
let currentRun,onceAttempted=false;
const fault=suffix=>Object.assign(new Error('PAYMENT_INSTALL_ONCE_'+suffix),{code:'PAYMENT_INSTALL_ONCE_'+suffix});
const need=(ok,suffix='INVALID')=>{if(!ok)throw fault(suffix);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/u.test(value);
function data(value,key){if(!value||types.isProxy(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
function fixed(value,keys){
 need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);
 return Object.fromEntries(keys.map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'));return [key,d.value];}));
}
function revoke(state){if(state){state.active=false;state.abort('CONTINUITY_REVOKED');}}
function claimCurrent259B7WritePermit(permit,handle,acl){
 const entry=permit&&!types.isProxy(permit)&&permissions.get(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun&&entry.active&&!entry.claimed&&entry.handle===handle&&entry.acl===acl,'AUTHORITY');
  entry.claimed=true;entry.check();
  return Object.freeze({planSha256:entry.planSha256,check(){entry.check();return true;},consumeWrite(binding){
   // Even an invalid first binding consumes the sole write opportunity.
   const available=!entry.writeUsed;entry.writeUsed=true;
   try{
    need(available,'WRITE_REUSED');entry.check();
    const row=fixed(binding,['scope','planSha256','sourceSha','sourceSealSha256','runId','containerId','aclXid','nonce','identity','beforeCatalogSha256','beforeSqlSha256','installSqlSha256']);
    const id=fixed(row.identity,['runId','database','databaseOid','namespaceOid','ownerOid','runtimeOid','observerOid','systemIdentifier',
     ...(entry.competition?['runtimeProfile']:[]),...(entry.voucher?['voucherProfile']:[]),...(entry.payment261?['paymentProfile']:[])]);
    need(row.scope==='CURRENT259_DOCKER_B7_INSTALL'&&row.planSha256===entry.planSha256&&row.sourceSha===entry.source.candidateSha&&
     row.sourceSealSha256===entry.source.sourceSealSha256&&row.runId===entry.view.runId&&row.containerId===entry.view.resource.containerId&&
     row.aclXid===entry.acl.installXid&&equal(id,entry.identity)&&hex(row.nonce,64)&&
     ['beforeCatalogSha256','beforeSqlSha256','installSqlSha256'].every(key=>hex(row[key],64)),'WRITE_BINDING');
    const expected=renderCurrent259CatalogRead({source:entry.catalogSource,identity:entry.identity,phase:'before',nonce:row.nonce});
    need(row.beforeSqlSha256===hash(expected),'BEFORE_SQL');
    entry.binding=Object.freeze({...row,identity:Object.freeze(id),
     nonceSource:'FIXED_B7_ORIGINAL_ACL_REQUEST_NOT_INDEPENDENTLY_HELD',
     beforeCatalogDigestSource:'FIXED_B7_COMPARISON_TO_ORIGINAL_ACL',
     beforeSqlDigestSource:'ISSUER_FIXED_RENDERER_RECOMPUTED',
     installSqlDigestSource:'FIXED_B7_RENDERER_NOT_INDEPENDENTLY_RECOMPUTED'});
    entry.check();return true;
   }catch(error){revoke(entry);throw error;}
  }});
 }catch(error){revoke(entry||currentRun);throw error;}
}
function claimCurrent259Payment261RolePermit(permit,handle,technical){
 return claimPayment261RolePermit(permit,handle,technical,PAYMENT261_RUNTIME_PROFILE,arguments.length);
}
function claimCurrent259Payment261AttributionGapRolePermit(permit,handle,technical){
 return claimPayment261RolePermit(permit,handle,technical,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE,arguments.length);
}
function claimPayment261RolePermit(permit,handle,technical,paymentProfile,arity){
 const entry=permit&&!types.isProxy(permit)&&payment261RolePermissions.get(permit);
 if(entry)payment261RolePermissions.delete(permit);
 try{
  need(arity===3&&entry&&entry===currentRun&&entry.active&&entry.paymentProfile===paymentProfile&&!entry.competition&&
   entry.handle===handle&&entry.technical===technical&&!entry.payment261RolesClaimed,'PAYMENT261_ROLE_AUTHORITY');
  entry.payment261RolesClaimed=true;entry.check();return true;
 }catch(error){revoke(entry||currentRun);throw error;}
}
function claimCurrent259CompetitionRolePermit(permit,handle,technical){
 return claimCompetitionRolePermit(permit,handle,technical,undefined,arguments.length);
}
function claimCurrent259Payment261CompetitionRolePermit(permit,handle,technical){
 return claimCompetitionRolePermit(permit,handle,technical,PAYMENT261_COMPETITION_RUNTIME_PROFILE,arguments.length);
}
function claimCurrent259Payment261VoucherRolePermit(permit,handle,technical){
 return claimCompetitionRolePermit(permit,handle,technical,PAYMENT261_VOUCHER_RUNTIME_PROFILE,arguments.length);
}
function claimCompetitionRolePermit(permit,handle,technical,paymentProfile,arity){
 const entry=permit&&!types.isProxy(permit)&&competitionRolePermissions.get(permit);
 if(entry)competitionRolePermissions.delete(permit);
 try{
  need(arity===3&&entry&&entry===currentRun&&entry.active&&entry.competition&&entry.paymentProfile===paymentProfile&&
   entry.handle===handle&&entry.technical===technical,'COMPETITION_ROLE_AUTHORITY');
  entry.check();return true;
 }catch(error){revoke(entry||currentRun);throw error;}
}
function claimCurrent259VoucherAclPermit(permit,handle,seven){
 const entry=permit&&!types.isProxy(permit)&&voucherAclPermissions.get(permit);
 if(entry)voucherAclPermissions.delete(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun&&entry.active&&entry.voucher&&entry.competition&&
   entry.handle===handle&&entry.seven===seven&&!entry.acl&&!entry.voucherAclClaimed,'VOUCHER_ACL_AUTHORITY');
  entry.voucherAclClaimed=true;entry.check();return true;
 }catch(error){revoke(entry||currentRun);throw error;}
}
function claimCurrent259CompetitionLivePermit(permit,handle,b7){
 const entry=permit&&!types.isProxy(permit)&&competitionLivePermissions.get(permit);
 if(entry)competitionLivePermissions.delete(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun&&entry.active&&entry.competition&&entry.handle===handle&&entry.competitionB7===b7&&entry.claimed&&entry.writeUsed,'COMPETITION_LIVE_AUTHORITY');
  entry.check();return true;
 }catch(error){revoke(entry||currentRun);throw error;}
}
function claimCurrent259DisconnectLivePermit(permit,handle,b7){
 const entry=permit&&!types.isProxy(permit)&&disconnectLivePermissions.get(permit);
 if(entry)disconnectLivePermissions.delete(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun&&entry.active&&entry.disconnect&&entry.handle===handle&&entry.disconnectB7===b7&&entry.claimed&&entry.writeUsed,'DISCONNECT_LIVE_AUTHORITY');
  entry.check();return true;
 }catch(error){revoke(entry||currentRun);throw error;}
}
function assertCurrent259PaymentBusinessContinuity(token,handle,expectedScenario){
 const entry=token&&!types.isProxy(token)&&businessContinuities.get(token),state=currentRun;
 try{
  const fixedFault=expectedScenario==='cancel-commit'||expectedScenario==='disconnect-commit-recovery'&&entry?.scope.disconnectPhase==='attempt';
  const scenarioMatches=arguments.length===2||arguments.length===3&&fixedFault&&entry?.scope.scenario===expectedScenario;
  need(scenarioMatches&&entry&&entry===state?.business&&entry.active&&entry.claimed&&entry.handle===handle&&state.handle===handle&&
   state.active&&!state.controller.signal.aborted&&Date.now()<=state.endAt&&state.source===entry.source&&
   equal(state.effectiveAccessBinding,entry.effectiveAccessBinding)&&
   state.checkedBuild===entry.build&&state.paymentProfile===entry.paymentProfile&&state.businessB7===entry.b7&&state.businessLive===entry.liveProof&&state.businessApplication===entry.application&&state.businessScope===entry.scope&&state.view.loader===entry.loader&&data(state.view,'checkLifetime')===entry.lifetime,'BUSINESS_CONTINUITY');
  importsCheck();state.checkedInputs();entry.lifetime.call(state.view);
  const now=read(state.plan.run.attemptFile,{privateFile:true,maxBytes:4096,collect:true,expectedIdentity:state.attempt.identity,code:'PAYMENT_INSTALL_ONCE_ATTEMPT_CHANGED'});
  need(now.sha256===state.attempt.sha256,'BUSINESS_CONTINUITY');return true;
 }catch(error){if(entry)entry.active=false;state?.captureFailure(error);revoke(state);throw error;}
}
function claimCurrent259PaymentBusinessPermit(permit,application,handle){
 const original=permit&&!types.isProxy(permit)&&businessPermissions.get(permit);
 const gap=permit&&!types.isProxy(permit)&&attributionGapPermissions.get(permit);
 const voucher=permit&&!types.isProxy(permit)&&voucherBusinessPermissions.get(permit);
 const entry=original||gap||voucher;
 if(original)businessPermissions.delete(permit);
 if(gap)attributionGapPermissions.delete(permit);
 if(voucher)voucherBusinessPermissions.delete(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun?.business&&entry.active&&!entry.claimed&&
   Boolean(gap)===(entry.scope.scenario==='attribution-gap')&&
   Boolean(voucher)===(entry.scope.scenario==='competition-voucher')&&
   entry.scope.paymentProfile===(currentRun.competition||currentRun.attributionGap?currentRun.paymentProfile:undefined)&&entry.application===application&&entry.handle===handle&&equal(entry.effectiveAccessBinding,currentRun.effectiveAccessBinding),'BUSINESS_AUTHORITY');
  entry.claimed=true;const token=Object.freeze({kind:'CURRENT259_PRIVATE_BUSINESS_CONTINUITY'});entry.continuityToken=token;businessContinuities.set(token,entry);entry.check();
  return Object.freeze({scope:entry.scope,continuityToken:token,check:entry.check,verifyFull:entry.verifyFull,
   ...(entry.paymentProfile!==undefined?{paymentProfile:entry.paymentProfile}:{}),
   ...(entry.effectiveAccessBinding?{effectiveAccessBinding:entry.effectiveAccessBinding}:{}),
   ...(entry.seedProfile?{seedProfile:entry.seedProfile}:{}),
   ...(entry.recordCaseFailure?{recordCaseFailure(stage,code,httpStatus,httpPhase,diagnostic){recordCaseFailure(entry,stage,code,httpStatus,httpPhase,diagnostic);}}:{}),
   ...(gap?{recordAttributionGapFailure(stage){
    const code=attributionGapFailureCodes.get(stage);
    if(code&&entry===currentRun?.business&&entry.active&&entry.claimed)entry.attributionGapFailure??=Object.freeze({stage,code});
   }}:{}),
   ...(voucher?{recordVoucherFailure(stage){
    const code=voucherFailureCodes.get(stage);
    if(code&&entry===currentRun?.business&&entry.active&&entry.claimed)entry.voucherFailure??=Object.freeze({stage,code});
   }}:{})});
 }catch(error){recordCaseFailure(entry,'PERMIT_CLAIM',data(error,'code'));revoke(currentRun);throw error;}
}
// Publish the only export before the fixed consumer can require it in main.
const moduleApi=Object.freeze({claimCurrent259B7WritePermit,claimCurrent259PaymentBusinessPermit,assertCurrent259PaymentBusinessContinuity,claimCurrent259CompetitionRolePermit,claimCurrent259Payment261CompetitionRolePermit,claimCurrent259CompetitionLivePermit,claimCurrent259DisconnectLivePermit,claimCurrent259VoucherAclPermit,claimCurrent259Payment261RolePermit,
 claimCurrent259Payment261VoucherRolePermit,claimCurrent259Payment261AttributionGapRolePermit});
module.exports=moduleApi;
// B7's original lineage imports the technical owner before loader/core caches.
const records=[];
function original(relative,names){
 const file=require.resolve(relative),exports=require(relative),loaded=require.cache[file];
 const slots=Object.fromEntries(names.map(key=>{const d=Object.getOwnPropertyDescriptor(exports,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function','IMPORT');return [key,d];}));
 records.push({file,exports,loaded,slots});return exports;
}
const diagnosticExports=original('./task16-current259-payment-diagnostics.cjs',['isPaymentFailureCode','filterPaymentDiagnostic','describePaymentDiagnostic','carryPaymentDiagnostic']);
need(diagnosticExports.isPaymentFailureCode===isPaymentFailureCode&&diagnosticExports.filterPaymentDiagnostic===filterPaymentDiagnostic,'IMPORT');
const {installCurrent259B7}=original('./task16-current259-b7-install.cjs',['installCurrent259B7']);
const {createCurrent259TechnicalMigration,describeCurrent259TechnicalFailure}=original('./local-staged-current259-profile.cjs',
 ['createCurrent259TechnicalMigration','describeCurrent259TechnicalFailure']);
const {describeCurrent259DisconnectFailure,captureCurrent259DisconnectFailure,carryCurrent259DisconnectFailure}=original(
 './task16-current259-disconnect-failure.cjs',
 ['describeCurrent259DisconnectFailure','captureCurrent259DisconnectFailure','carryCurrent259DisconnectFailure']);
const {provisionCurrent259Roles}=original('./task16-current259-role-provision.cjs',['provisionCurrent259Roles']);
const {installCurrent259SevenFragments,describeCurrent259SevenFailure}=original('./task16-current259-seven-install.cjs',
 ['installCurrent259SevenFragments','describeCurrent259SevenFailure']);
const {installCurrent259PaymentAcl}=original('./task16-current259-payment-acl-install.cjs',['installCurrent259PaymentAcl']);
const {withCurrent259TechnicalResource,withCurrent259FirstRollbackResource,withCurrent259NormalPaymentResource,
 withCurrent259ResponseLossResource,withCurrent259CompetitionResource,withCurrent259VoucherResource,
 withCurrent259DisconnectRecoveryResource,withCurrent259AttributionGapResource,claimCurrent259TechnicalResource}=original('./task16-current259-owned-resource.cjs',
 ['withCurrent259TechnicalResource','withCurrent259FirstRollbackResource','withCurrent259NormalPaymentResource',
  'withCurrent259ResponseLossResource','withCurrent259CompetitionResource','withCurrent259VoucherResource','withCurrent259DisconnectRecoveryResource','withCurrent259AttributionGapResource',
  'claimCurrent259TechnicalResource']);
const paymentResources=Object.freeze({normal:withCurrent259NormalPaymentResource,'response-loss':withCurrent259ResponseLossResource,
 'cancel-commit':withCurrent259FirstRollbackResource,competition:withCurrent259CompetitionResource,'competition-follow-up':withCurrent259CompetitionResource,
 'competition-voucher':withCurrent259VoucherResource,
 'disconnect-commit-recovery':withCurrent259DisconnectRecoveryResource,'attribution-gap':withCurrent259AttributionGapResource});
const {renderCurrent259CatalogRead}=original('./task16-current259-catalog.cjs',['renderCurrent259CatalogRead']);
const {readQualifiedTask16File:read}=original('./task16-runtime-inputs.cjs',['readQualifiedTask16File']);
function importsCheck(){
 need(require.cache[__filename]===module&&data(module,'exports')===moduleApi,'IMPORT_CHANGED');
 for(const row of records){
  need(require.cache[row.file]===row.loaded&&data(row.loaded,'exports')===row.exports,'IMPORT_CHANGED');
  for(const [key,descriptor]of Object.entries(row.slots))need(equal(Object.getOwnPropertyDescriptor(row.exports,key),descriptor),'IMPORT_CHANGED');
 }
}
function safeCode(error){
 const code=data(error,'code');
 return typeof code==='string'&&/^(?:PAYMENT_INSTALL_(?:PLAN|ONCE)|PAYMENT_BUSINESS_PLAN|CURRENT259_(?:RESOURCE|BUILD|LOADER|B7_INSTALL|ROLE_PROVISION|SEVEN|TECHNICAL)|TASK16_CURRENT259_PAYMENT_ACL|TASK16_CURRENT259_CATALOG|CURRENT259_PFQ|TASK01_RESOURCE)_[A-Z0-9_]+$/u.test(code)?code:'PAYMENT_INSTALL_ONCE_FAILED_CLOSED';
}
function checkRoot(plan){
 const root=plan.run.root;need(fs.realpathSync(root)===root,'DIRECTORY');const st=fs.lstatSync(root);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&['dev','ino','uid','gid','mode'].every(key=>st[key]===plan.run.identity[key]),'DIRECTORY');
}
function writeNew(plan,file,bytes){
 checkRoot(plan);need(path.dirname(file)===plan.run.root,'PATH');let fd;
 try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 const dir=fs.openSync(plan.run.root,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function publish(plan,receipt){
 const file=plan.run.receiptFile,pending=file+'.pending',bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
 writeNew(plan,pending,bytes);fs.linkSync(pending,file);fs.unlinkSync(pending);
 const dir=fs.openSync(plan.run.root,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}return hash(bytes);
}
function resourceIdentity(raw,startup=false,topology){
 const keys=['runId','sourceSha','daemonId','endpoint','imageId','containerId','networkId','databaseName','port'];
 const row=Object.fromEntries(keys.map(key=>[key,data(raw,key)]));
 need(typeof row.runId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.runId)&&
  ['containerId','networkId'].every(key=>hex(row[key],64)||startup&&row[key]===null)&&
  row.databaseName==='jg_task01_'+row.runId.replaceAll('-','')&&
  (Number.isInteger(row.port)&&row.port>1024&&row.port<=65535||startup&&row.port===null),'RESOURCE_IDENTITY');
 if(topology){
  need(data(raw,'topology')===topology,'RESOURCE_IDENTITY');
  const relay=data(raw,'relay');
  if(startup&&row.port===null)need(relay===null,'RESOURCE_IDENTITY');
  else{
   const witness=fixed(relay,['id','containerId','host','port']);
   need(typeof witness.id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(witness.id)&&
    witness.containerId===row.containerId&&witness.host==='127.0.0.1'&&witness.port===row.port,'RESOURCE_IDENTITY');
  }
  row.topology=topology;row.relay=relay===null?null:Object.freeze({...relay});
  const hba=data(raw,'loopbackPlaintextHba');
  if(!startup||hba!==undefined){
   const evidence=fixed(hba,['sourceAddress','role','databaseName','noEncryptionRejected']);
   need(evidence.sourceAddress==='127.0.0.1'&&evidence.role==='jg_task01_owner'&&evidence.databaseName===row.databaseName&&evidence.noEncryptionRejected===true,'RESOURCE_IDENTITY');
   row.loopbackPlaintextHba=Object.freeze(evidence);
  }
 }
 return Object.freeze(row);
}
function finalResource(plan,created,started,firstError,topology){
 if(!started)return {status:'not-attempted',cleanup:{status:'not-needed'}};
 checkRoot(plan);const file=path.join(plan.run.resourceDir,'resource-manifest.json');
 if(!fs.existsSync(file))return {status:'unconfirmed',cleanup:{status:'UNKNOWN'}};
 const capture=read(file,{privateFile:true,maxBytes:1048576,collect:true,code:'PAYMENT_INSTALL_ONCE_MANIFEST'});
 const final=JSON.parse(capture.bytes.toString('utf8'));
 let identityBinding='ORIGINAL_LIVE_HANDLE_AND_FINAL_MANIFEST',identity=created,diagnostic={};
 if(!created){
  const starter=data(firstError,'resourceReceipt');
  if(data(firstError,'code')!=='TASK01_RESOURCE_START_FAILED'||!starter||!equal(starter,final))
   return {status:'unconfirmed',identityBinding:'UNCONFIRMED_MANIFEST_ONLY',cleanup:{status:'UNKNOWN'},manifestSha256:capture.sha256};
  identity=resourceIdentity(final,true,topology);
  const attempts=fixed(data(final,'attempts'),['network','container']);
  need(data(final,'purpose')==='CURRENT259_TECHNICAL_MIGRATIONS_V1'&&data(final,'phase')==='failed'&&
   identity.sourceSha===plan.material.source.candidateSha&&['daemonId','endpoint','imageId'].every(key=>identity[key]===plan.resource[key])&&
   typeof attempts.network==='boolean'&&typeof attempts.container==='boolean'&&(!attempts.container||attempts.network)&&
   (attempts.network||identity.networkId===null)&&(attempts.container||identity.containerId===null),'RESOURCE_CHANGED');
  const observed=data(final,'startupFailure'),failureCode=data(final,'failureCode');
  if(observed){
   const startupFailure=fixed(observed,['stage','commandKind']);
   need(['private-configuration','daemon-and-image','certificates','network-creation','container-creation','bundle-install',
    'container-start','postgres-readiness','published-port-probe','published-port-inspect','loopback-forward-start','presented-certificate','loopback-plaintext-hba'].includes(startupFailure.stage)&&
    [null,'timeout','aborted','output-limit','spawn-error','signal-exit','nonzero-exit'].includes(startupFailure.commandKind)&&
    typeof failureCode==='string'&&/^TASK01_RESOURCE_[A-Z0-9_]+$/u.test(failureCode),'RESOURCE_CHANGED');
   diagnostic={startupFailure,startupFailureCode:failureCode};
  }
  identityBinding='ORIGINAL_STARTER_EXCEPTION_AND_FINAL_MANIFEST';
 }else need(equal(resourceIdentity(final,false,topology),created),'RESOURCE_CHANGED');
 const cleanup=data(final,'cleanup'),closed=data(final,'status')==='closed'&&data(cleanup,'status')==='completed'&&['containerAbsent','volumesAbsent','networkAbsent'].every(key=>data(cleanup,key)===true)&&
  (!topology||data(cleanup,'relayClosed')===true&&data(cleanup,'relayId')===(identity.relay?.id??null));
 if(!created&&closed){
  const attempts=data(final,'attempts');
  need((!data(attempts,'network')||identity.networkId!==null)&&(!data(attempts,'container')||identity.containerId!==null),'RESOURCE_CHANGED');
 }
 const absence=Object.fromEntries(['containerAbsent','volumesAbsent','networkAbsent'].map(key=>[key,topology?data(cleanup,key)===true:closed]));
 const relayCleanup=topology?{relayClosed:data(cleanup,'relayClosed')===true&&data(cleanup,'relayId')===(identity.relay?.id??null),relayId:identity.relay?.id??null}:{};
 return {...identity,...diagnostic,status:closed?'closed':'unconfirmed',identityBinding,
  cleanup:{status:closed?'completed':'UNKNOWN',...absence,...relayCleanup},manifestSha256:capture.sha256,independentDockerChecker:false};
}
function parse(args){
 need(Array.isArray(args)&&args.every(value=>typeof value==='string'),'ARGUMENTS');
 let progressRoot;
 if(args.at(-2)==='--progress-root'){progressRoot=args.at(-1);args=args.slice(0,-2);}
 const voucher261=args[0]==='--voucher261'||args[0]==='--voucher261-once';
 const voucher=voucher261||args[0]==='--voucher'||args[0]==='--voucher-once';
 const followUp261=args[0]==='--competition-follow-up261'||args[0]==='--competition-follow-up261-once';
 const competition261=followUp261||args[0]==='--competition261'||args[0]==='--competition261-once';
 const competition=voucher||competition261||args[0]==='--competition'||args[0]==='--competition-once';
 const attributionGap261=args[0]==='--attribution-gap261'||args[0]==='--attribution-gap261-once';
 const attributionGap=attributionGap261||args[0]==='--attribution-gap'||args[0]==='--attribution-gap-once';
 const pfq=args[0]==='--pfq-composition'||args[0]==='--pfq-composition-once';
 const business261=args[0]==='--business261'||args[0]==='--business261-once';
 const payment261=business261||competition261||voucher261||attributionGap261||args[0]==='--install261'||args[0]==='--install261-once';
 const business=business261||competition||attributionGap||args[0]==='--business'||args[0]==='--business-once';
 const once=ONCE_OPTIONS.includes(args[0]),rest=once||business||pfq||payment261?args.slice(1):args;
 need(progressRoot===undefined||once,'ARGUMENTS');
 need(rest.length===4&&rest[0]==='--plan'&&rest[2]==='--expected-plan-sha256'&&hex(rest[3],64),'ARGUMENTS');
 return {once,business,payment261,followUp261,competition261,competition,attributionGap,attributionGap261,voucher,voucher261,pfq,file:rest[1],sha256:rest[3],progressRoot};
}
async function run(args){
 const requestedOnce=Array.isArray(args)&&ONCE_OPTIONS.includes(args[0]);
 let request,plan,receipt,checked,created,started=false,marker=false,published=false,publicationStarted=false;
 let disconnect=false;
 let hasFirst=false,first,firstBusiness,stage='preflight',state,controller,timer,businessFlow,endAt;
 const startedAt=performance.now(),stageTimings=[];
 const checkTimings=Object.fromEntries(['planVerification','planCheck','resourceCheck','inputCheck'].map(name=>[name,{count:0,elapsedMs:0}]));
 const checkSnapshot=()=>Object.fromEntries(Object.entries(checkTimings).map(([name,row])=>[name,{count:row.count,elapsedMs:Math.round(row.elapsedMs)}]));
 function measured(name,call){const before=performance.now();checkTimings[name].count++;try{return call();}finally{checkTimings[name].elapsedMs+=performance.now()-before;}}
 let progressIdentity,progressSequence=0,progressFailed=false;
 const progressPhases=new Set(['preflight','resourceStartup','technical259','technical261','roles9','sevenFragments','paymentAcl','b7',
  'pfqConcurrency','liveSessions','applicationEnvironment','ownedApplication','replacementApplication','seedAndSelectedCase',
  'closeOriginalApplication','retireOriginalRuntimeAndConfirmRollback','ownedCleanup']);
 function progressDirectory(){
  const root=request.progressRoot,sourceRoot=path.resolve(__dirname,'../../..');
  need(typeof root==='string'&&path.isAbsolute(root)&&path.normalize(root)===root&&fs.realpathSync(root)===root&&
   root!==sourceRoot&&!root.startsWith(sourceRoot+path.sep)&&root!==plan.run.root&&!root.startsWith(plan.run.root+path.sep),'PROGRESS_ROOT');
  let cursor=path.parse(root).root;for(const part of root.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);need(!fs.lstatSync(cursor).isSymbolicLink(),'PROGRESS_ROOT');}
  const st=fs.lstatSync(root);need(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700,'PROGRESS_ROOT');
  const identity=Object.fromEntries(['dev','ino','uid','gid','mode'].map(key=>[key,st[key]]));
  need(!progressIdentity||equal(identity,progressIdentity),'PROGRESS_ROOT');return identity;
 }
 function recordProgress(event){
  if(!progressIdentity||progressFailed)return;
  let fd,dir;
  try{
   progressDirectory();need(progressSequence<64&&progressPhases.has(stage),'PROGRESS_WRITE');
   const sequence=progressSequence+1,root=request.progressRoot;
   const target=path.join(root,String(sequence).padStart(3,'0')+'-'+(event==='PHASE'?stage:'finalization')+'.json');
   const now=performance.now(),row={schemaVersion:1,event,sequence,expectedCandidateSha:plan.material.source.candidateSha,
    planSha256:request.sha256,phase:stage,elapsedMs:Math.round(now-startedAt),phaseElapsedMs:Math.round(now-stageStartedAt),
    stages:stageTimings.slice(),checks:checkSnapshot(),businessOutcome:receipt.business?.outcome??'NOT_ENTERED',
    resource:created?Object.fromEntries(['runId','sourceSha','daemonId','endpoint','imageId','containerId','networkId','databaseName','port'].map(key=>[key,created[key]])):null,
    cleanup:receipt.resource?.cleanup??{status:'PENDING'},
    ...(receipt.failureCode?{failureCode:diagnosticCode(receipt.failureCode),failureStage:receipt.failureStage}:{}),
    ...(receipt.secondaryFailures?{secondaryFailures:receipt.secondaryFailures.slice()}:{}),
    ...(receipt.paymentCaseFailure?{paymentCaseFailure:receipt.paymentCaseFailure}:{}),
    ...(receipt.attributionGapFailure?{attributionGapFailure:receipt.attributionGapFailure}:{}),
    ...(receipt.voucherFailure?{voucherFailure:receipt.voucherFailure}:{}),
    receiptPublished:false,executionAllowed:false,nativeAdmission:false,financialAcceptance:false};
   fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   progressDirectory();const st=fs.fstatSync(fd);need(st.isFile()&&st.uid===process.getuid()&&st.nlink===1&&(st.mode&0o777)===0o600,'PROGRESS_WRITE');
   const bytes=Buffer.from(JSON.stringify(row,null,2)+'\n');need(bytes.length<=65536,'PROGRESS_WRITE');
   fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
   dir=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);fs.fsyncSync(dir);progressSequence=sequence;
  }catch{progressFailed=true;throw fault('PROGRESS_WRITE');}
  finally{if(fd!==undefined)fs.closeSync(fd);if(dir!==undefined)fs.closeSync(dir);}
 }
 function initializeProgress(){
  if(request.progressRoot===undefined)return;
  try{progressIdentity=progressDirectory();need(fs.readdirSync(request.progressRoot).length===0,'PROGRESS_ROOT');}
  catch{progressIdentity=undefined;throw fault('PROGRESS_ROOT');}
  recordProgress('PHASE');
 }

 let stageStartedAt=startedAt,resourceStartedAt,resourceAbort,failureObservedAt;
 function recordStage(now){
  stageTimings.push({stage,elapsedMs:Math.round(now-stageStartedAt)});
  stageStartedAt=now;
 }
 function enterStage(next){recordStage(performance.now());stage=next;recordProgress('PHASE');}
 function abort(origin){
  if(!controller||controller.signal.aborted)return;
  resourceAbort={origin,stage,elapsedMs:Math.round(performance.now()-resourceStartedAt)};
  controller.abort();
 }
 const onSigint=()=>abort('SIGNAL_SIGINT'),onSigterm=()=>abort('SIGNAL_SIGTERM');
 function recordTiming(row){
  if(row.timing)return;
  const now=performance.now();recordStage(failureObservedAt??now);
  row.timing={elapsedMs:Math.round(now-startedAt),stages:stageTimings.slice(),checks:checkSnapshot(),
   ...(resourceAbort?{resourceAbort}:{}),...(failureObservedAt===undefined?{}:{finalizationMs:Math.round(now-failureObservedAt)})};
 }
 function refreshBusinessFailureContext(){
  // Only the original opaque business entry may enrich its already latched
  // failure. Its fixed case context can arrive after the continuity throw.
  if(receipt?.failureStage==='seedAndSelectedCase'&&firstBusiness?.recordCaseFailure){
   if(firstBusiness.claimed&&receipt.business?.permission==='ISSUED_NOT_YET_CONSUMED')receipt.business.permission='CONSUMED_ONCE';
   if(firstBusiness.caseFailure)receipt.paymentCaseFailure??=firstBusiness.caseFailure;
  }
  if(request?.attributionGap&&firstBusiness?.attributionGapFailure)receipt.attributionGapFailure??=firstBusiness.attributionGapFailure;
  if(request?.voucher&&firstBusiness?.voucherFailure)receipt.voucherFailure??=firstBusiness.voucherFailure;
 }
 function rememberFirst(error){
  if(hasFirst){refreshBusinessFailureContext();return;}
  failureObservedAt=performance.now();hasFirst=true;first=error;firstBusiness=state?.business;receipt.failureCode=safeCode(error);receipt.failureStage=stage;
  const technicalFailure=stage==='technical259'||stage==='technical261'?describeCurrent259TechnicalFailure(error):undefined;
  if(technicalFailure)receipt.technicalFailure=technicalFailure;
  const sevenFailure=stage==='sevenFragments'?describeCurrent259SevenFailure(error):undefined;
  if(sevenFailure)receipt.sevenFailure=sevenFailure;
  const liveFailure=stage==='liveSessions'&&!request.competition&&!disconnect?businessFlow?.describeCurrent259LiveFailure(error):undefined;
  if(liveFailure)receipt.liveFailure=liveFailure;
  if(stage==='ownedApplication'||stage==='replacementApplication'){
   const applicationFailure=businessFlow?.describeCurrent259ApplicationFailure(error);
   if(applicationFailure)receipt.applicationFailure=applicationFailure;
  }
  const disconnectFailure=disconnect?describeCurrent259DisconnectFailure(error):undefined;
  if(disconnectFailure)receipt.disconnectFailure=disconnectFailure;
  refreshBusinessFailureContext();
 }
 const secondarySeen=new Set();
 function rememberSecondary(error,boundary){
  if(!receipt||!hasFirst||error===first||secondarySeen.has(error)||secondarySeen.size>=8)return;
  secondarySeen.add(error);
  (receipt.secondaryFailures??=[]).push({boundary,stage,code:diagnosticCode(data(error,'code'))});
 }
 try{
  request=parse(args);if(request.once)need(FRESH&&!onceAttempted,'FRESH_MAIN');
  const paymentProfile=request.voucher261?PAYMENT261_VOUCHER_RUNTIME_PROFILE:request.attributionGap261?PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE:
   request.competition261?PAYMENT261_COMPETITION_RUNTIME_PROFILE:request.payment261?PAYMENT261_RUNTIME_PROFILE:undefined;
  const names=request.followUp261?['readCurrent261PaymentCompetitionFollowUpPlan','verifyCurrent261PaymentCompetitionFollowUpPlan']:request.voucher261?['readCurrent261PaymentVoucherPlan','verifyCurrent261PaymentVoucherPlan']:
   request.attributionGap261?['readCurrent261PaymentAttributionGapPlan','verifyCurrent261PaymentAttributionGapPlan']:
   request.competition261?['readCurrent261PaymentCompetitionPlan','verifyCurrent261PaymentCompetitionPlan']:
   request.payment261?(request.business?['readCurrent261PaymentBusinessPlan','verifyCurrent261PaymentBusinessPlan']:['readCurrent261PaymentInstallPlan','verifyCurrent261PaymentInstallPlan']):
   request.pfq?['readCurrent259PfqCompositionPlan','verifyCurrent259PfqCompositionPlan']:request.voucher?['readCurrent259PaymentVoucherPlan','verifyCurrent259PaymentVoucherPlan']:request.competition?['readCurrent259PaymentCompetitionPlan','verifyCurrent259PaymentCompetitionPlan']:
   request.attributionGap?['readCurrent259PaymentAttributionGapPlan','verifyCurrent259PaymentAttributionGapPlan']:
   request.business?['readCurrent259PaymentBusinessPlan','verifyCurrent259PaymentBusinessPlan']:['readCurrent259PaymentInstallPlan','verifyCurrent259PaymentInstallPlan'];
  const planModule=original(request.business?'../../../scripts/prepare-task16-current259-payment-business.cjs':'../../../scripts/prepare-task16-current259-payment-install.cjs',names);
  const [readPlan,verifyPlan]=names.map(name=>planModule[name]);
  const basic=readPlan(request.file,request.sha256);plan=basic.plan;
  const loopbackScenario=request.pfq?'cancel-commit':request.business?plan.case.scenario:undefined;
  const loopback=paymentLoopbackForScenario(loopbackScenario);
  need(plan.scope.migrations===(request.payment261?261:259)&&
   plan.scope.paymentProfile===paymentProfile,'LEDGER_PROFILE');
  const {isExactCurrentPaymentRuntimeSource}=request.payment261?original('./task16-current261-competition-profile.cjs',['isExactCurrentPaymentRuntimeSource']):{};
  function checkPayment261Source(source){
   if(request.payment261)need(isExactCurrentPaymentRuntimeSource(source.profile,paymentProfile)&&
    source.profile.ledgerSha256===plan.material.source.ledgerSha256&&source.candidateSha===plan.material.source.candidateSha&&
    source.sourceSealSha256===plan.material.source.sourceSealSha256,'LEDGER_PROFILE');
  }
  need(plan.scope.databaseTransport===loopback?.plan&&request.attributionGap===(loopbackScenario==='attribution-gap')&&
   request.voucher===(loopbackScenario==='competition-voucher')&&
   request.competition===(loopbackScenario==='competition'||loopbackScenario==='competition-follow-up'||loopbackScenario==='competition-voucher'),'RESOURCE_PROFILE');
  if(!request.once){
   checked=verifyPlan(request.file,request.sha256);checked.check();importsCheck();
   if(request.payment261)checkPayment261Source(checked.loader.witness().source);
   return {status:request.followUp261?'PAYMENT261_COMPETITION_FOLLOW_UP_PLAN_VERIFIED_NO_RESOURCES':request.voucher261?'PAYMENT261_VOUCHER_PLAN_VERIFIED_NO_RESOURCES':request.attributionGap261?'PAYMENT261_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES':request.competition261?'PAYMENT261_COMPETITION_PLAN_VERIFIED_NO_RESOURCES':request.payment261?(request.business?'PAYMENT261_BUSINESS_PLAN_VERIFIED_NO_RESOURCES':'PAYMENT261_INSTALL_PLAN_VERIFIED_NO_RESOURCES'):request.pfq?'PFQ_COMPOSITION_PLAN_VERIFIED_NO_RESOURCES':request.voucher?'PAYMENT_VOUCHER_PLAN_VERIFIED_NO_RESOURCES':request.competition?'PAYMENT_COMPETITION_PLAN_VERIFIED_NO_RESOURCES':request.attributionGap?'PAYMENT_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES':request.business?'PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES':'PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES',candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:false,resourcesExecuted:false};
  }
  onceAttempted=true;
  try{writeNew(plan,plan.run.attemptFile,JSON.stringify({status:'STARTED',purpose:plan.purpose,planSha256:request.sha256,candidateSha:plan.material.source.candidateSha,onceAttemptConsumed:true})+'\n');}
  catch(error){if(data(error,'code')==='EEXIST')throw fault('ALREADY_ATTEMPTED');throw error;}
  marker=true;
  const attempt=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,collect:true,code:'PAYMENT_INSTALL_ONCE_ATTEMPT'});
  receipt={schemaVersion:1,purpose:plan.purpose,expectedCandidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,
   status:'STOPPED',scope:plan.scope,limits:plan.limits,stages:[],sourceMaterialVerified:false,
   executionAllowed:false,nativeAdmission:false,financialAcceptance:false,liveSessionAdmission:false};
  initializeProgress();
  // Capture the fixed business closure before the first installation await,
  // never adopt a cache/export replacement after B7 has already been written.
  if(request.business)original('./task16-current259-business-continuity.cjs',['captureCurrent259BusinessIssuer']).captureCurrent259BusinessIssuer();
  const withResource=loopback?paymentResources[loopbackScenario]:withCurrent259TechnicalResource;
  disconnect=request.business&&plan.case.scenario==='disconnect-commit-recovery';
  if(request.business&&(plan.case.scenario==='cancel-commit'||disconnect))original('./task16-current259-a16-fault.cjs',['createCurrent259A16FaultPlan']);
  const installVoucherAcl=request.voucher?original('./task16-current259-payment-acl-install.cjs',['installCurrent259VoucherPaymentAcl']).installCurrent259VoucherPaymentAcl:undefined;
  const payment261Provision=request.attributionGap261?'provisionCurrent259Payment261AttributionGapRoles':'provisionCurrent259Payment261Roles';
  const provisionPayment261=request.payment261&&!request.competition?original('./task16-current259-role-provision.cjs',[payment261Provision])[payment261Provision]:undefined;
  const competitionProvision=request.voucher261?'provisionCurrent259Payment261VoucherRoles':request.competition261?'provisionCurrent259Payment261CompetitionRoles':'provisionCurrent259CompetitionRoles';
  const provisionCompetition=request.competition?original('./task16-current259-role-provision.cjs',[competitionProvision])[competitionProvision]:undefined;
  if(request.competition)original('./task16-current259-payment-competition.cjs',['executeCurrent259PaymentCompetition']);
  const liveSessions=request.business?original('./task16-current259-live-sessions.cjs',
   ['withCurrent259LiveSessions','describeCurrent259LiveFailure','describeCurrent259ApplicationFailure']):undefined;
  businessFlow=request.business?Object.freeze({
   withCurrent259LiveSessions:liveSessions.withCurrent259LiveSessions,
   describeCurrent259LiveFailure:liveSessions.describeCurrent259LiveFailure,
   describeCurrent259ApplicationFailure:liveSessions.describeCurrent259ApplicationFailure,
   withCurrent259ApplicationEnvironment:original('./task16-current259-application-environment.cjs',['withCurrent259ApplicationEnvironment']).withCurrent259ApplicationEnvironment,
   withCurrent259OwnedApplication:original('./task16-current259-application-factory.cjs',['withCurrent259OwnedApplication']).withCurrent259OwnedApplication,
   runCurrent259PaymentCase:original('./task16-current259-payment-case.cjs',['runCurrent259PaymentCase']).runCurrent259PaymentCase,
   ...(request.competition?{
    withCompetitionLiveSessions:original('./task16-current259-live-sessions.cjs',['withCurrent259CompetitionLiveSessions']).withCurrent259CompetitionLiveSessions,
    withCompetitionApplications:original('./task16-current259-application-factory.cjs',['withCurrent259OwnedApplicationPair']).withCurrent259OwnedApplicationPair,
    runCompetition:original('./task16-current259-application-factory.cjs',['consumeCurrent259PaymentCompetition']).consumeCurrent259PaymentCompetition
   }:{}),
   ...(disconnect?{
    withDisconnectLiveSessions:original('./task16-current259-live-sessions.cjs',['withCurrent259DisconnectLiveSessions']).withCurrent259DisconnectLiveSessions,
    withDisconnectOriginalApplication:original('./task16-current259-application-factory.cjs',['withCurrent259OwnedDisconnectApplication','claimCurrent259DisconnectApplicationClose']).withCurrent259OwnedDisconnectApplication
   }:{})
  }):undefined;
  const runPfq=request.pfq?original('./task16-current259-pfq-concurrency.cjs',['runCurrent259PfqConcurrency']).runCurrent259PfqConcurrency:undefined;
  try{
   need(!fs.existsSync(plan.run.receiptFile)&&!fs.existsSync(plan.run.receiptFile+'.pending'),'RECEIPT_EXISTS');
   checked=measured('planVerification',()=>verifyPlan(request.file,request.sha256));
   need(equal(basic.file.identity,checked.file.identity),'PLAN_REPLACED');checked.check();importsCheck();
   if(request.payment261)checkPayment261Source(checked.loader.witness().source);
   receipt.sourceMaterialVerified=true;
   const effectiveAccessBinding=plan.material.installation.effectiveAccessBinding;
   need(paymentProfile===PAYMENT261_RUNTIME_PROFILE?effectiveAccessBinding?.paymentProfile===paymentProfile&&effectiveAccessBinding.insertAdditionCount===9&&hex(effectiveAccessBinding.accessPlanSha256,64):effectiveAccessBinding===undefined,'EFFECTIVE_ACCESS_BINDING');
   if(effectiveAccessBinding)receipt.effectiveAccessBinding=effectiveAccessBinding;
   need(!fs.existsSync(plan.run.resourceDir),'RESOURCE_CHILD_EXISTS');
   controller=new AbortController();resourceStartedAt=performance.now();endAt=Date.now()+plan.limits.resourceMs;
   process.once('SIGINT',onSigint);process.once('SIGTERM',onSigterm);timer=setTimeout(()=>abort('RESOURCE_DEADLINE'),plan.limits.resourceMs);
   enterStage('resourceStartup');started=true;
   await withResource(checked.buildHandle,{artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,async handle=>{
    const view=claimCurrent259TechnicalResource(handle),source=view.source;created=resourceIdentity(view.resource.getReceipt(),false,loopback?.topology);
    checkPayment261Source(source);
    need(created.sourceSha===plan.material.source.candidateSha&&created.daemonId===plan.resource.daemonId&&created.endpoint===plan.resource.endpoint&&created.imageId===plan.resource.imageId,'RESOURCE_IDENTITY');
    state={active:true,controller,abort,captureFailure:rememberFirst,handle,view,source,plan,attempt,checkedBuild:checked.buildHandle,checkedInputs:()=>measured('inputCheck',()=>checked.checkInputs()),endAt,planSha256:request.sha256,claimed:false,writeUsed:false,payment261:request.payment261,paymentProfile,effectiveAccessBinding,competition:request.competition,voucher:request.voucher,attributionGap:request.attributionGap,disconnect};
    currentRun=state;
    let resolveAbort;
    const cancellation=new Promise(resolve=>{resolveAbort=resolve;});
    const onAbort=()=>{state.active=false;resolveAbort({aborted:true});};
    EventTarget.prototype.addEventListener.call(controller.signal,'abort',onAbort,{once:true});
    const settled=async promise=>{
     const tagged=Promise.resolve(promise).then(value=>({value}),error=>({failed:true,error}));
     const result=await Promise.race([tagged,cancellation]);
     if(result.aborted)throw fault('ABORTED_UNSETTLED');
     if(result.failed)throw result.error;
     return result.value;
    };
    state.check=()=>{
     try{
      need(state.active&&!controller.signal.aborted,'CLOSED');importsCheck();measured('planCheck',()=>checked.check());measured('resourceCheck',()=>view.check());
      const now=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,collect:true,expectedIdentity:attempt.identity,code:'PAYMENT_INSTALL_ONCE_ATTEMPT_CHANGED'});
      need(now.sha256===attempt.sha256&&claimCurrent259TechnicalResource(handle)===view&&view.source===source&&
       source.candidateSha===plan.material.source.candidateSha&&source.sourceSealSha256===plan.material.source.sourceSealSha256,'SCOPE_CHANGED');
     }catch(error){rememberFirst(error);revoke(state);throw error;}
    };
    const completed=(name,result)=>{state.check();need(result&&result.sourceSha===source.candidateSha&&result.runId===view.runId,'STAGE_RESULT');
     receipt.stages.push(Object.freeze({stage:name,status:'RETURNED_NOT_ADMISSION',...(result.installXid?{installXid:result.installXid}:{}),...(result.commitXid?{commitXid:result.commitXid}:{})}));};
    try{
     state.check();enterStage(request.payment261?'technical261':'technical259');
     const technical=await settled(createCurrent259TechnicalMigration(handle,controller.signal).migrate());completed(stage,technical);
     enterStage('roles9');let roles;
     if(request.competition){
      state.technical=technical;
      const rolePermit=Object.freeze({kind:'CURRENT259_PRIVATE_COMPETITION_ROLES'});competitionRolePermissions.set(rolePermit,state);
      try{roles=await settled(provisionCompetition(technical,handle,rolePermit));}finally{competitionRolePermissions.delete(rolePermit);}
      need(roles.paymentProfile===paymentProfile,'COMPETITION_ROLE_AUTHORITY');
     }else if(request.payment261){
      state.technical=technical;
      const rolePermit=Object.freeze({kind:'CURRENT259_PRIVATE_PAYMENT261_ROLES'});payment261RolePermissions.set(rolePermit,state);
      try{roles=await settled(provisionPayment261(technical,handle,rolePermit));}finally{payment261RolePermissions.delete(rolePermit);}
      need(state.payment261RolesClaimed&&roles.paymentProfile===paymentProfile,'PAYMENT261_ROLE_AUTHORITY');
     }else roles=await settled(provisionCurrent259Roles(technical,handle));
     completed(stage,roles);
     enterStage('sevenFragments');const seven=await settled(installCurrent259SevenFragments(roles,handle));completed(stage,seven);
     enterStage('paymentAcl');let acl;
     if(request.voucher){
      state.seven=seven;
      const voucherPermit=Object.freeze({kind:'CURRENT259_PRIVATE_VOUCHER_ACL'});
      voucherAclPermissions.set(voucherPermit,state);
      try{acl=await settled(installVoucherAcl(seven,handle,voucherPermit));}finally{voucherAclPermissions.delete(voucherPermit);}
      need(state.voucherAclClaimed===true,'VOUCHER_ACL_AUTHORITY');
     }else acl=await settled(installCurrent259PaymentAcl(seven,handle));
     completed(stage,acl);
     need(acl.status==='CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION'&&hex(acl.sourceSha,40)&&typeof acl.installXid==='string'&&/^[1-9][0-9]*$/u.test(acl.installXid),'ACL');
     need(technical.status==='CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION'&&technical.containerId===created.containerId&&
      roles.status==='CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'&&roles.containerId===created.containerId&&
      equal(roles.databaseIdentity,technical.databaseIdentity)&&equal(roles.roles.map(role=>role.name),plan.scope.roles),'ROLE_IDENTITY');
     const roleOid=name=>{const found=roles.roles.filter(role=>role.name===name);need(found.length===1&&typeof found[0].oid==='string'&&/^[1-9][0-9]{0,9}$/u.test(found[0].oid),'ROLE');return found[0].oid;};
     const id=technical.databaseIdentity;
     need(technical.database===created.databaseName&&id.database===created.databaseName&&id.ownerOid==='10','DATABASE_IDENTITY');
     state.identity=Object.freeze({runId:view.runId,...Object.fromEntries(['database','databaseOid','namespaceOid','ownerOid','systemIdentifier'].map(key=>[key,id[key]])),runtimeOid:roleOid('jg_task01_runtime'),observerOid:roleOid('jg_task01_observer'),...(request.competition?{runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'}:{}),
      ...(request.voucher?{voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'}:{}),...(paymentProfile?{paymentProfile}:{})});
     state.catalogSource={candidateSha:source.candidateSha,sealSha256:source.sourceSealSha256,schemaSha256:source.profile.schemaSha256,migrations:source.profile.ledger.map(row=>({path:'services/api/prisma/migrations/'+row.name+'/migration.sql',sha256:row.sha256}))};
     state.acl=acl;const permit=Object.freeze({kind:'CURRENT259_PRIVATE_B7_WRITE'});permissions.set(permit,state);
     enterStage('b7');const b7=await settled(installCurrent259B7(acl,handle,permit));completed(stage,b7);
     need(state.claimed&&state.writeUsed&&state.binding&&b7.status==='CURRENT259_B7_COMMITTED_NOT_ADMISSION'&&
      b7.bodySha256===plan.material.installation.readerBodySha256&&b7.planSha256===request.sha256&&
      b7.installSqlSha256===state.binding.installSqlSha256,'B7_RESULT');
     receipt.b7Binding=state.binding;receipt.b7={installXid:b7.installXid,readerOid:b7.readerOid,bodySha256:b7.bodySha256};
     if(request.pfq){
      enterStage('pfqConcurrency');state.check();
      const result=await runPfq(b7,handle,controller.signal,state.check);
      state.check();
      need(equal(result,{suite:'project-financing-quota-concurrency',businessCases:13,connectionCases:1}),'PFQ_RESULT');
      receipt.pfq=Object.freeze(result);enterStage('ownedCleanup');
     }
     if(request.business){
      const {withCurrent259LiveSessions,withCurrent259ApplicationEnvironment,withCurrent259OwnedApplication,runCurrent259PaymentCase}=businessFlow;
      const {withCompetitionLiveSessions,withCompetitionApplications,runCompetition,withDisconnectLiveSessions,withDisconnectOriginalApplication}=businessFlow;
      let withLive=withCurrent259LiveSessions;
      if(request.competition){
       const livePermit=Object.freeze({kind:'CURRENT259_PRIVATE_COMPETITION_LIVE'});
       state.competitionB7=b7;competitionLivePermissions.set(livePermit,state);
       withLive=(completion,h,consume)=>withCompetitionLiveSessions(completion,h,livePermit,consume);
      }
      if(disconnect){
       const livePermit=Object.freeze({kind:'CURRENT259_PRIVATE_DISCONNECT_LIVE'});
       state.disconnectB7=b7;disconnectLivePermissions.set(livePermit,state);
       withLive=(completion,h,consume)=>withDisconnectLiveSessions(completion,h,livePermit,consume);
      }
      const normalApplication=request.competition?withCompetitionApplications:withCurrent259OwnedApplication;
      const runCase=request.competition?runCompetition:runCurrent259PaymentCase;
      enterStage('liveSessions');state.check();
      await settled(withLive(b7,handle,async (initialLiveProof,replaceRuntime)=>{
       state.check();enterStage('applicationEnvironment');
       return withCurrent259ApplicationEnvironment(handle,async environment=>{
        state.check();environment.check();enterStage('ownedApplication');
        const runApplication=(liveProof,disconnectPhase,disconnectAttempt,disconnectRollback,oldOrigin)=>{
         const withApplication=disconnectPhase==='attempt'?withDisconnectOriginalApplication:normalApplication;
         return withApplication(liveProof,handle,controller.signal,async application=>{
         state.check();environment.check();
         const applications=request.competition?application:[application];
         const coordinates=applications.map(app=>({app,inspect:data(app,'inspect'),runtime:data(app,'runtime')}));
         const sameApplications=()=>coordinates.every(({app,inspect,runtime})=>typeof inspect==='function'&&
          data(app,'inspect')===inspect&&data(app,'runtime')===runtime&&inspect.call(app).runtime===runtime&&
          equal(data(data(app,'sourceBinding'),'effectiveAccessBinding'),state.effectiveAccessBinding));
         need(sameApplications()&&(!request.competition||coordinates.length===2&&coordinates[0].runtime!==coordinates[1].runtime),'BUSINESS_APPLICATION');
         if(disconnectPhase==='recovery'){
          try{need(typeof oldOrigin==='string'&&typeof data(application,'origin')==='string'&&
           new URL(application.origin).origin!==new URL(oldOrigin).origin,'DISCONNECT_REPLACEMENT_ENDPOINT');}
          catch(error){throw carryCurrent259DisconnectFailure(error,captureCurrent259DisconnectFailure(error,'RECOVERY_APPLICATION'));}
         }
         const ordinary261=paymentProfile===PAYMENT261_RUNTIME_PROFILE&&!request.competition&&!request.attributionGap&&!disconnect;
         const disconnectSeed261=paymentProfile===PAYMENT261_RUNTIME_PROFILE&&disconnectPhase==='attempt';
         const batchedSeed=ordinary261||disconnectSeed261||request.attributionGap261||request.competition261||request.voucher261;
         const business={active:true,claimed:false,recordCaseFailure:ordinary261,effectiveAccessBinding:state.effectiveAccessBinding,
          ...(paymentProfile!==undefined?{paymentProfile}:{}),...(batchedSeed?{seedProfile:paymentProfile}:{}),
          application,handle,liveProof,b7,source,build:checked.buildHandle,loader:view.loader,lifetime:data(view,'checkLifetime'),scope:Object.freeze({...plan.case,
          authorizationReference:'plan-sha256:'+request.sha256+';owned-run:'+view.runId,
          ...(request.competition261||request.voucher261||request.attributionGap261?{paymentProfile}:{}),
          ...(request.voucher?{voucherStorageRoot:data(environment,'storageRoot')}:{}),
          ...(disconnectPhase?{disconnectPhase,disconnectAttempt,disconnectRollback}:{}),
          ...(request.attributionGap?{attributionGap:plan.scope.attributionGap}:{})})};
         state.business=business;state.businessB7=b7;state.businessLive=liveProof;state.businessApplication=application;state.businessScope=business.scope;
         business.verifyFull=()=>{
          try{state.check();environment.check();need(business.active&&state.business===business&&currentRun===state&&
           business.handle===handle&&business.b7===b7&&business.liveProof===liveProof&&sameApplications(),'BUSINESS_SCOPE');}
          catch(error){business.active=false;revoke(state);throw error;}
         };
         business.check=()=>assertCurrent259PaymentBusinessContinuity(business.continuityToken,handle);
         const casePermissions=request.attributionGap?attributionGapPermissions:request.voucher?voucherBusinessPermissions:businessPermissions;
         const businessPermit=Object.freeze({kind:request.attributionGap?'CURRENT259_PRIVATE_ATTRIBUTION_GAP_CASE':request.voucher?'CURRENT259_PRIVATE_VOUCHER_CASE':'CURRENT259_PRIVATE_PAYMENT_CASE'});
         casePermissions.set(businessPermit,business);
         enterStage('seedAndSelectedCase');
         receipt.business={scenario:plan.case.scenario,caseId:plan.case.caseId,permission:'ISSUED_NOT_YET_CONSUMED',outcome:'UNKNOWN_DO_NOT_RETRY'};
         try{
          const result=await runCase(application,handle,businessPermit);
          business.check();
          if(disconnectPhase==='attempt'){
           need(business.claimed&&result&&typeof result==='object'&&Reflect.ownKeys(result).length===0,'BUSINESS_RESULT');
           receipt.business={scenario:plan.case.scenario,caseId:plan.case.caseId,permission:'CONSUMED_ONCE',outcome:'ORIGINAL_FAILED_AWAITING_ROLLBACK'};
           enterStage('closeOriginalApplication');
           return result;
          }
          need(business.claimed&&result.caseId===plan.case.caseId&&result.passed===true,'BUSINESS_RESULT');
          const cancellation=plan.case.scenario==='cancel-commit';
          if(cancellation||disconnectPhase==='recovery')need(data(result,'rollbackObserved')===true,'BUSINESS_RESULT');
          let rollbackEvidence;
          if(cancellation){
           need(data(result,'originalResultUnconfirmed')===true,'BUSINESS_RESULT');
           const proof=fixed(data(result,'rollbackEvidence'),['fault','observedXid32','originalRequestKeySha256']);
           need(proof.fault==='commit-cancelled'&&typeof proof.observedXid32==='string'&&/^[1-9][0-9]{0,9}$/u.test(proof.observedXid32)&&
            Number(proof.observedXid32)<=0xffffffff&&hex(proof.originalRequestKeySha256,64),'BUSINESS_RESULT');
           rollbackEvidence=Object.freeze(proof);
          }
          let attributionGapEvidence;
          if(request.attributionGap){
           const proof=fixed(data(result,'attributionGapEvidence'),['registrationStatus','projectAmountCents','gapAmountCents','originalRequestKeySha256','originalResultUnconfirmed']);
           need(proof.registrationStatus===plan.scope.attributionGap.expectedStatus&&proof.projectAmountCents===plan.scope.attributionGap.projectAmountCents&&proof.gapAmountCents===plan.scope.attributionGap.gapAmountCents&&
            proof.originalResultUnconfirmed===true&&hex(proof.originalRequestKeySha256,64)&&!Object.hasOwn(result,'executionId')&&!Object.hasOwn(result,'rootId'),'BUSINESS_RESULT');
           attributionGapEvidence=Object.freeze(proof);
          }
          if(request.followUp261)need(data(result,'fullyPaid')===true&&typeof data(result,'secondExecutionId')==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(data(result,'secondExecutionId')),'BUSINESS_RESULT');
          if(request.voucher)need(data(result,'voucherVerified')===true,'BUSINESS_RESULT');
          if(request.competition)need(data(result,'competitionObserved')===true&&['finance_staff','comprehensive_director'].includes(data(result,'winner')),'BUSINESS_RESULT');
          receipt.business={scenario:plan.case.scenario,caseId:plan.case.caseId,permission:'CONSUMED_ONCE',outcome:'CASE_RETURNED_NOT_FULL_ACCEPTANCE',
           ...(cancellation?{rollbackObserved:true,originalResultUnconfirmed:true,rollbackEvidence}:request.attributionGap?{attributionGapEvidence}:{executionId:result.executionId,rootId:result.rootId}),
           ...(request.competition?{competitionObserved:true,winner:result.winner}:{}),
           ...(request.voucher?{voucherVerified:true}:{}),
           ...(request.followUp261?{fullyPaid:true,secondExecutionId:result.secondExecutionId}:{}),
           ...(disconnectPhase==='recovery'?{rollbackObserved:true,runtimeReplaced:true}:{})};
          return result;
         }catch(error){
          if(!business.claimed)recordCaseFailure(business,'APPLICATION_LEASE',data(error,'code'));
          throw error;
         }finally{business.active=false;casePermissions.delete(businessPermit);}
         });
        };
        if(!disconnect)return runApplication(initialLiveProof);
        need(typeof replaceRuntime==='function','DISCONNECT_SCOPE');
        const original=await runApplication(initialLiveProof,'attempt');
        state.check();environment.check();enterStage('retireOriginalRuntimeAndConfirmRollback');
        return replaceRuntime(original.closeProof,original.value,(replacement,rollback,oldOrigin)=>{
         state.check();environment.check();enterStage('replacementApplication');
         return runApplication(replacement,'recovery',original.value,rollback,oldOrigin);
        });
       });
      }));
      state.check();enterStage('ownedCleanup');
     }
    }catch(error){
     rememberFirst(error);
     throw error;
    }finally{state.active=false;currentRun=undefined;EventTarget.prototype.removeEventListener.call(controller.signal,'abort',onAbort);}
   });
   checked.check();importsCheck();
  }catch(error){if(hasFirst)rememberSecondary(error,'RESOURCE_SCOPE');else rememberFirst(error);}
  finally{if(state)state.active=false;currentRun=undefined;if(timer)clearTimeout(timer);process.removeListener('SIGINT',onSigint);process.removeListener('SIGTERM',onSigterm);}
  try{receipt.resource=finalResource(plan,created,started,first,loopback?.topology);}catch(error){if(hasFirst)rememberSecondary(error,'RESOURCE_FINALIZATION');if(!hasFirst){failureObservedAt=performance.now();hasFirst=true;first=error;receipt.failureCode=safeCode(error);receipt.failureStage='ownedCleanup';}receipt.resource={...(created??{}),status:'unconfirmed',cleanup:{status:'UNKNOWN'}};}
  if(!hasFirst&&receipt.b7&&receipt.resource.cleanup.status==='completed'&&(!request.pfq||receipt.pfq)&&(!request.business||receipt.business?.permission==='CONSUMED_ONCE'&&receipt.business?.outcome==='CASE_RETURNED_NOT_FULL_ACCEPTANCE'&&receipt.business?.caseId===plan.case.caseId))receipt.status=request.pfq?'PFQ_COMPOSED_CONCURRENCY_AND_OWNED_CLEANUP_VERIFIED':request.business?'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED':'PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED';
  else{receipt.status='STOPPED';receipt.failureCode??='PAYMENT_INSTALL_ONCE_CLEANUP_UNCONFIRMED';}
  refreshBusinessFailureContext();recordTiming(receipt);
  try{recordProgress('FINALIZATION');}catch(error){if(hasFirst)rememberSecondary(error,'PROGRESS_PUBLICATION');else rememberFirst(error);receipt.status='STOPPED';}
  publicationStarted=true;const receiptSha256=publish(plan,receipt);published=true;
  return {status:receipt.status,candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,resourceCreationRequested:started,
   failureCode:receipt.failureCode,receiptFile:plan.run.receiptFile,receiptSha256,executionAllowed:false,nativeAdmission:false,financialAcceptance:false};
 }catch(error){
  if(marker&&plan&&!published&&!publicationStarted){
   const stopped=receipt??{schemaVersion:1,purpose:plan.purpose,planSha256:request.sha256,expectedCandidateSha:plan.material.source.candidateSha,onceAttemptConsumed:true,scope:plan.scope,limits:plan.limits,stages:[],executionAllowed:false,nativeAdmission:false,financialAcceptance:false,liveSessionAdmission:false};
   stopped.status='STOPPED';stopped.failureCode??=safeCode(hasFirst?first:error);stopped.failureStage??=stage;stopped.resource??={status:'unconfirmed',cleanup:{status:'UNKNOWN'}};
   try{recordTiming(stopped);publicationStarted=true;publish(plan,stopped);published=true;}catch{/* Preserve the consumed marker and UNKNOWN durable receipt. */}
  }
  return {status:'STOPPED',failureCode:safeCode(hasFirst?first:error),onceAttemptConsumed:requestedOnce,resourceCreationRequested:started,receiptOutcome:published?'WRITTEN':'UNKNOWN',executionAllowed:false,nativeAdmission:false,financialAcceptance:false};
 }
}
// Let CommonJS finish this main module before the plan helper reimports it.
// The fresh-entry predicate above is captured before any dependency load.
if(require.main===module)queueMicrotask(()=>{
 void run(process.argv.slice(2)).then(result=>{
  const exit=result.status==='PAYMENT261_VOUCHER_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT261_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT261_COMPETITION_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT261_BUSINESS_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT261_INSTALL_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PFQ_COMPOSITION_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PFQ_COMPOSED_CONCURRENCY_AND_OWNED_CLEANUP_VERIFIED'||result.status==='PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_VOUCHER_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_COMPETITION_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED'||result.status==='PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED'?0:1;
  process.exitCode=exit;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(ONCE_OPTIONS.includes(process.argv[2]))process.exit(exit);});
 });
});
