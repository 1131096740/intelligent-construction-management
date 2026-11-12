'use strict';
// Import the original ordinary ACL producer before claiming its owned resource.
const {claimCurrent259OrdinaryArchiveAcl,claimCurrent259GeneratedDocumentOrdinaryAcl,claimCurrent261GeneratedLifecycleOrdinaryAcl}=require('./task16-current259-ordinary-archive-acl.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {randomBytes}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
const {registeredGeneratedLifecycleCollisionMaterial}=require('./task12-current261-generated-lifecycle-collision.cjs');
const CODE='CURRENT259_DOCUMENT_ROLE_PROVISION';
const names=Object.freeze(['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue']);
const phases=Object.freeze(['current259-document-roles-before','current259-document-roles-write','current259-document-roles-committed']);
const activeArchive=Object.freeze(['jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1',
 'jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_closure_v2','jg_contract_direct_upward_execution_binding_v2']);
const top='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const owner='jg_task01_owner';
const {isExactCurrentArchiveProfile}=require('./task16-current259-profile.cjs');
const attempted=new WeakSet(),issued=new WeakMap();
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const fault=stage=>Object.assign(new Error(CODE+'_'+stage),{code:CODE+'_'+stage});
const need=(ok,stage)=>{if(!ok)throw fault(stage);};
const number=(value,max)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=max;
const oid=value=>number(value,0xffffffffn);
const xid=value=>number(value,0xffffffffffffffffn);
const xmin=value=>String(BigInt(value)%0x100000000n);
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/u.test(value);
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const schema="to_regnamespace('public')::oid";
const identityKeys=['database','databaseOid','namespaceOid','systemIdentifier'];
const outputKeys=['phase','challenge','identity','backendPid','backendStart','stableSha256','ready','roles','installXid','commitStatus'];
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const setup="SET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL quote_all_identifiers=off;\nSET LOCAL standard_conforming_strings=on;";
const readOnly='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;';
const serializable='BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;';
const digest=expr=>`encode(sha256(convert_to((${expr})::text,'UTF8')),'hex')`;

function scope(acl,view,document){
 const {completion,roleCompletion,archiveCompletion,source}=acl;
 const resource=view.resource,profile=source.profile;
 const identity=Object.fromEntries(identityKeys.map(key=>[key,roleCompletion.databaseIdentity[key]]));
 if(document==='lifecycle'){
  qualifyCurrent261GeneratedLifecycleSource(source);
  const plan=registeredGeneratedLifecycleCollisionMaterial(source);
  need(completion.effectivePlanSha256===plan.sha256&&completion.installation===plan.installation,'HANDLE');
 }
 need((document==='lifecycle'?acl.generatedLifecycle===true&&completion.purpose==='CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1'
  :document?acl.generatedDocument===true&&completion.purpose==='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1'
  :acl.generatedDraft===true)&&completion.status==='CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION'&&
  completion.executionAllowed===false&&completion.nativeAdmission===false&&resource.topology===top&&
  completion.sourceSha===source.candidateSha&&equal(source,view.source)&&hex(completion.sourceSha,40)&&
  completion.runId===view.runId&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(completion.runId)&&
  completion.containerId===resource.containerId&&hex(completion.containerId,64)&&
  identity.database===resource.databaseName&&identity.database===`jg_task01_${view.runId.replaceAll('-','')}`&&
  oid(identity.databaseOid)&&oid(identity.namespaceOid)&&xid(identity.systemIdentifier)&&
  isExactCurrentArchiveProfile(profile)&&xid(completion.installXid)&&
  completion.archiveInstallXid===archiveCompletion.installXid&&xid(archiveCompletion.installXid)&&
  archiveCompletion.status==='CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED'&&archiveCompletion.registeredFileSource===true&&
  [completion.catalogSha256,completion.protectedSha256,archiveCompletion.bindingSha256,archiveCompletion.pendingSha256]
   .every(value=>hex(value,64))&&typeof acl.catalogSql==='string'&&typeof acl.protectedSql==='string','HANDLE');
 const reserved=['10',roleCompletion.ordinary.oid,...roleCompletion.roles.map(role=>role.oid)];
 need(reserved.every(oid)&&new Set(reserved).size===reserved.length,'HANDLE');
 return {identity,reserved,acl,ledger:profile.ledger};
}

function projection(input,phase,challenge,writeXid){
 const {identity,acl,ledger}=input;
 const staged=phase===phases[1],committed=phase===phases[2];
 const fixedNames=names.map(quote).join(',');
 const bindings=`jsonb_build_array(${activeArchive.map(name=>`(SELECT to_jsonb(b) FROM public.${name} b)`).join(',')})`;
 const pending="(SELECT to_jsonb(b) FROM public.jg_contract_direct_pending_binding_v1 b WHERE b.\"protocolVersion\"=1)";
 const oldRoles=`(SELECT jsonb_agg(jsonb_build_array(r.oid::text,r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,
   r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls,r.rolconnlimit,r.rolvaliduntil,r.xmin::text,
   r.rolpassword IS NULL) ORDER BY r.oid)
   FROM pg_authid r WHERE r.rolname::text NOT IN (${fixedNames}))`;
 const stable=digest(`jsonb_build_array(${oldRoles},
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole) FROM pg_db_role_setting s),
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d))`);
 const proof=`(d.datdba=10 AND current_user=${quote(owner)} AND session_user=current_user AND current_user::regrole::oid=10
  AND current_database()=${quote(identity.database)} AND d.oid=${quote(identity.databaseOid)}::oid AND ${schema}=${quote(identity.namespaceOid)}::oid
  AND (SELECT system_identifier::text FROM pg_control_system())=${quote(identity.systemIdentifier)}
  AND current_setting('server_version_num')::integer BETWEEN 160000 AND 169999 AND current_setting('session_replication_role')='origin'
  AND current_setting('transaction_read_only')=${quote(staged?'off':'on')} AND current_setting('transaction_isolation')=${quote(staged?'serializable':'repeatable read')}
  AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432 AND ssl.ssl
  AND pg_xact_status(${quote(acl.completion.installXid)}::xid8)='committed'
  AND pg_xact_status(${quote(acl.archiveCompletion.installXid)}::xid8)='committed'
  AND (${acl.catalogSql})=${quote(acl.completion.catalogSha256)} AND (${acl.protectedSql})=${quote(acl.completion.protectedSha256)}
  AND ${digest(bindings)}=${quote(acl.archiveCompletion.bindingSha256)} AND ${digest(pending)}=${quote(acl.archiveCompletion.pendingSha256)}
  AND (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,
   'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations)=${json(ledger)}
  AND NOT EXISTS(SELECT FROM pg_authid r WHERE r.rolname::text IN (${fixedNames}) AND
   (r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR r.rolpassword IS NOT NULL OR r.rolvaliduntil IS NOT NULL OR r.rolconnlimit<>0
    OR has_schema_privilege(r.oid,${schema},'CREATE')
    OR EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN (m.roleid,m.member))
    OR EXISTS(SELECT FROM pg_db_role_setting s WHERE s.setrole=r.oid)
    OR EXISTS(SELECT FROM pg_class c WHERE c.relnamespace=${schema} AND CASE
      WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'SELECT,USAGE,UPDATE')
      WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END)))) IS TRUE`;
 return `SELECT jsonb_build_object('phase',${quote(phase)},'challenge','${challenge}',
  'identity',jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',${schema}::text,
    'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),
  'backendPid',a.pid,'backendStart',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'stableSha256',${stable},'ready',${proof},
  'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',r.rolname,'oid',r.oid::text,'xmin',r.xmin::text)
    ORDER BY array_position(ARRAY[${fixedNames}],r.rolname::text)),'[]'::jsonb) FROM pg_authid r WHERE r.rolname::text IN (${fixedNames})),
  'installXid',${staged?'pg_current_xact_id()::text':committed?quote(writeXid):'NULL::text'},
  'commitStatus',${committed?`pg_xact_status(${quote(writeXid)}::xid8)`:'NULL::text'}) AS payload
 FROM pg_database d JOIN pg_stat_activity a ON a.datid=d.oid AND a.pid=pg_backend_pid()
 JOIN pg_stat_ssl ssl ON ssl.pid=a.pid WHERE d.datname=current_database()`;
}

function render(input,phase,challenge,before,writeXid){
 const query=projection(input,phase,challenge,writeXid);
 if(phase!==phases[1])return [readOnly,setup,query+';','ROLLBACK;'].join('\n');
 // No credentials or SQL source are taken from the caller. The only DDL is
 // the three fixed cluster roles, under the original database-owner transport.
 return [serializable,setup,`LOCK TABLE public._prisma_migrations,public.jg_contract_direct_pending_binding_v1,
 ${activeArchive.map(name=>'public.'+name).join(', ')} IN SHARE MODE NOWAIT;`,
 `CREATE TEMP TABLE jg_doc_roles_before ON COMMIT DROP AS ${query};`,
 `DO $doc_role_preimage$ DECLARE prior jsonb; BEGIN
 SELECT payload INTO STRICT prior FROM pg_temp.jg_doc_roles_before;
 IF prior->'ready' IS DISTINCT FROM 'true'::jsonb OR prior->'roles' IS DISTINCT FROM '[]'::jsonb
  OR prior->>'stableSha256' IS DISTINCT FROM ${quote(before.stableSha256)}
  OR prior->>'backendPid' IS NOT DISTINCT FROM ${quote(String(before.backendPid))}
  OR prior->>'backendStart' IS NOT DISTINCT FROM ${quote(before.backendStart)}
 THEN RAISE EXCEPTION 'CURRENT259_DOCUMENT_ROLE_PROVISION_PREIMAGE'; END IF;
 END $doc_role_preimage$;`,
 ...names.map(name=>`CREATE ROLE "${name}" NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0;`),
 `CREATE TEMP TABLE jg_doc_roles_after ON COMMIT DROP AS ${query};`,
 `DO $doc_role_postimage$ DECLARE after_row jsonb; BEGIN
 SELECT payload INTO STRICT after_row FROM pg_temp.jg_doc_roles_after;
 IF after_row->'ready' IS DISTINCT FROM 'true'::jsonb
  OR after_row->>'stableSha256' IS DISTINCT FROM ${quote(before.stableSha256)}
  OR (SELECT jsonb_agg(r->>'name' ORDER BY ordinal) FROM jsonb_array_elements(after_row->'roles') WITH ORDINALITY x(r,ordinal)) IS DISTINCT FROM ${json(names)}
  OR EXISTS(SELECT FROM jsonb_array_elements(after_row->'roles') x(r)
   WHERE r->>'xmin' IS DISTINCT FROM (pg_current_xact_id()::text::numeric % 4294967296)::text
      OR (r->>'oid')::oid IN (${input.reserved.map(value=>quote(value)+'::oid').join(',')}))
 THEN RAISE EXCEPTION 'CURRENT259_DOCUMENT_ROLE_PROVISION_POSTIMAGE'; END IF;
 END $doc_role_postimage$;`,
 'SELECT payload FROM pg_temp.jg_doc_roles_after;','COMMIT;'].join('\n');
}
const distinct=(left,right)=>left.backendPid!==right.backendPid&&left.backendStart!==right.backendStart;
function observation(result,input,phase,challenge){
 const stdout=own(result,'stdout');
 need(typeof stdout==='string'&&Buffer.byteLength(stdout)<=8192,'OUTPUT');
 let row;
 try{row=JSON.parse(stdout);}catch{throw fault('OUTPUT');}
 const before=phase===phases[0],committed=phase===phases[2];
 need(exactKeys(row,outputKeys)&&row.phase===phase&&row.challenge===challenge&&row.ready===true&&
  equal(row.identity,input.identity)&&hex(row.stableSha256,64)&&
  Number.isInteger(row.backendPid)&&row.backendPid>0&&row.backendPid<=2147483647&&typeof row.backendStart==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.backendStart)&&Number.isFinite(Date.parse(row.backendStart))&&
  row.commitStatus===(committed?'committed':null)&&Array.isArray(row.roles),'OUTPUT');
 if(before){need(row.installXid===null&&row.roles.length===0,'OUTPUT');return row;}
 need(xid(row.installXid)&&row.roles.length===names.length,'OUTPUT');
 const used=new Set(input.reserved);
 for(const [index,role] of row.roles.entries()){
  need(exactKeys(role,['name','oid','xmin'])&&role.name===names[index]&&oid(role.oid)&&
   !used.has(role.oid)&&role.xmin===xmin(row.installXid),'OUTPUT');
  used.add(role.oid);
 }
 return row;
}

async function provisionCurrent259GeneratedDocumentRoles(ordinaryAclCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return provision(ordinaryAclCompletion,handle,false);
}
async function provisionCurrent259GeneratedDocumentSaveRoles(ordinaryAclCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return provision(ordinaryAclCompletion,handle,true);
}
async function provisionCurrent261GeneratedLifecycleDocumentRoles(ordinaryAclCompletion,handle){
 need(arguments.length===2,'HANDLE');return provision(ordinaryAclCompletion,handle,'lifecycle');
}
async function provision(ordinaryAclCompletion,handle,document){
 need(handle&&typeof handle==='object'&&!types.isProxy(handle)&&!attempted.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle);
 need(view.resource.topology===top,'HANDLE');
 const claim=document==='lifecycle'?claimCurrent261GeneratedLifecycleOrdinaryAcl:document?claimCurrent259GeneratedDocumentOrdinaryAcl:claimCurrent259OrdinaryArchiveAcl;
 const acl=claim(ordinaryAclCompletion,handle);
 const input=scope(acl,view,document),resource=view.resource,exec=own(resource,'execOwnerSql');
 need(acl.completion===ordinaryAclCompletion&&typeof exec==='function','HANDLE');
 attempted.add(handle);
 const check=()=>{
  acl.check();view.check();
  need(claimCurrent259TechnicalResource(handle)===view&&view.resource===resource&&
   own(resource,'execOwnerSql')===exec&&resource.topology===top,'CONTINUITY');
 };
 const run=async(phase,before,writeXid)=>{
  check();
  const challenge=randomBytes(32).toString('hex');
  const result=await exec.call(resource,render(input,phase,challenge,before,writeXid),phase);
  check();return observation(result,input,phase,challenge);
 };
 let writing=false;
 try{
  const before=await run(phases[0]);
  writing=true;
  const staged=await run(phases[1],before);
  need(distinct(before,staged)&&staged.stableSha256===before.stableSha256&&
   ![ordinaryAclCompletion.installXid,ordinaryAclCompletion.archiveInstallXid].includes(staged.installXid),'STAGED');
  const committed=await run(phases[2],before,staged.installXid);
  need(distinct(before,committed)&&distinct(staged,committed)&&committed.stableSha256===staged.stableSha256&&
   committed.installXid===staged.installXid&&equal(committed.roles,staged.roles),'COMMITTED');
  check();
  const result=Object.freeze({status:'CURRENT259_DOCUMENT_ROLES_COMMITTED_NOT_ADMISSION',sourceSha:ordinaryAclCompletion.sourceSha,
   runId:view.runId,containerId:resource.containerId,installXid:committed.installXid,
   ...(document==='lifecycle'?{effectivePlanSha256:ordinaryAclCompletion.effectivePlanSha256,installation:ordinaryAclCompletion.installation}:{}),roleCount:names.length,executionAllowed:false,nativeAdmission:false});
  issued.set(result,{handle,check,lifecycle:document==='lifecycle',ordinaryAcl:acl,roles:Object.freeze(committed.roles.map(Object.freeze))});
  return result;
 }catch{
  const error=fault(writing?'COMMIT_UNCONFIRMED':'PRESTATE_REJECTED');
  try{await closeCurrent259OwnedResource(handle);}
  catch{Object.defineProperty(error,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});}
  throw error;
 }
}
function claimCurrent259GeneratedDocumentRoles(result,handle){
 need(arguments.length===2,'HANDLE');return claim(result,handle,false);
}
function claimCurrent261GeneratedLifecycleDocumentRoles(result,handle){
 need(arguments.length===2,'HANDLE');return claim(result,handle,true);
}
function claim(result,handle,lifecycle){
 const receipt=issued.get(result);
 need(receipt?.handle===handle&&receipt.lifecycle===lifecycle,'HANDLE');
 issued.delete(result);receipt.check();
 return Object.freeze({completion:result,ordinaryAclCompletion:receipt.ordinaryAcl.completion,
  ordinaryAcl:receipt.ordinaryAcl,source:receipt.ordinaryAcl.source,roles:receipt.roles,check:receipt.check});
}
module.exports=Object.freeze({provisionCurrent261GeneratedLifecycleDocumentRoles,claimCurrent261GeneratedLifecycleDocumentRoles,provisionCurrent259GeneratedDocumentRoles,provisionCurrent259GeneratedDocumentSaveRoles,
 claimCurrent259GeneratedDocumentRoles});
