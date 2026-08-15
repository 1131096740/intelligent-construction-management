#!/usr/bin/env bash
set -euo pipefail

# This is an explicit operator step. It is never called by the application or
# by Prisma migrations. Run it with a database-owner URL after reviewing the
# target database and role names. It only grants read access plus the two
# controlled operating-ledger append functions; non-ledger application DML
# remains separately managed and is never broadened by this script.
: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
: "${OPERATING_LEDGER_RUNTIME_ROLE:?OPERATING_LEDGER_RUNTIME_ROLE is required}"
: "${OPERATING_LEDGER_RUNTIME_PASSWORD:?OPERATING_LEDGER_RUNTIME_PASSWORD is required}"
: "${OPERATING_LEDGER_DB_WRITE_SECRET:?OPERATING_LEDGER_DB_WRITE_SECRET is required}"
: "${ALLOW_OPERATING_LEDGER_ROLE_PROVISIONING:?set ALLOW_OPERATING_LEDGER_ROLE_PROVISIONING=true to continue}"

[[ "$ALLOW_OPERATING_LEDGER_ROLE_PROVISIONING" == "true" ]] || {
  echo "refusing operating-ledger role provisioning without explicit confirmation" >&2
  exit 1
}

[[ "$OPERATING_LEDGER_RUNTIME_ROLE" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || {
  echo "OPERATING_LEDGER_RUNTIME_ROLE must be a lowercase PostgreSQL role name" >&2
  exit 1
}

(( ${#OPERATING_LEDGER_DB_WRITE_SECRET} >= 32 )) || {
  echo "OPERATING_LEDGER_DB_WRITE_SECRET must contain at least 32 characters" >&2
  exit 1
}

OWNER_PSQL_SCRIPT="${OPERATING_LEDGER_OWNER_PSQL_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/operating-ledger-owner-psql.sh}"
DATABASE_OWNER_URL="$DATABASE_OWNER_URL" "$OWNER_PSQL_SCRIPT" \
  --set=ON_ERROR_STOP=1 <<'SQL'

\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
\getenv runtime_password OPERATING_LEDGER_RUNTIME_PASSWORD
\getenv write_secret OPERATING_LEDGER_DB_WRITE_SECRET
\o /dev/null
SELECT set_config('app.provision_runtime_role', :'runtime_role', false);
SELECT set_config('app.provision_runtime_password', :'runtime_password', false);
SELECT set_config('app.provision_write_secret', :'write_secret', false);
\o

DO $$
DECLARE
  runtime_role TEXT := current_setting('app.provision_runtime_role');
  runtime_password TEXT := current_setting('app.provision_runtime_password');
BEGIN
  IF runtime_role = current_user THEN
    RAISE EXCEPTION 'runtime role must be distinct from the database owner';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = runtime_role) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', runtime_role, runtime_password);
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', runtime_role, runtime_password);
  END IF;

  EXECUTE format(
    'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    runtime_role
  );

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace
    WHERE nspname = 'public'
      AND nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = runtime_role)
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('OperatingFact', 'OperatingImpactEntry')
      AND relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = runtime_role)
  ) THEN
    RAISE EXCEPTION 'runtime role must not own the public schema or protected operating-ledger tables';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', runtime_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %I', runtime_role);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."OperatingFact", public."OperatingImpactEntry" FROM %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload", TEXT, TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload", TEXT, TEXT) TO %I', runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public."authorizeOperatingLedgerWrite"(TEXT, TEXT) FROM %I', runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public."assertOperatingLedgerWriteContext"(TEXT) FROM %I', runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public."OperatingLedgerWriteSecret", public."OperatingLedgerWriteContext" FROM %I', runtime_role);
END;
$$;

INSERT INTO public."OperatingLedgerWriteSecret"("id", "secretHash")
VALUES (1, public.crypt(current_setting('app.provision_write_secret'), public.gen_salt('bf')))
ON CONFLICT ("id") DO UPDATE
SET "secretHash" = EXCLUDED."secretHash",
    "createdAt" = CURRENT_TIMESTAMP;

RESET app.provision_runtime_role;
RESET app.provision_runtime_password;
RESET app.provision_write_secret;
SQL

echo "operating-ledger runtime role configured; no application restart or migration was performed"
