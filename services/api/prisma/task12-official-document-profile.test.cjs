'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const runtime = require('./task12-current259-generated-document-runtime.cjs');

test('pending official JDK profile cannot issue runtime evidence or execute a caller', async () => {
  assert.throws(() => runtime.verifyOfficialTask12DocumentRuntime('/private/tmp/no-input', '0'.repeat(64), Object.freeze({})),
    { code: 'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING' });
});

test('an unverified qualification scope cannot select the candidate converter lock', async () => {
  const profile = require('./task12-official-document-profile.cjs');
  assert.equal(profile.currentOfficialDocumentScope(), undefined);
  await assert.rejects(profile.withOfficialDocumentQualification(Object.freeze({ profile: 'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1' }),
    () => assert.fail('unverified scope must not run')), { code: 'TASK12_OFFICIAL_DOCUMENT_SCOPE' });
  process.env.TASK12_DOCUMENT_RUNTIME_PROFILE = 'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1';
  try { assert.equal(profile.currentOfficialDocumentScope(), undefined); }
  finally { delete process.env.TASK12_DOCUMENT_RUNTIME_PROFILE; }
});

test('qualification admission rejects a forged packet before creating a scope', () => {
  const profile = require('./task12-official-document-profile.cjs');
  assert.throws(() => profile.inspectOfficialDocumentQualification('/private/tmp/does-not-exist', '0'.repeat(64)),
    { code: 'TASK12_OFFICIAL_DOCUMENT_INPUT' });
  assert.equal(profile.currentOfficialDocumentScope(), undefined);
});

test('actual official packet seam isolates concurrent scopes and revokes late work', async () => {
  const {api,packet}=require('./task12-official-document-model.test-support.cjs').model();
  const a=packet(),b=packet(),pa=api.inspectOfficialDocumentQualification(a.name,a.sha256),pb=api.inspectOfficialDocumentQualification(b.name,b.sha256);
  let release,late,retained; const gate=new Promise(resolve=>{release=resolve;});
  let resume;const lateGate=new Promise(resolve=>{resume=resolve;});
  const before={...process.env};
  const first=api.withOfficialDocumentQualification(pa,async scope=>{
    retained=scope.check;
    late=(async()=>{await lateGate;return api.currentOfficialDocumentScope();})();
    await gate; return api.currentOfficialDocumentScope().manifestPath;
  });
  const second=api.withOfficialDocumentQualification(pb,async()=>{release();return api.currentOfficialDocumentScope().manifestPath;});
  const results=await Promise.all([first,second]);
  assert.notEqual(results[0],results[1]);assert.deepEqual({...process.env},before);
  resume();await assert.rejects(late,{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
  assert.throws(retained,{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
  await assert.rejects(api.withOfficialDocumentQualification(pa,()=>{}),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
});

test('a fixed modeled JDK link cannot change target after qualification inspection', async () => {
  const {api,packet,files}=require('./task12-official-document-model.test-support.cjs').model({jdkLink:true});
  const input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
  await assert.rejects(api.withOfficialDocumentQualification(proof,async scope=>{
    // Same inode, mode and byte length: the link target itself must be checked.
    files.get('/private/tmp/jdk/001').bytes=Buffer.from('002');
    scope.check();
  }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});

test('official packet rejects wrong profile, source, build, material inventory and document pins', () => {
  const {api,packet,files}=require('./task12-official-document-model.test-support.cjs').model();
  const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
  const cases=[
    [plan=>{plan.profile='CURRENT259_GENERATED_DOCUMENT_RUNTIME_V1';},'INPUT'],
    [plan=>{plan.source.head='c'.repeat(40);},'SOURCE'],
    [plan=>{plan.build.sha256='0'.repeat(64);},'BUILD'],
    [plan=>{plan.runtime.body25.classes.pop();},'FILES'],
    [plan=>{plan.runtime.body25.fonts.push(plan.runtime.body25.fonts[0]);},'FILES'],
    [plan=>{plan.document.sha256='0'.repeat(64);},'DOCUMENT']
  ];
  for(const [change,code] of cases) {
    const input=packet(),plan=JSON.parse(JSON.stringify(input.plan));change(plan);
    const bytes=Buffer.from(JSON.stringify(plan));files.get(input.name).bytes=bytes;
    assert.throws(()=>api.inspectOfficialDocumentQualification(input.name,sha(bytes)),{code:'TASK12_OFFICIAL_DOCUMENT_'+code});
  }
});

test('scope detects changed bytes even when a modeled filesystem preserves the initial identity', async () => {
  const {api,packet,files}=require('./task12-official-document-model.test-support.cjs').model();
  const input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
  await assert.rejects(api.withOfficialDocumentQualification(proof,async scope=>{
    files.get('/private/tmp/jdk/000').bytes=Buffer.from('bad');
    scope.checkMaterials();
  }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});

test('pending official runtime scope cannot be entered with JSON or qualification-only evidence', async () => {
  await assert.rejects(runtime.withOfficialTask12DocumentRuntime({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1'},
    '/private/tmp/no-root',()=>assert.fail('pending must never run')), {code:'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING'});
});


test('publication preflight rejects pending without loading any application build or dependency',()=>{
  const before=new Set(Object.keys(require.cache));
  assert.throws(()=>runtime.observeOfficialTask12DocumentPublication('/private/tmp/no-input','0'.repeat(64)),{code:'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING'});
  assert.deepEqual(Object.keys(require.cache).filter(name=>!before.has(name)&&(/\/dist\//u.test(name)||/\/node_modules\//u.test(name))),[]);
});


test('publication is pure filesystem and only opaque same-root modules permit a fresh one-use runtime proof',async()=>{
  const model=require('./task12-official-document-model.test-support.cjs').model(),{api,moduleView,loaded}=model;
  const input=model.publish();loaded.length=0;
  const observation=api.observeOfficialTask12DocumentPublication(input.name,input.sha256);
  assert.equal(observation.status,'PUBLICATION_OBSERVED_NOT_RUNTIME_AUTHORITY');
  assert.equal(loaded.some(name=>name.includes('/dist/')||name==='pizzip'||name.includes('client-loader')),false);
  await assert.rejects(api.withOfficialTask12DocumentRuntime(observation,input.runRoot,()=>assert.fail('description is not authority')),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
  assert.throws(()=>api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,{...moduleView}),{code:'TASK12_OFFICIAL_DOCUMENT_REGISTRY'});
  const proof=api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,moduleView);
  assert.equal(proof.source.head,'c'.repeat(40));assert.equal(proof.inputSha256,input.sha256);
  await api.withOfficialTask12DocumentRuntime(proof,input.runRoot,async scope=>{assert.equal(api.currentOfficialDocumentScope(),scope);});
  await assert.rejects(api.withOfficialTask12DocumentRuntime(proof,input.runRoot,()=>{}),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
});

test('a captured runtime module lease cannot outlive loader continuity',async()=>{
  const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.publish();
  const proof=model.api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,model.moduleView);
  model.leaseState.active=false;
  await assert.rejects(model.api.withOfficialTask12DocumentRuntime(proof,input.runRoot,()=>assert.fail('revoked modules must not run')),{code:'CURRENT259_LOADER_CHANGED'});
});


test('retained full material check cannot cross into another live official scope',async()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),a=model.packet(),b=model.packet();
 const pa=model.api.inspectOfficialDocumentQualification(a.name,a.sha256),pb=model.api.inspectOfficialDocumentQualification(b.name,b.sha256);
 let retained,ready,release;const prepared=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 const first=model.api.withOfficialDocumentQualification(pa,async scope=>{retained=scope.checkMaterials;ready();await gate;});
 await prepared;
 await model.api.withOfficialDocumentQualification(pb,async()=>{assert.throws(retained,{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});release();});
 await first;
});

test('same-inode same-size byte replacement and restoration still revokes cheap continuity',async()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet();
 const proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256);
 await assert.rejects(model.api.withOfficialDocumentQualification(proof,async scope=>{
   const file=model.files.get('/private/tmp/jdk/000'),original=file.bytes;file.bytes=Buffer.from('bad');file.bytes=original;file.ctimeMs=2;
   scope.check();
 }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});


test('full loadable LO and CPython trees remain byte-bound, not just executable pins',async()=>{
 const paths=['/private/tmp/runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/fixed-0000','/private/tmp/python-runtime/fixed-0000'];
 for(const path of paths){
  const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet();
  const proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256);
  await assert.rejects(model.api.withOfficialDocumentQualification(proof,async scope=>{
    const file=model.files.get(path);file.bytes=Buffer.from('installation model fail');scope.checkMaterials();
  }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
 }
});


test('genuine module views from another physical source root or head are rejected before runtime branding',()=>{
 for(const options of [{leaseRoot:'/private/tmp/foreign-source'},{leaseSource:{candidateSha:'0'.repeat(40),tree:'d'.repeat(40)}}]){
  const model=require('./task12-official-document-model.test-support.cjs').model(options),input=model.publish();
  assert.throws(()=>model.api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,model.moduleView),{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
 }
});

test('loaded authority control bytes remain bound at each full child boundary',async()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet();
 const proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256);
 await assert.rejects(model.api.withOfficialDocumentQualification(proof,async scope=>{
  const path=require('node:path').join(__dirname,'task16-current259-client-loader.cjs');
  model.files.get(path).bytes=Buffer.from('changed authority control');scope.checkMaterials();
 }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});


test('matching executable bytes do not permit setuid or setgid regular files',()=>{
 for(const mode of [0o104755,0o102755]){
  const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet();
  model.files.get('/Users/leoyang/.nvm/versions/node/v20.20.2/bin/node').mode=mode;
  assert.throws(()=>model.api.inspectOfficialDocumentQualification(input.name,input.sha256),{code:'TASK12_OFFICIAL_DOCUMENT_BUILD_NODE'});
 }
});
