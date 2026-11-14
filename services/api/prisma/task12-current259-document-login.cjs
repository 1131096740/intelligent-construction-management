'use strict';
const {createHash,createHmac,pbkdf2Sync,randomBytes}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {isDeepStrictEqual:equal,types}=require('node:util');
const {claimCurrent259GeneratedDocumentAcl,claimCurrent259GeneratedDocumentSaveAcl,claimCurrent261GeneratedLifecycleDocumentAcl}=require('./task12-current259-document-acl-transport.cjs');
const {claimCurrent259TechnicalResource,claimCurrent259TechnicalResourceContinuity,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {current259AclRowsSql}=require('./task16-current259-catalog.cjs');
const {withCurrent259ApplicationEnvironment}=require('./task16-current259-application-environment.cjs');
const {createCurrent259GeneratedDocumentSeed,createCurrent261LocalLifecycleSeed}=require('./task12-current259-q2-seed.cjs');
const {readQualifiedTask16File}=require('./task16-runtime-inputs.cjs');

const CODE='CURRENT259_DOCUMENT_LOGIN';
const {describeCurrent261LocalLifecycle}=require('./task12-current261-local-lifecycle-scope.cjs');
const {describeCurrent261GeneratedLifecycleDocumentAcl}=require('./task12-current259-document-acl.cjs');
const {generatedLifecycleCollisionSql}=require('./task12-current261-generated-lifecycle-collision.cjs');
const lifecyclePurpose='CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1';
const savePurpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const ordinaryLimit=2;
const caseCoordinate=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const topology='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const names=Object.freeze(['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue']);
const consumed=new WeakSet(),active=new WeakMap(),nestBridges=new WeakSet(),lifecycleExercises=new WeakMap();
const fixedReasons=new WeakMap();
const sha=value=>createHash('sha256').update(value).digest('hex');
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const fault=part=>{
 const error=Object.assign(Error(CODE+'_'+part),{code:CODE+'_'+part});
 fixedReasons.set(error,part);return error;
};
const need=(ok,part)=>{if(!ok)throw fault(part);};
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[0-9a-f]+$/u.test(value);
const number=(value,max)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=max;
const xid=value=>number(value,0xffffffffffffffffn);
const oid=value=>number(value,0xffffffffn);
const xmin=value=>String(BigInt(value)%0x100000000n);
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const digest=value=>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${value})::text,'UTF8')),'hex')`;
const setup="SET LOCAL search_path TO pg_catalog, public, pg_temp;\nSET LOCAL quote_all_identifiers TO off;\nSET LOCAL standard_conforming_strings TO on;";
const logging=[
 ['log_transaction_sample_rate','0'],['log_statement','none'],['log_min_error_statement','panic'],
 ['log_error_verbosity','terse'],['log_parameter_max_length_on_error','0'],['log_parameter_max_length','0'],
 ['log_duration','off'],['log_min_duration_statement','-1'],['log_min_duration_sample','-1'],
 ['debug_print_parse','off'],['debug_print_rewritten','off'],['debug_print_plan','off']
];
const stamp="to_char(backend_start AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')";
const namespace="to_regnamespace('public')::oid";
const schemaOwner=`(SELECT n.nspowner FROM pg_namespace n WHERE n.oid=${namespace})`;
const scopes=Object.freeze({BEFORE:'current259-document-login-before',WRITE:'current259-document-login-write',COMMITTED:'current259-document-login-committed'});
const manifestSha='d2dfd0f356152bb7acb41074b9aa39004907dc24c2359b0f2f9dffd8b49b3038';

function password(){
 const bytes=randomBytes(48),secret=Buffer.alloc(96),digits='0123456789abcdef';
 try{
  bytes.forEach((byte,i)=>{secret[i*2]=digits.charCodeAt(byte>>>4);secret[i*2+1]=digits.charCodeAt(byte&15);});
  return secret;
 }finally{bytes.fill(0);}
}
function verifier(secret){
 const salt=randomBytes(16),salted=pbkdf2Sync(secret,salt,4096,32,'sha256');
 const hmac=label=>createHmac('sha256',salted).update(label).digest();
 const client=hmac('Client Key'),server=hmac('Server Key');
 try{return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(client).digest('base64')}:${server.toString('base64')}`;}
 finally{salt.fill(0);salted.fill(0);client.fill(0);server.fill(0);}
}
function replaceExact(sql,marker,replacement){
 need(sql.split(marker).length===2,'RENDER');
 return sql.replace(marker,()=>replacement);
}
function qualify(lease,view,save,lifecycle=false){
 const {completion,roles,source,ordinaryAcl,continuitySql,continuitySha256}=lease;
 const {resource,runId}=view,identity=ordinaryAcl.roleCompletion.databaseIdentity;
 const predecessors=[completion.roleInstallXid,completion.installXid,ordinaryAcl.completion.installXid,ordinaryAcl.completion.archiveInstallXid];
 need(completion.status==='CURRENT259_DOCUMENT_ACL_COMMITTED_NOT_ADMISSION'&&completion.executionAllowed===false&&
  completion.nativeAdmission===false&&equal(source,view.source)&&completion.sourceSha===source.candidateSha&&hex(source.candidateSha,40)&&
  completion.runId===runId&&completion.containerId===resource.containerId&&hex(resource.containerId,64)&&
  typeof continuitySql==='string'&&hex(continuitySha256,64)&&predecessors.every(xid)&&new Set(predecessors).size===predecessors.length&&
  identity.database===resource.databaseName&&/^jg_task01_[a-f0-9]{32}$/u.test(identity.database)&&
  identity.database==='jg_task01_'+runId.replaceAll('-','')&&oid(identity.databaseOid)&&oid(identity.namespaceOid)&&xid(identity.systemIdentifier)&&
  Array.isArray(roles)&&roles.length===names.length&&roles.every((role,i)=>role.name===names[i]&&oid(role.oid)&&
   role.oid!=='10'&&role.xmin===xmin(completion.roleInstallXid))&&new Set(roles.map(role=>role.oid)).size===names.length,'HANDLE');
 if(lifecycle){
  const plan=describeCurrent261LocalLifecycle(source);
  need(ordinaryAcl.generatedLifecycle===true&&ordinaryAcl.generatedDocument!==true&&completion.effectivePlanSha256===plan.effectivePlanSha256&&
   completion.installation===plan.installation&&ordinaryAcl.completion.effectivePlanSha256===plan.effectivePlanSha256&&ordinaryAcl.completion.installation===plan.installation,'HANDLE');
 }else need(ordinaryAcl.generatedLifecycle!==true&&(ordinaryAcl.generatedDocument===true)===save,'HANDLE');
 let ordinary;
 if(save){
  const {roleCompletion}=ordinaryAcl;
  const {name,oid:roleOid,login,limit,password}=roleCompletion.ordinary??{};
  need(ordinaryAcl.completion.purpose===(lifecycle?lifecyclePurpose:savePurpose)&&ordinaryAcl.generatedDraft!==true&&
   roleCompletion.status==='CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'&&roleCompletion.sourceSha===completion.sourceSha&&
   roleCompletion.runId===runId&&roleCompletion.containerId===resource.containerId&&
   roleCompletion.executionAllowed===false&&roleCompletion.nativeAdmission===false&&
   /^jg_fixture_app_[a-f0-9]{24}$/u.test(name)&&oid(roleOid)&&roleOid!=='10'&&
   !roles.some(role=>role.oid===roleOid)&&login===true&&limit===0&&password==='absent'&&
   ['superuser','inherit','createRole','createDb','replication','bypassRls'].every(key=>roleCompletion.ordinary[key]===false)&&
   roleCompletion.ordinary.unlimitedValidity===true&&xid(roleCompletion.commitXid)&&!predecessors.includes(roleCompletion.commitXid),'HANDLE');
  predecessors.push(roleCompletion.commitXid);
  ordinary=Object.freeze({name,oid:roleOid});
 }
 return {roles,identity,predecessors,continuitySql,continuitySha256,ordinary,
  lifecycleMaterial:lifecycle?describeCurrent261GeneratedLifecycleDocumentAcl(source):undefined,
  targets:ordinary?[...roles,ordinary]:roles};
}

function documentAcl(ids,material){
 const bytes=readFileSync(join(__dirname,'task12-current259-document-acl.json'));
 need(sha(bytes)===manifestSha,'SOURCE');
 const {roles}=JSON.parse(bytes),expected=[];
 if(material)expected.push(...material.rows);
 if(!material)for(const [role,tables] of Object.entries(roles))
  for(const [relation,operations] of Object.entries(tables))
   for(const [privilege,columns] of Object.entries(operations))
    for(const column of columns)expected.push({role,relation,column,privilege:privilege.toUpperCase()});
 return `NOT EXISTS(WITH expected AS (
  SELECT e.*, '10'::text AS grantor,false AS grantable FROM jsonb_to_recordset(${json(expected)}) e(role text,relation text,"column" text,privilege text)
 ), actual AS (
  SELECT r.rolname::text,c.relname::text,a.attname::text,g.privilege_type,g.grantor::text,g.is_grantable
  FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  CROSS JOIN LATERAL ${current259AclRowsSql('a.attacl')} g
  JOIN pg_authid r ON r.oid=g.grantee AND r.oid IN (${ids}) WHERE c.relnamespace=${namespace}
 ) (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual))
 AND NOT EXISTS(SELECT FROM pg_class c CROSS JOIN pg_authid r WHERE c.relnamespace=${namespace}
  AND r.oid IN (${ids}) AND c.relkind IN ('r','p','v','m','f')
  AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))${material?(()=>{const fixed=generatedLifecycleCollisionSql(material.collision);return ` AND (${fixed.metadata}) AND (${fixed.installation}) AND (${fixed.acl(true)})`;})():''}`;
}
function catalog(input){
 const {identity,roles,continuitySql,predecessors,targets,ordinary}=input;
 const ids=roles.map(role=>quote(role.oid)+'::oid').join(',');
 const targetIds=ordinary?targets.map(role=>quote(role.oid)+'::oid').join(','):ids;
 const aclRows=(kind,acl,owner)=>`aclexplode(COALESCE(${acl},acldefault('${kind}',${owner})))`;
 const databaseAcl=aclRows('d','d.datacl','d.datdba'),schemaAcl=aclRows('n','n.nspacl','n.nspowner');
 const others=acl=>`(SELECT COALESCE(jsonb_agg(jsonb_build_array(g.grantor,g.grantee,g.privilege_type,g.is_grantable)
  ORDER BY g.grantor,g.grantee,g.privilege_type COLLATE "C",g.is_grantable),'[]'::jsonb) FROM ${acl} g WHERE g.grantee NOT IN (${ids}))`;
 let stable=replaceExact(continuitySql,'n.nspacl::text',others(schemaAcl));
 stable=replaceExact(stable,'(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d)',
  `(SELECT jsonb_agg(CASE WHEN d.oid=${quote(identity.databaseOid)}::oid THEN
   jsonb_build_array(to_jsonb(d)-'datacl',${others(databaseAcl)}) ELSE to_jsonb(d) END ORDER BY d.oid) FROM pg_database d)`);
 stable=replaceExact(stable,'r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r)',
  `r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r WHERE r.oid NOT IN (${targetIds}))`);
 const access=`(SELECT COALESCE(jsonb_agg(jsonb_build_array(kind,target::text,grantor::text,grantee::text,privilege,is_grantable)
  ORDER BY kind COLLATE "C",target,grantee,grantor,privilege COLLATE "C",is_grantable),'[]'::jsonb) FROM (
  SELECT 'database'::text AS kind,d.oid AS target,g.grantor,g.grantee,g.privilege_type AS privilege,g.is_grantable
   FROM pg_database d CROSS JOIN LATERAL ${databaseAcl} g WHERE g.grantee IN (${ids})
  UNION ALL
  SELECT 'schema',n.oid,g.grantor,g.grantee,g.privilege_type,g.is_grantable
   FROM pg_namespace n CROSS JOIN LATERAL ${schemaAcl} g WHERE g.grantee IN (${ids})
 ) granted)`;
 const roleOrder=targets.map(role=>quote(role.name)).join(',');
 const roleState=`(SELECT jsonb_agg(jsonb_build_array(r.oid::text,r.rolname,r.xmin::text,r.rolcanlogin,r.rolconnlimit,
  CASE WHEN r.rolpassword IS NULL THEN NULL ELSE ${digest('r.rolpassword')} END)
  ORDER BY array_position(ARRAY[${roleOrder}],r.rolname::text))
  FROM pg_authid r WHERE r.oid IN (${targetIds}) AND r.rolvaliduntil IS NULL AND NOT
  (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
  AND NOT has_schema_privilege(r.oid,${namespace},'CREATE')
  AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)
  AND NOT EXISTS(SELECT FROM pg_db_role_setting t WHERE t.setrole=r.oid))`;
 const hbaRows=[
  ['local',['all'],['jg_task01_owner'],null,null,'peer',['map=jg_task01_init'],null],
  ['local',['all'],['all'],null,null,'reject',[],null],
  ...['0.0.0.0','::'].map(ip=>['hostnossl',['all'],['all'],ip,ip,'reject',[],null]),
  ...['owner','runtime','observer'].map(role=>['hostssl',[identity.database],['jg_task01_'+role],'127.0.0.1','255.255.255.255','scram-sha-256',[],null]),
  ...['0.0.0.0','::'].map(ip=>['hostssl',['all'],['all'],ip,ip,'reject',[],null])
 ];
 const hba=`(SELECT jsonb_agg(jsonb_build_array(type,database,user_name,address,netmask,auth_method,
  COALESCE(options,ARRAY[]::text[]),error) ORDER BY line_number) FROM pg_catalog.pg_hba_file_rules
  WHERE file_name='/jg-task01/pg_hba.conf') IS NOT DISTINCT FROM ${json(hbaRows)}
  AND NOT EXISTS(SELECT FROM pg_catalog.pg_hba_file_rules WHERE file_name IS DISTINCT FROM '/jg-task01/pg_hba.conf')`;
 const common=`current_database()=${quote(identity.database)} AND current_user::regrole::oid=10 AND session_user=current_user
  AND EXISTS(SELECT FROM pg_database d WHERE d.datname=current_database() AND d.datdba=10 AND d.oid=${quote(identity.databaseOid)}::oid)
  AND ${namespace}=${quote(identity.namespaceOid)}::oid AND ${schemaOwner} IN (10,'pg_database_owner'::regrole::oid)
  AND (SELECT system_identifier::text FROM pg_control_system())=${quote(identity.systemIdentifier)}
  AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999 AND getdatabaseencoding()='UTF8'
  AND current_setting('session_replication_role')='origin'
  AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
  AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND current_setting('max_connections')::int=16
  AND 16-current_setting('superuser_reserved_connections')::int-current_setting('reserved_connections')::int>=10
  AND NOT EXISTS(SELECT FROM pg_stat_activity a WHERE a.backend_type='client backend' AND a.pid<>pg_backend_pid())
  AND ${predecessors.map(value=>`pg_xact_status(${quote(value)}::xid8)='committed'`).join(' AND ')}
  AND (${hba}) AND (${documentAcl(ids,input.lifecycleMaterial)})${ordinary?`
  AND has_database_privilege(${quote(ordinary.oid)}::oid,${quote(identity.databaseOid)}::oid,'CONNECT')
  AND has_schema_privilege(${quote(ordinary.oid)}::oid,${namespace},'USAGE')`:''}`;
 const expectedAccess=owner=>['database','schema'].flatMap(kind=>[...roles].sort((a,b)=>Number(a.oid)-Number(b.oid)).map(role=>
  [kind,kind==='database'?identity.databaseOid:identity.namespaceOid,kind==='database'?'10':owner,role.oid,kind==='database'?'CONNECT':'USAGE',false]));
 return {stable,access,roleState,common,expectedAccess};
}

function render(input,c,phase,nonce,before,verifiers,staged){
 const writing=phase==='WRITE',committed=phase==='COMMITTED';
 const writeXid=writing?'pg_current_xact_id()::text':committed?quote(staged.xid):'NULL::text';
 const status=committed?`pg_xact_status(${quote(staged.xid)}::xid8)`:'NULL::text';
 const initialRoles=input.roles.map(role=>[role.oid,role.name,role.xmin,false,0,null]);
 const beforeRoles=input.ordinary?(before?json(before.roles):`(${json(initialRoles)}||jsonb_build_array(jsonb_build_array(
  ${quote(input.ordinary.oid)},${quote(input.ordinary.name)},
  (SELECT r.xmin::text FROM pg_authid r WHERE r.oid=${quote(input.ordinary.oid)}::oid),true,0,NULL)))`):json(initialRoles);
 const stagedRoles=writing&&`jsonb_build_array(${input.targets.map((role,i)=>
  `jsonb_build_array(${quote(role.oid)},${quote(role.name)},(pg_current_xact_id()::text::numeric%4294967296)::text,true,${role===input.ordinary?ordinaryLimit:1},${quote(sha(verifiers[i]))})`).join(',')})`;
 const fixedBefore=`(${input.continuitySql}) IS NOT DISTINCT FROM ${quote(input.continuitySha256)}`;
 const guard=(tag,post)=>`DO $doc_login_${tag}$ BEGIN
 IF (${c.common}) IS DISTINCT FROM true
 OR (${c.roleState}) IS DISTINCT FROM ${post?(writing?stagedRoles:json(staged.roles)):beforeRoles}
 OR (${c.access}) IS DISTINCT FROM ${json(post?c.expectedAccess(before.schemaOwner):[])}
 ${post?'':`OR NOT (${fixedBefore})`}
 ${before?`OR (${c.stable}) IS DISTINCT FROM ${quote(before.stable)}
 OR ${schemaOwner} IS DISTINCT FROM ${quote(before.schemaOwner)}::oid`:''}
 ${committed?`OR ${status} IS DISTINCT FROM 'committed'`:''}
 ${writing?`OR NOT (${logging.map(([key,value])=>`current_setting(${quote(key)})=${quote(value)}`).join(' AND ')})`:''}
 THEN RAISE EXCEPTION '${CODE}_${tag.toUpperCase()}'; END IF;
 END $doc_login_${tag}$;`;
 const roleList=names.map(name=>`"${name}"`).join(',');
 return [
  ...(writing?logging.map(([key,value])=>`SET ${key}=${quote(value)};`):[]),
  writing?'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
  setup,
  ...(writing?["SET LOCAL password_encryption='scram-sha-256';",'LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE NOWAIT;']:[]),
  guard(committed?'committed':'preimage',committed),
  ...(writing?[
   ...input.targets.map((role,i)=>role===input.ordinary
    ?`ALTER ROLE "${role.name}" CONNECTION LIMIT ${ordinaryLimit} PASSWORD ${quote(verifiers[i])};`
    :`ALTER ROLE "${role.name}" LOGIN CONNECTION LIMIT 1 PASSWORD ${quote(verifiers[i])};`),
   `GRANT CONNECT ON DATABASE "${input.identity.database}" TO ${roleList};`,
   `GRANT USAGE ON SCHEMA public TO ${roleList};`,
   guard('postimage',true)
  ]:[]),
  `SELECT jsonb_build_object('nonce','${nonce}','stable',${c.stable},'pid',pg_backend_pid(),'start',
   (SELECT ${stamp} FROM pg_stat_activity WHERE pid=pg_backend_pid()),'xid',${writeXid},'status',${status},
   'roles',${c.roleState},'access',${c.access},'schemaOwner',${schemaOwner}::text);`,
  writing?'COMMIT;':'ROLLBACK;'
 ].join('\n');
}

function read(result,nonce){
 const out=own(result,'stdout');
 need(typeof out==='string'&&Buffer.byteLength(out)<=8192,'OUTPUT');
 let row;
 try{row=JSON.parse(out);}catch{throw fault('OUTPUT');}
 need(row&&Object.keys(row).sort().join(',')==='access,nonce,pid,roles,schemaOwner,stable,start,status,xid'&&
  row.nonce===nonce&&oid(row.schemaOwner)&&hex(row.stable,64)&&Number.isInteger(row.pid)&&row.pid>0&&row.pid<=0x7fffffff&&
  typeof row.start==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(row.start),'OUTPUT');
 return row;
}
const independent=(left,right)=>left.pid!==right.pid&&left.start!==right.start;

function withCurrent259GeneratedDocumentLogin(aclResult,handle,use){
 if(arguments.length!==3)return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,false);
}
function withCurrent259GeneratedDocumentRoleServices(aclResult,handle,use){
 if(arguments.length!==3)return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,true);
}
function withCurrent259GeneratedDocumentSaveRoleServices(aclResult,handle,use){
 if(arguments.length!==3)return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,true,true);
}
function withCurrent259GeneratedDocumentSaveApplication(aclResult,handle,use){
 if(arguments.length!==3)return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,true,true,true);
}
function withCurrent259GeneratedDocumentPublicApplication(aclResult,handle,caseId,use){
 if(arguments.length!==4||typeof caseId!=='string'||!caseCoordinate.test(caseId))return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,true,true,true,caseId);
}
function withCurrent261LocalLifecyclePublicApplication(aclResult,handle,caseId,signal,use,continuityToken){
 if(![5,6].includes(arguments.length)||typeof caseId!=='string'||!caseCoordinate.test(caseId)||!(signal instanceof AbortSignal)||types.isProxy(signal)||signal.aborted)return Promise.reject(fault('HANDLE'));
 return runLogin(aclResult,handle,use,true,true,true,caseId,true,signal,continuityToken);
}
function takeCurrent261LocalLifecycleExerciseBridge(key){
 need(arguments.length===1&&key&&!types.isProxy(key)&&lifecycleExercises.has(key),'HANDLE');
 const scope=lifecycleExercises.get(key);scope.check();lifecycleExercises.delete(key);return scope;
}
function takeCurrent259GeneratedDocumentApplicationBridge(bridge){
 need(arguments.length===1&&nestBridges.delete(bridge),'HANDLE');
}
async function runLogin(aclResult,handle,use,withRoles,save=false,nest=false,caseId,lifecycle=false,lifecycleSignal,continuityToken){
 need(handle&&typeof handle==='object'&&!types.isProxy(handle)&&
  typeof use==='function'&&!types.isProxy(use)&&!consumed.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=own(resource,'execOwnerSql');
 need(resource.topology===topology&&typeof exec==='function','HANDLE');
 const claim=lifecycle?claimCurrent261GeneratedLifecycleDocumentAcl:save?claimCurrent259GeneratedDocumentSaveAcl:claimCurrent259GeneratedDocumentAcl;
 need(typeof claim==='function','HANDLE');
 const lease=claim(aclResult,handle),input=qualify(lease,view,save,lifecycle);
 need(aclResult===lease.completion,'HANDLE');
 let official;
 if(lifecycle){
  const modules=view.loader.loadCurrent261LocalLifecycleDocumentModules();official=modules.currentOfficialDocumentScope();
  need(official?.kind==='OFFICIAL_TOOL_RUNTIME'&&require('./task12-official-document-profiles.cjs').officialDocumentProfile(official.profile)&&official.source?.head===view.source.candidateSha,'ROLE_RUNTIME');
 }
 consumed.add(handle);
 const check=()=>{
  if(continuityToken!==undefined){
   need(lifecycle,'HANDLE');lease.checkContinuity(continuityToken);view.checkContinuity(continuityToken);
  }else{lease.check();view.check();}
  if(lifecycle)need(!lifecycleSignal.aborted&&view.loader.loadCurrent261LocalLifecycleDocumentModules().currentOfficialDocumentScope()===official,'ROLE_RUNTIME');
  need((continuityToken===undefined?claimCurrent259TechnicalResource(handle):claimCurrent259TechnicalResourceContinuity(handle,continuityToken))===view&&view.resource===resource&&
   resource.topology===topology&&own(resource,'execOwnerSql')===exec,'CONTINUITY');
 };
 const secrets=[];
 let phase='BEFORE',proof,continuityCleanupUnknown=false;
 try{
  check();
  const c=catalog(input);
  const run=async(next,before,verifiers,staged)=>{
   phase=next;check();
   const nonce=randomBytes(32).toString('hex'),sql=render(input,c,next,nonce,before,verifiers,staged);
   const result=await exec.call(resource,sql,scopes[next]);
   check();return read(result,nonce);
  };
  const before=await run('BEFORE');
  const expectedBefore=input.roles.map(role=>[role.oid,role.name,role.xmin,false,0,null]);
  if(input.ordinary){
   const old=before.roles?.[names.length];
   need(Array.isArray(old)&&oid(old[2]),'PREIMAGE');
   expectedBefore.push([input.ordinary.oid,input.ordinary.name,old[2],true,0,null]);
  }
  need(before.xid===null&&before.status===null&&equal(before.access,[])&&equal(before.roles,expectedBefore),'PREIMAGE');
  for(const _ of input.targets)secrets.push(password());
  const verifiers=secrets.map(verifier);
  const staged=await run('WRITE',before,verifiers);
  need(xid(staged.xid)&&!input.predecessors.includes(staged.xid)&&staged.status===null&&independent(before,staged)&&
   staged.stable===before.stable&&staged.schemaOwner===before.schemaOwner&&equal(staged.access,c.expectedAccess(before.schemaOwner))&&equal(staged.roles,input.targets.map((role,i)=>
    [role.oid,role.name,xmin(staged.xid),true,role===input.ordinary?ordinaryLimit:1,sha(verifiers[i])])),'POSTIMAGE');
  const committed=await run('COMMITTED',before,undefined,staged);
  need(committed.xid===staged.xid&&committed.status==='committed'&&independent(staged,committed)&&independent(before,committed)&&
   committed.stable===before.stable&&committed.schemaOwner===before.schemaOwner&&equal(committed.roles,staged.roles)&&equal(committed.access,staged.access),'READBACK');
  phase='CONSUME';check();
  proof=Object.freeze({status:'CURRENT259_DOCUMENT_LOGIN_COMMITTED_NOT_ADMISSION',sourceSha:aclResult.sourceSha,
   runId:view.runId,containerId:resource.containerId,aclInstallXid:aclResult.installXid,installXid:committed.xid,
   continuitySha256:committed.stable,roleOids:Object.freeze(input.targets.map(role=>role.oid)),
   ...(input.ordinary?{purpose:lifecycle?lifecyclePurpose:savePurpose,ordinaryName:input.ordinary.name}:{}),
   ...(lifecycle?{effectivePlanSha256:aclResult.effectivePlanSha256,installation:aclResult.installation}:{}),
   roleXmins:Object.freeze(committed.roles.map(role=>role[2])),executionAllowed:false,nativeAdmission:false});
  active.set(proof,{handle,check,lifecycle,identity:input.identity,continuitySql:c.stable});
  const result=await (withRoles?runDocumentRoles(handle,view,proof,input.identity,secrets,use,nest,caseId,lifecycleSignal,continuityToken):use(proof));
  if(active.get(proof)?.continuityActivated){
   active.get(proof).continuityActivated=false;
   try{view.deactivateBusinessContinuity(continuityToken);}catch(cause){continuityCleanupUnknown=true;throw cause;}
  }
  check();return result;
 }catch(cause){
  const error=Object.assign(fault(phase==='BEFORE'?'PRESTATE_REJECTED':phase==='CONSUME'?'CONSUME_FAILED':'COMMIT_UNCONFIRMED'),{phase});
  if(lifecycle){Object.defineProperty(error,'cause',{value:cause});if(own(cause,'ownerCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')Object.defineProperty(error,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true});}
  if(active.get(proof)?.continuityActivated){
   active.get(proof).continuityActivated=false;
   try{view.deactivateBusinessContinuity(continuityToken);}catch{continuityCleanupUnknown=true;}
  }
  if(proof)active.delete(proof);
  const inner=withRoles?own(cause,'cause'):undefined;
  const recognized=fixedReasons.has(cause)?cause:fixedReasons.has(inner)?inner:undefined;
  const reason=fixedReasons.get(recognized);
  if(reason)Object.defineProperty(error,'reason',{value:reason,enumerable:true});
  if(withRoles){
   const roleFailure=own(recognized,'documentRoleFailure');
   if(roleFailure)Object.defineProperty(error,'documentRoleFailure',{value:roleFailure,enumerable:true});
   const exerciseCode=own(recognized,'exerciseCode');
   if(exerciseCode)Object.defineProperty(error,'exerciseCode',{value:exerciseCode,enumerable:true});
   if(own(recognized,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')
    Object.defineProperty(error,'appCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true});
   for(const key of ['environmentRestoration','storageCleanup'])if(own(cause,key)==='UNKNOWN')
    Object.defineProperty(error,key,{value:'UNKNOWN',enumerable:true});
  }
  try{await closeCurrent259OwnedResource(handle);}
  catch{continuityCleanupUnknown=true;}
  if(continuityCleanupUnknown)Object.defineProperty(error,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});
  throw error;
 }finally{
  if(proof)active.delete(proof);
  for(const secret of secrets)secret.fill(0);
 }
}

const slots=Object.freeze(['template','worker','queue']);
const actions=Object.freeze({template:Object.freeze(['publishVersion','sourcePositions']),worker:Object.freeze(['processNext']),
 queue:Object.freeze(['queueDraftPreview'])});
const clientKeys=Object.freeze(['$connect','$queryRawUnsafe','$disconnect']);
const diagnosticEnv=Object.freeze(['DEBUG','NODE_DEBUG']);
const tlsSql=`SELECT current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS oid,a.pid,${stamp} AS start,s.ssl,
 pg_catalog.host(a.client_addr) AS "clientAddress",a.client_port AS "clientPort",
 pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort",
 current_user::pg_catalog.text AS role,session_user::pg_catalog.text AS "sessionRole",a.datid::pg_catalog.text AS "databaseOid",a.datname AS database,$1::pg_catalog.text AS challenge
 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid
 WHERE a.pid=pg_catalog.pg_backend_pid()`;
const sessionKeys=['oid','pid','start','ssl','clientAddress','clientPort','role','databaseOid','database'];
const backend=(pid,start)=>Number.isInteger(pid)&&pid>0&&pid<=2147483647&&typeof start==='string'&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(start)&&Number.isFinite(Date.parse(start));
const port=value=>Number.isInteger(value)&&value>0&&value<=65535;
const project=(row,keys)=>Object.fromEntries(keys.map(key=>[key,own(row,key)]));

async function runDocumentRoles(handle,view,proof,identity,secrets,use,nest,caseId,lifecycleSignal,continuityToken){
 const {resource,loader}=view;
 const lifecycle=proof.purpose===lifecyclePurpose;
 const save=proof.purpose===savePurpose||lifecycle;
 const loginNames=save?[...names,proof.ordinaryName]:names;
 const original=project(resource,['applyCurrent259DocumentHbaV1','getReceipt','inspectConnectionEndpoint',
  'observePresentedCertificate','execOwnerSql']);
 const loadName=lifecycle?'loadCurrent261LocalLifecycleDocumentModules':'loadGeneratedContractDocumentModules';
 const load=own(loader,loadName),Prisma=own(loader,'PrismaService'),beginDrain=own(view,'beginPrismaRelayDrain');
 need(Object.values(original).every(fn=>typeof fn==='function')&&[load,Prisma,beginDrain].every(fn=>typeof fn==='function'),'ROLE_PRODUCER');
 const check=()=>{
  (lifecycle?assertCurrent261GeneratedLifecycleLoginScope:assertCurrent259GeneratedDocumentLoginScope)(proof,handle);
  need(view.loader===loader&&view.resource===resource&&own(loader,'PrismaService')===Prisma&&
   own(loader,loadName)===load&&own(view,'beginPrismaRelayDrain')===beginDrain&&
   Object.entries(original).every(([key,value])=>own(resource,key)===value),'ROLE_PRODUCER');
 };
 check();
 const transition=await original.applyCurrent259DocumentHbaV1.call(resource,proof);
 check();
 need(transition&&transition.rules===(save?13:12)&&(save?transition.purpose===(lifecycle?lifecyclePurpose:savePurpose):transition.purpose===undefined)&&
  (!lifecycle||transition.effectivePlanSha256===proof.effectivePlanSha256&&transition.installation===proof.installation)&&hex(transition.beforeSha256,64)&&hex(transition.afterSha256,64)&&
  transition.beforeSha256!==transition.afterSha256&&transition.loginInstallXid===proof.installXid&&
  transition.plaintextNoEncryptionRejected===true,'ROLE_HBA');
 const endpoint=await original.inspectConnectionEndpoint.call(resource);
 check();
 const endpointOk=()=>endpoint&&!types.isProxy(endpoint)&&endpoint.transport===topology&&endpoint.host==='127.0.0.1'&&
  endpoint.port===resource.port&&port(endpoint.port)&&endpoint.serverAddress==='127.0.0.1'&&endpoint.serverPort===5432&&
  endpoint.containerId===resource.containerId&&endpoint.networkId===resource.networkId&&endpoint.databaseName===identity.database&&
  typeof endpoint.relayId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(endpoint.relayId);
 const verifyReceipt=()=>{
  const receipt=original.getReceipt.call(resource);
  need(endpointOk()&&receipt.runId===proof.runId&&receipt.sourceSha===proof.sourceSha&&receipt.topology===topology&&
   receipt.containerId===resource.containerId&&receipt.networkId===resource.networkId&&receipt.databaseName===identity.database&&
   receipt.requestedCertificateMode==='correct'&&receipt.presentedCertificate?.mode==='correct'&&
   receipt.presentedCertificate.derSha256===resource.serverCertHashes.correctCertificateDerSha256&&
   receipt.configuration?.hbaSha256===transition.beforeSha256&&equal(receipt.documentHba,transition)&&
   equal(receipt.relay,{id:endpoint.relayId,containerId:resource.containerId,host:'127.0.0.1',port:endpoint.port}),'ROLE_HBA');
 };
 const caFile=resource.caPath,certificateSha=resource.serverCertHashes.correctCertificateDerSha256;
 const ca=readQualifiedTask16File(caFile,{privateFile:false,maxBytes:1048576,code:CODE+'_ROLE_CA'});
 const certificate=await original.observePresentedCertificate.call(resource,'correct');
 check();verifyReceipt();
 need(certificate?.mode==='correct'&&certificate.derSha256===certificateSha&&ca.sha256===resource.serverCertHashes.caSha256&&
  ca.identity.uid===process.getuid(),'ROLE_CA');

 return withCurrent259ApplicationEnvironment(handle,async environment=>{
  let roleStage='ENTRY',lastGuardMs=0,maxGuardMs=0,boundedTimeout=false;
  const verify=()=>{
   const started=process.hrtime.bigint();
   try{
   check();environment.check();verifyReceipt();
   need(diagnosticEnv.every(key=>!process.env[key])&&
    ['', 'off','error','warn','info'].includes(process.env.RUST_LOG??'')&&
    ['', '0'].includes(process.env.RUST_BACKTRACE??''),'ROLE_DIAGNOSTICS');
   const read=readQualifiedTask16File(caFile,{privateFile:false,maxBytes:1048576,expectedIdentity:ca.identity,code:CODE+'_ROLE_CA'});
   need(read.sha256===ca.sha256&&read.identity.uid===ca.identity.uid,'ROLE_CA');
   }finally{lastGuardMs=Math.min(3600000,Math.max(0,Number((process.hrtime.bigint()-started)/1000000n)));maxGuardMs=Math.max(maxGuardMs,lastGuardMs);}
  };
  verify();
  const modules=load.call(loader),serviceEntry=nest?'withTask12NestDocumentRoleServices':'withTask12PreownedDocumentRoleServices';
  const services=own(modules,serviceEntry);
  need(typeof services==='function','ROLE_ENTRY');verify();
  const clients=[],live=[];
  let unknown=false,first,failed=false,value;
  const bounded=async(operation,stage)=>{
   let timer;
   try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>{unknown=true;boundedTimeout=true;reject(fault(stage));},15000);
   })]);}finally{clearTimeout(timer);}
  };
  const verifyClient=entry=>{
   verify();need(own(modules,serviceEntry)===services&&
    clientKeys.every(key=>typeof entry.methods[key]==='function'&&entry.client[key]===entry.methods[key]),'ROLE_CLIENT');
  };
  const observe=async(entry,index)=>{
   verifyClient(entry);
   const challenge=randomBytes(32).toString('hex');
   const rows=await bounded(()=>entry.methods.$queryRawUnsafe.call(entry.client,tlsSql,challenge),'ROLE_QUERY_TIMEOUT');
   verifyClient(entry);
   const row=Array.isArray(rows)&&rows.length===1&&rows[0];
   need(own(row,'challenge')===challenge&&own(row,'sessionRole')===loginNames[index]&&own(row,'serverAddress')==='127.0.0.1'&&
    own(row,'serverPort')===5432,'ROLE_IDENTITY');
   const session=project(row,sessionKeys);
   need(session.oid===proof.roleOids[index]&&session.role===loginNames[index]&&session.database===identity.database&&
    session.databaseOid===identity.databaseOid&&session.clientAddress==='127.0.0.1'&&port(session.clientPort)&&
    backend(session.pid,session.start)&&session.ssl===true,'ROLE_IDENTITY');
   return session;
  };
  const ownerCheck=async ordinaryAfter=>{
   const ordinaryOid=proof.roleOids[names.length];
   const ids=proof.roleOids.map(oid=>quote(oid)+'::oid').join(',');
   const appIsolation=ordinaryAfter?`
 AND current_setting('listen_addresses')='127.0.0.1'
 AND NOT EXISTS(SELECT FROM pg_stat_activity other WHERE other.backend_type='client backend'
  AND other.datname=current_database() AND other.pid<>pg_backend_pid() AND other.usesysid NOT IN (${ids}))`:'';
   const challenge=randomBytes(32).toString('hex');
   const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO pg_catalog, pg_temp;
SELECT jsonb_build_object('challenge','${challenge}','pid',pg_backend_pid(),'start',
 (SELECT ${stamp} FROM pg_stat_activity WHERE pid=pg_backend_pid()),
 'scope',current_database()=${quote(identity.database)} AND current_user::regrole::oid=10 AND session_user=current_user
 AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
 AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
 AND (SELECT system_identifier::text FROM pg_control_system())=${quote(identity.systemIdentifier)}
 AND pg_xact_status(${quote(proof.installXid)}::xid8)='committed'${appIsolation},
 'sessions',(SELECT jsonb_agg(jsonb_build_object('oid',a.usesysid::text,'pid',a.pid,'start',${stamp},'ssl',s.ssl,
  'clientAddress',host(a.client_addr),'clientPort',a.client_port,'role',a.usename,'databaseOid',a.datid::text,'database',a.datname) ORDER BY a.usesysid)
  FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid=a.pid JOIN pg_authid r ON r.oid=a.usesysid
  WHERE a.backend_type='client backend' AND a.usesysid IN (${ids})
   AND r.xmin::text=${quote(proof.roleXmins[0])} AND r.rolconnlimit=${save?
    `CASE WHEN r.oid=${quote(proof.roleOids[names.length])}::oid THEN ${ordinaryLimit} ELSE 1 END`:'1'} AND r.rolcanlogin));
ROLLBACK;`;
   verify();const output=await original.execOwnerSql.call(resource,sql,'current259-document-pools-live');verify();
   const text=own(output,'stdout');let row;
   try{if(typeof text==='string'&&Buffer.byteLength(text)<=8192)row=JSON.parse(text);}catch{throw fault('ROLE_OWNER_READ');}
   need(row?.challenge===challenge&&row.scope===true&&backend(row.pid,row.start)&&Array.isArray(row.sessions),'ROLE_OWNER_READ');
   if(!ordinaryAfter){
    need(live.every(session=>independent(row,session))&&equal(row.sessions,[...live].sort((a,b)=>Number(a.oid)-Number(b.oid))),'ROLE_OWNER_READ');
    return;
   }
   const ordinaryRows=row.sessions.filter(session=>session?.oid===ordinaryOid);
   const documentRows=row.sessions.filter(session=>session?.oid!==ordinaryOid);
   const originals=live.slice(0,names.length).sort((a,b)=>Number(a.oid)-Number(b.oid));
   const firstOrdinary=live[names.length];
   need(equal(documentRows,originals)&&ordinaryRows.length>=1&&ordinaryRows.length<=ordinaryLimit&&
    ordinaryRows.some(session=>equal(session,firstOrdinary))&&ordinaryRows.some(session=>equal(session,ordinaryAfter))&&
    ordinaryRows.every(session=>equal(Object.keys(session).sort(),[...sessionKeys].sort())&&session.role===proof.ordinaryName&&
     session.database===identity.database&&session.databaseOid===identity.databaseOid&&session.ssl===true&&
     session.clientAddress==='127.0.0.1'&&port(session.clientPort)&&backend(session.pid,session.start))&&
    row.sessions.every((session,index)=>independent(row,session)&&row.sessions.slice(0,index).every(prior=>
     independent(prior,session)&&prior.clientPort!==session.clientPort)),'ROLE_OWNER_READ');
  };
  const waitDrain=beginDrain.call(view);
  need(typeof waitDrain==='function','ROLE_DRAIN');
  try{
   if(continuityToken!==undefined){view.activateBusinessContinuity(continuityToken);active.get(proof).continuityActivated=true;}
   let publicLifecycle;
   if(lifecycle){
    const build=own(modules,'buildTask12LocalLifecycleFixture'),isFixture=own(modules,'isTask12LocalLifecycleFixture'),hash=own(modules,'hashTask12GeneratedAdmissionPassword');
    need([build,isFixture,hash].every(fn=>typeof fn==='function'),'ROLE_ENTRY');
    const fixture=build(caseId);need(isFixture(fixture)&&fixture.approval.users.length===8,'ROLE_SEED');
    const passwords=Object.freeze(Object.fromEntries(fixture.approval.users.map(user=>[user.id,randomBytes(32).toString('hex')])));
    need(new Set(Object.values(passwords)).size===8,'ROLE_SEED');
    const hashes=Object.fromEntries(await Promise.all(fixture.approval.users.map(async user=>[user.id,await hash(passwords[user.id])])));
    verify();
    const seed=createCurrent261LocalLifecycleSeed(fixture,identity,hashes);
    const runSeed=async(sql,label)=>{roleStage='SEED_'+label.toUpperCase();verify();const result=await original.execOwnerSql.call(resource,sql,'current261-local-lifecycle-seed-'+label);verify();return result?.stdout;};
    seed.verifyBefore(await runSeed(seed.beforeSql(),'before'));
    seed.verifyWritten(await runSeed(seed.writeSql(),'write'));
    const observed=seed.finish(await runSeed(seed.committedSql(),'committed'));
    need(observed.seedRows===26&&observed.seedXid!==proof.installXid&&observed.seedXid!==proof.aclInstallXid,'ROLE_SEED');
    roleStage='ORIGINALS';
    const sourceDocx=modules.readTask12LocalLifecycleSourceDocx(),originals=await modules.createTask12LocalLifecycleOriginals(fixture);verify();
    publicLifecycle=Object.freeze({fixture,passwords,sourceDocx,originals,signal:lifecycleSignal});
   }
   for(const [index,name] of loginNames.entries()){
    roleStage='ROLE_CONNECT';verify();
    const url=new URL(`postgresql://${name}:${secrets[index].toString('ascii')}@127.0.0.1:${endpoint.port}/${identity.database}`);
    const ordinary=save&&index===names.length;
    for(const [key,val] of Object.entries({schema:'public',connection_limit:ordinary?String(ordinaryLimit):'1',sslmode:'require',sslaccept:'strict',
     sslcert:caFile,application_name:'jg_394_document_'+(ordinary?'ordinary':slots[index]),connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,val);
    let client;
    try{client=new Prisma({datasources:{db:{url:url.toString()}},log:[]});}
    catch{unknown=true;throw fault('ROLE_CONSTRUCT');}
    finally{url.password='';secrets[index].fill(0);}
    need(clients.every(entry=>entry.client!==client),'ROLE_CLIENT');
    const entry={client,methods:{}};
    clients.push(entry);
    try{
     for(const key of [...clientKeys].reverse())entry.methods[key]=client[key];
    }catch{if(typeof entry.methods.$disconnect!=='function')unknown=true;throw fault('ROLE_CLIENT');}
    verifyClient(entry);
    try{await bounded(()=>entry.methods.$connect.call(client),'ROLE_CONNECT_TIMEOUT');}
    catch(error){throw fixedReasons.has(error)?error:fault('ROLE_CONNECT');}
    roleStage='ROLE_OBSERVE';const session=await observe(entry,index);
    need(live.every(prior=>independent(prior,session)),'ROLE_IDENTITY');live.push(session);
   }
   roleStage='OWNER_BEFORE';await ownerCheck();
   const expected=Object.freeze({database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,
    storageRoot:environment.storageRoot,roleOids:Object.freeze(Object.fromEntries(slots.map((slot,i)=>[slot,proof.roleOids[i]])))});
   const connections=Object.freeze(Object.fromEntries(slots.map((slot,i)=>[slot,clients[i].client])));
   let publicDraft;
   if(caseId&&!lifecycle){
    const build=own(modules,'buildTask12GeneratedApprovalFixture'),hash=own(modules,'hashTask12GeneratedAdmissionPassword');
    const openDraft=own(modules,'openTask12GeneratedApprovalDraft');
    need([build,hash,openDraft].every(fn=>typeof fn==='function'),'ROLE_ENTRY');
    try{
     const fixture=build(caseId),passwords=Object.freeze({handler:randomBytes(32).toString('hex'),director:randomBytes(32).toString('hex')});
     need(passwords.handler!==passwords.director,'ROLE_SEED');
     const [handlerHash,directorHash]=await Promise.all([hash(passwords.handler),hash(passwords.director)]);
     verify();
     const seed=createCurrent259GeneratedDocumentSeed(fixture,identity,handlerHash,directorHash);
     const runSeed=async(sql,label)=>{
      verify();
      const result=await original.execOwnerSql.call(resource,sql,'current259-document-seed-'+label);
      verify();return result?.stdout;
     };
     seed.verifyBefore(await runSeed(seed.beforeSql(),'before'));
     seed.verifyWritten(await runSeed(seed.writeSql(),'write'));
     const observed=seed.finish(await runSeed(seed.committedSql(),'committed'));
     need(observed.seedXid!==proof.installXid&&observed.seedXid!==proof.aclInstallXid,'ROLE_SEED');
          const entries=Object.freeze(Object.fromEntries(['publishTask12GeneratedMaterialTemplate','saveTask12GeneratedDocumentDraft',
      'runTask12GeneratedDocument','readTask12GeneratedDocumentOutputs'].map(key=>[key,own(modules,key)])));
     publicDraft=Object.freeze({fixture,passwords,openDraft,entries});
    }catch{throw fault('ROLE_SEED');}
   }
   let used=false;
   roleStage='APPLICATION';
   value=await services(connections,expected,async (operations,providers)=>{
    verify();need(!used,'ROLE_ENTRY');used=true;
    let available=true;
    const exposed=Object.freeze(Object.fromEntries(slots.map(slot=>{
     const originalGroup=own(operations,slot);
     const group=Object.fromEntries(actions[slot].map(key=>{
      const invoke=own(originalGroup,key);
      need(typeof invoke==='function','ROLE_ENTRY');
      return [key,(...args)=>{
       need(available,'ROLE_ENTRY');verify();
       need(own(operations,slot)===originalGroup&&own(originalGroup,key)===invoke,'ROLE_ENTRY');
       return invoke.apply(originalGroup,args);
      }];
     }));
     return [slot,Object.freeze(group)];
    })));
    try{
     const exercise=async http=>{
      if(publicLifecycle){
       need(http,'ROLE_ENTRY');verify();
       const key=Object.freeze({});lifecycleExercises.set(key,Object.freeze({handle,proof,modules,config:publicLifecycle,check(){need(available,'ROLE_ENTRY');verify();}}));
       try{const result=await require('./task12-current261-local-lifecycle-exercise.cjs').exerciseCurrent261LocalLifecycle(key,http);verify();return await use(result);}
       finally{lifecycleExercises.delete(key);}
      }
      if(!publicDraft){const result=await use(exposed);verify();return result;}
      need(http,'ROLE_ENTRY');
      const {beginCurrent259GeneratedDocumentOwnerReadback,readCurrent259GeneratedDocumentOwnerReadback}=
       require('./task12-current259-document-owner-readback.cjs');
      let readback,readbackStarted=false,ownerPending,ownerFailed=false,downloadResult;
      const ownerOperation=operation=>{
       need(available&&!ownerPending&&!ownerFailed,'ROLE_ENTRY');verify();
       const pending=Promise.resolve().then(operation);
       ownerPending=pending;
       pending.then(()=>{ownerPending=undefined;},()=>{ownerPending=undefined;ownerFailed=true;});
       return pending;
      };
      const beginOwnerReadback=function(){
       need(arguments.length===0&&!readbackStarted,'ROLE_ENTRY');readbackStarted=true;
       return ownerOperation(async()=>{
        readback=await beginCurrent259GeneratedDocumentOwnerReadback(handle,proof);
        verify();return readback;
       });
      };
      const readOwnerResult=function(ownerScope,publicResult){
       need(arguments.length===2&&readback&&ownerScope===readback&&downloadResult&&publicResult===downloadResult,'ROLE_ENTRY');
       return ownerOperation(async()=>{
        readback=downloadResult=undefined;
        const result=await readCurrent259GeneratedDocumentOwnerReadback(ownerScope,publicResult);
        verify();return result;
       });
      };
      const output=own(http,'readDocumentOutputs');
      need(typeof output==='function','ROLE_ENTRY');
      const scopedHttp=Object.freeze({...http,async readDocumentOutputs(coordinates,ownerScope,fields,readPdfDrawnText){
       need(arguments.length===4&&available&&readback&&ownerScope===readback&&!ownerPending&&!downloadResult,'ROLE_ENTRY');
       downloadResult=await output(coordinates,ownerScope,fields,readPdfDrawnText);
       verify();return downloadResult;
      }});
      try{
       const result=await use(Object.freeze({http:scopedHttp,beginOwnerReadback,readOwnerResult}));
       need(!ownerPending&&!ownerFailed,'ROLE_ENTRY');verify();return result;
      }finally{
       if(ownerPending)await Promise.allSettled([ownerPending]);
      }
     };
     if(!nest)return await exercise();
     const bridge=Object.freeze({check:verify,loader,loaded:modules,proof,ordinary:clients[names.length].client,providers,
      queue:exposed.queue.queueDraftPreview,exercise,...(publicDraft?{publicDraft}:{}),...(publicLifecycle?{publicLifecycle}:{})});
     const {runCurrent259GeneratedDocumentApplication,fixedExerciseCode}=require('./task12-current259-document-application.cjs');
     nestBridges.add(bridge);
     try{return await runCurrent259GeneratedDocumentApplication(bridge);}
     catch(error){
      const code=own(error,'code');
      const stage=typeof code==='string'&&/^CURRENT259_GENERATED_DOCUMENT_APP_(HANDLE|DESCRIPTOR|PROVIDERS|MODULE|COMPILE|CREATE|INIT|LISTEN|HTTP|USE|CLOSE|TIMEOUT)$/u.exec(code)?.[1];
      const safe=fault(stage?'ROLE_APP_'+stage:'ROLE_APP');
      if(lifecycle){Object.defineProperty(safe,'cause',{value:error});if(own(error,'ownerCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')Object.defineProperty(safe,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true});}
      const exerciseCode=publicDraft&&stage==='HTTP'&&fixedExerciseCode(own(error,'exerciseCode'));
      if(exerciseCode)Object.defineProperty(safe,'exerciseCode',{value:exerciseCode});
      if(own(error,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')Object.defineProperty(safe,'appCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE'});
      throw safe;
     }finally{nestBridges.delete(bridge);}
    }finally{available=false;}
   });
   need(used,'ROLE_ENTRY');
   let ordinaryAfter;
   roleStage='ROLE_POSTCHECK';
   for(const [index,entry] of clients.entries()){
    const current=await observe(entry,index);
    if(nest&&index===names.length)ordinaryAfter=current;
    else need(equal(current,live[index]),'ROLE_IDENTITY');
   }
   roleStage='OWNER_AFTER';await ownerCheck(ordinaryAfter);
  }catch(error){failed=true;first=error;unknown=unknown||own(error,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE';}
  const closed=await Promise.allSettled(clients.map(entry=>bounded(()=>entry.methods.$disconnect.call(entry.client),'ROLE_CLOSE_TIMEOUT')));
  const disconnectRejected=closed.some(result=>result.status==='rejected');
  if(disconnectRejected)unknown=true;
  let drainRejected=false;try{await waitDrain();}catch{unknown=true;drainRejected=true;}
  if(unknown){
   const cleanup=Object.assign(fault(fixedReasons.get(first)??'ROLE_CLEANUP_UNKNOWN'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
   Object.defineProperty(cleanup,'documentRoleFailure',{value:Object.freeze({subphase:roleStage,lastGuardMs,maxGuardMs,boundedTimeout,disconnectRejected,drainRejected})});
   if(lifecycle&&first!==undefined)Object.defineProperty(cleanup,'cause',{value:first});
   const exerciseCode=fixedReasons.has(first)&&own(first,'exerciseCode');
   if(exerciseCode)Object.defineProperty(cleanup,'exerciseCode',{value:exerciseCode});
   throw cleanup;
  }
  if(failed)throw first;
  verify();return value;
 });
}

function assertCurrent259GeneratedDocumentLoginScope(proof,handle){
 const scope=active.get(proof);
 need(arguments.length===2&&scope?.handle===handle&&scope&&!scope.lifecycle,'HANDLE');
 scope.check();
}

function assertCurrent261GeneratedLifecycleLoginScope(proof,handle){
 const scope=active.get(proof);need(arguments.length===2&&scope?.handle===handle&&scope.lifecycle===true,'HANDLE');scope.check();
}
function claimCurrent261LocalLifecycleOwnerProof(proof,handle){
 assertCurrent261GeneratedLifecycleLoginScope(proof,handle);
 const scope=active.get(proof);
 return Object.freeze({identity:Object.freeze({...scope.identity}),continuitySql:scope.continuitySql,continuitySha256:proof.continuitySha256,
  effectivePlanSha256:proof.effectivePlanSha256,installation:proof.installation,check:scope.check});
}
module.exports=Object.freeze({takeCurrent261LocalLifecycleExerciseBridge,claimCurrent261LocalLifecycleOwnerProof,withCurrent261LocalLifecyclePublicApplication,assertCurrent261GeneratedLifecycleLoginScope,withCurrent259GeneratedDocumentLogin,withCurrent259GeneratedDocumentRoleServices,withCurrent259GeneratedDocumentSaveRoleServices,withCurrent259GeneratedDocumentSaveApplication,
 withCurrent259GeneratedDocumentPublicApplication,takeCurrent259GeneratedDocumentApplicationBridge,assertCurrent259GeneratedDocumentLoginScope});
