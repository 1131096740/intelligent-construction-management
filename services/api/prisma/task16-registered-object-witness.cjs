"use strict";
const {createHash}=require("node:crypto");
const {isDeepStrictEqual}=require("node:util");
// Fixed Task16 seven-fragment DDL scope; not a generic schema attestation tool.
const TABLES=["RegisteredPaymentFunding","RegisteredFundPaymentAllocation","RegisteredPaymentEvent","RegisteredPaymentVoucher","RegisteredContractHistoryRevision","RegisteredFundAccount","FundAccountBalanceRegistration","PaymentExecution","InterEntityRelationshipEntry","OperatingFact","OperatingImpactEntry","Contract","ContractTakeover","PaymentExecutionAllocation","ContractArchiveFile","ContractArchiveEvidenceFile","ContractSealTask","ApprovalInstance","ProjectParticipatingCompany","ContractVersion","ContractDraftAttachment","FileObject","jg_contract_direct_pending_binding_v1"];
function registeredObjectWitnessSql(){
 const names=TABLES.map(name=>`'${name}'`).join(",");
 const scope=`n.nspname='public' AND c.relname IN (${names})`;
 return `pg_catalog.jsonb_build_object(
 'relations',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'ownerOid',c.relowner::text,'kind',c.relkind,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) ORDER BY c.relname),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${scope}),
 'columns',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'number',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)) ORDER BY c.relname,a.attnum),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${scope}),
 'indexes',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'indexOid',i.indexrelid::text,'definition',pg_catalog.pg_get_indexdef(i.indexrelid),'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid,false)) ORDER BY c.relname,i.indexrelid),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_index i ON i.indrelid=c.oid WHERE ${scope}),
 'constraints',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_catalog.pg_get_constraintdef(k.oid,false)) ORDER BY c.relname,k.conname),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid WHERE ${scope}),
 'triggers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'relationOid',c.oid::text,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_catalog.pg_get_triggerdef(t.oid,false),'functionOid',t.tgfoid::text,'type',t.tgtype,'columns',t.tgattr::text,'arguments',pg_catalog.encode(t.tgargs,'hex'),'when',t.tgqual::text,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred) ORDER BY c.relname,t.tgname),'[]'::jsonb) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE ${scope} AND NOT (c.relname='ApprovalInstance' AND t.tgname='jg_task16_runtime_approval_read_only' AND t.tgfoid IS NOT DISTINCT FROM pg_catalog.to_regprocedure('public.jg_task16_runtime_reference_read_only()') AND t.tgtype=19 AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND NOT t.tgdeferrable AND NOT t.tginitdeferred)))`;
}

const SCHEMA205_BINDING="jg_contract_direct_pending_binding_v1";
const SCHEMA205_RELATIONS=[SCHEMA205_BINDING,"ContractVersion","ContractDraftAttachment","FileObject"];
const SCHEMA205_ANCHOR='public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",pg_catalog.text,pg_catalog.text)';
const SCHEMA205_TRIGGERS=[
 "jg_direct_pending_binding_immutable","jg_direct_pending_version_shape",
 "jg_direct_pending_attachment_source","jg_direct_pending_attachment_exclusive","jg_direct_pending_file_retained"
];
const SCHEMA205_ROUTINES=[
 "public.jg_contract_direct_pending_binding_guard_v1()","public.jg_contract_direct_pending_version_guard_v1()",
 "public.jg_contract_direct_pending_input_v1(pg_catalog.text)","public.jg_contract_direct_pending_attachment_guard_v1()",
 "public.jg_contract_direct_pending_file_guard_v1()","public.jg_has_exclusive_file_business_binding(pg_catalog.text)",
 "public.jg_enforce_exclusive_file_business_binding()",SCHEMA205_ANCHOR
];
const literals=values=>values.map(value=>"'"+value+"'").join(",");

const SCHEMA205_DEPARSE_LOCAL="SET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL quote_all_identifiers=off;";

function schema205DeparseReadOnly(sql){
 return "BEGIN READ ONLY;\n"+SCHEMA205_DEPARSE_LOCAL+"\n"+sql+"\nROLLBACK;";
}

function schema205DeparsePremisesSql(){
 return "(pg_catalog.current_setting('quote_all_identifiers')='off' AND pg_catalog.to_regtype('text')::oid=25"
  +" AND (SELECT item.name::text FROM pg_catalog.unnest(pg_catalog.current_schemas(true)) WITH ORDINALITY item(name,ordinal)"
  +" WHERE pg_catalog.to_regnamespace(item.name::text)<>pg_catalog.pg_my_temp_schema() ORDER BY item.ordinal LIMIT 1)='pg_catalog')";
}

function schema205RelationRowsSql(){
 return "(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',c.relname,'oid',c.oid::text,'kind',c.relkind,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) ORDER BY c.relname),'[]'::jsonb) FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relname IN ("+literals(SCHEMA205_RELATIONS)+"))";
}

function schema205RelationsVerified(rows){
 return Array.isArray(rows)&&rows.length===SCHEMA205_RELATIONS.length
  &&rows.every(row=>row&&typeof row.oid==="string"&&/^[1-9][0-9]*$/u.test(row.oid)&&row.kind==="r"&&row.rowSecurity===false&&row.forceRowSecurity===false)
  &&new Set(rows.map(row=>row.oid)).size===rows.length
  &&SCHEMA205_RELATIONS.every(name=>rows.some(row=>row.table===name));
}

const enforce="pg_catalog.to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')";

function schema205EnforceConfigSql(afterSeven){
 const configuration=afterSeven?"p.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]":"p.proconfig IS NULL";
 return "EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid="+enforce+" AND "+configuration+
  " AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset AND p.provolatile='v' AND p.proparallel='u' AND p.prokind='f' AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prorettype='pg_catalog.trigger'::regtype AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')"+
  " AND p.proowner=(SELECT proowner FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('"+SCHEMA205_ANCHOR+"'))"+
  " AND pg_catalog.encode(public.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999')";
}

// The existing B5 reset handles PUBLIC and its two owned experiment roles.
// Keep every other grantee, grantor and grant option in the continuity digest.
function retainedAcl(acl){
 return "(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM pg_catalog.aclexplode("+acl+") a WHERE a.grantee<>0 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=a.grantee AND r.rolname IN ('jg_task01_runtime','jg_task01_observer')))";
}

// Track only the Schema205 physical objects through B5, the seven fragments,
// B6 and restricted clients. Finance ACL changes on older tables are separate.
function schema205WitnessSql(){
 const binding="pg_catalog.to_regclass('public."+SCHEMA205_BINDING+"')";
 const contract="pg_catalog.to_regclass('public.\"ContractVersion\"')";
 const relations=[SCHEMA205_BINDING,'"ContractVersion"','"ContractDraftAttachment"','"FileObject"'].map(name=>"pg_catalog.to_regclass('public."+name+"')").join(",");
 const routines=SCHEMA205_ROUTINES.map(name=>"pg_catalog.to_regprocedure('"+name+"')").join(",");
 const fields=[
  "'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,CASE WHEN c.oid="+binding+" THEN "+retainedAcl("coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))")+" END) ORDER BY c.oid) FROM pg_catalog.pg_class c WHERE c.oid IN ("+relations+"))",
  "'columns',(SELECT pg_catalog.jsonb_agg((pg_catalog.to_jsonb(a)-'attacl')||pg_catalog.jsonb_build_object('retainedAcl',"+retainedAcl("coalesce(a.attacl,'{}'::aclitem[])")+") ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attnum>0 AND NOT a.attisdropped AND (a.attrelid="+binding+" OR (a.attrelid="+contract+" AND a.attname='originalSignedNumber')))",
  "'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid="+binding+")",
  "'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k WHERE k.conrelid="+binding+")",
  "'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t WHERE t.tgname IN ("+literals(SCHEMA205_TRIGGERS)+"))",
  "'routines',(SELECT pg_catalog.jsonb_agg((CASE WHEN p.oid="+enforce+" THEN pg_catalog.to_jsonb(p)-'proconfig' ELSE pg_catalog.to_jsonb(p) END)-'proacl'||pg_catalog.jsonb_build_object('retainedAcl',"+retainedAcl("coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))")+") ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN ("+routines+"))",
  "'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(owner.oid,scope.namespace,scope.kind,"+retainedAcl("coalesce(d.defaclacl,CASE WHEN scope.namespace=0 THEN pg_catalog.acldefault(scope.kind,owner.oid) ELSE '{}'::aclitem[] END)")+") ORDER BY owner.oid,scope.namespace,scope.kind) FROM (SELECT DISTINCT p.proowner AS oid FROM pg_catalog.pg_proc p WHERE p.oid IN ("+routines+")) owner CROSS JOIN (VALUES (0::oid,'f'::\"char\"),(0::oid,'r'::\"char\"),(pg_catalog.to_regnamespace('public')::oid,'f'::\"char\"),(pg_catalog.to_regnamespace('public')::oid,'r'::\"char\")) scope(namespace,kind) LEFT JOIN pg_catalog.pg_default_acl d ON d.defaclrole=owner.oid AND d.defaclnamespace=scope.namespace AND d.defaclobjtype=scope.kind)"
 ];
 return "pg_catalog.encode(public.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object("+fields.join(",")+")::text,'UTF8'),'sha256'),'hex')";
}
const REGISTRY="jg_file_business_binding_columns";
const REGISTRY_ALIAS="jg_file_business_binding_columns_before_registered_payment";
const OLD_REGISTRY_BODY="d2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f";
const NEW_REGISTRY_BODY="46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3";
const REGISTRY_CONFIG=["search_path=pg_catalog, public, pg_temp"];

function schema205RegistrySql(){
 const acl=source=>`(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM pg_catalog.aclexplode(${source}) a)`;
 const routine=name=>`(SELECT pg_catalog.jsonb_build_object(
  'oid',p.oid::text,'name',p.proname,'config',p.proconfig,'rawAcl',p.proacl,'acl',${acl("coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))")},
  'definition',(pg_catalog.to_jsonb(p)-ARRAY['oid','proname','proconfig','proacl'])||pg_catalog.jsonb_build_object('pronamespace',p.pronamespace::text,'proowner',p.proowner::text),
  'shapeVerified',((p.pronamespace=stage.namespace AND p.proowner=stage.owner AND l.lanname='sql'
   AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
   AND p.provolatile='s' AND p.proparallel='s' AND p.proretset AND p.prorettype='pg_catalog.record'::regtype
   AND p.pronargs=0 AND p.proargtypes::text='' AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0 AND p.prosupport=0
   AND p.proallargtypes=ARRAY[25,25,16]::oid[] AND p.proargmodes=ARRAY['t','t','t']::"char"[]
   AND p.proargnames=ARRAY['tableName','columnName','exclusive']::text[] AND p.prosqlbody IS NULL) IS TRUE))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid=pg_catalog.to_regprocedure('public.${name}()'))`;
 const defaults=namespace=>`(SELECT pg_catalog.jsonb_build_object('oid',d.oid::text,'rawAcl',d.defaclacl,'acl',${acl("d.defaclacl")})
  FROM pg_catalog.pg_default_acl d WHERE d.defaclrole=stage.owner AND d.defaclnamespace=${namespace} AND d.defaclobjtype='f')`;
 return `(SELECT pg_catalog.jsonb_build_object('namespaceOid',stage.namespace::text,'ownerOid',stage.owner::text,
  'publicRoutine',${routine(REGISTRY)},'alias',${routine(REGISTRY_ALIAS)},'globalDefault',${defaults("0::oid")},'publicDefault',${defaults("stage.namespace")})
  FROM (SELECT pg_catalog.to_regnamespace('public')::oid AS namespace,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) AS owner) stage)`;
}

const registryOid=value=>typeof value==="string"&&/^[1-9][0-9]{0,9}$/u.test(value)&&Number(value)<=4294967295;
const registryAclKey=([grantor,grantee,privilege])=>`${grantor}/${grantee}/${privilege}`;
const rawRegistryAcl=value=>Array.isArray(value)&&value.every(item=>typeof item==="string");
function registryAclValid(value){
 return Array.isArray(value)&&value.every(row=>Array.isArray(row)&&row.length===4&&registryOid(row[0])
  &&(row[1]==="0"||registryOid(row[1]))&&row[2]==="EXECUTE"&&typeof row[3]==="boolean")
  &&new Set(value.map(registryAclKey)).size===value.length;
}
function registryDefaultValid(row){
 return row===null||(registryOid(row?.oid)&&rawRegistryAcl(row.rawAcl)&&registryAclValid(row.acl));
}
function registryRoutineValid(row,name,body,config,witness){
 return registryOid(row?.oid)&&row.name===name&&row.shapeVerified===true&&isDeepStrictEqual(row.config,config)
  &&(row.rawAcl===null||rawRegistryAcl(row.rawAcl))&&registryAclValid(row.acl)
  &&row.definition?.pronamespace===witness.namespaceOid&&row.definition.proowner===witness.ownerOid
  &&typeof row.definition.prosrc==="string"&&createHash("sha256").update(row.definition.prosrc).digest("hex")===body;
}
function registryAclEquals(left,right){
 const ordered=rows=>rows.map(row=>JSON.stringify(row)).sort();
 return isDeepStrictEqual(ordered(left),ordered(right));
}
function registryDefaultsAcl(owner){
 return [[owner,"0","EXECUTE",false],[owner,owner,"EXECUTE",false]];
}
// PG16 uses the owner's global routine ACL (or built-in default) plus schema additions.
function registryDefaultMerged(witness){
 const merged=new Map();
 for(const row of [...(witness.globalDefault?.acl??registryDefaultsAcl(witness.ownerOid)),...(witness.publicDefault?.acl??[])]){
  const key=registryAclKey(row);
  if(!merged.has(key)||row[3])merged.set(key,row);
 }
 return [...merged.values()];
}

function schema205RegistryValid(witness,ownerOid,phase){
 if(!registryOid(witness?.namespaceOid)||!registryOid(ownerOid)||witness.ownerOid!==ownerOid
  ||!registryDefaultValid(witness.globalDefault)||!registryDefaultValid(witness.publicDefault))return false;
 if(phase==="seven")return registryRoutineValid(witness.publicRoutine,REGISTRY,NEW_REGISTRY_BODY,REGISTRY_CONFIG,witness)
  &&registryRoutineValid(witness.alias,REGISTRY_ALIAS,OLD_REGISTRY_BODY,REGISTRY_CONFIG,witness)
  &&witness.publicRoutine.oid!==witness.alias.oid;
 return (phase==="first"||phase==="baseline")&&witness.alias===null
  &&registryRoutineValid(witness.publicRoutine,REGISTRY,OLD_REGISTRY_BODY,null,witness);
}

function schema205RegistryMatches(expected,observed){
 return expected!=null&&isDeepStrictEqual(expected,observed);
}

// B5's routine reset affects only these three grantees. Schema-local routine defaults are unchanged.
function schema205RegistryBaselineMatches(first,baseline,ownerOid,runtimeOid,observerOid){
 if(!schema205RegistryValid(first,ownerOid,"first")||!schema205RegistryValid(baseline,ownerOid,"baseline")
  ||!registryOid(runtimeOid)||!registryOid(observerOid))return false;
 const denied=new Set(["0",runtimeOid,observerOid]);
 const preserve=rows=>rows.filter(row=>!denied.has(row[1]));
 const old=first.publicRoutine;
 const after=baseline.publicRoutine;
 const {rawAcl,acl}=after;
 const previousDefault=first.globalDefault?.acl??registryDefaultsAcl(ownerOid);
 return first.namespaceOid===baseline.namespaceOid&&schema205RegistryMatches({...old,rawAcl,acl},after)
  &&rawAcl!==null&&registryAclEquals(preserve(old.acl),acl)&&(preserve(old.acl).length!==old.acl.length||isDeepStrictEqual(old.rawAcl,rawAcl))
  &&isDeepStrictEqual(first.publicDefault,baseline.publicDefault)&&baseline.globalDefault!==null
  &&(first.globalDefault===null||baseline.globalDefault.oid===first.globalDefault.oid)
  &&registryAclEquals(preserve(previousDefault),baseline.globalDefault.acl)
  &&(first.globalDefault===null||preserve(previousDefault).length!==previousDefault.length
   ||isDeepStrictEqual(first.globalDefault.rawAcl,baseline.globalDefault.rawAcl));
}

function schema205RegistrySevenMatches(baseline,seven,ownerOid,runtimeOid,observerOid){
 if(!schema205RegistryValid(baseline,ownerOid,"baseline")||!schema205RegistryValid(seven,ownerOid,"seven")
  ||!registryOid(runtimeOid)||!registryOid(observerOid))return false;
 const replacement=seven.publicRoutine;
 const old=baseline.publicRoutine;
 const expectedNewAcl=registryDefaultMerged(baseline);
 return baseline.namespaceOid===seven.namespaceOid
  &&isDeepStrictEqual(baseline.globalDefault,seven.globalDefault)&&isDeepStrictEqual(baseline.publicDefault,seven.publicDefault)
  &&isDeepStrictEqual({...old,name:REGISTRY_ALIAS,config:REGISTRY_CONFIG},seven.alias)
  &&isDeepStrictEqual({...old.definition,prosrc:replacement.definition.prosrc},replacement.definition)
  &&registryAclEquals(expectedNewAcl,replacement.acl)&&replacement.rawAcl!==null
  &&!replacement.acl.some(row=>["0",runtimeOid,observerOid].includes(row[1]));
}

module.exports={registeredObjectWitnessSql,schema205RegistrySql,schema205RegistryValid,schema205RegistryMatches,schema205RegistryBaselineMatches,schema205RegistrySevenMatches,SCHEMA205_DEPARSE_LOCAL,schema205DeparseReadOnly,schema205DeparsePremisesSql,schema205WitnessSql,schema205RelationRowsSql,schema205RelationsVerified,schema205EnforceConfigSql,SCHEMA205_ANCHOR,SCHEMA205_BINDING,SCHEMA205_TRIGGERS,SCHEMA205_ROUTINES};
