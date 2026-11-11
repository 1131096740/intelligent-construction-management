'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const read=name=>readFileSync(path.join(__dirname,name),'utf8');
const catalog=new Function('require','__dirname',read('task16-current259-catalog.test.cjs')+'\nreturn {api,source,identity,request,observed};')(
 name=>name==='node:test'?()=>{}:require(name),__dirname);
const {api,source,identity,request,observed}=catalog;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const witness=Object.freeze({candidateSha:source.candidateSha,sourceSealSha256:source.sealSha256,profile:qualifyCurrent259Source(source)});
const aclCompletion=Object.freeze({status:'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:identity.runId,installXid:'999',executionAllowed:false,nativeAdmission:false});
const roleCompletion=Object.freeze({sourceSha:source.candidateSha,runId:identity.runId,containerId:'a'.repeat(64),databaseIdentity:identity});
const planSha256='f'.repeat(64);
function modelRow(phase){
 const row=observed(phase);
 row.identity.backendPid=phase==='before'?411:phase==='staged'?412:413;
 row.identity.backendStart=`2026-11-11T01:00:${phase==='before'?'11':phase==='staged'?'12':'13'}.000001Z`;
 return row;
}
function fixture({change,permitMissing=false,denyWrite=false}={}){
 const handle=Object.freeze({}),permit=Object.freeze({}),calls=[],consumed=[];
 const catalogProof=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 let closed=false,claimed=false;
 const check=()=>assert.equal(closed,false);
 const view={source:witness,runId:identity.runId,check,verifyFull:check,resource:{databaseName:identity.database,containerId:roleCompletion.containerId,
  async execOwnerSql(sql,phase){
   const index=calls.length;calls.push({sql,phase});
   const row=modelRow(['before','staged','committed'][index]);change?.(row,index);
   return {stdout:JSON.stringify(row)+'\n'};
  }}};
 const imports={
  './task16-current259-payment-acl-install.cjs':{claimCurrent259PaymentAcl(result,provided){
   assert.equal(result,aclCompletion);assert.equal(provided,handle);assert.equal(claimed,false);claimed=true;
   return Object.freeze({completion:result,source:witness,roleCompletion,request,catalogProof,check});
  }},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(provided){assert.equal(provided,handle);check();return view;},
   async closeCurrent259OwnedResource(provided){assert.equal(provided,handle);closed=true;}},
  './task16-current259-payment-run-authorization.cjs':Object.freeze({claimCurrent259B7WritePermit(provided,resource,acl){
   assert.equal(provided,permit);assert.equal(resource,handle);assert.equal(acl,aclCompletion);
   return Object.freeze({planSha256,check(){check();return true;},consumeWrite(binding){
    check();assert.equal(consumed.length,0);assert.equal(calls.length,1);consumed.push(binding);return !denyWrite;
   }});
  }}),
 };
 const holder={exports:{}};
 new Function('require','module',read('task16-current259-b7-install.cjs'))(name=>{
  if(name==='./task16-current259-payment-run-authorization.cjs'&&permitMissing)throw Object.assign(Error('missing fixed authority'),{code:'MODULE_NOT_FOUND'});
  return imports[name]??require(name);
 },holder);
 return {api:holder.exports,handle,permit,calls,consumed,closed:()=>closed,claimed:()=>claimed};
}

test('pure B7 preparation fixes the installed SQL digest without an execution or authority port',()=>{
 const {prepareCurrent259B7}=require('./task16-current259-b7-install.cjs');
 const before=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 const prepared=prepareCurrent259B7({source,identity,nonce:request.nonce,before});
 assert.equal(prepared.installSqlSha256,hash(prepared.installSql));
 assert.equal(prepared.executionAllowed,false);
 assert.equal(prepared.nativeAdmission,false);
 assert.equal(Object.isFrozen(prepared),true);
});

test('the missing trusted launcher closes the production B7 gate before taking ACL or doing SQL',async()=>{
 const f=fixture({permitMissing:true});
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,f.permit),/CURRENT259_B7_INSTALL_AUTHORITY_UNAVAILABLE/u);
 assert.equal(f.claimed(),false);
 assert.deepEqual(f.calls,[]);
});

test('B7 consumes one fixed write permission after the real-shaped preimage and proves commit independently',async()=>{
 const f=fixture();
 const result=await f.api.installCurrent259B7(aclCompletion,f.handle,f.permit);
 assert.deepEqual(f.calls.map(x=>x.phase),['current259-b7-before','current259-b7-install','current259-b7-committed']);
 const [binding]=f.consumed;
 assert.equal(binding.installSqlSha256,hash(f.calls[1].sql));
 assert.equal(binding.beforeCatalogSha256,hash(JSON.stringify(modelRow('before'))));
 assert.equal(binding.aclXid,'999');assert.equal(binding.planSha256,planSha256);
 assert.match(f.calls[1].sql,/current259 B7 staged postimage changed/u);
 assert.match(f.calls[2].sql,/pg_catalog\.pg_xact_status/u);
 assert.equal(result.installXid,'1000');assert.equal(result.readerOid,'3000');assert.equal(result.nativeAdmission,false);
 assert.throws(()=>f.api.claimCurrent259B7Installation({...result},f.handle),/CURRENT259_B7_INSTALL_HANDLE/u);
 const next=f.api.claimCurrent259B7Installation(result,f.handle);
 assert.equal(next.completion,result);assert.equal(next.roleCompletion,roleCompletion);assert.equal(next.committedProof.raw.reader.oid,'3000');
 assert.throws(()=>f.api.claimCurrent259B7Installation(result,f.handle),/CURRENT259_B7_INSTALL_HANDLE/u);
});

test('before-image drift closes the owned resource without consuming a write permit',async()=>{
 const f=fixture({change(row,index){if(index===0)row.otherAclSha256='e'.repeat(64);}});
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,f.permit),/CURRENT259_B7_INSTALL_NOT_ATTEMPTED/u);
 assert.deepEqual(f.calls.map(call=>call.phase),['current259-b7-before']);
 assert.deepEqual(f.consumed,[]);
 assert.equal(f.closed(),true);
});

test('a denied exact write binding cannot reach the owner write port',async()=>{
 const f=fixture({denyWrite:true});
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,f.permit),/CURRENT259_B7_INSTALL_NOT_ATTEMPTED/u);
 assert.deepEqual(f.calls.map(call=>call.phase),['current259-b7-before']);
 assert.equal(f.consumed.length,1);
 assert.equal(f.closed(),true);
});

test('a lost write response stops without retry or an independent read',async()=>{
 const f=fixture({change(_row,index){if(index===1)throw new Error('private transport text');}});
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,f.permit),error=>{
  assert.equal(error.message,'CURRENT259_B7_INSTALL_COMMIT_UNCONFIRMED');
  assert.equal(error.cause,undefined);
  return true;
 });
 assert.deepEqual(f.calls.map(call=>call.phase),['current259-b7-before','current259-b7-install']);
 assert.equal(f.consumed.length,1);
 assert.equal(f.closed(),true);
});

test('a non-independent committed read leaves the commit unconfirmed and stops',async()=>{
 const f=fixture({change(row,index){
  if(index===2){const writer=modelRow('staged').identity;row.identity.backendPid=writer.backendPid;row.identity.backendStart=writer.backendStart;}
 }});
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,f.permit),/CURRENT259_B7_INSTALL_COMMIT_UNCONFIRMED/u);
 assert.deepEqual(f.calls.map(call=>call.phase),['current259-b7-before','current259-b7-install','current259-b7-committed']);
 assert.equal(f.consumed.length,1);
 assert.equal(f.closed(),true);
});

test('an ordinary approval-shaped object is denied before the ACL claim',async()=>{
 const f=fixture();
 await assert.rejects(f.api.installCurrent259B7(aclCompletion,f.handle,{approved:true,planSha256}),/CURRENT259_B7_INSTALL_AUTHORITY_DENIED/u);
 assert.equal(f.claimed(),false);
 assert.deepEqual(f.calls,[]);
});
