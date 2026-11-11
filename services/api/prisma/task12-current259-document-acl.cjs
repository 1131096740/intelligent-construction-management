'use strict';
const {readFileSync}=require('node:fs');
const {createHash,randomBytes}=require('node:crypto');
const path=require('node:path');
const {current259AclRowsSql}=require('./task16-current259-catalog.cjs');

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

function profile(){
 const bytes=readFileSync(manifestFile);
 need(sha(bytes)===manifestSha,'SOURCE');
 const data=JSON.parse(bytes);
 need(data.version===1&&same(Object.keys(data.roles),roles),'SOURCE');
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
 return {groups,rows,tables:[...new Set(rows.map(row=>row.relation))].sort()};
}
function catalog(material){
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
 return {rolesSql,publicNs,dbOid,roleHealth,fixedObjects,effective,acl,coordinates};
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
 need(arguments.length===0,'ARGUMENTS');
 const material=profile(),c=catalog(material),challenge=nonce();
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
    return Object.freeze({status:'CURRENT259_DOCUMENT_ACL_SOURCE_PROJECTION_MATCHED',profileSha256:manifestSha,
     nativeAdmission:false,executionAllowed:false});
   })});
  })});
 })});
}
module.exports=Object.freeze({beginCurrent259GeneratedDocumentAcl});
