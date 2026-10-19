-- Migration-owner connection only. No credentials or new identities are provisioned.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.bank_verification_runtime_role', :'runtime_role', true);
DO $$
DECLARE
  runtime_role TEXT := current_setting('app.bank_verification_runtime_role');
  runtime_oid OID;
  issuer_oid OID := 'public.issue_contract_bank_holder(text,text,text,text,text)'::regprocedure;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
    WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls;
  IF runtime_oid IS NULL OR runtime_role = current_user
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid)
    OR NOT has_function_privilege(runtime_oid,
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'bank verification requires the existing restricted operating-ledger runtime role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = issuer_oid AND prosecdef
      AND proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'migration identity must own the bank verification issuer';
  END IF;
  REVOKE ALL ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.assert_fund_movement_write_context() TO %I', runtime_role);
  -- These existing bounded guards are called by bank observation creation under the runtime role.
  -- The secret and transaction-local actor/request checks remain authoritative.
  EXECUTE format('GRANT EXECUTE ON FUNCTION public."authorizeOperatingLedgerWrite"(TEXT,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.assert_fund_execution_server_context(TEXT,TEXT,TEXT) TO %I', runtime_role);
  -- New entries keep service writes narrow without revoking existing fund commands' context grants.
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.record_verified_bank_observation(JSONB,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.append_company_transfer_event(JSONB,TEXT) TO %I', runtime_role);
END;
$$;
COMMIT;
