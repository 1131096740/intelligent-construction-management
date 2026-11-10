"use strict";
// Explicit source-only component check after local offline install, generate and
// API/shared build. No client instance, connect/init/listen or database operation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {observeCurrent259Build,claimCurrent259Build}=require('./task16-current259-build.cjs');
const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
test('actual generated259 SDK/native engine/eight exports share one observed physical closure',()=>{
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
 const prior=process.env.PRISMA_QUERY_ENGINE_LIBRARY;
 try{process.env.PRISMA_QUERY_ENGINE_LIBRARY='synthetic-engine-override-not-used';assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED'&&!JSON.stringify(error).includes('synthetic-engine-override'));}
 finally{if(prior===undefined)delete process.env.PRISMA_QUERY_ENGINE_LIBRARY;else process.env.PRISMA_QUERY_ENGINE_LIBRARY=prior;}
 assert.throws(()=>loader.check(),/CURRENT259_LOADER/u); // A rejected material is not silently restored.
});
