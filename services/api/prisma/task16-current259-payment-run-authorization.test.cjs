'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const file=path.join(__dirname,'task16-current259-payment-run-authorization.cjs'),ROOT=path.resolve(__dirname,'../../..');
const noop=()=>{};
function planFixture(t){
 const p=path.join(ROOT,'scripts/prepare-task16-current259-payment-install.test.cjs'),module={exports:{}},rq=Module.createRequire(p);
 new Function('require','module','__dirname',fs.readFileSync(p,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),module,path.dirname(p));
 return module.exports.fixture(t);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,options={}){
 const s=options.planFixture??planFixture(t),saved=options.saved??s.api.prepareCurrent259PaymentInstallPlan({runRoot:s.runRoot,daemonId:s.daemonId,output:s.output});
 const state={calls:[],output:'',closes:0,signals:{},consumed:null},handle=Object.freeze({});
 let manifest,signal,finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const source=s.loader.witness().source;
 const identity={database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'16384',namespaceOid:'2200',ownerOid:'10',systemIdentifier:'123456789'};
 const technical=Object.freeze({status:'CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:'01234567-89ab-cdef-0123-456789abcdef',containerId:'7'.repeat(64),database:identity.database,databaseIdentity:identity});
 const names=['jg_c259_outside_executor_login','jg_c259_outside_executor_owner','jg_c259_outside_issuer_login','jg_c259_outside_issuer_owner','jg_c259_upward_issuer_login','jg_c259_upward_issuer_owner','jg_c259_upward_runtime_login','jg_task01_observer','jg_task01_runtime'];
 const roles=Object.freeze({...technical,status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',roles:names.map((name,i)=>({name,oid:String(200+i)})),commitXid:'1000'});
 const seven=Object.freeze({sourceSha:source.candidateSha,runId:technical.runId,installXid:'1100'});
 const acl=Object.freeze({status:'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:technical.runId,installXid:'1200'});
 const scopeIdentity={runId:technical.runId,...identity,runtimeOid:'208',observerOid:'207'};
 const module={exports:{},filename:file};const cache={[file]:module};
 const check=()=>{assert.ok(!signal?.aborted);options.onCheck?.();};
 const view={source,runId:technical.runId,resource:{containerId:technical.containerId,databaseName:identity.database,getReceipt(){return JSON.parse(JSON.stringify(manifest));}},check,checkLifetime:check,verifyFull:check};
 const ports={
  './task16-current259-b7-install.cjs':{async installCurrent259B7(value,h,permit){
   state.calls.push('b7');assert.equal(value,acl);assert.equal(h,handle);
   const authority=module.exports.claimCurrent259B7WritePermit(permit,h,value);
   const beforeSql=require('./task16-current259-catalog.cjs').renderCurrent259CatalogRead({source:s.rawSource,identity:scopeIdentity,phase:'before',nonce:'d'.repeat(64)});
   const binding={scope:'CURRENT259_DOCKER_B7_INSTALL',planSha256:saved.sha256,sourceSha:source.candidateSha,sourceSealSha256:source.sourceSealSha256,runId:technical.runId,containerId:technical.containerId,aclXid:acl.installXid,nonce:'d'.repeat(64),identity:scopeIdentity,beforeCatalogSha256:'c'.repeat(64),beforeSqlSha256:hash(beforeSql),installSqlSha256:'e'.repeat(64)};
   options.beforeConsume?.({api:module.exports,permit,h,value,binding,authority});
   assert.equal(authority.consumeWrite(Object.freeze(binding)),true);state.consumed=binding;
   assert.equal(authority.check(),true);
   return Object.freeze({status:'CURRENT259_B7_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:technical.runId,installXid:'1300',readerOid:'3000',planSha256:saved.sha256,installSqlSha256:binding.installSqlSha256,bodySha256:'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20'});
  }},
  './local-staged-current259-profile.cjs':{createCurrent259TechnicalMigration(h,provided){
   assert.equal(h,handle);assert.equal(provided,signal);return {async migrate(){state.calls.push('technical259');if(Object.hasOwn(options,'technicalFailure'))throw options.technicalFailure;await options.onTechnical?.(state);return technical;}};
  }},
  './task16-current259-role-provision.cjs':{async provisionCurrent259Roles(value,h){state.calls.push('roles9');assert.equal(value,technical);assert.equal(h,handle);return roles;}},
  './task16-current259-seven-install.cjs':{async installCurrent259SevenFragments(value,h){state.calls.push('seven');assert.equal(value,roles);assert.equal(h,handle);return seven;}},
  './task16-current259-payment-acl-install.cjs':{async installCurrent259PaymentAcl(value,h){state.calls.push('acl');assert.equal(value,seven);assert.equal(h,handle);return acl;}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},async closeCurrent259OwnedResource(){state.closes++;},
   async withCurrent259TechnicalResource(build,plan,sig,consume){
    assert.equal(build,s.handle);assert.ok(fs.existsSync(path.join(s.runRoot,'attempt.json')));state.calls.push('start');signal=sig;
    fs.mkdirSync(plan.artifactsDir,{mode:0o700});
    manifest={runId:technical.runId,sourceSha:source.candidateSha,daemonId:s.daemonId,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',containerId:technical.containerId,networkId:'8'.repeat(64),databaseName:identity.database,port:32456,status:'started-awaiting-driver-verification',cleanup:{status:'pending'}};
    const finishResource=()=>{
     state.closes++;
     manifest.status=options.cleanupFailure?'cleanup_failed':'closed';manifest.cleanup={status:options.cleanupFailure?'failed':'completed',containerAbsent:!options.cleanupFailure,volumesAbsent:!options.cleanupFailure,networkAbsent:!options.cleanupFailure};
     fs.writeFileSync(path.join(plan.artifactsDir,'resource-manifest.json'),JSON.stringify(manifest),{mode:0o600});
     if(options.cleanupFailure)throw Object.assign(new Error('SECRET_SQL_PASSWORD'),{code:'CURRENT259_RESOURCE_CLEANUP_UNKNOWN'});
    };
    try{return await consume(handle);}finally{finishResource();}
   }},
  '../../../scripts/prepare-task16-current259-payment-install.cjs':s.api
 };
 if(options.businessApi)ports['../../../scripts/prepare-task16-current259-payment-business.cjs']=options.businessApi;
 if(options.business){
  ports['./task16-current259-business-continuity.cjs']={captureCurrent259BusinessIssuer(){}};
  state.replaceBusinessLive=()=>{ports['./task16-current259-live-sessions.cjs'].withCurrent259LiveSessions=async()=>{state.calls.push('foreign-live');};};
  const liveProof=Object.freeze({}),application=Object.freeze({runtime:Object.freeze({}),inspect(){return {runtime:this.runtime};}});
  ports['./task16-current259-live-sessions.cjs']={async withCurrent259LiveSessions(b7,h,consume){assert.equal(h,handle);assert.equal(b7.installXid,'1300');state.calls.push('live');try{return await consume(liveProof);}finally{state.calls.push('pools-close');}}};
  ports['./task16-current259-application-environment.cjs']={async withCurrent259ApplicationEnvironment(h,consume){assert.equal(h,handle);state.calls.push('env');try{return await consume({check});}finally{state.calls.push('env-close');}}};
  ports['./task16-current259-application-factory.cjs']={async withCurrent259OwnedApplication(proof,h,sig,consume){assert.equal(proof,liveProof);assert.equal(h,handle);assert.equal(sig,signal);state.calls.push('app');try{return await consume(application);}finally{state.calls.push('app-close');}}};
  ports['./task16-current259-payment-case.cjs']={async runCurrent259PaymentCase(app,h,permit){
   state.calls.push('case');assert.equal(app,application);assert.equal(h,handle);
   const lease=module.exports.claimCurrent259PaymentBusinessPermit(permit,app,h);lease.check();
   assert.equal(lease.scope.scenario,options.scenario??'normal');assert.ok(lease.scope.authorizationReference.includes(saved.sha256));
   options.onBusiness?.({api:module.exports,permit,application,handle,lease,s});
   if(Object.hasOwn(options,'caseFailure'))throw options.caseFailure;
   lease.check();return {caseId:lease.scope.caseId,passed:true,executionId:'public-execution',rootId:'public-root'};
  }};
 }

 const rq=name=>{
  if(!name.startsWith('.'))return require(name);
  const resolved=path.resolve(__dirname,name);
  if(!cache[resolved])cache[resolved]={exports:ports[name]??require(name),filename:resolved};
  return cache[resolved].exports;
 };rq.resolve=name=>path.resolve(__dirname,name);rq.main=options.imported?{}:module;rq.cache=cache;
 const proc={argv:['node',file,...(options.business?[options.default?'--business':'--business-once']:options.default?[]:['--once']),'--plan',options.planFile??s.output,'--expected-plan-sha256',saved.sha256],execArgv:[],_preload_modules:[],env:{},getuid:process.getuid,
  stdout:{write(value,callback){state.output+=value;callback?.();finish(JSON.parse(value));}},once(name,fn){state.signals[name]=fn;},removeListener(name){delete state.signals[name];},exit(){},exitCode:0};
 if(options.stale)s.state.stale=true;
 new Function('require','module','__dirname','__filename','process',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(rq,module,__dirname,file,proc);
 return {api:module.exports,done,state,s,saved,handle,acl};
}
test('default verifies a fixed payment install plan without consuming an attempt or resource',async t=>{
 const f=fixture(t,{default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_INSTALL_PLAN_VERIFIED_NO_RESOURCES',JSON.stringify(result));assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
 assert.deepEqual(Object.keys(f.api),['claimCurrent259B7WritePermit','claimCurrent259PaymentBusinessPermit','assertCurrent259PaymentBusinessContinuity']);
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
 assert.deepEqual(Object.keys(f.api),['claimCurrent259B7WritePermit','claimCurrent259PaymentBusinessPermit','assertCurrent259PaymentBusinessContinuity']);
 assert.throws(()=>f.api.claimCurrent259B7WritePermit({native:true},f.handle,f.acl));
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
 for(const [name,keys]of [
  ['task16-current259-b7-install',['installCurrent259B7']],
  ['local-staged-current259-profile',['createCurrent259TechnicalMigration']],
  ['task16-current259-role-provision',['provisionCurrent259Roles']],
  ['task16-current259-seven-install',['installCurrent259SevenFragments']],
  ['task16-current259-payment-acl-install',['installCurrent259PaymentAcl']],
  ['task16-current259-owned-resource',['withCurrent259TechnicalResource','claimCurrent259TechnicalResource']],
  ['task16-current259-catalog',['renderCurrent259CatalogRead']],
  ['task16-runtime-inputs',['readQualifiedTask16File']]
 ])write('services/api/prisma/'+name+'.cjs','module.exports=Object.freeze({'+keys.map(key=>key+':()=>{throw new Error("resource calls forbidden in default model");}').join(',')+'});');
 write('scripts/prepare-task16-current259-payment-install.cjs',`
 require('../services/api/prisma/task16-current259-payment-run-authorization.cjs');
 const plan={material:{source:{candidateSha:'${'a'.repeat(40)}'}}};
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
