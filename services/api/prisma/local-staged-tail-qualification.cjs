"use strict";
// Four finite technical windows for the owned F0 fixture. No session/business authority.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
const controls=require('./local-staged-migration-controls.cjs');
const WINDOWS=[213,215,218,221],FULL='d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const hash=x=>createHash('sha256').update(x).digest('hex'),quote=x=>"'"+x.replaceAll("'","''")+"'";
const need=x=>{if(!x)throw new Error('LOCAL_MIGRATION_TAIL_QUALIFICATION');};
const oid=x=>typeof x==='string'&&/^[1-9][0-9]{0,9}$/u.test(x)&&BigInt(x)<=0xffffffffn;
const txid=x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/u.test(x)&&BigInt(x)<=0xffffffffffffffffn;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
function frozen(value){
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 need(value&&typeof value==='object'&&!types.isProxy(value));const ds=Object.getOwnPropertyDescriptors(value);
 need(Reflect.ownKeys(ds).every(k=>typeof k==='string'&&Object.hasOwn(ds[k],'value')));
 if(Array.isArray(value))return Object.freeze(Array.from({length:value.length},(_,i)=>{need(ds[i]);return frozen(ds[i].value);}));
 need(Object.getPrototypeOf(value)===Object.prototype);return Object.freeze(Object.fromEntries(Object.keys(ds).map(k=>[k,frozen(ds[k].value)])));
}
const keys=(x,wanted)=>need(equal(Object.keys(x).sort(),wanted.slice().sort()));
const MATRIX_SHA='ac144a3c6a1dbaef2cb41ce0815dfd7afd30f0d7d8d9a29eaaf0580532d7888e',POST213_SHA='0080a3d2f5321b9a89772bad7ecff244b6653c612a406ab4538f27372725937c';
function verifyMaterials(){
 need(hash(fs.readFileSync(path.join(__dirname,'local-staged-tail-qualification.json')))===MATRIX_SHA&&
  hash(fs.readFileSync(path.join(__dirname,'local-staged-tail-post213.sql')))===POST213_SHA);
}
verifyMaterials();
const matrix=JSON.parse(fs.readFileSync(path.join(__dirname,'local-staged-tail-qualification.json'),'utf8'));
const BINDINGS=[
 [205,'jg_contract_direct_pending_binding_v1',1],
 [206,'jg_contract_direct_review_retention_binding_v1',213],
 [207,'jg_contract_direct_archive_binding_v1',213],
 [209,'jg_contract_direct_archive_retention_binding_v1',213],
 [214,'jg_contract_direct_archive_dispatch_binding_v1',214],
 [215,'jg_contract_upward_pending_create_binding_v1',216],
 [217,'jg_contract_direct_archive_completion_binding_v1',217],
 [218,'jg_contract_upward_pending_save_binding_v1',219],
 [220,'jg_contract_direct_archive_intent_binding_v1',null],
 [220,'jg_contract_direct_archive_intent_v1',null],
 [220,'jg_contract_direct_archive_intent_use_v1',null],
 [221,'jg_contract_direct_archive_generation_v1',null]
];
function context(input){
 verifyMaterials();const v=frozen(input);keys(v,['plan','setup','migrations']);controls.checkSetup(v.setup,v.plan);
 need(v.plan.actorOid==='10'&&Array.isArray(v.migrations)&&v.migrations.length===259);
 const ledger=v.migrations.map((r,i)=>{keys(r,['name','sha256']);need(/^\d{14}_[a-z0-9_]+$/u.test(r.name)&&digest(r.sha256)&&(!i||v.migrations[i-1].name<r.name));return {...r,finished:true,rolledBack:false};});
 need(hash(JSON.stringify(ledger))===FULL&&equal(v.plan.migrations,v.migrations.slice(0,205)));
 for(const r of v.migrations)need(hash(fs.readFileSync(path.join(__dirname,'migrations',r.name,'migration.sql')))===r.sha256);
 return Object.freeze({...v,ledger:Object.freeze(ledger)});
}
function targets(stage){
 need(WINDOWS.includes(stage));return stage===213?matrix.post213Targets:
 matrix.windows[stage].eligible.map(key=>{const [table,member,privilege]=key.split('/');return {kind:'column',table,member,privilege,recipients:'app'};});
}
function config(c,stage,phase,xid=null){
 need(['before','staged','committed'].includes(phase)&&WINDOWS.includes(stage));
 return {stage,phase,nonce:c.plan.nonce,runId:c.plan.runId,sourceSha256:FULL,identity:Object.fromEntries(['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier'].map(k=>[k,c.plan[k]])),
  appOid:c.setup.appOid,appName:c.plan.appName,fileCallerOids:c.setup.fileCallerOids.map(String),ledger:c.ledger.slice(0,stage),
  targets:targets(stage),routines:stage===213?matrix.routines213:[],triggers:stage===213?matrix.triggers213:[],required:stage===213?[]:matrix.windows[stage].required,
  locks:stage===213?[]:matrix.windows[stage].lockUpdateRequired,
  bindings:BINDINGS.filter(([created])=>created<=stage).map(([created,name,produced])=>({name,count:produced!==null&&(produced<stage||produced===stage&&(stage!==213||phase!=='before'))?1:0})),
  installXid:xid};
}
function projection(c,stage,phase,xid=null){
 const cfg=config(c,stage,phase,xid),bindingSql=cfg.bindings.map(b=>`SELECT ${quote(b.name)}::text AS name,c.oid::text AS oid,c.relowner::text AS owner,
 c.relkind::text AS kind,c.relpersistence::text AS persistence,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('sha256',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),'xmin',r.xmin::text) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM public.${b.name} r) AS rows
 FROM pg_class c WHERE c.oid='public.${b.name}'::regclass`).join('\nUNION ALL\n');
 return `WITH cfg AS (SELECT ${quote(JSON.stringify(cfg))}::jsonb AS p),
 target_specs AS (SELECT DISTINCT x.v->>'kind' AS kind,x.v->>'table' AS object,x.v->>'member' AS member,x.v->>'privilege' AS privilege,roles.value::oid AS role_oid
  FROM cfg CROSS JOIN LATERAL jsonb_array_elements(p->'targets') x(v)
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN x.v->>'recipients'='file' THEN (p->'fileCallerOids')||jsonb_build_array(p->>'appOid') ELSE jsonb_build_array(p->>'appOid') END) roles(value)
  WHERE roles.value::oid<>(p->'identity'->>'actorOid')::oid),
 target_objects AS (SELECT t.*,CASE WHEN kind='function' THEN to_regprocedure(object)::oid ELSE to_regclass(format('public.%I',object))::oid END AS object_oid FROM target_specs t),
 target_columns AS (SELECT t.*,CASE WHEN kind='column' THEN a.attnum ELSE 0 END AS attnum,CASE WHEN kind='column' THEN a.atttypid::text ELSE '0' END AS type_oid,
  CASE WHEN kind='column' THEN a.xmin::text WHEN kind='function' THEN f.xmin::text ELSE c.xmin::text END AS catalog_xmin
  FROM target_objects t LEFT JOIN pg_attribute a ON kind='column' AND a.attrelid=t.object_oid AND a.attname=member AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_proc f ON kind='function' AND f.oid=t.object_oid LEFT JOIN pg_class c ON kind='table' AND c.oid=t.object_oid),
 acl_rows AS (
  SELECT 'table'::text AS kind,c.oid AS object_oid,0::smallint AS attnum,g.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) g WHERE c.relnamespace=to_regnamespace('public')
  UNION ALL SELECT 'column',a.attrelid,a.attnum,g.* FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) g WHERE c.relnamespace=to_regnamespace('public') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL SELECT 'function',f.oid,0::smallint,g.* FROM pg_proc f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) g WHERE f.pronamespace=to_regnamespace('public')
  UNION ALL SELECT 'schema',n.oid,0::smallint,g.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) g
  UNION ALL SELECT 'database',d.oid,0::smallint,g.* FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) g),
 binding_rows AS (${bindingSql}),
 required AS (SELECT split_part(v,'/',1) AS object,split_part(v,'/',2) AS member,split_part(v,'/',3) AS privilege,v AS key FROM cfg CROSS JOIN LATERAL jsonb_array_elements_text(p->'required') q(v))
 SELECT jsonb_build_object(
 'scope',jsonb_build_object('stage',p->'stage','phase',p->>'phase','nonce',p->>'nonce','runId',p->>'runId','sourceSha256',p->>'sourceSha256'),
 'identity',jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,'actorOid',current_user::regrole::oid::text,'ownerOid',d.datdba::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'actor',current_user,'sessionActor',session_user,'version',current_setting('server_version_num')::integer,'encoding',getdatabaseencoding(),'replication',current_setting('session_replication_role'),'backendPid',pg_backend_pid(),'backendStart',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'readOnly',current_setting('transaction_read_only')='on'),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations),
 'pending',(SELECT jsonb_build_object('appOid',b."applicationRoleOid"::text,'fileCallerOids',(SELECT jsonb_agg(v::text ORDER BY v) FROM unnest(b."fileCallerOids") q(v)),'databaseOid',b."databaseOid"::text,'namespaceOid',b."anchorNamespaceOid"::text,'ownerOid',b."anchorOwnerOid"::text,'relationOid',b.tableoid::oid::text,'sha256',encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex')) FROM public.jg_contract_direct_pending_binding_v1 b WHERE b."protocolVersion"=1),
 'appTablePrivileges',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'object',x.object,'objectOid',x.oid::text,'privilege',x.privilege,'grantable',x.grantable) ORDER BY x.kind COLLATE "C",x.object COLLATE "C",x.privilege COLLATE "C"),'[]'::jsonb) FROM (
 SELECT 'table' AS kind,c.relname::text AS object,c.oid,v.privilege,has_table_privilege((p->>'appOid')::oid,c.oid,v.privilege||' WITH GRANT OPTION') AS grantable FROM pg_class c CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege) WHERE c.relnamespace=to_regnamespace('public') AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege((p->>'appOid')::oid,c.oid,v.privilege)
 UNION ALL SELECT 'sequence',c.relname::text,c.oid,v.privilege,has_sequence_privilege((p->>'appOid')::oid,c.oid,v.privilege||' WITH GRANT OPTION') FROM pg_class c CROSS JOIN (VALUES('SELECT'),('USAGE'),('UPDATE')) v(privilege) WHERE c.relnamespace=to_regnamespace('public') AND c.relkind='S' AND has_sequence_privilege((p->>'appOid')::oid,c.oid,v.privilege)) x),
 'routines',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',f.proname::text,'signature',x.r->>'signature','oid',f.oid::text,'ownerOid',f.proowner::text,'namespaceOid',f.pronamespace::text,
 'bodySha256',encode(sha256(convert_to(f.prosrc,'UTF8')),'hex'),'kind',f.prokind,'language',l.lanname,'returnTypeOid',f.prorettype::text,'securityDefiner',f.prosecdef,'volatility',f.provolatile,'parallel',f.proparallel,'strict',f.proisstrict,'returnsSet',f.proretset,'leakproof',f.proleakproof,
 'inputTypes',ARRAY(SELECT t::text FROM unnest(f.proargtypes::oid[]) WITH ORDINALITY q(t,n) ORDER BY n),'inputNames',f.proargnames,'inputModes',f.proargmodes::text[],'allTypes',CASE WHEN f.proallargtypes IS NULL THEN NULL ELSE ARRAY(SELECT t::text FROM unnest(f.proallargtypes) WITH ORDINALITY q(t,n) ORDER BY n) END,'defaults',f.pronargdefaults,'variadicOid',f.provariadic::text,'supportOid',f.prosupport::oid::text,'config',f.proconfig)
 ORDER BY (x.r->>'signature') COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements(p->'routines') x(r) LEFT JOIN pg_proc f ON f.oid=to_regprocedure(x.r->>'signature') LEFT JOIN pg_language l ON l.oid=f.prolang),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',x.r->>'table','name',t.tgname::text,'signature',x.r->>'signature','oid',t.oid::text,'relationOid',t.tgrelid::text,'routineOid',t.tgfoid::text,'type',t.tgtype,'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'internal',t.tgisinternal,'condition',t.tgqual IS NOT NULL,'args',encode(t.tgargs,'hex'),'columns',ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY q(num,n) JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=q.num ORDER BY n))
 ORDER BY (x.r->>'table') COLLATE "C",(x.r->>'name') COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements(p->'triggers') x(r) LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass(format('public.%I',x.r->>'table')) AND t.tgname=x.r->>'name'),
 'app',(SELECT jsonb_build_object('oid',r.oid::text,'name',r.rolname,'login',r.rolcanlogin,'limit',r.rolconnlimit,'passwordAbsent',r.rolpassword IS NULL,'superuser',r.rolsuper,'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'memberships',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid),'createSchema',has_schema_privilege(r.oid,'public','CREATE')) FROM pg_authid r WHERE r.oid=(p->>'appOid')::oid),
 'roleSha256',(SELECT encode(sha256(convert_to(jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_authid r),'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]'::jsonb) FROM pg_auth_members m))::text,'UTF8')),'hex')),
 'catalogSha256',__CATALOG__,
 'protectedAclSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(kind,object_oid::text,attnum,grantor::text,grantee::text,privilege_type,is_grantable) ORDER BY kind,object_oid,attnum,grantor,grantee,privilege_type)::text,'[]'),'UTF8')),'hex') FROM acl_rows g WHERE NOT EXISTS(SELECT FROM target_columns t WHERE t.kind=g.kind AND t.object_oid=g.object_oid AND t.attnum=g.attnum AND t.role_oid=g.grantee AND t.privilege=g.privilege_type AND g.grantor=(p->'identity'->>'actorOid')::oid AND NOT g.is_grantable)),
 'bindings',(SELECT jsonb_agg(jsonb_build_object('name',name,'oid',oid,'owner',owner,'kind',kind,'persistence',persistence,'rls',rls,'forceRls',force_rls,'rows',rows) ORDER BY name COLLATE "C") FROM binding_rows),
 'targets',(SELECT jsonb_agg(jsonb_build_object('kind',t.kind,'object',t.object,'member',t.member,'privilege',t.privilege,'roleOid',t.role_oid::text,'objectOid',t.object_oid::text,'attnum',t.attnum,'typeOid',t.type_oid,'catalogXmin',t.catalog_xmin,
 'effective',CASE WHEN t.kind='function' THEN has_function_privilege(t.role_oid,t.object_oid,'EXECUTE') WHEN t.kind='table' THEN has_table_privilege(t.role_oid,t.object_oid,t.privilege) ELSE has_column_privilege(t.role_oid,t.object_oid,t.attnum,t.privilege) END,
 'grantable',CASE WHEN t.kind='function' THEN has_function_privilege(t.role_oid,t.object_oid,'EXECUTE WITH GRANT OPTION') WHEN t.kind='table' THEN has_table_privilege(t.role_oid,t.object_oid,t.privilege||' WITH GRANT OPTION') ELSE has_column_privilege(t.role_oid,t.object_oid,t.attnum,t.privilege||' WITH GRANT OPTION') END,
 'direct',(SELECT coalesce(jsonb_agg(jsonb_build_array(grantor::text,grantee::text,privilege_type,is_grantable) ORDER BY grantor,grantee,privilege_type),'[]'::jsonb) FROM acl_rows g WHERE g.kind=t.kind AND g.object_oid=t.object_oid AND g.attnum=t.attnum AND g.grantee=t.role_oid AND g.privilege_type=t.privilege)) ORDER BY t.kind COLLATE "C",t.object COLLATE "C",t.member COLLATE "C",t.privilege COLLATE "C",t.role_oid) FROM target_columns t),
 'required',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',q.key,'objectOid',c.oid::text,'attnum',v.attnum,'typeOid',v.atttypid::text,'effective',has_column_privilege((p->>'appOid')::oid,c.oid,v.attnum,q.privilege)) ORDER BY q.key COLLATE "C"),'[]'::jsonb) FROM required q LEFT JOIN pg_class c ON c.oid=to_regclass(format('public.%I',q.object)) LEFT JOIN pg_attribute v ON v.attrelid=c.oid AND v.attname=q.member AND v.attnum>0 AND NOT v.attisdropped),
 'locks',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',v,'effective',has_any_column_privilege((p->>'appOid')::oid,to_regclass(format('public.%I',v)),'UPDATE')) ORDER BY v COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements_text(p->'locks') q(v)),
 'writeXid',pg_current_xact_id_if_assigned()::text,'commitStatus',CASE WHEN p->>'phase'='committed' THEN pg_xact_status((p->>'installXid')::xid8) END) AS result
 FROM cfg CROSS JOIN pg_database d JOIN pg_stat_activity a ON a.datid=d.oid WHERE d.datname=current_database() AND a.pid=pg_backend_pid()`
 .replace('__CATALOG__',catalogSql());
}
function catalogSql(){
 return `(SELECT encode(sha256(convert_to(jsonb_build_object(
 'routines',(SELECT jsonb_agg(jsonb_build_array(f.oid::text,f.proowner::text,f.pronamespace::text,f.prokind,f.prosecdef,f.proleakproof,f.proisstrict,f.proretset,f.provolatile,f.proparallel,f.pronargs,f.pronargdefaults,f.prorettype::text,f.proargtypes::text,f.proallargtypes,f.proargmodes,f.proargnames,f.proconfig,encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')) ORDER BY f.oid) FROM pg_proc f WHERE f.pronamespace=to_regnamespace('public')),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid::text,c.relowner::text,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,(SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid::text,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace=to_regnamespace('public')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=to_regnamespace('public')),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(k.oid::text,k.conrelid::text,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,false)) ORDER BY k.oid) FROM pg_constraint k WHERE k.connamespace=to_regnamespace('public')),
 'defaultAcls',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.oid),'[]'::jsonb) FROM pg_default_acl k)
 )::text,'UTF8')),'hex'))`;
}
function readSql(c,stage,phase,xid=null){return `-- local-tail ${stage} ${phase}\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;\n${projection(c,stage,phase,xid)};\nROLLBACK;\n`;}
function validateRow(input,c,stage,phase,prior){
 const row=frozen(input),cfg=config(c,stage,phase);keys(row,['scope','identity','ledger','pending','app','routines','triggers','appTablePrivileges','roleSha256','catalogSha256','protectedAclSha256','bindings','targets','required','locks','writeXid','commitStatus']);
 need(equal(row.scope,{stage,phase,nonce:c.plan.nonce,runId:c.plan.runId,sourceSha256:FULL}));
 const id=row.identity;keys(id,['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier','actor','sessionActor','version','encoding','replication','backendPid','backendStart','readOnly']);
 for(const key of ['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier'])need(id[key]===c.plan[key]);
 need(id.actor==='jiangkong'&&id.sessionActor===id.actor&&id.version>=160000&&id.version<170000&&Number.isInteger(id.version)&&id.encoding==='UTF8'&&id.replication==='origin'&&id.readOnly===(phase!=='staged')&&Number.isInteger(id.backendPid)&&id.backendPid>0&&id.backendPid<=2147483647&&typeof id.backendStart==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(id.backendStart)&&Number.isFinite(Date.parse(id.backendStart))&&new Date(Date.parse(id.backendStart)).toISOString().slice(0,19)===id.backendStart.slice(0,19));
 need(Array.isArray(row.ledger));const completed=[];
 for(const item of row.ledger){keys(item,['name','sha256','finished','rolledBack']);if(item.finished===true&&item.rolledBack===false)completed.push(item);else need(item.name===c.ledger[114].name&&item.sha256===c.ledger[114].sha256&&item.finished===false&&item.rolledBack===true);}
 need(equal(completed,c.ledger.slice(0,stage)));
 const p=row.pending;keys(p,['appOid','fileCallerOids','databaseOid','namespaceOid','ownerOid','relationOid','sha256']);
 need(p.appOid===c.setup.appOid&&equal(p.fileCallerOids,c.setup.fileCallerOids.map(String))&&p.databaseOid===c.plan.databaseOid&&p.namespaceOid===c.plan.namespaceOid&&p.ownerOid===c.plan.actorOid&&oid(p.relationOid)&&digest(p.sha256));
 need(equal(row.app,{oid:c.setup.appOid,name:c.plan.appName,login:true,limit:0,passwordAbsent:true,superuser:false,inherit:false,createRole:false,createDb:false,replication:false,bypassRls:false,memberships:0,createSchema:false}));
 need(Array.isArray(row.routines)&&row.routines.length===cfg.routines.length&&Array.isArray(row.triggers)&&row.triggers.length===cfg.triggers.length);
 const routineOids=new Map();
 row.routines.forEach((r,i)=>{
  const expected={...cfg.routines[i],oid:r.oid,ownerOid:c.plan.actorOid,namespaceOid:c.plan.namespaceOid};
  need(oid(r.oid)&&equal(r,expected));routineOids.set(r.signature,r.oid);
 });
 row.triggers.forEach((t,i)=>{
  const expected={...cfg.triggers[i],oid:t.oid,relationOid:t.relationOid,routineOid:routineOids.get(cfg.triggers[i].signature)};
  need(oid(t.oid)&&oid(t.relationOid)&&oid(t.routineOid)&&equal(t,expected));
 });
 for(const key of ['roleSha256','catalogSha256','protectedAclSha256'])need(digest(row[key]));
 const sortedBindings=cfg.bindings.slice().sort((a,b)=>a.name<b.name?-1:1);need(Array.isArray(row.bindings)&&row.bindings.length===sortedBindings.length);
 row.bindings.forEach((b,i)=>{keys(b,['name','oid','owner','kind','persistence','rls','forceRls','rows']);need(b.name===sortedBindings[i].name&&oid(b.oid)&&b.owner===c.plan.actorOid&&b.kind==='r'&&b.persistence==='p'&&b.rls===false&&b.forceRls===false&&Array.isArray(b.rows)&&b.rows.length===sortedBindings[i].count);for(const r of b.rows){keys(r,['sha256','xmin']);need(digest(r.sha256)&&txid(r.xmin)&&BigInt(r.xmin)<=0xffffffffn);}});
 const pendingBinding=row.bindings.find(b=>b.name==='jg_contract_direct_pending_binding_v1');
 need(p.relationOid===pendingBinding.oid&&p.sha256===pendingBinding.rows[0].sha256);
 const tableReads=row.bindings.filter(b=>b.name!=='jg_contract_direct_pending_binding_v1'&&(b.rows.length===1||b.name==='jg_contract_direct_archive_generation_v1')).map(b=>({kind:'table',object:b.name,objectOid:b.oid,privilege:'SELECT',grantable:false}));
 need(equal(row.appTablePrivileges,tableReads));
 const expectedTargets=[];for(const t of cfg.targets){const roles=t.recipients==='file'?[...cfg.fileCallerOids,c.setup.appOid]:[c.setup.appOid];for(const roleOid of new Set(roles))if(roleOid!==c.plan.actorOid)expectedTargets.push({kind:t.kind,object:t.table,member:t.member,privilege:t.privilege,roleOid});}
 const key=t=>JSON.stringify([t.kind,t.object,t.member,t.privilege,Number(t.roleOid)]);
 const unique=[...new Map(expectedTargets.map(t=>[key(t),t])).values()].sort((a,b)=>{for(const k of ['kind','object','member','privilege'])if(a[k]!==b[k])return a[k]<b[k]?-1:1;return Number(a.roleOid)-Number(b.roleOid);});
 need(Array.isArray(row.targets)&&row.targets.length===unique.length);
 row.targets.forEach((t,i)=>{keys(t,['kind','object','member','privilege','roleOid','objectOid','attnum','typeOid','catalogXmin','effective','grantable','direct']);need(equal(Object.fromEntries(['kind','object','member','privilege','roleOid'].map(k=>[k,t[k]])),unique[i])&&oid(t.objectOid)&&Number.isInteger(t.attnum)&&(t.kind==='column'?t.attnum>0&&t.attnum<=32767&&oid(t.typeOid):t.attnum===0&&t.typeOid==='0')&&txid(t.catalogXmin)&&BigInt(t.catalogXmin)<=0xffffffffn&&typeof t.effective==='boolean'&&t.grantable===false&&Array.isArray(t.direct)&&t.direct.every(a=>equal(a,[c.plan.actorOid,t.roleOid,t.privilege,false]))&&t.direct.length<=1);if(phase!=='before')need(t.effective===true);});
 const required=cfg.required.slice().sort();need(Array.isArray(row.required)&&row.required.length===required.length);
 row.required.forEach((r,i)=>{keys(r,['key','objectOid','attnum','typeOid','effective']);need(r.key===required[i]&&oid(r.objectOid)&&Number.isInteger(r.attnum)&&r.attnum>0&&r.attnum<=32767&&oid(r.typeOid)&&typeof r.effective==='boolean'&&(r.effective===true||phase==='before'&&matrix.windows[stage].eligible.includes(r.key)));});
 need(equal(row.locks,cfg.locks.slice().sort().map(table=>({table,effective:true}))));
 if(phase==='before')need(row.writeXid===null&&row.commitStatus===null&&prior===undefined);
 else{
  need(prior&&equal(prior.scope,{...row.scope,phase:phase==='staged'?'before':'staged'}));
  need(Array.isArray(row.routines)&&row.routines.length===cfg.routines.length&&Array.isArray(row.triggers)&&row.triggers.length===cfg.triggers.length);
 const routineOids=new Map();
 row.routines.forEach((r,i)=>{
  const expected={...cfg.routines[i],oid:r.oid,ownerOid:c.plan.actorOid,namespaceOid:c.plan.namespaceOid};
  need(oid(r.oid)&&equal(r,expected));routineOids.set(r.signature,r.oid);
 });
 row.triggers.forEach((t,i)=>{
  const expected={...cfg.triggers[i],oid:t.oid,relationOid:t.relationOid,routineOid:routineOids.get(cfg.triggers[i].signature)};
  need(oid(t.oid)&&oid(t.relationOid)&&oid(t.routineOid)&&equal(t,expected));
 });
 for(const key of ['roleSha256','catalogSha256','protectedAclSha256','ledger','pending','app','routines','triggers'])need(equal(prior[key],row[key]));
  need(equal(Object.fromEntries(Object.entries(prior.identity).filter(([k])=>!['backendPid','backendStart','readOnly'].includes(k))),Object.fromEntries(Object.entries(id).filter(([k])=>!['backendPid','backendStart','readOnly'].includes(k)))));
  need(equal(prior.required.map(({effective,...r})=>r),row.required.map(({effective,...r})=>r))&&equal(prior.locks,row.locks));
  if(phase==='staged'){
   need(txid(row.writeXid)&&row.commitStatus===null);
   const catalogKey=t=>JSON.stringify([t.kind,t.objectOid,t.attnum]);
   const touched=new Set(prior.targets.filter(t=>!t.effective).map(catalogKey));
   row.targets.forEach((t,i)=>{const before=prior.targets[i];need(equal({...t,effective:before.effective,direct:before.direct,catalogXmin:before.catalogXmin},before)&&equal(t.direct,before.effective?before.direct:[[c.plan.actorOid,t.roleOid,t.privilege,false]])&&t.catalogXmin===(touched.has(catalogKey(t))?(BigInt(row.writeXid)&0xffffffffn).toString():before.catalogXmin));});
   row.bindings.forEach((b,i)=>{const before=prior.bindings[i];need(equal({...b,rows:before.rows},before));if(stage===213&&[206,207,209].map(n=>BINDINGS.find(r=>r[0]===n)[1]).includes(b.name))need(before.rows.length===0&&b.rows.length===1&&b.rows[0].xmin===(BigInt(row.writeXid)&0xffffffffn).toString());else need(equal(b,before));});
  }else{
   need(txid(prior.writeXid)&&row.writeXid===null&&row.commitStatus==='committed'&&(id.backendPid!==prior.identity.backendPid||id.backendStart!==prior.identity.backendStart)&&equal(row.bindings,prior.bindings)&&equal(row.targets,prior.targets)&&equal(row.required,prior.required));
  }
 }
 return row;
}
function normalizePreimage(value){return {...value,identity:Object.fromEntries(Object.entries(value.identity).filter(([key])=>!['backendPid','backendStart','readOnly'].includes(key))),writeXid:null};}
function renderSupply(c,stage,before){
 verifyMaterials();validateRow(before,c,stage,'before');const observed=projection(c,stage,'before');
 let body;
 if(stage===213){
  body=fs.readFileSync(path.join(__dirname,'local-staged-tail-post213.sql'),'utf8');
  const prefix=c.migrations.slice(0,213).map(r=>`(${quote(r.name)},${quote(r.sha256)})`).join(',\n');
  need(body.split('__PREFIX213__').length===3);body=body.replaceAll('__PREFIX213__',prefix).replaceAll('__APP_LITERAL__',quote(c.plan.appName));
  const settings={database_name:c.plan.database,database_oid:c.plan.databaseOid,owner_role:'jiangkong',application_role:c.plan.appName};
  const setup=Object.entries(settings).map(([key,value])=>`PERFORM set_config('jg.post213_${key}',${quote(value)},true);`).join('\n');
  body=`DO $tail_settings$ BEGIN ${setup}\nPERFORM set_config('jg.post213_pending_sha256',${quote(before.pending.sha256)},true); END $tail_settings$;\n`+body;
 }else{
  body=`DO $tail_columns$ DECLARE tail_target record; BEGIN
   FOR tail_target IN SELECT x.* FROM jsonb_to_recordset(${quote(JSON.stringify(before.targets.filter(t=>!t.effective)))}::jsonb)
    AS x(kind text,object text,member text,privilege text,"roleOid" text,"objectOid" text,attnum integer,"typeOid" text,"catalogXmin" text,effective boolean,grantable boolean,direct jsonb)
   LOOP
    IF tail_target.kind<>'column' OR tail_target."roleOid"<>${quote(c.setup.appOid)} OR tail_target.privilege NOT IN ('SELECT','UPDATE')
    THEN RAISE EXCEPTION 'local tail target changed'; END IF;
    EXECUTE format('GRANT %s (%I) ON TABLE public.%I TO %I',tail_target.privilege,tail_target.member,tail_target.object,${quote(c.plan.appName)});
   END LOOP;
  END $tail_columns$;`;
 }
 const exclusive=stage===213?['jg_contract_direct_review_retention_binding_v1','jg_contract_direct_archive_binding_v1','jg_contract_direct_archive_retention_binding_v1']: [...new Set(targets(stage).map(t=>t.table))];
 const shared=stage===213?['jg_contract_direct_pending_binding_v1','Contract','ContractVersion','Project','ContractEconomicReview','ContractEconomicReviewFileReference','FileObject','ContractArchiveFile','ContractArchiveEvidenceFile','ContractDraftAttachment','PaymentTermsVersion','PaymentTermsStage','ProjectAffiliateAssignment','OperatingFact','OperatingImpactEntry']: [...new Set([...matrix.windows[stage].required.map(x=>x.split('/')[0]),...config(c,stage,'before').bindings.map(x=>x.name)])].filter(x=>!exclusive.includes(x));
 const relation=name=>'public."'+name.replaceAll('"','""')+'"';
 const locks=`LOCK TABLE ${exclusive.slice().sort().map(relation).join(',')} IN ACCESS EXCLUSIVE MODE;\nLOCK TABLE ${shared.slice().sort().map(relation).join(',')} IN SHARE MODE;`;
 const script=`-- local-tail ${stage} supply\nBEGIN ISOLATION LEVEL SERIALIZABLE;\nSET LOCAL search_path=pg_catalog,pg_temp;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='20s';\nLOCK TABLE public._prisma_migrations IN SHARE MODE;\n${locks}
 DO $tail_preimage$ DECLARE tail_observed jsonb; BEGIN
 SELECT q.result INTO STRICT tail_observed FROM (${observed}) q;
 tail_observed:=jsonb_set(tail_observed,'{identity}',tail_observed->'identity'-'backendPid'-'backendStart'-'readOnly');
 tail_observed:=jsonb_set(tail_observed,'{writeXid}','null'::jsonb);
 IF tail_observed IS DISTINCT FROM ${quote(JSON.stringify(normalizePreimage(before)))}::jsonb THEN RAISE EXCEPTION 'local tail preimage changed'; END IF;
 PERFORM pg_current_xact_id();
 END $tail_preimage$;
 ${body}
 ${projection(c,stage,'staged')};
 COMMIT;\n`;
 need(Buffer.byteLength(script)<=2*1024*1024&&!script.includes('\0'));return script;
}
const failures=new WeakMap();
function localTailFailureDiagnostic(error){return failures.get(error)??null;}
function createLocalTailQualification(input,ports){
 const c=context(input);need(ports&&!types.isProxy(ports)&&Object.getPrototypeOf(ports)===Object.prototype);
 const ds=Object.getOwnPropertyDescriptors(ports);need(equal(Reflect.ownKeys(ds).sort(),['read','write'])&&Object.values(ds).every(d=>Object.hasOwn(d,'value')&&typeof d.value==='function'&&!types.isProxy(d.value)));
 const read=ds.read.value,write=ds.write.value;let next=0,stopped=false,busy=false;
 return Object.freeze({async qualify(stage){
  if(stopped||busy||WINDOWS[next]!==stage){stopped=true;throw new Error('LOCAL_MIGRATION_TAIL_QUALIFICATION');}busy=true;
  let phase='BEFORE',kind='NODE_PROOF';
  try{
   const beforeSql=readSql(c,stage,'before');kind='RESOURCE_PORT';const beforeData=await read(`tail${stage}-before`,beforeSql);kind='NODE_PROOF';need(!stopped);
   const before=validateRow(beforeData,c,stage,'before');
   phase='SUPPLY';const supplySql=renderSupply(c,stage,before);kind='RESOURCE_PORT';const stagedData=await write(`tail${stage}-supply`,supplySql);kind='NODE_PROOF';need(!stopped);
   const staged=validateRow(stagedData,c,stage,'staged',before);
   phase='READBACK';const afterSql=readSql(c,stage,'committed',staged.writeXid);kind='RESOURCE_PORT';const afterData=await read(`tail${stage}-readback`,afterSql);kind='NODE_PROOF';need(!stopped);
   const after=validateRow(afterData,c,stage,'committed',staged);
   next++;return Object.freeze({status:'LOCAL_TECHNICAL_TAIL_COMMIT_READBACK',stage,writeXid:staged.writeXid,readerPid:after.identity.backendPid,executionAllowed:false,nativeAdmission:false});
  }catch(error){
   stopped=true;
   // Only source-created fixed diagnostics are projected, never Error.message/SQL.
   if(error&&!types.isProxy(error)){
    const declared=Object.getOwnPropertyDescriptor(error,'localMigrationFailureKind');
    if(declared&&Object.hasOwn(declared,'value')&&['RESOURCE_PORT','NODE_PROOF'].includes(declared.value))kind=declared.value;
   }
   const diagnostic=Object.freeze({stage:`TAIL${stage}_${phase}`,kind});
   const failure=new Error(`LOCAL_MIGRATION_${diagnostic.stage}_${kind}`);failures.set(failure,diagnostic);throw failure;
  }finally{busy=false;}
 }});
}
module.exports={createLocalTailQualification,localTailFailureDiagnostic};
