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
       AND relname IN ('OperatingFact', 'OperatingImpactEntry')
       AND relowner = runtime_role_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('appendOperatingFactThroughService', 'appendOperatingImpactThroughService')
       AND proowner = runtime_role_oid
  ) THEN
    RAISE EXCEPTION 'operating-ledger runtime role owns a protected schema object';
  END IF;
  IF NOT has_table_privilege(runtime_role, 'public."OperatingFact"', 'SELECT')
     OR NOT has_table_privilege(runtime_role, 'public."OperatingImpactEntry"', 'SELECT') THEN
    RAISE EXCEPTION 'operating-ledger runtime role cannot read the ledger';
  END IF;
  FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege(runtime_role, 'public."OperatingFact"', privilege)
       OR has_table_privilege(runtime_role, 'public."OperatingImpactEntry"', privilege) THEN
      RAISE EXCEPTION 'operating-ledger runtime role retains direct ledger write privilege';
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
END;
$$;
SQL
