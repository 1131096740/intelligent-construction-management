'use strict';

const signature = 'public.jg_file_business_binding_columns_before_registered_payment()';
const raw = 'public.jg_project_owner_settlement_voucher_bound(text)';
const voucherTable = 'public."RegisteredPaymentVoucher"';
const bodySha256 = 'd2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f';

function renderTemporaryMetadataAlias({ database, port, roleOid, stage }) {
  if (typeof database !== 'string' || !/^jg_task01_[a-f0-9]{32}$/u.test(database)
    || !Number.isInteger(port) || port <= 1024 || port > 65535 || port === 5432
    || typeof roleOid !== 'string' || !/^[1-9][0-9]{0,9}$/u.test(roleOid)
    || BigInt(roleOid) > 4294967295n || stage !== 'grant' && stage !== 'revoke') {
    throw new Error('ONBOARDING_METADATA_ALIAS_SCOPE');
  }
  const expected = stage === 'grant' ? 'FALSE' : 'TRUE';
  const mutation = stage === 'grant'
    ? `GRANT EXECUTE ON FUNCTION ${signature} TO onboarding_runtime;`
    : `REVOKE EXECUTE ON FUNCTION ${signature} FROM onboarding_runtime;`;
  const columnMutation = stage === 'grant'
    ? `GRANT SELECT ("fileId") ON TABLE ${voucherTable} TO onboarding_runtime;`
    : `REVOKE SELECT ("fileId") ON TABLE ${voucherTable} FROM onboarding_runtime;`;
  return `DO $onboarding_metadata$
DECLARE
  target_oid oid := pg_catalog.to_regprocedure('${signature}');
  app_oid oid := ${roleOid}::oid;
  voucher_oid oid := pg_catalog.to_regclass('${voucherTable}');
  had_access boolean;
  column_before jsonb;
  column_after jsonb;
  relation_acl aclitem[];
  relation_acl_after aclitem[];
  original_acl jsonb;
  verified_acl jsonb;
BEGIN
  IF current_user <> 'jg_task01_owner' OR current_user <> session_user
    OR current_user::regrole::oid <> 10
    OR current_database() <> '${database}'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM ${port}
    OR pg_catalog.inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR pg_catalog.inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE oid=app_oid AND rolname='onboarding_runtime'
      AND rolcanlogin AND NOT (rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE app_oid IN (member,roleid))
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=target_oid AND p.pronamespace='public'::regnamespace AND p.proowner=10
      AND l.lanname='sql' AND p.prokind='f' AND p.proretset AND p.prorettype='record'::regtype
      AND NOT (p.prosecdef OR p.proisstrict OR p.proleakproof)
      AND p.provolatile='s' AND p.proparallel='s' AND p.pronargs=0 AND p.pronargdefaults=0
      AND p.provariadic=0 AND p.prosupport=0 AND p.proargnames=ARRAY['tableName','columnName','exclusive']
      AND p.proallargtypes=ARRAY['text'::regtype::oid,'text'::regtype::oid,'bool'::regtype::oid]
      AND p.proargmodes=ARRAY['t','t','t']::"char"[]
      AND p.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='${bodySha256}')
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('${raw}')
      AND p.proowner=10 AND p.prosecdef
      AND (SELECT count(*)=1 AND bool_and(grantee=10 AND grantor=10 AND privilege_type='EXECUTE' AND NOT is_grantable)
        FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))) THEN
    RAISE EXCEPTION 'ONBOARDING_METADATA_ALIAS_PREIMAGE' USING ERRCODE='55000';
  END IF;

  SELECT c.relacl INTO relation_acl FROM pg_catalog.pg_class c
    WHERE c.oid=voucher_oid AND c.relkind='r' AND c.relnamespace='public'::regnamespace AND c.relowner=10;
  IF NOT FOUND
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid=voucher_oid AND attname='fileId'
      AND atttypid='text'::regtype AND attnum>0 AND NOT attisdropped)
    OR pg_catalog.has_table_privilege(app_oid,voucher_oid,'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    OR pg_catalog.has_column_privilege(app_oid,voucher_oid,'fileId','SELECT') IS DISTINCT FROM ${expected}
    OR EXISTS (SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid=voucher_oid AND a.attnum>0 AND NOT a.attisdropped
      AND (pg_catalog.has_column_privilege(app_oid,voucher_oid,a.attnum,'INSERT, UPDATE, REFERENCES, SELECT WITH GRANT OPTION')
        OR (a.attname<>'fileId' AND pg_catalog.has_column_privilege(app_oid,voucher_oid,a.attnum,'SELECT'))))
  THEN RAISE EXCEPTION 'ONBOARDING_METADATA_COLUMN_PREIMAGE' USING ERRCODE='55000'; END IF;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type) INTO column_before
    FROM pg_catalog.pg_attribute p CROSS JOIN LATERAL pg_catalog.aclexplode(p.attacl) a
    WHERE p.attrelid=voucher_oid AND p.attname='fileId' AND a.grantee<>app_oid;

  had_access := pg_catalog.has_function_privilege(app_oid,target_oid,'EXECUTE');
  IF had_access IS DISTINCT FROM ${expected}
    OR pg_catalog.has_function_privilege(app_oid,target_oid,'EXECUTE WITH GRANT OPTION')
    OR pg_catalog.has_function_privilege(app_oid,'${raw}','EXECUTE')
    OR EXISTS (SELECT FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=target_oid AND (a.grantee=0 OR
        (a.grantee=app_oid AND (a.grantor<>10 OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))) THEN
    RAISE EXCEPTION 'ONBOARDING_METADATA_ALIAS_ACL' USING ERRCODE='55000';
  END IF;

  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type)
    INTO original_acl FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid=target_oid AND a.grantee<>app_oid;
  ${mutation}
  ${columnMutation}
  SELECT relacl INTO relation_acl_after FROM pg_catalog.pg_class WHERE oid=voucher_oid;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type) INTO column_after
    FROM pg_catalog.pg_attribute p CROSS JOIN LATERAL pg_catalog.aclexplode(p.attacl) a
    WHERE p.attrelid=voucher_oid AND p.attname='fileId' AND a.grantee<>app_oid;
  IF relation_acl IS DISTINCT FROM relation_acl_after OR column_before IS DISTINCT FROM column_after
    OR pg_catalog.has_column_privilege(app_oid,voucher_oid,'fileId','SELECT') IS DISTINCT FROM (NOT had_access)
    OR pg_catalog.has_column_privilege(app_oid,voucher_oid,'fileId','SELECT WITH GRANT OPTION')
  THEN RAISE EXCEPTION 'ONBOARDING_METADATA_COLUMN_POSTIMAGE' USING ERRCODE='55000'; END IF;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantor,a.grantee,a.privilege_type)
    INTO verified_acl FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid=target_oid AND a.grantee<>app_oid;
  IF original_acl IS DISTINCT FROM verified_acl
    OR pg_catalog.has_function_privilege(app_oid,target_oid,'EXECUTE') IS DISTINCT FROM (NOT had_access)
    OR pg_catalog.has_function_privilege(app_oid,target_oid,'EXECUTE WITH GRANT OPTION')
    OR pg_catalog.has_function_privilege(app_oid,'${raw}','EXECUTE') THEN
    RAISE EXCEPTION 'ONBOARDING_METADATA_ALIAS_POSTIMAGE' USING ERRCODE='55000';
  END IF;
END $onboarding_metadata$;`;
}

module.exports = { renderTemporaryMetadataAlias };
