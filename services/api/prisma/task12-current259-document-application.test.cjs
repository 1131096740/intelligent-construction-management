'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('a caller-supplied ordinary pool cannot enter the fixed document application',async()=>{
 const {runCurrent259GeneratedDocumentApplication}=require('./task12-current259-document-application.cjs');
 await assert.rejects(runCurrent259GeneratedDocumentApplication(Object.freeze({ordinary:{}})),/HANDLE/u);
});

function model(failure,setupError,diagnosticFailure){
 const fs=require('node:fs'),path=require('node:path');
 const trace=[],bindings=new Map(),authTickets=new Set();let escapedAuth,remainingMs=900000,sourceOwned=true,traps=0,setupThrown=false;const abort=new AbortController();
 const token=Object.fromEntries(['PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor',
  'ContractReadService','MeService','AuditService','ContractDocumentService','ContractDraftController','FileService','JwtTokenService','AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor'].map(key=>[key,class {}]));
 for(const [key,methods]of Object.entries({ContractReadService:['workbenchLedger'],MeService:['getContractPendingWorkItems','contractV2LifecycleWorkItems'],AuditService:['record'],AuthService:['login','loadUserRoleScopes','issueTokens'],AuthRateLimitService:['take'],AuthController:['login'],Task12AuthErrorFilter:['catch'],Task12AuthStageInterceptor:['intercept']}))for(const name of methods)token[key].prototype[name]=function(){};
 const authorityToken=Symbol('contract-version-file-read-authority'),authority={async assertCanReadVersionFile(){}};
 const ordinaryTarget=Object.assign(new token.PrismaService(),{async onApplicationShutdown(){trace.push('ordinary-disconnect');}});
 const ordinary=failure==='lifecycle-native-proxy'?new Proxy(ordinaryTarget,{}):ordinaryTarget;
 const originalShutdown=ordinary.onApplicationShutdown;
 const providers={storage:{},template:{},worker:{}};
 const document={prisma:ordinary,async queueDraftPreview(){trace.push('ordinary-queue');},async getDraftBody(){trace.push('ordinary-body');}};
 const originalQueue=document.queueDraftPreview;
 const draft={documents:document};
 const file={prisma:ordinary,storage:providers.storage,moduleRef:{get(key,options){
  assert.equal(key,authorityToken);assert.deepEqual(options,{strict:false});
  return failure==='authority'?{}:authority;
 }}};
 document.files=file;
 const audit=new token.AuditService(),me=new token.MeService(),contractRead=new token.ContractReadService();
 audit.prisma=ordinary;me.prisma=ordinary;me.files=file;me.audit=audit;contractRead.prisma=ordinary;contractRead.audit=audit;contractRead.me=failure==='lifecycle-missing-me'?undefined:me;
 if(failure==='lifecycle-shadow-me')me.getContractPendingWorkItems=function(){return [];};
 if(failure==='lifecycle-getter-me')Object.defineProperty(contractRead,'me',{get(){traps++;return me;}});
 const objects=new Map([[token.ContractReadService,contractRead],[token.MeService,me],[token.AuditService,audit],[token.ContractDocumentService,document],[token.ContractDraftController,draft],
  [token.FileService,file],[authorityToken,authority]]);
 const auth=new token.AuthService(),rateLimits=new token.AuthRateLimitService(),authController=new token.AuthController(),authFilter=new token.Task12AuthErrorFilter(),authInterceptor=new token.Task12AuthStageInterceptor();authInterceptor.filter=authFilter;auth.prisma=failure==='lifecycle-wrong-auth'?{}:ordinary;rateLimits.prisma=failure==='lifecycle-wrong-rate'?{}:ordinary;authController.auth=auth;
 if(failure==='lifecycle-shadow-auth')auth.login=function(){};
 if(failure==='lifecycle-getter-auth')Object.defineProperty(auth,'prisma',{get(){traps++;return ordinary;}});
 for(const [key,value]of [[token.AuthService,failure==='lifecycle-proxy-auth'?new Proxy(auth,{getPrototypeOf(){traps++;throw Error('PRIVATE_PROXY');}}):auth],[token.AuthRateLimitService,rateLimits],[token.AuthController,authController],[token.Task12AuthErrorFilter,authFilter],[token.Task12AuthStageInterceptor,authInterceptor]])objects.set(key,value);
 objects.set(token.JwtTokenService,{verifyAccessToken(){return {};}});
 const get=key=>bindings.has(key)?bindings.get(key):objects.get(key);
 const testing={get,async close(){trace.push('module-close');await ordinary.onApplicationShutdown();}};
 const server={listening:false,address(){return {address:'127.0.0.1',family:'IPv4',port:24080};}};
 const nativeWarm=new Set(),nativeReads=[],nativePublicProofs=new WeakSet();const appGet=key=>{if(setupError&&server.listening&&key===token.JwtTokenService){trace.push('setup-jwt-get');setupThrown=true;throw setupError;}nativeWarm.add(key);nativeReads.push(key);return get(key);};
 const app={get:appGet,getHttpServer(){return server;},async close(){
  if(!['stuck-listener','public-fixed-error'].includes(failure))server.listening=false;
  trace.push('app-close');await Promise.resolve();trace.push('worker-drained');
  await ordinary.onApplicationShutdown();if(failure==='close')throw Error('private model cleanup');
 },getHttpAdapter(){return {getInstance(){return {set(){trace.push('json');}};}};},
 enableCors(){trace.push('cors');},useGlobalPipes(){trace.push('validation');},
 async init(){trace.push('init');if(failure==='lifecycle-changed-method')token.AuthService.prototype.login=function(){};if(failure==='init')throw Error('private init');}};
 const loader={createDocumentTestingModule(){trace.push('build');return {
  overrideProvider(token){return {useValue(instance){bindings.set(token,instance);}};},
  async compile(){trace.push('compile');return testing;}
 };}};
 const loaded={...token,armTask12AuthError(){const ticket=Object.freeze({});authTickets.add(ticket);return ticket;},takeTask12AuthError(filter,live,ticket){trace.push('auth-native-take');assert.equal(filter,authFilter);assert.equal(live,server);assert.equal(authTickets.delete(ticket),true);return Object.freeze({serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028'});},currentOfficialDocumentScope(){return {kind:'OFFICIAL_TOOL_RUNTIME',remainingTotalMilliseconds(){if(remainingMs<=0)throw Error('EXPIRED');return remainingMs;}};},async listenApi(view,port,host){assert.equal(view,app);trace.push(['listen',port,host]);server.listening=true;},CONTRACT_VERSION_FILE_READ_AUTHORITY:authorityToken,configureApiSecurity(){trace.push('security');},
  configureProjectionExportJson(){trace.push('projection');},apiJsonReplacer(){},createApiValidationPipe(){return {};}};
 loader.loadCurrent261LocalLifecycleDocumentModules=()=>loaded;
 loaded.isTask12LocalLifecycleFixture=value=>value===nativeFixture;
 const nativeFixture=Object.freeze({case:Object.freeze({key:'inside:equipment_rental'})}),nativeProof=Object.freeze({});
 const bridge=Object.freeze({check(){if(!sourceOwned)throw Error('MODEL_SOURCE_CHANGED');},loader,loaded,ordinary,providers,async queue(...args){trace.push(['queue',...args]);return 77;},
  ...(['public','stuck-listener','public-fixed-error','public-other-error'].includes(failure)?{publicDraft:Object.freeze({})}:{}),
  ...(failure?.startsWith('lifecycle')?{publicLifecycle:Object.freeze({signal:abort.signal,fixture:nativeFixture})}:{}),
  async exercise(http){
   if(['public','stuck-listener','public-fixed-error','public-other-error','lifecycle'].includes(failure)||failure?.startsWith('lifecycle')){assert.deepEqual(http,{fixed:true});trace.push('exercise-public');
    if(failure.endsWith('-error'))throw Object.assign(Error('private details'),
     {code:failure==='public-fixed-error'?'CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE':'arbitrary'});
    return false;}
   trace.push('exercise');assert.equal(await draft.documents.queueDraftPreview('draft','actor',{sourceRevision:1}),77);
   await document.getDraftBody();return false;
  }});
 let claimed=false;
 const imports={
  './task12-current261-local-lifecycle-http.cjs':{rememberCurrent261ApplicationHttpSetupFailure(error){if(diagnosticFailure==='call'){trace.push('diagnostic-call-failure');throw Error('PRIVATE_DIAGNOSTIC');}return require('./task12-current261-local-lifecycle-http.cjs').rememberCurrent261ApplicationHttpSetupFailure(error);},async withCurrent261LocalLifecycleHttp(config,live,check,verifyToken,consume){
   assert.equal(config,bridge.publicLifecycle);assert.equal(live,server);check();assert.throws(()=>mod.exports.takeCurrent259GeneratedDocumentHttpBridge(config,live),/HANDLE/u);
   const diagnostics=mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live);escapedAuth=diagnostics;if(failure?.startsWith('lifecycle-diagnostic')){const ticket=diagnostics.arm('19900000000');if(failure==='lifecycle-diagnostic-expired')remainingMs=0;if(failure==='lifecycle-diagnostic-aborted')abort.abort();if(failure==='lifecycle-diagnostic-unowned')sourceOwned=false;const detail=diagnostics.take(ticket);assert.equal(trace.filter(v=>v==='auth-full-inspect').length,1);assert.equal(trace.filter(v=>v==='auth-native-take').length,1);if(failure==='lifecycle-diagnostic-aftercheck'){assert.deepEqual(detail,{serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028'});sourceOwned=false;trace.push('original-after-check');assert.throws(()=>check(),/PROVIDERS/u);throw Object.assign(Error('original AFTER_CHECK rejected'),{code:'AFTER_CHECK_REJECTED'});}if(failure==='lifecycle-diagnostic')assert.deepEqual(detail,{serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028'});else assert.equal(detail,undefined);}assert.throws(()=>mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live),/HANDLE/u);trace.push('lifecycle-http');return consume({fixed:true});
  }},
  './task12-current259-document-http.cjs':{async withCurrent259DocumentHttp(config,live,check,verifyToken,consume){
   assert.equal(config,bridge.publicDraft);assert.equal(live,server);check();assert.deepEqual(verifyToken('synthetic'),{});trace.push('public-http');return consume({fixed:true});
  }},
  './task12-current259-document-login.cjs':{readNativeTask12DocumentLoginProjection(value){assert.equal(value,nativeProof);return {source:{candidateSha:'a'.repeat(40),profile:{profile:'TASK12_ARCHIVE261_SOURCE_V1'}}};},takeCurrent259GeneratedDocumentApplicationBridge(candidate){
   assert.equal(candidate,bridge);assert.equal(claimed,false);claimed=true;
  }},
  './task16-current259-client-loader.cjs':{inspectCurrent261OwnedNativeEquipmentPublicGuard(value,module,live){
    const pairs=imports['./task16-current259-client-loader.cjs'].inspectCurrent261OwnedNativeEquipmentProviders(value,module,live);
    if(pairs===undefined||!nativeWarm.has(token.JwtTokenService))return undefined;
    const jwtService=objects.get(token.JwtTokenService);trace.push('native-public-guard-batch');const proof=Object.freeze({providers:pairs,server,jwtService,verifyAccessToken:jwtService.verifyAccessToken});nativePublicProofs.add(proof);return proof;
   },consumeCurrent261OwnedNativeEquipmentPublicGuard(proof,value,module,live){assert.equal(value,app);assert.equal(module,testing);assert.equal(live,server);assert.equal(nativePublicProofs.delete(proof),true);trace.push('native-public-guard-consumed');return true;},inspectCurrent261OwnedNativeEquipmentProviders(value,module,live){
    assert.equal(value,app);assert.equal(module,testing);assert.equal(live,server);assert.equal(live.listening,true);const required=['AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor','ContractReadService','MeService','AuditService','PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor','ContractDocumentService','FileService','ContractDraftController'].map(key=>token[key]).concat([authorityToken]);if(!required.every(key=>nativeWarm.has(key))){trace.push('native-batch-unwarmed-original');return undefined;}trace.push('native-provider-batch');
    return Object.freeze(['AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor','ContractReadService','MeService','AuditService','PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor','ContractDocumentService','FileService','ContractDraftController'].map(key=>Object.freeze([token[key],get(token[key])])).concat([Object.freeze([authorityToken,get(authorityToken)])]));
   },takeCurrent261NativeOrdinaryClient(actualLoader,actualLoaded,client){assert.equal(actualLoader,loader);assert.equal(actualLoaded,loaded);assert.equal(client,ordinary);return true;},
   isCurrent259OwnedModule(value){return value===testing;},
   createCurrent259OwnedApplication(value){assert.equal(value,testing);return app;},
   current259OwnedApplicationView(value){assert.equal(value,app);return app;},
   inspectCurrent259OwnedDocumentAuthProviders(value,module,live){trace.push('auth-full-inspect');if(!sourceOwned)throw Error('UNOWNED_SOURCE');assert.equal(value,app);assert.equal(module,testing);assert.equal(live,server);return {runtime:ordinary,moduleRuntime:ordinary,auth,moduleAuth:auth,rateLimits,moduleRateLimits:rateLimits,authController,moduleAuthController:authController,authFilter,moduleAuthFilter:authFilter,authInterceptor,moduleAuthInterceptor:authInterceptor,verifyAuthDiagnosticReceiver(){trace.push('auth-local-verify');if(!sourceOwned||failure==='lifecycle-diagnostic-verifier')throw Error('LOCAL_RECEIVER_CHANGED');if(failure==='lifecycle-diagnostic-verifier-false')return false;if(failure==='lifecycle-diagnostic-verifier-abort')abort.abort();if(failure==='lifecycle-diagnostic-verifier-expire')remainingMs=0;return true;}};},
   takeCurrent259CreationFailure(){return undefined;}
  }
 };
 const filename=path.join(__dirname,'task12-current259-document-application.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(id=>{if(id==='./task12-current261-local-lifecycle-http.cjs'&&setupThrown&&diagnosticFailure==='require'){trace.push('diagnostic-require-failure');throw Error('PRIVATE_DIAGNOSTIC_REQUIRE');}return imports[id]??require(id);},mod);
 return {api:mod.exports,nativeProof,bridge,token,bindings,trace,server,ordinary,originalShutdown,document,originalQueue,providers,authTickets,nativeWarm,nativeReads,get escapedAuth(){return escapedAuth;},traps:()=>traps};
}
test('the same application resolves original file authority, routes only queue to its role and drains before returning',async()=>{
 const f=model();
 assert.equal(await f.api.runCurrent259GeneratedDocumentApplication(f.bridge),false);
 assert.equal(f.bindings.get(f.token.PrismaService),f.ordinary);
 assert.equal(f.bindings.get(f.token.PrivateFileStorage),f.providers.storage);
 assert.equal(f.bindings.get(f.token.LayoutTemplateService),f.providers.template);
 assert.equal(f.bindings.get(f.token.ContractDocumentProcessor),f.providers.worker);
 assert.deepEqual(f.trace,['build','compile','security','projection','json','cors','validation','init','exercise',
  ['queue','draft','actor',{sourceRevision:1}],'ordinary-body','app-close','worker-drained']);
 assert.equal(f.ordinary.onApplicationShutdown,f.originalShutdown);
 assert.equal(f.document.queueDraftPreview,f.originalQueue);
 await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),/HANDLE/u);
});
test('a changed file authority or incomplete app close never certifies a usable scope',async()=>{
 for(const [mode,reason] of [['authority','PROVIDERS'],['init','INIT'],['close','CLOSE']]){
  const f=model(mode);
  await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>{
   assert.equal(error.code,'CURRENT259_GENERATED_DOCUMENT_APP_'+reason);
   assert.equal(error.appCleanupOutcome,mode==='close'?'UNKNOWN_DO_NOT_CONTINUE':undefined);
   assert.doesNotMatch(JSON.stringify(error),/private init|private model/u);return true;
  });
  assert.equal(f.ordinary.onApplicationShutdown,f.originalShutdown);
  assert.equal(f.document.queueDraftPreview,f.originalQueue);
  assert.ok(!f.trace.includes('ordinary-disconnect'));
  if(mode==='authority'){assert.ok(!f.trace.includes('init'));assert.ok(f.trace.includes('module-close'));}
 }
});

test('the fixed public document scope requires the listener and closes it before returning',async()=>{
 const f=model('public');
 assert.equal(await f.api.runCurrent259GeneratedDocumentApplication(f.bridge),false);
 assert.deepEqual(f.trace.slice(-6),['init',['listen',0,'127.0.0.1'],'public-http','exercise-public','app-close','worker-drained']);
 assert.equal(f.server.listening,false);
});

test('an unclosed owned listener remains UNKNOWN and original worker cleanup still executes',async()=>{
 const f=model('stuck-listener');
 await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),{code:'CURRENT259_GENERATED_DOCUMENT_APP_CLOSE',
  appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
 assert.equal(f.server.listening,true);
 assert.ok(f.trace.includes('worker-drained'));
 assert.equal(f.ordinary.onApplicationShutdown,f.originalShutdown);
});

test('projects only exact public exercise codes and retains independently failed listener cleanup',async()=>{
 for(const [mode,expected] of [['public-fixed-error','CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE'],['public-other-error',undefined]]){
  const f=model(mode);
  await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>{
   assert.equal(error.code,'CURRENT259_GENERATED_DOCUMENT_APP_HTTP');assert.equal(error.exerciseCode,expected);
   assert.equal(error.appCleanupOutcome,expected?'UNKNOWN_DO_NOT_CONTINUE':undefined);
   assert.doesNotMatch(JSON.stringify(error),/private details|arbitrary/u);return true;
  });
 }
});

test('life application listens through a separate one-use HTTP bridge without widening preview authority',async()=>{
 const f=model('lifecycle');assert.equal(await f.api.runCurrent259GeneratedDocumentApplication(f.bridge),false);
 assert.ok(f.trace.includes('lifecycle-http'));assert.ok(!f.trace.includes('public-http'));
 assert.ok(f.trace.indexOf('exercise-public')<f.trace.indexOf('app-close'));assert.ok(f.trace.includes('worker-drained'));
 assert.throws(()=>f.api.takeCurrent261LocalLifecycleHttpBridge(f.bridge.publicLifecycle,f.server),/HANDLE/u);
});

test('the actual ordinary AUTH receiver must match before the lifecycle HTTP bridge is issued',async()=>{const f=model('lifecycle-wrong-auth');await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>error.code==='CURRENT259_GENERATED_DOCUMENT_APP_PROVIDERS');assert.equal(f.trace.includes('lifecycle-http'),false);});

for(const mode of ['lifecycle-shadow-auth','lifecycle-wrong-rate','lifecycle-getter-auth','lifecycle-proxy-auth','lifecycle-changed-method'])test('AUTH provider gate rejects '+mode+' without adoption or getter traps',async()=>{const f=model(mode);await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>error.code==='CURRENT259_GENERATED_DOCUMENT_APP_PROVIDERS');assert.equal(f.trace.includes('lifecycle-http'),false);assert.equal(f.traps(),0);});
for(const mode of ['lifecycle-diagnostic','lifecycle-diagnostic-expired','lifecycle-diagnostic-aborted','lifecycle-diagnostic-unowned','lifecycle-diagnostic-verifier','lifecycle-diagnostic-verifier-false','lifecycle-diagnostic-verifier-abort','lifecycle-diagnostic-verifier-expire'])test('actual factory closure with model source hook '+mode+' cannot outlive its receiver and source',async()=>{const f=model(mode);if(mode==='lifecycle-diagnostic-unowned')await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),{code:'CURRENT259_GENERATED_DOCUMENT_APP_HTTP'});else assert.equal(await f.api.runCurrent259GeneratedDocumentApplication(f.bridge),false);assert.equal(f.authTickets.size,0);assert.throws(()=>f.escapedAuth.arm('19900000000'));});

test('actual factory take closure consumes once before local verifier and retains the original full AFTER_CHECK rejection (model ports)',async()=>{
 const f=model('lifecycle-diagnostic-aftercheck');
 await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>error.code==='CURRENT259_GENERATED_DOCUMENT_APP_HTTP');
 assert.equal(f.trace.filter(v=>v==='original-after-check').length,1);
 assert.equal(f.trace.filter(v=>v==='auth-full-inspect').length,1);
 assert.equal(f.trace.filter(v=>v==='auth-native-take').length,1);
 assert.ok(f.trace.indexOf('auth-full-inspect')<f.trace.indexOf('auth-native-take'));
 assert.ok(f.trace.indexOf('auth-native-take')<f.trace.indexOf('auth-local-verify'));
 assert.ok(f.trace.indexOf('auth-local-verify')<f.trace.indexOf('original-after-check'));
 assert.equal(f.authTickets.size,0);
});

function localVerifierModel(){
 const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
 const source=fs.readFileSync(path.join(__dirname,'task16-current259-client-loader.cjs'),'utf8');
 const start=source.indexOf('      // Diagnostic-only continuity:'),end=source.indexOf('return Object.freeze({...result,verifyAuthDiagnosticReceiver});',start);
 const result={auth:{}},row={module:{filename:'closed-model',exports:{key:42}},key:'key',value:42};
 const Module={_load:function(){}},hooks={load:Module._load},required={cache:{'closed-model':row.module}};
 const reflection={get:Reflect.getMetadata,define:Reflect.defineMetadata};let fullCalls=0,creation=0,metadata=0,operations=0;
 const verify=new Function('need','types','Module','hooks','reflection','nativeProxy','checkCreation','document','records','own','guardedOperation','readAuth','result','require','check','material',`let failed=false,loading=false;${source.slice(start,end)}return verifyAuthDiagnosticReceiver;`)(
  (value)=>assert.ok(value),types,Module,hooks,reflection,Proxy,()=>creation++,{checkMetadata(){metadata++;}},[row],(o,k)=>o&&!types.isProxy(o)?Object.getOwnPropertyDescriptor(o,k)?.value:undefined,action=>{operations++;return action();},()=>({...result}),result,required,()=>{fullCalls++;throw Error('FULL_CHECK_FORBIDDEN');},{checkLight(){fullCalls++;throw Error('FULL_CHECK_FORBIDDEN');}});
 return {verify,row,required,counts:()=>({fullCalls,creation,metadata,operations})};
}
test('loader diagnostic verifier actual closure has no indirect full-check call (lexical model, no genuine build claim)',()=>{
 const f=localVerifierModel();assert.equal(f.verify(),true);assert.deepEqual(f.counts(),{fullCalls:0,creation:1,metadata:1,operations:1});
 f.row.module.exports.key=43;assert.throws(()=>f.verify());assert.equal(f.counts().fullCalls,0);
});
for(const variant of ['module-exports-getter','module-filename-getter','cache-slot-getter','cache-getter','module-proxy','exports-proxy','cache-proxy','descriptor-flags'])test('actual local verifier rejects '+variant+' without invoking untrusted accessors or proxy traps',()=>{
 const f=localVerifierModel();assert.equal(f.verify(),true);let traps=0;const mod=f.row.module,cache=f.required.cache;
 const key=variant==='module-filename-getter'?'filename':'exports',original=Object.getOwnPropertyDescriptor(mod,key),slot=Object.getOwnPropertyDescriptor(cache,'closed-model'),cacheDescriptor=Object.getOwnPropertyDescriptor(f.required,'cache');
 if(variant.startsWith('module-')&&variant.endsWith('-getter'))Object.defineProperty(mod,key,{get(){traps++;return original.value;},configurable:true});
 if(variant==='cache-slot-getter')Object.defineProperty(cache,'closed-model',{get(){traps++;return mod;},configurable:true});
 if(variant==='cache-getter')Object.defineProperty(f.required,'cache',{get(){traps++;return cache;},configurable:true});
 const proxy=object=>new Proxy(object,{get(){traps++;throw Error('PRIVATE_TRAP');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_TRAP');}});
 if(variant==='module-proxy')f.row.module=proxy(mod);
 if(variant==='exports-proxy')mod.exports=proxy(original.value);
 if(variant==='cache-proxy')f.required.cache=proxy(cache);
 if(variant==='descriptor-flags')Object.defineProperty(mod,'exports',{...original,enumerable:!original.enumerable});
 assert.throws(()=>f.verify());assert.equal(traps,0);assert.deepEqual(f.counts(),{fullCalls:0,creation:1,metadata:1,operations:1});
 // Restoration of the exact same descriptors/objects is allowed; this is a
 // diagnostic observation, not a new business capability or sticky full gate.
 f.row.module=mod;Object.defineProperty(mod,key,original);Object.defineProperty(cache,'closed-model',slot);Object.defineProperty(f.required,'cache',cacheDescriptor);
 assert.equal(f.verify(),true);
});


for(const mode of ['lifecycle-missing-me','lifecycle-shadow-me','lifecycle-getter-me'])test('real contract pending provider path rejects '+mode+' before HTTP (factory model only)',async()=>{
 const f=model(mode);await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),{code:'CURRENT259_GENERATED_DOCUMENT_APP_PROVIDERS'});
 assert.equal(f.trace.includes('lifecycle-http'),false);assert.equal(f.traps(),0);
});

test('native document application retains original providers Me and public lifecycle without old resource bridge',async()=>{
 const f=model('lifecycle');
 assert.equal(await f.api.runNativeTask12DocumentApplication(f.nativeProof,f.bridge),false);
 await assert.rejects(f.api.runNativeTask12DocumentApplication(f.nativeProof,f.bridge),/HANDLE/u);
 assert.ok(f.trace.includes('lifecycle-http'));assert.ok(f.trace.includes('worker-drained'));assert.ok(f.trace.includes('native-provider-batch'));assert.ok(f.nativeWarm.size>=16);assert.ok(f.nativeReads.length>=32);
 assert.equal(f.ordinary.onApplicationShutdown,f.originalShutdown);
 const bad=model('lifecycle-missing-me');
 await assert.rejects(bad.api.runNativeTask12DocumentApplication(bad.nativeProof,bad.bridge),/PROVIDERS/u);
 const wrong=model('lifecycle');await assert.rejects(wrong.api.runNativeTask12DocumentApplication({},wrong.bridge));
});

test('actual native main bridge reaches provider verification with the Prisma composite-proxy call shape',async()=>{
 const fs=require('node:fs'),path=require('node:path'),f=model('lifecycle-native-proxy');
 const source=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const start=source.indexOf('   const bridge=Object.freeze('),end=source.indexOf("   return require('./task12-current259-document-application.cjs')",start);
 assert.ok(start>=0&&end>start);
 const ordinary=f.ordinary;assert.equal(require('node:util').types.isProxy(ordinary),true);assert.equal(ordinary instanceof f.bridge.loaded.PrismaService,true);
 const bridge=new Function('check','loader','modules','ordinary','providers','operations','config',source.slice(start,end)+'return bridge;')(f.bridge.check,f.bridge.loader,f.bridge.loaded,ordinary,f.providers,{queue:{queueDraftPreview:f.bridge.queue}},f.bridge.publicLifecycle);
 // Fail exactly at the next model boundary: this is not a genuine SDK/provider
 // claim or business execution. The native entry must not reject the genuine
 // Prisma proxy shape before the original provider verifier can run.
 f.bridge.loader.createDocumentTestingModule=()=>{f.trace.push('actual-main-provider-boundary');throw Error('MODEL_PROVIDER_BOUNDARY');};
 await assert.rejects(f.api.runNativeTask12DocumentApplication(f.nativeProof,bridge),error=>error.code==='CURRENT259_GENERATED_DOCUMENT_APP_PROVIDERS');
 assert.ok(f.trace.includes('actual-main-provider-boundary'));
});


test('HTTP setup wrapped JWT lookup failure retains a finite diagnostic before entering withHttp',async()=>{
 const http=require('./task12-current261-local-lifecycle-http.cjs');
 for(const code of ['CURRENT261_NATIVE_PROVIDER_LOOKUP','PRIVATE_UNKNOWN']){
  const first=Object.assign(Error('PRIVATE_SETUP'),{code}),f=model('lifecycle',first);let wrapped;
  await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>{wrapped=error;return error.code==='CURRENT259_GENERATED_DOCUMENT_APP_HTTP'&&error.cause===first;});
  const detail=http.describeCurrent261LocalLifecycleHttpFailure(wrapped);assert.ok(detail);assert.equal(detail.phase,'APPLICATION_HTTP_SETUP');assert.equal(detail.observationContext,'NO_HTTP_OBSERVATION');assert.equal(detail.method,'UNKNOWN');assert.equal(detail.routeTemplate,'UNKNOWN');assert.equal(detail.httpStatus,null);assert.equal(detail.businessOutcome,'UNKNOWN');
  assert.deepEqual(detail.firstCause,code==='CURRENT261_NATIVE_PROVIDER_LOOKUP'?{family:'INTEGRITY',code}:{family:'UNKNOWN',code:'UNKNOWN'});assert.deepEqual(detail.timingAtConsumeFailure,{status:'UNKNOWN'});
  assert.equal(f.trace.filter(item=>item==='setup-jwt-get').length,1);assert.equal(f.trace.includes('lifecycle-http'),false);assert.equal(f.trace.includes('exercise-public'),false);assert.equal(f.trace.includes('app-close'),true);assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|stack/u);
 }
});


for(const mode of ['require','call'])test('HTTP setup diagnostic '+mode+' failure preserves original cause and app cleanup',async()=>{
  const first=Object.assign(Error('PRIVATE_SETUP_ORIGINAL'),{code:'CURRENT261_NATIVE_PROVIDER_LOOKUP'}),f=model('lifecycle',first,mode);
  await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>error.code==='CURRENT259_GENERATED_DOCUMENT_APP_HTTP'&&error.cause===first);
  assert.equal(f.trace.filter(item=>item==='diagnostic-'+mode+'-failure').length,1);assert.equal(f.trace.filter(item=>item==='setup-jwt-get').length,1);
  assert.equal(f.trace.includes('lifecycle-http'),false);assert.equal(f.trace.includes('exercise-public'),false);assert.equal(f.trace.includes('app-close'),true);assert.equal(f.trace.includes('worker-drained'),true);assert.equal(f.server.listening,false);assert.equal(f.document.queueDraftPreview,f.originalQueue);assert.equal(f.ordinary.onApplicationShutdown,f.originalShutdown);
});

test('application cleanup distinguishes a close error from a listening server without exposing details',async()=>{
 for(const [mode,expected] of [['close',['CLOSE_FAILED']],['stuck-listener',['SERVER_LISTENING']]]){
  const f=model(mode);
  await assert.rejects(f.api.runCurrent259GeneratedDocumentApplication(f.bridge),error=>{
   assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
   assert.deepEqual(error.appCleanupDiagnostics,expected);
   assert.doesNotMatch(JSON.stringify(error.appCleanupDiagnostics),/private/);return true;
  });
 }
});
