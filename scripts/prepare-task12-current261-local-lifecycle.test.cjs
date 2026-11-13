'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
test('pending official runtime refuses lifecycle plan issuance before build loading or artifact writes',t=>{
 const root=fs.mkdtempSync('/private/tmp/jg-life-plan-model-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const beforeCache=new Set(Object.keys(require.cache));
 const api=require('./prepare-task12-current261-local-lifecycle.cjs');
 assert.throws(()=>api.prepareCurrent261LocalLifecyclePlan({packetRoot:root,daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:path.join(root,'runtime-input.json'),sha256:'a'.repeat(64)}}),error=>error.code==='TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING');
 assert.deepEqual(fs.readdirSync(root),[]);
 assert.deepEqual(Object.keys(require.cache).filter(file=>!beforeCache.has(file)&&/\/node_modules\/|\/services\/api\/dist\//u.test(file)),[]);
});
test('publication is only a preflight: fresh loader owns modules before formal verifier can issue a plan',()=>{
 let mode='stop';const vm=require('node:vm'),events=[],view=Object.freeze({}),source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64)};
 const loader={witness:()=>({source,build:{},host:'model',engineCommit:'model'}),loadCurrent261LocalLifecycleDocumentModules(){events.push('modules');return view;},verifyFull(){events.push('full');}};
 const modules={
  '../services/api/prisma/task12-current259-generated-document-runtime.cjs':{
   observeOfficialTask12DocumentPublication(){events.push('publication');return {ready:true,profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1'};},
   verifyOfficialTask12DocumentRuntime(file,sha,actual){events.push('formal');assert.equal(actual,view);if(mode==='stop')throw new Error('MODEL_STOP_FORMAL');return {kind:'OFFICIAL_TOOL_RUNTIME',profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',inputSha256:sha,source:{head:'e'.repeat(40),tree:source.tree,sha256:'f'.repeat(64),files:1}};},
   withOfficialTask12DocumentRuntime(){}},
  '../services/api/prisma/task12-current259-contract-login.cjs':{},
  '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){events.push('build');return{};}},
  '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(){events.push('loader');return loader;}},
  '../services/api/prisma/task12-current261-local-lifecycle-scope.cjs':{describeCurrent261LocalLifecycle(){return{};}}
 };
 const module={exports:{}};const body=fs.readFileSync(path.join(__dirname,'prepare-task12-current261-local-lifecycle.cjs'),'utf8').replace(/^#![^\n]*\n/u,'');vm.runInThisContext('(function(module,exports,require){'+body+'\n})')(module,module.exports,name=>Object.hasOwn(modules,name)?modules[name]:require(name));
 assert.throws(()=>module.exports.prepareCurrent261LocalLifecyclePlan({packetRoot:'/private/tmp/model',daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:'/private/tmp/model/runtime-input.json',sha256:'d'.repeat(64)}}),/MODEL_STOP_FORMAL/u);
 assert.deepEqual(events,['publication','build','loader','modules','formal']);
 mode='wrong-source';events.length=0;
 assert.throws(()=>module.exports.prepareCurrent261LocalLifecyclePlan({packetRoot:'/private/tmp/model',daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:'/private/tmp/model/runtime-input.json',sha256:'d'.repeat(64)}}),error=>error.code==='CURRENT261_LOCAL_LIFECYCLE_PLAN_RUNTIME_SOURCE');
 assert.deepEqual(events,['publication','build','loader','modules','formal','full']);
});
for(const profile of ['TASK12_OFFICIAL_TEMURIN17_0_17_10_V1','TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2'])test('separate fresh preparation and verification bind the exact '+profile+' scope',t=>{
 const vm=require('node:vm'),root=fs.mkdtempSync('/private/tmp/jg-life-plan-positive-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['lifecycle-run','tool-run'])fs.mkdirSync(path.join(root,directory),{mode:0o700});
 const sha=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex'),source={candidateSha:'1'.repeat(40),tree:'2'.repeat(40),sourceSealSha256:'3'.repeat(64),profile:{profile:'TASK12_ARCHIVE261_SOURCE_V1'}};
 const sourceWitness={head:source.candidateSha,tree:source.tree,sha256:'4'.repeat(64),files:100};
 const runtimeFile=path.join(root,'runtime-input.json'),runtimeBytes=Buffer.from(JSON.stringify({profile,purpose:'TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1',source:sourceWitness,runRoot:path.join(root,'tool-run')}));fs.writeFileSync(runtimeFile,runtimeBytes,{mode:0o600});
 let captures=0;
 function fresh(){
  const view=Object.freeze({}),handle=Object.freeze({}),loader={witness:()=>({source,build:{sealed:true},host:'MODEL',engineCommit:'MODEL'}),loadCurrent261LocalLifecycleDocumentModules:()=>view,verifyFull(){}};
  const modules={
   '../services/api/prisma/task12-current259-generated-document-runtime.cjs':{observeOfficialTask12DocumentPublication(){return{profile};},verifyOfficialTask12DocumentRuntime(file,digest,v){assert.equal(file,runtimeFile);assert.equal(digest,sha(runtimeBytes));assert.equal(v,view);return{kind:'OFFICIAL_TOOL_RUNTIME',profile,inputSha256:digest,source:sourceWitness,...Object.fromEntries(['candidateLockSha256','buildSha256','materialSha256','machineReceiptSha256','physicalReviewSha256'].map(k=>[k,'5'.repeat(64)]))};},withOfficialTask12DocumentRuntime(){}},
   '../services/api/prisma/task12-current259-contract-login.cjs':{},
   '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){captures++;return handle;}},
   '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client:h=>{assert.equal(h,handle);return loader;}},
   '../services/api/prisma/task12-current261-local-lifecycle-scope.cjs':{describeCurrent261LocalLifecycle:()=>({purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',runtimeProfile:profile,storage:'LOCAL_ONLY'})}
  };
  const module={exports:{}},body=fs.readFileSync(path.join(__dirname,'prepare-task12-current261-local-lifecycle.cjs'),'utf8').replace(/^#![^\n]*\n/u,'');vm.runInThisContext('(function(module,exports,require){'+body+'\n})')(module,module.exports,name=>Object.hasOwn(modules,name)?modules[name]:require(name));return{api:module.exports,handle};
 }
 const options={packetRoot:root,daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:runtimeFile,sha256:sha(runtimeBytes)}};
 const first=fresh(),prepared=first.api.prepareCurrent261LocalLifecyclePlan(options),second=fresh(),verified=second.api.verifyCurrent261LocalLifecyclePlan(prepared.file,prepared.sha256);
 assert.equal(captures,2);assert.notEqual(first.handle,second.handle);assert.equal(verified.buildHandle,second.handle);verified.check();
 assert.equal(verified.plan.source.sourceSealSha256,'3'.repeat(64));assert.equal(verified.plan.runtime.sourceWitness.sha256,'4'.repeat(64));assert.equal(verified.plan.runtime.runRoot,path.join(root,'tool-run'));
 assert.equal(fs.readdirSync(path.join(root,'lifecycle-run')).length,0);assert.equal(fs.readdirSync(path.join(root,'tool-run')).length,0);
 fs.appendFileSync(runtimeFile,'\n');assert.throws(()=>verified.check(),/CHANGED/u);
});
