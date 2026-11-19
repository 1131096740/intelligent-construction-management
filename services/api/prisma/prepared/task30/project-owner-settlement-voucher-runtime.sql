-- Install only for the named, previously approved FileService runtime on migration 266 or later.
DO $$
DECLARE runtime_name TEXT := nullif(current_setting('jg.owner_settlement_file_runtime_role', true), '');
  runtime_role pg_catalog.pg_roles;
BEGIN
  SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname = runtime_name;
  IF runtime_role.oid IS NULL OR NOT runtime_role.rolcanlogin
    OR runtime_role.rolsuper OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole
    OR runtime_role.rolreplication OR runtime_role.rolbypassrls OR runtime_role.rolinherit
    OR has_schema_privilege(runtime_name, 'public', 'CREATE')
    OR NOT has_column_privilege(runtime_name, 'public."FileObject"', 'id', 'SELECT')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_role.oid OR roleid = runtime_role.oid)
  THEN RAISE EXCEPTION 'owner settlement voucher requires an existing restricted FileService runtime';
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT), public.jg_file_business_binding_columns_before_owner_settlement() TO %I', runtime_name);
END $$;
