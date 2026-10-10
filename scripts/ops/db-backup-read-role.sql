-- Read-only metadata preflight. Never provisions or changes a role.
BEGIN READ ONLY;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR has_database_privilege(current_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Database backup requires a non-owner read-only role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
      AND has_schema_privilege(current_user, n.oid, 'CREATE')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
        OR has_table_privilege(current_user, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind = 'S'
      AND has_sequence_privilege(current_user, c.oid, 'USAGE, UPDATE')
  ) THEN
    RAISE EXCEPTION 'Database backup role must not have application write or ownership privileges';
  END IF;

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
