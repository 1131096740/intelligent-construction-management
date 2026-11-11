'use strict';
const {createHash,createHmac,pbkdf2Sync,randomBytes}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {isDeepStrictEqual:equal,types}=require('node:util');
const {claimCurrent259GeneratedDocumentAcl}=require('./task12-current259-document-acl-transport.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {current259AclRowsSql}=require('./task16-current259-catalog.cjs');
const {withCurrent259ApplicationEnvironment}=require('./task16-current259-application-environment.cjs');
const {readQualifiedTask16File}=require('./task16-runtime-inputs.cjs');

const CODE='CURRENT259_DOCUMENT_LOGIN';
const topology='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const names=Object.freeze(['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue']);
const consumed=new WeakSet(),active=new WeakMap();
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
function qualify(lease,view){
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
 return {roles,identity,predecessors,continuitySql,continuitySha256};
}

function documentAcl(ids){
 const bytes=readFileSync(join(__dirname,'task12-current259-document-acl.json'));
 need(sha(bytes)===manifestSha,'SOURCE');
 const {roles}=JSON.parse(bytes),expected=[];
 for(const [role,tables] of Object.entries(roles))
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
  AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`;
}
function catalog(input){
 const {identity,roles,continuitySql,predecessors}=input;
 const ids=roles.map(role=>quote(role.oid)+'::oid').join(',');
 const aclRows=(kind,acl,owner)=>`aclexplode(COALESCE(${acl},acldefault('${kind}',${owner})))`;
 const databaseAcl=aclRows('d','d.datacl','d.datdba'),schemaAcl=aclRows('n','n.nspacl','n.nspowner');
 const others=acl=>`(SELECT COALESCE(jsonb_agg(jsonb_build_array(g.grantor,g.grantee,g.privilege_type,g.is_grantable)
  ORDER BY g.grantor,g.grantee,g.privilege_type COLLATE "C",g.is_grantable),'[]'::jsonb) FROM ${acl} g WHERE g.grantee NOT IN (${ids}))`;
 let stable=replaceExact(continuitySql,'n.nspacl::text',others(schemaAcl));
 stable=replaceExact(stable,'(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d)',
  `(SELECT jsonb_agg(CASE WHEN d.oid=${quote(identity.databaseOid)}::oid THEN
   jsonb_build_array(to_jsonb(d)-'datacl',${others(databaseAcl)}) ELSE to_jsonb(d) END ORDER BY d.oid) FROM pg_database d)`);
 stable=replaceExact(stable,'r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r)',
  `r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r WHERE r.oid NOT IN (${ids}))`);
 const access=`(SELECT COALESCE(jsonb_agg(jsonb_build_array(kind,target::text,grantor::text,grantee::text,privilege,is_grantable)
  ORDER BY kind COLLATE "C",target,grantee,grantor,privilege COLLATE "C",is_grantable),'[]'::jsonb) FROM (
  SELECT 'database'::text AS kind,d.oid AS target,g.grantor,g.grantee,g.privilege_type AS privilege,g.is_grantable
   FROM pg_database d CROSS JOIN LATERAL ${databaseAcl} g WHERE g.grantee IN (${ids})
  UNION ALL
  SELECT 'schema',n.oid,g.grantor,g.grantee,g.privilege_type,g.is_grantable
   FROM pg_namespace n CROSS JOIN LATERAL ${schemaAcl} g WHERE g.grantee IN (${ids})
 ) granted)`;
 const roleOrder=names.map(quote).join(',');
 const roleState=`(SELECT jsonb_agg(jsonb_build_array(r.oid::text,r.rolname,r.xmin::text,r.rolcanlogin,r.rolconnlimit,
  CASE WHEN r.rolpassword IS NULL THEN NULL ELSE ${digest('r.rolpassword')} END)
  ORDER BY array_position(ARRAY[${roleOrder}],r.rolname::text))
  FROM pg_authid r WHERE r.oid IN (${ids}) AND r.rolvaliduntil IS NULL AND NOT
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
  AND (${hba}) AND (${documentAcl(ids)})`;
 const expectedAccess=owner=>['database','schema'].flatMap(kind=>[...roles].sort((a,b)=>Number(a.oid)-Number(b.oid)).map(role=>
  [kind,kind==='database'?identity.databaseOid:identity.namespaceOid,kind==='database'?'10':owner,role.oid,kind==='database'?'CONNECT':'USAGE',false]));
 return {stable,access,roleState,common,expectedAccess};
}

function render(input,c,phase,nonce,before,verifiers,staged){
 const writing=phase==='WRITE',committed=phase==='COMMITTED';
 const writeXid=writing?'pg_current_xact_id()::text':committed?quote(staged.xid):'NULL::text';
 const status=committed?`pg_xact_status(${quote(staged.xid)}::xid8)`:'NULL::text';
 const beforeRoles=input.roles.map(role=>[role.oid,role.name,role.xmin,false,0,null]);
 const stagedRoles=writing&&`jsonb_build_array(${input.roles.map((role,i)=>
  `jsonb_build_array(${quote(role.oid)},${quote(role.name)},(pg_current_xact_id()::text::numeric%4294967296)::text,true,1,${quote(sha(verifiers[i]))})`).join(',')})`;
 const fixedBefore=`(${input.continuitySql}) IS NOT DISTINCT FROM ${quote(input.continuitySha256)}`;
 const guard=(tag,post)=>`DO $doc_login_${tag}$ BEGIN
 IF (${c.common}) IS DISTINCT FROM true
 OR (${c.roleState}) IS DISTINCT FROM ${post?(writing?stagedRoles:json(staged.roles)):json(beforeRoles)}
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
   ...names.map((name,i)=>`ALTER ROLE "${name}" LOGIN CONNECTION LIMIT 1 PASSWORD ${quote(verifiers[i])};`),
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
async function runLogin(aclResult,handle,use,withRoles){
 need(handle&&typeof handle==='object'&&!types.isProxy(handle)&&
  typeof use==='function'&&!types.isProxy(use)&&!consumed.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=own(resource,'execOwnerSql');
 need(resource.topology===topology&&typeof exec==='function','HANDLE');
 const lease=claimCurrent259GeneratedDocumentAcl(aclResult,handle),input=qualify(lease,view);
 need(aclResult===lease.completion,'HANDLE');
 consumed.add(handle);
 const check=()=>{
  lease.check();view.check();
  need(claimCurrent259TechnicalResource(handle)===view&&view.resource===resource&&
   resource.topology===topology&&own(resource,'execOwnerSql')===exec,'CONTINUITY');
 };
 const secrets=[];
 let phase='BEFORE',proof;
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
  need(before.xid===null&&before.status===null&&equal(before.access,[])&&
   equal(before.roles,input.roles.map(role=>[role.oid,role.name,role.xmin,false,0,null])),'PREIMAGE');
  for(const _ of names)secrets.push(password());
  const verifiers=secrets.map(verifier);
  const staged=await run('WRITE',before,verifiers);
  need(xid(staged.xid)&&!input.predecessors.includes(staged.xid)&&staged.status===null&&independent(before,staged)&&
   staged.stable===before.stable&&staged.schemaOwner===before.schemaOwner&&equal(staged.access,c.expectedAccess(before.schemaOwner))&&equal(staged.roles,input.roles.map((role,i)=>
    [role.oid,role.name,xmin(staged.xid),true,1,sha(verifiers[i])])),'POSTIMAGE');
  const committed=await run('COMMITTED',before,undefined,staged);
  need(committed.xid===staged.xid&&committed.status==='committed'&&independent(staged,committed)&&independent(before,committed)&&
   committed.stable===before.stable&&committed.schemaOwner===before.schemaOwner&&equal(committed.roles,staged.roles)&&equal(committed.access,staged.access),'READBACK');
  phase='CONSUME';check();
  proof=Object.freeze({status:'CURRENT259_DOCUMENT_LOGIN_COMMITTED_NOT_ADMISSION',sourceSha:aclResult.sourceSha,
   runId:view.runId,containerId:resource.containerId,aclInstallXid:aclResult.installXid,installXid:committed.xid,
   continuitySha256:committed.stable,roleOids:Object.freeze(input.roles.map(role=>role.oid)),
   roleXmins:Object.freeze(committed.roles.map(role=>role[2])),executionAllowed:false,nativeAdmission:false});
  active.set(proof,{handle,check});
  const result=await (withRoles?runDocumentRoles(handle,view,proof,input.identity,secrets,use):use(proof));
  check();return result;
 }catch(cause){
  const error=Object.assign(fault(phase==='BEFORE'?'PRESTATE_REJECTED':phase==='CONSUME'?'CONSUME_FAILED':'COMMIT_UNCONFIRMED'),{phase});
  if(proof)active.delete(proof);
  const inner=withRoles?own(cause,'cause'):undefined;
  const recognized=fixedReasons.has(cause)?cause:fixedReasons.has(inner)?inner:undefined;
  const reason=fixedReasons.get(recognized);
  if(reason)Object.defineProperty(error,'reason',{value:reason,enumerable:true});
  if(withRoles){
   if(own(recognized,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')
    Object.defineProperty(error,'appCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true});
   for(const key of ['environmentRestoration','storageCleanup'])if(own(cause,key)==='UNKNOWN')
    Object.defineProperty(error,key,{value:'UNKNOWN',enumerable:true});
  }
  try{await closeCurrent259OwnedResource(handle);}
  catch{Object.defineProperty(error,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});}
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

async function runDocumentRoles(handle,view,proof,identity,secrets,use){
 const {resource,loader}=view;
 const original=project(resource,['applyCurrent259DocumentHbaV1','getReceipt','inspectConnectionEndpoint',
  'observePresentedCertificate','execOwnerSql']);
 const load=own(loader,'loadGeneratedContractDocumentModules'),Prisma=own(loader,'PrismaService'),beginDrain=own(view,'beginPrismaRelayDrain');
 need(Object.values(original).every(fn=>typeof fn==='function')&&[load,Prisma,beginDrain].every(fn=>typeof fn==='function'),'ROLE_PRODUCER');
 const check=()=>{
  assertCurrent259GeneratedDocumentLoginScope(proof,handle);
  need(view.loader===loader&&view.resource===resource&&own(loader,'PrismaService')===Prisma&&
   own(loader,'loadGeneratedContractDocumentModules')===load&&own(view,'beginPrismaRelayDrain')===beginDrain&&
   Object.entries(original).every(([key,value])=>own(resource,key)===value),'ROLE_PRODUCER');
 };
 check();
 const transition=await original.applyCurrent259DocumentHbaV1.call(resource,proof);
 check();
 need(transition&&transition.rules===12&&hex(transition.beforeSha256,64)&&hex(transition.afterSha256,64)&&
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
  const verify=()=>{
   check();environment.check();verifyReceipt();
   need(diagnosticEnv.every(key=>!process.env[key])&&
    ['', 'off','error','warn','info'].includes(process.env.RUST_LOG??'')&&
    ['', '0'].includes(process.env.RUST_BACKTRACE??''),'ROLE_DIAGNOSTICS');
   const read=readQualifiedTask16File(caFile,{privateFile:false,maxBytes:1048576,expectedIdentity:ca.identity,code:CODE+'_ROLE_CA'});
   need(read.sha256===ca.sha256&&read.identity.uid===ca.identity.uid,'ROLE_CA');
  };
  verify();
  const modules=load.call(loader),services=own(modules,'withTask12PreownedDocumentRoleServices');
  need(typeof services==='function','ROLE_ENTRY');verify();
  const clients=[],live=[];
  let unknown=false,first,failed=false,value;
  const bounded=async(operation,stage)=>{
   let timer;
   try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>{unknown=true;reject(fault(stage));},15000);
   })]);}finally{clearTimeout(timer);}
  };
  const verifyClient=entry=>{
   verify();need(own(modules,'withTask12PreownedDocumentRoleServices')===services&&
    clientKeys.every(key=>typeof entry.methods[key]==='function'&&entry.client[key]===entry.methods[key]),'ROLE_CLIENT');
  };
  const observe=async(entry,index)=>{
   verifyClient(entry);
   const challenge=randomBytes(32).toString('hex');
   const rows=await bounded(()=>entry.methods.$queryRawUnsafe.call(entry.client,tlsSql,challenge),'ROLE_QUERY_TIMEOUT');
   verifyClient(entry);
   const row=Array.isArray(rows)&&rows.length===1&&rows[0];
   need(own(row,'challenge')===challenge&&own(row,'sessionRole')===names[index]&&own(row,'serverAddress')==='127.0.0.1'&&
    own(row,'serverPort')===5432,'ROLE_IDENTITY');
   const session=project(row,sessionKeys);
   need(session.oid===proof.roleOids[index]&&session.role===names[index]&&session.database===identity.database&&
    session.databaseOid===identity.databaseOid&&session.clientAddress==='127.0.0.1'&&port(session.clientPort)&&
    backend(session.pid,session.start)&&session.ssl===true,'ROLE_IDENTITY');
   return session;
  };
  const ownerCheck=async()=>{
   const challenge=randomBytes(32).toString('hex');
   const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO pg_catalog, pg_temp;
SELECT jsonb_build_object('challenge','${challenge}','pid',pg_backend_pid(),'start',
 (SELECT ${stamp} FROM pg_stat_activity WHERE pid=pg_backend_pid()),
 'scope',current_database()=${quote(identity.database)} AND current_user::regrole::oid=10 AND session_user=current_user
 AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
 AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
 AND (SELECT system_identifier::text FROM pg_control_system())=${quote(identity.systemIdentifier)}
 AND pg_xact_status(${quote(proof.installXid)}::xid8)='committed',
 'sessions',(SELECT jsonb_agg(jsonb_build_object('oid',a.usesysid::text,'pid',a.pid,'start',${stamp},'ssl',s.ssl,
  'clientAddress',host(a.client_addr),'clientPort',a.client_port,'role',a.usename,'databaseOid',a.datid::text,'database',a.datname) ORDER BY a.usesysid)
  FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid=a.pid JOIN pg_authid r ON r.oid=a.usesysid
  WHERE a.backend_type='client backend' AND a.usesysid IN (${proof.roleOids.map(oid=>quote(oid)+'::oid').join(',')})
   AND r.xmin::text=${quote(proof.roleXmins[0])} AND r.rolconnlimit=1 AND r.rolcanlogin));
ROLLBACK;`;
   verify();const output=await original.execOwnerSql.call(resource,sql,'current259-document-pools-live');verify();
   const text=own(output,'stdout');let row;
   try{if(typeof text==='string'&&Buffer.byteLength(text)<=8192)row=JSON.parse(text);}catch{throw fault('ROLE_OWNER_READ');}
   need(row?.challenge===challenge&&row.scope===true&&backend(row.pid,row.start)&&
    live.every(session=>independent(row,session))&&equal(row.sessions,[...live].sort((a,b)=>Number(a.oid)-Number(b.oid))),'ROLE_OWNER_READ');
  };
  const waitDrain=beginDrain.call(view);
  need(typeof waitDrain==='function','ROLE_DRAIN');
  try{
   for(const [index,name] of names.entries()){
    verify();
    const url=new URL(`postgresql://${name}:${secrets[index].toString('ascii')}@127.0.0.1:${endpoint.port}/${identity.database}`);
    for(const [key,val] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',
     sslcert:caFile,application_name:'jg_394_document_'+slots[index],connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,val);
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
    const session=await observe(entry,index);
    need(live.every(prior=>independent(prior,session)),'ROLE_IDENTITY');live.push(session);
   }
   await ownerCheck();
   const expected=Object.freeze({database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,
    storageRoot:environment.storageRoot,roleOids:Object.freeze(Object.fromEntries(slots.map((slot,i)=>[slot,proof.roleOids[i]])))});
   const connections=Object.freeze(Object.fromEntries(slots.map((slot,i)=>[slot,clients[i].client])));
   let used=false;
   value=await services(connections,expected,async operations=>{
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
    try{const result=await use(exposed);verify();return result;}
    finally{available=false;}
   });
   need(used,'ROLE_ENTRY');
   for(const [index,entry] of clients.entries())need(equal(await observe(entry,index),live[index]),'ROLE_IDENTITY');
   await ownerCheck();
  }catch(error){failed=true;first=error;unknown=unknown||own(error,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE';}
  const closed=await Promise.allSettled(clients.map(entry=>bounded(()=>entry.methods.$disconnect.call(entry.client),'ROLE_CLOSE_TIMEOUT')));
  if(closed.some(result=>result.status==='rejected'))unknown=true;
  try{await waitDrain();}catch{unknown=true;}
  if(unknown)throw Object.assign(fault(fixedReasons.get(first)??'ROLE_CLEANUP_UNKNOWN'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
  if(failed)throw first;
  verify();return value;
 });
}

function assertCurrent259GeneratedDocumentLoginScope(proof,handle){
 const scope=active.get(proof);
 need(arguments.length===2&&scope?.handle===handle&&scope,'HANDLE');
 scope.check();
}

module.exports=Object.freeze({withCurrent259GeneratedDocumentLogin,withCurrent259GeneratedDocumentRoleServices,assertCurrent259GeneratedDocumentLoginScope});
