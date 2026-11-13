'use strict';
const {readFileSync}=require('node:fs');
const {createHash,randomBytes}=require('node:crypto');
const path=require('node:path');
const {types}=require('node:util');
const {current259AclRowsSql}=require('./task16-current259-catalog.cjs');
const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');

const sha=value=>createHash('sha256').update(value).digest('hex');
const roles=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'];
const manifestSha='d2dfd0f356152bb7acb41074b9aa39004907dc24c2359b0f2f9dffd8b49b3038';
const manifestFile=path.join(__dirname,'task12-current259-document-acl.json');
const keys=['challenge','phase','backendPid','backendStart','databaseOid','namespaceOid','systemIdentifier','coordinatesSha256',
 'roleOids','roleXmins','installXid','commitStatus'];
const safeName=/^[A-Za-z][A-Za-z0-9_]{0,62}$/u;
const hex=/^[0-9a-f]{64}$/u;
const number=(v,max)=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/u.test(v)&&BigInt(v)<=max;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const identifier=value=>'"'+value+'"';
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const list=values=>values.map(quote).join(',');
const need=(ok,part)=>{
 if(!ok){const code='CURRENT259_DOCUMENT_ACL_'+part;throw Object.assign(new Error(code),{code});}
};
const setup="SET LOCAL search_path TO pg_catalog, pg_temp;\nSET LOCAL standard_conforming_strings=on;";
const readOnly='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;';
const write='BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;';
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const distinct=(left,right)=>left.backendPid!==right.backendPid&&left.backendStart!==right.backendStart;
const stable=row=>[row.databaseOid,row.namespaceOid,row.systemIdentifier,row.coordinatesSha256,row.roleOids,row.roleXmins];

const {registeredGeneratedLifecycleCollisionMaterial,migrationGeneratedLifecycleCollisionMaterial,generatedLifecycleCollisionSql}=require('./task12-current261-generated-lifecycle-collision.cjs');
function profile(source,migration=false){
 const bytes=readFileSync(manifestFile);
 need(sha(bytes)===manifestSha,'SOURCE');
 const data=JSON.parse(bytes);
 need(data.version===1&&same(Object.keys(data.roles),roles),'SOURCE');
 if(source!==undefined){
  qualifyCurrent261GeneratedLifecycleSource(source);
  const defaults={jg_c259_doc_template:{ContractLayoutTemplate:['createdAt'],ContractLayoutTemplateVersion:['draftRevision','createdAt'],ContractLayoutPreviewJob:['createdAt'],AuditLog:['createdAt']},
   jg_c259_doc_worker:{AuditLog:['createdAt'],FileObject:['createdAt']},
   jg_c259_doc_queue:{ContractGeneratedDocument:['createdAt'],AuditLog:['createdAt']}};
  const collision=(migration?migrationGeneratedLifecycleCollisionMaterial:registeredGeneratedLifecycleCollisionMaterial)(source);
  for(const role of roles){
   for(const [table,columns]of Object.entries(defaults[role])){
    const insert=data.roles[role][table]?.insert;need(insert?.length&&columns.every(column=>!insert.includes(column)),'SOURCE');
    data.roles[role][table].insert=[...insert,...columns].sort();
   }
   if(collision.callers.includes(role))for(const [table,column]of collision.columns){
    const ops=data.roles[role][table]??={};const columns=ops.select??=[];
    if(!columns.includes(column))columns.push(column);columns.sort();
   }
  }
 }
 const groups=[],rows=[];
 for(const [role,tables] of Object.entries(data.roles))for(const [relation,operations] of Object.entries(tables)){
  need(safeName.test(relation),'SOURCE');
  for(const [operation,columns] of Object.entries(operations)){
   need(['select','insert','update'].includes(operation)&&columns.length&&columns.every(c=>safeName.test(c)),'SOURCE');
   if(relation==='FileObject')need(operation!=='update','SOURCE');
   const privilege=operation.toUpperCase();
   groups.push({role,relation,columns,privilege});
   for(const column of columns)rows.push({role,relation,column,privilege});
  }
 }
 const collision=source===undefined?undefined:(migration?migrationGeneratedLifecycleCollisionMaterial:registeredGeneratedLifecycleCollisionMaterial)(source);
 return {collision,functions:collision?.functions??[],groups,rows,tables:[...new Set(rows.map(row=>row.relation))].sort(),sha256:source===undefined?manifestSha:sha(JSON.stringify(['CURRENT261_GENERATED_LIFECYCLE_DOCUMENT_ACL_V1',manifestSha,rows,collision]))};
}
function catalog(material){
 const collision=material.collision?generatedLifecycleCollisionSql(material.collision):undefined;
 const roleRows=`(SELECT r.oid,r.xmin AS role_xmin,r.rolname,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreatedb,
  r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolpassword IS NULL AS no_password,r.rolvaliduntil,r.rolconnlimit
  FROM pg_authid r WHERE r.rolname::text IN (${list(roles)}))`;
 const rolesSql=key=>`(SELECT jsonb_agg(r.${key}::text ORDER BY array_position(ARRAY[${list(roles)}],r.rolname::text)) FROM ${roleRows} r)`;
 const publicNs="to_regnamespace('public')::oid";
 const dbOid="(SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10)";
 const expected=`jsonb_to_recordset(${json(material.rows)}) e(role text,relation text,"column" text,privilege text)`;
 const attr="c.relnamespace="+publicNs+" AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped";
 const roleHealth=`(SELECT count(*)=3 AND bool_and(r.oid<>10 AND NOT
  (r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
  AND r.no_password AND r.rolvaliduntil IS NULL AND r.rolconnlimit=0
  AND NOT has_schema_privilege(r.oid,${publicNs},'CREATE')
  AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)) FROM ${roleRows} r)`;
 const fixedObjects=`NOT EXISTS(SELECT FROM ${expected}
  WHERE NOT EXISTS(SELECT FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE ${attr}
   AND c.relowner=10 AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
   AND c.relname::text=e.relation AND a.attname::text=e."column"))`;
 const effective=`NOT EXISTS(SELECT FROM pg_class c CROSS JOIN ${roleRows} r
  WHERE c.relnamespace=${publicNs} AND c.relkind IN ('r','p','v','m','f') AND
    has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  AND NOT EXISTS(SELECT FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN LATERAL ${current259AclRowsSql('a.attacl')} acl WHERE c.relnamespace=${publicNs} AND acl.grantee=0)`;
 const actual=`SELECT r.rolname::text AS role,c.relname::text AS relation,a.attname::text AS "column",acl.privilege_type AS privilege,
  acl.grantor::text AS grantor,acl.is_grantable AS grantable
  FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  CROSS JOIN LATERAL ${current259AclRowsSql('a.attacl')} acl JOIN ${roleRows} r ON r.oid=acl.grantee
  WHERE c.relnamespace=${publicNs}`;
 const acl=post=>`NOT EXISTS(WITH actual AS (${actual}), expected AS (
  SELECT e.*, '10'::text AS grantor,false AS grantable FROM ${expected} WHERE ${post?'true':'false'})
  (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual))`;
 const coordinates=`(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.oid,to_jsonb(a)-'attacl',
  (SELECT coalesce(jsonb_agg(jsonb_build_array(acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable)
    ORDER BY acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable),'[]'::jsonb)
   FROM ${current259AclRowsSql('a.attacl')} acl WHERE NOT EXISTS(SELECT FROM ${roleRows} r WHERE r.oid=acl.grantee)),
  c.relacl) ORDER BY c.oid,a.attnum)::text,'UTF8')),'hex')
  FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE ${attr} AND c.relname IN (${list(material.tables)}))`;
 return {rolesSql,publicNs,dbOid,roleHealth,fixedObjects:collision?`(${fixedObjects}) AND (${collision.metadata}) AND (${collision.installation})`:fixedObjects,effective,acl:post=>collision?`(${acl(post)}) AND (${collision.acl(post)})`:acl(post),coordinates};
}

function render(material,c,phase,challenge,before,staged){
 const stagedPhase=phase==='staged',committed=phase==='committed';
 const committedStatus=committed?`pg_xact_status(${quote(staged.installXid)}::xid8)`:'NULL::text';
 const xid=stagedPhase?'pg_current_xact_id()::text':committed?quote(staged.installXid):'NULL::text';
 const guard=(tag,post)=>`DO $doc_acl_${tag}$ BEGIN
 IF current_user::regrole::oid<>10 OR session_user IS DISTINCT FROM current_user OR ${c.dbOid} IS NULL
  OR current_database() !~ '^jg_task01_[a-f0-9]{32}$'
  OR host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
  OR inet_server_port() IS DISTINCT FROM 5432 OR
  current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  OR ${c.roleHealth} IS DISTINCT FROM true OR NOT(${c.fixedObjects}) OR NOT(${c.effective}) OR NOT(${c.acl(post)})
  ${before?`OR ${c.dbOid} IS DISTINCT FROM ${quote(before.databaseOid)} OR ${c.publicNs} IS DISTINCT FROM ${quote(before.namespaceOid)}::oid
  OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM ${quote(before.systemIdentifier)}
  OR ${c.coordinates} IS DISTINCT FROM ${quote(before.coordinatesSha256)}
  OR ${c.rolesSql('oid')} IS DISTINCT FROM ${json(before.roleOids)} OR ${c.rolesSql('role_xmin')} IS DISTINCT FROM ${json(before.roleXmins)}`:''}
  ${committed?`OR ${committedStatus} IS DISTINCT FROM 'committed'`:''}
 THEN RAISE EXCEPTION 'CURRENT259_DOCUMENT_ACL_${tag.toUpperCase()}'; END IF;
END $doc_acl_${tag}$;`;
 const statements=stagedPhase?[
  `LOCK TABLE ${material.tables.map(table=>'public.'+identifier(table)).join(', ')} IN SHARE ROW EXCLUSIVE MODE NOWAIT;`,guard('preimage',false),
  ...material.groups.map(row=>`GRANT ${row.privilege} (${row.columns.map(identifier).join(', ')}) ON TABLE public.${identifier(row.relation)} TO ${identifier(row.role)};`),
  ...(material.collision?generatedLifecycleCollisionSql(material.collision).grants:[]),
  guard('postimage',true)
 ]:[guard(phase,committed)];
 return [stagedPhase?write:readOnly,setup,...statements,
  `SELECT jsonb_build_object('challenge','${challenge}','phase',${quote(phase)},'backendPid',pg_backend_pid(),
 'backendStart',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'databaseOid',${c.dbOid},'namespaceOid',${c.publicNs}::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'coordinatesSha256',${c.coordinates},'roleOids',${c.rolesSql('oid')},'roleXmins',${c.rolesSql('role_xmin')},'installXid',${xid},'commitStatus',${committedStatus})
 FROM pg_stat_activity a WHERE a.pid=pg_backend_pid();`,stagedPhase?'COMMIT;':'ROLLBACK;'].join('\n');
}
function observation(text,phase,challenge){
 need(typeof text==='string'&&Buffer.byteLength(text)<=4096,'OUTPUT');
 let row;try{row=JSON.parse(text);}catch{need(false,'OUTPUT');}
 need(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===keys.length&&keys.every(key=>Object.hasOwn(row,key))&&
  row.phase===phase&&row.challenge===challenge&&Number.isInteger(row.backendPid)&&row.backendPid>0&&row.backendPid<=2147483647&&
  typeof row.backendStart==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.backendStart)&&
  Number.isFinite(Date.parse(row.backendStart))&&[row.databaseOid,row.namespaceOid].every(v=>number(v,0xffffffffn))&&
  number(row.systemIdentifier,0xffffffffffffffffn)&&typeof row.coordinatesSha256==='string'&&hex.test(row.coordinatesSha256)&&
  Array.isArray(row.roleOids)&&row.roleOids.length===3&&new Set(row.roleOids).size===3&&row.roleOids.every(v=>number(v,0xffffffffn)&&v!=='10')&&
  Array.isArray(row.roleXmins)&&row.roleXmins.length===3&&row.roleXmins.every(v=>number(v,0xffffffffn))&&
  (phase==='before'?row.installXid===null:number(row.installXid,0xffffffffffffffffn))&&
  row.commitStatus===(phase==='committed'?'committed':null),'OUTPUT');
 return row;
}
const nonce=()=>randomBytes(32).toString('hex');
function once(accept){
 let attempted=false;
 return function(text){need(arguments.length===1&&!attempted,'REPLAY');attempted=true;return accept(text);};
}

/** Fixed SQL material only. No live role issuance, transport or application authority. */
function beginCurrent259GeneratedDocumentAcl(){
 need(arguments.length===0,'ARGUMENTS');return begin(profile());
}
function describeCurrent261GeneratedLifecycleDocumentAcl(source){return describe(profile(source));}
function describeMigration261GeneratedLifecycleDocumentAcl(source){return describe(profile(source,true));}
function describe(material){
 return Object.freeze({purpose:'CURRENT261_GENERATED_LIFECYCLE_DOCUMENT_ACL_V1',profileSha256:material.sha256,
  installation:material.collision.installation,effectivePlanSha256:material.collision.sha256,functions:material.functions,collision:material.collision,
  frozenManifestSha256:manifestSha,groups:Object.freeze(material.groups.map(row=>Object.freeze({...row,columns:Object.freeze([...row.columns])}))),
  rows:Object.freeze(material.rows.map(row=>Object.freeze({...row}))),executionAllowed:false,nativeAdmission:false});
}
/** Fixed source SQL only. This projection cannot issue a role/session brand.
 * The renderer still requires its complete exact ACL postimage before the
 * transport continuity check may compare this approved signed-column delta. */
function renderCurrent261DocumentAclContinuity(source,identities){
 const own=(v,k)=>v&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
 need(arguments.length===2&&Array.isArray(identities)&&!types.isProxy(identities)&&identities.length===roles.length&&
  identities.every((r,i)=>own(r,'name')===roles[i]&&number(own(r,'oid'),0xffffffffn)&&own(r,'oid')!=='10')&&
  new Set(identities.map(r=>own(r,'oid'))).size===roles.length,'SOURCE');
 const material=profile(source);
 const approved=material.rows.filter(r=>r.relation==='ContractVersion'&&r.column==='originalSignedNumber');
 need(approved.length===2&&approved.every(r=>r.privilege==='SELECT')&&
  same(approved.map(r=>r.role).sort(),['jg_c259_doc_queue','jg_c259_doc_worker']),'SOURCE');
 const grantees=approved.map(r=>own(identities[roles.indexOf(r.role)],'oid')).sort((a,b)=>Number(a)-Number(b));
 const prefix="(pg_catalog.to_jsonb(a)-'attacl')||pg_catalog.jsonb_build_object('retainedAcl',";
 const suffix=") ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a";
 const normalizeProtectedSql=sql=>{
  need(typeof sql==='string'&&sql.split(prefix).length===2&&sql.split(suffix).length===2,'SOURCE');
  const begin=sql.indexOf(prefix)+prefix.length,end=sql.indexOf(suffix,begin);
  need(end>begin,'SOURCE');const original=sql.slice(begin,end);
  // Work on the existing decoded retained-ACL JSON, so NULL and empty ACL
  // arrays keep their original witness meaning. Preserve every other row,
  // field, grantee, grantor, privilege, grant option and array order.
  const projected=`CASE WHEN a.attrelid=pg_catalog.to_regclass('public."ContractVersion"') AND a.attname::text='originalSignedNumber' THEN
   (SELECT coalesce(pg_catalog.jsonb_agg(acl_item ORDER BY acl_order),'[]'::jsonb)
    FROM pg_catalog.jsonb_array_elements(${original}) WITH ORDINALITY approved_acl(acl_item,acl_order)
    WHERE NOT (acl_item->>0='10' AND acl_item->>1 IN (${grantees.map(quote).join(',')})
     AND acl_item->>2='SELECT' AND acl_item->3='false'::jsonb)) ELSE ${original} END`;
  return sql.slice(0,begin)+projected+sql.slice(end);
 };
 return Object.freeze({profileSha256:material.sha256,normalizeProtectedSql,exactPostimageSql:catalog(material).acl(true),
  executionAllowed:false,nativeAdmission:false});
}
function beginCurrent261GeneratedLifecycleDocumentAcl(source){
 need(arguments.length===1&&source!==undefined,'ARGUMENTS');return begin(profile(source));
}
function begin(material){
 const c=catalog(material),challenge=nonce();
 return Object.freeze({beforeSql:render(material,c,'before',challenge),acceptBefore:once(text=>{
  const before=observation(text,'before',challenge),challengeWrite=nonce();
  return Object.freeze({sql:render(material,c,'staged',challengeWrite,before),acceptStaged:once(stagedText=>{
   const staged=observation(stagedText,'staged',challengeWrite);
   need(same(stable(before),stable(staged))&&distinct(before,staged),'STAGED');
   const challengeReadback=nonce();
   return Object.freeze({sql:render(material,c,'committed',challengeReadback,before,staged),acceptCommitted:once(committedText=>{
    const committed=observation(committedText,'committed',challengeReadback);
    need(same(stable(staged),stable(committed))&&distinct(before,committed)&&distinct(staged,committed)&&
     committed.installXid===staged.installXid,'COMMITTED');
    return Object.freeze({status:'CURRENT259_DOCUMENT_ACL_SOURCE_PROJECTION_MATCHED',profileSha256:material.sha256,
     ...(material.collision?{effectivePlanSha256:material.collision.sha256,installation:material.collision.installation}:{}),
     nativeAdmission:false,executionAllowed:false});
   })});
  })});
 })});
}
module.exports=Object.freeze({beginCurrent259GeneratedDocumentAcl,beginCurrent261GeneratedLifecycleDocumentAcl,describeCurrent261GeneratedLifecycleDocumentAcl,describeMigration261GeneratedLifecycleDocumentAcl,renderCurrent261DocumentAclContinuity});
