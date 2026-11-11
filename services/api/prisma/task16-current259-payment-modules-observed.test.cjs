'use strict';
// Opt-in component: actual generated SDK/dependency code is loaded, never
// instantiated/connected; no Nest module compilation/init/listen or resource.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),fs=require('node:fs');
const {checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
const {observeCurrent259Build}=require('./task16-current259-build.cjs');
const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
test('real original fixture/cases and both lazy dependency functions are fixed before the loader is returned',()=>{
 const loader=loadCurrent259Client(observeCurrent259Build()),exports=loader.loadPaymentModules();
 const fixture=require('../dist/database/registered-payment-postgres.fixture.js'),cases=require('../dist/database/registered-payment-postgres.cases.js');
 for(const key of ['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','seedRegisteredPgAttributionGapFixture','assertRegisteredPgConnectedRoles','registeredPgHttp'])assert.equal(exports[key],fixture[key]);
 for(const key of ['registeredPaymentPostgresCases','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss','runRegisteredNullCrossCompanyCommitCancellation','runRegisteredProjectAttributionGap'])assert.equal(exports[key],cases[key]);
 assert.equal(loader.loadPaymentModules(),exports);loader.verifyFull();
 const root=path.resolve(__dirname,'../../..'),runtimeRoots=['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(p=>path.join(root,p)+path.sep);
 const rows=Object.keys(require.cache).filter(file=>runtimeRoots.some(p=>file.startsWith(p))).map(file=>{const st=fs.lstatSync(file,{bigint:true});return {file,identity:Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(st[k])]))};});
 const started=performance.now();for(let i=0;i<2;i++)for(const row of rows)checkCurrent259FileIdentity(row.file,row.identity);
 process.stdout.write(JSON.stringify({status:'ACTUAL_MODULE_FD_METADATA_OBSERVATION_ONLY',files:rows.length,passes:2,durationMs:performance.now()-started,nativeAdmission:false,resourceExecuted:false})+'\n');
 const rq=Module.createRequire(path.resolve(__dirname,'../package.json'));
 const key=process.env.TASK16_PAYMENT_DEPENDENCY_CASE==='uscc'?'assertValidUnifiedSocialCreditCode':'hash';
 const dependency=key==='hash'?rq('bcryptjs'):require('../dist/company-entity/unified-social-credit-code.js');
 const descriptor=Object.getOwnPropertyDescriptor(dependency,key);
 let reads=0;Object.defineProperty(dependency,key,{configurable:true,get(){reads++;return descriptor.value;}});
 try{assert.throws(()=>loader.check(),/CURRENT259_LOADER/u);assert.equal(reads,0);}finally{Object.defineProperty(dependency,key,descriptor);}
 assert.throws(()=>loader.check(),/CURRENT259_LOADER/u);
 process.stdout.write(JSON.stringify({status:'ORIGINAL_CONSUMER_EXPORTS_AND_SEED_DEPENDENCIES_BOUND',sdkConstructed:false,sqlExecuted:false,listenerStarted:false,stickyDependencyDescriptorRejection:key})+'\n');
});
