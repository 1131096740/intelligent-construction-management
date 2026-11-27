#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
: "${OPERATING_LEDGER_RUNTIME_ROLE:?OPERATING_LEDGER_RUNTIME_ROLE is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER_PSQL_SCRIPT="${OPERATING_LEDGER_OWNER_PSQL_SCRIPT:-$SCRIPT_DIR/operating-ledger-owner-psql.sh}"

OPERATING_LEDGER_RUNTIME_ROLE="$OPERATING_LEDGER_RUNTIME_ROLE" \
  "$OWNER_PSQL_SCRIPT" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
SELECT set_config('app.verify_runtime_role', :'runtime_role', false);
DO $$
DECLARE
  runtime_role TEXT := current_setting('app.verify_runtime_role');
  runtime_role_oid OID;
  privilege TEXT;
  relation TEXT;
  exact_payload_types CONSTANT TEXT[] := ARRAY[
    'public."OperatingLedgerFactWritePayloadV2"',
    'public."OperatingLedgerImpactWritePayloadV2"'
  ];
  exact_append_functions CONSTANT TEXT[] := ARRAY[
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)',
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'
  ];
BEGIN
  SELECT oid
    INTO runtime_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = runtime_role;
  IF runtime_role_oid IS NULL THEN
    RAISE EXCEPTION 'operating-ledger runtime role does not exist';
  END IF;
  IF runtime_role = current_user THEN
    RAISE EXCEPTION 'operating-ledger runtime role must differ from the migration owner';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = runtime_role_oid
       AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'operating-ledger runtime role has unsafe role attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_role_oid) THEN
    RAISE EXCEPTION 'operating-ledger runtime role has role memberships';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace
     WHERE nspname = 'public'
       AND nspowner = runtime_role_oid
  ) OR EXISTS (
    SELECT 1
     FROM pg_catalog.pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relname IN (
         'OperatingFact',
         'OperatingImpactEntry',
         'ProjectParticipatingCompanyMutationFence'
       )
       AND relowner = runtime_role_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN (
         'appendOperatingFactThroughService',
         'appendOperatingImpactThroughService',
         'serializeProjectParticipatingCompanyMutation'
       )
       AND proowner = runtime_role_oid
  ) THEN
    RAISE EXCEPTION 'operating-ledger runtime role owns a protected schema object';
  END IF;
  IF NOT has_table_privilege(runtime_role, 'public."OperatingFact"', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'public."OperatingImpactEntry"', 'SELECT') THEN
    RAISE EXCEPTION 'operating-ledger runtime role cannot read the ledger';
  END IF;
  FOREACH relation IN ARRAY ARRAY['public."OperatingFact"', 'public."OperatingImpactEntry"'] LOOP
    IF has_table_privilege(runtime_role, relation, 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_any_column_privilege(runtime_role, relation, 'INSERT, UPDATE') THEN
      RAISE EXCEPTION 'operating-ledger runtime role retains direct ledger write privilege';
    END IF;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['public."OperatingLedgerWriteSecret"', 'public."OperatingLedgerWriteContext"'] LOOP
    IF has_table_privilege(runtime_role, relation, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege(runtime_role, relation, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'operating-ledger runtime role retains direct writer witness privilege';
    END IF;
  END LOOP;
  IF NOT has_function_privilege(
    runtime_role,
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    runtime_role,
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'operating-ledger runtime role cannot execute the controlled append functions';
  END IF;
  IF NOT has_function_privilege(
    runtime_role,
    'public."serializeProjectParticipatingCompanyMutation"(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'operating-ledger runtime role cannot execute the participant mutation fence';
  END IF;
  FOREACH privilege IN ARRAY ARRAY[
    'public.issue_contract_bank_holder(text,text,text,text,text)',
    'public."authorizeOperatingLedgerWrite"(text,text)',
    'public.assert_fund_execution_server_context(text,text,text)',
    'public.assert_fund_movement_write_context()',
    'public.issue_contract_bank_holder(text,text,text,text,text,text)',
    'public.record_verified_bank_observation(jsonb,text)',
    'public.append_company_transfer_event(jsonb,text)'
  ] || exact_append_functions LOOP
    IF NOT has_function_privilege(runtime_role, privilege, 'EXECUTE') OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
      WHERE p.oid = privilege::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN RAISE EXCEPTION 'financial entry requires runtime EXECUTE and no PUBLIC EXECUTE'; END IF;
  END LOOP;
  FOREACH privilege IN ARRAY exact_payload_types LOOP
    IF NOT has_type_privilege(runtime_role, privilege, 'USAGE') OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_type t,
        LATERAL aclexplode(COALESCE(t.typacl, acldefault('T',t.typowner))) a
      WHERE t.oid = privilege::regtype AND a.grantee = 0 AND a.privilege_type = 'USAGE'
    ) THEN RAISE EXCEPTION 'V2 operating-ledger payload requires runtime USAGE and no PUBLIC USAGE'; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('jg_task01_runtime', 'jg_task01_observer')
      AND (
        EXISTS (SELECT 1 FROM unnest(exact_append_functions) f(signature)
          WHERE has_function_privilege(r.oid, f.signature, 'EXECUTE'))
        OR EXISTS (SELECT 1 FROM unnest(exact_payload_types) t(signature)
          WHERE has_type_privilege(r.oid, t.signature, 'USAGE'))
      )
  ) THEN RAISE EXCEPTION 'V2 operating-ledger ACL exceeds the registered application role boundary'; END IF;
  FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege(
      runtime_role,
      'public."ProjectParticipatingCompanyMutationFence"',
      privilege
    ) THEN
      RAISE EXCEPTION 'operating-ledger runtime role retains direct participant fence write privilege';
    END IF;
  END LOOP;
END;
$$;
SQL
