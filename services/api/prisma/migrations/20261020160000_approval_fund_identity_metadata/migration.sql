-- Preserve the original two-step contract and all frozen-action hashes while
-- allowing the V6 immutable approver/represented names beside the original step.
BEGIN;
DO $$
DECLARE
  definition TEXT;
  needle TEXT := 'action_log."metadata" =';
BEGIN
  SELECT pg_get_functiondef('public.assert_fund_execution_case_contract(text)'::regprocedure) INTO definition;
  IF (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 5
     OR position('fund_execution_case_approval_action_chain_invalid' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fund execution approval metadata contract';
  END IF;
  definition := replace(definition, needle, '(action_log."metadata" - ''approverName'' - ''representedName'') =');
  EXECUTE definition;
END;
$$;
COMMIT;
