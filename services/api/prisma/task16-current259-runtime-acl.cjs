'use strict';

const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {types} = require('node:util');
const {loadCurrent259CatalogMaterial,renderCurrent259CatalogRead} = require('./task16-current259-catalog.cjs');
const {renderCurrent259DatabasePrivileges} = require('./task16-current259-database-privileges.cjs');
const {identityBody,versionGuardBody,referenceGuardBody,functionProofSql,referenceAbsentSql} = require('./task16-registered-access-check.cjs');

const CODE='TASK16_CURRENT259_RUNTIME_ACL';
const OWNER='jg_task01_owner';
const VERSION='jg_task16_runtime_version_read_only';
const REFERENCE='jg_task16_runtime_reference_read_only';
const IDENTITY='jg_task01_connection_identity';
const READER='public.jg_read_registered_payment_impacts(text,text,text,text,text)';
const LINEAGE_MIGRATION='20260828080000_pol13b_payer_authority_and_relation_guards';
const LINEAGE_MIGRATION_SHA='9d7aae81f62752499e0be7acb487116eab846bf12e5792291d9bf42b1f15f067';
const LINEAGE_BODY_SHA='4f58454305ef953353959c192ea13d7c82567b48219b5f8a4ff5e132b2cb218e';
const ops=['select','insert','update','references'];
const need=condition=>{if(!condition)throw new Error(CODE);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const oid=value=>typeof value==='string'&&/^[1-9][0-9]{0,9}$/u.test(value)&&Number(value)<=0xffffffff;
const compare=(a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0;

function snapshot(value){
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const fields=Object.getOwnPropertyDescriptors(value);
 need(Reflect.ownKeys(fields).every(k=>typeof k==='string'&&Object.hasOwn(fields[k],'value')));
 if(Array.isArray(value)){
  need(Object.keys(fields).length===fields.length.value+1);
  return Array.from({length:fields.length.value},(_,i)=>{need(fields[i]);return snapshot(fields[i].value);});
 }
 need(Object.getPrototypeOf(value)===Object.prototype);
 return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,snapshot(v.value)]));
}
function fixedJson(name,expected){
 const bytes=readFileSync(path.join(__dirname,name));need(hash(bytes)===expected);
 return JSON.parse(bytes);
}
function matrix(plan){
 const columns=[],functions=[],other=[];
 for(const role of [plan.runtime,plan.observer]){
  for(const table of role.tables)for(const op of ops){
   for(const column of table[op]??[])columns.push([role.role,'column',table.table,column,op.toUpperCase(),false]);
  }
  if(role.technicalAuthRateLimitDelete)columns.push([role.role,'table','AuthRateLimit','','DELETE',false]);
  for(const signature of role.functions)functions.push([role.role,'function',signature,'','EXECUTE',false]);
  other.push([role.role,'schema','public','','USAGE',false]);
 }
 return {columns:columns.sort(compare),functions:functions.sort(compare),direct:[...columns,...functions,...other]};
}
function roleGrantSql(plan){
 const statements=[];
 for(const role of [plan.runtime,plan.observer]){
  const name=identifier(role.role);
  statements.push(`GRANT USAGE ON SCHEMA public TO ${name};`);
  for(const table of role.tables)for(const op of ops){
   const columns=table[op]??[];
   if(columns.length)statements.push(`GRANT ${op.toUpperCase()} (${columns.map(identifier).join(', ')}) ON TABLE public.${identifier(table.table)} TO ${name};`);
  }
  if(role.technicalAuthRateLimitDelete)statements.push(`GRANT DELETE ON TABLE public."AuthRateLimit" TO ${name};`);
  for(const signature of role.functions)statements.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${name};`);
 }
 return statements.join('\n');
}
function guardSql(lockOnlyGuards){
 const targets=[{table:'ContractVersion',trigger:VERSION,routine:VERSION},...lockOnlyGuards.map(item=>({...item,routine:REFERENCE}))];
 return `CREATE FUNCTION public.${IDENTITY}()
RETURNS TABLE("loginRole" text,"databaseOid" text,"systemIdentifier" text,"backendPid" integer,tls boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $identity$${identityBody}$identity$;
CREATE FUNCTION public.${VERSION}() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $version_guard$${versionGuardBody}$version_guard$;
CREATE FUNCTION public.${REFERENCE}() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $reference_guard$${referenceGuardBody}$reference_guard$;
REVOKE EXECUTE ON FUNCTION public.${IDENTITY}(), public.${VERSION}(), public.${REFERENCE}() FROM PUBLIC;
${targets.map(({table,trigger,routine})=>`CREATE TRIGGER ${identifier(trigger)} BEFORE UPDATE ON public.${identifier(table)}
FOR EACH ROW EXECUTE FUNCTION public.${routine}();
ALTER TABLE public.${identifier(table)} ENABLE ALWAYS TRIGGER ${identifier(trigger)};`).join('\n')}`;
}
function exactDirectSql(direct,identity,after){
 const expected=`SELECT r.oid AS grantee, CASE q.kind
    WHEN 'function' THEN to_regprocedure(q.object)::oid WHEN 'schema' THEN n.oid ELSE c.oid END AS object_oid,
    coalesce(a.attnum,0)::integer AS member, q.kind, q.privilege,
    CASE q.kind WHEN 'function' THEN f.proowner WHEN 'schema' THEN n.nspowner ELSE c.relowner END AS grantor,
    false AS grantable
  FROM jsonb_array_elements(${json(direct)}) x(item)
  CROSS JOIN LATERAL (SELECT item->>0 AS role_name,item->>1 AS kind,item->>2 AS object,item->>3 AS column_name,item->>4 AS privilege) q
  JOIN pg_roles r ON r.rolname=q.role_name
  LEFT JOIN pg_namespace n ON q.kind='schema' AND n.nspname=q.object
  LEFT JOIN pg_class c ON q.kind IN ('column','table') AND c.oid=to_regclass(format('public.%I',q.object))
  LEFT JOIN pg_attribute a ON q.kind='column' AND a.attrelid=c.oid AND a.attname=q.column_name AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_proc f ON q.kind='function' AND f.oid=to_regprocedure(CASE WHEN q.kind='function' THEN q.object END)`;
 return `(WITH expected AS (${expected}),
  expanded AS (
   SELECT c.oid AS object_oid,0 AS member,CASE WHEN c.relkind='S' THEN 'sequence' ELSE 'table' END AS kind,a.*
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.relnamespace=${identity.namespaceOid}::oid
   UNION ALL SELECT c.oid,a.attnum,'column',g.* FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
    CROSS JOIN LATERAL aclexplode(a.attacl) g WHERE c.relnamespace=${identity.namespaceOid}::oid AND a.attnum>0 AND NOT a.attisdropped
   UNION ALL SELECT p.oid,0,'function',a.* FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace=${identity.namespaceOid}::oid
   UNION ALL SELECT n.oid,0,'schema',a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.oid=${identity.namespaceOid}::oid
   UNION ALL SELECT t.oid,0,'type',a.* FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a WHERE t.typnamespace=${identity.namespaceOid}::oid
  ), actual AS (
   SELECT grantee,object_oid,member,kind,privilege_type AS privilege,grantor,is_grantable AS grantable FROM expanded
   WHERE grantee IN (${identity.runtimeOid}::oid,${identity.observerOid}::oid)
  ) SELECT NOT EXISTS(SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ${after?'AND NOT EXISTS(SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)':''})`;
}
function catalogQuery(source,identity,nonce){
 const prefix='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;\n';
 const suffix=';\n\nROLLBACK;\n';
 const text=renderCurrent259CatalogRead({source,identity,nonce,phase:'before'});
 need(text.startsWith(prefix)&&text.endsWith(suffix));
 return text.slice(prefix.length,-suffix.length);
}
function proofSql(plan,legacy,baseline,ledger){
 const signatures=new Set(plan.runtime.functions.map(s=>s.toLowerCase()));
 const [lineage]=baseline.functionProofs;
 need(baseline.functionProofs.length===1&&lineage.signature==='public.assert_inter_entity_relationship_lineage(text,text)'&&
  lineage.source===`services/api/prisma/migrations/${LINEAGE_MIGRATION}/migration.sql`&&
  ledger.find(row=>row.name===LINEAGE_MIGRATION)?.sha256===LINEAGE_MIGRATION_SHA&&hash(lineage.body)===LINEAGE_BODY_SHA);
 // The historical baseline only attests the body. The registered checker also
 // needs the catalog attributes from this migration's CREATE FUNCTION.
 const lineageProof={...lineage,bodySha256:LINEAGE_BODY_SHA,language:'plpgsql',strict:false,volatility:'v',
  parallel:'u',returnType:'void',returnsSet:false,searchPath:null,
  interface:{argumentNames:['p_settlement_case_id','p_payment_execution_id'],inputArgumentTypes:['text','text'],
   allArgumentTypes:null,argumentModes:null,defaultArgumentCount:0,variadicType:null,kind:'f',leakproof:false,support:null}};
 const proofs=[...legacy.functionProofs,lineageProof].filter(row=>signatures.has(row.signature.toLowerCase()));
 need(proofs.length===plan.runtime.functions.length-2);
 return proofs.map(row=>[plan.runtime.functions.findIndex(signature=>signature.toLowerCase()===row.signature.toLowerCase()),
  functionProofSql({functionProofs:[row]})]);
}
function beforeSql(identity,material,legacy,direct){
 const triggerNames=[VERSION,...legacy.lockOnlyGuards.map(row=>row.trigger)].map(literal).join(',');
 const required=[IDENTITY,VERSION].map(name=>`to_regprocedure('public.${name}()') IS NOT NULL`).join(' OR ');
 return `DO $current259_runtime_acl_before$
BEGIN
 IF current_user IS DISTINCT FROM '${OWNER}' OR session_user IS DISTINCT FROM current_user
  OR current_user::regrole::oid <> 10 OR current_database() IS DISTINCT FROM ${literal(identity.database)}
  OR to_regnamespace('public')::oid IS DISTINCT FROM ${identity.namespaceOid}::oid
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
  OR current_setting('transaction_isolation') <> 'serializable' OR current_setting('transaction_read_only') <> 'off'
  OR current_setting('session_replication_role') <> 'origin'
  OR (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)
    ORDER BY migration_name COLLATE "C") FROM public._prisma_migrations) IS DISTINCT FROM ${json(material.ledger)}
  OR ${required} OR NOT (${referenceAbsentSql(legacy)}) OR to_regprocedure(${literal(READER)}) IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN (${triggerNames}))
  OR NOT ${exactDirectSql(direct,identity,false)} THEN
   RAISE EXCEPTION '${CODE}_PREIMAGE';
 END IF;
END $current259_runtime_acl_before$;`;
}
function helperAclSql(identity){
 return `NOT EXISTS(SELECT 1 FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid IN ('public.${IDENTITY}()'::regprocedure,'public.${VERSION}()'::regprocedure,'public.${REFERENCE}()'::regprocedure)
    AND (a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'
      OR (a.grantee<>p.proowner AND (p.oid<>'public.${IDENTITY}()'::regprocedure
        OR a.grantee NOT IN (${identity.runtimeOid}::oid,${identity.observerOid}::oid) OR a.is_grantable))))
 AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid='public.${IDENTITY}()'::regprocedure AND p.prokind='f' AND l.lanname='sql' AND p.provolatile='s'
     AND p.proretset AND p.prorettype='record'::regtype AND p.proargnames=ARRAY['loginRole','databaseOid','systemIdentifier','backendPid','tls']
     AND p.proallargtypes=ARRAY['text'::regtype,'text'::regtype,'text'::regtype,'integer'::regtype,'boolean'::regtype]::oid[]
     AND p.proargmodes=ARRAY['t','t','t','t','t']::"char"[])
 AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid='public.${VERSION}()'::regprocedure AND p.prokind='f' AND l.lanname='plpgsql'
     AND p.provolatile='v' AND NOT p.proretset AND p.prorettype='trigger'::regtype)
 AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   JOIN pg_depend dep ON dep.classid='pg_proc'::regclass AND dep.objid=p.oid AND dep.objsubid=0
    AND dep.refclassid='pg_extension'::regclass AND dep.refobjsubid=0 AND dep.deptype='e'
   JOIN pg_extension e ON e.oid=dep.refobjid
   WHERE p.oid='public.digest(bytea,text)'::regprocedure AND p.prokind='f' AND l.lanname='c'
     AND p.proowner=10 AND p.prosrc='pg_digest' AND p.probin='$libdir/pgcrypto' AND NOT p.prosecdef
     AND p.provolatile='i' AND p.proparallel='s' AND p.proisstrict AND NOT p.proretset
     AND p.prorettype='bytea'::regtype AND e.extname='pgcrypto' AND e.extnamespace=${identity.namespaceOid}::oid)`;
}
function postSql(query,identity,expect,dbExpected,proof,ledger,relationOwners,readOnly){
 const functionPairs=expect.functions.map(([role,,signature])=>[role,signature]);
 const roleTests=[['jg_task01_observer',identity.observerOid,true],['jg_task01_runtime',identity.runtimeOid,false]].map(([name,id,readOnlyDefault])=>
  `EXISTS(SELECT 1 FROM jsonb_array_elements(report->'roles') r WHERE r @> ${json({oid:id,name,superuser:false,inherit:false,canLogin:true,createRole:false,createDb:false,replication:false,bypassRls:false,connectionLimit:name==='jg_task01_runtime'&&identity.runtimeProfile==='CURRENT259_TWO_RUNTIME_LANES'?2:1,memberships:0,createSchema:false,usageSchema:true,connectDatabase:true,createDatabaseSchema:false,temporary:false,otherDatabases:[],readOnlyDefault})})`).join(' AND ');
 const checks=[
  ['IDENTITY',`report->'identity' @> ${json({database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,ownerOid:identity.ownerOid,systemIdentifier:identity.systemIdentifier,currentRole:OWNER,sessionRole:OWNER,tls:true,replication:'origin',readOnly})}`],
  ['ROLE_ARRAY',`jsonb_typeof(report->'roles')='array'`],
  ['ROLES',`jsonb_array_length(report->'roles')=3 AND (${roleTests})`],
  ['LEDGER',`report->'ledger' = ${json(ledger)}`],
  ['GUARDS',`report->'guardsVerified' = 'true'::jsonb`],
  ['READER',`report->'reader' = 'null'::jsonb`],
  ['CAPABILITIES',`report->'capabilities' = ${json(expect.columns)}`],
  ['FUNCTIONS',`(SELECT jsonb_agg(jsonb_build_array(f->>0,f->>1) ORDER BY (f->>0) COLLATE "C",(f->>1) COLLATE "C") FROM jsonb_array_elements(report->'functions') f
       WHERE f->>2 IS NOT NULL AND f->3='true' AND f->4='false') = ${json(functionPairs)}`],
  ['RELATIONS',`NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'relations') r
      WHERE r->>'oid' IS NULL OR r->>'kind' IS DISTINCT FROM 'r' OR r->'rls' IS DISTINCT FROM 'false'::jsonb OR r->'forceRls' IS DISTINCT FROM 'false'::jsonb
       OR r->>'owner' IS DISTINCT FROM coalesce(${json(relationOwners)}->>(r->>'table'),'${OWNER}'))`],
  ['DATABASE_ACL',`(SELECT jsonb_agg(jsonb_build_object('oid',d.oid::text,'name',d.datname,'owner',d.datdba::text,'acl',
       (SELECT jsonb_agg(jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
        ORDER BY a.grantor,a.grantee,a.privilege_type COLLATE "C") FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a)) ORDER BY d.datname COLLATE "C") FROM pg_database d) = ${json(dbExpected)}`],
  ...proof.map(([index,sql])=>['FUNCTION_PROOF_'+index,sql]),
  ['HELPERS',helperAclSql(identity)],
  ['DIRECT_ACL',exactDirectSql(expect.direct,identity,true)],
  ['GRANT_OPTION',`NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN (VALUES (${identity.runtimeOid}::oid),(${identity.observerOid}::oid)) r(oid)
    WHERE p.pronamespace=${identity.namespaceOid}::oid AND has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION'))`]
 ];
 const phase=readOnly?'READBACK':'WRITER';
 return `DO $current259_runtime_acl_after$
DECLARE report jsonb;
BEGIN
 SELECT result INTO STRICT report FROM (${query}) witness;
 ${checks.map(([name,sql],index)=>`${index===0?'IF':'ELSIF'} (${sql}) IS NOT TRUE THEN
   RAISE EXCEPTION '${CODE}_POSTIMAGE' USING DETAIL = '${CODE}_${phase}_${name}';`).join('\n ')}
 END IF;
END $current259_runtime_acl_after$;`;
}

// The future caller owns the role claim, seven-fragment completion and the
// SERIALIZABLE owner transaction. This renderer has no execution authority.
function renderCurrent259RuntimeAcl(witness,provisioned,nonce){
 return renderRuntimeAcl(witness,provisioned,nonce,false);
}
function renderCurrent259CompetitionRuntimeAcl(witness,provisioned,nonce){
 return renderRuntimeAcl(witness,provisioned,nonce,true);
}
function renderCurrent259VoucherRuntimeAcl(witness,provisioned,nonce){
 const {current259VoucherAcl,voucherAccessPlan,profileName}=require('./task16-current259-voucher-acl.cjs');
 return renderRuntimeAcl(witness,provisioned,nonce,true,{profile:current259VoucherAcl(),voucherAccessPlan,profileName});
}
function renderRuntimeAcl(witness,provisioned,nonce,competition,voucher){
 provisioned=snapshot(provisioned);witness=snapshot(witness);
 need(typeof nonce==='string'&&/^[a-f0-9]{64}$/u.test(nonce));
 const profile=witness.profile;
 need(profile?.profile==='TASK16_CURRENT259_SOURCE_V1'&&profile.candidateSha===witness.candidateSha&&
  profile.sealSha256===witness.sourceSealSha256&&Array.isArray(profile.ledger));
 const source={candidateSha:witness.candidateSha,sealSha256:witness.sourceSealSha256,schemaSha256:profile.schemaSha256,
  migrations:profile.ledger.map(row=>({path:`services/api/prisma/migrations/${row.name}/migration.sql`,sha256:row.sha256}))};
 const material=loadCurrent259CatalogMaterial(source);
 need(provisioned.status==='CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'&&provisioned.sourceSha===material.sourceSha&&Array.isArray(provisioned.roles));
 const plan=voucher?voucher.voucherAccessPlan(material.accessPlan):material.accessPlan;
 const findRole=name=>{const matches=provisioned.roles.filter(role=>role.name===name);need(matches.length===1&&oid(matches[0].oid));return matches[0];};
 const runtime=findRole(plan.runtime.role),observer=findRole(plan.observer.role);
 if(competition)need(runtime.limit===2&&observer.limit===1);
 else need((runtime.limit===1||runtime.limit===undefined)&&(observer.limit===1||observer.limit===undefined));
 const {database,databaseOid,namespaceOid,ownerOid,systemIdentifier}=provisioned.databaseIdentity;
 const identity={runId:provisioned.runId,database,databaseOid,namespaceOid,ownerOid,systemIdentifier,
  runtimeOid:runtime.oid,observerOid:observer.oid,...(competition?{runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'}:{}),
  ...(voucher?{voucherProfile:voucher.profileName}:{})};
 const databaseAcl=renderCurrent259DatabasePrivileges(provisioned);
 const legacy=fixedJson('task16-registered-access.json','d19fe664e58659b3008ab2ef2769c6d3e421cb8504d3f98b8fd332133291b5eb');
 const baseline=fixedJson('task16-baseline-access.json','6c2ec83b104694aa2de351ab6e81757d0a3c6528b5bf0687a546fae23b48976b');
 const expect=matrix(plan),proof=proofSql(plan,legacy,baseline,material.ledger),catalog=catalogQuery(source,identity,nonce);
 const verify=readOnly=>postSql(catalog,identity,expect,databaseAcl.expected,proof,material.ledger,legacy.legacyRelationOwners,readOnly);
 const setup="SET LOCAL search_path=pg_catalog,pg_temp;\nSET LOCAL standard_conforming_strings=on;";
 const sql=[setup,...(voucher?[voucher.profile.preimageSql(legacy.functionProofs)]:
  ['LOCK TABLE public._prisma_migrations IN SHARE MODE NOWAIT;']),
  beforeSql(identity,material,legacy,expect.direct),databaseAcl.sql,guardSql(legacy.lockOnlyGuards),
  ...(voucher?[voucher.profile.guardSql]:[]),roleGrantSql(plan),verify(false)].join('\n');
 const readbackSql=['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',setup,verify(true),`${catalog};`,'ROLLBACK;'].join('\n');
 return Object.freeze({sql,witnessSql:`${catalog};`,readbackSql,publicAclStatus:'REQUIRES_FINAL_CATALOG',nativeAdmission:false,
  ...(voucher?{lockSql:voucher.profile.lockSql}:{})});
}
module.exports=Object.freeze({renderCurrent259RuntimeAcl,renderCurrent259CompetitionRuntimeAcl,renderCurrent259VoucherRuntimeAcl});
