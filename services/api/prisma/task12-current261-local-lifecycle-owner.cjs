'use strict';
const {randomBytes,createHash}=require('node:crypto'),{types}=require('node:util');
const {assertCurrent261GeneratedLifecycleLoginScope,claimCurrent261LocalLifecycleOwnerProof}=require('./task12-current259-document-login.cjs');
const {claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
const active=new WeakMap(),attempted=new WeakSet();
const need=(ok,part)=>{if(!ok){const code='CURRENT261_LOCAL_LIFECYCLE_OWNER_'+part;throw Object.assign(new Error(code),{code});}};
function unknown(error){
 if(error&&typeof error==='object'&&!types.isProxy(error)){
  try{Object.defineProperty(error,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true,configurable:true});return error;}catch{/* Preserve immutable first errors through cause. */}
 }
 return Object.assign(new Error('CURRENT261_LOCAL_LIFECYCLE_OWNER_CLEANUP_UNKNOWN',{cause:error}),{code:'CURRENT261_LOCAL_LIFECYCLE_OWNER_CLEANUP_UNKNOWN',ownerCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
}
const own=(v,k)=>v&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${v})::text,'UTF8')),'hex')`;
const faultName='jg_task12_local_lifecycle_audit_failure';
const triggerName='jg_task12_local_lifecycle_audit_failure';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const backend=v=>Number.isInteger(v.pid)&&v.pid>0&&typeof v.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(v.start);
const functionAbsent=`NOT EXISTS(SELECT FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proname=${quote(faultName)})`;
const triggerAbsent=`NOT EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(triggerName)})`;
function owner(scope){
 const {identity}=scope.lease;
 return `current_database()=${quote(identity.database)} AND current_user::regrole::oid=10 AND session_user=current_user
  AND (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10)=${quote(identity.databaseOid)}
  AND pg_catalog.to_regnamespace('public')::oid::text=${quote(identity.namespaceOid)}
  AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())=${quote(identity.systemIdentifier)}
  AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
  AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND current_setting('session_replication_role')='origin' AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999`;
}
function check(scope,cleanup=false){
 need(scope.available&&(cleanup||!scope.failed),'CLOSED');assertCurrent261GeneratedLifecycleLoginScope(scope.proof,scope.handle);
 scope.lease.check();scope.view.check();
 need(claimCurrent259TechnicalResource(scope.handle)===scope.view&&scope.view.resource===scope.resource&&own(scope.resource,'execOwnerSql')===scope.exec,'CONTINUITY');
 const hba=own(scope.resource,'getReceipt').call(scope.resource).documentHba;
 need(hba?.purpose==='CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1'&&hba.rules===13&&hba.loginInstallXid===scope.proof.installXid&&
  hba.effectivePlanSha256===scope.lease.effectivePlanSha256&&hba.installation==='ARCHIVE261_REGISTERED_SEVEN'&&hba.plaintextNoEncryptionRejected===true,'CONTINUITY');
}
async function read(scope,phase,payload='NULL::jsonb'){
 check(scope);need(!scope.pending,'PENDING');scope.pending=true;
 const nonce=randomBytes(32).toString('hex');
 const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,pg_temp;
DO $life_owner$ BEGIN IF (${owner(scope)}) IS NOT TRUE OR (${catalogGuard(scope,scope.fault?.state==='INSTALLED')}) IS NOT TRUE THEN RAISE EXCEPTION 'CURRENT261_LOCAL_LIFECYCLE_OWNER_CONTINUITY'; END IF; END $life_owner$;
SELECT jsonb_build_object('nonce',${quote(nonce)},'phase',${quote(phase)},'pid',pg_backend_pid(),
 'start',(SELECT to_char(backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM pg_stat_activity WHERE pid=pg_backend_pid()),
 'facts',${payload});
ROLLBACK;`;
 try{
  const result=await scope.exec.call(scope.resource,sql,'current261-local-lifecycle-owner-'+phase.toLowerCase());check(scope);
  const text=own(result,'stdout');need(typeof text==='string'&&Buffer.byteLength(text)<=4096,'OUTPUT');
  let row;try{row=JSON.parse(text);}catch{need(false,'OUTPUT');}
  need(row&&Object.keys(row).sort().join(',')==='facts,nonce,phase,pid,start'&&row.nonce===nonce&&row.phase===phase&&backend(row),'OUTPUT');
  if(scope.lastBackend)need(row.pid!==scope.lastBackend.pid&&row.start!==scope.lastBackend.start,'BACKEND');scope.lastBackend={pid:row.pid,start:row.start};
  return row.facts;
 }catch(error){scope.failed=true;throw error;}finally{scope.pending=false;}
}
function catalogGuard(scope,installed){
 const fault=scope.fault;
 if(!installed)return `(${scope.lease.continuitySql}) IS NOT DISTINCT FROM ${quote(scope.lease.continuitySha256)} AND (${functionAbsent}) AND (${triggerAbsent})`;
 need(fault?.material,'FAULT_PHASE');
 const {restoreCurrent261LocalLifecycleFaultCatalog}=require('./task12-current261-local-lifecycle-fault.cjs');
 const normalized=restoreCurrent261LocalLifecycleFaultCatalog(scope.lease.continuitySql,fault.material);
 const exact=fault.objects?` AND (SELECT p.oid::text=${quote(fault.objects.function.oid)} AND p.xmin::text=${quote(fault.objects.function.xmin)} FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(${quote(fault.material.signature)}))
 AND (SELECT t.oid::text=${quote(fault.objects.trigger.oid)} AND t.xmin::text=${quote(fault.objects.trigger.xmin)} FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(triggerName)})`:'';
 return `(${fault.material.metadataSql}) AND (${normalized}) IS NOT DISTINCT FROM ${quote(scope.lease.continuitySha256)}${exact}`;
}
function ownerScope(key){need(key&&!types.isProxy(key)&&active.has(key),'SCOPE');return active.get(key);}
const xid=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/u.test(v)&&BigInt(v)<=0xffffffffffffffffn;
const xmin=v=>String(BigInt(v)%0x100000000n);
const oid=v=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/u.test(v)&&BigInt(v)<=0xffffffffn;
async function faultCommand(scope,phase,write,removing){
 check(scope,removing);need(!scope.pending,'PENDING');scope.pending=true;
 const fault=scope.fault,nonce=randomBytes(32).toString('hex');
 const installedBefore=write?removing:!removing,installedAfter=!removing;
 const guard=installed=>`IF (${owner(scope)}) IS NOT TRUE OR (${catalogGuard(scope,installed)}) IS NOT TRUE THEN RAISE EXCEPTION 'CURRENT261_LOCAL_LIFECYCLE_FAULT_CONTINUITY'; END IF;`;
 const commit=write?'COMMIT;':'ROLLBACK;';
 const objectSql=installedAfter?`jsonb_build_object('function',(SELECT jsonb_build_object('oid',p.oid::text,'xmin',p.xmin::text) FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(${quote(fault.material.signature)})),
 'trigger',(SELECT jsonb_build_object('oid',t.oid::text,'xmin',t.xmin::text) FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public."AuditLog"'::regclass AND t.tgname=${quote(triggerName)}))`:'NULL::jsonb';
 const xidSql=write?'pg_current_xact_id()::text':quote(removing?fault.removeXid:fault.installXid);
 const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ${write?'':' READ ONLY'};
SET LOCAL search_path=pg_catalog,public,pg_temp;
DO $life_fault_before$ BEGIN ${guard(installedBefore)} END $life_fault_before$;
${write?(removing?fault.material.removeSql:fault.material.installSql):''}
DO $life_fault_after$ BEGIN ${guard(installedAfter)}${!write?` IF pg_catalog.pg_xact_status(${xidSql}::xid8) IS DISTINCT FROM 'committed' OR pg_current_xact_id_if_assigned() IS NOT NULL THEN RAISE EXCEPTION 'CURRENT261_LOCAL_LIFECYCLE_FAULT_COMMIT'; END IF;`:''} END $life_fault_after$;
SELECT jsonb_build_object('nonce',${quote(nonce)},'phase',${quote(phase)},'pid',pg_backend_pid(),
 'start',(SELECT to_char(backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM pg_stat_activity WHERE pid=pg_backend_pid()),
 'xid',${xidSql},'writeXid',pg_current_xact_id_if_assigned()::text,'objects',${objectSql});
${commit}`;
 try{
  const result=await scope.exec.call(scope.resource,sql,'current261-local-lifecycle-'+phase.toLowerCase());check(scope,removing);
  const text=own(result,'stdout');need(typeof text==='string'&&Buffer.byteLength(text)<=4096,'OUTPUT');let row;
  try{row=JSON.parse(text);}catch{need(false,'OUTPUT');}
  need(row&&Object.keys(row).sort().join(',')==='nonce,objects,phase,pid,start,writeXid,xid'&&row.nonce===nonce&&row.phase===phase&&backend(row)&&xid(row.xid)&&
   (write?row.writeXid===row.xid:row.writeXid===null),'OUTPUT');
  if(scope.lastBackend)need(row.pid!==scope.lastBackend.pid&&row.start!==scope.lastBackend.start,'BACKEND');scope.lastBackend={pid:row.pid,start:row.start};
  if(installedAfter){
   need(row.objects&&Object.keys(row.objects).sort().join(',')==='function,trigger'&&['function','trigger'].every(k=>oid(row.objects[k]?.oid)&&xid(row.objects[k]?.xmin)&&Object.keys(row.objects[k]).sort().join(',')==='oid,xmin')&&row.objects.function.oid!==row.objects.trigger.oid,'OUTPUT');
   if(write)need(Object.values(row.objects).every(o=>o.xmin===xmin(row.xid)),'OUTPUT');
   else need(JSON.stringify(row.objects)===JSON.stringify(fault.objects)&&row.xid===fault.installXid,'OUTPUT');
  }else need(row.objects===null&&(!write?row.xid===fault.removeXid:true),'OUTPUT');
  return row;
 }finally{scope.pending=false;}
}
async function installCurrent261LocalLifecycleAuditFault(key){
 need(arguments.length===1,'SCOPE');const scope=ownerScope(key);check(scope);
 need(scope.stage===1&&scope.checkpoint?.stage==='ORIGINALS'&&!scope.fault,'FAULT_PHASE');
 const {describeCurrent261LocalLifecycleAuditFault,restoreCurrent261LocalLifecycleFaultCatalog}=require('./task12-current261-local-lifecycle-fault.cjs');
 const material=describeCurrent261LocalLifecycleAuditFault(scope.checkpoint.versionId);
 // Fail source-only before the first write if the two exact original catalog
 // nodes cannot be recovered. Never broaden the projection to make it fit.
 restoreCurrent261LocalLifecycleFaultCatalog(scope.lease.continuitySql,material);
 scope.fault={material,state:'INSTALLING'};
 try{
  const staged=await faultCommand(scope,'AUDIT_FAULT_INSTALL',true,false);
  scope.fault.objects=staged.objects;scope.fault.installXid=staged.xid;
  await faultCommand(scope,'AUDIT_FAULT_COMMITTED',false,false);scope.fault.state='INSTALLED';
 }catch(error){scope.failed=true;scope.fault.state='UNKNOWN';throw unknown(error);}
}
async function removeCurrent261LocalLifecycleAuditFault(key){
 need(arguments.length===1,'SCOPE');const scope=ownerScope(key);
 need(scope.fault?.state==='INSTALLED','FAULT_UNKNOWN');check(scope,true);
 scope.fault.state='REMOVING';
 try{
  const staged=await faultCommand(scope,'AUDIT_FAULT_REMOVE',true,true);scope.fault.removeXid=staged.xid;
  await faultCommand(scope,'AUDIT_FAULT_REMOVED_COMMITTED',false,true);scope.fault.state='REMOVED';
 }catch(error){scope.failed=true;scope.fault.state='UNKNOWN';throw unknown(error);}
}
async function closeCurrent261LocalLifecycleOwnerWindow(key){
 need(arguments.length===1,'SCOPE');const scope=ownerScope(key);
 try{
  if(scope.fault?.state==='INSTALLED')await removeCurrent261LocalLifecycleAuditFault(key);
  need(!scope.pending&&(!scope.fault||scope.fault.state==='REMOVED'),'FAULT_UNKNOWN');
  const matched=scope.stage===3&&!scope.failed&&scope.fault?.state==='REMOVED';
  return Object.freeze({status:'CURRENT261_LOCAL_LIFECYCLE_OWNER_CLOSED',matched,localOnly:true,
   cosAccepted:false,storageAccepted:false,browserAccepted:false,full394Accepted:false,nativeAdmission:false,executionAllowed:false});
 }catch(error){throw unknown(error);}
 finally{scope.available=false;active.delete(key);}
}
const stages=Object.freeze(['ORIGINALS','AUDIT_ROLLBACK','COMPLETE']);
const approvalRoles=Object.freeze(['contract_director','finance_director','general_manager','material_director','project_manager']);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function checkpoint(scope,token){
 const claim=own(scope.modules,'claimTask12LocalLifecycleCheckpoint');need(typeof claim==='function','CHECKPOINT');
 const e=claim(token);need(e&&stages[scope.stage]===e.stage&&e.projectId===scope.fixture.approval.project.id&&e.handlerId===scope.fixture.approval.handler.id&&
  e.fixtureIdentity===e.projectId&&uuid(e.contractId)&&uuid(e.versionId)&&e.contractId!==e.versionId,'PHASE');
 need(e.roundIds&&['withdrawn','rejected','approved'].every(k=>uuid(e.roundIds[k]))&&new Set(Object.values(e.roundIds)).size===3&&
  e.generationIds&&['first','second','final'].every(k=>uuid(e.generationIds[k]))&&e.generationIds.first!==e.generationIds.second&&
  Number.isInteger(e.final?.documentContentRevision)&&e.final.documentContentRevision>0&&hex(e.final?.documentContentFingerprint)&&
  Array.isArray(e.originals)&&e.originals.length===2&&new Set(e.originals.map(f=>f.id)).size===2&&e.originals.every(f=>uuid(f.id)&&hex(f.sha256)&&Number.isInteger(f.sizeBytes)&&f.sizeBytes>0&&f.sizeBytes<=512*1024),'CHECKPOINT');
 const generationIds=[...new Set(Object.values(e.generationIds))];
 need(Array.isArray(e.generatedFiles)&&e.generatedFiles.length===generationIds.length&&new Set(e.generatedFiles.map(g=>g.generationId)).size===generationIds.length&&e.generatedFiles.every(g=>generationIds.includes(g.generationId)&&['docx','pdf'].every(kind=>{
  const f=g[kind];return uuid(f?.id)&&hex(f.sha256)&&Number.isSafeInteger(f.sizeBytes)&&f.sizeBytes>0&&f.sizeBytes<=(kind==='docx'?25*1024*1024:100000000)&&f.mimeType===(kind==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf');
 })),'CHECKPOINT');
 if(scope.coordinates)need(scope.coordinates===JSON.stringify({...e,stage:undefined,archive:undefined}),'COORDINATES');
 else scope.coordinates=JSON.stringify({...e,stage:undefined,archive:undefined});
 return e;
}
function matches(facts,e){
 need(facts&&facts.firstSignatureVersionCount===1&&Array.isArray(facts.counts)&&facts.counts.length===5&&facts.counts.every(Number.isInteger),'FACTS');
 const complete=e.stage==='COMPLETE',generations=[...new Set(Object.values(e.generationIds))].sort(),ids=rows=>rows.map(r=>r.id).sort();
 need(JSON.stringify(facts.counts)===JSON.stringify([generations.length,3,1,complete?1:0,complete?2:0])&&
  facts.version?.id===e.versionId&&facts.version.status===(complete?'effective':'seal_approved_pending_archive')&&
  facts.version.documentContentRevision===e.final.documentContentRevision&&facts.version.documentContentFingerprint===e.final.documentContentFingerprint,'FACTS');
 need(Array.isArray(facts.generated)&&JSON.stringify(ids(facts.generated))===JSON.stringify(generations)&&facts.generated.every(g=>g.status==='success'&&
  typeof g.engineVersion==='string'&&!g.engineVersion.includes('synthetic')&&uuid(g.docxFileId)&&uuid(g.pdfFileId)&&e.generatedFiles.some(f=>f.generationId===g.id&&f.docx.id===g.docxFileId&&f.pdf.id===g.pdfFileId)),'FACTS');
 need(Array.isArray(facts.rounds)&&facts.rounds.length===3&&Object.entries(e.roundIds).every(([status,id])=>facts.rounds.some(r=>r.id===id&&r.status===status&&
  r.approves===(status==='withdrawn'?1:status==='approved'?5:0)&&r.unsigned===(status==='withdrawn'?1:0))),'FACTS');
 need(Array.isArray(facts.approvedRoles)&&facts.approvedRoles.length===5&&JSON.stringify(facts.approvedRoles.map(r=>r.role).sort())===JSON.stringify(approvalRoles)&&
  facts.approvedRoles.every(r=>r.count===1&&r.signed===true),'FACTS');
 need(Array.isArray(facts.sealTasks)&&facts.sealTasks.length===1&&uuid(facts.sealTasks[0].id)&&facts.sealTasks[0].status==='completed'&&facts.sealTasks[0].approvalInstanceId===e.roundIds.approved,'FACTS');
 need(Array.isArray(facts.originals)&&facts.originals.length===2&&e.originals.every(o=>facts.originals.some(f=>f.id===o.id&&f.sha256===o.sha256&&f.sizeBytes===o.sizeBytes&&f.private===true)),'FACTS');
 const audits=new Map((facts.audit??[]).map(r=>[r.action,r.count]));
 need(audits.size===(complete?3:2)&&audits.get('contract.seal.complete')===1&&audits.get('contract.archive_task.create')===1&&
  (complete?audits.get('contract.archive.complete')===1:!audits.has('contract.archive.complete')),'FACTS');
 need(Array.isArray(facts.archives)&&facts.archives.length===(complete?1:0)&&Array.isArray(facts.evidence)&&facts.evidence.length===(complete?2:0),'FACTS');
 if(complete){
  need(uuid(e.archive?.id)&&uuid(e.archive?.idempotencyKey)&&facts.archives[0].id===e.archive.id&&facts.archives[0].idempotencyKey===e.archive.idempotencyKey&&
   hex(facts.archives[0].authoritySha256)&&hex(facts.archives[0].fileManifestSha256)&&e.originals.every((o,i)=>facts.evidence.some(f=>f.fileId===o.id&&f.displayOrder===i&&f.contentSha256===o.sha256&&f.sizeBytes===o.sizeBytes&&f.private===true)),'FACTS');
 }
}
async function observeCurrent261LocalLifecycleOwner(key,token){
 need(arguments.length===2&&key&&!types.isProxy(key)&&active.has(key),'SCOPE');const scope=active.get(key);check(scope);
 try{
  const e=checkpoint(scope,token);
  need(e.stage==='ORIGINALS'?!scope.fault:e.stage==='AUDIT_ROLLBACK'?scope.fault?.state==='INSTALLED':scope.fault?.state==='REMOVED','FAULT_PHASE');
  const {current261LocalLifecycleFacts,current261LocalLifecycleFileFacts}=require('./task12-current261-local-lifecycle-facts.cjs');
  const facts=await read(scope,e.stage,current261LocalLifecycleFacts(scope.fixture,e.contractId,e.versionId,e.originals.map(f=>f.id)));
  matches(facts,e);
  const files=await read(scope,e.stage+'_FILES',current261LocalLifecycleFileFacts(scope.fixture,e.contractId,e.versionId,e.generatedFiles.map(g=>g.generationId)));
  need(Array.isArray(files)&&files.length===e.generatedFiles.length&&new Set(files.map(f=>f.generationId)).size===files.length&&e.generatedFiles.every(expected=>files.some(actual=>actual.generationId===expected.generationId&&['docx','pdf'].every(kind=>{
   const f=actual[kind],wanted=expected[kind];return f?.private===true&&f.id===wanted.id&&f.sha256===wanted.sha256&&f.sizeBytes===wanted.sizeBytes&&f.mimeType===wanted.mimeType;
  }))),'FACTS');
  scope.stage++;scope.checkpoint=e;return freeze({...facts,generatedFiles:files});
 }catch(error){scope.failed=true;throw error;}
}
async function beginCurrent261LocalLifecycleOwnerWindow(handle,proof,fixture){
 assertCurrent261GeneratedLifecycleLoginScope(proof,handle);
 need(arguments.length===3&&handle&&!types.isProxy(handle)&&!attempted.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=own(resource,'execOwnerSql'),lease=claimCurrent261LocalLifecycleOwnerProof(proof,handle);
 need(view.scope==='OWNED_RESOURCE_ONLY'&&resource.topology==='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS'&&typeof exec==='function'&&typeof own(resource,'getReceipt')==='function'&&
  lease.installation==='ARCHIVE261_REGISTERED_SEVEN'&&hex(lease.effectivePlanSha256)&&fixture&&Object.isFrozen(fixture)&&fixture.approval?.users.length===8&&uuid(fixture.approval.project.id),'HANDLE');
 const modules=view.loader.loadCurrent261LocalLifecycleDocumentModules();
 need(typeof own(modules,'isTask12LocalLifecycleFixture')==='function'&&modules.isTask12LocalLifecycleFixture(fixture),'FIXTURE');
 const scope={handle,proof,fixture,view,resource,exec,lease,modules,available:true,failed:false,pending:false,stage:0};attempted.add(handle);
 await read(scope,'BEGIN');const key=Object.freeze({});active.set(key,scope);return key;
}
module.exports=Object.freeze({beginCurrent261LocalLifecycleOwnerWindow,observeCurrent261LocalLifecycleOwner,installCurrent261LocalLifecycleAuditFault,removeCurrent261LocalLifecycleAuditFault,closeCurrent261LocalLifecycleOwnerWindow});
