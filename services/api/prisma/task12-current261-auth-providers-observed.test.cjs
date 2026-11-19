"use strict";
// Explicit post-build component only. Real sealed loader/Nest composition with
// opaque DB/storage ports; no SDK instance/connect/init/listen/PG/business brand.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const runChild=promisify(execFile);
const {observeCurrent259Build}=require('./task16-current259-build.cjs');
const {loadCurrent259Client,createCurrent259OwnedApplication,current259OwnedApplicationView,inspectCurrent259OwnedDocumentAuthProviders}=require('./task16-current259-client-loader.cjs');
const frameworkChanged={code:'CURRENT259_FRAMEWORK_CHANGED',message:'CURRENT259_FRAMEWORK_CHANGED'};
const loaderChanged={code:'CURRENT259_LOADER_CHANGED',message:'CURRENT259_LOADER_CHANGED'};
async function withObservedScope(use){
 // Each call creates a new authentic build handle and owned loader state. No
 // failed state from another negative is adopted as this scope's baseline.
 const loader=loadCurrent259Client(observeCurrent259Build()),loaded=loader.loadGeneratedContractDocumentModules();
 const ordinary=Object.freeze({}),storage=Object.freeze({}),template=Object.freeze({}),worker=Object.freeze({});
 const builder=loader.createDocumentTestingModule();
 for(const [key,value]of [['PrismaService',ordinary],['PrivateFileStorage',storage],['LayoutTemplateService',template],['ContractDocumentProcessor',worker]])builder.overrideProvider(loaded[key]).useValue(value);
 const testing=await builder.compile();const application=createCurrent259OwnedApplication(testing),view=current259OwnedApplicationView(application),server=view.getHttpServer();
 try{
  const proof=inspectCurrent259OwnedDocumentAuthProviders(application,testing,server);
  assert.equal(proof.runtime,ordinary);assert.equal(proof.moduleRuntime,ordinary);
  assert.equal(proof.auth.prisma,ordinary);assert.equal(proof.rateLimits.prisma,ordinary);assert.equal(proof.authController.auth,proof.auth);
  assert.equal(proof.moduleAuth,proof.auth);assert.equal(proof.moduleAuthFilter,proof.authFilter);assert.equal(proof.moduleAuthInterceptor,proof.authInterceptor);assert.equal(proof.authInterceptor.filter,proof.authFilter);assert.equal(proof.verifyAuthDiagnosticReceiver(),true);
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,{},server),frameworkChanged);
  assert.equal(proof.verifyAuthDiagnosticReceiver(),true); // Wrong module must not poison the genuine scope.
  let traps=0;assert.equal(inspectCurrent259OwnedDocumentAuthProviders(new Proxy({}, {get(){traps++;throw Error('trap');}}),testing,server),undefined);assert.equal(traps,0);
  return await use({application,testing,view,server,proof});
 }finally{await view.close();}
}
const cases={wrongServer:async()=>{
 await withObservedScope(({application,testing,server})=>{
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,{}),frameworkChanged);
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),loaderChanged);
 });
},shadow:async()=>{
 await withObservedScope(({application,testing,server,proof})=>{
  Object.defineProperty(proof.auth,'login',{value(){},configurable:true});
  try{
   assert.throws(()=>proof.verifyAuthDiagnosticReceiver(),frameworkChanged);
   assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),loaderChanged);
  }finally{delete proof.auth.login;}
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),loaderChanged);
 });
},closed:async()=>{
 const {application,testing,server}=await withObservedScope(scope=>scope);
 // This first rejection is closed-owner identity, not another negative's latch.
 assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),frameworkChanged);
 assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),loaderChanged);
}};
const childCase=process.env.JG_TASK12_AUTH_OBSERVED_CASE;
if(childCase!==undefined){
 assert.ok(Object.hasOwn(cases,childCase),'Only a fixed observed component case may run');
 test('isolated observed AUTH '+childCase,cases[childCase]);
}else{
 for(const name of Object.keys(cases))test('fresh-process observed AUTH '+name,async()=>{
  // A fresh handle in the same Node graph is rightly PRELOADED. Isolate the
  // entire process instead; never delete require.cache or relax the original gate.
  const env={...process.env,JG_TASK12_AUTH_OBSERVED_CASE:name};delete env.NODE_TEST_CONTEXT;
  const output=await runChild(process.execPath,[__filename],{env,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  assert.equal(output.stderr,'');assert.match(output.stdout,/# tests 1\b/u);assert.match(output.stdout,/# pass 1\b/u);assert.match(output.stdout,/# fail 0\b/u);
 });
}
