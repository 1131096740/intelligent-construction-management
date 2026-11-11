'use strict';
// Opt-in component: actual generated SDK/dependency code is loaded, never
// instantiated/connected; no Nest module compilation/init/listen or resource.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {observeCurrent259Build}=require('./task16-current259-build.cjs');
const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
test('real original fixture/cases and both lazy dependency functions are fixed before the loader is returned',()=>{
 const loader=loadCurrent259Client(observeCurrent259Build()),exports=loader.loadPaymentModules();
 const fixture=require('../dist/database/registered-payment-postgres.fixture.js'),cases=require('../dist/database/registered-payment-postgres.cases.js');
 for(const key of ['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','assertRegisteredPgConnectedRoles','registeredPgHttp'])assert.equal(exports[key],fixture[key]);
 for(const key of ['registeredPaymentPostgresCases','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss'])assert.equal(exports[key],cases[key]);
 assert.equal(loader.loadPaymentModules(),exports);loader.verifyFull();
 const rq=Module.createRequire(path.resolve(__dirname,'../package.json'));
 const key=process.env.TASK16_PAYMENT_DEPENDENCY_CASE==='uscc'?'assertValidUnifiedSocialCreditCode':'hash';
 const dependency=key==='hash'?rq('bcryptjs'):require('../dist/company-entity/unified-social-credit-code.js');
 const descriptor=Object.getOwnPropertyDescriptor(dependency,key);
 let reads=0;Object.defineProperty(dependency,key,{configurable:true,get(){reads++;return descriptor.value;}});
 try{assert.throws(()=>loader.check(),/CURRENT259_LOADER/u);assert.equal(reads,0);}finally{Object.defineProperty(dependency,key,descriptor);}
 assert.throws(()=>loader.check(),/CURRENT259_LOADER/u);
 process.stdout.write(JSON.stringify({status:'ORIGINAL_CONSUMER_EXPORTS_AND_SEED_DEPENDENCIES_BOUND',sdkConstructed:false,sqlExecuted:false,listenerStarted:false,stickyDependencyDescriptorRejection:key})+'\n');
});
