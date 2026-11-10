"use strict";
// Explicit source-only component check after local offline install, generate and
// API/shared build. No client instance, connect/init/listen or database operation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {observeCurrent259Build,claimCurrent259Build}=require('./task16-current259-build.cjs');
const {types}=require('node:util');
const {loadCurrent259Client,createCurrent259OwnedApplication,current259OwnedApplicationMethod,current259OwnedApplicationView}=require('./task16-current259-client-loader.cjs');
test('actual generated259 SDK/native engine/eight exports share one observed physical closure',async()=>{
 const handle=observeCurrent259Build();assert.equal(handle.executionAllowed,false);
 const loader=loadCurrent259Client(handle);assert.equal(loadCurrent259Client(handle),loader);
 assert.equal(typeof loader.Class,'function');assert.equal(Object.getPrototypeOf(loader.PrismaService),loader.Class);
 assert.ok(loader.constructorContract.startsWith('IMPLICIT_DERIVED_CONSTRUCTOR_FORWARDS_OPTIONS'));
 const request=['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'].map((p,i)=>({name:['application','database','security','projection','json','validation','listen'][i],path:'services/api/dist/'+p}));
 const first=loader.loadApplicationModules(request);assert.equal(loader.loadApplicationModules(request),first);
 assert.equal(first.PrismaService,loader.PrismaService);assert.equal(first.Test,loader.Test);
 for(const key of ['Task16RegisteredApplicationModule','PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi','Test'])assert.equal(typeof first[key],'function');
 assert.equal(typeof first.Task16ImpactReaderToken,'symbol');
 const auth=Reflect.getMetadata('imports',first.Task16RegisteredApplicationModule)[1];
 assert.deepEqual(Reflect.getMetadata('providers',auth).filter(row=>row.provide==='APP_GUARD').map(row=>row.useClass.name),['JwtAuthGuard','RetiredWriteEntryGuard','OperationalWriteFreezeGuard','AccountRateLimitGuard','PermissionGuard','ContractCutoverGuard']);
 assert.throws(()=>claimCurrent259Build(handle),/CURRENT259_BUILD_HANDLE/u);
 assert.throws(()=>loadCurrent259Client({...handle}),/CURRENT259_BUILD_HANDLE/u);
 loader.verifyFull();const witness=loader.witness();assert.equal(witness.executionAllowed,false);assert.ok(witness.modules>100);assert.equal(witness.engineCommit,'605197351a3c8bdd595af2d2a9bc3025bca48ea2');
 process.stdout.write(JSON.stringify({status:'ACTUAL_HOST_BUILD_CLOSURE_OBSERVED_NOT_DB_AUTHORITY',source:{candidateSha:witness.source.candidateSha,tree:witness.source.tree,sourceSealSha256:witness.source.sourceSealSha256},build:witness.build,modules:witness.modules,engineCommit:witness.engineCommit})+'\n');
 // Real Nest createNestApplication returns an adapter Proxy. Only the loader's
 // original TestingModule method can issue its private raw-target ownership.
 const testing=await loader.createTestingModule({imports:[]}).compile();
 const descriptor=Object.getOwnPropertyDescriptor(testing,'createAdapterProxy');
 const application=createCurrent259OwnedApplication(testing);
 assert.equal(types.isProxy(application),true);
 assert.deepEqual(Object.getOwnPropertyDescriptor(testing,'createAdapterProxy'),descriptor);
 assert.throws(()=>createCurrent259OwnedApplication(testing),/CURRENT259_FRAMEWORK_REENTRY/u);
 const view=current259OwnedApplicationView(application);
 assert.ok(Object.isFrozen(view));assert.equal(view.getHttpAdapter,current259OwnedApplicationMethod(application,'getHttpAdapter'));
 const chain=view.useGlobalPipes();if(chain!==view)await current259OwnedApplicationMethod(application,'close')();
 assert.ok(chain===view,'owned framework fluent return must retain the view');
 first.configureApiSecurity(view);first.configureProjectionExportJson(view);
 assert.equal(view.getHttpAdapter().getInstance().enabled('x-powered-by'),false);
 let traps=0;const foreign=new Proxy({}, {get(){traps++;throw new Error('foreign getter');},getOwnPropertyDescriptor(){traps++;throw new Error('foreign descriptor');}});
 assert.equal(current259OwnedApplicationMethod(foreign,'close'),undefined);assert.equal(current259OwnedApplicationView(foreign),undefined);assert.equal(traps,0);
 assert.equal(current259OwnedApplicationMethod(application,'unknown'),undefined);
 const close=current259OwnedApplicationMethod(application,'close');await close();await close();
 assert.throws(()=>view.getHttpAdapter(),/CURRENT259_FRAMEWORK_CHANGED/u);
 loader.verifyFull();
 process.stdout.write(JSON.stringify({status:'ACTUAL_NEST_OWNED_PROXY_CLOSED',descriptorRestored:true,foreignProxyTraps:traps,initialized:false,listening:false,databaseClientConstructed:false})+'\n');
 const changed=await loader.createTestingModule({imports:[]}).compile();let getterReads=0,creationError;
 Object.defineProperty(changed,'createHttpAdapter',{configurable:true,get(){getterReads++;return()=>{throw new Error('synthetic getter must not execute');};}});
 try{createCurrent259OwnedApplication(changed);}catch(error){creationError=error;}finally{delete changed.createHttpAdapter;await changed.close();}
 assert.equal(getterReads,0,'foreign framework hook getter must be rejected before invocation');
 assert.ok(creationError,'changed framework hook must not create an application');
 const prior=process.env.PRISMA_QUERY_ENGINE_LIBRARY;
 try{process.env.PRISMA_QUERY_ENGINE_LIBRARY='synthetic-engine-override-not-used';assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED'&&!JSON.stringify(error).includes('synthetic-engine-override'));}
 finally{if(prior===undefined)delete process.env.PRISMA_QUERY_ENGINE_LIBRARY;else process.env.PRISMA_QUERY_ENGINE_LIBRARY=prior;}
 assert.throws(()=>loader.check(),/CURRENT259_LOADER/u); // A rejected material is not silently restored.
});
