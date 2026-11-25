BEGIN;

DO $preimage$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.guard_general_procurement_payment()')
      AND p.prokind = 'f'
      AND NOT p.prosecdef
      AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') =
        '03b22ea31105f1ed639ae8f338bcca71293e884b746354ee9d6085722e7c9fd6'
  ) THEN
    RAISE EXCEPTION 'GENERAL_PROCUREMENT_PAYMENT_GUARD_PREIMAGE' USING ERRCODE = '55000';
  END IF;
END;
$preimage$;

CREATE OR REPLACE FUNCTION public."guard_general_procurement_payment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source public."GeneralProcurement"%ROWTYPE;
  batch public."ActualPurchaseBatch"%ROWTYPE;
  reserved BIGINT;
  batch_used NUMERIC;
  batch_refunded NUMERIC;
  next_exposure NUMERIC;
  previous_exposure NUMERIC := 0;
  active_claims CONSTANT TEXT[] := ARRAY['approval_pending','approved_pending_payment','partially_paid','paid','offset_completed'];
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."generalProcurementId", NEW."generalProcurementRequestKey", NEW."generalProcurementFingerprint") IS DISTINCT FROM (OLD."generalProcurementId", OLD."generalProcurementRequestKey", OLD."generalProcurementFingerprint") THEN
    RAISE EXCEPTION 'procurement payment source is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."generalProcurementId" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW."actualPurchaseBatchId" IS DISTINCT FROM OLD."actualPurchaseBatchId" THEN
    RAISE EXCEPTION 'procurement payment batch is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."actualPurchaseBatchId" IS NOT NULL THEN
    SELECT * INTO batch FROM public."ActualPurchaseBatch" WHERE "id" = NEW."actualPurchaseBatchId" FOR UPDATE;
    SELECT * INTO source FROM public."GeneralProcurement" WHERE "id" = NEW."generalProcurementId" FOR KEY SHARE;
    IF batch."kind" IS DISTINCT FROM 'general' OR batch."procurementId" IS DISTINCT FROM source."id"
      OR batch."status" = 'voided'
      OR source."requestProtocolVersion" IS DISTINCT FROM 2
      OR source."status" IS DISTINCT FROM 'approved_pending_procurement'
      OR NEW."claimType" IS DISTINCT FROM 'incidental_expense'
      OR NEW."projectId" IS DISTINCT FROM source."projectId"
      OR NEW."projectId" IS DISTINCT FROM batch."projectId"
      OR NEW."companyEntityId" IS DISTINCT FROM batch."companyEntityId"
      OR NEW."incidentalExpenseCategory" IS DISTINCT FROM ('procurement_' || source."category")
      OR nullif(btrim(NEW."generalProcurementRequestKey"),'') IS NULL
      OR NOT coalesce(NEW."generalProcurementFingerprint" ~ '^[a-f0-9]{64}$',false)
    THEN
      RAISE EXCEPTION 'procurement payment batch source mismatch' USING ERRCODE = '23514';
    END IF;

    -- Drafts and closed requests reserve no remaining balance. A reduction stays
    -- available when an amount correction has already suspended new commitments.
    next_exposure := NEW."fundedAmountCents" + CASE WHEN NEW."status" = ANY(active_claims)
      THEN greatest(NEW."requestedAmountCents" - NEW."fundedAmountCents",0) ELSE 0 END;
    IF TG_OP = 'UPDATE' THEN
      previous_exposure := OLD."fundedAmountCents" + CASE WHEN OLD."status" = ANY(active_claims)
        THEN greatest(OLD."requestedAmountCents" - OLD."fundedAmountCents",0) ELSE 0 END;
    END IF;
    IF next_exposure > previous_exposure THEN
      SELECT coalesce(sum(c."fundedAmountCents" + CASE WHEN c."status" = ANY(active_claims)
        THEN greatest(c."requestedAmountCents" - c."fundedAmountCents",0) ELSE 0 END),0)
      INTO batch_used FROM public."ExpenseClaim" c
      WHERE c."actualPurchaseBatchId" = batch."id" AND c."id" <> NEW."id";
      SELECT coalesce(sum(r."amountCents"),0) INTO batch_refunded
      FROM public."PaymentExecutionRefund" r
      JOIN public."ExpenseClaimPaymentExecution" e ON e."id" = r."expenseClaimPaymentExecutionId"
      JOIN public."ExpenseClaim" c ON c."id" = e."expenseClaimId"
      WHERE r."executionType" = 'expense_claim_payment_execution' AND c."actualPurchaseBatchId" = batch."id";
      IF batch_used + next_exposure - batch_refunded > batch."effectiveTotalAmountCents" THEN
        RAISE EXCEPTION 'procurement payment exceeds actual purchase batch amount' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO source FROM "GeneralProcurement" WHERE "id" = NEW."generalProcurementId" FOR UPDATE;
  IF source."status" IS DISTINCT FROM 'archived' OR NEW."projectId" IS DISTINCT FROM source."projectId" OR NEW."companyEntityId" IS DISTINCT FROM source."companyEntityId" OR NEW."incidentalExpenseCategory" IS DISTINCT FROM ('procurement_' || source."category") THEN
    RAISE EXCEPTION 'procurement payment source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("requestedAmountCents"),0) INTO reserved FROM "ExpenseClaim" WHERE "generalProcurementId" = source."id" AND "id" <> NEW."id" AND "status" <> 'rejected';
  IF NEW."status" <> 'rejected' AND reserved + NEW."requestedAmountCents" > source."requestedAmountCents" THEN
    RAISE EXCEPTION 'procurement payment exceeds approved amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
