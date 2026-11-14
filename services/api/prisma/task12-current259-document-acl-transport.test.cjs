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
 const source=options.source??{candidateSha:'a'.repeat(40),profile:{profile:'TASK16_CURRENT259_SOURCE_V1',ledgerSha256:'d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952',prefix256Sha256:'85d1a225757b69aa81531560c7d989441ae6de6400c3a77737a86fc5e4a54a24',ledger:Array.from({length:259},(_,n)=>({name:String(n).padStart(4,'0')+'_source',sha256:'e'.repeat(64),finished:true,rolledBack:false}))}};
 const plan=options.lifecycle&&source.tree?require('./task12-current261-generated-lifecycle-collision.cjs').registeredGeneratedLifecycleCollisionMaterial(source):undefined;
 const planFields=plan?{effectivePlanSha256:plan.sha256,installation:plan.installation,...options.planPatch}:{};
 const completion=Object.freeze({...planFields,status:'CURRENT259_DOCUMENT_ROLES_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId,containerId,installXid:'900',roleCount:3,executionAllowed:false,nativeAdmission:false});
 const ordinaryAclCompletion=Object.freeze({...planFields,installXid:'890',archiveInstallXid:'880',catalogSha256:'c'.repeat(64),protectedSha256:'d'.repeat(64)});
 const ordinaryAcl={...(options.lifecycle?{generatedLifecycle:true}:{}),...(options.save?{generatedDocument:true}:{}),completion:ordinaryAclCompletion,catalogSql:"(SELECT pg_catalog.repeat('c',64) FROM (SELECT a.attacl::text AS old_acl FROM pg_catalog.pg_attribute a LIMIT 1) w)",
  protectedSql:"pg_catalog.repeat('d',64)",roleCompletion:{databaseIdentity:identity},
  archiveCompletion:{bindingSha256:'f'.repeat(64),pendingSha256:'0'.repeat(64),installXid:'880'}};
 if(options.lifecycle){
  ordinaryAcl.catalogSql="(SELECT pg_catalog.to_jsonb(p),a.attacl::text FROM pg_catalog.pg_proc p CROSS JOIN pg_catalog.pg_attribute a LIMIT 1)";
  ordinaryAcl.protectedSql=`jsonb_build_array(${require('./task16-current259-catalog.cjs').current259Schema205WitnessSql()},
   (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attacl) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=to_regclass('public."RegisteredPaymentVoucher"') AND a.attnum>0 AND NOT a.attisdropped))`;
 }
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
   if(options.failWrite&&n===1)throw Object.assign(Error('PRIVATE_SQL'),{code:'TASK01_RESOURCE_COMMAND_FAILED',documentAclWriteFailure:options.failWrite});
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
 const continuityToken=Object.freeze({});let continuityCalls=0;
 const checkContinuity=token=>{assert.equal(token,continuityToken);continuityCalls++;};
 const view={source,runId,resource,check(){},checkContinuity};
 const imports={
  './task12-current259-document-role-provision.cjs':{claimCurrent259GeneratedDocumentRoles(r,h){
   assert.equal(r,completion);assert.equal(h,handle);assert.equal(claims++,0);
   return Object.freeze({completion,ordinaryAclCompletion,ordinaryAcl,source,roles,check(){},checkContinuity});
  },claimCurrent261GeneratedLifecycleDocumentRoles(r,h){
   assert.equal(options.lifecycle,true);assert.equal(r,completion);assert.equal(h,handle);assert.equal(claims++,0);
   return Object.freeze({completion,ordinaryAclCompletion,ordinaryAcl,source,roles,check(){},checkContinuity});
  }},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},
   claimCurrent259TechnicalResourceContinuity(h,token){assert.equal(h,handle);checkContinuity(token);return view;},
   async closeCurrent259OwnedResource(h){assert.equal(h,handle);closed++;if(options.cleanupUnknown)throw Error('model cleanup');}}
 };
 const filename=path.join(__dirname,'task12-current259-document-acl-transport.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(filename,'utf8'))(name=>imports[name]??require(name),mod);
 return {api:mod.exports,continuityToken,continuityCalls:()=>continuityCalls,handle,completion,ordinaryAclCompletion,calls,closed:()=>closed};
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

test('a mismatched login purpose cannot consume either document ACL receipt',async()=>{
 for(const save of [true,false]){
  const f=fixture({save}),result=await f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle);
  const old=f.api.claimCurrent259GeneratedDocumentAcl,next=f.api.claimCurrent259GeneratedDocumentSaveAcl;
  assert.throws(()=>(save?old:next)(result,f.handle),/HANDLE/u);
  const proof=(save?next:old)(result,f.handle);
  assert.equal(proof.ordinaryAcl.generatedDocument,save?true:undefined);
  assert.throws(()=>(save?next:old)(result,f.handle),/HANDLE/u);
 }
});

test('lifecycle transport consumes only its branded 261 role lease and carries the same document plan',async()=>{
 const {createHash}=require('node:crypto'),hash=b=>createHash('sha256').update(b).digest('hex');
 const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(name=>fs.existsSync(path.join(__dirname,'migrations',name,'migration.sql'))).sort().map(name=>({path:'services/api/prisma/migrations/'+name+'/migration.sql',sha256:hash(fs.readFileSync(path.join(__dirname,'migrations',name,'migration.sql')))}));
 const profile=qualifyCurrent259Source({candidateSha:'a'.repeat(40),sealSha256:'3'.repeat(64),schemaSha256:hash(fs.readFileSync(path.join(__dirname,'schema.prisma'))),migrations});
 const source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'3'.repeat(64),profile};
 const expected=require('./task12-current259-document-acl.cjs').describeCurrent261GeneratedLifecycleDocumentAcl(source);
 const f=fixture({source,lifecycle:true});
 const result=await f.api.installCurrent261GeneratedLifecycleDocumentAcl(f.completion,f.handle);
 assert.equal(result.profileSha256,expected.profileSha256);
 assert.equal(result.effectivePlanSha256,expected.effectivePlanSha256);
 const forged=fixture({source,lifecycle:true,planPatch:{effectivePlanSha256:'0'.repeat(64)}});
 await assert.rejects(forged.api.installCurrent261GeneratedLifecycleDocumentAcl(forged.completion,forged.handle));
 assert.equal(forged.calls.length,0);
 assert.ok(f.calls[0].sql.includes('p.proacl IS NOT NULL'));
 assert.ok(f.calls[1].sql.includes("acl_item->>2='SELECT' AND acl_item->3='false'::jsonb"));
 assert.ok(f.calls[1].sql.includes("acl_item->>1 IN ('17001','17002')"));
 assert.ok(f.calls[1].sql.includes("a.attname::text='originalSignedNumber'"));
 assert.ok(f.calls[1].sql.includes('WITH ORDINALITY prior(item,ordinality)'));
 assert.ok(f.calls[2].sql.includes('WITH ORDINALITY prior(item,ordinality)'));
 assert.equal((f.calls[1].sql.match(/^GRANT EXECUTE ON FUNCTION /gmu)??[]).length,48);
 assert.equal((f.calls[2].sql.match(/^GRANT EXECUTE/gmu)??[]).length,0);
 assert.match(f.calls[1].sql,/GRANT INSERT \([^\n]*"createdAt"[^\n]*\) ON TABLE public\."AuditLog" TO "jg_c259_doc_worker"/u);
 assert.throws(()=>f.api.claimCurrent259GeneratedDocumentAcl(result,f.handle),/HANDLE/u);
 assert.equal(f.api.claimCurrent261GeneratedLifecycleDocumentAcl(result,f.handle).ordinaryAcl.generatedLifecycle,true);
 const wrong=fixture({lifecycle:true});
 await assert.rejects(wrong.api.installCurrent261GeneratedLifecycleDocumentAcl(wrong.completion,wrong.handle));
 assert.equal(wrong.calls.length,0);
});

test('fixed DACL write detail survives a cleanup failure without claiming a commit',async()=>{
 const f=fixture({cleanupUnknown:true,failWrite:{sqlState:'P0001',section:'ACL_POSTIMAGE',guard:'CURRENT259_DOCUMENT_ACL_POSTIMAGE',sql:'PRIVATE_SQL'}});
 await assert.rejects(f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle),cause=>{
  assert.equal(cause.code,'CURRENT259_DOCUMENT_ACL_TRANSPORT_COMMIT_UNCONFIRMED');assert.equal(cause.resourceCleanup.status,'UNKNOWN');
  assert.deepEqual(f.api.describeCurrent261DocumentAclFailure(cause),{phase:'WRITE',reason:'TASK01_RESOURCE_COMMAND_FAILED',sqlState:'P0001',section:'ACL_POSTIMAGE',guard:'CURRENT259_DOCUMENT_ACL_POSTIMAGE'});
  assert.doesNotMatch(JSON.stringify(cause),/PRIVATE_SQL/u);return true;
 });assert.equal(f.calls.length,2);
});

test('ACL continuation propagates only its original capability through the original role lease',async()=>{const f=fixture();const result=await f.api.installCurrent259GeneratedDocumentAcl(f.completion,f.handle);const lease=f.api.claimCurrent259GeneratedDocumentAcl(result,f.handle);lease.checkContinuity(f.continuityToken);assert.ok(f.continuityCalls()>=2);assert.throws(()=>lease.checkContinuity({}));});
