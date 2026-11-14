'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
test('life owner window rejects a preview or cloned login proof before claiming any SQL port',async()=>{
 const file=path.join(__dirname,'task12-current261-local-lifecycle-owner.cjs'),holder={exports:{}};let claims=0;
 const imports={'./task12-current259-document-login.cjs':{assertCurrent261GeneratedLifecycleLoginScope(){throw Error('CURRENT259_DOCUMENT_LOGIN_HANDLE');}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(){claims++;throw Error('UNREACHED');}}};
 new Function('require','module',fs.readFileSync(file,'utf8'))(name=>imports[name]??require(name),holder);
 await assert.rejects(holder.exports.beginCurrent261LocalLifecycleOwnerWindow({}, {}, {}),/HANDLE/u);
 assert.equal(claims,0);
});
function model(change,priorSql){
 const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const token={},e={stage:'ORIGINALS',fixtureIdentity:id(1),projectId:id(1),handlerId:id(2),contractId:id(3),versionId:id(4),roundIds:{withdrawn:id(5),rejected:id(6),approved:id(7)},generationIds:{first:id(8),second:id(9),final:id(9)},final:{documentContentRevision:2,documentContentFingerprint:'c'.repeat(64)},originals:[{id:id(10),sha256:'d'.repeat(64),sizeBytes:500},{id:id(11),sha256:'e'.repeat(64),sizeBytes:600}]};
 const dbFiles=[8,9].map(n=>({generationId:id(n),docx:{id:id(n+20),sha256:'6'.repeat(64),sizeBytes:900,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',private:true},pdf:{id:id(n+30),sha256:'7'.repeat(64),sizeBytes:1200,mimeType:'application/pdf',private:true}}));
 e.generatedFiles=dbFiles.map(g=>({generationId:g.generationId,...Object.fromEntries(['docx','pdf'].map(k=>{const {private:ignored,...f}=g[k];void ignored;return[k,f];}))}));
 const facts=()=>({firstSignatureVersionCount:1,counts:[2,3,1,0,0],version:{id:id(4),status:'seal_approved_pending_archive',documentContentRevision:2,documentContentFingerprint:'c'.repeat(64)},generated:[8,9].map(n=>({id:id(n),status:'success',engineVersion:'real',docxFileId:id(n+20),pdfFileId:id(n+30)})),rounds:[{id:id(5),status:'withdrawn',approves:1,unsigned:1},{id:id(6),status:'rejected',approves:0,unsigned:0},{id:id(7),status:'approved',approves:5,unsigned:0}],approvedRoles:['contract_director','finance_director','general_manager','material_director','project_manager'].map(role=>({role,count:1,signed:true})),sealTasks:[{id:id(12),status:'completed',approvalInstanceId:id(7)}],archives:[],evidence:[],originals:e.originals.map(o=>({...o,private:true})),audit:[{action:'contract.seal.complete',count:1},{action:'contract.archive_task.create',count:1}]});
 const holder={exports:{}},handle={},proof=Object.freeze({installXid:'40'}),calls=[],fixture=Object.freeze({approval:Object.freeze({project:Object.freeze({id:'10000000-0000-4000-8000-000000000001'}),handler:Object.freeze({id:'10000000-0000-4000-8000-000000000002'}),users:Object.freeze(Array.from({length:8},(_,i)=>({id:i===0?id(2):id(20+i)})))})});
 let live=true;
 const lease={identity:{database:'model',databaseOid:'1',namespaceOid:'2200',systemIdentifier:'123'},continuitySql:priorSql??"MODEL_FINGERPRINT((SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public')),(SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=pg_catalog.to_regnamespace('public')))",continuitySha256:'a'.repeat(64),effectivePlanSha256:'b'.repeat(64),installation:'ARCHIVE261_REGISTERED_SEVEN',check(){assert.equal(live,true);}};
 const resource=Object.freeze({topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',getReceipt(){return{documentHba:{purpose:'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1',rules:13,loginInstallXid:'40',effectivePlanSha256:lease.effectivePlanSha256,installation:lease.installation,plaintextNoEncryptionRejected:true}};},async execOwnerSql(sql,phase){
  const n=calls.push({sql,phase});const row={nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)[1],phase:sql.match(/'phase','([^']+)'/u)[1],pid:500+n,start:`2026-11-13T00:00:00.${String(n).padStart(6,'0')}Z`,facts:n===1?null:phase.endsWith('_files')?JSON.parse(JSON.stringify(dbFiles)):facts()};change?.(n,row,sql,phase);return{stdout:JSON.stringify(row)};
 }});
 const view={scope:'OWNED_RESOURCE_ONLY',resource,check:lease.check,loader:{loadCurrent261LocalLifecycleDocumentModules(){return{isTask12LocalLifecycleFixture:f=>f===fixture,claimTask12LocalLifecycleCheckpoint:t=>{assert.equal(t,token);return e;}};}}};
 const imports={'./task12-current259-document-login.cjs':{assertCurrent261GeneratedLifecycleLoginScope(p,h){assert.equal(p,proof);assert.equal(h,handle);assert.equal(live,true);},claimCurrent261LocalLifecycleOwnerProof(){return lease;}},'./task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;}}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-current261-local-lifecycle-owner.cjs'),'utf8'))(name=>imports[name]??require(name.startsWith('node:')?name:path.join(__dirname,name)),holder);
 return{api:holder.exports,calls,fixture,token,e,close(){live=false;},begin:f=>holder.exports.beginCurrent261LocalLifecycleOwnerWindow(handle,proof,f??fixture)};
}
test('life owner facts bind one genuine fixture and monotonic fixed stages with bounded complete counts',async()=>{
 const f=model(),key=await f.begin();
 const coordinates=f.e;
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner({...key},f.token),/SCOPE/u);assert.equal(f.calls.length,1);
 const result=await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);assert.equal(result.version.status,'seal_approved_pending_archive');assert.ok(Object.isFrozen(result));
 assert.ok(f.calls[1].sql.includes('ContractArchiveEvidenceFile'));assert.ok(f.calls[1].sql.includes(coordinates.versionId));
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner(key,f.token),/PHASE/u);assert.equal(f.calls.length,3);
 const g=model();await assert.rejects(g.begin(Object.freeze({...g.fixture})),/FIXTURE/u);assert.equal(g.calls.length,0);
 const h=model((n,row)=>{if(n===2)row.facts.counts[0]=5;});const other=await h.begin();
 await assert.rejects(h.api.observeCurrent261LocalLifecycleOwner(other,h.token),/FACTS/u);
 await assert.rejects(h.api.observeCurrent261LocalLifecycleOwner(other,h.token),/CLOSED/u);assert.equal(h.calls.length,2);
});
test('fixed audit fault refuses wrong phase, clone, retry and unknown cleanup without deleting unknown objects',async()=>{
 const f=model(),key=await f.begin();
 await assert.rejects(f.api.installCurrent261LocalLifecycleAuditFault(key),/FAULT_PHASE/u);assert.equal(f.calls.length,1);
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);
 await assert.rejects(f.api.installCurrent261LocalLifecycleAuditFault({...key}),/SCOPE/u);assert.equal(f.calls.length,3);
 await assert.rejects(f.api.installCurrent261LocalLifecycleAuditFault(key),/OUTPUT/u);assert.equal(f.calls.length,4);
 assert.ok(f.calls[3].sql.includes('CREATE FUNCTION public.jg_task12_local_lifecycle_audit_failure()'));
 assert.ok(f.calls[3].sql.includes('MODEL_FINGERPRINT'));
 await assert.rejects(f.api.installCurrent261LocalLifecycleAuditFault(key),/CLOSED|FAULT_PHASE/u);
 await assert.rejects(f.api.removeCurrent261LocalLifecycleAuditFault(key),/UNKNOWN/u);assert.equal(f.calls.length,4);
 assert.equal(f.calls.filter(c=>c.sql.includes('CREATE FUNCTION')).length,1);
 assert.equal(f.calls.filter(c=>c.sql.includes('DROP FUNCTION')).length,0);
});

function faultRows(n,row,sql,phase){
 if(!phase.includes('audit_fault'))return;
 for(const key of Object.keys(row))if(!['nonce','phase','pid','start'].includes(key))delete row[key];
 const removal=phase.includes('remove'),committed=phase.includes('committed');
 row.xid=removal?'60':'50';row.writeXid=committed?null:row.xid;
 row.objects=removal?null:{function:{oid:'10001',xmin:'50'},trigger:{oid:'10002',xmin:'50'}};
}
test('fixed fault installation and removal require separate committed backends and restore raw catalog',async()=>{
 const f=model(faultRows),key=await f.begin();await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);
 await f.api.installCurrent261LocalLifecycleAuditFault(key);
 assert.equal(f.calls.length,5);const installed=f.calls.find(c=>c.phase.endsWith('fault_committed')).sql;
 assert.ok(installed.includes("pg_catalog.pg_xact_status('50'::xid8)"));assert.ok(installed.includes("p.oid::text='10001' AND p.xmin::text='50'"));
 f.e.stage='AUDIT_ROLLBACK';await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);
 const rollback=f.calls.find(c=>c.phase.endsWith('audit_rollback')).sql;assert.ok(rollback.includes('p.oid IS DISTINCT FROM'));assert.ok(rollback.includes('procost=100'));
 await f.api.removeCurrent261LocalLifecycleAuditFault(key);assert.equal(f.calls.length,9);
 const removed=f.calls.find(c=>c.phase.endsWith('fault_remove')).sql,committed=f.calls.find(c=>c.phase.endsWith('removed_committed')).sql;
 assert.ok(removed.includes('DROP TRIGGER'));assert.ok(removed.includes('DROP FUNCTION'));assert.ok(committed.includes("pg_catalog.pg_xact_status('60'::xid8)"));
 assert.ok(!committed.includes('p.oid IS DISTINCT FROM'));
 await assert.rejects(f.api.removeCurrent261LocalLifecycleAuditFault(key),/UNKNOWN/u);assert.equal(f.calls.length,9);
});
test('committed fault identity drift never issues installed permit or deletes unknown objects',async()=>{
 const f=model((...args)=>{faultRows(...args);const row=args[1],phase=args[3];if(phase.endsWith('fault_committed'))row.objects.function.oid='99999';}),key=await f.begin();
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);
 await assert.rejects(f.api.installCurrent261LocalLifecycleAuditFault(key),error=>error.code==='CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT'&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
 await assert.rejects(f.api.removeCurrent261LocalLifecycleAuditFault(key),/UNKNOWN/u);
 assert.equal(f.calls.filter(c=>c.sql.includes('DROP FUNCTION')).length,0);
});
test('owner close revokes the window and never reports an incomplete case as matched',async()=>{
 const f=model(),key=await f.begin();const receipt=await f.api.closeCurrent261LocalLifecycleOwnerWindow(key);
 assert.equal(receipt.matched,false);assert.equal(receipt.full394Accepted,false);assert.equal(receipt.cosAccepted,false);
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner(key,f.token),/SCOPE/u);
 await assert.rejects(f.api.closeCurrent261LocalLifecycleOwnerWindow(key),/SCOPE/u);assert.equal(f.calls.length,1);
});
test('cleanup failure retains its first error and permanently refuses another fault removal',async()=>{
 const first=Object.assign(Error('MODEL_REMOVE_FIRST'),{code:'MODEL_REMOVE_FIRST'});
 const f=model((...args)=>{faultRows(...args);if(args[3].endsWith('fault_remove'))throw first;}),key=await f.begin();
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);await f.api.installCurrent261LocalLifecycleAuditFault(key);
 await assert.rejects(f.api.closeCurrent261LocalLifecycleOwnerWindow(key),error=>error===first&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
 await assert.rejects(f.api.removeCurrent261LocalLifecycleAuditFault(key),/SCOPE/u);
 assert.equal(f.calls.filter(c=>c.sql.includes('DROP FUNCTION')).length,1);
});

test('a downloaded generated PDF hash mismatch cannot pass the independent FileObject readback',async()=>{
 const f=model(),key=await f.begin();f.e.generatedFiles[0].pdf.sha256='f'.repeat(64);
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner(key,f.token),/FACTS/u);
 assert.ok(f.calls.some(c=>c.sql.includes('JOIN public."FileObject" d ON d.id=g."docxFileId"')));
});
test('only the complete private checkpoint plus raw fault removal yields a matched closed owner receipt',async()=>{
 const f=model((n,row,sql,phase)=>{faultRows(n,row,sql,phase);if(row.phase==='COMPLETE'){
  row.facts.counts=[2,3,1,1,2];row.facts.version.status='effective';
  row.facts.archives=[{id:'10000000-0000-4000-8000-000000000013',idempotencyKey:'10000000-0000-4000-8000-000000000014',authoritySha256:'8'.repeat(64),fileManifestSha256:'9'.repeat(64)}];
  row.facts.evidence=f.e.originals.map((o,i)=>({fileId:o.id,displayOrder:i,contentSha256:o.sha256,sizeBytes:o.sizeBytes,private:true}));
  row.facts.audit.push({action:'contract.archive.complete',count:1});
 }}),key=await f.begin();
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);await f.api.installCurrent261LocalLifecycleAuditFault(key);
 f.e.stage='AUDIT_ROLLBACK';await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);await f.api.removeCurrent261LocalLifecycleAuditFault(key);
 f.e.stage='COMPLETE';f.e.archive={id:'10000000-0000-4000-8000-000000000013',idempotencyKey:'10000000-0000-4000-8000-000000000014'};
 const facts=await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);assert.equal(facts.evidence.length,2);assert.equal(facts.generatedFiles.length,2);
 const receipt=await f.api.closeCurrent261LocalLifecycleOwnerWindow(key);assert.equal(receipt.matched,true);assert.equal(receipt.full394Accepted,false);
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner(key,f.token),/SCOPE/u);
});
test('fault catalog xmin uses the existing PostgreSQL xid32 projection of its committed xid8',async()=>{
 const f=model((...args)=>{faultRows(...args);const row=args[1];if(row.xid==='50'){row.xid='4294967346';if(row.writeXid!==null)row.writeXid=row.xid;}}),key=await f.begin();
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);await f.api.installCurrent261LocalLifecycleAuditFault(key);
 assert.ok(f.calls.some(c=>c.sql.includes("pg_catalog.pg_xact_status('4294967346'::xid8)")));
 await f.api.removeCurrent261LocalLifecycleAuditFault(key);await f.api.closeCurrent261LocalLifecycleOwnerWindow(key);
});
test('an immutable system error remains the cleanup wrapper cause instead of being replaced by a mutation error',async()=>{
 const first=Object.freeze(Object.assign(Error('MODEL_FROZEN_REMOVE'),{code:'MODEL_FROZEN_REMOVE'}));
 const f=model((...args)=>{faultRows(...args);if(args[3].endsWith('fault_remove'))throw first;}),key=await f.begin();
 await f.api.observeCurrent261LocalLifecycleOwner(key,f.token);await f.api.installCurrent261LocalLifecycleAuditFault(key);
 await assert.rejects(f.api.closeCurrent261LocalLifecycleOwnerWindow(key),error=>error.cause===first&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
 assert.equal(f.calls.filter(c=>c.sql.includes('DROP FUNCTION')).length,1);
});

test('withdrawal never silently discards the original partial approver signature version',async()=>{
 const f=model((n,row)=>{if(n===2)row.facts.firstSignatureVersionCount=0;}),key=await f.begin();
 await assert.rejects(f.api.observeCurrent261LocalLifecycleOwner(key,f.token),/FACTS/u);
 assert.equal(f.calls.length,2);
});
