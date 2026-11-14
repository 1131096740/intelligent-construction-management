'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const file=path.join(__dirname,'task16-current259-payment-run-authorization.cjs'),ROOT=path.resolve(__dirname,'../../..');
const noop=()=>{};
const {PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
function planFixture(t,options){
 const p=path.join(ROOT,'scripts/prepare-task16-current259-payment-install.test.cjs'),module={exports:{}},rq=Module.createRequire(p);
 new Function('require','module','__dirname',fs.readFileSync(p,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),module,path.dirname(p));
 return module.exports.fixture(t,options);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,options={}){
 const s=options.planFixture??planFixture(t,{payment261:options.payment261});
 const prepare=options.payment261?s.api.prepareCurrent261PaymentInstallPlan:options.pfqPlan?s.api.prepareCurrent259PfqCompositionPlan:s.api.prepareCurrent259PaymentInstallPlan;
 const saved=options.saved??prepare({runRoot:s.runRoot,daemonId:s.daemonId,output:s.output});
 const state={calls:[],output:'',closes:0,signals:{},consumed:null},handle=Object.freeze({});
 if(options.progress){state.progressRoot=path.join(s.base,'progress');fs.mkdirSync(state.progressRoot,{mode:0o700});options.progressSetup?.(state.progressRoot);}
 let manifest,signal,finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const source=s.loader.witness().source;
 const paymentProfile=options.voucher261?PAYMENT261_VOUCHER_RUNTIME_PROFILE:options.attributionGap261?PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE:options.competition261?PAYMENT261_COMPETITION_RUNTIME_PROFILE:options.payment261?'TASK16_PAYMENT261_RUNTIME_V1':undefined;
 const savedData=JSON.parse(fs.readFileSync(saved.file??saved.path??options.planFile,'utf8'));
 const installationData=savedData.material?savedData:JSON.parse(fs.readFileSync(savedData.installation.path,'utf8'));
 const effectiveAccessBinding=installationData.material.installation.effectiveAccessBinding;
 const sourceBinding=Object.freeze({...effectiveAccessBinding?{effectiveAccessBinding:options.applicationBinding?options.applicationBinding(effectiveAccessBinding):effectiveAccessBinding}:{}});
 const identity={database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'16384',namespaceOid:'2200',ownerOid:'10',systemIdentifier:'123456789'};
 const technical=Object.freeze({status:'CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:'01234567-89ab-cdef-0123-456789abcdef',containerId:'7'.repeat(64),database:identity.database,databaseIdentity:identity});
 const names=['jg_c259_outside_executor_login','jg_c259_outside_executor_owner','jg_c259_outside_issuer_login','jg_c259_outside_issuer_owner','jg_c259_upward_issuer_login','jg_c259_upward_issuer_owner','jg_c259_upward_runtime_login','jg_task01_observer','jg_task01_runtime'];
 const roles=Object.freeze({...technical,status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',roles:names.map((name,i)=>({name,oid:String(200+i)})),commitXid:'1000',
  ...(paymentProfile?{paymentProfile}:{})});
 const seven=Object.freeze({sourceSha:source.candidateSha,runId:technical.runId,installXid:'1100'});
 const acl=Object.freeze({status:'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:technical.runId,installXid:'1200'});
 const scopeIdentity={runId:technical.runId,...identity,runtimeOid:'208',observerOid:'207',...(options.competition?{runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'}:{}),...(options.voucher?{voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'}:{}),
  ...(paymentProfile?{paymentProfile}:{})};
 const module={exports:{},filename:file};const cache={[file]:module};
 const check=()=>{assert.ok(!signal?.aborted);options.onCheck?.();};
 const view={source,runId:technical.runId,resource:{containerId:technical.containerId,databaseName:identity.database,getReceipt(){return JSON.parse(JSON.stringify(manifest));}},check,checkLifetime:check,verifyFull:check};
 const ports={
  './task16-current259-b7-install.cjs':{async installCurrent259B7(value,h,permit){
   state.calls.push('b7');assert.equal(value,acl);assert.equal(h,handle);
   const authority=module.exports.claimCurrent259B7WritePermit(permit,h,value);
   const beforeSql=require('./task16-current259-catalog.cjs').renderCurrent259CatalogRead({source:s.rawSource,identity:scopeIdentity,phase:'before',nonce:'d'.repeat(64)});
   const binding={scope:'CURRENT259_DOCKER_B7_INSTALL',planSha256:options.selectedPlanSha??saved.sha256,sourceSha:source.candidateSha,sourceSealSha256:source.sourceSealSha256,runId:technical.runId,containerId:technical.containerId,aclXid:acl.installXid,nonce:'d'.repeat(64),identity:scopeIdentity,beforeCatalogSha256:'c'.repeat(64),beforeSqlSha256:hash(beforeSql),installSqlSha256:'e'.repeat(64)};
   options.beforeConsume?.({api:module.exports,permit,h,value,binding,authority});
   assert.equal(authority.consumeWrite(Object.freeze(binding)),true);state.consumed=binding;
   assert.equal(authority.check(),true);
   return Object.freeze({status:'CURRENT259_B7_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:technical.runId,installXid:'1300',readerOid:'3000',planSha256:options.selectedPlanSha??saved.sha256,installSqlSha256:binding.installSqlSha256,bodySha256:'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20'});
  }},
  './local-staged-current259-profile.cjs':{describeCurrent259TechnicalFailure(error){
   return error===options.technicalFailure?options.technicalDetail:undefined;
  },createCurrent259TechnicalMigration(h,provided){
   assert.equal(h,handle);assert.equal(provided,signal);return {async migrate(){state.calls.push('technical259');if(Object.hasOwn(options,'technicalFailure'))throw options.technicalFailure;await options.onTechnical?.(state);return technical;}};
  }},
  './task16-current259-role-provision.cjs':{async provisionCurrent259Roles(value,h){state.calls.push('roles9');assert.equal(value,technical);assert.equal(h,handle);return roles;},
   async provisionCurrent259Payment261AttributionGapRoles(value,h,permit){
    state.calls.push('payment261-gap-roles');assert.equal(value,technical);assert.equal(h,handle);
    if(options.gapRoleClaim)module.exports[options.gapRoleClaim](permit,h,value);
    assert.equal(module.exports.claimCurrent259Payment261AttributionGapRolePermit(permit,h,value),true);
    return roles;
   },
   async provisionCurrent259Payment261Roles(value,h,permit){
    state.calls.push('payment261-roles');assert.equal(value,technical);assert.equal(h,handle);
    const claim=module.exports.claimCurrent259Payment261RolePermit;
    if(options.badPayment261Permit==='copy')claim({...permit},h,value);
    assert.equal(claim(permit,h,value),true);
    if(options.badPayment261Permit==='replay')claim(permit,h,value);
    return options.badPayment261Permit==='result'?{...roles,paymentProfile:'TASK12_ARCHIVE261_SOURCE_V1'}:roles;
   }},
  './task16-current259-seven-install.cjs':{describeCurrent259SevenFailure(error){return error===options.sevenFailure?options.sevenDetail:undefined;},
  async installCurrent259SevenFragments(value,h){state.calls.push('seven');assert.equal(value,roles);assert.equal(h,handle);
   if(Object.hasOwn(options,'sevenFailure'))throw options.sevenFailure;return seven;} },
  './task16-current259-payment-acl-install.cjs':{async installCurrent259PaymentAcl(value,h){state.calls.push('acl');assert.equal(value,seven);assert.equal(h,handle);return acl;}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},async closeCurrent259OwnedResource(){state.closes++;},
   async withCurrent259FirstRollbackResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'cancel-commit');
   },
   async withCurrent259AttributionGapResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'attribution-gap');
   },
   async withCurrent259NormalPaymentResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'normal');
   },
   async withCurrent259ResponseLossResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'response-loss');
   },
   async withCurrent259VoucherResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'competition-voucher');
   },
   async withCurrent259CompetitionResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'competition');
   },
   async withCurrent259DisconnectRecoveryResource(build,plan,sig,consume){
    return ports['./task16-current259-owned-resource.cjs'].withCurrent259TechnicalResource(build,plan,sig,consume,'disconnect-commit-recovery');
   },
   async withCurrent259TechnicalResource(build,plan,sig,consume,scenario){
    const loopback=require('./task16-current259-payment-loopback.cjs').paymentLoopbackForScenario(scenario);
    assert.equal(build,s.handle);assert.ok(fs.existsSync(path.join(s.runRoot,'attempt.json')));
    state.calls.push(scenario==='cancel-commit'?'start-first-rollback':scenario?'start-'+scenario:'start');signal=sig;
    fs.mkdirSync(plan.artifactsDir,{mode:0o700});
    manifest={runId:technical.runId,sourceSha:source.candidateSha,daemonId:s.daemonId,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',containerId:technical.containerId,networkId:'8'.repeat(64),databaseName:identity.database,port:32456,status:'started-awaiting-driver-verification',cleanup:{status:'pending'}};
    if(loopback){
     manifest.topology=options.resourceTopology??loopback.topology;
     manifest.relay={id:'ab49e313-e3da-407f-b279-3d09caecfc3e',containerId:manifest.containerId,host:'127.0.0.1',port:manifest.port};
     manifest.loopbackPlaintextHba={sourceAddress:'127.0.0.1',role:'jg_task01_owner',databaseName:manifest.databaseName,noEncryptionRejected:true};
    }
    if(options.startupFailure){
     const mode=options.startupFailure;
     const failure=Object.assign(new Error('PRIVATE_STARTER_DETAIL'),{code:'TASK01_RESOURCE_START_FAILED'});
     const failed={...manifest,purpose:'CURRENT259_TECHNICAL_MIGRATIONS_V1',phase:'failed',port:null,
      attempts:{network:true,container:true},failureCode:'TASK01_RESOURCE_COMMAND_FAILED',
      startupFailure:{stage:'published-port-probe',commandKind:'nonzero-exit'},
      status:mode==='cleanup-unknown'?'cleanup_failed':'closed',
      cleanup:mode==='cleanup-unknown'?{status:'failed'}:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}};
     if(mode==='wrong-daemon')failed.daemonId='unrelated-daemon-id';
     if(mode==='missing-container-id')failed.containerId=null;
     fs.writeFileSync(path.join(plan.artifactsDir,'resource-manifest.json'),JSON.stringify(failed),{mode:0o600});
     if(mode!=='manifest-only')failure.resourceReceipt=mode==='different-receipt'?{...failed,networkId:'9'.repeat(64)}:failed;
     throw failure;
    }
    const finishResource=()=>{
     state.closes++;
     manifest.status=options.cleanupFailure?'cleanup_failed':'closed';manifest.cleanup={status:options.cleanupFailure?'failed':'completed',containerAbsent:!options.cleanupFailure,volumesAbsent:!options.cleanupFailure,networkAbsent:!options.cleanupFailure};
     if(loopback)Object.assign(manifest.cleanup,{relayClosed:!options.relayCleanupUnknown,
      relayId:options.relayCleanupWrongId?'00000000-0000-4000-8000-000000000000':manifest.relay.id});
     fs.writeFileSync(path.join(plan.artifactsDir,'resource-manifest.json'),JSON.stringify(manifest),{mode:0o600});
     if(options.cleanupFailure)throw Object.assign(new Error('SECRET_SQL_PASSWORD'),{code:'CURRENT259_RESOURCE_CLEANUP_UNKNOWN'});
    };
    try{return await consume(handle);}finally{try{if(options.afterConsumeFailure)throw options.afterConsumeFailure;}finally{finishResource();}}
   }},
  '../../../scripts/prepare-task16-current259-payment-install.cjs':s.api
 };
 if(options.pfqPlan){
  const childFile=path.join(__dirname,'task16-current259-pfq-concurrency.cjs');
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
  const relayId='ab49e313-e3da-407f-b279-3d09caecfc3e';
  const proof=Object.freeze({}),rows=[1,2,3,4].map(pid=>({pid,start:`2026-11-12T01:02:03.00000${pid}Z`}));
  let packet;
  Object.assign(view.resource,{port:32456,caPath:'/private/tmp/fake-resource/tls-private/ca.crt',relayId,
   async inspectConnectionEndpoint(){return {transport:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS',relayId,host:'127.0.0.1',port:32456,databaseName:identity.database};}});
  view.credentials=()=>({owner:'a'.repeat(96)});
  const session={b7:{xid:'1300'},identity:[{...identity,effectiveOid:'10'}],checkLight:check,
   async verifyInstalled259(){state.calls.push('verify-installed');},owner:{async $queryRawUnsafe(sql,...pids){
    assert.match(sql,/pg_stat_activity/);assert.deepEqual(pids,[1,2,3,4]);state.calls.push('independent-sessions');
    return rows.map((row,index)=>({...row,name:`jg_pfq_${packet.nonce}_${options.pfqIdentityDrift?0:index}`}));
   }}};
  const childPorts={
   './task16-current259-live-sessions.cjs':{async withCurrent259LiveSessions(b7,h,consume){
    assert.equal(h,handle);assert.equal(b7.installXid,'1300');state.calls.push('claim-B7');
    try{return await consume(proof);}catch{
     throw Object.assign(new Error('CURRENT259_LIVE_SESSIONS_FAILED_CLOSED'),{code:'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED',
      clientCleanupOutcome:'DISCONNECTED',resourceCleanupOutcome:'CLOSED'});
    }finally{state.calls.push('disconnect-live');}
   },claimCurrent259LiveSessions(value,h){assert.equal(value,proof);assert.equal(h,handle);return session;}},
   './task16-current259-owned-resource.cjs':ports['./task16-current259-owned-resource.cjs'],
   'node:fs':{realpathSync(value){return value;}},
   'node:child_process':{spawn(binary,args,config){
    state.calls.push('jest');assert.equal(binary,process.execPath);
    assert.deepEqual(args.slice(1),['--runInBand','--runTestsByPath','src/database/project-financing-quota-concurrency.spec.ts','--json']);
    assert.equal(config.env.PFQ_NATIVE_COMPOSITION,'1');assert.equal(config.env.DATABASE_URL,undefined);
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
    child.kill=()=>{child.stdout.end();queueMicrotask(()=>child.emit('close',null,'SIGTERM'));};
    let admission=false;
    child.stdin.on('data',bytes=>{
     const line=bytes.toString().trim();
     if(!packet){
      packet=JSON.parse(line);assert.match(packet.url,/^postgresql:\/\/jg_task01_owner:/);assert.equal(packet.identity.databaseOid,identity.databaseOid);
      child.stdout.write('JG_PFQ_SESSIONS '+JSON.stringify(rows)+'\n');
     }else if(!admission){
      assert.equal(line,`JG_PFQ_READY ${packet.nonce} 1`);state.calls.push('jest-admitted');admission=true;
      child.stdout.write('JG_PFQ_SESSIONS '+JSON.stringify(options.pfqFinalDrift?rows.map(row=>({...row,pid:row.pid+10})):rows)+'\n');
     }else{
      assert.equal(line,`JG_PFQ_READY ${packet.nonce} 2`);
      child.stdout.end(JSON.stringify({success:true,numTotalTests:14,numPassedTests:options.pfqPartial?13:14,numTotalTestSuites:1,
       testResults:[{name:path.join(ROOT,'services/api/src/database/project-financing-quota-concurrency.spec.ts')}]} )+'\n');
      queueMicrotask(()=>child.emit('close',0,null));
     }
    });return child;
   }}
  };
  const childModule={exports:{}};const childRequire=name=>childPorts[name]??require(name);
  childRequire.resolve=()=>path.join(ROOT,'node_modules/.pnpm/jest@29.7.0/node_modules/jest/bin/jest.js');
  new Function('require','module','__dirname',fs.readFileSync(childFile,'utf8'))(childRequire,childModule,__dirname);
  ports['./task16-current259-pfq-concurrency.cjs']=childModule.exports;
 }
 if(options.voucher)ports['./task16-current259-payment-acl-install.cjs'].installCurrent259VoucherPaymentAcl=async(value,h,permit)=>{
  state.calls.push('voucher-acl');assert.equal(value,seven);assert.equal(h,handle);
  assert.equal(module.exports.claimCurrent259VoucherAclPermit(permit,h,options.wrongVoucherSeven?{...value}:value),true);
  if(options.replayVoucher)module.exports.claimCurrent259VoucherAclPermit(permit,h,value);
  return acl;
 };
 if(options.competition)options.business=true;
 if(options.businessApi)ports['../../../scripts/prepare-task16-current259-payment-business.cjs']=options.businessApi;
 if(options.business){
  ports['./task16-current259-business-continuity.cjs']={captureCurrent259BusinessIssuer(){}};
  state.replaceBusinessLive=()=>{ports['./task16-current259-live-sessions.cjs'].withCurrent259LiveSessions=async()=>{state.calls.push('foreign-live');};};
  const liveProof=Object.freeze({}),application=Object.freeze({sourceBinding,runtime:Object.freeze({}),inspect(){return {runtime:this.runtime};}});
  ports['./task16-current259-live-sessions.cjs']={
   describeCurrent259LiveFailure(error){return error===options.liveFailure?options.liveDetail:undefined;},
   describeCurrent259ApplicationFailure(error){return error===options.applicationFailure?options.applicationDetail:undefined;},
   async withCurrent259LiveSessions(b7,h,consume){
    assert.equal(h,handle);assert.equal(b7.installXid,'1300');state.calls.push('live');
    try{if(Object.hasOwn(options,'liveFailure'))throw options.liveFailure;return await consume(liveProof);}
    finally{state.calls.push('pools-close');}
   }
  };
  ports['./task16-current259-application-environment.cjs']={async withCurrent259ApplicationEnvironment(h,consume){assert.equal(h,handle);state.calls.push('env');try{return await consume({check,...(options.voucher?{storageRoot:'/private/tmp/model-resource/application-private-voucher'}:{})});}finally{state.calls.push('env-close');}}};
  ports['./task16-current259-application-factory.cjs']={async withCurrent259OwnedApplication(proof,h,sig,consume,reportPhase){await options.onApplicationPhase?.(reportPhase);assert.equal(proof,liveProof);assert.equal(h,handle);assert.equal(sig,signal);state.calls.push('app');try{if(Object.hasOwn(options,'applicationFailure'))throw options.applicationFailure;return await consume(application);}finally{state.calls.push('app-close');}}};
  ports['./task16-current259-payment-case.cjs']={async runCurrent259PaymentCase(app,h,permit){
   state.calls.push('case');assert.equal(app,application);assert.equal(h,handle);
   if(options.beforeCaseFailure)throw options.beforeCaseFailure;
   const lease=module.exports.claimCurrent259PaymentBusinessPermit(permit,options.caseWrongApp?{...app}:app,h);lease.check();
   assert.equal(lease.paymentProfile,paymentProfile);assert.equal(Object.hasOwn(lease,"paymentProfile"),paymentProfile!==undefined);assert.equal(Object.isFrozen(lease),true);
   assert.equal(lease.scope.scenario,options.scenario??'normal');assert.ok(lease.scope.authorizationReference.includes(options.selectedPlanSha??saved.sha256));
   options.onBusiness?.({api:module.exports,permit,application,handle,lease,s});
   if(options.gapFailureStage){
    lease.recordAttributionGapFailure('raw private failing response');
    lease.recordAttributionGapFailure(options.gapFailureStage);
    lease.recordAttributionGapFailure('CASE_FINAL');
   }
   if(Object.hasOwn(options,'caseFailure'))throw options.caseFailure;
   if(options.attributionGap){
    assert.equal(lease.scope.paymentProfile,options.attributionGap261?paymentProfile:undefined);
    assert.equal(lease.seedProfile,options.attributionGap261?paymentProfile:undefined);
    assert.equal(permit.kind,'CURRENT259_PRIVATE_ATTRIBUTION_GAP_CASE');
    assert.deepEqual(lease.scope.attributionGap,{expectedStatus:409,paymentAmountCents:'800',projectAmountCents:'500',gapAmountCents:'300',automaticRetry:false});
   }
   lease.check();options.afterCaseResult?.();return {caseId:lease.scope.caseId,passed:true,...(options.scenario==='cancel-commit'
    ?{rollbackObserved:true,...(options.omitOriginalResult?{}:{originalResultUnconfirmed:true}),
      ...(options.omitRollbackEvidence?{}:{rollbackEvidence:{fault:'commit-cancelled',observedXid32:'9101',originalRequestKeySha256:'a'.repeat(64)}})}:options.attributionGap?{attributionGapEvidence:{registrationStatus:409,projectAmountCents:'500',gapAmountCents:'300',originalRequestKeySha256:'e'.repeat(64),
      originalResultUnconfirmed:true,...options.gapEvidenceOverride},...(options.gapExecution?{executionId:'forged'}:{})}:{executionId:'public-execution',rootId:'public-root'})};
  }};
 }

 if(options.competition){
  const pair=Object.freeze([Object.freeze({}),Object.freeze({})]);
  const applications=Object.freeze(pair.map(()=>Object.freeze({runtime:Object.freeze({}),inspect(){return {runtime:this.runtime};}})));
  const roleProvision=options.voucher261?'provisionCurrent259Payment261VoucherRoles':options.competition261?'provisionCurrent259Payment261CompetitionRoles':'provisionCurrent259CompetitionRoles';
  const roleClaim=options.voucher261?'claimCurrent259Payment261VoucherRolePermit':options.competition261?'claimCurrent259Payment261CompetitionRolePermit':'claimCurrent259CompetitionRolePermit';
  ports['./task16-current259-role-provision.cjs'][roleProvision]=async(value,h,permit)=>{
   state.calls.push('roles9-cap2');assert.equal(value,technical);assert.equal(h,handle);
   if(options.competitionRoleClaim)module.exports[options.competitionRoleClaim](permit,h,value);
   assert.equal(module.exports[roleClaim](permit,h,value),true);
   return options.competitionWrongRoleResult?{...roles,paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'}:roles;
  };
  ports['./task16-current259-live-sessions.cjs'].withCurrent259CompetitionLiveSessions=async(b7,h,permit,consume)=>{
   assert.equal(h,handle);assert.equal(b7.installXid,'1300');state.calls.push('live-two');
   assert.equal(module.exports.claimCurrent259CompetitionLivePermit(permit,h,b7),true);
   if(options.replayLive)module.exports.claimCurrent259CompetitionLivePermit(permit,h,b7);
   try{return await consume(pair);}finally{state.calls.push('pools-two-close');}
  };
  ports['./task16-current259-application-factory.cjs'].withCurrent259OwnedApplicationPair=async(proof,h,sig,consume)=>{
   assert.equal(proof,pair);assert.equal(h,handle);assert.equal(sig,signal);state.calls.push('app-two');
   try{return await consume(applications);}finally{state.calls.push('app-two-close');}
  };
  ports['./task16-current259-application-factory.cjs'].consumeCurrent259PaymentCompetition=async(apps,h,permit)=>{
   state.calls.push('competition');assert.equal(apps,applications);assert.equal(h,handle);
   const lease=module.exports.claimCurrent259PaymentBusinessPermit(permit,apps,h);
   assert.equal(lease.seedProfile,options.competition261||options.voucher261?paymentProfile:undefined);lease.check();
   assert.equal(lease.paymentProfile,paymentProfile);assert.equal(Object.hasOwn(lease,"paymentProfile"),paymentProfile!==undefined);
   assert.equal(lease.scope.scenario,options.followUp261?'competition-follow-up':options.voucher?'competition-voucher':'competition');
   assert.equal(lease.scope.paymentProfile,paymentProfile);
   if(options.voucher){
    assert.equal(permit.kind,'CURRENT259_PRIVATE_VOUCHER_CASE');
    assert.equal(lease.scope.voucherStorageRoot,'/private/tmp/model-resource/application-private-voucher');
    if(options.voucherFailureStage){
     lease.recordVoucherFailure('private upstream body');
     lease.recordVoucherFailure(options.voucherFailureStage);
     lease.recordVoucherFailure('FINAL_VERIFY');
     throw new Error('private upstream body');
    }
   }
   return {caseId:lease.scope.caseId,passed:true,competitionObserved:true,...(options.voucher&&!options.missingVoucherResult?{voucherVerified:true}:{}),winner:'comprehensive_director',executionId:'execution',rootId:'root',...(options.followUp261&&!options.missingFollowUpResult?{fullyPaid:true,secondExecutionId:'40404040-1234-4bcd-8f12-0123456789ab'}:{})};
  };
  ports['./task16-current259-payment-competition.cjs']={executeCurrent259PaymentCompetition(){assert.fail('unexpected raw competition callback');}};
 }
 if(options.disconnect){
  const firstProof=Object.freeze({}),replacementProof=Object.freeze({}),closeProof=Object.freeze({});
  const attempt=Object.freeze({}),rollback=Object.freeze({});
  const app=origin=>Object.freeze({origin,sourceBinding,runtime:Object.freeze({}),inspect(){return {runtime:this.runtime};}});
  const originalApp=app('http://127.0.0.1:52123/'),replacementApp=app(options.sameListener?'http://127.1:52123':'http://127.0.0.1:52124/');
  ports['./task16-current259-live-sessions.cjs'].withCurrent259DisconnectLiveSessions=async(b7,h,permit,consume)=>{
   assert.equal(h,handle);assert.equal(b7.installXid,'1300');state.calls.push('live-disconnect');
   assert.equal(module.exports.claimCurrent259DisconnectLivePermit(permit,h,b7),true);
   try{return await consume(firstProof,async(closed,prior,next)=>{
    assert.equal(closed,closeProof);assert.equal(prior,attempt);
    assert.equal(state.calls.at(-1),'original-app-closed');
    state.calls.push('retire','rollback');
    if(options.rollbackFailure){
     const {captureCurrent259DisconnectFailure,carryCurrent259DisconnectFailure}=require('./task16-current259-disconnect-failure.cjs');
     const cause=Object.assign(new Error('PG_CASE_DISCONNECT_LEDGER_CHANGED'),{privateSql:'SECRET_SQL_PASSWORD'});
     const error=Object.assign(new Error('CURRENT259_LIVE_SESSIONS_FAILED_CLOSED'),{code:'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED'});
     throw carryCurrent259DisconnectFailure(error,captureCurrent259DisconnectFailure(cause,'ROLLBACK_OBSERVATION'));
    }
    return next(replacementProof,rollback,originalApp.origin);
   });}finally{state.calls.push('pools-close');}
  };
  ports['./task16-current259-application-factory.cjs'].claimCurrent259DisconnectApplicationClose=()=>assert.fail('fake main must not receive the raw claim');
  ports['./task16-current259-application-factory.cjs'].withCurrent259OwnedDisconnectApplication=async(proof,h,sig,consume)=>{
   assert.equal(proof,firstProof);assert.equal(h,handle);assert.equal(sig,signal);state.calls.push('original-app');
   const value=await consume(originalApp);state.calls.push('original-app-closed');return {value,closeProof};
  };
  ports['./task16-current259-application-factory.cjs'].withCurrent259OwnedApplication=async(proof,h,sig,consume)=>{
   assert.equal(proof,replacementProof);assert.equal(h,handle);assert.equal(sig,signal);state.calls.push('replacement-app');
   try{return await consume(replacementApp);}finally{state.calls.push('replacement-app-closed');}
  };
  ports['./task16-current259-payment-case.cjs'].runCurrent259PaymentCase=async(current,h,permit)=>{
   const business=module.exports.claimCurrent259PaymentBusinessPermit(permit,current,h);business.check();
   assert.equal(business.scope.scenario,'disconnect-commit-recovery');
   assert.equal(business.paymentProfile,paymentProfile);assert.equal(Object.hasOwn(business,'paymentProfile'),paymentProfile!==undefined);
   if(business.scope.disconnectPhase==='attempt'){
    assert.equal(business.seedProfile,options.payment261?paymentProfile:undefined);
    assert.equal(current,originalApp);
    assert.equal(module.exports.assertCurrent259PaymentBusinessContinuity(business.continuityToken,h,'disconnect-commit-recovery'),true);
    state.calls.push('first-post');
    return attempt;
   }
   assert.equal(current,replacementApp);
   assert.equal(business.scope.disconnectPhase,'recovery');
   assert.equal(business.seedProfile,undefined);
   assert.equal(business.scope.disconnectAttempt,attempt);assert.equal(business.scope.disconnectRollback,rollback);
   state.calls.push('recover');
   return {caseId:business.scope.caseId,passed:true,rollbackObserved:true,executionId:'execution',rootId:'root'};
  };
 }
 const rq=name=>{
  if(!name.startsWith('.'))return require(name);
  const resolved=path.resolve(__dirname,name);
  if(!cache[resolved])cache[resolved]={exports:ports[name]??require(name),filename:resolved};
  return cache[resolved].exports;
 };rq.resolve=name=>path.resolve(__dirname,name);rq.main=options.imported?{}:module;rq.cache=cache;
 const launcherOptions=options.launchOption?[options.launchOption]:options.followUp261?[options.default?'--competition-follow-up261':'--competition-follow-up261-once']:options.voucher261?[options.default?'--voucher261':'--voucher261-once']:
  options.attributionGap261?[options.default?'--attribution-gap261':'--attribution-gap261-once']:options.competition261?[options.default?'--competition261':'--competition261-once']:options.payment261?
  [options.business?(options.default?'--business261':'--business261-once'):(options.default?'--install261':'--install261-once')]:undefined;
 const proc={argv:['node',file,...(launcherOptions??(options.pfq?[options.default?'--pfq-composition':'--pfq-composition-once']:options.voucher?[options.default?'--voucher':'--voucher-once']:options.competition?[options.default?'--competition':'--competition-once']:options.attributionGap?[options.default?'--attribution-gap':'--attribution-gap-once']:options.business?[options.default?'--business':'--business-once']:options.default?[]:['--once'])),'--plan',options.planFile??s.output,'--expected-plan-sha256',options.selectedPlanSha??saved.sha256,...(options.progress?['--progress-root',state.progressRoot]:[])],execArgv:[],_preload_modules:[],env:{},getuid:process.getuid,
  stdout:{write(value,callback){state.exit=proc.exitCode;state.output+=value;callback?.();finish(JSON.parse(value));}},once(name,fn){state.signals[name]=fn;},removeListener(name){delete state.signals[name];},exit(){},exitCode:0};
 if(options.stale)s.state.stale=true;
 const launcherTimer=options.captureDeadline?((fn,ms)=>{assert.equal(ms,3600000);state.expireDeadline=fn;return Object.freeze({});}):setTimeout;
 const clearLauncherTimer=options.captureDeadline?noop:clearTimeout;
 new Function('require','module','__dirname','__filename','process','setTimeout','clearTimeout',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(rq,module,__dirname,file,proc,launcherTimer,clearLauncherTimer);
 return {api:module.exports,done,state,s,saved,handle,acl};
}
test('default verifies a fixed payment install plan without consuming an attempt or resource',async t=>{
 const f=fixture(t,{default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES',JSON.stringify(result));assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
 assert.deepEqual(Object.keys(f.api),['claimCurrent259B7WritePermit','claimCurrent259PaymentBusinessPermit','assertCurrent259PaymentBusinessContinuity','claimCurrent259CompetitionRolePermit','claimCurrent259Payment261CompetitionRolePermit','claimCurrent259CompetitionLivePermit','claimCurrent259DisconnectLivePermit','claimCurrent259VoucherAclPermit','claimCurrent259Payment261RolePermit','claimCurrent259Payment261VoucherRolePermit','claimCurrent259Payment261AttributionGapRolePermit']);
});
test('fresh once follows technical259→roles→seven→ACL→B7 under one handle and immutable attempt',async t=>{
 const f=fixture(t),result=await f.done;
 assert.equal(result.status,'PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(f.state.calls,['start','technical259','roles9','seven','acl','b7']);assert.equal(f.state.closes,1);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.nativeAdmission,false);assert.equal(receipt.financialAcceptance,false);assert.equal(receipt.executionAllowed,false);
 assert.equal(receipt.b7Binding.beforeSqlSha256,f.state.consumed.beforeSqlSha256);
 assert.equal(receipt.b7Binding.installSqlDigestSource,'FIXED_B7_RENDERER_NOT_INDEPENDENTLY_RECOMPUTED');
});

test('an imported module exposes claim only and cannot mint from JSON or a native flag',t=>{
 const f=fixture(t,{imported:true});
 assert.deepEqual(Object.keys(f.api),['claimCurrent259B7WritePermit','claimCurrent259PaymentBusinessPermit','assertCurrent259PaymentBusinessContinuity','claimCurrent259CompetitionRolePermit','claimCurrent259Payment261CompetitionRolePermit','claimCurrent259CompetitionLivePermit','claimCurrent259DisconnectLivePermit','claimCurrent259VoucherAclPermit','claimCurrent259Payment261RolePermit','claimCurrent259Payment261VoucherRolePermit','claimCurrent259Payment261AttributionGapRolePermit']);
 assert.throws(()=>f.api.claimCurrent259B7WritePermit({native:true},f.handle,f.acl));
 assert.throws(()=>f.api.claimCurrent259CompetitionRolePermit({native:true},f.handle,f.acl));
 assert.throws(()=>f.api.claimCurrent259CompetitionLivePermit({native:true},f.handle,f.acl));
 assert.throws(()=>f.api.claimCurrent259DisconnectLivePermit({native:true},f.handle,f.acl));
 assert.deepEqual(f.state.calls,[]);assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
});

test('source preflight failure consumes a durable attempt before zero resource calls and prevents fresh replay',async t=>{
 const f=fixture(t,{stale:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.onceAttemptConsumed,true);
 assert.deepEqual(f.state.calls,[]);
 const marker=fs.readFileSync(path.join(f.s.runRoot,'attempt.json')),receipt=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'));
 f.s.state.stale=false;
 const second=fixture(t,{planFixture:f.s,saved:f.saved}),again=await second.done;
 assert.equal(again.failureCode,'PAYMENT_INSTALL_ONCE_ALREADY_ATTEMPTED');
 assert.deepEqual(second.state.calls,[]);
 assert.deepEqual(fs.readFileSync(path.join(f.s.runRoot,'attempt.json')),marker);
 assert.deepEqual(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')),receipt);
});

for(const reason of [undefined,null,0,false]) test('a falsey technical failure stops all later stages ('+String(reason)+')',async t=>{
 const f=fixture(t,{technicalFailure:reason}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.deepEqual(f.state.calls,['start','technical259']);assert.equal(f.state.closes,1);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.failureStage,'technical259');assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
});

for(const change of [
 x=>x.binding.beforeSqlSha256='0'.repeat(64),
 x=>x.binding.identity={...x.binding.identity,runtimeOid:'999'},
 x=>x.binding.sourceSha='0'.repeat(40),
 x=>x.binding.aclXid='9'
]) test('a changed source, identity, ACL XID or independently recomputed before SQL cannot reach B7 write',async t=>{
 const f=fixture(t,{beforeConsume:change}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.consumed,null);assert.equal(f.state.closes,1);
 assert.deepEqual(f.state.calls,['start','technical259','roles9','seven','acl','b7']);
});

for(const invalid of [
 ({api,permit,h,value})=>api.claimCurrent259B7WritePermit({...permit},h,value),
 ({api,permit,value})=>api.claimCurrent259B7WritePermit(permit,{},value),
 ({api,permit,h,value})=>api.claimCurrent259B7WritePermit(permit,h,{...value}),
 ({api,permit,h,value})=>api.claimCurrent259B7WritePermit(permit,h,value)
]) test('copied permit, wrong handle/ACL and repeated claim invalidate the only issuer',async t=>{
 const f=fixture(t,{beforeConsume:invalid}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.consumed,null);assert.equal(f.state.closes,1);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
 assert.equal(receipt.timing.resourceAbort.origin,'CONTINUITY_REVOKED');
 assert.equal(receipt.timing.resourceAbort.stage,'b7');
});

test('abort during technical259 permanently stops role installation and later writes',async t=>{
 const f=fixture(t,{onTechnical(state){state.signals.SIGTERM();}}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.deepEqual(f.state.calls,['start','technical259']);assert.equal(f.state.closes,1);
});

test('abort releases an unsettled fixed technical stage and no later stage can run',async t=>{
 let entered,release;
 const ready=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const f=fixture(t,{onTechnical(){entered();return pending;}});
 t.after(async()=>{release();await f.done;});
 await ready;f.state.signals.SIGTERM();
 const result=await Promise.race([f.done,new Promise(resolve=>setTimeout(()=>resolve({stillPending:true}),50))]);
 assert.equal(result.stillPending,undefined);assert.equal(result.status,'STOPPED');
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_ABORTED_UNSETTLED');
 assert.deepEqual(f.state.calls,['start','technical259']);assert.equal(f.state.closes,1);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
 assert.equal(receipt.timing.resourceAbort.origin,'SIGNAL_SIGTERM');
 assert.equal(receipt.timing.resourceAbort.stage,'technical259');
});

test('receipt identifies the resource deadline at the first cancelled stage without running a later stage',async t=>{
 const f=fixture(t,{captureDeadline:true,onTechnical(state){state.expireDeadline();state.signals.SIGTERM();}});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_ABORTED_UNSETTLED');
 assert.deepEqual(f.state.calls,['start','technical259']);
 const {stages,elapsedMs,resourceAbort}=receipt.timing;
 assert.deepEqual(stages.map(row=>row.stage),['preflight','resourceStartup','technical259']);
 assert.ok(stages.every(row=>Number.isSafeInteger(row.elapsedMs)&&row.elapsedMs>=0));
 assert.equal(resourceAbort.origin,'RESOURCE_DEADLINE');assert.equal(resourceAbort.stage,'technical259');
 assert.ok(Number.isSafeInteger(resourceAbort.elapsedMs)&&resourceAbort.elapsedMs>=0&&resourceAbort.elapsedMs<=elapsedMs);
 assert.equal(f.state.closes,1);
});

test('first stage failure survives simultaneous cleanup UNKNOWN and no private text is persisted',async t=>{
 const f=fixture(t,{technicalFailure:new Error('SECRET_SQL_PASSWORD'),cleanupFailure:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(text.includes('SECRET_SQL_PASSWORD'),false);assert.equal(f.state.output.includes('SECRET_SQL_PASSWORD'),false);
 assert.equal(receipt.failureStage,'technical259');assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
 assert.deepEqual(f.state.calls,['start','technical259']);
});

test('a consumed marker without a final receipt remains UNKNOWN and cannot be retried',async t=>{
 const s=planFixture(t),saved=s.api.prepareCurrent259PaymentInstallPlan({runRoot:s.runRoot,daemonId:s.daemonId,output:s.output});
 fs.writeFileSync(path.join(s.runRoot,'attempt.json'),'prior process stopped',{mode:0o600});
 const f=fixture(t,{planFixture:s,saved}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_ALREADY_ATTEMPTED');
 assert.equal(result.receiptOutcome,'UNKNOWN');assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(s.runRoot,'receipt.json')),false);
});

test('a getter in the one-use B7 binding is rejected without reading it',async t=>{
 let getters=0;
 const f=fixture(t,{beforeConsume({binding}){Object.defineProperty(binding,'beforeSqlSha256',{enumerable:true,get(){getters++;return '0'.repeat(64);}});}});
 const result=await f.done;assert.equal(result.status,'STOPPED');assert.equal(getters,0);assert.equal(f.state.consumed,null);
});

test('real CommonJS default CLI finishes main initialization before its plan helper reimports frozen exports',t=>{
 const base=fs.mkdtempSync('/private/tmp/jg-payment-cjs-main-model-');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const entry=path.join(base,'services/api/prisma/task16-current259-payment-run-authorization.cjs');
 const write=(relative,content)=>{const target=path.join(base,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,content,{mode:0o600});};
 write('services/api/prisma/task16-current259-payment-run-authorization.cjs',fs.readFileSync(file,'utf8'));
 write('services/api/prisma/task16-current259-payment-diagnostics.cjs',fs.readFileSync(path.join(__dirname,'task16-current259-payment-diagnostics.cjs'),'utf8'));
 write('services/api/prisma/task16-current259-payment-loopback.cjs',fs.readFileSync(path.join(__dirname,'task16-current259-payment-loopback.cjs'),'utf8'));
 write('services/api/prisma/task16-current259-profile.cjs',fs.readFileSync(path.join(__dirname,'task16-current259-profile.cjs'),'utf8'));
 write('services/api/prisma/task16-current261-competition-profile.cjs',fs.readFileSync(path.join(__dirname,'task16-current261-competition-profile.cjs'),'utf8'));
 write('services/api/prisma/task16-current259-disconnect-failure.cjs',fs.readFileSync(path.join(__dirname,'task16-current259-disconnect-failure.cjs'),'utf8'));
 for(const [name,keys]of [
  ['task16-current259-b7-install',['installCurrent259B7']],
  ['local-staged-current259-profile',['createCurrent259TechnicalMigration','describeCurrent259TechnicalFailure']],
  ['task16-current259-role-provision',['provisionCurrent259Roles']],
  ['task16-current259-seven-install',['installCurrent259SevenFragments','describeCurrent259SevenFailure']],
  ['task16-current259-payment-acl-install',['installCurrent259PaymentAcl']],
  ['task16-current259-owned-resource',['withCurrent259TechnicalResource','withCurrent259FirstRollbackResource',
   'withCurrent259NormalPaymentResource','withCurrent259ResponseLossResource','withCurrent259CompetitionResource','withCurrent259VoucherResource','withCurrent259AttributionGapResource',
   'withCurrent259DisconnectRecoveryResource','claimCurrent259TechnicalResource']],
  ['task16-current259-catalog',['renderCurrent259CatalogRead']],
  ['task16-runtime-inputs',['readQualifiedTask16File']]
 ])write('services/api/prisma/'+name+'.cjs','module.exports=Object.freeze({'+keys.map(key=>key+':()=>{throw new Error("resource calls forbidden in default model");}').join(',')+'});');
 write('scripts/prepare-task16-current259-payment-install.cjs',`
 require('../services/api/prisma/task16-current259-payment-run-authorization.cjs');
 const plan={material:{source:{candidateSha:'${'a'.repeat(40)}'}},scope:{migrations:259}};
 module.exports=Object.freeze({
  readCurrent259PaymentInstallPlan(){return {plan};},
  verifyCurrent259PaymentInstallPlan(){return {check(){}};}
 });
 `);
 const result=require('node:child_process').spawnSync(process.execPath,[entry,'--plan',path.join(base,'unused-plan.json'),'--expected-plan-sha256','f'.repeat(64)],{encoding:'utf8',env:{}});
 assert.equal(result.status,0,result.stdout);
 assert.equal(JSON.parse(result.stdout).status,'PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES');
 assert.equal(fs.existsSync(path.join(base,'attempt.json')),false);
});

function competitionFixture(t,options={}){
 const source=path.join(ROOT,'scripts/prepare-task16-current259-payment-business.test.cjs'),holder={exports:{}},rq=Module.createRequire(source);
 new Function('require','module','__dirname',fs.readFileSync(source,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),holder,path.dirname(source));
 const payment261=options.followUp261||options.competition261||options.voucher261;
 const s=holder.exports.fixture(t,{payment261}),plan=s.business[options.followUp261?'prepareCurrent261PaymentCompetitionFollowUpPlan':options.voucher261?'prepareCurrent261PaymentVoucherPlan':options.competition261?'prepareCurrent261PaymentCompetitionPlan':options.voucher?'prepareCurrent259PaymentVoucherPlan':'prepareCurrent259PaymentCompetitionPlan']({
  runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const read=payment261?s.api.readCurrent261PaymentInstallPlan:s.api.readCurrent259PaymentInstallPlan;
 const saved=read(s.output+'.installation.json',JSON.parse(fs.readFileSync(s.output)).installation.sha256,...(payment261?[JSON.parse(fs.readFileSync(s.output)).scope.paymentProfile]:[])).file;
 return fixture(t,{...options,competition261:options.followUp261||options.competition261,payment261,voucher:options.voucher261||options.voucher,competition:true,planFixture:s,saved,businessApi:s.business,selectedPlanSha:plan.sha256});
}
test('competition consumes one fixed plan and reaches only the two-lane case, closing both apps before pools',async t=>{
 const f=competitionFixture(t),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(f.state.calls,['start-competition','technical259','roles9-cap2','seven','acl','b7','live-two','env','app-two','competition','app-two-close','env-close','pools-two-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.business.competitionObserved,true);
 assert.equal(receipt.business.winner,'comprehensive_director');
 assert.equal(receipt.financialAcceptance,false);
});
test('competition live permit replay stops before environment and fixture',async t=>{
 const f=competitionFixture(t,{replayLive:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.equal(result.onceAttemptConsumed,true);
 assert.deepEqual(f.state.calls,['start-competition','technical259','roles9-cap2','seven','acl','b7','live-two']);
 assert.equal(f.state.closes,1);
});
test('competition verification reaches neither resource nor attempt',async t=>{
 const f=competitionFixture(t,{default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_COMPETITION_PLAN_VERIFIED_NO_RESOURCES',JSON.stringify(result));
 assert.equal(f.state.exit,0);
 assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
});


function disconnectFixture(t,options={}){
 const source=path.join(ROOT,'scripts/prepare-task16-current259-payment-business.test.cjs'),holder={exports:{}},rq=Module.createRequire(source);
 new Function('require','module','__dirname',fs.readFileSync(source,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),holder,path.dirname(source));
 const s=holder.exports.fixture(t,{payment261:options.payment261});
 const prepare=options.payment261?s.business.prepareCurrent261PaymentBusinessPlan:s.business.prepareCurrent259PaymentBusinessPlan;
 const plan=prepare({
  runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,scenario:'disconnect-commit-recovery',paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const read=options.payment261?s.api.readCurrent261PaymentInstallPlan:s.api.readCurrent259PaymentInstallPlan;
 const saved=read(s.output+'.installation.json',JSON.parse(fs.readFileSync(s.output)).installation.sha256).file;
 return fixture(t,{...options,disconnect:true,business:true,planFixture:s,saved,businessApi:s.business,selectedPlanSha:plan.sha256});
}
for(const rollbackFailure of [false,true])test('fresh A16 once only starts a replacement application after retired original and confirmed rollback ('+rollbackFailure+')',async t=>{
 const f=disconnectFixture(t,{rollbackFailure}),result=await f.done;
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,rollbackFailure?'STOPPED':'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.equal(result.onceAttemptConsumed,true);
 assert.deepEqual(f.state.calls,[
  'start-disconnect-commit-recovery','technical259','roles9','seven','acl','b7','live-disconnect','env','original-app','first-post','original-app-closed','retire','rollback',
  ...(!rollbackFailure?['replacement-app','recover','replacement-app-closed']:[]),'env-close','pools-close'
 ]);
 assert.equal(receipt.business.runtimeReplaced,rollbackFailure?undefined:true);
 assert.equal(receipt.scope.databaseTransport,'PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS_V1');
 assert.equal(receipt.resource.topology,'UNVERIFIED_PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS');
 assert.equal(receipt.resource.cleanup.relayId,receipt.resource.relay.id);
 assert.equal(receipt.financialAcceptance,false);
 assert.equal(f.state.closes,1);
});


test('261 A16 only issues the batched seed to the first application',async t=>{
 const f=disconnectFixture(t,{payment261:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.equal(f.state.calls.filter(value=>value==='first-post').length,1);
 assert.equal(f.state.calls.filter(value=>value==='recover').length,1);
});

test('disconnect once publishes the branded first failure independently of later cleanup UNKNOWN',async t=>{
 const f=disconnectFixture(t,{rollbackFailure:true,cleanupFailure:true}),result=await f.done;
 const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(result.status,'STOPPED');
 assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 assert.equal(receipt.failureStage,'retireOriginalRuntimeAndConfirmRollback');
 assert.deepEqual(receipt.disconnectFailure,{stage:'ROLLBACK_OBSERVATION',code:'PG_CASE_DISCONNECT_LEDGER_CHANGED'});
 assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
 assert.doesNotMatch(text,/SECRET_SQL_PASSWORD/u);
});

test('fresh A16 refuses an equivalent replacement listener before issuing the recovery case permit',async t=>{
 const f=disconnectFixture(t,{sameListener:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_DISCONNECT_REPLACEMENT_ENDPOINT');
 assert.equal(f.state.calls.includes('recover'),false);
 assert.equal(f.state.calls.filter(call=>call==='first-post').length,1);
 assert.equal(f.state.closes,1);
});

for(const missing of [null,'original-result','fault-proof','relay-cleanup'])test('cancellation receipt requires original result and fault proof ('+missing+')',async t=>{
 const source=path.join(ROOT,'scripts/prepare-task16-current259-payment-business.test.cjs'),holder={exports:{}},rq=Module.createRequire(source);
 new Function('require','module','__dirname',fs.readFileSync(source,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),holder,path.dirname(source));
 const s=holder.exports.fixture(t),plan=s.business.prepareCurrent259PaymentBusinessPlan({
  runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,scenario:'cancel-commit',paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const saved=s.api.readCurrent259PaymentInstallPlan(s.output+'.installation.json',JSON.parse(fs.readFileSync(s.output)).installation.sha256).file;
 const f=fixture(t,{omitOriginalResult:missing==='original-result',omitRollbackEvidence:missing==='fault-proof',business:true,scenario:'cancel-commit',relayCleanupUnknown:missing==='relay-cleanup',planFixture:s,saved,businessApi:s.business,selectedPlanSha:plan.sha256});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,missing?'STOPPED':'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED');
 assert.equal(f.state.calls[0],'start-first-rollback');
 assert.equal(receipt.resource.relay.containerId,receipt.resource.containerId);
 assert.equal(receipt.resource.cleanup.relayClosed,missing!=='relay-cleanup');
 assert.equal(receipt.resource.loopbackPlaintextHba.sourceAddress,'127.0.0.1');
 const businessMissing=missing==='original-result'||missing==='fault-proof';
 assert.equal(receipt.business.originalResultUnconfirmed,businessMissing?undefined:true);
 assert.equal(receipt.business.rollbackObserved,businessMissing?undefined:true);
 assert.equal(receipt.business.executionId,undefined);
 assert.deepEqual(receipt.business.rollbackEvidence,businessMissing?undefined:{fault:'commit-cancelled',observedXid32:'9101',originalRequestKeySha256:'a'.repeat(64)});
 assert.deepEqual(f.state.calls.slice(-4),['case','app-close','env-close','pools-close']);
});

for(const mode of ['closed','cleanup-unknown','manifest-only','different-receipt','wrong-daemon','missing-container-id'])test('startup evidence binds only its original matched cleanup receipt ('+mode+')',async t=>{
 const f=fixture(t,{startupFailure:mode}),result=await f.done;
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,'STOPPED');
 assert.equal(receipt.failureCode,'TASK01_RESOURCE_START_FAILED');
 assert.equal(receipt.failureStage,'resourceStartup');
 assert.deepEqual(f.state.calls,['start']);
 assert.equal(receipt.resource.cleanup.status,mode==='closed'?'completed':'UNKNOWN');
 if(mode==='closed'){
  assert.equal(receipt.resource.identityBinding,'ORIGINAL_STARTER_EXCEPTION_AND_FINAL_MANIFEST');
  assert.deepEqual(receipt.resource.startupFailure,{stage:'published-port-probe',commandKind:'nonzero-exit'});
  assert.equal(receipt.resource.startupFailureCode,'TASK01_RESOURCE_COMMAND_FAILED');
  assert.equal(receipt.resource.port,null);
 }
 assert.ok(!JSON.stringify(receipt).includes('PRIVATE_STARTER_DETAIL'));
});

test('the once receipt retains the fixed Prisma prefix diagnostic and first failure despite cleanup UNKNOWN',async t=>{
 const technicalDetail=Object.freeze({stage:'PRISMA_DEPLOY',prefixMigrations:203,kind:'PRISMA_REJECTED',prismaCode:'P3018',sqlState:'42501'});
 const technicalFailure=Object.assign(new Error('PRIVATE_PRISMA_DIAGNOSTIC'),{code:'CURRENT259_TECHNICAL_DEPLOY_203_P3018_SQLSTATE_42501'});
 const f=fixture(t,{technicalFailure,technicalDetail,cleanupFailure:true}),result=await f.done;
 const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(result.status,'STOPPED');assert.equal(receipt.failureCode,technicalFailure.code);assert.equal(receipt.failureStage,'technical259');
 assert.deepEqual(receipt.technicalFailure,technicalDetail);assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
 assert.doesNotMatch(text+f.state.output,/PRIVATE_PRISMA_DIAGNOSTIC/u);
 assert.deepEqual(f.state.calls,['start','technical259']);
});

 test('PFQ composition verifies its own plan and cannot consume an installation-only plan',async t=>{
  const rejected=fixture(t,{pfq:true}),result=await rejected.done;
  assert.equal(result.failureCode,'PAYMENT_INSTALL_PLAN_SCOPE');
  assert.equal(result.resourceCreationRequested,false);
  assert.deepEqual(rejected.state.calls,[]);
 });

 test('PFQ composition consumes B7 and the owned TLS resource before the full original Jest file',async t=>{
  const f=fixture(t,{pfq:true,pfqPlan:true}),result=await f.done;
  assert.equal(result.status,'PFQ_COMPOSED_CONCURRENCY_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
  assert.deepEqual(f.state.calls,['start-first-rollback','technical259','roles9','seven','acl','b7','claim-B7','verify-installed',
   'jest','independent-sessions','jest-admitted','independent-sessions','verify-installed','disconnect-live']);
  assert.equal(f.state.closes,1);
 });
 test('PFQ composition rejects a foreign session without admitting Jest business writes',async t=>{
  const f=fixture(t,{pfq:true,pfqPlan:true,pfqIdentityDrift:true}),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'CURRENT259_PFQ_SESSION_ADMISSION');
  assert.ok(f.state.calls.includes('independent-sessions'));
  assert.ok(!f.state.calls.includes('jest-admitted'));
  assert.equal(f.state.closes,1);
 });
 test('PFQ composition stops when the original suite reports incomplete business cases',async t=>{
  const f=fixture(t,{pfq:true,pfqPlan:true,pfqPartial:true}),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'CURRENT259_PFQ_JEST_RESULT');
  const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8');
  assert.equal(JSON.parse(text).failureStage,'pfqConcurrency');
  assert.doesNotMatch(text,/postgresql:|testResults|LIVE_SESSIONS_FAILED_CLOSED/);
  assert.ok(f.state.calls.includes('jest-admitted'));
  assert.equal(f.state.closes,1);
 });

 test('PFQ composition rejects a backend replacement before certifying the completed cases',async t=>{
  const f=fixture(t,{pfq:true,pfqPlan:true,pfqFinalDrift:true}),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'CURRENT259_PFQ_SESSION_DRIFT');
  assert.ok(f.state.calls.includes('jest-admitted'));
  assert.equal(f.state.calls.filter(call=>call==='independent-sessions').length,1);
  assert.equal(f.state.closes,1);
 });

test('competition rejects another payment topology before claiming its two-lane role permit',async t=>{
 const f=competitionFixture(t,{resourceTopology:'UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS'}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_RESOURCE_IDENTITY');
 assert.deepEqual(f.state.calls,['start-competition']);assert.equal(f.state.closes,1);
});
test('competition does not certify the winner if the final relay identity differs',async t=>{
 const f=competitionFixture(t,{relayCleanupWrongId:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.scope.databaseTransport,'PAYMENT_COMPETITION_LOOPBACK_TLS_V1');
 assert.equal(receipt.resource.topology,'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS');
 assert.equal(receipt.resource.cleanup.status,'UNKNOWN');assert.equal(receipt.resource.cleanup.relayClosed,false);
});

test('disconnect plan rejects a rollback-profile resource before its first technical or business action',async t=>{
 const f=disconnectFixture(t,{resourceTopology:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS'}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_RESOURCE_IDENTITY');
 assert.deepEqual(f.state.calls,['start-disconnect-commit-recovery']);assert.equal(f.state.closes,1);
});
test('disconnect does not certify its recovered case if the original relay cleanup ID differs',async t=>{
 const f=disconnectFixture(t,{relayCleanupWrongId:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.business.runtimeReplaced,true);assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
 assert.equal(receipt.resource.cleanup.relayClosed,false);
});

function attributionGapFixture(t,options={}){
 const source=path.join(ROOT,'scripts/prepare-task16-current259-payment-business.test.cjs'),holder={exports:{}},rq=Module.createRequire(source);
 new Function('require','module','__dirname',fs.readFileSync(source,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),holder,path.dirname(source));
 const s=holder.exports.fixture(t,{payment261:options.attributionGap261});
 const prepare=options.attributionGap261?s.business.prepareCurrent261PaymentAttributionGapPlan:s.business.prepareCurrent259PaymentAttributionGapPlan;
 const plan=prepare({
  runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const read=options.attributionGap261?s.api.readCurrent261PaymentInstallPlan:s.api.readCurrent259PaymentInstallPlan;
 const saved=read(s.output+'.installation.json',JSON.parse(fs.readFileSync(s.output)).installation.sha256,...(options.attributionGap261?[JSON.parse(fs.readFileSync(s.output)).scope.paymentProfile]:[])).file;
 return fixture(t,{payment261:options.attributionGap261,business:true,attributionGap:true,scenario:'attribution-gap',...options,planFixture:s,saved,businessApi:s.business,selectedPlanSha:plan.sha256});
}
test('main publishes the ordinary live checkpoint with the original failure code and cleanup outcome',async t=>{
 const liveDetail=Object.freeze({checkpoint:'CATALOG',prismaCode:null,sqlState:'42501'});
 const liveFailure=Object.assign(new Error('private connection URL'),{code:'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED'});
 const f=attributionGapFixture(t,{liveFailure,liveDetail,cleanupFailure:true}),result=await f.done;
 const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(result.status,'STOPPED');
 assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 assert.equal(receipt.failureStage,'liveSessions');
 assert.deepEqual(receipt.liveFailure,liveDetail);
 assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
 assert.equal(receipt.business,undefined);
 assert.equal(receipt.disconnectFailure,undefined);
 assert.doesNotMatch(text,/private connection URL|SECRET_SQL_PASSWORD/u);
 assert.deepEqual(f.state.calls,['start-attribution-gap','technical259','roles9','seven','acl','b7','live','pools-close']);
});

test('main publishes only the genuine fixed application diagnostic before any seed or selected case',async t=>{
 const applicationDetail=Object.freeze({phase:'LIVE_VERIFY_AFTER',code:'CURRENT259_LIVE_SESSIONS_VERIFICATION',elapsedMs:37,
  live:Object.freeze({checkpoint:'CATALOG',prismaCode:null,sqlState:null,outcome:'TIMED_OUT'})});
 const applicationFailure=Object.assign(new Error('private connection URL'),{code:'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED',
  applicationFailure:{phase:'NEST_INIT',secret:'private SQL'}});
 const f=attributionGapFixture(t,{applicationFailure,applicationDetail}),result=await f.done;
 const bytes=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(bytes);
 assert.equal(result.status,'STOPPED');
 assert.equal(receipt.failureStage,'ownedApplication');
 assert.deepEqual(receipt.applicationFailure,applicationDetail);
 assert.equal(receipt.business,undefined);
 assert.equal(f.state.calls.includes('case'),false);
 assert.doesNotMatch(bytes,/private connection URL|private SQL|NEST_INIT/u);
});

test('the fixed attribution-gap publisher verifies without opening resources or an attempt',async t=>{
 const f=attributionGapFixture(t,{default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES',JSON.stringify(result));
 assert.equal(f.state.exit,0);
 assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
});
function ordinaryBusinessFailureFixture(t,options){
 const source=path.join(ROOT,'scripts/prepare-task16-current259-payment-business.test.cjs'),holder={exports:{}},rq=Module.createRequire(source);
 new Function('require','module','__dirname',fs.readFileSync(source,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),holder,path.dirname(source));
 const s=holder.exports.fixture(t,{payment261:true}),plan=s.business.prepareCurrent261PaymentBusinessPlan({
  runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,scenario:'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'
 });
 const saved=s.api.readCurrent261PaymentInstallPlan(s.output+'.installation.json',JSON.parse(fs.readFileSync(s.output)).installation.sha256).file;
 return fixture(t,{payment261:true,business:true,...options,planFixture:s,saved,businessApi:s.business,selectedPlanSha:plan.sha256});
}
test('only the original ordinary 261 issuer supplies its fixed owner seed mode',async t=>{
 let observed;
 const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease}){
  observed=lease.seedProfile;
  assert.equal(lease.scope.seedProfile,undefined);
 }});
 const result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED');
 assert.equal(observed,'TASK16_PAYMENT261_RUNTIME_V1');
});
for(const [stage,permission,code,options] of [
 ['APPLICATION_LEASE','ISSUED_NOT_YET_CONSUMED','TASK16_APP_HANDLE',{beforeCaseFailure:Object.assign(new Error('private fixture'),{code:'TASK16_APP_HANDLE'})}],
 ['PERMIT_CLAIM','ISSUED_NOT_YET_CONSUMED','PAYMENT_INSTALL_ONCE_BUSINESS_AUTHORITY',{caseWrongApp:true}],
 ['SEED_OWNER_TRANSACTION','CONSUMED_ONCE','P2028',{onBusiness({lease}){
  lease.recordCaseFailure('private phase','P2028');
  lease.recordCaseFailure('SEED_OWNER_TRANSACTION','P2028');
  lease.recordCaseFailure('SELECTED_CASE','P2003');
 },caseFailure:new Error('private fixture')}],
 ['SEED_LOGIN','CONSUMED_ONCE',undefined,{onBusiness({lease}){lease.recordCaseFailure('SEED_LOGIN','private code',403);},caseFailure:new Error('private fixture')}],
]){
 test('ordinary payment receipt preserves fixed failure '+stage,async t=>{
  const f=ordinaryBusinessFailureFixture(t,options),result=await f.done;
  assert.equal(result.status,'STOPPED');assert.equal(f.state.calls.filter(value=>value==='case').length,1);
  const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
  assert.equal(receipt.failureStage,'seedAndSelectedCase');
  assert.equal(receipt.business.permission,permission);
  assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
  assert.deepEqual(receipt.paymentCaseFailure,{stage,...(code?{code}:{}),...(stage==='SEED_LOGIN'?{httpStatus:403}:{})});
  assert.doesNotMatch(text,/private (?:phase|code|fixture)/u);
 });
}

test('the attribution-gap plan is refused by the ordinary business entry before the attempt marker',async t=>{
 const f=attributionGapFixture(t,{attributionGap:false}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
});
test('the attribution-gap publisher issues one case on its own resource and only publishes fixed rejection evidence',async t=>{
 const f=attributionGapFixture(t),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(f.state.calls,['start-attribution-gap','technical259','roles9','seven','acl','b7','live','env','app','case','app-close','env-close','pools-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.deepEqual(receipt.business,{scenario:'attribution-gap',caseId:'registered.project-attribution-gap',permission:'CONSUMED_ONCE',
  outcome:'CASE_RETURNED_NOT_FULL_ACCEPTANCE',attributionGapEvidence:{registrationStatus:409,projectAmountCents:'500',gapAmountCents:'300',
   originalRequestKeySha256:'e'.repeat(64),originalResultUnconfirmed:true}});
 assert.equal(receipt.resource.cleanup.relayClosed,true);
 assert.equal(receipt.financialAcceptance,false);
});
for(const options of [{gapExecution:true},{gapEvidenceOverride:{gapAmountCents:'301'}},{gapEvidenceOverride:{registrationStatus:201}}]){
 test('the attribution-gap publisher rejects forged completion '+Object.keys(options)[0],async t=>{
  const f=attributionGapFixture(t,options),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT');
  assert.equal(f.state.calls.filter(x=>x==='case').length,1);
 });
}


for(const [stage,code] of [
 ['PUBLIC_ACCOUNT','PG_CASE_ATTRIBUTION_GAP_PUBLIC_BALANCES'],
 ['REGISTRATION','PG_CASE_ATTRIBUTION_GAP_EXPECTED_CONFLICT'],
 ['ORIGINAL_RESULT','PG_CASE_ATTRIBUTION_GAP_ORIGINAL_RESULT'],
 ['OWNER_AFTER','PG_CASE_ATTRIBUTION_GAP_OWNER_READ']
]){
 test('the attribution-gap receipt preserves the fixed first failure at '+stage,async t=>{
  const f=attributionGapFixture(t,{gapFailureStage:stage,caseFailure:new Error('raw private failing response')});
  const result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
  const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
  assert.equal(receipt.failureStage,'seedAndSelectedCase');
  assert.deepEqual(receipt.attributionGapFailure,{stage,code});
  assert.equal(receipt.disconnectFailure,undefined);
  assert.equal(receipt.resource.cleanup.relayClosed,true);
  assert.ok(!JSON.stringify(receipt).includes('raw private failing response'));
  assert.deepEqual(f.state.calls.slice(-4),['case','app-close','env-close','pools-close']);
 });
}

test('voucher alone claims its ACL permit and binds the fixed profile through B7 and the dual application',async t=>{
 const f=competitionFixture(t,{voucher:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(f.state.calls,['start-competition-voucher','technical259','roles9-cap2','seven','voucher-acl','b7','live-two','env','app-two','competition','app-two-close','env-close','pools-two-close']);
 assert.equal(f.state.consumed.identity.voucherProfile,'CURRENT259_PAYMENT_VOUCHER_V1');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.business.voucherVerified,true);
});
for(const mode of ['wrongVoucherSeven','replayVoucher'])test('voucher refuses '+mode+' before B7 and all application work',async t=>{
 const f=competitionFixture(t,{voucher:true,[mode]:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.ok(f.state.calls.includes('voucher-acl'));
 assert.ok(!f.state.calls.includes('b7'));
 assert.ok(!f.state.calls.includes('app-two'));
});

test('voucher verification mode does not consume the attempt or enter the resource',async t=>{
 const f=competitionFixture(t,{voucher:true,default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_VOUCHER_PLAN_VERIFIED_NO_RESOURCES');
 assert.equal(f.state.exit,0);
 assert.deepEqual(f.state.calls,[]);
 assert.deepEqual(fs.readdirSync(f.s.runRoot),[]);
});
test('voucher refuses a case that never proved the file and keeps the original pair close order',async t=>{
 const f=competitionFixture(t,{voucher:true,missingVoucherResult:true}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.deepEqual(f.state.calls.slice(-4),['competition','app-two-close','env-close','pools-two-close']);
});


for(const [stage,code] of [
 ['MULTIPART_UPLOAD','CURRENT259_PAYMENT_VOUCHER_MULTIPART_UPLOAD'],
 ['ATTACH','CURRENT259_PAYMENT_VOUCHER_ATTACH'],
 ['ORIGINAL_RESULT','CURRENT259_PAYMENT_VOUCHER_ORIGINAL_RESULT'],
 ['OWNER_AFTER','CURRENT259_PAYMENT_VOUCHER_OWNER_READ'],
 ['STORAGE_BYTES','CURRENT259_PAYMENT_VOUCHER_STORAGE_BYTES'],
 ['LEDGER_AFTER','CURRENT259_PAYMENT_VOUCHER_LEDGER_DRIFT']
]){
 test('A17 publishes the first safe stage '+stage+' and keeps pair cleanup',async t=>{
  const f=competitionFixture(t,{voucher:true,voucherFailureStage:stage}),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
  assert.deepEqual(f.state.calls.slice(-4),['competition','app-two-close','env-close','pools-two-close']);
  const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
  assert.equal(receipt.failureStage,'seedAndSelectedCase');
  assert.deepEqual(receipt.voucherFailure,{stage,code});
  assert.equal(receipt.attributionGapFailure,undefined);
  assert.equal(receipt.disconnectFailure,undefined);
  assert.equal(receipt.resource.cleanup.relayClosed,true);
  assert.ok(!JSON.stringify(receipt).includes('private upstream body'));
 });
}

test('main retains the fixed seven prestate reason after cleanup without raw output or another stage',async t=>{
 const sevenFailure=Object.assign(Error('private detail'),{code:'CURRENT259_SEVEN_INSTALL_PRESTATE_REJECTED'});
 const sevenDetail={phase:'current259-seven-before',boundary:'OWNER_SQL',causeCode:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'P0001',
  guard:'CURRENT259_SEVEN_INSTALL_SCOPE',section:'SCOPE_GUARD',scopeReason:'FUND_IMMUTABLE_ROUTINE'};
 const f=fixture(t,{sevenFailure,sevenDetail}),result=await f.done;
 assert.equal(result.failureCode,sevenFailure.code);
 assert.deepEqual(f.state.calls,['start','technical259','roles9','seven']);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.failureStage,'sevenFragments');
 assert.deepEqual(receipt.sevenFailure,sevenDetail);
 assert.doesNotMatch(JSON.stringify(receipt),/private detail/u);
 assert.equal(receipt.resource.cleanup.status,'completed');
});

test('explicit install261 verifies offline and once claims the private ordinary role permit before B7',async t=>{
 const offline=fixture(t,{payment261:true,default:true});
 assert.equal((await offline.done).status,'PAYMENT261_INSTALL_PLAN_VERIFIED_NO_RESOURCES');
 assert.deepEqual(offline.state.calls,[]);
 assert.equal(fs.existsSync(path.join(offline.s.runRoot,'attempt.json')),false);
 const once=fixture(t,{payment261:true}),result=await once.done;
 assert.equal(result.status,'PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(once.state.calls,['start','technical259','payment261-roles','seven','acl','b7']);
 const receipt=JSON.parse(fs.readFileSync(path.join(once.s.runRoot,'receipt.json')));
 assert.equal(receipt.purpose,'current261-payment-technical-install-through-b7');
 assert.equal(receipt.stages[0].stage,'technical261');
 assert.equal(receipt.scope.migrations,261);
 assert.equal(receipt.b7Binding.identity.paymentProfile,'TASK16_PAYMENT261_RUNTIME_V1');
});
for(const badPayment261Permit of ['copy','replay','result'])test('payment261 rejects '+badPayment261Permit+' before seven or B7',async t=>{
 const f=fixture(t,{payment261:true,badPayment261Permit}),result=await f.done;
 assert.equal(result.status,'STOPPED');
 assert.deepEqual(f.state.calls,['start','technical259','payment261-roles']);
 assert.equal(f.state.closes,1);
});
test('payment261 and historical install launcher options reject cross-use before creating an attempt',async t=>{
 for(const [payment261,launchOption] of [[true,'--once'],[false,'--install261-once']]){
  const f=fixture(t,{payment261,launchOption}),result=await f.done;
  assert.equal(result.status,'STOPPED');
  assert.deepEqual(f.state.calls,[]);
  assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
 }
});
test('ordinary payment261 rejects an archive profile substituted in the exact B7 binding',async t=>{
 const f=fixture(t,{payment261:true,beforeConsume({binding}){
  binding.identity={...binding.identity,paymentProfile:'TASK12_ARCHIVE261_SOURCE_V1'};
 }});
 assert.equal((await f.done).status,'STOPPED');
 assert.equal(f.state.consumed,null);
 assert.deepEqual(f.state.calls,['start','technical259','payment261-roles','seven','acl','b7']);
 assert.equal(f.state.closes,1);
});

test('261 competition verification and one-shot use only their exact two-lane authority',async t=>{
 const verified=competitionFixture(t,{competition261:true,default:true});
 assert.equal((await verified.done).status,'PAYMENT261_COMPETITION_PLAN_VERIFIED_NO_RESOURCES');
 assert.equal(verified.state.exit,0);
 assert.deepEqual(verified.state.calls,[]);assert.deepEqual(fs.readdirSync(verified.s.runRoot),[]);
 const run=competitionFixture(t,{competition261:true});
 const outcome=await run.done;
 assert.equal(outcome.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(outcome));
 assert.deepEqual(run.state.calls,['start-competition','technical259','roles9-cap2','seven','acl','b7','live-two','env','app-two','competition','app-two-close','env-close','pools-two-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(run.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.scope.paymentProfile,PAYMENT261_COMPETITION_RUNTIME_PROFILE);
 assert.equal(receipt.stages[0].stage,'technical261');
 assert.equal(receipt.b7Binding.identity.paymentProfile,PAYMENT261_COMPETITION_RUNTIME_PROFILE);
 assert.equal(receipt.business.competitionObserved,true);assert.equal(receipt.financialAcceptance,false);
});

test('261 competition rejects 259, ordinary and voucher entrypoint cross-use before attempt',async t=>{
 for(const launchOption of ['--competition-once','--business261-once','--voucher-once']){
  const f=competitionFixture(t,{competition261:true,launchOption});
  assert.equal((await f.done).status,'STOPPED');
  assert.equal(f.state.exit,1);
  assert.deepEqual(f.state.calls,[]);assert.deepEqual(fs.readdirSync(f.s.runRoot),[]);
 }
 const historical=competitionFixture(t,{launchOption:'--competition261-once'});
 assert.equal((await historical.done).status,'STOPPED');
 assert.equal(historical.state.exit,1);
 assert.deepEqual(historical.state.calls,[]);assert.deepEqual(fs.readdirSync(historical.s.runRoot),[]);
});

test('261 competition cannot spend an ordinary or historical role permit or use its result',async t=>{
 for(const options of [{competitionRoleClaim:'claimCurrent259Payment261RolePermit'},
  {competitionRoleClaim:'claimCurrent259CompetitionRolePermit'},{competitionWrongRoleResult:true}]){
  const f=competitionFixture(t,{competition261:true,...options});
  assert.equal((await f.done).status,'STOPPED');
  assert.deepEqual(f.state.calls,['start-competition','technical259','roles9-cap2']);
 }
});

test('261 competition rejects ordinary B7 profile and leaves business unstarted',async t=>{
 const f=competitionFixture(t,{competition261:true,beforeConsume({binding}){
  binding.identity={...binding.identity,paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'};
 }});
 assert.equal((await f.done).status,'STOPPED');
 assert.deepEqual(f.state.calls,['start-competition','technical259','roles9-cap2','seven','acl','b7']);
});

test('261 voucher uses only its owned directory and exact competition, voucher ACL and B7 authority',async t=>{
 const offline=competitionFixture(t,{voucher261:true,default:true});
 assert.equal((await offline.done).status,'PAYMENT261_VOUCHER_PLAN_VERIFIED_NO_RESOURCES');
 assert.equal(offline.state.exit,0);
 assert.deepEqual(fs.readdirSync(offline.s.runRoot),[]);
 const run=competitionFixture(t,{voucher261:true});
 const result=await run.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(run.state.calls,['start-competition-voucher','technical259','roles9-cap2','seven','voucher-acl','b7','live-two','env','app-two','competition','app-two-close','env-close','pools-two-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(run.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.scope.paymentProfile,PAYMENT261_VOUCHER_RUNTIME_PROFILE);
 assert.equal(receipt.b7Binding.identity.paymentProfile,PAYMENT261_VOUCHER_RUNTIME_PROFILE);
 assert.equal(receipt.b7Binding.identity.voucherProfile,'CURRENT259_PAYMENT_VOUCHER_V1');
 assert.equal(receipt.business.voucherVerified,true);
 assert.equal(receipt.financialAcceptance,false);
});

test('261 attribution gap uses only its one-lane authority and one original 409 proof',async t=>{
 const offline=attributionGapFixture(t,{attributionGap261:true,default:true});
 assert.equal((await offline.done).status,'PAYMENT261_ATTRIBUTION_GAP_PLAN_VERIFIED_NO_RESOURCES');
 assert.equal(offline.state.exit,0);
 assert.deepEqual(fs.readdirSync(offline.s.runRoot),[]);
 const run=attributionGapFixture(t,{attributionGap261:true});
 const result=await run.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(run.state.calls,['start-attribution-gap','technical259','payment261-gap-roles','seven','acl','b7','live','env','app','case','app-close','env-close','pools-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(run.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.scope.paymentProfile,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE);
 assert.equal(receipt.b7Binding.identity.paymentProfile,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE);
 assert.equal(receipt.business.attributionGapEvidence.registrationStatus,409);
 assert.equal(receipt.business.attributionGapEvidence.originalResultUnconfirmed,true);
 assert.equal(receipt.financialAcceptance,false);
});

test('261 voucher and attribution gap reject other launch, role and B7 authority',async t=>{
 for(const [make,mode,wrong] of [[competitionFixture,{voucher261:true},['--voucher-once','--competition261-once','--business261-once','--attribution-gap261-once']],
  [attributionGapFixture,{attributionGap261:true},['--attribution-gap-once','--business261-once','--voucher261-once','--competition261-once']]]){
  for(const launchOption of wrong){
   const run=make(t,{...mode,launchOption});assert.equal((await run.done).status,'STOPPED');
   assert.deepEqual(run.state.calls,[]);assert.deepEqual(fs.readdirSync(run.s.runRoot),[]);
  }
 }
 const wrongVoucherRole=competitionFixture(t,{voucher261:true,competitionRoleClaim:'claimCurrent259Payment261CompetitionRolePermit'});
 assert.equal((await wrongVoucherRole.done).status,'STOPPED');
 assert.deepEqual(wrongVoucherRole.state.calls,['start-competition-voucher','technical259','roles9-cap2']);
 const wrongGapRole=attributionGapFixture(t,{attributionGap261:true,gapRoleClaim:'claimCurrent259Payment261RolePermit'});
 assert.equal((await wrongGapRole.done).status,'STOPPED');
 assert.deepEqual(wrongGapRole.state.calls,['start-attribution-gap','technical259','payment261-gap-roles']);
 for(const [make,mode,foreign] of [[competitionFixture,{voucher261:true},PAYMENT261_COMPETITION_RUNTIME_PROFILE],
  [attributionGapFixture,{attributionGap261:true},'TASK16_PAYMENT261_RUNTIME_V1']]){
  const run=make(t,{...mode,beforeConsume({binding}){binding.identity={...binding.identity,paymentProfile:foreign};}});
  assert.equal((await run.done).status,'STOPPED');assert.equal(run.state.consumed,null);
  assert.equal(run.state.calls.at(-1),'b7');
 }
});

for(const onlyPrepare of [true,false])test('follow-up261 selects its exact plan without borrowing old competition authority '+onlyPrepare,async t=>{
 const f=competitionFixture(t,{followUp261:true,default:onlyPrepare});
 const result=await f.done;
 assert.equal(result.status,onlyPrepare?'PAYMENT261_COMPETITION_FOLLOW_UP_PLAN_VERIFIED_NO_RESOURCES':'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED');
 if(onlyPrepare){assert.deepEqual(f.state.calls,[]);assert.equal(result.resourcesExecuted,false);}
 else {
  const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
  assert.equal(receipt.business.scenario,'competition-follow-up');assert.equal(receipt.business.fullyPaid,true);
  assert.equal(receipt.business.secondExecutionId,'40404040-1234-4bcd-8f12-0123456789ab');
 }
});
test('follow-up261 refuses a case that only returns the original competition result',async t=>{
 const f=competitionFixture(t,{followUp261:true,missingFollowUpResult:true});
 const result=await f.done;assert.equal(result.status,'STOPPED');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
 assert.equal(f.state.calls.includes('competition'),true);assert.notEqual(receipt.business.fullyPaid,true);
});
for(const phase of ['BEFORE_CHECK','TARGET','FETCH','BODY','AFTER_CHECK','RESPONSE_RETURNED','private phase']){
 test('ordinary seed receipt retains only the fixed HTTP boundary '+phase,async t=>{
  const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease}){
   lease.recordCaseFailure('SEED_LOGIN','HTTP_CONNECTION_REFUSED',undefined,phase);
   lease.recordCaseFailure('SEED_LOGIN','P2028',500,'FETCH');
  },caseFailure:new Error('private request')});
  await f.done;
  const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8');
  const receipt=JSON.parse(text);
  assert.deepEqual(receipt.paymentCaseFailure,{stage:'SEED_LOGIN',code:'HTTP_CONNECTION_REFUSED',
   ...(phase==='private phase'?{}:{httpPhase:phase})});
  assert.doesNotMatch(text,/private (?:phase|request)/u);
 });
}

test('selected-case native timeout keeps its fixed body boundary and unknown business outcome',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease}){
  lease.recordCaseFailure('SELECTED_CASE','TIMEOUT',undefined,'BODY');
 },caseFailure:new Error('private native response')});
 await f.done;
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',code:'TIMEOUT',httpPhase:'BODY'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
 assert.equal(receipt.business.permission,'CONSUMED_ONCE');
});

test('normal261 issuer passes the identical sealed effective plan to the business permit',async t=>{
 let permitBinding;
 const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease,application}){
  permitBinding=lease.effectiveAccessBinding;
  assert.deepEqual(permitBinding,application.sourceBinding.effectiveAccessBinding);
  assert.ok(Object.isFrozen(permitBinding));
 }}),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json')));
 assert.deepEqual(receipt.effectiveAccessBinding,permitBinding);
});
for(const mode of ['missing','hash','profile','count'])test('normal261 issuer rejects '+mode+' application plan before business entry',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{applicationBinding(binding){return mode==='missing'?undefined:{...binding,...(mode==='hash'?{accessPlanSha256:'0'.repeat(64)}:mode==='profile'?{paymentProfile:'TASK12_ARCHIVE261_SOURCE_V1'}:{insertAdditionCount:8})};}}),result=await f.done;
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_BUSINESS_APPLICATION',JSON.stringify(result));
 assert.equal(f.state.calls.includes('case'),false);
});

test('normal receipt latches the first approved guard diagnostic without arbitrary error data',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease}){
  lease.recordCaseFailure('SEED_LOGIN','TASK16_APP_IMPACT_READER_PROOF',503,'AFTER_CHECK',
   {guardPhase:'RESOURCE_VIEW_SOURCE_METHODS',originCode:'CURRENT259_RESOURCE_CLOSED',message:'private SQL URL token'});
  lease.recordCaseFailure('SEED_LOGIN','P2028',500,'FETCH',{guardPhase:'APP_METHOD_IDENTITY',originCode:'P2028'});
 },caseFailure:new Error('private first failure')});
 await f.done;const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SEED_LOGIN',code:'TASK16_APP_IMPACT_READER_PROOF',httpStatus:503,httpPhase:'AFTER_CHECK',guardPhase:'RESOURCE_VIEW_SOURCE_METHODS',originCode:'CURRENT259_RESOURCE_CLOSED'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.doesNotMatch(text,/private|SQL URL token/u);
});

for(const kind of ['unknown','getters','proxy'])test('receipt diagnostics refuse '+kind+' data without evaluating private values',async t=>{
 let traps=0;
 const diagnostic=kind==='unknown'?{guardPhase:'private phase',originCode:'private credential SQL URL',stack:'private stack',body:'private body'}:
  kind==='proxy'?new Proxy({},{get(){traps++;throw Error('private proxy');},getOwnPropertyDescriptor(){traps++;throw Error('private proxy');}}):
  Object.defineProperties({},{guardPhase:{get(){traps++;throw Error('private phase getter');}},originCode:{get(){traps++;throw Error('private code getter');}}});
 const f=ordinaryBusinessFailureFixture(t,{onBusiness({lease}){
  lease.recordCaseFailure('SEED_LOGIN','TASK16_APP_IMPACT_READER_PROOF',503,'AFTER_CHECK',diagnostic);
 },caseFailure:new Error('private outer')});
 await f.done;const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SEED_LOGIN',code:'TASK16_APP_IMPACT_READER_PROOF',httpStatus:503,httpPhase:'AFTER_CHECK'});
 assert.equal(traps,0);assert.doesNotMatch(text,/private|credential|SQL URL/u);
});

for(const [name,extra,code] of [
 ['postcheck',{afterConsumeFailure:Object.assign(new Error('private postcheck'),{code:'CURRENT259_BUILD_CHANGED'})},'CURRENT259_BUILD_CHANGED'],
 ['cleanup',{cleanupFailure:true},'CURRENT259_RESOURCE_CLEANUP_UNKNOWN']
])test('business primary survives '+name+' failure with a separate safe secondary',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{...extra,onBusiness({lease}){
  lease.recordCaseFailure('SELECTED_CASE','P2028',undefined,'BODY');
 },caseFailure:Object.assign(new Error('private business SQL URL'),{code:'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT'})});
 const result=await f.done, text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT');
 assert.equal(receipt.failureStage,'seedAndSelectedCase');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',code:'P2028',httpPhase:'BODY'});
 assert.deepEqual(receipt.secondaryFailures,[{boundary:'RESOURCE_SCOPE',stage:'seedAndSelectedCase',code}]);
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
 assert.equal(receipt.business.permission,'CONSUMED_ONCE');
 assert.equal(receipt.resource.cleanup.status,name==='cleanup'?'UNKNOWN':'completed');
 assert.doesNotMatch(text,/private|SQL URL/u);
});
test('a returned case followed by qualification failure remains unknown without replay',async t=>{
 let returned=false;
 const f=ordinaryBusinessFailureFixture(t,{afterCaseResult(){returned=true;},onCheck(){
  if(returned)throw Object.assign(new Error('private qualification'),{code:'CURRENT259_BUILD_CHANGED'});
 }});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'CURRENT259_BUILD_CHANGED');
 assert.equal(f.state.calls.filter(x=>x==='case').length,1);
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
 assert.equal(receipt.business.permission,'CONSUMED_ONCE');
 assert.equal(receipt.failureStage,'seedAndSelectedCase');
});

test('optional progress directory exposes a bound safe stage while the current phase is still running',async t=>{
 let release,entered;
 const blocked=new Promise(resolve=>{release=resolve;}),starting=new Promise(resolve=>{entered=resolve;});
 const f=fixture(t,{progress:true,async onTechnical(){entered();await blocked;}});
 t.after(async()=>{release();await f.done;});
 await Promise.race([starting,f.done.then(result=>assert.fail('phase not reached: '+result.failureCode))]);
 const names=fs.readdirSync(f.state.progressRoot).sort(),rows=names.map(name=>JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,name),'utf8')));
 assert.deepEqual(rows.map(row=>row.phase),['preflight','resourceStartup','technical259']);
 assert.ok(!fs.existsSync(path.join(f.s.runRoot,'receipt.json')));
 for(const [index,row] of rows.entries()){
  assert.equal(row.sequence,index+1);assert.equal(row.expectedCandidateSha,'a'.repeat(40));assert.equal(row.planSha256,f.saved.sha256);
  assert.equal(row.event,'PHASE');assert.equal(row.executionAllowed,false);assert.equal(row.financialAcceptance,false);
  assert.ok(Number.isSafeInteger(row.elapsedMs)&&row.elapsedMs>=0);
 }
 assert.equal(rows.at(-1).resource.containerId,'7'.repeat(64));
 assert.equal(rows.at(-1).resource.runId,'01234567-89ab-cdef-0123-456789abcdef');
 assert.equal(rows.at(-1).checks.planVerification.count,1);
 assert.ok(rows.at(-1).checks.planCheck.count>=1);
 assert.ok(rows.at(-1).checks.resourceCheck.count>=1);
 release();assert.equal((await f.done).status,'PAYMENT_INSTALL_AND_OWNED_CLEANUP_VERIFIED');
 const all=fs.readdirSync(f.state.progressRoot).sort().map(name=>JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,name),'utf8')));
 assert.equal(all.at(-1).event,'FINALIZATION');assert.equal(all.at(-1).receiptPublished,false);
 assert.equal(all.at(-1).cleanup.status,'completed');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.deepEqual(all.at(-1).checks,receipt.timing.checks);
 assert.equal(f.state.output.trim().split('\n').length,1);
});
test('progress never adopts or overwrites an occupied evidence directory',async t=>{
 const f=fixture(t,{progress:true,progressSetup(root){fs.writeFileSync(path.join(root,'existing.json'),'untouched');}});
 const result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_PROGRESS_ROOT');
 assert.deepEqual(f.state.calls,[]);assert.equal(fs.readFileSync(path.join(f.state.progressRoot,'existing.json'),'utf8'),'untouched');
});
test('progress publication failure remains secondary to the business primary and does not retry',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{progress:true,onBusiness({lease}){
  lease.recordCaseFailure('SELECTED_CASE','P2028',undefined,'BODY');
  fs.chmodSync(f.state.progressRoot,0o500);
 },caseFailure:Object.assign(new Error('private primary'),{code:'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT'})});
 let result;try{result=await f.done;}finally{fs.chmodSync(f.state.progressRoot,0o700);}
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT');
 assert.ok(receipt.secondaryFailures.some(row=>row.boundary==='PROGRESS_PUBLICATION'&&row.code==='PAYMENT_INSTALL_ONCE_PROGRESS_WRITE'));
 assert.equal(f.state.calls.filter(x=>x==='case').length,1);assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
 assert.doesNotMatch(JSON.stringify(receipt),/private primary/u);
});

test('progress evidence refuses a symlink directory and leaves its target untouched',async t=>{
 const f=fixture(t,{progress:true,progressSetup(root){fs.renameSync(root,root+'-target');fs.symlinkSync(root+'-target',root);}});
 const result=await f.done;
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_PROGRESS_ROOT');assert.deepEqual(f.state.calls,[]);
 assert.deepEqual(fs.readdirSync(f.state.progressRoot+'-target'),[]);
});
test('progress evidence does not overwrite a conflicting next phase file',async t=>{
 const f=fixture(t,{progress:true,onTechnical(state){
  fs.writeFileSync(path.join(state.progressRoot,'004-roles9.json'),'existing private evidence',{mode:0o600});
 }});
 const result=await f.done;
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_PROGRESS_WRITE');
 assert.deepEqual(f.state.calls,['start','technical259']);assert.equal(f.state.closes,1);
 assert.equal(fs.readFileSync(path.join(f.state.progressRoot,'004-roles9.json'),'utf8'),'existing private evidence');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.resource.cleanup.status,'completed');assert.doesNotMatch(JSON.stringify(receipt),/existing private evidence/u);
});
test('verification-only CLI cannot write progress or consume a marker',async t=>{
 const f=fixture(t,{progress:true,default:true}),result=await f.done;
 assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_ARGUMENTS');assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);assert.deepEqual(fs.readdirSync(f.state.progressRoot),[]);
});

test('secondary diagnostics do not accept arbitrary known-family suffixes or private detail',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{progress:true,
  afterConsumeFailure:Object.assign(new Error('private URL SQL'),{code:'CURRENT259_RESOURCE_PRIVATE_SQL_PASSWORD'}),
  caseFailure:Object.assign(new Error('private primary'),{code:'PAYMENT_INSTALL_ONCE_BUSINESS_RESULT'})});
 await f.done;
 const text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.deepEqual(receipt.secondaryFailures,[{boundary:'RESOURCE_SCOPE',stage:'seedAndSelectedCase',code:'PAYMENT_INSTALL_ONCE_FAILED_CLOSED'}]);
 const progress=fs.readdirSync(f.state.progressRoot).map(name=>fs.readFileSync(path.join(f.state.progressRoot,name),'utf8')).join('');
 assert.doesNotMatch(text+progress,/PRIVATE_SQL_PASSWORD|private URL SQL|private primary/u);
});

test('late HTTP context after the original continuity throw enriches its primary without replacing it',async t=>{
 let failContinuity=false;
 const original=Object.assign(new Error('private original continuity'),{code:'CURRENT259_LOADER_CHANGED'});
 const f=ordinaryBusinessFailureFixture(t,{progress:true,onCheck(){if(failContinuity)throw original;},onBusiness({lease}){
  failContinuity=true;
  let caught;try{lease.check();}catch(error){caught=error;}
  assert.equal(caught,original);
  lease.recordCaseFailure('SEED_LOGIN','TASK16_APP_IMPACT_READER_PROOF',201,'AFTER_CHECK',
   {guardPhase:'LIVE_SESSION_CONTINUITY',originCode:'CURRENT259_LOADER_CHANGED'});
  lease.recordCaseFailure('SELECTED_CASE','P2028',503,'FETCH',{guardPhase:'APP_METHOD_IDENTITY'});
  throw caught;
 }});
 const result=await f.done,text=fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(result.failureCode,'CURRENT259_LOADER_CHANGED');assert.equal(receipt.failureStage,'seedAndSelectedCase');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SEED_LOGIN',code:'TASK16_APP_IMPACT_READER_PROOF',httpStatus:201,
  httpPhase:'AFTER_CHECK',guardPhase:'LIVE_SESSION_CONTINUITY',originCode:'CURRENT259_LOADER_CHANGED'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.business.permission,'CONSUMED_ONCE');
 assert.equal(receipt.timing.resourceAbort.origin,'CONTINUITY_REVOKED');
 assert.equal(receipt.timing.stages.at(-1).stage,'seedAndSelectedCase');
 assert.ok(receipt.secondaryFailures.some(row=>row.code==='PAYMENT_INSTALL_ONCE_ABORTED_UNSETTLED'));
 const latest=fs.readdirSync(f.state.progressRoot).sort().at(-1);
 const durable=JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,latest),'utf8'));
 assert.deepEqual(durable.paymentCaseFailure,receipt.paymentCaseFailure);
 assert.equal(durable.failureCode,'CURRENT259_LOADER_CHANGED');
 assert.doesNotMatch(text,/private original continuity/u);
});


test('CLI persists a safe application checkpoint before the application has returned',async t=>{
 let release,entered;const pending=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const f=ordinaryBusinessFailureFixture(t,{progress:true,async onApplicationPhase(report){
  assert.equal(typeof report,'function');report('NEST_COMPILE');entered();await pending;
 }});
 t.after(async()=>{release();await f.done;});
 await Promise.race([ready,f.done.then(result=>assert.fail('application not reached: '+result.failureCode))]);
 const latest=fs.readdirSync(f.state.progressRoot).sort().at(-1),row=JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,latest),'utf8'));
 assert.equal(row.event,'APPLICATION_CHECKPOINT');assert.equal(row.phase,'ownedApplication');assert.equal(row.applicationPhase,'NEST_COMPILE');
 assert.equal(row.businessOutcome,'NOT_ENTERED');assert.equal(row.receiptPublished,false);assert.equal(row.nativeAdmission,false);
 assert.ok(Number.isSafeInteger(row.elapsedMs));assert.ok(!fs.existsSync(path.join(f.s.runRoot,'receipt.json')));release();await f.done;
});


test('application checkpoint rejects foreign phase detail without persisting it',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{progress:true,onApplicationPhase(report){report('private SQL password');}});
 const result=await f.done;assert.equal(result.status,'STOPPED');assert.equal(result.failureCode,'PAYMENT_INSTALL_ONCE_PROGRESS_WRITE');
 const text=fs.readdirSync(f.state.progressRoot).map(name=>fs.readFileSync(path.join(f.state.progressRoot,name),'utf8')).join('');
 assert.doesNotMatch(text,/private SQL password/);assert.equal(f.state.calls.includes('case'),false);assert.equal(f.state.closes,1);
});


for(const secondary of ['post-check','cleanup'])test('selected fixed assertion code survives '+secondary+' failure without reading a private message',async t=>{
 const primary=Object.defineProperty(new Error('private SQL token'), 'code', {value:'PG_CASE_BEFORE_STATE'});
 const f=ordinaryBusinessFailureFixture(t,{progress:true,caseFailure:primary,
  onBusiness({lease}){lease.recordCaseFailure('SELECTED_CASE',primary.code);},
  ...(secondary==='cleanup'?{cleanupFailure:true}:{afterConsumeFailure:Object.assign(new Error('private post-check'),{code:'CURRENT259_BUILD_CHANGED'})})});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,'STOPPED');assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',code:'PG_CASE_BEFORE_STATE'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(f.state.calls.filter(x=>x==='case').length,1);
 assert.ok(receipt.secondaryFailures.length>0);assert.doesNotMatch(JSON.stringify(receipt),/private SQL token|private post-check/);
});


test('selected failure projection ignores foreign message getters and undeclared case codes',async t=>{
 for(const code of [undefined,'PG_CASE_UNDECLARED_PRIVATE_SQL']){
  let reads=0;const primary=Object.create(null);
  Object.defineProperty(primary,'message',{get(){reads++;throw Error('private message getter');}});
  if(code)Object.defineProperty(primary,'code',{value:code});
  const f=ordinaryBusinessFailureFixture(t,{caseFailure:primary,onBusiness({lease}){lease.recordCaseFailure('SELECTED_CASE',code);}});
  const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
  assert.equal(result.status,'STOPPED');assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE'});
  assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(reads,0);
  assert.doesNotMatch(JSON.stringify(receipt),/PG_CASE_UNDECLARED_PRIVATE_SQL|private message getter/);
 }
});


test('both fixed assertion producers are covered by the public diagnostic code contract',()=>{
 const ts=require('typescript'),{isPaymentFailureCode}=require('./task16-current259-payment-diagnostics.cjs');
 const missing=[],dynamic=[];
 for(const [name,callee]of [['registered-payment-postgres.cases.ts','check'],['registered-payment-postgres.fixture.ts','requireCondition']]){
  const source=ts.createSourceFile(name,fs.readFileSync(path.join(ROOT,'services/api/src/database',name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let assertions=0;
  function visit(node){
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===callee){
    assertions++;const code=node.arguments[1];
    if(!code||!ts.isStringLiteralLike(code))dynamic.push(name+':'+source.getLineAndCharacterOfPosition(node.getStart()).line);
    else if(!isPaymentFailureCode(code.text))missing.push(code.text);
   }
   ts.forEachChild(node,visit);
  }
  visit(source);assert.ok(assertions>0,'assertion producer must remain present');
 }
 assert.deepEqual(dynamic,[],'producer reason codes must remain static literals');
 assert.deepEqual(missing.sort(),[],'all existing producer literals must survive consumer projection');
 assert.equal(isPaymentFailureCode('PG_CASE_RESPONSE_LOST_AFTER_UPSTREAM_HEADERS'),false);
 assert.equal(isPaymentFailureCode('PG_FIXTURE_PRIVATE_SQL_PASSWORD'),false);
});

for(const [stage,code]of [['SEED_PREPARE','PG_FIXTURE_INPUT'],['SEED_PREPARE','PG_FIXTURE_SEED_PROFILE'],['SELECTED_CASE','PG_RESOURCE_SOURCE_SEAL'],['SELECTED_CASE','PG_COMPETITION_BEFORE']])
 test('CLI retains the source assertion literal '+code,async t=>{
  const primary=Object.defineProperty(new Error('private source payload'),'code',{value:code});
  const f=ordinaryBusinessFailureFixture(t,{caseFailure:primary,onBusiness({lease}){lease.recordCaseFailure(stage,code);}});
  const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
  assert.equal(result.status,'STOPPED');assert.deepEqual(receipt.paymentCaseFailure,{stage,code});
  assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');
  assert.doesNotMatch(JSON.stringify(receipt),/private source payload/);
 });

for(const secondary of ['postcheck','cleanup'])test('selected error category and gate survive '+secondary+' as fixed first-cause context',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{progress:true,caseFailure:new TypeError('private source payload'),
  ...(secondary==='cleanup'?{cleanupFailure:true}:{afterConsumeFailure:Object.assign(new Error('private postcheck'),{code:'CURRENT259_BUILD_CHANGED'})}),
  onBusiness({lease}){lease.recordCaseFailure('SELECTED_CASE',undefined,undefined,undefined,{caseGate:'OBSERVER_BEFORE',errorKind:'TYPE_ERROR'});}});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,'STOPPED');assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',caseGate:'OBSERVER_BEFORE',errorKind:'TYPE_ERROR'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.ok(receipt.secondaryFailures.length>=1);
 const latest=fs.readdirSync(f.state.progressRoot).sort().at(-1),row=JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,latest),'utf8'));
 assert.deepEqual(row.paymentCaseFailure,receipt.paymentCaseFailure);assert.doesNotMatch(JSON.stringify(receipt),/private source payload|private postcheck/);
});
test('selected gate and error category projection refuses unknown text and getters',async t=>{
 for(const getter of [false,true]){
  let reads=0;const diagnostic=getter?Object.defineProperties({},Object.fromEntries(['caseGate','errorKind','seedGate'].map(key=>[key,{get(){reads++;throw Error('private getter');}}]))):{caseGate:'private path',errorKind:'private exception',seedGate:'OPENING_A_REQUEST_PRIVATE_SUFFIX'};
  const f=ordinaryBusinessFailureFixture(t,{caseFailure:new Error('private cause'),onBusiness({lease}){lease.recordCaseFailure('SELECTED_CASE',undefined,undefined,undefined,diagnostic);}});
  await f.done;const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
  assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE'});assert.equal(reads,0);
  assert.doesNotMatch(JSON.stringify(receipt),/private path|private exception|private getter|PRIVATE_SUFFIX/);
 }
});


for(const secondary of ['postcheck','cleanup'])test('seed opening gate and network cause survive '+secondary+' without replay',async t=>{
 const f=ordinaryBusinessFailureFixture(t,{progress:true,caseFailure:new TypeError('private seed payload'),
  ...(secondary==='cleanup'?{cleanupFailure:true}:{afterConsumeFailure:Object.assign(new Error('private postcheck'),{code:'CURRENT259_BUILD_CHANGED'})}),
  onBusiness({lease}){lease.recordCaseFailure('SEED_OPENING','HTTP_CONNECTION_RESET',undefined,'FETCH',{seedGate:'OPENING_B_REQUEST',errorKind:'TYPE_ERROR'});}});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(result.status,'STOPPED');assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');
 assert.deepEqual(receipt.paymentCaseFailure,{stage:'SEED_OPENING',code:'HTTP_CONNECTION_RESET',httpPhase:'FETCH',seedGate:'OPENING_B_REQUEST',errorKind:'TYPE_ERROR'});
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.ok(receipt.secondaryFailures.length>=1);
 const latest=fs.readdirSync(f.state.progressRoot).sort().at(-1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,latest),'utf8')).paymentCaseFailure,receipt.paymentCaseFailure);
 assert.doesNotMatch(JSON.stringify(receipt),/private seed payload|private postcheck/);
});

for(const secondary of ['postcheck','cleanup'])test('observer diagnostic timing and native Prisma context survive '+secondary+' in public CLI receipt',async t=>{
 const diagnostic={caseGate:'OBSERVER_BEFORE',errorKind:'OTHER_NATIVE_ERROR',prismaErrorClass:'KNOWN_REQUEST_ERROR',prismaCode:'P2028',sqlState:'42501',observerPhase:'PAYMENT_REQUEST',observerElapsedMs:6006,txElapsedMs:6001,lightCalls:4,lightElapsedMs:6000,queryElapsedMs:1};
 const f=ordinaryBusinessFailureFixture(t,{progress:true,caseFailure:Object.assign(new Error('private cause'),{code:'P2028'}),...(secondary==='cleanup'?{cleanupFailure:true}:{afterConsumeFailure:Object.assign(new Error('private postcheck'),{code:'CURRENT259_BUILD_CHANGED'})}),onBusiness({lease}){lease.recordCaseFailure('SELECTED_CASE','P2028',undefined,undefined,diagnostic);}});
 const result=await f.done,receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));assert.equal(result.status,'STOPPED');assert.equal(receipt.failureCode,'PAYMENT_INSTALL_ONCE_FAILED_CLOSED');assert.deepEqual(receipt.paymentCaseFailure,{stage:'SELECTED_CASE',code:'P2028',...diagnostic});assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.ok(receipt.secondaryFailures.length>=1);
 const latest=fs.readdirSync(f.state.progressRoot).sort().at(-1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.state.progressRoot,latest),'utf8')).paymentCaseFailure,receipt.paymentCaseFailure);assert.doesNotMatch(JSON.stringify(receipt),/private cause|private postcheck/);
});
