'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const noop=()=>{};
function helpers(t){
 const file=path.resolve(__dirname,'../../../scripts/prepare-task16-current259-payment-business.test.cjs'),m={exports:{}},rq=Module.createRequire(file);
 new Function('require','module','__dirname',fs.readFileSync(file,'utf8'))(name=>name==='node:test'?{test:noop}:rq(name),m,path.dirname(file));
 return m.exports.fixture(t);
}
function runFixture(t,options={}){
 const s=options.planFixture??helpers(t),saved=options.saved??s.business.prepareCurrent259PaymentBusinessPlan({runRoot:s.runRoot,daemonId:s.daemonId,output:s.output,scenario:options.scenario??'normal',paidAt:'2026-11-10',openingDate:'2026-11-09'});
 const m={exports:{}};
 const make=new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-payment-run-authorization.test.cjs'),'utf8')+'\nreturn fixture;')(
  name=>name==='node:test'?{test:noop}:require(name),m,__dirname);
 return make(t,{...options,planFixture:s,saved,business:!options.legacy,businessApi:s.business});
}
test('new business default verifies both materials without any resource or consumed attempt',async t=>{
 const f=runFixture(t,{default:true}),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_PLAN_VERIFIED_NO_RESOURCES');assert.deepEqual(f.state.calls,[]);
 assert.equal(fs.existsSync(path.join(f.s.runRoot,'attempt.json')),false);
});
for(const scenario of ['normal','response-loss'])test('fresh business '+scenario+' preserves the B7 issuer and adds only the fixed scoped consumer',async t=>{
 const f=runFixture(t,{scenario}),result=await f.done;
 assert.equal(result.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED',JSON.stringify(result));
 assert.deepEqual(f.state.calls,['start','technical259','roles9','seven','acl','b7','live','env','app','case','app-close','env-close','pools-close']);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.business.scenario,scenario);assert.equal(receipt.business.permission,'CONSUMED_ONCE');
 assert.equal(receipt.nativeAdmission,false);assert.equal(receipt.financialAcceptance,false);assert.equal(f.state.closes,1);
});
for(const error of [undefined,null,0,false])test('falsey consumer failure never publishes success or refunds the shared attempt: '+String(error),async t=>{
 const f=runFixture(t,{caseFailure:error}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(result.onceAttemptConsumed,true);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.s.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.business.outcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.failureStage,'seedAndSelectedCase');
 assert.equal(f.state.calls.filter(x=>x==='case').length,1);assert.equal(f.state.closes,1);
});
test('business permit replay poisons the owned run and cannot publish a late successful case',async t=>{
 const f=runFixture(t,{onBusiness:({api,permit,application,handle})=>{assert.throws(()=>api.claimCurrent259PaymentBusinessPermit(permit,application,handle));}}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.closes,1);
});
test('business and installation modes share the same single durable attempt',async t=>{
 const f=runFixture(t),first=await f.done;assert.equal(first.status,'PAYMENT_BUSINESS_CASE_AND_OWNED_CLEANUP_VERIFIED');
 const current=f.s.business.readCurrent259PaymentBusinessPlan(f.s.output,f.saved.sha256),marker=fs.readFileSync(path.join(f.s.runRoot,'attempt.json'));
 const old=runFixture(t,{legacy:true,planFixture:f.s,planFile:current.plan.installation.path,saved:{sha256:current.plan.installation.sha256}});
 // Both validated purposes resolve to the same already-consumed durable attempt.
 const rejected=await old.done;assert.equal(rejected.failureCode,'PAYMENT_INSTALL_ONCE_ALREADY_ATTEMPTED');assert.deepEqual(old.state.calls,[]);
 assert.deepEqual(fs.readFileSync(path.join(f.s.runRoot,'attempt.json')),marker);
});
test('sidecar identity drift after B7 revokes the business claim before any successful case',async t=>{
 const f=runFixture(t,{onBusiness:({s,lease})=>{
  const target=s.output+'.installation.json',bytes=fs.readFileSync(target);fs.renameSync(target,target+'.old');fs.writeFileSync(target,bytes,{mode:0o600});
  assert.throws(()=>lease.check());
 }}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.closes,1);
});
test('business functions replaced during an installation await are rejected rather than adopted late',async t=>{
 const f=runFixture(t,{onTechnical:state=>state.replaceBusinessLive()}),result=await f.done;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.calls.includes('foreign-live'),false);assert.equal(f.state.calls.includes('case'),false);
 assert.equal(f.state.closes,1);
});
