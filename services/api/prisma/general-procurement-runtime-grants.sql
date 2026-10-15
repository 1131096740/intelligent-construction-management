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
  -- Existing owner defaults may have granted CRUD when this table was created.
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."GeneralProcurement" FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public."GeneralProcurement" TO %I', runtime_role);
  IF NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'SELECT')
    OR NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'INSERT')
    OR NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'UPDATE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'DELETE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'REFERENCES')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'TRIGGER') THEN
    RAISE EXCEPTION 'procurement runtime privileges must be limited to select insert update';
  END IF;
END;
$$;
COMMIT;
