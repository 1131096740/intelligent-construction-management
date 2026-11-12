'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {readQualifiedTask16File:realRead}=require('../services/api/prisma/task16-runtime-inputs.cjs');
const file=path.join(__dirname,'prepare-task16-current259-payment-install.cjs');
const historicalEnd='20261111120000_contract_direct_upward_closure_source_v2';
function fixture(t){
 const base=fs.mkdtempSync('/private/tmp/jg-259-payment-plan-model-'),runRoot=path.join(base,'run');fs.mkdirSync(runRoot,{mode:0o700});
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const state={captures:0,loads:0,stale:false,fullCalls:0,lightCalls:0,linkedTool:false};
 const migrations=fs.readdirSync(path.join(__dirname,'../services/api/prisma/migrations')).sort()
  .filter(name=>/^\d{14}_/u.test(name)&&name<=historicalEnd).map(name=>{
  const relative='services/api/prisma/migrations/'+name+'/migration.sql';
  return {path:relative,sha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',relative))).digest('hex')};
 });
 const rawSource={candidateSha:'a'.repeat(40),sealSha256:'b'.repeat(64),schemaSha256:'60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4',migrations};
 const profile=require('../services/api/prisma/task16-current259-profile.cjs').qualifyCurrent259Source(rawSource);
 assert.equal(profile.profile,'TASK16_CURRENT259_SOURCE_V1');
 const handle=Object.freeze({});
 const witness={source:{candidateSha:rawSource.candidateSha,tree:'c'.repeat(40),sourceSealSha256:rawSource.sealSha256,profile},
  build:{node:{path:process.execPath,sha256:'1'.repeat(64),version:process.version},trees:['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(root=>({root,digest:'2'.repeat(64),entries:1,bytes:10}))},host:process.platform+'-'+process.arch,engineCommit:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'};
 const loader={check(){state.lightCalls++;assert.equal(state.stale,false,'source drift');},verifyFull(){state.fullCalls++;assert.equal(state.stale,false,'source drift');},witness(){return witness;}};
 const toolHashes={'/Applications/Docker.app/Contents/Resources/bin/docker':'6c3c88771987b73d66d0664b22800f46c827f96db67579594d39163ab88e8c40','/opt/homebrew/Cellar/openssl@3/3.6.3/bin/openssl':'103fc7706cf6646f226d96f29242d81890363499afc730e7ef1fadd64b3a123c'};
 const ports={
  'node:fs':{...fs,realpathSync(name){
   return Object.hasOwn(toolHashes,name)?(state.linkedTool?name+'.different':name):fs.realpathSync(name);
  }},
  '../services/api/prisma/task16-current259-payment-run-authorization.cjs':{},
  '../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){state.captures++;return handle;}},
  '../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(value){assert.equal(value,handle);state.loads++;return loader;}},
  '../services/api/prisma/task16-runtime-inputs.cjs':{readQualifiedTask16File(name,options){return toolHashes[name]?{sha256:toolHashes[name],identity:{uid:process.getuid(),mode:33188,ino:1,dev:1}}:realRead(name,options);}}
 };
 const holder={exports:{}},rq=name=>ports[name]??require(name);rq.main={};
 new Function('require','module','__dirname','__filename',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(rq,holder,__dirname,file);
 return {api:holder.exports,state,handle,loader,base,runRoot,output:path.join(base,'PLAN.json'),daemonId:'synthetic-payment-daemon-12345',rawSource};
}
module.exports={fixture};
test('offline payment model preserves the fixed realpath check for native tools',t=>{
 const f=fixture(t);
 f.state.linkedTool=true;
 assert.throws(()=>f.api.prepareCurrent259PaymentInstallPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output}),
  /PAYMENT_INSTALL_PLAN_TOOL/u);
 assert.equal(fs.existsSync(f.output),false);
});
test('offline payment plan binds technical259, nine roles, seven originals and B7 while run remains empty',t=>{
 const f=fixture(t),result=f.api.prepareCurrent259PaymentInstallPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output});
 const verified=f.api.verifyCurrent259PaymentInstallPlan(f.output,result.sha256);
 assert.equal(verified.buildHandle,f.handle);assert.equal(verified.loader,f.loader);
 assert.deepEqual(verified.plan.scope.stages,['technical259','roles9','sevenFragments','paymentAcl','b7','ownedCleanup']);
 assert.equal(verified.plan.scope.roles.length,9);assert.equal(verified.plan.scope.businessWrites,false);
 assert.equal(verified.plan.material.installation.sevenFragments.length,7);
 assert.equal(verified.plan.material.source.ledgerSha256,'d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952');
 assert.equal(verified.plan.material.installation.readerBodySha256,'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20');
 assert.equal(fs.readdirSync(f.runRoot).length,0);assert.equal(f.state.loads,1);
});
test('an edited purpose or business scope is rejected even with its matching new digest',t=>{
 const f=fixture(t);f.api.prepareCurrent259PaymentInstallPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output});const original=fs.readFileSync(f.output);
 for(const change of [plan=>plan.purpose='old-owner-scope',plan=>plan.scope.businessWrites=true,plan=>plan.material.installation.readerBodySha256='0'.repeat(64)]){
  const plan=JSON.parse(original);change(plan);const bytes=Buffer.from(JSON.stringify(plan));fs.writeFileSync(f.output,bytes);
  assert.throws(()=>f.api.verifyCurrent259PaymentInstallPlan(f.output,createHash('sha256').update(bytes).digest('hex')));
  assert.equal(fs.readdirSync(f.runRoot).length,0);
 }
});
test('offline prepare accepts no SQL, callback, URL or accessor input',t=>{
 const f=fixture(t);let getters=0;
 const value={runRoot:f.runRoot,daemonId:f.daemonId,output:f.output};
 Object.defineProperty(value,'exec',{enumerable:true,get(){getters++;return ()=>{};}});
 assert.throws(()=>f.api.prepareCurrent259PaymentInstallPlan(value));assert.equal(getters,0);
 assert.equal(f.state.captures,0);assert.equal(fs.existsSync(f.output),false);
});
test('repeated verification retains the original build and source drift cannot refund an attempt',t=>{
 const f=fixture(t),saved=f.api.prepareCurrent259PaymentInstallPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output});
 const first=f.api.verifyCurrent259PaymentInstallPlan(f.output,saved.sha256),second=f.api.verifyCurrent259PaymentInstallPlan(f.output,saved.sha256);
 assert.equal(first.buildHandle,second.buildHandle);assert.equal(f.state.captures,1);
 f.state.stale=true;assert.throws(()=>second.check());assert.equal(fs.readdirSync(f.runRoot).length,0);
});
for(const child of ['resource','attempt.json','receipt.json','receipt.json.pending'])test('prepare cannot occupy reserved once child '+child,t=>{
 const f=fixture(t);
 assert.throws(()=>f.api.prepareCurrent259PaymentInstallPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:path.join(f.runRoot,child)}),/PAYMENT_INSTALL_PLAN_/);
 assert.equal(fs.readdirSync(f.runRoot).length,0);
});
