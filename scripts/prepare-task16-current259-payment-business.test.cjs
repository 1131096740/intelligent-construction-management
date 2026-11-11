'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const noop=()=>{};
function fixture(t){
 const holder={exports:{}},oldFile=path.join(__dirname,'prepare-task16-current259-payment-install.test.cjs');
 new Function('require','module','__dirname',fs.readFileSync(oldFile,'utf8'))(name=>name==='node:test'?{test:noop}:require(name),holder,__dirname);
 const original=holder.exports.fixture(t),module={exports:{}},file=path.join(__dirname,'prepare-task16-current259-payment-business.cjs');
 const local=name=>name==='./prepare-task16-current259-payment-install.cjs'?original.api:require(name);local.main={};
 new Function('require','module','__dirname','__filename',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(local,module,__dirname,file);
 return {...original,business:module.exports};
}
module.exports={fixture};
test('business plan is a distinct exact purpose/scenario and installation sidecar does not authorize business',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'response-loss',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verified=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256);
 assert.equal(verified.plan.purpose,'current259-payment-owned-seed-and-case');
 assert.equal(verified.plan.case.scenario,'response-loss');assert.equal(verified.plan.scope.seedPostCount,3);assert.equal(verified.plan.scope.registrationPostCount,2);
 assert.equal(verified.plan.scope.businessWrites,true);assert.equal(verified.plan.scope.archiveActivation,false);
 assert.equal(verified.buildHandle,f.handle);assert.deepEqual(fs.readdirSync(f.runRoot),[]);
 const sidecar=f.api.readCurrent259PaymentInstallPlan(f.output+'.installation.json',verified.plan.installation.sha256);
 assert.equal(sidecar.plan.scope.businessWrites,false);assert.equal(sidecar.plan.run.attemptFile,verified.plan.run.attemptFile);
 assert.throws(()=>f.api.readCurrent259PaymentInstallPlan(f.output,saved.sha256));
});
for(const name of ['business','sidecar'])test(name+' same-byte file replacement poisons both-file verification permanently',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verifier=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256),target=name==='business'?f.output:f.output+'.installation.json',bytes=fs.readFileSync(target);
 fs.renameSync(target,target+'.old');fs.writeFileSync(target,bytes,{mode:0o600});
 assert.throws(()=>verifier.check());fs.unlinkSync(target);fs.renameSync(target+'.old',target);
 assert.throws(()=>verifier.check());assert.deepEqual(fs.readdirSync(f.runRoot),[]);
});
test('a replaced material-parent directory cannot become a new baseline',t=>{
 const f=fixture(t),saved=f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const verifier=f.business.verifyCurrent259PaymentBusinessPlan(f.output,saved.sha256),old=f.base+'.old';
 fs.renameSync(f.base,old);fs.cpSync(old,f.base,{recursive:true});fs.chmodSync(f.base,0o700);
 try{assert.throws(()=>verifier.check());}finally{fs.rmSync(f.base,{recursive:true});fs.renameSync(old,f.base);}
 assert.throws(()=>verifier.check());
});
for(const [paidAt,openingDate]of [['2026-02-30','2026-02-01'],['2026-11-10','2026-11-11'],['9999-01-01','2026-11-01'],['2026-11-10T00:00:00Z','2026-11-09']])test('explicit dates must be valid Beijing business dates and not future: '+paidAt+'/'+openingDate,t=>{
 const f=fixture(t);
 assert.throws(()=>f.business.prepareCurrent259PaymentBusinessPlan({runRoot:f.runRoot,daemonId:f.daemonId,output:f.output,scenario:'normal',paidAt,openingDate}));
 assert.equal(f.state.captures,0);assert.equal(fs.existsSync(f.output),false);
});
