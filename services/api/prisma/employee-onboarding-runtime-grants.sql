-- Run only through the deployment's private migration-owner connection.
-- Account and personnel tables only; no ledger or owner authority is added.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.onboarding_runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime_role TEXT := current_setting('app.onboarding_runtime_role');
  runtime_oid OID;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_roles
    WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls;
  IF runtime_oid IS NULL OR runtime_role = current_user THEN
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
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public."PersonnelChange", public."EmploymentPeriod" TO %I', runtime_role);
  EXECUTE format('GRANT USAGE ON SEQUENCE public."PersonnelChange_sequence_seq" TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE ("startedOn", "companyEntityId", "verified", "endedOn", "endedAt", "revision") ON TABLE public."EmploymentPeriod" TO %I', runtime_role);
END;
$$;
COMMIT;
