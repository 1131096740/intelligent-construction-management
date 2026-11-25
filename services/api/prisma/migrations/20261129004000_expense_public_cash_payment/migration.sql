-- A registered expense cash payment has no actual-payer company. Its original
-- expense debtor company remains bound to the execution by the existing guard.
ALTER TABLE public."RegisteredOperationalPayment"
  ALTER COLUMN "actualPayerCompanyId" DROP NOT NULL,
  ADD CONSTRAINT "RegisteredOperationalPayment_public_cash_payer" CHECK (
    "actualPayerCompanyId" IS NOT NULL OR (
      "expenseExecutionId" IS NOT NULL AND "actualPayerName" = '公共现金'
    )
  );

CREATE OR REPLACE FUNCTION public.jg_registered_operational_payment_registration()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."RegisteredFundAccount" account
    JOIN LATERAL (
      SELECT registration.id FROM public."FundAccountBalanceRegistration" registration
      WHERE registration."accountId" = account.id AND registration.status = 'confirmed'
      ORDER BY registration.version DESC LIMIT 1
    ) active ON true
    WHERE account.id = NEW."accountId"
      AND (account.kind = 'company' OR (account.kind = 'public_cash'
        AND account."scopeKey" = 'public_cash' AND account."companyEntityId" IS NULL
        AND EXISTS (
          SELECT 1 FROM public."PublicCashCustody" custody
          WHERE custody."accountId" = account.id
            AND custody."currentCustodianId" = NEW."createdByUserId"
        )
      ))
      AND active.id = NEW."previousRegistrationId"
      AND account.xmin::text = (txid_current() % 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'registered operational payment needs the current locked funding account and authorized payer';
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION public.jg_registered_operational_payment_conservation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  fact public."RegisteredOperationalPayment";
  prior public."FundAccountBalanceRegistration";
  snapshot public."FundAccountBalanceRegistration";
  execution_id TEXT;
  execution_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'FundAccountBalanceRegistration' THEN
    SELECT * INTO STRICT fact FROM public."RegisteredOperationalPayment" WHERE "registrationId" = NEW.id;
  ELSE
    SELECT * INTO STRICT fact FROM public."RegisteredOperationalPayment" WHERE id = NEW.id;
  END IF;
  SELECT * INTO STRICT prior FROM public."FundAccountBalanceRegistration" WHERE id = fact."previousRegistrationId";
  SELECT * INTO STRICT snapshot FROM public."FundAccountBalanceRegistration" WHERE id = fact."registrationId";
  IF fact."expenseExecutionId" IS NOT NULL THEN
    execution_id := fact."expenseExecutionId";
    execution_type := 'expense_claim_payment_execution';
    IF NOT EXISTS (
      SELECT 1 FROM public."ExpenseClaimPaymentExecution" execution
      JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
      WHERE execution.id = execution_id AND execution."amountCents" = fact."amountCents"
        AND execution."paidAt" = fact."paidAt" AND execution."recordedByUserId" = fact."actorUserId"
        AND execution.xmin::text = (txid_current() % 4294967296)::text
        AND claim."projectId" = fact."projectId" AND claim."companyEntityId" = fact."originalDebtorCompanyId"
    ) THEN
      RAISE EXCEPTION 'registered expense payment does not match its original execution';
    END IF;
  ELSE
    execution_id := fact."spotExecutionId";
    execution_type := 'spot_procurement_payment_execution';
    IF NOT EXISTS (
      SELECT 1 FROM public."SpotProcurementPaymentExecution" execution
      JOIN public."SpotProcurementPayment" request ON request.id = execution."paymentId"
      WHERE execution.id = execution_id AND execution."amountCents" = fact."amountCents"
        AND execution."paidAt" = fact."paidAt" AND execution."executedByUserId" = fact."actorUserId"
        AND execution.xmin::text = (txid_current() % 4294967296)::text
        AND request."projectId" = fact."projectId" AND request."payerCompanyEntityId" = fact."originalDebtorCompanyId"
    ) THEN
      RAISE EXCEPTION 'registered procurement payment does not match its original execution';
    END IF;
  END IF;
  IF snapshot.kind <> 'operational_payment' OR snapshot."accountId" <> fact."accountId" OR prior."accountId" <> fact."accountId"
    OR snapshot."previousRegistrationId" IS DISTINCT FROM prior.id OR prior."balanceYuan" IS NULL
    OR ((fact."paidAt" + interval '8 hours')::date)::text <= prior."asOfDate"
    OR snapshot."balanceYuan" <> prior."balanceYuan" - fact."amountCents"::numeric / 100
    OR snapshot."coveredExecutionIds" IS DISTINCT FROM prior."coveredExecutionIds" OR snapshot."asOfDate" IS DISTINCT FROM prior."asOfDate"
    OR snapshot."createdByUserId" IS DISTINCT FROM fact."actorUserId" OR snapshot."confirmedByUserId" IS DISTINCT FROM fact."actorUserId"
    OR NOT EXISTS (
      SELECT 1 FROM public."RegisteredFundAccount" account
      LEFT JOIN public."CompanyEntity" company ON company.id = account."companyEntityId"
      WHERE account.id = fact."accountId" AND (
        (account.kind = 'company' AND company.id = fact."actualPayerCompanyId" AND company.name = fact."actualPayerName")
        OR (account.kind = 'public_cash' AND account."scopeKey" = 'public_cash' AND account."companyEntityId" IS NULL
          AND fact."actualPayerCompanyId" IS NULL AND fact."expenseExecutionId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public."PublicCashCustody" custody
            JOIN public."User" keeper ON keeper.id = custody."currentCustodianId" AND keeper."isActive"
            JOIN public."UserPosition" assignment ON assignment."userId" = keeper.id AND assignment."projectId" IS NULL
            JOIN public."Position" position ON position.id = assignment."positionId" AND position.key = 'comprehensive_director'
            WHERE custody."accountId" = account.id AND keeper.id = fact."actorUserId"
          )
        )
      )
    )
    OR fact."amountCents" <> (SELECT coalesce(sum(line."amountCents"), 0) FROM public."RegisteredOperationalPaymentAllocation" line WHERE line."paymentId" = fact.id)
    OR EXISTS (SELECT 1 FROM public."ProjectFundingAllocation" legacy WHERE legacy."executionId" = execution_id AND legacy."executionType" = execution_type)
  THEN
    RAISE EXCEPTION 'registered operational payment requires exactly one balanced funding debit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."RegisteredOperationalPaymentAllocation" line
    JOIN public."FundAccountSourceBatch" batch ON batch.id = line."sourceBatchId"
    WHERE line."paymentId" = fact.id AND (
      batch."registrationId" <> prior.id OR NOT (
        (batch."projectStatus" = 'project' AND batch."projectId" IS NOT DISTINCT FROM fact."projectId")
        OR (batch."projectStatus" = 'pending' AND fact."actualPayerCompanyId" IS NULL)
        OR (batch."projectStatus" <> 'project' AND fact."originalDebtorCompanyId" <> fact."actualPayerCompanyId"
          AND EXISTS (
            SELECT 1 FROM public."jg_registered_fund_source_ownership"(ARRAY[batch.id]) source
            WHERE source."companyId" = fact."actualPayerCompanyId" AND source.continuous
          )
        )
      )
    )
  ) OR (SELECT count(*) FROM public."FundAccountSourceBatch" batch WHERE batch."registrationId" = snapshot.id) <>
    (SELECT count(*) FROM public."FundAccountSourceBatch" batch WHERE batch."registrationId" = prior.id)
    OR EXISTS (
      SELECT 1 FROM public."FundAccountSourceBatch" parent
      LEFT JOIN LATERAL (
        SELECT count(*) AS matches FROM public."FundAccountSourceBatch" child
        WHERE child."registrationId" = snapshot.id AND child."previousSourceBatchId" = parent.id
          AND child."lineNo" = parent."lineNo" AND child."sourceStatus" = parent."sourceStatus"
          AND child."sourceName" IS NOT DISTINCT FROM parent."sourceName" AND child."projectStatus" = parent."projectStatus"
          AND child."projectId" IS NOT DISTINCT FROM parent."projectId"
          AND child."amountYuan" = parent."amountYuan" - coalesce((
            SELECT line."amountCents"::numeric / 100 FROM public."RegisteredOperationalPaymentAllocation" line
            WHERE line."sourceBatchId" = parent.id AND line."paymentId" = fact.id
          ), 0)
      ) children ON true
      WHERE parent."registrationId" = prior.id AND children.matches <> 1
    ) THEN
    RAISE EXCEPTION 'registered operational payment changes its project source identity';
  END IF;
  RETURN NULL;
END
$$;
