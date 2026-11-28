'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const scope=require('./scope.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function verifySql(file){
  assert.equal(hash(fs.readFileSync(file)),scope.terminal.sha256,'INSTALL_ONLY_290_SQL');
}
function expectedLedger(ledger){
  assert.equal(ledger.length,scope.prefixCount,'INSTALL_ONLY_290_COUNT');
  assert.equal(hash(JSON.stringify(ledger)),scope.prefixLedgerSha256,'INSTALL_ONLY_290_HISTORY');
  const next=[...ledger,scope.terminal];
  assert.equal(hash(JSON.stringify(next)),scope.expectedLedgerSha256,'INSTALL_ONLY_290_SOURCE');
  return next;
}
function stage(folder){
  const migration=path.join(folder,'migrations',scope.terminal.name);
  fs.mkdirSync(migration);
  return path.join(migration,'migration.sql');
}
const catalogSql=`WITH protected_key AS (
    SELECT c.oid,c.relowner,c.relacl,c.relnamespace
    FROM pg_catalog.pg_class c WHERE c.oid='public.jg_fund_balance_correction_witness_key'::regclass
), all_login_access AS (
    SELECT r.rolname,
      pg_catalog.has_table_privilege(r.oid,k.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(r.oid,k.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS key_access,
      pg_catalog.has_schema_privilege(r.oid,k.relnamespace,'CREATE') AS schema_create
    FROM pg_catalog.pg_roles r CROSS JOIN protected_key k WHERE r.rolcanlogin AND NOT r.rolsuper
  ), expected_owner AS (
 SELECT relowner AS oid FROM pg_class WHERE oid='public."ApprovalInstance"'::regclass
), routines(signature, digest, security_definer) AS (VALUES
 ('public.jg_fund_balance_correction_fields(text[])','301d8d496077e1732bd4c144fb5d82348e7757cebb2ceed3f402816d763a90b9',false),
 ('public.jg_create_fund_balance_correction_round()','ed1e01e9ec3c9263ac318c5c5960321601c5fc135fded616dc3261e455651d2e',true),
 ('public.jg_validate_fund_balance_correction_round()','ce59aa729d90d982e1c906d2af7b4daa0ba861d778aea3990f859957aeffc630',true)
), triggers(name, rel, fn, kind, deferred, predicate) AS (VALUES
 ('FundBalanceCorrection_create_round','public."FundAccountBalanceRegistration"','public.jg_create_fund_balance_correction_round()',7,false,
  $when$new.kind = 'correction'::text AND new.status = 'pending_review'::text AND new."approvalInstanceId" IS NULL$when$),
 ('FundBalanceCorrection_round_complete','public."ApprovalInstance"','public.jg_validate_fund_balance_correction_round()',5,true,
  $when$new."businessType" = 'fund_account_balance_registration'::text AND new."flowType" = 'fund_account_balance_correction'::text AND pg_trigger_depth() > 0$when$),
 ('FundBalanceCorrection_round_creation_immutable','public."ApprovalInstance"','public.jg_validate_fund_balance_correction_round()',19,false,
  $when$old."businessType" = 'fund_account_balance_registration'::text AND old."flowType" = 'fund_account_balance_correction'::text$when$),
 ('FundBalanceCorrection_source_bound','public."FundAccountSourceBatch"','public.jg_validate_fund_balance_correction_round()',7,false,NULL)
)
SELECT jsonb_build_object(
    'keyOwnerIsBootstrap', (SELECT relowner=10 FROM protected_key),
    'extraSuperuserLoginAbsent', NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolcanlogin AND rolsuper AND oid<>10),
    'tableAclOwnerOnly', NOT EXISTS (
      SELECT FROM protected_key k CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(k.relacl,pg_catalog.acldefault('r',k.relowner))) acl
      WHERE acl.grantee<>k.relowner OR acl.grantor<>k.relowner),
    'columnAclOwnerOnly', NOT EXISTS (
      SELECT FROM protected_key k JOIN pg_catalog.pg_attribute a ON a.attrelid=k.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE acl.grantee<>k.relowner OR acl.grantor<>k.relowner),
    'nonOwnerLoginEffectiveAccessAbsent', NOT EXISTS (SELECT FROM all_login_access WHERE key_access),
    'superuserRoleReachabilityAbsent', NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles member CROSS JOIN pg_catalog.pg_roles privileged
      WHERE member.rolcanlogin AND NOT member.rolsuper AND privileged.rolsuper
        AND (pg_catalog.pg_has_role(member.oid,privileged.oid,'USAGE') OR pg_catalog.pg_has_role(member.oid,privileged.oid,'SET'))),
    'predefinedRoleReachabilityAbsent', NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles member CROSS JOIN pg_catalog.pg_roles builtin
      WHERE member.rolcanlogin AND NOT member.rolsuper AND builtin.rolname IN ('pg_read_all_data','pg_write_all_data')
        AND (pg_catalog.pg_has_role(member.oid,builtin.oid,'USAGE') OR pg_catalog.pg_has_role(member.oid,builtin.oid,'SET'))),
    'runtimeKeyAndSchemaDenied', (SELECT NOT key_access AND NOT schema_create FROM all_login_access WHERE rolname='jg_task01_runtime'),
    'observerKeyAndSchemaDenied', (SELECT NOT key_access AND NOT schema_create FROM all_login_access WHERE rolname='jg_task01_observer'),
    'auditImmutableForRuntime', NOT has_table_privilege('jg_task01_runtime','public."AuditLog"','UPDATE,DELETE,TRUNCATE')
      AND NOT has_any_column_privilege('jg_task01_runtime','public."AuditLog"','UPDATE'),
 'keyTableShape', EXISTS(SELECT FROM protected_key k JOIN expected_owner o ON o.oid=k.relowner
   JOIN pg_class c ON c.oid=k.oid WHERE c.relkind='r'),
 'keyUnprovisioned', (SELECT count(*)=0 FROM public.jg_fund_balance_correction_witness_key),
 'runtimeApprovalDenied', NOT has_any_column_privilege('jg_task01_runtime','public."ApprovalInstance"','INSERT'),
 'exactRoutines', NOT EXISTS(SELECT FROM routines r WHERE NOT EXISTS(SELECT FROM pg_proc p JOIN expected_owner o ON p.proowner=o.oid
   WHERE p.oid=to_regprocedure(r.signature) AND p.prosecdef=r.security_definer AND p.proconfig=ARRAY['search_path=pg_catalog']
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=r.digest
    AND NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))),
 'exactTriggers', NOT EXISTS(SELECT FROM triggers r WHERE NOT EXISTS(SELECT FROM pg_trigger t
   WHERE t.tgname=r.name AND t.tgrelid=to_regclass(r.rel) AND t.tgfoid=to_regprocedure(r.fn)
    AND t.tgtype=r.kind AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgnargs=0 AND t.tgattr::text=''
    AND t.tgdeferrable=r.deferred AND t.tginitdeferred=r.deferred
    AND (CASE WHEN t.tgqual IS NULL THEN r.predicate IS NULL ELSE
      (regexp_match(pg_get_triggerdef(t.oid,true),' WHEN [(](.*)[)] EXECUTE FUNCTION [^()]+[(][)]$'))[1] = r.predicate END)
 )))`;
const catalogFields=Object.freeze([
 'keyOwnerIsBootstrap','extraSuperuserLoginAbsent','tableAclOwnerOnly','columnAclOwnerOnly',
 'nonOwnerLoginEffectiveAccessAbsent','superuserRoleReachabilityAbsent','predefinedRoleReachabilityAbsent',
 'runtimeKeyAndSchemaDenied','observerKeyAndSchemaDenied','auditImmutableForRuntime','keyTableShape',
 'keyUnprovisioned','runtimeApprovalDenied','exactRoutines','exactTriggers',
]);
function exactCatalog(shape){
 return !!shape && Object.keys(shape).length===catalogFields.length && catalogFields.every(key=>shape[key]===true);
}
module.exports={scope,verifySql,expectedLedger,stage,catalogSql,exactCatalog,catalogFields};
