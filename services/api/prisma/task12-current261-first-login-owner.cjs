'use strict';
const {randomBytes}=require('node:crypto'),{types,isDeepStrictEqual:equal}=require('node:util');
const {assertCurrent261FirstLoginScope,claimCurrent261FirstLoginOwnerProof}=require('./task12-current259-document-login.cjs');
const {claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
const active=new WeakMap(),attempted=new WeakSet();
const own=(v,k)=>v&&typeof v==='object'&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
const need=(ok,part)=>{if(!ok){const code='CURRENT261_FIRST_LOGIN_OWNER_'+part;throw Object.assign(Error(code),{code});}};
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const counters=['actorLastLogin','otherLastLogin','refreshTotal','actorRefresh','authAuditTotal','actorAuthAudit','rateRows','rateHits'];
// Fixed business readback: never select passwords, token hashes, tokens, or rate-limit keys.
const protectedTables=['Contract','ContractVersion','ApprovalInstance','ApprovalActionLog','ContractArchiveFile','ContractArchiveEvidenceFile','ContractFormalFile','ContractGeneratedDocument','ContractSealTask','FileObject','ContractLayoutTemplate','ContractLayoutTemplateVersion','ContractDraftCheckpoint','ContractDraftSubmissionRequest'];
function factsSql(scope){
 const actor=quote(scope.fixture.approval.users[0].id),users=scope.fixture.approval.users.map(u=>quote(u.id)).join(',');
 const protectedRows=protectedTables.map(table=>`SELECT ${quote(table)} AS name,coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS records FROM public."${table}" r`).join(' UNION ALL ')+" UNION ALL SELECT 'NonAuthAuditLog' AS name,coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS records FROM public.\"AuditLog\" r WHERE action NOT LIKE 'auth.%'";
 return `jsonb_build_object(
 'actorLastLogin',(SELECT count(*) FROM public."User" WHERE id=${actor} AND "lastLoginAt" IS NOT NULL),
 'otherLastLogin',(SELECT count(*) FROM public."User" WHERE id IN(${users}) AND id<>${actor} AND "lastLoginAt" IS NOT NULL),
 'refreshTotal',(SELECT count(*) FROM public."RefreshToken"),'actorRefresh',(SELECT count(*) FROM public."RefreshToken" WHERE "userId"=${actor} AND "revokedAt" IS NULL),
 'authAuditTotal',(SELECT count(*) FROM public."AuditLog" WHERE action LIKE 'auth.%'),
 'actorAuthAudit',(SELECT count(*) FROM public."AuditLog" WHERE action='auth.login' AND "actorUserId"=${actor} AND "businessId"=${actor} AND "businessType"='user'),
 'rateRows',(SELECT count(*) FROM public."AuthRateLimit"),'rateHits',(SELECT coalesce(sum(hits),0) FROM public."AuthRateLimit"),
 'protectedSha256',(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(p) ORDER BY name)::text,'UTF8')),'hex') FROM (${protectedRows}) p))`;
}
function check(scope){
 need(scope.available&&!scope.failed,'CLOSED');assertCurrent261FirstLoginScope(scope.proof,scope.handle);scope.lease.check();scope.view.check();
 need(claimCurrent259TechnicalResource(scope.handle)===scope.view&&scope.view.resource===scope.resource&&own(scope.resource,'execOwnerSql')===scope.exec,'CONTINUITY');
 const hba=own(scope.resource,'getReceipt').call(scope.resource).documentHba;
 need(hba?.purpose==='CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1'&&hba.rules===13&&hba.loginInstallXid===scope.proof.installXid&&hba.effectivePlanSha256===scope.lease.effectivePlanSha256&&hba.installation===scope.lease.installation&&hba.plaintextNoEncryptionRejected===true,'CONTINUITY');
}
async function read(scope,phase){
 check(scope);need(!scope.pending,'PENDING');scope.pending=true;const nonce=randomBytes(32).toString('hex'),{identity}=scope.lease;
 const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,pg_temp;
DO $auth_owner$ BEGIN IF NOT (current_database()=${quote(identity.database)} AND current_user::regrole::oid=10 AND session_user=current_user
 AND (SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10)=${quote(identity.databaseOid)} AND to_regnamespace('public')::oid::text=${quote(identity.namespaceOid)}
 AND (SELECT system_identifier::text FROM pg_control_system())=${quote(identity.systemIdentifier)}
 AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
 AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AND current_setting('session_replication_role')='origin' AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999
 AND (${scope.lease.continuitySql}) IS NOT DISTINCT FROM ${quote(scope.lease.continuitySha256)}) THEN RAISE EXCEPTION 'CURRENT261_FIRST_LOGIN_OWNER_CONTINUITY'; END IF; END $auth_owner$;
SELECT jsonb_build_object('nonce',${quote(nonce)},'phase',${quote(phase)},'pid',pg_backend_pid(),
 'start',(SELECT to_char(backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM pg_stat_activity WHERE pid=pg_backend_pid()),'facts',${factsSql(scope)});
ROLLBACK;`;
 try{
  const response=await scope.exec.call(scope.resource,sql,'current261-first-login-owner-'+phase.toLowerCase());check(scope);
  const text=own(response,'stdout');need(typeof text==='string'&&Buffer.byteLength(text)<=4096,'OUTPUT');let row;try{row=JSON.parse(text);}catch{need(false,'OUTPUT');}
  need(row&&Object.keys(row).sort().join(',')==='facts,nonce,phase,pid,start'&&row.nonce===nonce&&row.phase===phase&&Number.isSafeInteger(row.pid)&&row.pid>0&&typeof row.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.start),'OUTPUT');
  if(scope.lastBackend)need(row.pid!==scope.lastBackend.pid&&row.start!==scope.lastBackend.start,'BACKEND');scope.lastBackend={pid:row.pid,start:row.start};
  const f=row.facts;need(f&&Object.keys(f).sort().join(',')===[...counters,'protectedSha256'].sort().join(',')&&counters.every(k=>Number.isSafeInteger(f[k])&&f[k]>=0&&f[k]<=64)&&sha(f.protectedSha256),'FACTS');return Object.freeze({...f});
 }catch(error){scope.failed=true;throw error;}finally{scope.pending=false;}
}
function scopeFor(key){need(key&&!types.isProxy(key)&&active.has(key),'SCOPE');return active.get(key);}
async function beginCurrent261FirstLoginOwnerWindow(handle,proof,fixture){
 need(arguments.length===3,'HANDLE');assertCurrent261FirstLoginScope(proof,handle);
 need(handle&&!types.isProxy(handle)&&!attempted.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=own(resource,'execOwnerSql'),lease=claimCurrent261FirstLoginOwnerProof(proof,handle);
 need(view.scope==='OWNED_RESOURCE_ONLY'&&resource.topology==='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS'&&typeof exec==='function'&&lease.executionPurpose==='AUTH_ONLY_DIAGNOSTIC'&&lease.installation==='ARCHIVE261_REGISTERED_SEVEN'&&sha(lease.effectivePlanSha256)&&fixture&&Object.isFrozen(fixture)&&fixture.approval?.users.length===8&&fixture.approval.users.every(u=>uuid(u.id))&&new Set(fixture.approval.users.map(u=>u.id)).size===8,'HANDLE');
 need(view.loader.loadCurrent261FirstLoginModules().isTask12LocalLifecycleFixture(fixture),'FIXTURE');attempted.add(handle);
 const scope={handle,proof,fixture,view,resource,exec,lease,available:true,failed:false,pending:false,observed:false};
 scope.before=await read(scope,'BEGIN');need(counters.every(k=>scope.before[k]===0),'PREIMAGE');const key=Object.freeze({});active.set(key,scope);return key;
}
async function observeCurrent261FirstLoginOwner(key,result){
 need(arguments.length===2,'INPUT');const scope=scopeFor(key);check(scope);need(!scope.observed,'PHASE');scope.observed=true;
 try{
  const goal=own(result,'goal'),httpReturned=goal==='TASK12_FIRST_LOGIN_HTTP_RETURNED';need(httpReturned&&own(result,'httpStatus')===201||goal==='TASK12_FIRST_LOGIN_HTTP_FAILED','PHASE');
  const facts=await read(scope,'AFTER_HTTP');need(facts.protectedSha256===scope.before.protectedSha256&&facts.otherLastLogin===0&&facts.refreshTotal===facts.actorRefresh&&facts.authAuditTotal===facts.actorAuthAudit&&facts.actorLastLogin<=1&&facts.actorRefresh<=1&&facts.actorAuthAudit<=1&&facts.rateRows<=2&&facts.rateHits===facts.rateRows,'FACTS');
  if(httpReturned)need(facts.actorLastLogin===1&&facts.actorRefresh===1&&facts.actorAuthAudit===1&&facts.rateRows===2&&facts.rateHits===2,'FACTS');
  scope.after=facts;scope.observation=Object.freeze({authObserved:true,httpReturned,effects:Object.freeze(Object.fromEntries(counters.map(k=>[k,facts[k]]))),protectedBusinessUnchanged:true,full394Accepted:false});return scope.observation;
 }catch(error){scope.failed=true;throw error;}
}
async function closeCurrent261FirstLoginOwnerWindow(key){
 need(arguments.length===1,'INPUT');const scope=scopeFor(key);
 try{need(scope.observed&&scope.after&&!scope.pending,'PHASE');const final=await read(scope,'CLOSE');need(equal(final,scope.after),'FACTS');
  return Object.freeze({status:'CURRENT261_FIRST_LOGIN_OWNER_CLOSED',authObserved:true,full394Accepted:false,nativeAdmission:false,cleanupAccepted:false});
 }catch(error){try{Object.defineProperty(error,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true,configurable:true});}catch{/* Original error retained. */}throw error;}
 finally{scope.available=false;active.delete(key);}
}
module.exports=Object.freeze({beginCurrent261FirstLoginOwnerWindow,observeCurrent261FirstLoginOwner,closeCurrent261FirstLoginOwnerWindow});
