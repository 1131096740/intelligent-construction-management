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

test('explicit 261 lifecycle document roles add only their reached defaults and collision reads while legacy stays frozen',()=>{
 const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(name=>fs.existsSync(path.join(__dirname,'migrations',name,'migration.sql'))).sort().map(name=>({path:'services/api/prisma/migrations/'+name+'/migration.sql',sha256:hash(fs.readFileSync(path.join(__dirname,'migrations',name,'migration.sql')))}));
 const profile=qualifyCurrent259Source({candidateSha:'a'.repeat(40),sealSha256:'3'.repeat(64),schemaSha256:hash(fs.readFileSync(path.join(__dirname,'schema.prisma'))),migrations});
 const source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'3'.repeat(64),profile};
 const api=require('./task12-current259-document-acl.cjs'),material=api.describeCurrent261GeneratedLifecycleDocumentAcl(source);
 const manifest=require('./task12-current259-document-acl.json');
 const previous=new Set(Object.entries(manifest.roles).flatMap(([role,tables])=>Object.entries(tables).flatMap(([relation,ops])=>Object.entries(ops).flatMap(([op,cols])=>cols.map(column=>[role,relation,column,op.toUpperCase()].join('/'))))));
 const added=material.rows.filter(row=>!previous.has([row.role,row.relation,row.column,row.privilege].join('/')));
 assert.equal(added.filter(row=>row.privilege==='INSERT').length,9);
 assert.equal(added.filter(row=>row.privilege==='SELECT').length,72);
 assert.ok(added.every(row=>roles.includes(row.role)&&(['INSERT','SELECT'].includes(row.privilege))));
 for(const role of roles.slice(0,2))assert.ok(added.some(row=>row.role===role&&row.relation==='ContractTakeoverCorrection'&&row.column==='schemaVersion'&&row.privilege==='SELECT'),'invoker correction predicate '+role);
 assert.ok(!added.some(row=>row.role===roles[2]&&row.privilege==='SELECT'));
 const collisionExpected = [
  'ContractArchiveEvidenceFile.fileId','ContractProxyExecution.evidenceFileId','ContractTakeoverExcessEvidence.fileId',
  'ContractTakeoverHistoricalPaymentVoucher.fileId','ContractTakeoverSettlementEvidence.fileId','ExpenseClaimAttachment.fileId',
  'ExpenseClaimPaymentExecution.voucherFileId','InterEntityRelationshipEvidenceClaim.fileId','InvoiceExceptionConfirmation.proofFileId',
  'InvoiceRecord.fileId','NoInvoiceConfirmation.proofFileId','PaymentExecution.voucherFileId',
  'PaymentExecutionPayerAttestation.proxyAuthorizationEvidenceFileId','ProjectAffiliateBusinessEvidence.fileId',
  'ProjectAffiliateCompanyContract.fileId','ProjectAffiliateContractFact.evidenceFileId','ProjectAffiliatePaymentFact.evidenceFileId',
  'ProjectAffiliateSettlementFact.evidenceFileId','ProjectExpenseExecution.voucherFileId','ProjectFinancingQuota.attachmentFileId',
  'RegisteredPaymentVoucher.fileId','SettlementRecoveryEntry.evidenceFileId','SpotProcurementPaymentAttachment.fileId',
  'SpotProcurementPaymentExecution.voucherFileId','SpotProcurementPaymentExecutionVoucher.fileId','SpotProcurementPaymentInvoice.fileId',
  'SpotProcurementReceiptPhoto.originalFileId','SpotProcurementReceiptPhoto.watermarkedFileId','SpotProcurementRefund.voucherFileId',
  'UpwardContractAmountRevision.evidenceFileId','WageApprovedSourceVersion.evidenceFileId',
  'ContractTakeoverCorrection.attachmentFileId','ContractTakeoverCorrection.correctionType','ContractTakeoverCorrection.schemaVersion',
  'ContractDraftAttachment.fileId','ContractDraftAttachment.slotKey'
 ];
 assert.deepEqual(material.collision.columns.map(row=>row.join('.')).sort(),collisionExpected.sort());
 assert.ok(material.functions.every(row=>row.securityDefiner===false));
 assert.equal(material.functions.find(row=>row.signature.includes('jg_has_exclusive')).bodySha256,'34c8b2cc5f110c24d67eba3491d580d0f656b6c7bbf1fced769f929b648a8f90');
 const collisionApi=require('./task12-current261-generated-lifecycle-collision.cjs');
 for(const forged of [{...material.collision,callers:[...material.collision.callers,'jg_c259_doc_queue']},
  {...material.collision,functions:material.functions.map((f,i)=>i?f:{...f,bodySha256:'0'.repeat(64)})},
  JSON.parse(JSON.stringify(material.collision))])assert.throws(()=>collisionApi.generatedLifecycleCollisionSql(forged),/COLLISION_SOURCE/u);
 assert.equal(material.functions.length,24);
 const migration=api.describeMigration261GeneratedLifecycleDocumentAcl(source);
 assert.equal(migration.functions.length,23);
 assert.ok(!migration.rows.some(row=>row.relation==='RegisteredPaymentVoucher'));
 const run=api.beginCurrent261GeneratedLifecycleDocumentAcl(source);
 const f=fixture(),writer=run.acceptBefore(f.observation(f.challenge(run.beforeSql),'before'));
 assert.equal((writer.sql.match(/^GRANT EXECUTE ON FUNCTION /gmu)??[]).length,48);
 assert.match(writer.sql,/actual EXCEPT ALL SELECT \* FROM expected/u);
 assert.match(writer.sql,/p\.proowner=10/u);
 assert.ok(!writer.sql.includes('FUNCTION public.jg_enforce_exclusive_file_business_binding() TO'));
 assert.ok(!writer.sql.match(/GRANT EXECUTE[^\n]+jg_c259_doc_queue/u));
 assert.match(writer.sql,/GRANT INSERT \([^\n]*"createdAt"[^\n]*\) ON TABLE public\."AuditLog" TO "jg_c259_doc_worker"/u);
 assert.doesNotMatch(writer.sql,/GRANT UPDATE [^\n]+"FileObject"|GRANT DELETE|TO PUBLIC/u);
 assert.equal(material.executionAllowed,false);
 assert.throws(()=>api.beginCurrent261GeneratedLifecycleDocumentAcl({...source,profile:{...profile,ledger:profile.ledger.slice(0,259)}}));
 const legacy=f.run.acceptBefore(f.observation(f.challenge(f.run.beforeSql),'before'));
 assert.doesNotMatch(legacy.sql,/GRANT INSERT \([^\n]*"createdAt"[^\n]*\) ON TABLE public\."AuditLog"/u);
});
