'use strict';

const { types } = require('node:util');

// Fixed SQL for the independent current259 payment ACL transaction.
const CODE = 'TASK16_CURRENT259_PUBLIC_ACCESS';
const ROLE_NAMES = ['jg_task01_runtime', 'jg_task01_observer'];
const ARCHIVE_BINDINGS = [
  'jg_contract_direct_archive_intent_binding_v1',
  'jg_contract_direct_archive_native_nonce_v1',
  'jg_contract_direct_upward_issuer_binding_v2',
  'jg_contract_direct_upward_execution_binding_v2',
  'jg_contract_direct_upward_closure_v2'
];
const DIGEST = 'public.digest(bytea,text)';
const oid = x => typeof x === 'string' && /^[1-9][0-9]{0,9}$/u.test(x) && Number(x) <= 0xffffffff;
const xid = x => typeof x === 'string' && /^[1-9][0-9]{0,19}$/u.test(x) && BigInt(x) <= 0xffffffffffffffffn;
const literal = x => "'" + x.replaceAll("'", "''") + "'";
function need(ok) {
  if (!ok) throw new Error(CODE);
}
function field(record, key) {
  need(record && typeof record === 'object' && !types.isProxy(record));
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  need(descriptor && Object.hasOwn(descriptor, 'value'));
  return descriptor.value;
}
function fields(record, names) {
  return Object.fromEntries(names.map(name => [name, field(record, name)]));
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

function renderCurrent259PublicAccess(roleCompletion) {
  return renderPublicAccess(roleCompletion, false);
}

function renderCurrent259CompetitionPublicAccess(roleCompletion) {
  return renderPublicAccess(roleCompletion, true);
}

function renderPublicAccess(roleCompletion, competition) {
  const { status, commitXid, databaseIdentity, ordinary: rawOrdinary, roles: rawRoles } =
    fields(roleCompletion, ['status', 'commitXid', 'databaseIdentity', 'ordinary', 'roles']);
  const id = fields(databaseIdentity, ['database', 'databaseOid', 'namespaceOid', 'ownerOid', 'systemIdentifier']);
  const ordinary = fields(rawOrdinary, ['oid', 'name']);
  need(Array.isArray(rawRoles) && !types.isProxy(rawRoles) && rawRoles.length <= 9);
  const roles = Array.from({ length: rawRoles.length }, (_, index) => {
    const rawRole = field(rawRoles, index);
    const role = fields(rawRole, ['name', 'oid']);
    if (ROLE_NAMES.includes(role.name) && Object.hasOwn(rawRole, 'limit')) role.limit = field(rawRole, 'limit');
    return role;
  });
  need(status === 'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION' && xid(commitXid) &&
    id && typeof id.database === 'string' && /^jg_task01_[a-f0-9]{32}$/u.test(id.database) &&
    oid(id.databaseOid) && oid(id.namespaceOid) && id.ownerOid === '10' && xid(id.systemIdentifier));
  need(ordinary && oid(ordinary.oid) && typeof ordinary.name === 'string' &&
    /^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name) && Array.isArray(roles));
  const bound = ROLE_NAMES.map(name => {
    const found = roles.filter(row => row?.name === name);
    need(found.length === 1 && oid(found[0].oid));
    const limit = competition && name === ROLE_NAMES[0] ? 2 : 1;
    need(found[0].limit === limit || (!competition && found[0].limit === undefined));
    return { name, oid: found[0].oid, limit };
  });
  need(new Set(['10', ordinary.oid, ...bound.map(role => role.oid)]).size === bound.length + 2);
  const [runtime, observer] = bound;
  const roleRows = bound.map(role => `(${literal(role.name)},${role.oid}::oid${competition ? ',' + role.limit : ''})`).join(',');
  const roleColumns = competition ? 'name,oid,connection_limit' : 'name,oid';
  const roleLimit = competition ? 'e.connection_limit' : '1';
  const roleXmin = `(mod(${literal(commitXid)}::numeric,4294967296))::text`;
  const archiveInactive = ARCHIVE_BINDINGS.map(name => `EXISTS (SELECT FROM public.${name})`).join('\n    OR ');
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
    OR pg_catalog.pg_xact_status(${literal(commitXid)}::xid8) IS DISTINCT FROM 'committed'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR pg_catalog.host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1'
    OR pg_catalog.host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.oid=${ordinary.oid}::oid AND r.rolname=${literal(ordinary.name)})
    OR EXISTS (SELECT FROM (VALUES ${roleRows}) e(${roleColumns})
      WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_authid r WHERE r.oid=e.oid AND r.rolname::text=e.name
        AND r.xmin::text=${roleXmin} AND r.rolcanlogin AND r.rolconnlimit=${roleLimit} AND r.rolvaliduntil IS NULL))
    OR ${archiveInactive}
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      JOIN pg_catalog.pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.objsubid=0
        AND d.refclassid='pg_extension'::regclass AND d.refobjsubid=0 AND d.deptype='e'
      JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
      WHERE p.oid='${DIGEST}'::regprocedure AND p.pronamespace=${id.namespaceOid}::oid AND p.proowner=10
        AND p.prokind='f' AND l.lanname='c' AND p.prosrc='pg_digest' AND p.probin='$libdir/pgcrypto'
        AND p.prorettype='bytea'::regtype AND p.proisstrict AND NOT (p.prosecdef OR p.proretset OR p.proleakproof)
        AND p.provolatile='i' AND p.proparallel='s' AND e.extname='pgcrypto' AND e.extnamespace=p.pronamespace) THEN
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
    WHERE r.oid=ANY(prior_callers||ARRAY[${ordinary.oid}::oid]);
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
  IF EXISTS (
    (SELECT * FROM pg_temp.jg_c259_public_acl_live EXCEPT ALL SELECT * FROM pg_temp.jg_c259_public_acl_expected)
    UNION ALL
    (SELECT * FROM pg_temp.jg_c259_public_acl_expected EXCEPT ALL SELECT * FROM pg_temp.jg_c259_public_acl_live)
  ) OR EXISTS (SELECT FROM pg_temp.jg_c259_acl_callers
    WHERE NOT has_schema_privilege(oid,schema_oid,'USAGE') OR NOT has_function_privilege(oid,digest_oid,'EXECUTE'))
    OR NOT has_schema_privilege(${runtime.oid}::oid,schema_oid,'USAGE')
    OR NOT has_schema_privilege(${observer.oid}::oid,schema_oid,'USAGE')
    OR NOT has_function_privilege(${runtime.oid}::oid,digest_oid,'EXECUTE')
    OR has_function_privilege(${observer.oid}::oid,digest_oid,'EXECUTE') THEN
    RAISE EXCEPTION '${CODE}_POSTIMAGE';
  END IF;
END $current259_public_access$;
DROP VIEW pg_temp.jg_c259_public_acl_live;`;
}

module.exports = { renderCurrent259PublicAccess, renderCurrent259CompetitionPublicAccess };
