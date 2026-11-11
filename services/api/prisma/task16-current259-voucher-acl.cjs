'use strict';

// Fixed inputs for the payment ACL writer. This module cannot issue permits,
// apply SQL, or change the expected permissions of another payment mode.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { functionProofSql } = require('./task16-registered-access-check.cjs');

const requirementsSha256='5c5a3d9eedc61880e44f4594a53e0c9daf830aed19b014cfbde9440a15eead26';
const bytes=readFileSync(join(__dirname,'task16-current259-voucher-acl.requirements.json'));
const code='CURRENT259_VOUCHER_ACL';
const need=condition=>{if(!condition)throw new Error(code);};
need(createHash('sha256').update(bytes).digest('hex')===requirementsSha256);
const {readDelta,insertDelta,lockOnlyUpdate,routineSources}=JSON.parse(bytes);
const profileName='CURRENT259_PAYMENT_VOUCHER_V1';
const owner='jg_task01_owner', runtime='jg_task01_runtime', observer='jg_task01_observer';
const insertRoutine='jg_task16_runtime_voucher_file_insert_only';
const referenceRoutine='jg_task16_runtime_reference_read_only';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const json=value=>quote(JSON.stringify(value))+'::jsonb';

const archiveBindings=[
  'jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1',
  'jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_closure_v2',
  'jg_contract_direct_upward_execution_binding_v2'
];
const tables=Object.freeze([...new Set([...Object.keys(readDelta),...Object.keys(insertDelta),...Object.keys(lockOnlyUpdate)])]
  .sort().map(table=>Object.freeze({table,select:Object.freeze(readDelta[table]??[]),insert:Object.freeze(insertDelta[table]??[]),
    update:Object.freeze(lockOnlyUpdate[table]?[lockOnlyUpdate[table]]:[])})));
const functions=Object.freeze(routineSources.map(row=>row.signature));
const triggers=Object.freeze([
  Object.freeze({table:'PaymentExecution',name:'jg_task16_runtime_voucher_payment_no_update',routine:referenceRoutine,event:'UPDATE',type:19}),
  Object.freeze({table:'FileObject',name:'jg_task16_runtime_voucher_file_no_update',routine:referenceRoutine,event:'UPDATE',type:19}),
  Object.freeze({table:'FileObject',name:'jg_task16_runtime_voucher_file_insert',routine:insertRoutine,event:'INSERT',type:7})
]);
const insertBody=`
BEGIN
 IF session_user = 'jg_task01_runtime' AND (NEW."supersedesFileObjectId" IS NOT NULL
    OR NEW."purgeReceiptId" IS NOT NULL OR NEW."storageStatus" IS DISTINCT FROM 'active') THEN
  RAISE EXCEPTION 'CURRENT259_VOUCHER_ACL_FILE_INSERT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
`;
const guardSql=[
  `CREATE FUNCTION public.${insertRoutine}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $voucher_file_insert$${insertBody}$voucher_file_insert$;
REVOKE EXECUTE ON FUNCTION public.${insertRoutine}() FROM PUBLIC;`,
  ...triggers.map(row=>`CREATE TRIGGER ${identifier(row.name)} BEFORE ${row.event} ON public.${identifier(row.table)}
FOR EACH ROW EXECUTE FUNCTION public.${row.routine}();
ALTER TABLE public.${identifier(row.table)} ENABLE ALWAYS TRIGGER ${identifier(row.name)};`)
].join('\n');

const routineSignatures=`SELECT p.oid FROM pg_catalog.pg_proc p WHERE p.oid IN
 (${functions.map(name=>`${quote(name)}::regprocedure`).join(',')})`;
const pending='jg_contract_direct_pending_binding_v1';
const lockSql=`LOCK TABLE ${['_prisma_migrations',...archiveBindings,pending].map(name=>'public.'+name).join(', ')} IN SHARE MODE NOWAIT;`;
const archiveInactive=archiveBindings.map(name=>`NOT EXISTS(SELECT FROM public.${name})`).join('\n AND ');
const callerScope=`EXISTS(SELECT FROM public.${pending} b
  JOIN pg_catalog.pg_roles app ON app.oid=b."applicationRoleOid"
  WHERE b."protocolVersion"=1 AND b."recipeVersion"='contract-direct-pending-input-v1/1'
    AND b."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    AND b."anchorNamespaceOid"=pg_catalog.to_regnamespace('public')::oid AND b."anchorOwnerOid"=10
    AND app.rolcanlogin AND NOT app.rolsuper AND b."applicationRoleOid" NOT IN (10,${quote(runtime)}::regrole::oid,${quote(observer)}::regrole::oid)
    AND pg_catalog.cardinality(b."fileCallerOids") BETWEEN 1 AND 64
    AND NOT EXISTS(SELECT FROM pg_catalog.unnest(b."fileCallerOids") caller(oid)
      WHERE caller.oid IN (${quote(runtime)}::regrole::oid,${quote(observer)}::regrole::oid)
        OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.oid=caller.oid)))`;
const bindingSha256Sql=`(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(b)::text,'UTF8')),'hex')
 FROM public.${pending} b WHERE b."protocolVersion"=1)`;
const fixedScope=`IF current_user<>${quote(owner)} OR session_user<>current_user OR current_user::regrole::oid<>10
  OR NOT (${archiveInactive}) THEN RAISE EXCEPTION '${code}_SCOPE'; END IF;
 IF NOT (${callerScope}) THEN RAISE EXCEPTION '${code}_CONTRACT_FILE_CALLER'; END IF;`;
function voucherRoutineProof(rows){
  const indexed=new Map(rows.map(row=>[row.signature,row]));
  const proofs=routineSources.map(expected=>{
    const row=indexed.get(expected.signature);
    need(row&&row.bodySha256===expected.bodySha256&&createHash('sha256').update(row.body).digest('hex')===expected.bodySha256);
    return row;
  });
  return functionProofSql({functionProofs:proofs});
}
function voucherAccessPlan(plan){
  const runtime=plan.runtime;
  const relations=new Map(runtime.tables.map(row=>[row.table,{...row}]));
  for(const delta of tables){
    const row=relations.get(delta.table)??{table:delta.table,select:[],insert:[],update:[],references:[]};
    for(const op of ['select','insert','update']){
      const prior=row[op]??[];
      need(delta[op].every(column=>!prior.includes(column)));
      row[op]=[...prior,...delta[op]].sort();
    }
    relations.set(row.table,row);
  }
  need(functions.every(signature=>!runtime.functions.includes(signature)));
  return {...plan,runtime:{...runtime,tables:[...relations.values()],functions:[...runtime.functions,...functions]}};
}
const columnTargets=tables.flatMap(row=>['select','insert','update'].flatMap(op=>row[op].map(column=>({table:row.table,column,privilege:op.toUpperCase()}))));
const columnsSql=`SELECT e.*,c.oid,a.attnum,a.attacl FROM
 pg_catalog.jsonb_to_recordset(${json(columnTargets)}) e("table" text,"column" text,privilege text)
 LEFT JOIN pg_catalog.pg_class c ON c.relname=e."table" AND c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relkind='r'
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e."column" AND a.attnum>0 AND NOT a.attisdropped`;
const grantee=`${quote(runtime)}::regrole::oid`;
const exactAcl=(acl,privilege,after)=>`(SELECT count(*)=${after?1:0} AND
   coalesce(bool_and(g.grantor=10 AND NOT g.is_grantable),true)
   FROM pg_catalog.aclexplode(${acl}) g WHERE g.grantee=${grantee} AND g.privilege_type=${privilege})`;
function privilegeGuard(after){
  return `EXISTS(SELECT FROM (${columnsSql}) target
 WHERE target.oid IS NULL OR target.attnum IS NULL OR NOT ${exactAcl('target.attacl','target.privilege',after)})
 OR EXISTS(SELECT FROM (${routineSignatures}) target JOIN pg_catalog.pg_proc p ON p.oid=target.oid
 WHERE NOT ${exactAcl('p.proacl',"'EXECUTE'",after)})`;
}

const triggerNames=triggers.map(row=>quote(row.name)).join(',');
const guardMissing=`EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgname IN (${triggerNames}))
 OR pg_catalog.to_regprocedure('public.${insertRoutine}()') IS NOT NULL`;
const guardVerified=`EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid=pg_catalog.to_regprocedure('public.${insertRoutine}()') AND p.proowner=10 AND p.prokind='f'
 AND p.prorettype='pg_catalog.trigger'::regtype AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
 AND NOT (p.prosecdef OR p.proretset OR p.proisstrict OR p.proleakproof)
 AND p.provolatile='v' AND p.proparallel='u' AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog']
 AND p.prosrc=${quote(insertBody)}
 AND (SELECT count(*)=1 AND bool_and(a.grantee=10 AND a.grantor=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
   FROM pg_catalog.aclexplode(p.proacl) a))
 AND ${triggers.map(row=>`EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.tgname=${quote(row.name)}
   AND t.tgrelid=${quote('public.'+identifier(row.table))}::regclass
   AND t.tgfoid=pg_catalog.to_regprocedure('public.${row.routine}()')
   AND t.tgtype=${row.type} AND t.tgenabled='A' AND NOT t.tgisinternal AND t.tgnargs=0
   AND t.tgparentid=0 AND t.tgconstraint=0 AND t.tgconstrrelid=0 AND t.tgconstrindid=0
   AND pg_catalog.octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector AND t.tgqual IS NULL
   AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND NOT (t.tgdeferrable OR t.tginitdeferred))`).join('\n AND ')}`;

function preimageSql(proofs){
  return `DO $voucher_before$ BEGIN
 ${fixedScope}
 IF NOT (${voucherRoutineProof(proofs)}) THEN RAISE EXCEPTION '${code}_ROUTINE_DRIFT'; END IF;
 IF ${guardMissing} OR ${privilegeGuard(false)} THEN RAISE EXCEPTION '${code}_BEFORE_IMAGE'; END IF;
END $voucher_before$;`;
}
function continuitySql(proofs){
  return `(${archiveInactive}) AND (${callerScope}) AND (${voucherRoutineProof(proofs)})
 AND (${guardVerified}) AND NOT (${privilegeGuard(true)})`;
}
const profile=Object.freeze({requirementsSha256,tables,functions,lockSql,preimageSql,guardSql,continuitySql,bindingSha256Sql});
function current259VoucherAcl(){
  need(arguments.length===0);
  return profile;
}
module.exports=Object.freeze({profileName,current259VoucherAcl,voucherAccessPlan});
