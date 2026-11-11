'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {beginCurrent259GeneratedDocumentAcl}=require('./task12-current259-document-acl.cjs');
const roles=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'];
function fixture(){
 const run=beginCurrent259GeneratedDocumentAcl();
 function observation(challenge,phase,patch={}){
  const first=phase==='before';
  return JSON.stringify({
   challenge,phase,backendPid:first?101:phase==='staged'?102:103,backendStart:first?'2026-11-12T01:00:00.000001Z':phase==='staged'?'2026-11-12T01:00:00.000002Z':'2026-11-12T01:00:00.000003Z',
   databaseOid:'32199',namespaceOid:'2200',systemIdentifier:'7654321',coordinatesSha256:'a'.repeat(64),
   roleOids:['32700','32701','32702'],roleXmins:['400','400','400'],installXid:first?null:'600',
   commitStatus:phase==='committed'?'committed':null,...patch
  });
 }
 const challenge=sql=>sql.match(/'challenge','([0-9a-f]{64})'/u)?.[1];
 return {run,observation,challenge};
}
test('only the fixed three roles get their required columns in a checked write',()=>{
 const f=fixture(), before=f.run.beforeSql;
 assert.match(before,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
 const writer=f.run.acceptBefore(f.observation(f.challenge(before),'before'));
 assert.match(writer.sql,/BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE/u);
 for(const role of roles)assert.ok(writer.sql.includes('TO "'+role+'"'));
 assert.match(writer.sql,/GRANT INSERT \([^\n]+\) ON TABLE public\."ContractLayoutTemplateVersion" TO "jg_c259_doc_template"/u);
 assert.match(writer.sql,/GRANT UPDATE \([^\n]+\) ON TABLE public\."ContractGeneratedDocument" TO "jg_c259_doc_worker"/u);
 assert.match(writer.sql,/GRANT INSERT \([^\n]+\) ON TABLE public\."ContractGeneratedDocument" TO "jg_c259_doc_queue"/u);
 assert.doesNotMatch(writer.sql,/GRANT UPDATE \([^\n]+\) ON TABLE public\."FileObject"|GRANT (?:DELETE|ALL)|SET ROLE/u);
 const next=writer.acceptStaged(f.observation(f.challenge(writer.sql),'staged'));
 assert.match(next.sql,/pg_xact_status\('600'::xid8\)/u);
 assert.throws(()=>next.acceptCommitted(f.observation(f.challenge(next.sql),'committed',{backendPid:102})),/COMMITTED/u);
 assert.throws(()=>next.acceptCommitted(f.observation(f.challenge(next.sql),'committed')),/REPLAY/u);
});
test('independent readback yields non-authoritative proof without role or backend coordinates',()=>{
 const f=fixture();
 const writer=f.run.acceptBefore(f.observation(f.challenge(f.run.beforeSql),'before'));
 const next=writer.acceptStaged(f.observation(f.challenge(writer.sql),'staged'));
 const proof=next.acceptCommitted(f.observation(f.challenge(next.sql),'committed'));
 assert.equal(proof.executionAllowed,false);
 assert.equal(proof.nativeAdmission,false);
 assert.equal(proof.status,'CURRENT259_DOCUMENT_ACL_SOURCE_PROJECTION_MATCHED');
 assert.deepEqual(Object.keys(proof).sort(),['executionAllowed','nativeAdmission','profileSha256','status']);
});
test('target role or physical column drift aborts before issuing the readback',()=>{
 const f=fixture();
 const writer=f.run.acceptBefore(f.observation(f.challenge(f.run.beforeSql),'before'));
 assert.throws(()=>writer.acceptStaged(f.observation(f.challenge(writer.sql),'staged',{roleXmins:['400','410','400']})),/STAGED/u);
 assert.throws(()=>writer.acceptStaged(f.observation(f.challenge(writer.sql),'staged')),/REPLAY/u);
});
