#!/usr/bin/env node
'use strict';
// This sole fresh-main entry owns installation and the in-memory B7 permission.
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH')&&Object.keys(require.cache).every(file=>file===__filename);
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const permissions=new WeakMap(),businessPermissions=new WeakMap();
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
function revoke(state){if(state){state.active=false;state.controller.abort();}}
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
    const id=fixed(row.identity,['runId','database','databaseOid','namespaceOid','ownerOid','runtimeOid','observerOid','systemIdentifier']);
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
function claimCurrent259PaymentBusinessPermit(permit,application,handle){
 const entry=permit&&!types.isProxy(permit)&&businessPermissions.get(permit);
 if(entry)businessPermissions.delete(permit);
 try{
  need(arguments.length===3&&entry&&entry===currentRun?.business&&entry.active&&!entry.claimed&&
   entry.application===application&&entry.handle===handle,'BUSINESS_AUTHORITY');
  entry.claimed=true;entry.check();
  return Object.freeze({scope:entry.scope,check:entry.check});
 }catch(error){revoke(currentRun);throw error;}
}
// Publish the only export before the fixed consumer can require it in main.
const moduleApi=Object.freeze({claimCurrent259B7WritePermit,claimCurrent259PaymentBusinessPermit});
module.exports=moduleApi;
// B7's original lineage imports the technical owner before loader/core caches.
const records=[];
function original(relative,names){
 const file=require.resolve(relative),exports=require(relative),loaded=require.cache[file];
 const slots=Object.fromEntries(names.map(key=>{const d=Object.getOwnPropertyDescriptor(exports,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function','IMPORT');return [key,d];}));
 records.push({file,exports,loaded,slots});return exports;
}
const {installCurrent259B7}=original('./task16-current259-b7-install.cjs',['installCurrent259B7']);
const {createCurrent259TechnicalMigration}=original('./local-staged-current259-profile.cjs',['createCurrent259TechnicalMigration']);
const {provisionCurrent259Roles}=original('./task16-current259-role-provision.cjs',['provisionCurrent259Roles']);
const {installCurrent259SevenFragments}=original('./task16-current259-seven-install.cjs',['installCurrent259SevenFragments']);
const {installCurrent259PaymentAcl}=original('./task16-current259-payment-acl-install.cjs',['installCurrent259PaymentAcl']);
const {withCurrent259TechnicalResource,claimCurrent259TechnicalResource}=original('./task16-current259-owned-resource.cjs',['withCurrent259TechnicalResource','claimCurrent259TechnicalResource']);
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
 return typeof code==='string'&&/^(?:PAYMENT_INSTALL_(?:PLAN|ONCE)|PAYMENT_BUSINESS_PLAN|CURRENT259_(?:RESOURCE|BUILD|LOADER|B7_INSTALL|ROLE_PROVISION|SEVEN|TECHNICAL)|TASK16_CURRENT259_PAYMENT_ACL|TASK16_CURRENT259_CATALOG|TASK01_RESOURCE)_[A-Z0-9_]+$/u.test(code)?code:'PAYMENT_INSTALL_ONCE_FAILED_CLOSED';
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
function resourceIdentity(raw){
 const keys=['runId','sourceSha','daemonId','endpoint','imageId','containerId','networkId','databaseName','port'];
 const row=Object.fromEntries(keys.map(key=>[key,data(raw,key)]));
 need(typeof row.runId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.runId)&&
  ['containerId','networkId'].every(key=>hex(row[key],64))&&row.databaseName==='jg_task01_'+row.runId.replaceAll('-','')&&
  Number.isInteger(row.port)&&row.port>1024&&row.port<=65535,'RESOURCE_IDENTITY');return Object.freeze(row);
}
function finalResource(plan,created,started){
 if(!started)return {status:'not-attempted',cleanup:{status:'not-needed'}};
 checkRoot(plan);const file=path.join(plan.run.resourceDir,'resource-manifest.json');
 if(!fs.existsSync(file))return {status:'unconfirmed',cleanup:{status:'UNKNOWN'}};
 const capture=read(file,{privateFile:true,maxBytes:1048576,collect:true,code:'PAYMENT_INSTALL_ONCE_MANIFEST'});
 const final=JSON.parse(capture.bytes.toString('utf8'));
 if(!created)return {status:'unconfirmed',identityBinding:'UNCONFIRMED_MANIFEST_ONLY',cleanup:{status:'UNKNOWN'},manifestSha256:capture.sha256};
 need(Object.entries(created).every(([key,value])=>data(final,key)===value),'RESOURCE_CHANGED');
 const cleanup=data(final,'cleanup'),closed=data(final,'status')==='closed'&&data(cleanup,'status')==='completed'&&['containerAbsent','volumesAbsent','networkAbsent'].every(key=>data(cleanup,key)===true);
 return {...created,status:closed?'closed':'unconfirmed',identityBinding:'ORIGINAL_LIVE_HANDLE_AND_FINAL_MANIFEST',
  cleanup:{status:closed?'completed':'UNKNOWN',containerAbsent:closed,volumesAbsent:closed,networkAbsent:closed},manifestSha256:capture.sha256,independentDockerChecker:false};
}
function parse(args){
 need(Array.isArray(args)&&args.every(value=>typeof value==='string'),'ARGUMENTS');
 const business=args[0]==='--business'||args[0]==='--business-once',once=args[0]==='--once'||args[0]==='--business-once',rest=once||business?args.slice(1):args;
 need(rest.length===4&&rest[0]==='--plan'&&rest[2]==='--expected-plan-sha256'&&hex(rest[3],64),'ARGUMENTS');
 return {once,business,file:rest[1],sha256:rest[3]};
}
async function run(args){
 const requestedOnce=Array.isArray(args)&&['--once','--business-once'].includes(args[0]);
 let request,plan,receipt,checked,created,started=false,marker=false,published=false,publicationStarted=false;
 let hasFirst=false,first,stage='preflight',state,controller,timer,businessFlow;
 try{
  request=parse(args);if(request.once)need(FRESH&&!onceAttempted,'FRESH_MAIN');
  const planModule=request.business?original('../../../scripts/prepare-task16-current259-payment-business.cjs',['readCurrent259PaymentBusinessPlan','verifyCurrent259PaymentBusinessPlan']):original('../../../scripts/prepare-task16-current259-payment-install.cjs',['readCurrent259PaymentInstallPlan','verifyCurrent259PaymentInstallPlan']);
  const plans=request.business?Object.freeze({readCurrent259PaymentInstallPlan:planModule.readCurrent259PaymentBusinessPlan,verifyCurrent259PaymentInstallPlan:planModule.verifyCurrent259PaymentBusinessPlan}):planModule;
  const basic=plans.readCurrent259PaymentInstallPlan(request.file,request.sha256);plan=basic.plan;
  if(!request.once){
   checked=plans.verifyCurrent259PaymentInstallPlan(request.file,request.sha256);checked.check();importsCheck();
   return {status:request.business?'PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES':'PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES',candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:false,resourcesExecuted:false};
  }
  onceAttempted=true;
  try{writeNew(plan,plan.run.attemptFile,JSON.stringify({status:'STARTED',purpose:plan.purpose,planSha256:request.sha256,candidateSha:plan.material.source.candidateSha,onceAttemptConsumed:true})+'\n');}
  catch(error){if(data(error,'code')==='EEXIST')throw fault('ALREADY_ATTEMPTED');throw error;}
  marker=true;
  const attempt=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,collect:true,code:'PAYMENT_INSTALL_ONCE_ATTEMPT'});
  receipt={schemaVersion:1,purpose:plan.purpose,expectedCandidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,
   status:'STOPPED',scope:plan.scope,limits:plan.limits,stages:[],sourceMaterialVerified:false,
   executionAllowed:false,nativeAdmission:false,financialAcceptance:false,liveSessionAdmission:false};
  // Capture the fixed business closure before the first installation await,
  // never adopt a cache/export replacement after B7 has already been written.
  businessFlow=request.business?Object.freeze({
   withCurrent259LiveSessions:original('./task16-current259-live-sessions.cjs',['withCurrent259LiveSessions']).withCurrent259LiveSessions,
   withCurrent259ApplicationEnvironment:original('./task16-current259-application-environment.cjs',['withCurrent259ApplicationEnvironment']).withCurrent259ApplicationEnvironment,
   withCurrent259OwnedApplication:original('./task16-current259-application-factory.cjs',['withCurrent259OwnedApplication']).withCurrent259OwnedApplication,
   runCurrent259PaymentCase:original('./task16-current259-payment-case.cjs',['runCurrent259PaymentCase']).runCurrent259PaymentCase
  }):undefined;
  const abort=()=>controller?.abort();
  try{
   need(!fs.existsSync(plan.run.receiptFile)&&!fs.existsSync(plan.run.receiptFile+'.pending'),'RECEIPT_EXISTS');
   checked=plans.verifyCurrent259PaymentInstallPlan(request.file,request.sha256);
   need(equal(basic.file.identity,checked.file.identity),'PLAN_REPLACED');checked.check();importsCheck();receipt.sourceMaterialVerified=true;
   need(!fs.existsSync(plan.run.resourceDir),'RESOURCE_CHILD_EXISTS');
   controller=new AbortController();process.once('SIGINT',abort);process.once('SIGTERM',abort);timer=setTimeout(abort,plan.limits.resourceMs);
   started=true;
   await withCurrent259TechnicalResource(checked.buildHandle,{artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,async handle=>{
    const view=claimCurrent259TechnicalResource(handle),source=view.source;created=resourceIdentity(view.resource.getReceipt());
    need(created.sourceSha===plan.material.source.candidateSha&&created.daemonId===plan.resource.daemonId&&created.endpoint===plan.resource.endpoint&&created.imageId===plan.resource.imageId,'RESOURCE_IDENTITY');
    state={active:true,controller,handle,view,source,planSha256:request.sha256,claimed:false,writeUsed:false};
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
      need(state.active&&!controller.signal.aborted,'CLOSED');importsCheck();checked.check();view.check();
      const now=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,collect:true,expectedIdentity:attempt.identity,code:'PAYMENT_INSTALL_ONCE_ATTEMPT_CHANGED'});
      need(now.sha256===attempt.sha256&&claimCurrent259TechnicalResource(handle)===view&&view.source===source&&
       source.candidateSha===plan.material.source.candidateSha&&source.sourceSealSha256===plan.material.source.sourceSealSha256,'SCOPE_CHANGED');
     }catch(error){revoke(state);throw error;}
    };
    const completed=(name,result)=>{state.check();need(result&&result.sourceSha===source.candidateSha&&result.runId===view.runId,'STAGE_RESULT');
     receipt.stages.push(Object.freeze({stage:name,status:'RETURNED_NOT_ADMISSION',...(result.installXid?{installXid:result.installXid}:{}),...(result.commitXid?{commitXid:result.commitXid}:{})}));};
    try{
     state.check();stage='technical259';
     const technical=await settled(createCurrent259TechnicalMigration(handle,controller.signal).migrate());completed(stage,technical);
     stage='roles9';const roles=await settled(provisionCurrent259Roles(technical,handle));completed(stage,roles);
     stage='sevenFragments';const seven=await settled(installCurrent259SevenFragments(roles,handle));completed(stage,seven);
     stage='paymentAcl';const acl=await settled(installCurrent259PaymentAcl(seven,handle));completed(stage,acl);
     need(acl.status==='CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION'&&hex(acl.sourceSha,40)&&typeof acl.installXid==='string'&&/^[1-9][0-9]*$/u.test(acl.installXid),'ACL');
     need(technical.status==='CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION'&&technical.containerId===created.containerId&&
      roles.status==='CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'&&roles.containerId===created.containerId&&
      equal(roles.databaseIdentity,technical.databaseIdentity)&&equal(roles.roles.map(role=>role.name),plan.scope.roles),'ROLE_IDENTITY');
     const roleOid=name=>{const found=roles.roles.filter(role=>role.name===name);need(found.length===1&&typeof found[0].oid==='string'&&/^[1-9][0-9]{0,9}$/u.test(found[0].oid),'ROLE');return found[0].oid;};
     const id=technical.databaseIdentity;
     need(technical.database===created.databaseName&&id.database===created.databaseName&&id.ownerOid==='10','DATABASE_IDENTITY');
     state.identity=Object.freeze({runId:view.runId,...Object.fromEntries(['database','databaseOid','namespaceOid','ownerOid','systemIdentifier'].map(key=>[key,id[key]])),runtimeOid:roleOid('jg_task01_runtime'),observerOid:roleOid('jg_task01_observer')});
     state.catalogSource={candidateSha:source.candidateSha,sealSha256:source.sourceSealSha256,schemaSha256:source.profile.schemaSha256,migrations:source.profile.ledger.map(row=>({path:'services/api/prisma/migrations/'+row.name+'/migration.sql',sha256:row.sha256}))};
     state.acl=acl;const permit=Object.freeze({kind:'CURRENT259_PRIVATE_B7_WRITE'});permissions.set(permit,state);
     stage='b7';const b7=await settled(installCurrent259B7(acl,handle,permit));completed(stage,b7);
     need(state.claimed&&state.writeUsed&&state.binding&&b7.status==='CURRENT259_B7_COMMITTED_NOT_ADMISSION'&&
      b7.bodySha256===plan.material.installation.readerBodySha256&&b7.planSha256===request.sha256&&
      b7.installSqlSha256===state.binding.installSqlSha256,'B7_RESULT');
     receipt.b7Binding=state.binding;receipt.b7={installXid:b7.installXid,readerOid:b7.readerOid,bodySha256:b7.bodySha256};
     if(request.business){
      const {withCurrent259LiveSessions,withCurrent259ApplicationEnvironment,withCurrent259OwnedApplication,runCurrent259PaymentCase}=businessFlow;
      stage='liveSessions';state.check();
      await settled(withCurrent259LiveSessions(b7,handle,async liveProof=>{
       state.check();stage='applicationEnvironment';
       return withCurrent259ApplicationEnvironment(handle,async environment=>{
        state.check();environment.check();stage='ownedApplication';
        return withCurrent259OwnedApplication(liveProof,handle,controller.signal,async application=>{
         state.check();environment.check();
         const inspect=data(application,'inspect'),runtime=data(application,'runtime');
         need(typeof inspect==='function'&&inspect.call(application).runtime===runtime,'BUSINESS_APPLICATION');
         const business={active:true,claimed:false,application,handle,liveProof,b7,scope:Object.freeze({...plan.case,
          authorizationReference:'plan-sha256:'+request.sha256+';owned-run:'+view.runId})};
         state.business=business;
         business.check=()=>{
          try{state.check();environment.check();need(business.active&&state.business===business&&currentRun===state&&
           business.handle===handle&&business.b7===b7&&business.liveProof===liveProof&&data(application,'inspect')===inspect&&
           data(application,'runtime')===runtime&&inspect.call(application).runtime===runtime,'BUSINESS_SCOPE');}
          catch(error){business.active=false;revoke(state);throw error;}
         };
         const businessPermit=Object.freeze({kind:'CURRENT259_PRIVATE_PAYMENT_CASE'});businessPermissions.set(businessPermit,business);
         stage='seedAndSelectedCase';
         receipt.business={scenario:plan.case.scenario,caseId:plan.case.caseId,permission:'ISSUED_NOT_YET_CONSUMED',outcome:'UNKNOWN_DO_NOT_RETRY'};
         try{
          const result=await runCurrent259PaymentCase(application,handle,businessPermit);
          business.check();need(business.claimed&&result.caseId===plan.case.caseId&&result.passed===true,'BUSINESS_RESULT');
          receipt.business={scenario:plan.case.scenario,caseId:plan.case.caseId,permission:'CONSUMED_ONCE',outcome:'CASE_RETURNED_NOT_FULL_ACCEPTANCE',
           executionId:result.executionId,rootId:result.rootId};
         }finally{business.active=false;businessPermissions.delete(businessPermit);}
        });
       });
      }));
      state.check();stage='ownedCleanup';
     }
    }catch(error){
     if(!hasFirst){hasFirst=true;first=error;receipt.failureCode=safeCode(error);receipt.failureStage=stage;}
     throw error;
    }finally{state.active=false;currentRun=undefined;EventTarget.prototype.removeEventListener.call(controller.signal,'abort',onAbort);}
   });
   checked.check();importsCheck();
  }catch(error){if(!hasFirst){hasFirst=true;first=error;receipt.failureCode=safeCode(error);receipt.failureStage=stage;}}
  finally{if(state)state.active=false;currentRun=undefined;if(timer)clearTimeout(timer);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  try{receipt.resource=finalResource(plan,created,started);}catch(error){if(!hasFirst){hasFirst=true;first=error;receipt.failureCode=safeCode(error);receipt.failureStage='ownedCleanup';}receipt.resource={...(created??{}),status:'unconfirmed',cleanup:{status:'UNKNOWN'}};}
  if(!hasFirst&&receipt.b7&&receipt.resource.cleanup.status==='completed'&&(!request.business||receipt.business?.permission==='CONSUMED_ONCE'&&receipt.business?.outcome==='CASE_RETURNED_NOT_FULL_ACCEPTANCE'&&receipt.business?.caseId===plan.case.caseId))receipt.status=request.business?'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED':'PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED';
  else{receipt.status='STOPPED';receipt.failureCode??='PAYMENT_INSTALL_ONCE_CLEANUP_UNCONFIRMED';}
  publicationStarted=true;const receiptSha256=publish(plan,receipt);published=true;
  return {status:receipt.status,candidateSha:plan.material.source.candidateSha,planSha256:request.sha256,onceAttemptConsumed:true,resourceCreationRequested:started,
   failureCode:receipt.failureCode,receiptFile:plan.run.receiptFile,receiptSha256,executionAllowed:false,nativeAdmission:false,financialAcceptance:false};
 }catch(error){
  if(marker&&plan&&!published&&!publicationStarted){
   const stopped=receipt??{schemaVersion:1,purpose:plan.purpose,planSha256:request.sha256,expectedCandidateSha:plan.material.source.candidateSha,onceAttemptConsumed:true,scope:plan.scope,limits:plan.limits,stages:[],executionAllowed:false,nativeAdmission:false,financialAcceptance:false,liveSessionAdmission:false};
   stopped.status='STOPPED';stopped.failureCode??=safeCode(hasFirst?first:error);stopped.failureStage??=stage;stopped.resource??={status:'unconfirmed',cleanup:{status:'UNKNOWN'}};
   try{publicationStarted=true;publish(plan,stopped);published=true;}catch{/* Preserve the consumed marker and UNKNOWN durable receipt. */}
  }
  return {status:'STOPPED',failureCode:safeCode(hasFirst?first:error),onceAttemptConsumed:requestedOnce,resourceCreationRequested:started,receiptOutcome:published?'WRITTEN':'UNKNOWN',executionAllowed:false,nativeAdmission:false,financialAcceptance:false};
 }
}
// Let CommonJS finish this main module before the plan helper reimports it.
// The fresh-entry predicate above is captured before any dependency load.
if(require.main===module)queueMicrotask(()=>{
 void run(process.argv.slice(2)).then(result=>{
  const exit=result.status==='PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES'||result.status==='PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED'||result.status==='PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED'?0:1;
  process.exitCode=exit;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(['--once','--business-once'].includes(process.argv[2]))process.exit(exit);});
 });
});
