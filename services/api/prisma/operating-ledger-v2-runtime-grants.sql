-- Migration-owner connection only. Reuse the existing application role.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SELECT set_config('app.operating_ledger_v2_runtime_role', :'runtime_role', true);

DO $$
DECLARE
  runtime_role TEXT := current_setting('app.operating_ledger_v2_runtime_role');
  runtime_oid OID;
  owner_oid OID := current_user::regrole::oid;
  payload regtype;
  entry regprocedure;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_roles
    WHERE rolname = runtime_role AND rolcanlogin AND NOT (rolsuper OR
      rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit);
  IF runtime_oid IS NULL OR runtime_oid = owner_oid
    OR runtime_role IN ('jg_task01_runtime', 'jg_task01_observer')
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = runtime_oid)
    OR NOT has_function_privilege(runtime_oid,
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)', 'EXECUTE')
    OR NOT has_function_privilege(runtime_oid,
      'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'V2 operating ledger requires the existing restricted application role'; END IF;

  FOREACH payload IN ARRAY ARRAY[
    'public."OperatingLedgerFactWritePayloadV2"'::regtype,
    'public."OperatingLedgerImpactWritePayloadV2"'::regtype
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_type t
      WHERE t.oid = payload AND t.typowner = owner_oid AND t.typtype = 'c'
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'USAGE'
        )
    ) THEN RAISE EXCEPTION 'V2 operating-ledger payload must be owner-controlled without PUBLIC USAGE'; END IF;
    EXECUTE format('GRANT USAGE ON TYPE %s TO %I', payload, runtime_role);
  END LOOP;

  FOREACH entry IN ARRAY ARRAY[
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure,
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = entry AND p.proowner = owner_oid AND p.prosecdef
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
    ) THEN RAISE EXCEPTION 'V2 operating-ledger entry must be owner-controlled without PUBLIC EXECUTE'; END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', entry, runtime_role);
  END LOOP;
END;
$$;
COMMIT;
