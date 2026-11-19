"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
test('plain metadata and flipped native flags cannot act as an observed259 build',()=>{
 const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
 assert.throws(()=>loadCurrent259Client({native:true,copyEngine:true,nativeRuntimeQualification:true,sourceSha:'a'.repeat(40)}),/CURRENT259_BUILD_HANDLE/u);
});
for(const key of ['NODE_OPTIONS','NODE_PATH','PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_QUERY_ENGINE_BINARY','PRISMA_SCHEMA_ENGINE_BINARY','PRISMA_CLIENT_ENGINE_TYPE','PRISMA_CLI_QUERY_ENGINE_TYPE'])test(`the new material refuses the ${key} override before inspecting source`,()=>{
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');const prior=process.env[key];
 try{process.env[key]='synthetic-override-must-not-be-projected';assert.throws(()=>observeCurrent259Build(),error=>error.code==='CURRENT259_BUILD_ENVIRONMENT'&&!JSON.stringify(error).includes('synthetic-override'));}
 finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
});
test('an accessor or copied object never acquires the private build brand',()=>{
 const {claimCurrent259Build}=require('./task16-current259-build.cjs');let called=0;
 const fake={get native(){called++;return true;}};
 assert.throws(()=>claimCurrent259Build(fake),/CURRENT259_BUILD_HANDLE/u);assert.equal(called,0);
 assert.throws(()=>claimCurrent259Build(new Proxy({},{get(){called++;}})),/CURRENT259_BUILD_HANDLE/u);assert.equal(called,0);
});

test('the material producer and loader accept no custom root, builder or constructor port',()=>{
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');
 const {loadCurrent259Client}=require('./task16-current259-client-loader.cjs');
 assert.throws(()=>observeCurrent259Build({root:'/detached',native:true}),/CURRENT259_BUILD_ARGUMENTS/u);
 assert.throws(()=>loadCurrent259Client({},()=>class ForeignClient{}),/CURRENT259_LOADER_ARGUMENTS/u);
});
