'use strict';

// Fixed SQL for the current259 owned ACL transaction, after the runtime grants.
const CODE = 'TASK16_CURRENT259_PUBLIC_ACCESS';
const ROLE_NAMES = [
  'jg_c259_outside_issuer_owner',
  'jg_c259_outside_executor_owner',
  'jg_c259_upward_issuer_owner',
  'jg_task01_runtime',
  'jg_task01_observer'
];
const DIGEST = 'public.digest(bytea,text)';
const OUTSIDE_UUID = 'public.gen_random_uuid()';
const oid = x => typeof x === 'string' && /^[1-9][0-9]{0,9}$/u.test(x) && Number(x) <= 0xffffffff;
const xid = x => typeof x === 'string' && /^[1-9][0-9]{0,19}$/u.test(x) && BigInt(x) <= 0xffffffffffffffffn;
const literal = x => "'" + x.replaceAll("'", "''") + "'";
function need(ok) {
  if (!ok) throw new Error(CODE);
}

const aclRows = `SELECT 'routine'::text AS kind,p.oid AS object_oid,0 AS column_no,p.proowner AS object_owner,a.*
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.pronamespace=pg_catalog.to_regnamespace('public')
  UNION ALL SELECT 'schema',n.oid,0,n.nspowner,a.*
  FROM pg_catalog.pg_namespace n
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
  WHERE n.oid=pg_catalog.to_regnamespace('public')
  UNION ALL SELECT 'relation',c.oid,0,c.relowner,a.*
  FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,
    pg_catalog.acldefault((CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char",c.relowner))) a
  WHERE c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relkind IN ('r','p','v','m','f','S')
  UNION ALL SELECT 'column',c.oid,k.attnum,c.relowner,a.*
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute k ON k.attrelid=c.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(k.attacl) a
  WHERE c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relkind IN ('r','p','v','m','f')
    AND k.attnum>0 AND NOT k.attisdropped
  UNION ALL SELECT 'type',t.oid,0,t.typowner,a.*
  FROM pg_catalog.pg_type t CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))) a
  WHERE t.oid IN ('public."OperatingLedgerFactWritePayloadV2"'::regtype,'public."OperatingLedgerImpactWritePayloadV2"'::regtype)`;

function renderCurrent259PublicAccess(archiveCompletion) {
  const { status, installXid, databaseIdentity: id, ordinary, roles } = structuredClone(archiveCompletion ?? {});
  need(status === 'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED' && xid(installXid) &&
    id && typeof id.database === 'string' && /^jg_task01_[a-f0-9]{32}$/u.test(id.database) &&
    oid(id.databaseOid) && oid(id.namespaceOid) && id.ownerOid === '10' && xid(id.systemIdentifier));
  need(ordinary && oid(ordinary.oid) && typeof ordinary.name === 'string' &&
    /^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name) && Array.isArray(roles));
  const bound = ROLE_NAMES.map(name => {
    const found = roles.filter(row => row?.name === name);
    need(found.length === 1 && oid(found[0].oid));
    return { name, oid: found[0].oid };
  });
  need(new Set(['10', ordinary.oid, ...bound.map(role => role.oid)]).size === bound.length + 2);
  const [outsideIssuer, outsideExecutor, upwardIssuer, runtime, observer] = bound;
  const roleRows = [ordinary, ...bound].map(role => `(${literal(role.name)},${role.oid}::oid)`).join(',');
  const archiveXid = `(mod(${literal(installXid)}::numeric,4294967296))::text`;
  return `SET LOCAL search_path=pg_catalog,pg_temp;
DO $current259_public_access_preimage$
DECLARE
  prior_callers oid[];
BEGIN
  IF current_user IS DISTINCT FROM 'jg_task01_owner' OR session_user IS DISTINCT FROM current_user
    OR current_user::regrole::oid<>10 OR current_database() IS DISTINCT FROM ${literal(id.database)}
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE oid=${id.databaseOid}::oid AND datname=current_database() AND datdba=10)
    OR pg_catalog.to_regnamespace('public')::oid IS DISTINCT FROM ${id.namespaceOid}::oid
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${literal(id.systemIdentifier)}
    OR pg_catalog.pg_xact_status(${literal(installXid)}::xid8) IS DISTINCT FROM 'committed'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR pg_catalog.host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1'
    OR pg_catalog.host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR EXISTS (SELECT FROM (VALUES ${roleRows}) e(name,oid)
      WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.oid=e.oid AND r.rolname::text=e.name))
    OR NOT EXISTS (SELECT FROM public.jg_contract_direct_archive_intent_binding_v1 o
      JOIN public.jg_contract_direct_upward_issuer_binding_v2 u ON u."protocolVersion"=2
        AND u."outsideBindingSha256"=encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')
      WHERE o."protocolVersion"=1 AND o."ordinaryApplicationRoleOid"=${ordinary.oid}::oid
        AND o."databaseOid"=${id.databaseOid}::oid AND o."namespaceOid"=${id.namespaceOid}::oid AND o."anchorOwnerOid"=10
        AND o."issuerOwnerOid"=${outsideIssuer.oid}::oid AND o."executorOwnerOid"=${outsideExecutor.oid}::oid
        AND u."issuerOwnerOid"=${upwardIssuer.oid}::oid AND u."anchorOwnerOid"=10
        AND u."databaseOid"=o."databaseOid" AND u."namespaceOid"=o."namespaceOid"
        AND o.xmin::text=${archiveXid} AND u.xmin::text=${archiveXid})
    OR NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=${outsideExecutor.oid}::oid AND NOT r.rolcanlogin)
    OR 2<>(SELECT count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      JOIN pg_catalog.pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.objsubid=0
        AND d.refclassid='pg_extension'::regclass AND d.refobjsubid=0 AND d.deptype='e'
      JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
      WHERE p.pronamespace=${id.namespaceOid}::oid AND p.proowner=10
        AND p.prokind='f' AND l.lanname='c' AND p.probin='$libdir/pgcrypto'
        AND NOT (p.prosecdef OR p.proretset OR p.proleakproof) AND p.proparallel='s'
        AND e.extname='pgcrypto' AND e.extnamespace=p.pronamespace AND (
          (p.oid='${DIGEST}'::regprocedure AND p.prosrc='pg_digest' AND p.prorettype='bytea'::regtype
            AND p.provolatile='i' AND p.proisstrict)
          OR (p.oid='${OUTSIDE_UUID}'::regprocedure AND p.prosrc='pg_random_uuid' AND p.prorettype='uuid'::regtype
            AND p.provolatile='v' AND NOT p.proisstrict))) THEN
    RAISE EXCEPTION '${CODE}_PREIMAGE';
  END IF;
  SELECT "fileCallerOids" INTO STRICT prior_callers FROM public.jg_contract_direct_pending_binding_v1
    WHERE "protocolVersion"=1 AND "recipeVersion"='contract-direct-pending-input-v1/1'
      AND "applicationRoleOid"=${ordinary.oid}::oid AND "databaseOid"=${id.databaseOid}::oid
      AND "anchorNamespaceOid"=${id.namespaceOid}::oid AND "anchorOwnerOid"=10;
  IF cardinality(prior_callers)<1 OR cardinality(prior_callers)>64
    OR EXISTS (SELECT FROM unnest(prior_callers) v(oid)
      WHERE v.oid IN (${runtime.oid}::oid,${observer.oid}::oid) OR NOT EXISTS (SELECT FROM pg_roles r WHERE r.oid=v.oid)) THEN
    RAISE EXCEPTION '${CODE}_CALLERS';
  END IF;
  CREATE TEMP TABLE jg_c259_acl_callers ON COMMIT DROP AS
    SELECT DISTINCT r.oid,r.rolname FROM pg_roles r
    WHERE r.oid=ANY(prior_callers||ARRAY[${ordinary.oid}::oid,${outsideIssuer.oid}::oid,${outsideExecutor.oid}::oid,${upwardIssuer.oid}::oid]);
END $current259_public_access_preimage$;
CREATE TEMP VIEW jg_c259_public_acl_live AS ${aclRows};
CREATE TEMP TABLE jg_c259_public_acl_expected ON COMMIT DROP AS
  SELECT * FROM pg_temp.jg_c259_public_acl_live WHERE grantee<>0;
DO $current259_public_access$
DECLARE
  target record;
  schema_oid oid := pg_catalog.to_regnamespace('public');
  schema_owner oid := (SELECT nspowner FROM pg_namespace WHERE oid=schema_oid);
  digest_oid oid := '${DIGEST}'::regprocedure;
  uuid_oid oid := '${OUTSIDE_UUID}'::regprocedure;
BEGIN
  IF EXISTS (SELECT FROM pg_temp.jg_c259_public_acl_live
    WHERE grantee=0 AND (grantor<>object_owner OR is_grantable OR NOT
      ((kind='routine' AND privilege_type='EXECUTE') OR (kind='schema' AND privilege_type='USAGE')))) THEN
    RAISE EXCEPTION '${CODE}_UNSUPPORTED_PUBLIC_ACL';
  END IF;
  FOR target IN SELECT object_oid FROM pg_temp.jg_c259_public_acl_live
    WHERE kind='routine' AND grantee=0 ORDER BY object_oid
  LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC RESTRICT',target.object_oid::regprocedure);
  END LOOP;
  REVOKE USAGE ON SCHEMA public FROM PUBLIC RESTRICT;
  FOR target IN SELECT oid,rolname FROM pg_temp.jg_c259_acl_callers ORDER BY oid LOOP
    IF NOT has_schema_privilege(target.oid,schema_oid,'USAGE') THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',target.rolname);
      INSERT INTO pg_temp.jg_c259_public_acl_expected VALUES
        ('schema',schema_oid,0,schema_owner,schema_owner,target.oid,'USAGE',false);
    END IF;
    IF NOT has_function_privilege(target.oid,digest_oid,'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION ${DIGEST} TO %I',target.rolname);
      INSERT INTO pg_temp.jg_c259_public_acl_expected VALUES
        ('routine',digest_oid,0,10,10,target.oid,'EXECUTE',false);
    END IF;
  END LOOP;
  IF NOT has_function_privilege(${outsideExecutor.oid}::oid,uuid_oid,'EXECUTE') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION ${OUTSIDE_UUID} TO %I',${literal(outsideExecutor.name)});
    INSERT INTO pg_temp.jg_c259_public_acl_expected VALUES
      ('routine',uuid_oid,0,10,10,${outsideExecutor.oid}::oid,'EXECUTE',false);
  END IF;
  IF EXISTS (
    (SELECT * FROM pg_temp.jg_c259_public_acl_live EXCEPT ALL SELECT * FROM pg_temp.jg_c259_public_acl_expected)
    UNION ALL
    (SELECT * FROM pg_temp.jg_c259_public_acl_expected EXCEPT ALL SELECT * FROM pg_temp.jg_c259_public_acl_live)
  ) OR EXISTS (SELECT FROM pg_temp.jg_c259_acl_callers
    WHERE NOT has_schema_privilege(oid,schema_oid,'USAGE') OR NOT has_function_privilege(oid,digest_oid,'EXECUTE'))
    OR NOT has_schema_privilege(${runtime.oid}::oid,schema_oid,'USAGE')
    OR NOT has_schema_privilege(${observer.oid}::oid,schema_oid,'USAGE')
    OR NOT has_function_privilege(${outsideExecutor.oid}::oid,uuid_oid,'EXECUTE')
    OR NOT has_function_privilege(${runtime.oid}::oid,digest_oid,'EXECUTE')
    OR has_function_privilege(${observer.oid}::oid,digest_oid,'EXECUTE') THEN
    RAISE EXCEPTION '${CODE}_POSTIMAGE';
  END IF;
END $current259_public_access$;
DROP VIEW pg_temp.jg_c259_public_acl_live;`;
}

module.exports = { renderCurrent259PublicAccess };
