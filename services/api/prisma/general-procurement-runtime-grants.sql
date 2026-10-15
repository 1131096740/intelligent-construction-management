-- Deployment migration-owner connection only; existing restricted application role.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.procurement_runtime_role', :'runtime_role', true);
DO $$
DECLARE runtime_role TEXT := current_setting('app.procurement_runtime_role');
BEGIN
  IF runtime_role = current_user OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
  ) THEN RAISE EXCEPTION 'procurement runtime must be a distinct existing restricted role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'GeneralProcurement' AND c.relkind = 'r'
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'migration owner must own the procurement table';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public."GeneralProcurement" TO %I', runtime_role);
END;
$$;
COMMIT;
