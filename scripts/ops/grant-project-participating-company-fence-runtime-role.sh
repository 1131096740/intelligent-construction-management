#!/usr/bin/env bash
set -euo pipefail

# Owner-only deployment step for POL-284. It grants the application runtime
# role EXECUTE on the bounded SECURITY DEFINER fence helper without granting
# direct write access to the internal fence table.
: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
: "${OPERATING_LEDGER_RUNTIME_ROLE:?OPERATING_LEDGER_RUNTIME_ROLE is required}"
: "${ALLOW_PROJECT_PARTICIPANT_FENCE_ROLE_GRANT:?set ALLOW_PROJECT_PARTICIPANT_FENCE_ROLE_GRANT=true to continue}"

[[ "$ALLOW_PROJECT_PARTICIPANT_FENCE_ROLE_GRANT" == "true" ]] || {
  echo "refusing participant fence role grant without explicit confirmation" >&2
  exit 1
}

[[ "$OPERATING_LEDGER_RUNTIME_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || {
  echo "OPERATING_LEDGER_RUNTIME_ROLE must be a lowercase PostgreSQL role name" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER_PSQL_SCRIPT="${OPERATING_LEDGER_OWNER_PSQL_SCRIPT:-$SCRIPT_DIR/operating-ledger-owner-psql.sh}"

OPERATING_LEDGER_RUNTIME_ROLE="$OPERATING_LEDGER_RUNTIME_ROLE" \
  "$OWNER_PSQL_SCRIPT" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
SELECT set_config('app.participant_fence_runtime_role', :'runtime_role', false);
DO $$
DECLARE
  runtime_role TEXT := current_setting('app.participant_fence_runtime_role');
  runtime_role_oid OID;
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
  IF to_regprocedure('public."serializeProjectParticipatingCompanyMutation"(text)') IS NULL THEN
    RAISE EXCEPTION 'participant mutation fence function does not exist';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc
     WHERE oid = 'public."serializeProjectParticipatingCompanyMutation"(text)'::regprocedure
       AND proowner = runtime_role_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = 'public."ProjectParticipatingCompanyMutationFence"'::regclass
       AND relowner = runtime_role_oid
  ) THEN
    RAISE EXCEPTION 'runtime role must not own the participant mutation fence';
  END IF;

  REVOKE ALL ON FUNCTION
    public."serializeProjectParticipatingCompanyMutation"(TEXT)
    FROM PUBLIC;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public."serializeProjectParticipatingCompanyMutation"(TEXT) TO %I',
    runtime_role
  );
  EXECUTE format(
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."ProjectParticipatingCompanyMutationFence" FROM %I',
    runtime_role
  );
END;
$$;
RESET app.participant_fence_runtime_role;
SQL

echo "participant mutation fence runtime grant configured; no migration or application restart was performed"
