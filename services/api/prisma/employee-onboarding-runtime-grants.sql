-- Run only through the deployment's private migration-owner connection.
-- Account and personnel tables only; no ledger or owner authority is added.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.onboarding_runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime_role TEXT := current_setting('app.onboarding_runtime_role');
  runtime_oid OID;
  personnel_table TEXT;
  personnel_columns TEXT;
  personnel_column RECORD;
  runtime_identity RECORD;
  allowed_update BOOLEAN;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_roles
    WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls;
  IF runtime_oid IS NULL OR runtime_role = current_user
      OR pg_has_role(runtime_oid, current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'onboarding runtime must be an existing restricted role distinct from the migration owner';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN ('EmployeeRegistration', 'AuthRateLimit', 'SmsChallenge', 'EmploymentPeriod', 'PersonnelChange')
        AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) <> 5 THEN
    RAISE EXCEPTION 'migration owner must own all five account and personnel tables';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public."EmployeeRegistration", public."SmsChallenge" TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AuthRateLimit" TO %I', runtime_role);
  -- A production migration owner may have broad default ACLs. GRANT alone
  -- cannot narrow those, and table-level UPDATE overrides a column whitelist.
  -- Touch only this runtime's direct ACLs on the two new history tables.
  FOREACH personnel_table IN ARRAY ARRAY['PersonnelChange', 'EmploymentPeriod'] LOOP
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO personnel_columns
      FROM pg_attribute
      WHERE attrelid = format('public.%I', personnel_table)::regclass
        AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', personnel_table, runtime_role);
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %I', personnel_columns, personnel_table, runtime_role);
  END LOOP;
  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public."PersonnelChange_sequence_seq" FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public."PersonnelChange", public."EmploymentPeriod" TO %I', runtime_role);
  EXECUTE format('GRANT USAGE ON SEQUENCE public."PersonnelChange_sequence_seq" TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE ("startedOn", "companyEntityId", "verified", "endedOn", "endedAt", "revision") ON TABLE public."EmploymentPeriod" TO %I', runtime_role);
  -- PUBLIC, inherited and PG16 SET-only ACLs belong to a separate control plane.
  -- Do not revoke other roles; reject the transaction if a reachable role leaks.
  FOR runtime_identity IN
    SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_roles WHERE oid = runtime_oid OR pg_has_role(runtime_oid, oid, 'SET')
  LOOP
    -- ADMIN OPTION can also be exercised through an automatically inherited
    -- member, including after SET ROLE to another permitted identity.
    IF EXISTS (SELECT 1 FROM pg_auth_members membership
        WHERE membership.admin_option AND pg_has_role(runtime_identity.oid, membership.member, 'USAGE')) THEN
      RAISE EXCEPTION 'personnel runtime must not have role administration privileges';
    END IF;
    IF runtime_identity.rolsuper OR runtime_identity.rolcreatedb OR runtime_identity.rolcreaterole
        OR runtime_identity.rolreplication OR runtime_identity.rolbypassrls THEN
      RAISE EXCEPTION 'personnel runtime can assume an unrestricted role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles capability
        WHERE capability.rolname IN ('pg_execute_server_program', 'pg_write_server_files')
          AND pg_has_role(runtime_identity.oid, capability.oid, 'USAGE')) THEN
      RAISE EXCEPTION 'personnel runtime must not have server mutation privileges';
    END IF;
    FOREACH personnel_table IN ARRAY ARRAY['PersonnelChange', 'EmploymentPeriod'] LOOP
      IF has_table_privilege(runtime_identity.oid, format('public.%I', personnel_table), 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
        RAISE EXCEPTION 'personnel runtime has unexpected effective table privileges';
      END IF;
      FOR personnel_column IN SELECT attname FROM pg_attribute
          WHERE attrelid = format('public.%I', personnel_table)::regclass
            AND attnum > 0 AND NOT attisdropped LOOP
        allowed_update := personnel_table = 'EmploymentPeriod' AND personnel_column.attname = ANY
          (ARRAY['startedOn', 'companyEntityId', 'verified', 'endedOn', 'endedAt', 'revision']);
        IF has_column_privilege(runtime_identity.oid, format('public.%I', personnel_table), personnel_column.attname, 'REFERENCES')
            OR (has_column_privilege(runtime_identity.oid, format('public.%I', personnel_table), personnel_column.attname, 'UPDATE')
              AND NOT allowed_update)
            OR (runtime_identity.oid = runtime_oid AND allowed_update
              AND NOT has_column_privilege(runtime_oid, format('public.%I', personnel_table), personnel_column.attname, 'UPDATE')) THEN
          RAISE EXCEPTION 'personnel runtime has unexpected effective column privileges';
        END IF;
      END LOOP;
    END LOOP;
    IF has_sequence_privilege(runtime_identity.oid, 'public."PersonnelChange_sequence_seq"', 'SELECT, UPDATE') THEN
      RAISE EXCEPTION 'personnel runtime has unexpected effective sequence privileges';
    END IF;
  END LOOP;
END;
$$;
COMMIT;
