'use strict';
const {claimCurrent259GeneratedDocumentRoles}=require('./task12-current259-document-role-provision.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {beginCurrent259GeneratedDocumentAcl}=require('./task12-current259-document-acl.cjs');
const {current259AclRowsSql}=require('./task16-current259-catalog.cjs');
const {isDeepStrictEqual:equal,types}=require('node:util');

const {isExactCurrentArchiveProfile}=require('./task16-current259-profile.cjs');
const CODE='CURRENT259_DOCUMENT_ACL_TRANSPORT';
const topology='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const names=Object.freeze(['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue']);
const bindings=Object.freeze(['jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1',
 'jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_closure_v2','jg_contract_direct_upward_execution_binding_v2']);
const priorBindings=Object.freeze(['jg_contract_direct_pending_binding_v1','jg_contract_direct_review_retention_binding_v1',
 'jg_contract_direct_archive_binding_v1','jg_contract_direct_archive_retention_binding_v1','jg_contract_direct_archive_dispatch_binding_v1',
 'jg_contract_upward_pending_create_binding_v1','jg_contract_direct_archive_completion_binding_v1','jg_contract_upward_pending_save_binding_v1']);
const phases=Object.freeze({BEFORE:'current259-document-acl-before',WRITE:'current259-document-acl-write',COMMITTED:'current259-document-acl-committed'});
const used=new WeakSet(),installed=new WeakMap();
const own=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const fault=stage=>Object.assign(new Error(CODE+'_'+stage),{code:CODE+'_'+stage});
const need=(ok,stage)=>{if(!ok)throw fault(stage);};
const number=(value,max)=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=max;
const xid=value=>number(value,0xffffffffffffffffn);
const oid=value=>number(value,0xffffffffn);
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[0-9a-f]+$/u.test(value);
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const digest=value=>`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${value})::text,'UTF8')),'hex')`;
const search='SET LOCAL search_path TO pg_catalog, public, pg_temp;\nSET LOCAL quote_all_identifiers TO off;';
const reset='SET LOCAL search_path TO pg_catalog, pg_temp;';
const aclSelect="SELECT jsonb_build_object('challenge'";

function qualify(rolesLease,view){
 const {completion,ordinaryAcl,ordinaryAclCompletion,roles,source}=rolesLease;
 const {resource}=view;
 need(completion.status==='CURRENT259_DOCUMENT_ROLES_COMMITTED_NOT_ADMISSION'&&completion.roleCount===names.length&&
  completion.nativeAdmission===false&&completion.executionAllowed===false&&equal(source,view.source)&&
  completion.sourceSha===source.candidateSha&&hex(completion.sourceSha,40)&&completion.runId===view.runId&&
  completion.containerId===resource.containerId&&hex(completion.containerId,64)&&ordinaryAcl.completion===ordinaryAclCompletion,'HANDLE');
 const {archiveCompletion,catalogSql,protectedSql,roleCompletion}=ordinaryAcl;
 const identity=roleCompletion.databaseIdentity;
 const predecessors=[completion.installXid,ordinaryAclCompletion.installXid,ordinaryAclCompletion.archiveInstallXid];
 need(predecessors.every(xid)&&new Set(predecessors).size===predecessors.length&&
  archiveCompletion.installXid===ordinaryAclCompletion.archiveInstallXid&&
  [ordinaryAclCompletion.catalogSha256,ordinaryAclCompletion.protectedSha256,archiveCompletion.bindingSha256,
   archiveCompletion.pendingSha256].every(value=>hex(value,64))&&typeof protectedSql==='string'&&
  typeof catalogSql==='string'&&catalogSql.split('a.attacl::text').length===2&&
  identity.database===resource.databaseName&&identity.database===`jg_task01_${view.runId.replaceAll('-','')}`&&
  oid(identity.databaseOid)&&oid(identity.namespaceOid)&&xid(identity.systemIdentifier)&&
  isExactCurrentArchiveProfile(source.profile),'HANDLE');
 const xmin=String(BigInt(completion.installXid)%0x100000000n);
 need(Array.isArray(roles)&&roles.length===names.length&&roles.every((role,i)=>
  role.name===names[i]&&oid(role.oid)&&role.oid!=='10'&&role.xmin===xmin)&&
  new Set(roles.map(role=>role.oid)).size===names.length,'HANDLE');
 return {completion,ordinaryAcl,roles,identity,predecessors,ledger:source.profile.ledger};
}

function lineage(input){
 const {ordinaryAcl,roles,identity,predecessors,ledger}=input;
 const {archiveCompletion,completion,catalogSql,protectedSql}=ordinaryAcl;
 const roleOids=roles.map(role=>quote(role.oid)+'::oid').join(',');
 // The original renderer independently requires the exact complete new
 // column matrix. Only those three grantees are removed from this old-ACL
 // continuity view. The archived full raw catalog is still checked prewrite.
 const normalizedAcl=`(SELECT coalesce(jsonb_agg(jsonb_build_array(g.grantor,g.grantee,g.privilege_type,g.is_grantable)
  ORDER BY g.grantor,g.grantee,g.privilege_type COLLATE "C",g.is_grantable),'[]'::jsonb)
  FROM ${current259AclRowsSql('a.attacl')} g WHERE g.grantee NOT IN (${roleOids}))`;
 const normalizedCatalog=catalogSql.replace('a.attacl::text',()=>normalizedAcl);
 const bindingDigest=digest(`jsonb_build_array(${bindings.map(name=>`(SELECT to_jsonb(b) FROM public.${name} b)`).join(',')})`);
 const pendingDigest=digest('(SELECT to_jsonb(b) FROM public.jg_contract_direct_pending_binding_v1 b WHERE b."protocolVersion"=1)');
 const namespace="to_regnamespace('public')::oid";
 const bindingRows=[...priorBindings,...bindings].map(name=>`(SELECT jsonb_agg(jsonb_build_array(b.xmin::text,to_jsonb(b))
   ORDER BY to_jsonb(b)::text COLLATE "C",b.xmin::text COLLATE "C") FROM public.${name} b)`).join(',');
 const continuity=digest(`jsonb_build_array(${normalizedCatalog},
  ${bindingRows},
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_type t WHERE t.typnamespace=${namespace}),
  (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace=${namespace}),
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid WHERE c.relnamespace=${namespace}),
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d),
  (SELECT jsonb_agg(jsonb_build_array(r.oid::text,r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,
    r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls,r.rolconnlimit,r.rolvaliduntil,r.xmin::text,
    r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m),
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole) FROM pg_db_role_setting s))`);
 const roleRows=roles.map(role=>`(${quote(role.name)},${quote(role.oid)}::oid,${quote(role.xmin)})`).join(',');
 const roleProof=`NOT EXISTS(SELECT FROM (VALUES ${roleRows}) expected(name,id,role_xmin)
  WHERE NOT EXISTS(SELECT FROM pg_authid r WHERE r.oid=expected.id AND r.rolname::text=expected.name AND r.xmin::text=expected.role_xmin
   AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
   AND r.rolpassword IS NULL AND r.rolvaliduntil IS NULL AND r.rolconnlimit=0))`;
 const common=`current_database() IS DISTINCT FROM ${quote(identity.database)}
  OR current_user::regrole::oid<>10 OR session_user IS DISTINCT FROM current_user
  OR (SELECT d.oid FROM pg_database d WHERE d.datname=current_database() AND d.datdba=10) IS DISTINCT FROM ${quote(identity.databaseOid)}::oid
  OR ${namespace} IS DISTINCT FROM ${quote(identity.namespaceOid)}::oid
  OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM ${quote(identity.systemIdentifier)}
  OR NOT (${roleProof})
  OR ${predecessors.map(value=>`pg_xact_status(${quote(value)}::xid8) IS DISTINCT FROM 'committed'`).join(' OR ')}
  OR ${bindingDigest} IS DISTINCT FROM ${quote(archiveCompletion.bindingSha256)}
  OR ${pendingDigest} IS DISTINCT FROM ${quote(archiveCompletion.pendingSha256)}
  OR (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,
   'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations) IS DISTINCT FROM ${json(ledger)}`;
 const preimage=`(${catalogSql}) IS DISTINCT FROM ${quote(completion.catalogSha256)}
  OR (${protectedSql}) IS DISTINCT FROM ${quote(completion.protectedSha256)}`;
 return {continuity,common,preimage};
}

function insertBefore(sql,marker,section){
 const index=sql.indexOf(marker);
 need(index>=0&&index===sql.lastIndexOf(marker),'RENDER');
 return sql.slice(0,index)+section+'\n'+sql.slice(index);
}
function guarded(sql,phase,proof,expected){
 const guard=(tag,prior)=>`DO $document_acl_transport_${tag}$ BEGIN
 IF ${proof.common}${prior?' OR '+proof.preimage:''}
 ${expected?`OR (${proof.continuity}) IS DISTINCT FROM ${quote(expected)}`:''}
 THEN RAISE EXCEPTION '${CODE}_${tag.toUpperCase()}'; END IF;
 END $document_acl_transport_${tag}$;`;
 const section=(statements)=>[search,...statements,reset].join('\n');
 if(phase==='WRITE'){
  sql=insertBefore(sql,'DO $doc_acl_preimage$',section([
   `LOCK TABLE public._prisma_migrations,${[...priorBindings,...bindings].map(name=>'public.'+name).join(', ')} IN SHARE MODE NOWAIT;`,
   guard('preimage',true)]));
 }else{
  const before=phase==='BEFORE';
  sql=insertBefore(sql,before?'DO $doc_acl_before$':'DO $doc_acl_committed$',
   section([guard(before?'preimage':'readback',before)]));
 }
 return insertBefore(sql,aclSelect,section([
  ...(phase==='WRITE'?[guard('postimage',false)]:[]),
  `SELECT jsonb_build_object('continuitySha256',${proof.continuity});`
 ]));
}

function readOwner(result,input){
 const stdout=own(result,'stdout');
 need(typeof stdout==='string'&&Buffer.byteLength(stdout)<=8192,'OUTPUT');
 const lines=stdout.replace(/\n$/u,'').split('\n');
 need(lines.length===2,'OUTPUT');
 let continuity,row;
 try{[continuity,row]=lines.map(line=>JSON.parse(line));}
 catch{throw fault('OUTPUT');}
 need(continuity&&Object.keys(continuity).length===1&&hex(continuity.continuitySha256,64)&&row,'OUTPUT');
 const {identity,roles}=input;
 need(row.databaseOid===identity.databaseOid&&row.namespaceOid===identity.namespaceOid&&
  row.systemIdentifier===identity.systemIdentifier&&equal(row.roleOids,roles.map(role=>role.oid))&&
  equal(row.roleXmins,roles.map(role=>role.xmin)),'ROLE_IDENTITY');
 return {row:lines[1],installXid:row.installXid,continuitySha256:continuity.continuitySha256};
}
const safeReasons=new Set(['OUTPUT','ROLE_IDENTITY','CONTINUITY','RENDER','XID',
 'CURRENT259_DOCUMENT_ACL_OUTPUT','CURRENT259_DOCUMENT_ACL_STAGED','CURRENT259_DOCUMENT_ACL_COMMITTED','TASK01_RESOURCE_COMMAND_FAILED']);
function reason(error){
 const code=own(error,'code');
 if(typeof code!=='string')return undefined;
 const safe=code.startsWith(CODE+'_')?code.slice(CODE.length+1):code;
 return safeReasons.has(safe)?safe:undefined;
}

async function installCurrent259GeneratedDocumentAcl(roleCompletion,handle){
 need(arguments.length===2&&handle&&typeof handle==='object'&&!types.isProxy(handle)&&!used.has(handle),'HANDLE');
 const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=own(resource,'execOwnerSql');
 need(resource.topology===topology&&typeof exec==='function','HANDLE');
 const rolesLease=claimCurrent259GeneratedDocumentRoles(roleCompletion,handle);
 const input=qualify(rolesLease,view);
 need(roleCompletion===input.completion,'HANDLE');
 used.add(handle);
 const check=()=>{
  rolesLease.check();view.check();
  need(claimCurrent259TechnicalResource(handle)===view&&view.resource===resource&&
   resource.topology===topology&&own(resource,'execOwnerSql')===exec,'CONTINUITY');
 };
 let phase='BEFORE',writing=false;
 try{
  check();
  const renderer=beginCurrent259GeneratedDocumentAcl(),proof=lineage(input);
  const run=async(next,sql,expected)=>{
   phase=next;check();
   const fixed=guarded(sql,next,proof,expected);
   if(next==='WRITE')writing=true;
   const result=await exec.call(resource,fixed,phases[next]);
   check();return readOwner(result,input);
  };
  const before=await run('BEFORE',renderer.beforeSql);
  const writer=renderer.acceptBefore(before.row);
  const staged=await run('WRITE',writer.sql,before.continuitySha256);
  need(staged.continuitySha256===before.continuitySha256,'CONTINUITY');
  need(xid(staged.installXid)&&!input.predecessors.includes(staged.installXid),'XID');
  const reader=writer.acceptStaged(staged.row);
  const committed=await run('COMMITTED',reader.sql,before.continuitySha256);
  need(committed.continuitySha256===before.continuitySha256,'CONTINUITY');
  const matched=reader.acceptCommitted(committed.row);
  check();
  const result=Object.freeze({status:'CURRENT259_DOCUMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:roleCompletion.sourceSha,
   runId:view.runId,containerId:resource.containerId,roleInstallXid:roleCompletion.installXid,installXid:committed.installXid,
   profileSha256:matched.profileSha256,executionAllowed:false,nativeAdmission:false});
  installed.set(result,{handle,check,rolesLease,continuitySha256:committed.continuitySha256,continuitySql:proof.continuity});
  return result;
 }catch(cause){
  const error=Object.assign(fault(writing?'COMMIT_UNCONFIRMED':'PRESTATE_REJECTED'),{phase});
  const fixedReason=reason(cause);
  if(fixedReason)Object.defineProperty(error,'reason',{value:fixedReason,enumerable:true});
  try{await closeCurrent259OwnedResource(handle);}
  catch{Object.defineProperty(error,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});}
  throw error;
 }
}
function claimCurrent259GeneratedDocumentAcl(result,handle){
 need(arguments.length===2,'HANDLE');
 return claim(result,handle,false);
}
function claimCurrent259GeneratedDocumentSaveAcl(result,handle){
 need(arguments.length===2,'HANDLE');
 return claim(result,handle,true);
}
function claim(result,handle,save){
 const receipt=installed.get(result);
 need(receipt?.handle===handle&&receipt&&(receipt.rolesLease.ordinaryAcl.generatedDocument===true)===save,'HANDLE');
 installed.delete(result);receipt.check();
 const {ordinaryAcl,roles,source}=receipt.rolesLease;
 return Object.freeze({completion:result,ordinaryAcl,roles,source,check:receipt.check,
  continuitySha256:receipt.continuitySha256,continuitySql:receipt.continuitySql});
}
module.exports=Object.freeze({installCurrent259GeneratedDocumentAcl,claimCurrent259GeneratedDocumentAcl,claimCurrent259GeneratedDocumentSaveAcl});
