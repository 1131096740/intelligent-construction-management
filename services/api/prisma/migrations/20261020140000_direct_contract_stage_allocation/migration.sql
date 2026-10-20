-- A confirmed direct-payment contract uses its frozen contractual stage rather
-- than a settlement. Keep the settlement requirement for every other path.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."PaymentExecutionAllocation"'::regclass
      AND conname = 'PaymentExecutionAllocation_settlement_required_check'
      AND contype = 'c'
      AND pg_get_constraintdef(oid) = 'CHECK (("settlementId" IS NOT NULL))'
  ) THEN
    RAISE EXCEPTION 'Unexpected payment allocation settlement constraint';
  END IF;
END;
$$;

CREATE FUNCTION public.guard_direct_contract_stage_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matched BOOLEAN;
BEGIN
  IF NEW."settlementId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Cross-table provenance is deliberately checked in addition to the CHECK
  -- below. A nullable settlement or a contract-shaped source string is not proof.
  SELECT TRUE INTO matched
  FROM public."PaymentExecution" execution
  JOIN public."PaymentRequest" request
    ON request."id" = execution."paymentRequestId"
  JOIN public."ContractVersion" version
    ON version."id" = request."contractVersionId"
  JOIN public."Contract" contract
    ON contract."id" = version."contractId"
  JOIN public."PaymentTermsVersion" terms
    ON terms."id" = request."paymentTermsVersionId"
  JOIN public."PaymentTermsStage" stage
    ON stage."id" = request."paymentTermsStageId"
  WHERE execution."id" = NEW."paymentExecutionId"
    AND execution."settlementId" IS NULL
    AND execution."executedByUserId" = NEW."createdByUserId"
    AND request."id" = NEW."paymentRequestId"
    AND request."sourceType" = 'contract_due'
    AND request."settlementId" IS NULL
    AND request."status" IN ('approved_pending_payment', 'partially_paid', 'paid', 'finance_recorded')
    AND request."approvedAmountCents" IS NOT NULL
    AND NEW."amountCents" <= request."approvedAmountCents"
    AND request."projectId" = NEW."projectId"
    AND contract."projectId" = NEW."projectId"
    AND request."contractId" = NEW."contractId"
    AND version."contractId" = NEW."contractId"
    AND version."id" = NEW."contractVersionId"
    AND version."settlementMode" = 'direct_payment'
    AND version."settlementModeConfirmedAt" IS NOT NULL
    AND version."settlementModeConfirmedByUserId" IS NOT NULL
    AND version."effectiveAt" IS NOT NULL
    AND terms."contractId" = NEW."contractId"
    AND terms."contractVersionId" = version."id"
    AND terms."id" = NEW."paymentTermsVersionId"
    AND stage."paymentTermsVersionId" = terms."id"
    AND stage."id" = NEW."stageId"
    AND stage."stageType" IN ('progress', 'final', 'retention')
    AND stage."basis" = 'contract_amount'
    AND stage."triggerAnchor" = 'contract_effective'
    AND stage."dueDays" >= 0
    AND ((stage."fixedAmountCents" > 0 AND stage."ratioBps" IS NULL)
      OR (stage."fixedAmountCents" IS NULL AND stage."ratioBps" BETWEEN 1 AND 10000))
    AND NEW."sourceType" = 'contract_due'
    AND NEW."allocationType" = 'contract_due_payment'
    AND NEW."allocationOrder" = 0
    AND NEW."sourceRowId" = 'contract:' || terms."id" || ':' || stage."id"
    AND NEW."stageType" = stage."stageType"
    AND NEW."stageName" IS NOT DISTINCT FROM stage."name"
    AND NEW."triggerAnchor" = stage."triggerAnchor"
    AND NEW."dueDays" = stage."dueDays"
    AND NEW."ratioBps" IS NOT DISTINCT FROM stage."ratioBps"
    AND NEW."fixedAmountCents" IS NOT DISTINCT FROM stage."fixedAmountCents"
    AND NEW."sourceEffectiveAt" = version."effectiveAt"
    AND NEW."expectedPayableAt" = version."effectiveAt" + stage."dueDays" * INTERVAL '1 day'
    AND NEW."sourcePayableAmountCents" = LEAST(
      version."amountCents"::NUMERIC,
      COALESCE(stage."fixedAmountCents"::NUMERIC,
        trunc(version."amountCents"::NUMERIC * stage."ratioBps" / 10000))
    )
  FOR SHARE OF execution, request, version, terms, stage;

  IF matched IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PaymentExecutionAllocation_direct_contract_stage_guard',
      MESSAGE = 'Direct contract allocation does not match its frozen payment stage';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentExecutionAllocation_direct_contract_stage_guard"
  BEFORE INSERT ON public."PaymentExecutionAllocation"
  FOR EACH ROW EXECUTE FUNCTION public.guard_direct_contract_stage_allocation();

ALTER TABLE public."PaymentExecutionAllocation"
  DROP CONSTRAINT "PaymentExecutionAllocation_settlement_required_check",
  ADD CONSTRAINT "PaymentExecutionAllocation_settlement_required_check"
  CHECK (
    "settlementId" IS NOT NULL
    OR (
      "sourceType" = 'contract_due'
      AND "allocationType" = 'contract_due_payment'
      AND "contractVersionId" IS NOT NULL
      AND "stageId" IS NOT NULL
      AND "triggerAnchor" = 'contract_effective'
      AND "sourceEffectiveAt" IS NOT NULL
    ) IS TRUE
  );

COMMIT;
