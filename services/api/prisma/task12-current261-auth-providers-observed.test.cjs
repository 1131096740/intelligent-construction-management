"use strict";
// Explicit post-build component only. Real sealed loader/Nest composition with
// opaque DB/storage ports; no SDK instance/connect/init/listen/PG/business brand.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {observeCurrent259Build}=require('./task16-current259-build.cjs');
const {loadCurrent259Client,createCurrent259OwnedApplication,current259OwnedApplicationView,inspectCurrent259OwnedDocumentAuthProviders}=require('./task16-current259-client-loader.cjs');
test('the original owned document app inspects same ordinary AUTH receivers and rejects shadow methods',async()=>{
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
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,{},server),/CURRENT259_FRAMEWORK_CHANGED/u);
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,{}),/CURRENT259_FRAMEWORK_CHANGED/u);
  let traps=0;assert.equal(inspectCurrent259OwnedDocumentAuthProviders(new Proxy({}, {get(){traps++;throw Error('trap');}}),testing,server),undefined);assert.equal(traps,0);
  Object.defineProperty(proof.auth,'login',{value(){},configurable:true});
  assert.throws(()=>proof.verifyAuthDiagnosticReceiver(),/CURRENT259_FRAMEWORK_CHANGED/u);
  assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),/CURRENT259_FRAMEWORK_CHANGED/u);
  delete proof.auth.login;
 }finally{await view.close();}
 assert.throws(()=>inspectCurrent259OwnedDocumentAuthProviders(application,testing,server),/CURRENT259_FRAMEWORK_CHANGED/u);
});
