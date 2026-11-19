'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {test}=require('node:test');
const file=join(__dirname,'task12-current259-document-owner-readback.cjs');
const id=n=>'10000000-0000-4000-8000-00000000000'+n;
const purpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const reason='隔离验收核对同修订Word与PDF';
const expiry='2026-11-12T00:05:06.000Z';
const start='2026-11-12T00:00:00.000001Z';
const completed='2026-11-12T00:00:07.000001Z';

function fixture(change,missingClaim=false){
 const handle={},calls=[],result={};let actualScope,live=true,claimed=false;
 const runId=id(1),sourceSha='a'.repeat(40),containerId='b'.repeat(64),database='jg_task01_'+runId.replaceAll('-','');
 const proof=Object.freeze({status:'CURRENT259_DOCUMENT_LOGIN_COMMITTED_NOT_ADMISSION',purpose,runId,sourceSha,containerId,
  installXid:'904',roleOids:Object.freeze(['17000','17001','17002','17003']),roleXmins:Object.freeze(['904','904','904','904']),
  ordinaryName:'jg_fixture_app_0123456789abcdef01234567',nativeAdmission:false,executionAllowed:false});
 const evidence=Object.freeze({status:'DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED',generationId:id(2),layoutId:id(3),versionId:id(4),
  ownerExpectation:{actorId:id(5),purpose:'draft',status:'success',sourceRevision:4,documentContentRevision:3,documentContentFingerprint:'e'.repeat(64),
   generationAudit:{action:'contract.document.success',businessType:'contract_generated_document'}},
  files:Object.fromEntries(['docx','pdf'].map((format,index)=>{
   const mode=index?'preview':'download';
   return [format,{fileId:id(6+index),mimeType:index?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes:1234+index,sha256:String(5+index).repeat(64),...(index?{pageCount:2}:{}),
    audit:{actorId:id(5),businessType:'file_object',accessMode:mode,expiresAt:expiry,downloadReason:reason,ticketAction:'file.'+mode+'.ticket',consumeAction:'file.'+mode}}];
  }))});
 const identity={database,databaseOid:'17004',namespaceOid:'2200',systemIdentifier:'7200000000000000001'};
 const resource=Object.freeze({topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',databaseName:database,containerId,
  getReceipt(){return {documentHba:{rules:13,purpose,loginInstallXid:'904',plaintextNoEncryptionRejected:true}};},
  async execOwnerSql(sql,phase){
   const n=calls.push({sql,phase})-1;
   const row={nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)[1],identity:{...identity},scope:true,readOnly:true,
    isolation:'repeatable read',writeXid:null,backend:{pid:400+n,start:n?'2026-11-12T00:00:06.000001Z':'2026-11-12T00:00:00.000000Z'},
    observedAt:n?completed:start,...(n?{matches:{version:true,document:true,files:true,audit:true}}:{})};
   change?.(n,row);
   return {stdout:JSON.stringify(row)+'\n'};
  }});
 const modules=Object.freeze(missingClaim?{}:{claimTask12GeneratedDocumentOwnerReadback(s,r){
  assert.equal(s,actualScope);assert.equal(r,result);assert.equal(claimed,false);claimed=true;
  return evidence;
 }});
 const loader=Object.freeze({loadGeneratedContractDocumentModules(){return modules;}});
 const view=Object.freeze({scope:'OWNED_RESOURCE_ONLY',runId,source:Object.freeze({candidateSha:sourceSha}),resource,loader,
  check(){assert.equal(live,true);}});
 const mocks={
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;}},
  './task12-current259-document-login.cjs':{assertCurrent259GeneratedDocumentLoginScope(p,h){assert.equal(p,proof);assert.equal(h,handle);assert.equal(live,true);}}
 };
 const mod={exports:{}};
 new Function('require','module',readFileSync(file,'utf8'))(name=>mocks[name]??require(name),mod);
 return {api:mod.exports,handle,proof,result,calls,close(){live=false;},async begin(){
  actualScope=await mod.exports.beginCurrent259GeneratedDocumentOwnerReadback(handle,proof);
  return actualScope;
 }};
}

test('uses two fixed read-only owner statements and yields only a matched summary after independent readback',async()=>{
 const f=fixture(),scope=await f.begin();
 const result=await f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,f.result);
 assert.equal(result.status,'CURRENT259_GENERATED_DOCUMENT_OWNER_READBACK_MATCHED');
 assert.equal(result.generationId,id(2));assert.equal(result.auditRows,5);
 assert.equal(result.files.docx.sha256,'5'.repeat(64));assert.equal(result.files.pdf.fileId,id(7));
 assert.equal(result.nativeAdmission,false);assert.equal(result.executionAllowed,false);
 assert.ok(!JSON.stringify(result).includes('7200000000000000001'));
 assert.deepEqual(f.calls.map(x=>x.phase),['current259-document-output-before','current259-document-output-readback']);
 for(const {sql} of f.calls){
  assert.match(sql,/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/u);
  assert.match(sql,/^ROLLBACK;$/mu);
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|ALTER ROLE)\b/iu);
 }
 const sql=f.calls[1].sql;
 for(const key of ['ContractVersion','ContractGeneratedDocument','FileObject','AuditLog','exportedDocxSha256','exportedPdfSha256','contract.document.success','file.download.ticket','file.preview.ticket','file.download','file.preview',reason])assert.ok(sql.includes(key),key);
 assert.doesNotMatch(sql,/objectKey|password|\/download\?/iu);
 await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,f.result),/SCOPE/u);
 assert.equal(f.calls.length,2);
});

test('fails before issuing SQL when the owned loader lacks the exact public proof claim',async()=>{
 const f=fixture(undefined,true);
 await assert.rejects(f.begin(),/MODULES/u);
 assert.equal(f.calls.length,0);
});

test('rejects copied scope, copied public result and replay before any second owner SQL',async()=>{
 const f=fixture(),scope=await f.begin();
 await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback({...scope},f.result),/SCOPE/u);
 await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,{...f.result}),/PUBLIC_PROOF/u);
 await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,f.result),/SCOPE/u);
 await assert.rejects(f.begin(),/SCOPE/u);
 assert.equal(f.calls.length,1);
});

test('does not read after the original resource and login lifetime ended',async()=>{
 const f=fixture(),scope=await f.begin();
 f.close();
 await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,f.result));
 assert.equal(f.calls.length,1);
});

for(const [name,change,stage] of [
 ['same backend',row=>{row.backend.pid=400;},'INDEPENDENCE'],
 ['same start',row=>{row.backend.start='2026-11-12T00:00:00.000000Z';},'INDEPENDENCE'],
 ['different database oid',row=>{row.identity.databaseOid='17005';},'INDEPENDENCE'],
 ['different physical database system',row=>{row.identity.systemIdentifier='7200000000000000002';},'INDEPENDENCE'],
 ['incorrect nonce',row=>{row.nonce='0'.repeat(64);},'READBACK'],
 ['SQL transaction drift',row=>{row.readOnly=false;},'READBACK'],
 ['stale current draft',row=>{row.matches.version=false;},'VERSION'],
 ['different output lineage',row=>{row.matches.document=false;},'DOCUMENT'],
 ['different file metadata',row=>{row.matches.files=false;},'FILES'],
 ['duplicate or stale audit',row=>{row.matches.audit=false;},'AUDIT']
]){
 test('rejects '+name+' without a matched receipt',async()=>{
  const f=fixture((index,row)=>{if(index===1)change(row);}),scope=await f.begin();
  await assert.rejects(f.api.readCurrent259GeneratedDocumentOwnerReadback(scope,f.result),
   {code:'CURRENT259_DOCUMENT_OWNER_READBACK_'+stage});
  assert.equal(f.calls.length,2);
 });
}
