'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const phases=['current259-document-acl-before','current259-document-acl-write','current259-document-acl-committed'];
const roles=Object.keys(require('./task12-current259-document-acl.json').roles)
 .map((name,i)=>Object.freeze({name,oid:String(17000+i),xmin:'900'}));
function fixture(options={}){
 const handle=Object.freeze({}),runId='a0000000-0000-4000-8000-000000000001',containerId='b'.repeat(64);
 const database='jg_task01_'+runId.replaceAll('-','');
 const identity={database,databaseOid:'16391',namespaceOid:'2200',systemIdentifier:'7200000000000000001'};
 const source={candidateSha:'a'.repeat(40),profile:{ledger:Array.from({length:259},(_,n)=>({name:String(n).padStart(4,'0')+'_source',sha256:'e'.repeat(64),finished:true,rolledBack:false}))}};
 const completion=Object.freeze({status:'CURRENT259_DOCUMENT_ROLES_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId,containerId,installXid:'900',roleCount:3,executionAllowed:false,nativeAdmission:false});
 const ordinaryAclCompletion=Object.freeze({installXid:'890',archiveInstallXid:'880',catalogSha256:'c'.repeat(64),protectedSha256:'d'.repeat(64)});
 const ordinaryAcl={completion:ordinaryAclCompletion,catalogSql:"(SELECT pg_catalog.repeat('c',64) FROM (SELECT a.attacl::text AS old_acl FROM pg_catalog.pg_attribute a LIMIT 1) w)",
  protectedSql:"pg_catalog.repeat('d',64)",roleCompletion:{databaseIdentity:identity},
  archiveCompletion:{bindingSha256:'f'.repeat(64),pendingSha256:'0'.repeat(64),installXid:'880'}};
 if(options.witness){
  ordinaryAcl.catalogSql=options.witness.catalogSql;
  ordinaryAcl.protectedSql=options.witness.protectedSql;
 }
 let claims=0,closed=0;
 const calls=[];
 const resource={topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',databaseName:database,containerId,
  async execOwnerSql(sql,phase){
   const n=phases.indexOf(phase);
   assert.ok(n>=0);calls.push({sql,phase});
   if(options.failBefore&&n===0)throw Object.assign(Error('opaque model transport output'),{code:'TASK01_RESOURCE_COMMAND_FAILED'});
   const challenge=sql.match(/'challenge','([a-f0-9]{64})'/u)[1];
   const continuity={continuitySha256:'1'.repeat(64)};
   const row={phase:['before','staged','committed'][n],challenge,backendPid:501+n,backendStart:`2026-11-12T00:00:00.00000${n+1}Z`,
    databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,systemIdentifier:identity.systemIdentifier,
    coordinatesSha256:'2'.repeat(64),roleOids:roles.map(r=>r.oid),roleXmins:roles.map(r=>r.xmin),installXid:n?'909':null,
    commitStatus:n===2?'committed':null};
   options.modify?.(row,continuity,n);
   return {stdout:JSON.stringify(continuity)+'\n'+JSON.stringify(row)+'\n'};
  }};
 const view={source,runId,resource,check(){}};
 const imports={
  './task12-current259-document-role-provision.cjs':{claimCurrent259GeneratedDocumentRoles(r,h){
   assert.equal(r,completion);assert.equal(h,handle);assert.equal(claims++,0);
   return Object.freeze({completion,ordinaryAclCompletion,ordinaryAcl,source,roles,check(){}});
  }},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},
   async closeCurrent259OwnedResource(h){assert.equal(h,handle);closed++;if(options.cleanupUnknown)throw Error('model cleanup');}}
 };
 const filename=path.join(__dirname,'task12-current259-document-acl-transport.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(name=>imports[name]??require(name),mod);
 return {api:mod.exports,handle,completion,ordinaryAclCompletion,calls,closed:()=>closed};
}
test('executes the original renderer inside the same owned role scope and independently reads the commit',async()=>{
 const f=fixture(),result=await f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle);
 assert.deepEqual(f.calls.map(x=>x.phase),phases);
 const [before,write,committed]=f.calls.map(x=>x.sql);
 assert.doesNotMatch(before,/^GRANT /mu);
 assert.ok(write.indexOf('CURRENT259_DOCUMENT_ACL_TRANSPORT_PREIMAGE')<write.indexOf('GRANT '));
 assert.match(write,/GRANT UPDATE [^\n]+ ON TABLE public\."ContractGeneratedDocument" TO "jg_c259_doc_worker"/u);
 assert.doesNotMatch(write,/^\s*(?:ALTER ROLE|GRANT CONNECT|GRANT DELETE)/mu);
 assert.match(committed,/pg_xact_status\('909'::xid8\)/u);
 assert.equal(result.installXid,'909');assert.equal(result.roleInstallXid,'900');assert.equal(result.executionAllowed,false);
 assert.throws(()=>f.api.claimCurrent259GeneratedDocumentAcl({...result},f.handle),/HANDLE/u);
 const receipt=f.api.claimCurrent259GeneratedDocumentAcl(result,f.handle);
 assert.deepEqual(receipt.roles,roles);assert.equal(receipt.ordinaryAcl.completion,f.ordinaryAclCompletion);
 assert.throws(()=>f.api.claimCurrent259GeneratedDocumentAcl(result,f.handle),/HANDLE/u);
});
test('a response from the wrong physical role does not reach the ACL write',async()=>{
 const f=fixture({modify(row,_,n){if(n===0)row.roleOids[1]='17999';}});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),
  error=>error.code==='CURRENT259_DOCUMENT_ACL_TRANSPORT_PRESTATE_REJECTED'&&error.phase==='BEFORE');
 assert.equal(f.calls.length,1);assert.equal(f.closed(),1);
});
test('protected staged catalog drift stops at the writer and keeps cleanup UNKNOWN',async()=>{
 const f=fixture({cleanupUnknown:true,modify(_,stable,n){if(n===1)stable.continuitySha256='4'.repeat(64);}});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),
  error=>error.code==='CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED'&&error.phase==='WRITE'&&error.resourceCleanup.status==='UNKNOWN');
 assert.equal(f.calls.length,2);assert.equal(f.closed(),1);
});
test('a committed result on the staged backend cannot issue an ACL continuation',async()=>{
 const f=fixture({modify(row,_,n){if(n===2)row.backendPid=502;}});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),
  error=>error.code==='CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED'&&error.phase==='COMMITTED');
 assert.equal(f.calls.length,3);assert.equal(f.closed(),1);
});
test('an ancestor XID cannot serve as the ACL write proof',async()=>{
 const f=fixture({modify(row,_,n){if(n===1)row.installXid='900';}});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),
  error=>error.phase==='WRITE'&&error.reason==='XID');
 assert.equal(f.calls.length,2);
});
test('retains only fixed transport failure context at the first phase',async()=>{
 const f=fixture({failBefore:true});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),error=>{
  assert.equal(error.phase,'BEFORE');assert.equal(error.reason,'TASK01_RESOURCE_COMMAND_FAILED');
  assert.ok(!JSON.stringify(error).includes('opaque model transport output'));return true;
 });
 assert.equal(f.calls.length,1);assert.equal(f.closed(),1);
});
