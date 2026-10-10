-- Read-only metadata preflight. Never provisions or changes a role.
BEGIN READ ONLY;
DO $$
DECLARE
  backup_identity record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.admin_option AND pg_has_role(current_user, m.member, 'SET')
  ) THEN
    RAISE EXCEPTION 'Database backup role must not have role administration privileges';
  END IF;
  -- PG16 SET membership can confer capabilities without INHERIT.
  FOR backup_identity IN
    SELECT oid, rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user OR pg_has_role(current_user, oid, 'SET')
    ORDER BY (rolname = current_user) DESC, oid
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid = backup_identity.oid
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) OR has_database_privilege(backup_identity.oid, current_database(), 'CREATE') OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_database d
      WHERE pg_has_role(backup_identity.oid, d.datdba, 'USAGE')
    ) THEN
      RAISE EXCEPTION 'Database backup requires a non-owner read-only role';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
        AND (pg_has_role(backup_identity.oid, n.nspowner, 'USAGE')
          OR has_schema_privilege(backup_identity.oid, n.oid, 'CREATE'))
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (pg_has_role(backup_identity.oid, c.relowner, 'USAGE')
          OR has_table_privilege(backup_identity.oid, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          OR has_any_column_privilege(backup_identity.oid, c.oid, 'INSERT, UPDATE, REFERENCES'))
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S' THEN pg_has_role(backup_identity.oid, c.relowner, 'USAGE') OR has_sequence_privilege(backup_identity.oid, c.oid, 'USAGE, UPDATE') ELSE false END
    ) THEN
      RAISE EXCEPTION 'Database backup role must not have application write or ownership privileges';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('pg_write_all_data', 'pg_write_server_files', 'pg_execute_server_program',
        'pg_signal_backend', 'pg_checkpoint', 'pg_create_subscription')
        AND pg_has_role(backup_identity.oid, r.oid, 'USAGE')
    ) THEN
      RAISE EXCEPTION 'Database backup role must not have server mutation capabilities';
    END IF;

    -- Do not infer safety from function names or volatility declarations.
    -- Backup needs no application SECURITY DEFINER entry point.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
        AND p.prosecdef AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
        AND has_function_privilege(backup_identity.oid, p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Database backup role must not have executable security-definer application functions';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
      AND ((c.relkind IN ('r', 'p', 'm') AND NOT has_table_privilege(current_user, c.oid, 'SELECT'))
        OR (c.relkind = 'S' AND NOT has_sequence_privilege(current_user, c.oid, 'SELECT')))
  ) THEN
    RAISE EXCEPTION 'Database backup role lacks complete read access; protected tables must not be excluded';
  END IF;
END;
$$;
ROLLBACK;
