'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const noop=()=>{};noop.test=noop;
const holder={exports:{}};
const runtimeModel=new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-impact-runtime.test.cjs'),'utf8')+'\nreturn module.exports;')(
 name=>name==='node:test'?{test:noop}:name==='./run-task16-registered-pg-local.cjs'?{}:require(name),holder,__dirname);
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
function fixture(t,options={}){
 const model=runtimeModel.fixture(),session=model.session,calls=[],proof=Object.freeze({}),handle=Object.freeze({});
 const directory=fs.mkdtempSync('/private/tmp/jg-259-owned-app-model-');fs.chmodSync(directory,0o700);
 const storage=path.join(directory,'storage');fs.mkdirSync(storage,{mode:0o700});
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const environment={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:storage,
  JWT_ACCESS_SECRET:'1'.repeat(64),JWT_REFRESH_SECRET:'2'.repeat(64),FILE_DOWNLOAD_SECRET:'3'.repeat(64)};
 const prior=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
 for(const [key,value]of Object.entries(environment))process.env[key]=value;
 t.after(()=>{for(const [key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 let claimed=false,sessionActive=true,resourceActive=true,resourceCloses=0,reader;
 if(options.retirement)session.disconnectOriginal=true;
 session.checkLight=()=>{assert.ok(sessionActive&&resourceActive);};
 session.close=async()=>{calls.push('sessions-close');sessionActive=false;};
 session.verifyFull=async()=>{session.checkLight();calls.push('sessions-full');await options.onFull?.();};
 const providers=new Map(),token=Symbol('actual registered impact'),serverReads=[0,0],providerReads=[0,0];
 const secondProof=Object.freeze({}),pair=Object.freeze([proof,secondProof]);
 const bundle={Task16RegisteredApplicationModule:class {},PrismaService:class {},
  configureApiSecurity(){calls.push('security');},configureProjectionExportJson(){calls.push('projection');},apiJsonReplacer(){},
  createApiValidationPipe(){return 'validation';},async listenApi(_app,port,host){calls.push('listen');assert.equal(port,0);assert.equal(host,'127.0.0.1');},
  Task16ImpactReaderToken:token};
 function framework(lane,entries){
  const server={listening:true,address(){return this.listening?{address:'127.0.0.1',family:'IPv4',port:52124+lane}:null;}};
  const app={async close(){calls.push('app-close');await options.onClose?.(lane);if(options.retirement&&!options.stillListening)server.listening=false;},get(key){providerReads[lane]++;return entries.get(key);},
   getHttpAdapter(){return {getInstance(){return {set(){calls.push('json');}};}};},
   enableCors(){calls.push('cors');},useGlobalPipes(){calls.push('validation');},
   async init(){calls.push('init');await options.onInit?.();},
   getHttpServer(){serverReads[lane]++;return server;}};
  const moduleHandle={async close(){calls.push('module-close');},get(key){return entries.get(key);},createNestApplication(){calls.push('create-app');return app;}};
  const builder={overrideProvider(key){calls.push('override');return {useValue(value){entries.set(key,value);if(key===token)reader=value;return builder;}};},async compile(){calls.push('compile');await options.onCompile?.();return moduleHandle;}};
  return {builder,server,entries};
 }
 const firstApp=framework(0,providers),secondApp=framework(1,new Map());
 const otherSession={...session,runtime:options.competitionModule||options.retirement?runtimeModel.fixture().session.runtime:null,competitionLane:'b',
  ...(options.retirement?{disconnectOriginal:false,disconnectReplacement:true}:{})};
 const leases=new Set();
 if(options.competitionModule)for(const [lane,current]of [session,otherSession].entries()){
  current.competitionLane=lane===0?'a':'b';
  current.activateBusinessContinuity=value=>{options.businessGuard(value,handle);leases.add(lane);};
  current.deactivateBusinessContinuity=value=>{options.businessGuard(value,handle);leases.delete(lane);};
  current.checkContinuity=value=>{options.businessGuard(value,handle);current.checkLight();assert.ok(leases.has(lane));};
 }
 let built=0;
 const Class=function OriginalSdk(){throw new Error('native client construction forbidden in app model');};
 const loader={Class,check(){assert.ok(resourceActive);},loadApplicationModules(request){
  calls.push('load');assert.deepEqual(request.map(row=>row.name),['application','database','security','projection','json','validation','listen']);
  options.onLoad?.(request);return bundle;
 },createTestingModule(metadata){calls.push('builder');assert.deepEqual(metadata,{imports:[bundle.Task16RegisteredApplicationModule]});return (built++===0?firstApp:secondApp).builder;}};
 const view={loader,source:{candidateSha:session.source.candidateSha,sourceSealSha256:session.source.sealSha256},resource:{caPath:path.join(directory,'tls-private/ca.crt')},
  check(){assert.ok(resourceActive);},checkLifetime(){assert.ok(resourceActive);},verifyFull(){assert.ok(resourceActive);}};
 const imports={
  './task16-current259-live-sessions.cjs':{assertCurrent259CompetitionLivePair(value,provided){return !!options.competitionModule&&value===pair&&provided===handle;},claimCurrent259LiveSessions(value,provided){
   if((options.competitionModule||options.retirement)&&provided===handle&&value===secondProof&&claimed)return otherSession;
   if(value!==proof||provided!==handle||claimed)throw new Error('CURRENT259_LIVE_SESSIONS_HANDLE');
   claimed=true;return session;
  }},
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer(token,h){assert.equal(typeof options.businessGuard,'function');options.businessGuard(token,h);}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResourceContinuity(provided,token){assert.equal(provided,handle);options.businessGuard(token,provided);view.check();return view;},claimCurrent259TechnicalResource(provided){assert.equal(provided,handle);view.check();return view;},async closeCurrent259OwnedResource(){resourceCloses++;resourceActive=false;}},
  './task16-current259-client-loader.cjs':{current259OwnedApplicationMethod(){},current259OwnedApplicationView(){},isCurrent259OwnedModule(){return false;},createCurrent259OwnedApplication(){throw new Error('wrong bridge');},takeCurrent259CreationFailure(){}},
  './run-task16-registered-pg-local.cjs':{ownsActiveTask16SimulationContext(){return false;}},
  './task16-current259-catalog.cjs':{loadCurrent259CatalogMaterial(value){const material=loadCurrent259CatalogMaterial(value);return options.material?options.material(material):material;}}
 };
 const module={exports:{}};
 const paymentFile=path.join(__dirname,'task16-current259-payment-case.cjs');
 if(options.paymentModule)imports['./task16-current259-payment-case.cjs']=options.paymentModule;
 if(options.competitionModule)imports['./task16-current259-payment-competition.cjs']=options.competitionModule;
 const localRequire=name=>imports[name]??require(name);
 localRequire.cache=options.paymentModule?{...require.cache,[paymentFile]:{exports:options.paymentModule}}:require.cache;
 new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-application-factory.cjs'),'utf8'))(localRequire,module,__dirname);
 return {...model,api:module.exports,proof,handle,session,view,loader,calls,environment,directory,resourceCloses:()=>resourceCloses,
  reader:()=>reader,providers,token,claimed:()=>claimed,pair,secondProof,otherSession,serverReads,providerReads,apps:[firstApp,secondApp],bundle};
}


test('genuine live proof binds the original loader, runtime and B7 provider and automatically closes HTTP',async t=>{
 const f=fixture(t);let observed;
 const result=await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  observed=app;
  assert.equal(app.runtime,f.session.runtime);assert.equal(app.inspect().runtime,f.session.runtime);
  assert.equal(f.providers.get(f.token),f.reader());
  assert.equal(app.sourceBinding.registeredManifestSha256,loadCurrent259CatalogMaterial(f.session.source).registeredManifestSha256);
  assert.equal(Object.hasOwn(app,'close'),false);
  const impacts=await f.reader().withTransaction((tx,read)=>read(tx,f.scope,['fact']));
  assert.equal(impacts[0].amountCents,23n);
  return 'complete';
 });
 assert.equal(result,'complete');
 assert.ok(f.calls.indexOf('load')<f.calls.indexOf('compile'));
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 assert.throws(()=>observed.inspect());
 await assert.rejects(f.reader().withTransaction(()=>{}));
 assert.equal(f.resourceCloses(),0);
});

test('plain proof, native flags and copied data cannot acquire application authority',async t=>{
 const f=fixture(t);
 for(const value of [{},{native:true},{...f.proof},{sourceBinding:{sourceSha:f.session.source.candidateSha}}]){
  await assert.rejects(f.api.withCurrent259OwnedApplication(value,f.handle,new AbortController().signal,()=>{}));
 }
 assert.equal(f.claimed(),false);assert.deepEqual(f.calls,[]);assert.equal(f.resourceCloses(),0);
 assert.equal(f.api.createCurrent259OwnedApplication,undefined);
});

test('the same handle is required and live proof is consumed only once',async t=>{
 const f=fixture(t);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,{},new AbortController().signal,()=>{}));
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}));
});

test('missing actual environment fails before module loading or compilation',async t=>{
 const f=fixture(t);delete process.env.JWT_ACCESS_SECRET;
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}),/TASK16_APP_ENVIRONMENT_REQUIRED/);
 assert.equal(f.calls.includes('load'),false);assert.equal(f.calls.includes('compile'),false);assert.equal(f.resourceCloses(),1);
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);
});

test('a trusted loader rejection cannot be replaced by a caller boundary',async t=>{
 const f=fixture(t);
 f.loader.loadApplicationModules=()=>{throw new Error('changed before capture');};
 f.view.check=()=>{throw new Error('CURRENT259_LOADER_CHANGED');};
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}),/TASK16_APP_FAILED_CLOSED/);
 assert.equal(f.calls.includes('compile'),false);assert.equal(f.resourceCloses(),1);
});

test('scope close UNKNOWN terminates sessions and physical resource without retry',async t=>{
 const f=fixture(t,{onClose(){throw new Error('private close failure');}});
 let observed;
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,app=>{observed=app;}),error=>{
  assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');return true;
 });
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 assert.equal(f.resourceCloses(),1);assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);
 assert.throws(()=>observed.inspect());
});

test('a failed startup preserves original unknown app cleanup',async t=>{
 const f=fixture(t,{onInit(){throw undefined;},onClose(){throw new Error('private');}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}),error=>{
  assert.equal(error.code,'TASK16_APP_FAILED_CLOSED');
  assert.equal(error.appStartupOutcome,'UNKNOWN_DO_NOT_RETRY');
  assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');return true;
 });
 assert.equal(f.resourceCloses(),1);
});

test('mismatched qualified material cannot reach module load or Nest compile',async t=>{
 const f=fixture(t,{material(value){return {...value,sourceSha:'f'.repeat(40)};}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}),/TASK16_APP_IMPACT_READER_PROOF/);
 assert.equal(f.calls.includes('load'),false);assert.equal(f.resourceCloses(),1);
});

test('aborted signal reduces authority before claiming live proof',async t=>{
 const f=fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{}),/TASK16_APP_ABORTED/);
 assert.equal(f.claimed(),false);assert.equal(f.resourceCloses(),0);
});

test('environment drift revokes the application even when the callback catches inspection error',async t=>{
 const f=fixture(t);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  process.env.FILE_DOWNLOAD_SECRET='4'.repeat(64);
  assert.throws(()=>app.inspect(),/TASK16_APP_FAILED_CLOSED/);
 }),/TASK16_APP_FAILED_CLOSED/);
 assert.equal(f.resourceCloses(),1);assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 await assert.rejects(f.reader().withTransaction(()=>{}));
});

test('source Class remains bound across asynchronous module loading',async t=>{
 let f;
 f=fixture(t,{onLoad(){f.loader.Class=function Replacement(){};}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{}),/TASK16_APP_IMPACT_READER_PROOF/);
 assert.equal(f.calls.includes('compile'),false);assert.equal(f.resourceCloses(),1);
});

test('enclosing live session scope remains the authority after startup',async t=>{
 const f=fixture(t);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,async app=>{
  await f.session.close();assert.throws(()=>app.inspect(),/TASK16_APP_FAILED_CLOSED/);
 }),/TASK16_APP_FAILED_CLOSED/);
 await assert.rejects(f.reader().withTransaction(()=>{}));assert.equal(f.resourceCloses(),1);
});

for(const value of [undefined,null,0,false]) test('falsey callback throw preserves failure and closes HTTP before sessions ('+String(value)+')',async t=>{
 const f=fixture(t);
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,new AbortController().signal,()=>{throw value;}),/TASK16_APP_FAILED_CLOSED/);
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 assert.ok(f.calls.indexOf('app-close')<f.calls.indexOf('sessions-close'));
 assert.equal(f.resourceCloses(),1);
});

test('abort exits a pending callback and starts HTTP, session and owned cleanup before callback settles',async t=>{
 const f=fixture(t),controller=new AbortController();
 let entered,lateReject,observed;
 const ready=new Promise(resolve=>{entered=resolve;});
 const pending=new Promise((_resolve,reject)=>{lateReject=reject;});
 const running=f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,app=>{
  observed=app;entered();return pending;
 }).then(value=>({value}),error=>({error}));
 t.after(async()=>{lateReject(new Error('late private callback failure'));await running;});
 await ready;controller.abort();
 const outcome=await Promise.race([running,new Promise(resolve=>setTimeout(()=>resolve({stillPending:true}),50))]);
 assert.equal(outcome.stillPending,undefined,'abort must release with even while the callback remains pending');
 assert.equal(outcome.error.code,'TASK16_APP_ABORTED');
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);
 assert.equal(f.resourceCloses(),1);
 assert.throws(()=>observed.inspect());
});

test('abort also cancels a still-pending application startup with UNKNOWN cleanup',async t=>{
 let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{onFull(){entered();return pending;}}),controller=new AbortController();
 const running=f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{throw new Error('callback must not run');}).then(()=>({success:true}),error=>({error}));
 t.after(async()=>{finish();await running;});
 await ready;controller.abort();
 const result=await Promise.race([running,new Promise(resolve=>setTimeout(()=>resolve({stillPending:true}),50))]);
 assert.equal(result.stillPending,undefined);assert.equal(result.error.code,'TASK16_APP_ABORTED');
 assert.equal(result.error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(f.calls.includes('compile'),false);assert.equal(f.resourceCloses(),1);
});

test('abort interrupts a pending HTTP close and reports UNKNOWN without a new time window',async t=>{
 const controller=new AbortController();let closing,finish;
 const ready=new Promise(resolve=>{closing=resolve;}),pending=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{onClose(){closing();return pending;}});
 const running=f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{}).then(()=>({success:true}),error=>({error}));
 t.after(async()=>{finish();await running;});
 await ready;controller.abort();
 const result=await Promise.race([running,new Promise(resolve=>setTimeout(()=>resolve({stillPending:true}),50))]);
 assert.equal(result.stillPending,undefined,'abort must not wait forever for an unreturned close');
 assert.equal(result.error.code,'TASK16_APP_ABORTED');assert.equal(result.error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);assert.equal(f.resourceCloses(),1);
});

test('the native abort listener is removed after successful scope completion',async t=>{
 const {getEventListeners}=require('node:events'),controller=new AbortController(),baseline=getEventListeners(controller.signal,'abort').length;
 const f=fixture(t);
 await f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{
  assert.equal(getEventListeners(controller.signal,'abort').length,baseline+1);
 });
 assert.equal(getEventListeners(controller.signal,'abort').length,baseline);
});

for(const stage of ['compile','init']) test('late '+stage+' handles retain their registered cleanup after startup abort',async t=>{
 let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{finish=resolve;});
 const hook=()=>{entered();return pending;};
 const f=fixture(t,stage==='compile'?{onCompile:hook}:{onInit:hook}),controller=new AbortController();let callbacks=0;
 const running=f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{callbacks++;}).then(()=>({success:true}),error=>({error}));
 t.after(async()=>{finish();await running;});
 await ready;controller.abort();
 const result=await Promise.race([running,new Promise(resolve=>setTimeout(()=>resolve({stillPending:true}),50))]);
 assert.equal(result.stillPending,undefined);assert.equal(result.error.code,'TASK16_APP_ABORTED');
 assert.equal(result.error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(callbacks,0);assert.equal(f.resourceCloses(),1);
 finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.filter(call=>call===(stage==='compile'?'module-close':'app-close')).length,1);
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);assert.equal(f.resourceCloses(),1);
});

test('abort raised by HTTP close cannot reenter cleanup or suppress UNKNOWN',async t=>{
 const controller=new AbortController();
 const f=fixture(t,{onClose(){controller.abort();throw new Error('private close failure');}});
 await assert.rejects(f.api.withCurrent259OwnedApplication(f.proof,f.handle,controller.signal,()=>{}),error=>{
  assert.equal(error.code,'TASK16_APP_ABORTED');assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');return true;
 });
 assert.equal(f.calls.filter(call=>call==='app-close').length,1);
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);assert.equal(f.resourceCloses(),1);
});

for(const fault of [null,'server-address','runtime-provider','token'])test('competition pair uses the fixed lightweight lane check and still rejects '+(fault??'no drift'),async t=>{
 const scopeToken=Object.freeze({});let f,finished=false;
 f=fixture(t,{
  businessGuard(token,handle){assert.equal(handle,f.handle);assert.equal(token,scopeToken);},
  competitionModule:{executeCurrent259PaymentCompetition(apps,leases,permit){
   assert.equal(permit,scopeToken);
   for(const lease of leases)lease.activateContinuity(fault==='token'?{}:scopeToken);
   const reads=[...f.serverReads,...f.providerReads];
   if(fault==='server-address')f.apps[1].server.address=()=>({address:'127.0.0.1',family:'IPv4',port:52555});
   for(const lease of leases)lease.check();
   assert.deepEqual([...f.serverReads,...f.providerReads],reads);
   if(fault==='runtime-provider')f.apps[1].entries.set(f.bundle.PrismaService,{});
   for(const app of apps)assert.equal(app.inspect().runtime,app.runtime);
   assert.ok(f.serverReads.every((count,index)=>count>reads[index]));
   for(const lease of leases)lease.finishContinuity(scopeToken);
   finished=true;
  }}
 });
 const signal=new AbortController().signal;
 const run=f.api.withCurrent259OwnedApplicationPair(f.pair,f.handle,signal,
  apps=>f.api.consumeCurrent259PaymentCompetition(apps,f.handle,scopeToken));
 if(fault)await assert.rejects(run);
 else await run;
 assert.equal(finished,!fault);
 const closeIndices=f.calls.flatMap((call,index)=>call==='app-close'?[index]:[]);
 assert.equal(closeIndices.length,2);
 if(fault)assert.ok(closeIndices.every(index=>index<f.calls.indexOf('sessions-close')));
});


for(const mode of ['complete','abort','close-rejected'])test('competition failure waits for the outer HTTP close ('+mode+')',async t=>{
 let beginOuter,finishOuter;
 const started=new Promise(resolve=>{beginOuter=resolve;});
 const hold=new Promise(resolve=>{finishOuter=resolve;});
 const controller=new AbortController();
 const f=fixture(t,{
  competitionModule:{},
  async onClose(lane){
   if(lane===0){beginOuter();await hold;}
   f.calls.push('http-finished-'+lane);
   if(lane===0&&mode==='close-rejected')throw new Error('outer HTTP close failed');
  }
 });
 t.after(finishOuter);
 const failure=Object.assign(new Error('first application failure'),{code:'TASK16_APP_RUNTIME_PROVIDER'});
 const running=f.api.withCurrent259OwnedApplicationPair(f.pair,f.handle,controller.signal,async()=>{throw failure;});
 const outcome=running.then(()=>assert.fail('expected failure'),error=>error);
 await started;
 await new Promise(resolve=>setImmediate(resolve));
 try{
  assert.ok(f.calls.includes('http-finished-1'));
  assert.ok(!f.calls.includes('sessions-close'));
  assert.equal(f.resourceCloses(),0);
  if(mode==='abort'){
   controller.abort();
   const stopped=await Promise.race([outcome,new Promise(resolve=>setImmediate(()=>resolve(null)))]);
   assert.ok(stopped,'abort must finish without waiting for a pending HTTP close');
   assert.equal(stopped.code,'TASK16_APP_RUNTIME_PROVIDER');
   assert.equal(stopped.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
   assert.ok(!f.calls.includes('http-finished-0'));
  }
 }finally{finishOuter();}
 const stopped=await outcome;
 assert.equal(stopped.code,'TASK16_APP_RUNTIME_PROVIDER');
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);
 assert.equal(f.resourceCloses(),1);
 assert.equal(stopped.appCleanupOutcome,mode==='complete'?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'UNKNOWN_DO_NOT_CONTINUE');
 if(mode!=='abort')assert.ok(f.calls.indexOf('http-finished-0')<f.calls.indexOf('sessions-close'));
});

test('first HTTP close rejection survives later abort while the peer is still closing',async t=>{
 let notifyOuter,releaseOuter,innerRejected=false;
 const outerStarted=new Promise(resolve=>{notifyOuter=resolve;});
 const outerHold=new Promise(resolve=>{releaseOuter=resolve;});
 const controller=new AbortController();
 const f=fixture(t,{competitionModule:{},async onClose(lane){
  if(lane===0){notifyOuter();await outerHold;}
  else{innerRejected=true;throw new Error('first HTTP close rejection');}
 }});
 t.after(releaseOuter);
 const running=f.api.withCurrent259OwnedApplicationPair(f.pair,f.handle,controller.signal,async()=> 'completed business');
 const stopped=running.then(()=>assert.fail('expected closure failure'),error=>error);
 await outerStarted;
 assert.equal(innerRejected,true);
 assert.equal(f.calls.includes('sessions-close'),false);
 controller.abort();
 const error=await stopped;
 assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(error.code,'TASK16_APP_CLOSE_UNKNOWN');
 assert.equal(f.calls.filter(call=>call==='sessions-close').length,1);
 assert.equal(f.resourceCloses(),1);
});


test('original A16 app publishes one close receipt only after its actual listener closes',async t=>{
 let continueClose,notifyClose;
 const closeWaiting=new Promise(resolve=>{notifyClose=resolve;});
 const wait=new Promise(resolve=>{continueClose=resolve;});t.after(continueClose);
 let done=false;
 const model=fixture(t,{retirement:true,async onClose(){notifyClose();await wait;}});
 const signal=new AbortController().signal;
 const running=model.api.withCurrent259OwnedDisconnectApplication(model.proof,model.handle,signal,()=> 'old-attempt').then(value=>{done=true;return value;});
 await closeWaiting;
 assert.equal(done,false);
 assert.equal(model.apps[0].server.listening,true);
 continueClose();
 const result=await running;
 assert.equal(result.value,'old-attempt');
 assert.equal(model.apps[0].server.listening,false);
 assert.equal(model.resourceCloses(),0);
 assert.throws(()=>model.api.claimCurrent259DisconnectApplicationClose({...result.closeProof},model.proof,model.handle),/TASK16_APP_HANDLE/u);
 assert.throws(()=>model.api.claimCurrent259DisconnectApplicationClose(result.closeProof,{},model.handle),/TASK16_APP_HANDLE/u);
 assert.equal(model.api.claimCurrent259DisconnectApplicationClose(result.closeProof,model.proof,model.handle),'http://127.0.0.1:52124/');
 assert.throws(()=>model.api.claimCurrent259DisconnectApplicationClose(result.closeProof,model.proof,model.handle),/TASK16_APP_HANDLE/u);
});

test('old app that returned from close with its original listener active cannot issue retirement',async t=>{
 const f=fixture(t,{retirement:true,stillListening:true});
 await assert.rejects(f.api.withCurrent259OwnedDisconnectApplication(f.proof,f.handle,new AbortController().signal,()=> 'old-attempt'),{
  code:'TASK16_APP_CLOSE_UNKNOWN',appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'
 });
 assert.equal(f.resourceCloses(),1);
});
