BEGIN;

-- Preserve existing receipt, custody, project, refund, and same-claim checks.
-- A cash link is in cents and cannot exceed the floor of its exact cost line.
DO $upgrade$
DECLARE
  routine record;
  before_row record;
  body_after text;
  protocol_before constant text := 'AND cost."numericProtocolVersion" = 1';
  protocol_after constant text := $guard$AND (
      cost."numericProtocolVersion" = 1
      OR (cost."numericProtocolVersion" = 2 AND fact."numericProtocolVersion" = 2
        AND claim."claimType" = 'reimbursement' AND cost."amountYuan" > 0
        AND NEW."amountCents" <= floor(cost."amountYuan" * 100))
    )$guard$;
  proof_before constant text := 'AND cost."numericProtocolVersion" = 1';
  proof_after constant text := $guard$AND (
      cost."numericProtocolVersion" = 1
      OR (cost."numericProtocolVersion" = 2 AND fact."numericProtocolVersion" = 2
        AND claim."claimType" = 'reimbursement' AND cost."amountYuan" > 0
        AND link."amountCents" <= floor(cost."amountYuan" * 100))
    )$guard$;
  amount_before constant text := 'payment."amountCents", cost."amountCents" INTO receipt_amount, original_amount';
  amount_after constant text := $amount$payment."amountCents",
    CASE cost."numericProtocolVersion" WHEN 1 THEN cost."amountCents"
      WHEN 2 THEN floor(cost."amountYuan" * 100)::bigint END
  INTO receipt_amount, original_amount$amount$;
BEGIN
  FOR routine IN SELECT * FROM (VALUES
    ('public.jg_expense_public_cash_cost_link_conservation()'::regprocedure,
      '0621d11363cb4ff868db3430993acc9c751046c86e76464ab979086b6945948f', true),
    ('public.jg_expense_cash_cost_attribution_check()'::regprocedure,
      '3a95d150516adcfcdea01185fd2c76b2f00ba00759775bc5bcf9922f07c0876e', false)
  ) AS expected(oid, digest, is_conservation)
  LOOP
    SELECT p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p) - 'prosrc' AS metadata
    INTO STRICT before_row FROM pg_proc p
    WHERE p.oid = routine.oid AND p.proowner = current_user::regrole::oid
      AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype;
    IF encode(sha256(convert_to(before_row.prosrc, 'UTF8')), 'hex') IS DISTINCT FROM routine.digest
      OR cardinality(string_to_array(before_row.prosrc, protocol_before)) <> 2
      OR (routine.is_conservation AND cardinality(string_to_array(before_row.prosrc, amount_before)) <> 2)
    THEN
      RAISE EXCEPTION 'REIMBURSEMENT_EXACT_CASH_COST_LINK_PREIMAGE' USING ERRCODE = '55000';
    END IF;
    body_after := CASE WHEN routine.is_conservation
      THEN replace(replace(before_row.prosrc, protocol_before, protocol_after), amount_before, amount_after)
      ELSE replace(before_row.prosrc, proof_before, proof_after) END;
    EXECUTE replace(before_row.definition, before_row.prosrc, body_after);
    IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid = routine.oid
      AND p.prosrc = body_after AND to_jsonb(p) - 'prosrc' = before_row.metadata)
    THEN
      RAISE EXCEPTION 'REIMBURSEMENT_EXACT_CASH_COST_LINK_CATALOG' USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$upgrade$;

COMMIT;
