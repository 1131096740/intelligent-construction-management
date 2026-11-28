'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'prepare-task16-current259-owner-tls.cjs');
function fixture(t){
 const base=fs.mkdtempSync('/private/tmp/jg-398-once-plan-'),runRoot=path.join(base,'run');fs.mkdirSync(runRoot,{mode:0o700});
 t.after(()=>{for(const name of ['PLAN.json']){const p=path.join(base,name);if(fs.existsSync(p))fs.unlinkSync(p);}if(fs.existsSync(runRoot))fs.rmdirSync(runRoot);fs.rmdirSync(base);});
 const state={captures:0,loads:0,stale:false},handle=Object.freeze({});
 const witness={source:{candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:{ledgerSha256:'d'.repeat(64),prefix256Sha256:'e'.repeat(64),schemaSha256:'f'.repeat(64)}},build:{node:{path:process.execPath,sha256:'1'.repeat(64),version:process.version,openssl:process.versions.openssl},trees:['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(root=>({root,digest:'2'.repeat(64),entries:10,bytes:100})),sdk:{clientVersion:'5.22.0',engineVersion:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'}},host:process.platform+'-'+process.arch,engineCommit:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'};
 const loader={verifyFull(){if(state.stale)throw new Error('SOURCE_DRIFT');},witness(){return witness;}};
 const ports={'../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){state.captures++;return handle;}},'../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(h){assert.equal(h,handle);state.loads++;return loader;}}};
 const instance={exports:{}},rq=name=>Object.hasOwn(ports,name)?ports[name]:require(name);rq.main={};
 new Function('require','module','__dirname','__filename',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(rq,instance,__dirname,file);
 return {api:instance.exports,state,handle,loader,base,runRoot,output:path.join(base,'PLAN.json'),daemonId:'synthetic-daemon-12345'};
}
test('offline prepare and verify preserve actual material and produce no resource authority',t=>{
 const f=fixture(t);const result=f.api.prepareOwnerTlsPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output});
 assert.match(result.sha256,/^[a-f0-9]{64}$/u);assert.equal(fs.statSync(f.output).mode&0o777,0o600);
 const verified=f.api.verifyOwnerTlsPlan(f.output,result.sha256);
 assert.equal(verified.buildHandle,f.handle);assert.equal(verified.loader,f.loader);assert.equal(verified.plan.scope.sdkProbeAttempts,7);
 assert.equal(verified.plan.scope.ownerIdentityPsqlSessions,6);assert.equal(verified.plan.scope.fixedIdentitySelects,14);assert.equal(fs.readdirSync(f.runRoot).length,0);
});
module.exports={fixture};
test('repeated offline verification retains one genuine observed build and its original loader',t=>{
 const f=fixture(t),saved=f.api.prepareOwnerTlsPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output});
 const a=f.api.verifyOwnerTlsPlan(f.output,saved.sha256),b=f.api.verifyOwnerTlsPlan(f.output,saved.sha256);
 assert.equal(a.buildHandle,b.buildHandle);assert.equal(f.state.captures,1);assert.equal(f.state.loads,1);
 f.state.stale=true;assert.throws(()=>b.check(),/SOURCE_DRIFT/u);assert.equal(fs.readdirSync(f.runRoot).length,0);
});
test('a matching new file hash does not admit an edited source or expanded scope',t=>{
 const f=fixture(t),saved=f.api.prepareOwnerTlsPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output}),original=fs.readFileSync(f.output,'utf8');
 const h=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 for(const edit of [p=>p.material.source.candidateSha='b'.repeat(40),p=>p.scope.migrations=true,p=>p.run.resourceDir='/private/tmp/foreign']){
  const plan=JSON.parse(original);edit(plan);const bytes=JSON.stringify(plan);fs.writeFileSync(f.output,bytes);
  assert.throws(()=>f.api.verifyOwnerTlsPlan(f.output,h(bytes)),/OWNER_TLS_PLAN_/u);assert.equal(fs.readdirSync(f.runRoot).length,0);
 }
 fs.writeFileSync(f.output,original);assert.equal(f.api.verifyOwnerTlsPlan(f.output,saved.sha256).buildHandle,f.handle);
});
test('wrong plan bytes and an unknown existing destination are rejected without overwrite',t=>{
 const f=fixture(t),saved=f.api.prepareOwnerTlsPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output}),before=fs.readFileSync(f.output);
 assert.throws(()=>f.api.verifyOwnerTlsPlan(f.output,'0'.repeat(64)),/OWNER_TLS_PLAN_DIGEST/u);
 assert.throws(()=>f.api.prepareOwnerTlsPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output}),e=>e.code==='EEXIST');
 assert.deepEqual(fs.readFileSync(f.output),before);assert.equal(saved.file,f.output);
});
test('prepare accepts no resource, command, constructor or getter input',t=>{
 const f=fixture(t);let reads=0;const options={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output};
 Object.defineProperty(options,'exec',{get(){reads++;throw new Error('not a source port');},enumerable:true});
 assert.throws(()=>f.api.prepareOwnerTlsPlan(options),/OWNER_TLS_PLAN_DATA/u);assert.equal(reads,0);assert.equal(f.state.captures,0);assert.equal(fs.existsSync(f.output),false);
});
