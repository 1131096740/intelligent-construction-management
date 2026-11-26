ALTER TABLE public."OperatingCostAttributionConfirmation"
  ADD COLUMN "expenseCashCostLinkId" TEXT REFERENCES public."ExpensePublicCashCostLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "attributedAmountCents" BIGINT,
  DROP CONSTRAINT "OperatingCostAttributionConfirmation_active_key_check",
  ADD CONSTRAINT "OperatingCostAttributionConfirmation_active_key_check" CHECK (
    ("expenseCashCostLinkId" IS NULL AND "attributedAmountCents" IS NULL
      AND (("status" IN ('pending_review', 'confirmed') AND "activeKey" = 'active')
        OR ("status" = 'returned' AND "activeKey" IS NULL)))
    OR ("expenseCashCostLinkId" IS NOT NULL AND "attributedAmountCents" IS NOT NULL AND "attributedAmountCents" > 0
      AND (("status" IN ('pending_review', 'confirmed') AND "activeKey" IS NOT DISTINCT FROM ('cash:' || "expenseCashCostLinkId"))
        OR ("status" = 'returned' AND "activeKey" IS NULL)))
  );

CREATE INDEX "OperatingCostAttributionConfirmation_expenseCashCostLinkId_idx"
  ON public."OperatingCostAttributionConfirmation"("expenseCashCostLinkId");

CREATE FUNCTION public.jg_expense_cash_cost_attribution_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  expense_execution_id TEXT;
  payment_id TEXT;
  link_amount BIGINT;
  payment_amount BIGINT;
  refunded_amount BIGINT;
  available_amount BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."expenseCashCostLinkId" IS NOT NULL THEN
      RAISE EXCEPTION 'linked cash cost attribution history cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."expenseCashCostLinkId" IS NOT NULL OR NEW."expenseCashCostLinkId" IS NOT NULL) AND (
      OLD."expenseCashCostLinkId" IS DISTINCT FROM NEW."expenseCashCostLinkId"
      OR OLD."attributedAmountCents" IS DISTINCT FROM NEW."attributedAmountCents"
      OR OLD."operatingFactId" IS DISTINCT FROM NEW."operatingFactId"
      OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
      OR OLD."companyEntityId" IS DISTINCT FROM NEW."companyEntityId"
      OR OLD."companyEntityVersionId" IS DISTINCT FROM NEW."companyEntityVersionId"
      OR OLD."companyNameSnapshot" IS DISTINCT FROM NEW."companyNameSnapshot"
      OR OLD."companyCreditCodeSnapshot" IS DISTINCT FROM NEW."companyCreditCodeSnapshot"
      OR OLD."requestedByUserId" IS DISTINCT FROM NEW."requestedByUserId"
      OR OLD."requestedAt" IS DISTINCT FROM NEW."requestedAt"
      OR OLD."reason" IS DISTINCT FROM NEW."reason"
      OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
      OR NEW."revision" <> OLD."revision" + 1
      OR OLD."status" <> 'pending_review' OR NEW."status" NOT IN ('confirmed', 'returned')
    ) THEN
      RAISE EXCEPTION 'linked cash cost attribution is frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."expenseCashCostLinkId" IS NULL OR NEW.status = 'returned' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'pending_review' THEN
    RAISE EXCEPTION 'linked cash cost attribution needs a request and review' USING ERRCODE = '23514';
  END IF;

  SELECT execution.id, payment.id, link."amountCents", payment."amountCents"
    INTO expense_execution_id, payment_id, link_amount, payment_amount
  FROM public."ExpensePublicCashCostLink" link
  JOIN public."OperatingImpactEntry" cost ON cost.id = link."costImpactId"
  JOIN public."OperatingFact" fact ON fact.id = cost."factId"
  JOIN public."RegisteredOperationalPayment" payment ON payment.id = link."operationalPaymentId"
  JOIN public."ExpenseClaimPaymentExecution" execution ON execution.id = payment."expenseExecutionId"
  JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
  WHERE link.id = NEW."expenseCashCostLinkId" AND fact.id = NEW."operatingFactId"
    AND fact."projectId" = NEW."projectId" AND cost."projectId" = NEW."projectId"
    AND claim."projectId" = NEW."projectId" AND payment."projectId" = NEW."projectId"
    AND payment."actualPayerCompanyId" IS NULL
    AND fact."sourceType" = 'expense_claim_approval' AND fact."sourceBusinessId" = claim.id
    AND fact.status = 'confirmed' AND fact."entryKind" = 'original' AND fact."evidenceLevel" = 'A'
    AND NOT fact."isBeforeOperatingLedgerEffectiveDate"
    AND fact."costBearingCompanySubjectKind" IS NULL AND fact."costBearingCompanySubjectId" IS NULL
    AND cost."impactKind" = 'confirmed_cost' AND cost.direction = 'increase' AND cost."numericProtocolVersion" = 1
    AND cost."subjectKind" IS NULL AND cost."subjectId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM public."OperatingFact" adjustment
      WHERE adjustment."adjustsFactId" = fact.id AND adjustment.status = 'confirmed')
  FOR UPDATE OF claim;

  IF expense_execution_id IS NULL THEN
    RAISE EXCEPTION 'linked cash cost attribution needs its original unassigned confirmed cost' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(refund."amountCents"), 0) INTO refunded_amount
    FROM public."PaymentExecutionRefund" refund
    WHERE refund."expenseClaimPaymentExecutionId" = expense_execution_id;

  available_amount := CASE
    WHEN refunded_amount = 0 THEN link_amount
    WHEN link_amount = payment_amount AND 1 = (
      SELECT count(*) FROM public."ExpensePublicCashCostLink" link WHERE link."operationalPaymentId" = payment_id
    ) THEN greatest(link_amount - refunded_amount, 0)
    ELSE 0 END;

  IF available_amount <= 0 OR NEW."attributedAmountCents" IS DISTINCT FROM available_amount THEN
    RAISE EXCEPTION 'linked cash cost attribution exceeds current proven net payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ExpenseCashCostAttribution_check"
  BEFORE INSERT OR UPDATE OR DELETE ON public."OperatingCostAttributionConfirmation"
  FOR EACH ROW EXECUTE FUNCTION public.jg_expense_cash_cost_attribution_check();
