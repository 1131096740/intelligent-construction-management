-- PREPARED / NOT EXECUTED. Task-owned test instrumentation, not a product migration.
-- Review with the complete new-cluster ACL script before any separate execution approval.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'jg_task01_owner'
     OR current_database() !~ '^jg_task01_[a-f0-9]{32}$'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       JOIN pg_catalog.pg_roles r ON r.oid = d.datdba
       WHERE d.datname = current_database() AND r.rolname = current_user
     ) THEN
    RAISE EXCEPTION 'task01 isolated owner/database guard rejected';
  END IF;
  IF to_regprocedure('public.jg_task01_connection_identity()') IS NOT NULL THEN
    RAISE EXCEPTION 'task01 identity instrumentation must not replace an existing object';
  END IF;
END;
$guard$;

CREATE FUNCTION public.jg_task01_connection_identity()
RETURNS TABLE (
  "loginRole" text,
  "databaseOid" text,
  "systemIdentifier" text,
  "backendPid" integer,
  tls boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $identity$
  SELECT session_user::text,
         (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()),
         (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
         pg_backend_pid(),
         coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()), false)
$identity$;

REVOKE ALL ON FUNCTION public.jg_task01_connection_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jg_task01_connection_identity() TO jg_task01_runtime, jg_task01_observer;
COMMIT;
