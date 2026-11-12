'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('a caller-supplied ordinary pool cannot enter the fixed document application',async()=>{
 const {runCurrent259GeneratedDocumentApplication}=require('./task12-current259-document-application.cjs');
 await assert.rejects(runCurrent259GeneratedDocumentApplication(Object.freeze({ordinary:{}})),/HANDLE/u);
});

function model(failure){
 const fs=require('node:fs'),path=require('node:path');
 const trace=[],bindings=new Map();
 const token=Object.fromEntries(['PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor',
  'ContractDocumentService','ContractDraftController','FileService','JwtTokenService'].map(key=>[key,class {}]));
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
 async init(){trace.push('init');if(failure==='init')throw Error('private init');}};
 const loader={createDocumentTestingModule(){trace.push('build');return {
  overrideProvider(token){return {useValue(instance){bindings.set(token,instance);}};},
  async compile(){trace.push('compile');return testing;}
 };}};
 const loaded={...token,async listenApi(view,port,host){assert.equal(view,app);trace.push(['listen',port,host]);server.listening=true;},CONTRACT_VERSION_FILE_READ_AUTHORITY:authorityToken,configureApiSecurity(){trace.push('security');},
  configureProjectionExportJson(){trace.push('projection');},apiJsonReplacer(){},createApiValidationPipe(){return {};}};
 const bridge=Object.freeze({check(){},loader,loaded,ordinary,providers,async queue(...args){trace.push(['queue',...args]);return 77;},
  ...(['public','stuck-listener','public-fixed-error','public-other-error'].includes(failure)?{publicDraft:Object.freeze({})}:{}),
  ...(failure==='lifecycle'?{publicLifecycle:Object.freeze({})}:{}),
  async exercise(http){
   if(['public','stuck-listener','public-fixed-error','public-other-error','lifecycle'].includes(failure)){assert.deepEqual(http,{fixed:true});trace.push('exercise-public');
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
   mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live);assert.throws(()=>mod.exports.takeCurrent261LocalLifecycleHttpBridge(config,live),/HANDLE/u);trace.push('lifecycle-http');return consume({fixed:true});
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
   takeCurrent259CreationFailure(){return undefined;}
  }
 };
 const filename=path.join(__dirname,'task12-current259-document-application.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(id=>imports[id]??require(id),mod);
 return {api:mod.exports,bridge,token,bindings,trace,server,ordinary,originalShutdown,document,originalQueue,providers};
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
