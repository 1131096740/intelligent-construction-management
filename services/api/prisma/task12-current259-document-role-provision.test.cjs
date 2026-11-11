'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const phases=['current259-document-roles-before','current259-document-roles-write','current259-document-roles-committed'];
const names=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'];
function fixture(options={}){
 const handle=Object.freeze({}),runId='a0000000-0000-4000-8000-000000000001';
 const identity={database:'jg_task01_'+runId.replaceAll('-',''),databaseOid:'16391',namespaceOid:'2200',systemIdentifier:'7200000000000000001'};
 const source={candidateSha:'a'.repeat(40),profile:{profile:'TASK16_CURRENT259_SOURCE_V1',
  ledgerSha256:'d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952',
  prefix256Sha256:'85d1a225757b69aa81531560c7d989441ae6de6400c3a77737a86fc5e4a54a24',
  ledger:Array.from({length:259},(_,n)=>({name:String(n).padStart(4,'0')+'_source',sha256:'e'.repeat(64),finished:true,rolledBack:false}))}};
 const containerId='b'.repeat(64);
 const completion=Object.freeze({status:'CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId,containerId,installXid:'901',archiveInstallXid:'900',catalogSha256:'c'.repeat(64),protectedSha256:'d'.repeat(64),
  executionAllowed:false,nativeAdmission:false});
 const roleCompletion={databaseIdentity:identity,ordinary:{oid:'16392'},roles:[{oid:'16393'}]};
 const archiveCompletion={status:'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED',registeredFileSource:true,bindingSha256:'f'.repeat(64),pendingSha256:'0'.repeat(64),installXid:'900'};
 let closed=0,claimed=false;
 const calls=[];
 const resource={topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',databaseName:identity.database,containerId,
  async execOwnerSql(sql,phase){
   const n=phases.indexOf(phase);
   assert.ok(n>=0);calls.push({sql,phase});
   const challenge=sql.match(/'challenge','([a-f0-9]{64})'/u)[1];
   const payload={phase,challenge,identity,backendPid:401+n,backendStart:`2026-11-12T00:00:00.00000${n+1}Z`,
    stableSha256:'1'.repeat(64),ready:true,roles:n?names.map((name,i)=>({name,oid:String(17000+i),xmin:'909'})):[],
    installXid:n?'909':null,commitStatus:n===2?'committed':null};
   options.modify?.(payload,n);
   return {stdout:JSON.stringify(payload)};
  }};
 const view={resource,runId,source,check(){}};
 const imports={
  './task16-current259-ordinary-archive-acl.cjs':{claimCurrent259OrdinaryArchiveAcl(r,h){
   assert.equal(r,completion);assert.equal(h,handle);assert.ok(!claimed);claimed=true;
   return {source,completion,archiveCompletion,roleCompletion,generatedDraft:!options.oldProfile,
    catalogSql:"pg_catalog.repeat('c',64)",protectedSql:"pg_catalog.repeat('d',64)",check(){}};
  }},
  './task16-current259-owned-resource.cjs':{
   claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},
   async closeCurrent259OwnedResource(h){assert.equal(h,handle);closed++;if(options.cleanupUnknown)throw Error('model cleanup');}
  }
 };
 const filename=path.join(__dirname,'task12-current259-document-role-provision.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(name=>imports[name]??require(name),mod);
 return {api:mod.exports,handle,completion,calls,closed:()=>closed,resource};
}
test('issues only three inert roles using the original owner transport and private generated-draft receipt',async()=>{
 const f=fixture(),result=await f.api.provisionCurrent259GeneratedDocumentRoles(f.completion,f.handle);
 assert.deepEqual(names,Object.keys(require('./task12-current259-document-acl.json').roles));
 assert.deepEqual(f.calls.map(entry=>entry.phase),phases);
 const [{sql:before},{sql:writer},{sql:committed}]=f.calls;
 assert.doesNotMatch(before,/CREATE ROLE/u);
 assert.equal((writer.match(/^CREATE ROLE /gmu)??[]).length,3);
 for(const name of names)assert.ok(writer.includes('CREATE ROLE "'+name+'" NOLOGIN PASSWORD NULL'));
 assert.match(writer,/SERIALIZABLE READ WRITE/u);
 assert.doesNotMatch(writer,/^\s*(?:GRANT|ALTER ROLE|CREATE USER|DROP ROLE)\b/mu);
 assert.match(committed,/pg_xact_status\('909'::xid8\)/u);
 assert.equal(result.executionAllowed,false);
 assert.equal(result.nativeAdmission,false);
 assert.throws(()=>f.api.claimCurrent259GeneratedDocumentRoles({...result},f.handle),/HANDLE/u);
 const proof=f.api.claimCurrent259GeneratedDocumentRoles(result,f.handle);
 assert.deepEqual(proof.roles.map(r=>[r.name,r.oid]),names.map((name,i)=>[name,String(17000+i)]));
 assert.equal(proof.ordinaryAclCompletion,f.completion);
 assert.equal(proof.ordinaryAcl.completion,f.completion);
 assert.throws(()=>f.api.claimCurrent259GeneratedDocumentRoles(result,f.handle),/HANDLE/u);
});
test('rejects an ordinary predecessor or foreign topology before owner SQL',async()=>{
 for(const oldProfile of [true,false]){
  const f=fixture({oldProfile});
  if(!oldProfile)f.resource.topology='UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS';
  await assert.rejects(f.api.provisionCurrent259GeneratedDocumentRoles(f.completion,f.handle),/HANDLE/u);
  assert.equal(f.calls.length,0);
 }
});
test('a staged role not inserted by the exact writer stops and closes without readback',async()=>{
 const f=fixture({modify(row,n){if(n===1)row.roles[1].xmin='908';}});
 await assert.rejects(f.api.provisionCurrent259GeneratedDocumentRoles(f.completion,f.handle),/COMMIT_UNCONFIRMED/u);
 assert.equal(f.calls.length,2);assert.equal(f.closed(),1);
});
test('an unqualified fixed preimage is stopped before any role DDL',async()=>{
 const f=fixture({modify(row,n){if(n===0)row.ready=false;}});
 await assert.rejects(f.api.provisionCurrent259GeneratedDocumentRoles(f.completion,f.handle),/PRESTATE_REJECTED/u);
 assert.deepEqual(f.calls.map(entry=>entry.phase),[phases[0]]);
 assert.equal(f.closed(),1);
});
test('independent commit drift never issues roles and preserves unknown cleanup',async()=>{
 const f=fixture({cleanupUnknown:true,modify(row,n){if(n===2)row.stableSha256='2'.repeat(64);}});
 await assert.rejects(f.api.provisionCurrent259GeneratedDocumentRoles(f.completion,f.handle),
  error=>error.code==='CURRENT259_DOCUMENT_ROLE_PROVISION_COMMIT_UNCONFIRMED'&&error.resourceCleanup.status==='UNKNOWN');
 assert.equal(f.calls.length,3);assert.equal(f.closed(),1);
});
