'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const runtime = require('./task12-current259-generated-document-runtime.cjs');
const registered=require('./task12-official-document-qualification-registry.json').qualification!==null;

test('missing or stale official input cannot issue runtime evidence or execute a caller', async () => {
  assert.throws(() => runtime.verifyOfficialTask12DocumentRuntime('/private/tmp/no-input', '0'.repeat(64), Object.freeze({})),
    { code: registered?'TASK12_OFFICIAL_DOCUMENT_REGISTRY':'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING' });
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
    '/private/tmp/no-root',()=>assert.fail('pending must never run')), {code:registered?'TASK12_OFFICIAL_DOCUMENT_SCOPE':'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING'});
});


test('publication preflight rejects pending without loading any application build or dependency',()=>{
  const before=new Set(Object.keys(require.cache));
  assert.throws(()=>runtime.observeOfficialTask12DocumentPublication('/private/tmp/no-input','0'.repeat(64)),{code:registered?'TASK12_OFFICIAL_DOCUMENT_REGISTRY':'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING'});
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


test('a verifier clone outside the canonical module cache cannot issue authority',()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.publish();
 const file=require('node:path').join(__dirname,'task12-official-document-profile.cjs');
 model.moduleCache[file]={exports:{...model.moduleCache[file].exports}};
 assert.throws(()=>model.api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,model.moduleView),{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
});

test('a canonical profile cache replacement revokes a retained scope before any later child',async()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet();
 const proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256);
 await assert.rejects(model.api.withOfficialDocumentQualification(proof,async scope=>{
  delete model.moduleCache[require('node:path').join(__dirname,'task12-official-document-profile.cjs')];scope.checkMaterials();
 }),{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
});


test('actual Module._compile source clones cannot issue qualification evidence',()=>{
 const fs=require('node:fs'),Module=require('node:module'),file=require('node:path').join(__dirname,'task12-official-document-profile.cjs');
 const clone=new Module(file,module);clone.filename=file;clone.paths=module.paths;clone._compile(fs.readFileSync(file,'utf8'),file);
 assert.throws(()=>clone.exports.inspectOfficialDocumentQualification('/private/tmp/no-input','0'.repeat(64)),{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
});

test('restoring cache identity after an observed replacement does not revive authority',async()=>{
 const model=require('./task12-official-document-model.test-support.cjs').model(),input=model.packet(),file=require('node:path').join(__dirname,'task12-official-document-profile.cjs');
 const proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256),original=model.moduleCache[file];
 await assert.rejects(model.api.withOfficialDocumentQualification(proof,async scope=>{
  delete model.moduleCache[file];assert.throws(scope.check,{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
  model.moduleCache[file]=original;assert.throws(scope.checkMaterials,{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
 }),{code:'TASK12_OFFICIAL_DOCUMENT_MODULES'});
});


test('explicit V2 qualification keeps native and full-tree pins closed per profile',async()=>{
 const profile='TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2';
 const model=require('./task12-official-document-model.test-support.cjs').model({profile});
 const input=model.packet(),proof=model.api.inspectOfficialDocumentQualification(input.name,input.sha256);
 assert.equal(proof.profile,profile);assert.equal(proof.candidateLockSha256,'0a2dc0cd644f3a2cbc090daa3377005cf542bdf58c368f97e50417d70930c58f');
 await model.api.withOfficialDocumentQualification(proof,scope=>{assert.equal(scope.lockName,'runtime-lock-material-body25-v4-temurin17-official-v2.json');assert.equal(scope.profile,profile);});
 const native='/private/tmp/runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/MacOS/soffice';
 model.files.get(native).bytes=Buffer.from('different installed executable');
 const changed=model.packet();assert.throws(()=>model.api.inspectOfficialDocumentQualification(changed.name,changed.sha256),{code:'TASK12_OFFICIAL_DOCUMENT_LIBREOFFICE'});
});


test('V2 reviewed publication stays opaque and rebinds only its exact profile',async()=>{
 const profile='TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2';
 const model=require('./task12-official-document-model.test-support.cjs').model({profile});
 const input=model.publish(),observed=model.api.observeOfficialTask12DocumentPublication(input.name,input.sha256);
 assert.equal(observed.profile,profile);assert.equal(observed.executionAllowed,false);
 assert.throws(()=>model.api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,{...model.moduleView}));
 const proof=model.api.verifyOfficialTask12DocumentRuntime(input.name,input.sha256,model.moduleView);
 await model.api.withOfficialTask12DocumentRuntime(proof,input.runRoot,scope=>{assert.equal(scope.profile,profile);assert.equal(scope.lockSha256,'0a2dc0cd644f3a2cbc090daa3377005cf542bdf58c368f97e50417d70930c58f');});
});

test('mechanical official qualification is a separate closed legacy adapter profile', () => {
  const { officialDocumentProfile } = require('./task12-official-document-profiles.cjs');
  const mechanical = officialDocumentProfile('TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1');
  assert.ok(mechanical, 'the original mechanical typography needs its own qualified adapter');
  assert.equal(mechanical.lockName, 'runtime-lock-mechanical-temurin17-official-v1.json');
  assert.equal(officialDocumentProfile('TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V2'), undefined);
});

test('mechanical qualification keeps its three class bytes and source-bound scope immutable',async()=>{
 const {api,packet,files}=require('./task12-official-document-model.test-support.cjs').model({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1'});
 const input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
 assert.equal(proof.profile,'TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1');
 await assert.rejects(api.withOfficialDocumentQualification(proof,async scope=>{
  assert.equal(scope.lockSha256,'1e68559095badbdc15b18891a4f216fbd780ebf2adbf92c6684c795f9d23eeb6');
  files.get('/private/tmp/materials/ContractDocxPdf.class').bytes=Buffer.from('foreign scoped material class');
  scope.checkMaterials();
 }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});


test('full scope byte verification preserves each read and hash while avoiding adjacent path probes',async()=>{
 const options={},m=require('./task12-official-document-model.test-support.cjs').model(options),target='/private/tmp/jdk/000';
 const packet=m.packet(),proof=m.api.inspectOfficialDocumentQualification(packet.name,packet.sha256);
 const count={lstat:0,realpath:0,read:0,hash:0};
 for(const [name,key]of [['lstatSync','lstat'],['realpathSync','realpath'],['readFileSync','read']]){const original=m.filesystem[name];m.filesystem[name]=function(file,...args){if(file===target)count[key]++;return original(file,...args);};}
 options.onHash=(algorithm,bytes)=>{if(algorithm==='sha256'&&bytes===m.files.get(target).bytes)count.hash++;};
 await m.api.withOfficialDocumentQualification(proof,async scope=>{
  for(const key of Object.keys(count))count[key]=0;
  scope.checkMaterials();scope.checkMaterials();
  assert.equal(count.read,2);assert.equal(count.hash,2);
  assert.equal(count.lstat,8);assert.equal(count.realpath,6);
 });
});


for(const mode of ['inode','owner','mode','symlink'])test('full scope rejects '+mode+' replacement before reading the unexpected file',async()=>{
 const m=require('./task12-official-document-model.test-support.cjs').model(),target='/private/tmp/jdk/000';
 const packet=m.packet(),proof=m.api.inspectOfficialDocumentQualification(packet.name,packet.sha256);
 let reads=0,stats=0,armed=false;const stat=m.filesystem.lstatSync,read=m.filesystem.readFileSync;
 m.filesystem.lstatSync=function(file){
  if(armed&&file===target&&++stats===3){const current=m.files.get(target);if(mode==='inode')current.ino++;if(mode==='owner')current.uid=process.getuid()+100;if(mode==='mode')current.mode=0o100666;if(mode==='symlink'){current.mode=0o120777;current.bytes=Buffer.from('001');}}
  return stat(file);
 };
 m.filesystem.readFileSync=function(file,...args){if(armed&&file===target)reads++;return read(file,...args);};
 await assert.rejects(m.api.withOfficialDocumentQualification(proof,async scope=>{armed=true;scope.checkMaterials();}),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
 assert.equal(reads,0);
});
test('full scope verifies bytes again across boundaries even with identical metadata',async()=>{
 const m=require('./task12-official-document-model.test-support.cjs').model(),target='/private/tmp/jdk/000';
 const packet=m.packet(),proof=m.api.inspectOfficialDocumentQualification(packet.name,packet.sha256);
 await assert.rejects(m.api.withOfficialDocumentQualification(proof,async scope=>{
  scope.checkMaterials();const original=m.files.get(target),before=m.filesystem.lstatSync(target);original.bytes=Buffer.from('bad');
  for(const key of ['dev','ino','mode','uid','gid','size','mtimeMs','ctimeMs','nlink'])assert.equal(m.filesystem.lstatSync(target)[key],before[key]);
  scope.checkMaterials();
 }),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
});
test('full scope refuses a named file replaced during its complete byte read',async()=>{
 const m=require('./task12-official-document-model.test-support.cjs').model(),target='/private/tmp/jdk/000';
 const packet=m.packet(),proof=m.api.inspectOfficialDocumentQualification(packet.name,packet.sha256);
 let armed=false,reads=0;const read=m.filesystem.readFileSync;
 m.filesystem.readFileSync=function(file,...args){const bytes=read(file,...args);if(armed&&file===target){reads++;m.files.set(target,{...m.files.get(target),ino:m.files.get(target).ino+100});}return bytes;};
 await assert.rejects(m.api.withOfficialDocumentQualification(proof,async scope=>{armed=true;scope.checkMaterials();}),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
 assert.equal(reads,1);
});


for(const phase of ['before-read','during-read'])test('public scope rejects an actual filesystem replacement '+phase+' through the file boundary',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'task12-owned-continuity-')));
 const actual=path.join(directory,'current'),replacement=path.join(directory,'replacement'),target='/private/tmp/jdk/000';
 fs.writeFileSync(actual,'000',{mode:0o644});fs.writeFileSync(replacement,'000',{mode:0o644});
 try{
  const m=require('./task12-official-document-model.test-support.cjs').model();
  const stat=m.filesystem.lstatSync,realpath=m.filesystem.realpathSync,read=m.filesystem.readFileSync;
  let armed=false,stats=0,reads=0,replaced=false;
  m.filesystem.lstatSync=function(file){if(file!==target)return stat(file);if(armed&&++stats===3&&phase==='before-read'){fs.renameSync(replacement,actual);replaced=true;}return fs.lstatSync(actual);};
  m.filesystem.realpathSync=function(file){if(file!==target)return realpath(file);const resolved=fs.realpathSync(actual);return resolved===actual?target:resolved;};
  m.filesystem.readFileSync=function(file,...args){if(file!==target)return read(file,...args);const bytes=fs.readFileSync(actual);if(armed){reads++;if(phase==='during-read'&&!replaced){fs.renameSync(replacement,actual);replaced=true;}}return bytes;};
  const packet=m.packet(),proof=m.api.inspectOfficialDocumentQualification(packet.name,packet.sha256);
  await assert.rejects(m.api.withOfficialDocumentQualification(proof,async scope=>{armed=true;scope.checkMaterials();}),{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
  assert.equal(replaced,true);assert.equal(reads,phase==='before-read'?0:1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});assert.equal(fs.existsSync(directory),false);}
});
test('new mechanical packet requires both sealed current-v2 document inputs',()=>{
 for(const name of ['/private/tmp/current.docx','/private/tmp/current-office.docx']){
  const m=require('./task12-official-document-model.test-support.cjs').model({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1'}),input=m.packet();
  m.files.get(name).bytes=Buffer.from('tampered current document');
  assert.throws(()=>m.api.inspectOfficialDocumentQualification(input.name,input.sha256),{code:'TASK12_OFFICIAL_DOCUMENT_DOCUMENT'});
 }
 for(const key of ['currentSha256','currentOfficeSha256']){
  const m=require('./task12-official-document-model.test-support.cjs').model({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1'}),input=m.packet(),plan=structuredClone(input.plan);plan.document[key]=null;
  const bytes=Buffer.from(JSON.stringify(plan)),sha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');m.files.get(input.name).bytes=bytes;
  assert.throws(()=>m.api.inspectOfficialDocumentQualification(input.name,sha),{code:'TASK12_OFFICIAL_DOCUMENT_DOCUMENT'});
 }
 const m=require('./task12-official-document-model.test-support.cjs').model({profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1'}),input=m.packet(),plan=structuredClone(input.plan);
 for(const key of ['currentPath','currentSha256','currentOfficePath','currentOfficeSha256'])delete plan.document[key];
 const bytes=Buffer.from(JSON.stringify(plan)),sha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');m.files.get(input.name).bytes=bytes;
 assert.throws(()=>m.api.inspectOfficialDocumentQualification(input.name,sha),{code:'TASK12_OFFICIAL_DOCUMENT_DOCUMENT'});
});
