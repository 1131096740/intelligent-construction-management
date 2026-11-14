'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('a caller-supplied ordinary pool cannot enter the fixed document application',async()=>{
 const {runCurrent259GeneratedDocumentApplication}=require('./task12-current259-document-application.cjs');
 await assert.rejects(runCurrent259GeneratedDocumentApplication(Object.freeze({ordinary:{}})),/HANDLE/u);
});

function model(failure){
 const fs=require('node:fs'),path=require('node:path');
 const trace=[],bindings=new Map(),authTickets=new Set();let escapedAuth,remainingMs=900000,sourceOwned=true,traps=0;const abort=new AbortController();
 const token=Object.fromEntries(['PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor',
  'ContractDocumentService','ContractDraftController','FileService','JwtTokenService','AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor'].map(key=>[key,class {}]));
 for(const [key,methods]of Object.entries({AuthService:['login','loadUserRoleScopes','issueTokens'],AuthRateLimitService:['take'],AuthController:['login'],Task12AuthErrorFilter:['catch'],Task12AuthStageInterceptor:['intercept']}))for(const name of methods)token[key].prototype[name]=function(){};
 const authorityToken=Symbol('contract-version-file-read-authority'),authority={async assertCanReadVersionFile(){}};
 const ordinary={async onApplicationShutdown(){trace.push('ordinary-disconnect');}};
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
 const objects=new Map([[token.ContractDocumentService,document],[token.ContractDraftController,draft],
  [token.FileService,file],[authorityToken,authority]]);
 const auth=new token.AuthService(),rateLimits=new token.AuthRateLimitService(),authController=new token.AuthController(),authFilter=new token.Task12AuthErrorFilter(),authInterceptor=new token.Task12AuthStageInterceptor();authInterceptor.filter=authFilter;auth.prisma=failure==='lifecycle-wrong-auth'?{}:ordinary;rateLimits.prisma=failure==='lifecycle-wrong-rate'?{}:ordinary;authController.auth=auth;
 if(failure==='lifecycle-shadow-auth')auth.login=function(){};
 if(failure==='lifecycle-getter-auth')Object.defineProperty(auth,'prisma',{get(){traps++;return ordinary;}});
 for(const [key,value]of [[token.AuthService,failure==='lifecycle-proxy-auth'?new Proxy(auth,{getPrototypeOf(){traps++;throw Error('PRIVATE_PROXY');}}):auth],[token.AuthRateLimitService,rateLimits],[token.AuthController,authController],[token.Task12AuthErrorFilter,authFilter],[token.Task12AuthStageInterceptor,authInterceptor]])objects.set(key,value);
 objects.set(token.JwtTokenService,{verifyAccessToken(){return {};}});
 const get=key=>bindings.has(key)?bindings.get(key):objects.get(key);
 const testing={get,async close(){trace.push('module-close');await ordinary.onApplicationShutdown();}};
 const server={listening:false,address(){return {address:'127.0.0.1',family:'IPv4',port:24080};}};
 const app={get,getHttpServer(){return server;},async close(){
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
 const bridge=Object.freeze({check(){if(!sourceOwned)throw Error('MODEL_SOURCE_CHANGED');},loader,loaded,ordinary,providers,async queue(...args){trace.push(['queue',...args]);return 77;},
  ...(['public','stuck-listener','public-fixed-error','public-other-error'].includes(failure)?{publicDraft:Object.freeze({})}:{}),
  ...(failure?.startsWith('lifecycle')?{publicLifecycle:Object.freeze({signal:abort.signal})}:{}),
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
  './task12-current261-local-lifecycle-http.cjs':{async withCurrent261LocalLifecycleHttp(config,live,check,verifyToken,consume){
   assert.equal(config,bridge.publicLifecycle);assert.equal(live,server);check();assert.throws(()=>mod.exports.takeCurrent259GeneratedDocumentHttpBridge(config,live),/HANDLE/u);
   const diagnostics=mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live);escapedAuth=diagnostics;if(failure?.startsWith('lifecycle-diagnostic')){const ticket=diagnostics.arm('19900000000');if(failure==='lifecycle-diagnostic-expired')remainingMs=0;if(failure==='lifecycle-diagnostic-aborted')abort.abort();if(failure==='lifecycle-diagnostic-unowned')sourceOwned=false;const detail=diagnostics.take(ticket);assert.equal(trace.filter(v=>v==='auth-full-inspect').length,1);assert.equal(trace.filter(v=>v==='auth-native-take').length,1);if(failure==='lifecycle-diagnostic-aftercheck'){assert.deepEqual(detail,{serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028'});sourceOwned=false;trace.push('original-after-check');assert.throws(()=>check(),/PROVIDERS/u);throw Object.assign(Error('original AFTER_CHECK rejected'),{code:'AFTER_CHECK_REJECTED'});}if(failure==='lifecycle-diagnostic')assert.deepEqual(detail,{serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028'});else assert.equal(detail,undefined);}assert.throws(()=>mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live),/HANDLE/u);trace.push('lifecycle-http');return consume({fixed:true});
  }},
  './task12-current259-document-http.cjs':{async withCurrent259DocumentHttp(config,live,check,verifyToken,consume){
   assert.equal(config,bridge.publicDraft);assert.equal(live,server);check();assert.deepEqual(verifyToken('synthetic'),{});trace.push('public-http');return consume({fixed:true});
  }},
  './task12-current259-document-login.cjs':{takeCurrent259GeneratedDocumentApplicationBridge(candidate){
   assert.equal(candidate,bridge);assert.equal(claimed,false);claimed=true;
  }},
  './task16-current259-client-loader.cjs':{
   isCurrent259OwnedModule(value){return value===testing;},
   createCurrent259OwnedApplication(value){assert.equal(value,testing);return app;},
   current259OwnedApplicationView(value){assert.equal(value,app);return app;},
   inspectCurrent259OwnedDocumentAuthProviders(value,module,live){trace.push('auth-full-inspect');if(!sourceOwned)throw Error('UNOWNED_SOURCE');assert.equal(value,app);assert.equal(module,testing);assert.equal(live,server);return {runtime:ordinary,moduleRuntime:ordinary,auth,moduleAuth:auth,rateLimits,moduleRateLimits:rateLimits,authController,moduleAuthController:authController,authFilter,moduleAuthFilter:authFilter,authInterceptor,moduleAuthInterceptor:authInterceptor,verifyAuthDiagnosticReceiver(){trace.push('auth-local-verify');if(!sourceOwned||failure==='lifecycle-diagnostic-verifier')throw Error('LOCAL_RECEIVER_CHANGED');if(failure==='lifecycle-diagnostic-verifier-false')return false;if(failure==='lifecycle-diagnostic-verifier-abort')abort.abort();if(failure==='lifecycle-diagnostic-verifier-expire')remainingMs=0;return true;}};},
   takeCurrent259CreationFailure(){return undefined;}
  }
 };
 const filename=path.join(__dirname,'task12-current259-document-application.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(id=>imports[id]??require(id),mod);
 return {api:mod.exports,bridge,token,bindings,trace,server,ordinary,originalShutdown,document,originalQueue,providers,authTickets,get escapedAuth(){return escapedAuth;},traps:()=>traps};
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

test('loader diagnostic verifier actual closure has no indirect full-check call (lexical model, no genuine build claim)',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'task16-current259-client-loader.cjs'),'utf8');
 const start=source.indexOf('const authModules=new Map(records.map(row=>[row.module,row.module.exports]));'),end=source.indexOf('return Object.freeze({...result,verifyAuthDiagnosticReceiver});',start);
 const result={auth:{}},row={module:{filename:'closed-model',exports:{key:42}},key:'key',value:42};
 const Module={_load:function(){}},hooks={load:Module._load};const reflection={get:Reflect.getMetadata,define:Reflect.defineMetadata};
 let fullCalls=0,creation=0,metadata=0,operations=0;
 const verify=new Function('need','Module','hooks','reflection','nativeProxy','checkCreation','document','records','own','guardedOperation','readAuth','result','require','check','material',`let failed=false,loading=false;${source.slice(start,end)}return verifyAuthDiagnosticReceiver;`)(
  (value)=>assert.ok(value),Module,hooks,reflection,Proxy,()=>creation++,{checkMetadata(){metadata++;}},[row],(o,k)=>Object.getOwnPropertyDescriptor(o,k)?.value,action=>{operations++;return action();},()=>({...result}),result,{cache:{'closed-model':row.module}},()=>{fullCalls++;throw Error('FULL_CHECK_FORBIDDEN');},{checkLight(){fullCalls++;throw Error('FULL_CHECK_FORBIDDEN');}});
 assert.equal(verify(),true);assert.equal(fullCalls,0);assert.equal(creation,1);assert.equal(metadata,1);assert.equal(operations,1);
 row.module.exports.key=43;assert.throws(()=>verify());assert.equal(fullCalls,0);
});
