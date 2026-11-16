'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
test('registered but stale-source official runtime refuses lifecycle plan issuance before build loading or artifact writes',t=>{
 const root=fs.mkdtempSync('/private/tmp/jg-life-plan-model-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const beforeCache=new Set(Object.keys(require.cache));
 const api=require('./prepare-task12-current261-local-lifecycle.cjs');
 assert.throws(()=>api.prepareCurrent261LocalLifecyclePlan({packetRoot:root,daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:path.join(root,'runtime-input.json'),sha256:'a'.repeat(64)}}),error=>error.code==='TASK12_OFFICIAL_DOCUMENT_REGISTRY');
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
for(const profile of ['TASK12_OFFICIAL_TEMURIN17_0_17_10_V1','TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2'])for(const authOnly of [false,true,'inside:equipment_rental'])test('separate fresh preparation and verification bind the exact '+profile+' scope authOnly='+authOnly,t=>{
 const vm=require('node:vm'),root=fs.mkdtempSync('/private/tmp/jg-life-plan-positive-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['lifecycle-run','tool-run'])fs.mkdirSync(path.join(root,directory),{mode:0o700});
 const sha=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex'),source={candidateSha:'1'.repeat(40),tree:'2'.repeat(40),sourceSealSha256:'3'.repeat(64),profile:{profile:'TASK12_ARCHIVE261_SOURCE_V1'}};
 const sourceWitness={head:source.candidateSha,tree:source.tree,sha256:'4'.repeat(64),files:100};
 const runtimeFile=path.join(root,'runtime-input.json'),runtimeBytes=Buffer.from(JSON.stringify({profile,purpose:'TASK12_GENERATED_LIFECYCLE_LOCAL_ONLY_V1',source:sourceWitness,runRoot:path.join(root,'tool-run')}));fs.writeFileSync(runtimeFile,runtimeBytes,{mode:0o600});
 let captures=0;
 function fresh(){
  const view=Object.freeze({}),handle=Object.freeze({}),loader={witness:()=>({source,build:{sealed:true},host:'MODEL',engineCommit:'MODEL'}),loadCurrent261LocalLifecycleDocumentModules:()=>view,loadCurrent261FirstLoginModules:()=>view,verifyFull(){}};
  const modules={
   '../services/api/prisma/task12-current259-generated-document-runtime.cjs':{observeOfficialTask12DocumentPublication(){return{profile};},verifyOfficialTask12DocumentRuntime(file,digest,v){assert.equal(file,runtimeFile);assert.equal(digest,sha(runtimeBytes));assert.equal(v,view);return{kind:'OFFICIAL_TOOL_RUNTIME',profile,inputSha256:digest,source:sourceWitness,...Object.fromEntries(['candidateLockSha256','buildSha256','materialSha256','machineReceiptSha256','physicalReviewSha256'].map(k=>[k,'5'.repeat(64)]))};},withOfficialTask12DocumentRuntime(){}},
   '../services/api/prisma/task12-current259-contract-login.cjs':{},
   '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){captures++;return handle;}},
   '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client:h=>{assert.equal(h,handle);return loader;}},
   '../services/api/prisma/task12-current261-local-lifecycle-scope.cjs':{describeCurrent261LocalLifecycleCase:(source,selectedProfile,key)=>({purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',runtimeProfile:selectedProfile,caseKey:key,contractTypeKey:'equipment_rental',relationship:'inside',storage:'LOCAL_ONLY'}),describeCurrent261LocalLifecycle:()=>({purpose:'CURRENT261_GENERATED_LIFECYCLE_LOCAL',runtimeProfile:profile,storage:'LOCAL_ONLY'}),describeCurrent261FirstLogin:()=>({purpose:'CURRENT261_FIRST_LOGIN_AUTH_ONLY_DIAGNOSTIC',runtimeProfile:profile,storage:'LOCAL_ONLY',executionPurpose:'AUTH_ONLY_DIAGNOSTIC'})}
  };
  const module={exports:{}},body=fs.readFileSync(path.join(__dirname,'prepare-task12-current261-local-lifecycle.cjs'),'utf8').replace(/^#![^\n]*\n/u,'');vm.runInThisContext('(function(module,exports,require){'+body+'\n})')(module,module.exports,name=>Object.hasOwn(modules,name)?modules[name]:require(name));return{api:module.exports,handle};
 }
 const options={packetRoot:root,daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-13',runtime:{file:runtimeFile,sha256:sha(runtimeBytes)}};
 const matrix=typeof authOnly==='string';if(matrix)options.caseKey=authOnly;
 const first=fresh(),prepared=(matrix?first.api.prepareCurrent261LifecycleCasePlan:authOnly?first.api.prepareCurrent261FirstLoginPlan:first.api.prepareCurrent261LocalLifecyclePlan)(options),second=fresh(),verified=(matrix?second.api.verifyCurrent261LifecycleCasePlan:authOnly?second.api.verifyCurrent261FirstLoginPlan:second.api.verifyCurrent261LocalLifecyclePlan)(prepared.file,prepared.sha256);

 assert.throws(()=>(authOnly?second.api.verifyCurrent261LocalLifecyclePlan:second.api.verifyCurrent261FirstLoginPlan)(prepared.file,prepared.sha256),/INPUT/u);
 assert.equal(captures,2);assert.notEqual(first.handle,second.handle);assert.equal(verified.buildHandle,second.handle);verified.check();
 assert.equal(verified.plan.source.sourceSealSha256,'3'.repeat(64));assert.equal(verified.plan.runtime.sourceWitness.sha256,'4'.repeat(64));assert.equal(verified.plan.runtime.runRoot,path.join(root,'tool-run'));
 assert.equal(fs.readdirSync(path.join(root,'lifecycle-run')).length,0);assert.equal(fs.readdirSync(path.join(root,'tool-run')).length,0);
 if(matrix){
  assert.equal(verified.plan.version,2);assert.equal(verified.plan.case.key,authOnly);assert.equal(verified.plan.case.contractTypeKey,'equipment_rental');assert.equal(verified.plan.scope.caseKey,authOnly);assert.equal(path.basename(prepared.file),'MATRIX-CASE-PLAN.json');
  const original=fs.readFileSync(prepared.file);
  for(const mutate of [plan=>{plan.case.contractTypeKey='material_purchase';},plan=>{plan.case.key='inside:material_purchase';},plan=>{plan.scope.contractTypeKey='material_purchase';},plan=>{plan.version=1;}]){
   const changed=JSON.parse(original);mutate(changed);const bytes=Buffer.from(JSON.stringify(changed));fs.writeFileSync(prepared.file,bytes);
   assert.throws(()=>fresh().api.verifyCurrent261LifecycleCasePlan(prepared.file,sha(bytes)),/SCOPE/u);
  }
  fs.writeFileSync(prepared.file,original);
 }
 fs.appendFileSync(runtimeFile,'\n');assert.throws(()=>verified.check(),/CHANGED/u);
});

test('public case catalog CLI exposes the fixed fifteen genuine business coordinates without runtime admission',()=>{
 const {execFileSync}=require('node:child_process');
 const output=execFileSync(process.execPath,[path.join(__dirname,'prepare-task12-current261-local-lifecycle.cjs'),'--list-cases'],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin'},timeout:10000});
 const value=JSON.parse(output);
 assert.equal(value.status,'CURRENT261_LIFECYCLE_CASE_CATALOG');assert.equal(value.nativeAdmission,false);
 assert.deepEqual(value.cases.map(row=>row.key),[
  'inside:material_purchase','inside:equipment_rental','inside:labor_subcontract','inside:professional_subcontract','inside:other',
  'outside:material_purchase','outside:equipment_rental','outside:labor_subcontract','outside:professional_subcontract','outside:other',
  'upward:material_purchase','upward:equipment_rental','upward:labor_subcontract','upward:professional_subcontract','upward:other']);
 assert.equal(value.cases[1].contractTypeKey,'equipment_rental');assert.equal(value.cases[1].relationship,'inside');
 assert.equal(value.cases[1].approvalDuties[0].roleKeys[0],'material_director');
 assert.ok(value.cases.every(row=>row.nativeAdmission===false&&row.executionAllowed===false));
});


test('an unimplemented matrix cell is rejected before official qualification or SDK loading, never relabelled material',()=>{
 const api=require('./prepare-task12-current261-local-lifecycle.cjs');
 assert.throws(()=>api.prepareCurrent261LifecycleCasePlan({packetRoot:'/private/tmp/NOT_CREATED',daemonId:'model-daemon-00000001',caseId:'12345678-1234-4234-8234-123456789012',businessDate:'2026-11-15',runtime:{file:'/private/tmp/NOT_CREATED/runtime-input.json',sha256:'a'.repeat(64)},caseKey:'outside:equipment_rental'}),{code:'CURRENT261_LOCAL_LIFECYCLE_PLAN_CASE_PENDING'});
});
