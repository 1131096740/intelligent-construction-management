-- Owner-only deployment step. Never grant the generic ledger authorization helper.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.contract_finance_runtime_role', :'runtime_role', true);
DO $$
DECLARE runtime_role TEXT := current_setting('app.contract_finance_runtime_role');
BEGIN
  IF runtime_role = current_user OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
  ) THEN RAISE EXCEPTION 'contract finance runtime must be a distinct existing restricted role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'ContractBankVerificationRequest' AND c.relkind = 'r'
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'migration owner must own the bank verification table';
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT) FROM %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.record_verified_bank_observation(JSONB,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.append_company_transfer_event(JSONB,TEXT) TO %I', runtime_role);
  IF has_function_privilege(runtime_role, 'public."authorizeOperatingLedgerWrite"(text,text)', 'EXECUTE')
    OR has_function_privilege(runtime_role, 'public."assertOperatingLedgerWriteContext"(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime must not execute internal ledger authorization helpers';
  END IF;
END;
$$;
COMMIT;
