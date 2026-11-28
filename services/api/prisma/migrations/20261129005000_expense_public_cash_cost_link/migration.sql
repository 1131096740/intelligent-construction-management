CREATE TABLE public."ExpensePublicCashCostLink" (
  "id" TEXT PRIMARY KEY,
  "operationalPaymentId" TEXT NOT NULL REFERENCES public."RegisteredOperationalPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "costImpactId" TEXT NOT NULL REFERENCES public."OperatingImpactEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
  UNIQUE ("operationalPaymentId", "costImpactId")
);

CREATE INDEX "ExpensePublicCashCostLink_costImpactId_idx"
  ON public."ExpensePublicCashCostLink"("costImpactId");

CREATE TRIGGER "ExpensePublicCashCostLink_immutable"
  BEFORE UPDATE OR DELETE ON public."ExpensePublicCashCostLink"
  FOR EACH ROW EXECUTE FUNCTION public.jg_registered_operational_payment_immutable();

CREATE FUNCTION public.jg_expense_public_cash_cost_link_conservation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  receipt_amount BIGINT;
  original_amount BIGINT;
BEGIN
  SELECT payment."amountCents", cost."amountCents" INTO receipt_amount, original_amount
  FROM public."RegisteredOperationalPayment" payment
  JOIN public."RegisteredFundAccount" account ON account.id = payment."accountId"
  JOIN public."ExpenseClaimPaymentExecution" execution ON execution.id = payment."expenseExecutionId"
  JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
  JOIN public."OperatingImpactEntry" cost ON cost.id = NEW."costImpactId"
  JOIN public."OperatingFact" fact ON fact.id = cost."factId" AND fact."projectId" = cost."projectId"
  WHERE payment.id = NEW."operationalPaymentId"
    AND payment.xmin::text = (txid_current() % 4294967296)::text
    AND payment."actualPayerCompanyId" IS NULL
    AND account.kind = 'public_cash' AND account."scopeKey" = 'public_cash'
    AND claim."projectId" = payment."projectId" AND fact."projectId" = payment."projectId"
    AND fact."sourceType" = 'expense_claim_approval' AND fact."sourceBusinessId" = claim.id
    AND fact."entryKind" = 'original' AND fact.status = 'confirmed' AND fact."evidenceLevel" = 'A'
    AND NOT fact."isBeforeOperatingLedgerEffectiveDate"
    AND cost."impactKind" = 'confirmed_cost' AND cost.direction = 'increase' AND cost."numericProtocolVersion" = 1
    AND NOT EXISTS (
      SELECT 1 FROM public."OperatingFact" adjustment
      WHERE adjustment."adjustsFactId" = fact.id AND adjustment.status = 'confirmed'
    )
  FOR UPDATE OF claim;

  IF receipt_amount IS NULL OR original_amount IS NULL OR original_amount <= 0
    OR receipt_amount < (
      SELECT sum(link."amountCents") FROM public."ExpensePublicCashCostLink" link
      WHERE link."operationalPaymentId" = NEW."operationalPaymentId"
    )
    OR original_amount < (
      SELECT sum(link."amountCents") FROM public."ExpensePublicCashCostLink" link
      WHERE link."costImpactId" = NEW."costImpactId"
    ) THEN
    RAISE EXCEPTION 'public cash cost link exceeds its registered expense or original cost' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "ExpensePublicCashCostLink_conservation"
  AFTER INSERT ON public."ExpensePublicCashCostLink" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.jg_expense_public_cash_cost_link_conservation();
