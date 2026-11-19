BEGIN;
ALTER TABLE public."CompanyTransfer"
  ADD COLUMN "requiresParallelRepaymentApproval" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.guard_company_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ApprovalInstance"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'company_transfer_immutable'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) THEN RAISE EXCEPTION 'company_transfer_terms_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD."status"<>'submitted' THEN RAISE EXCEPTION 'company_transfer_decision_final'; END IF;
 IF NEW."status"='approved' THEN
  SELECT * INTO a FROM "ApprovalInstance" WHERE "id"=NEW."approvalInstanceId";
  IF a."businessType" IS DISTINCT FROM 'company_transfer' OR a."businessId" IS DISTINCT FROM NEW."id" OR a."status" IS DISTINCT FROM 'approved' OR NEW."approvedByUserId" IS NULL OR (NOT NEW."requiresParallelRepaymentApproval" AND NEW."approvedByUserId"=NEW."applicantUserId") OR NEW."approvedAt" IS NULL OR NOT EXISTS(SELECT 1 FROM "ApprovalActionLog" WHERE "approvalInstanceId"=a."id" AND "action"='approve' AND "actorUserId"=NEW."approvedByUserId" AND "approvedRoleKey" IN ('chairman','general_manager') AND "signatureVersionIdSnapshot" IS NOT NULL) THEN RAISE EXCEPTION 'company_transfer_leader_approval_required'; END IF;
 END IF; RETURN NEW;
END; $$;

CREATE FUNCTION public.guard_company_proxy_repayment_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approval public."ApprovalInstance"%ROWTYPE;
  duty RECORD;
  node JSONB;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."requiresParallelRepaymentApproval" IS DISTINCT FROM (
    NEW."kind" = 'repayment' AND NEW."sourceProjectId" IS NOT NULL
    AND NEW."sourceProjectId" IS NOT DISTINCT FROM NEW."destinationProjectId"
    AND (
      NEW."originalProxyId" IS NOT NULL OR NEW."originalInterEntityRelationshipId" IS NOT NULL
      OR NEW."originalOperationalPaymentId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM public."FundMovementRelationshipEntry" move
        WHERE move."id" = NEW."originalFundMovementRelationshipId" AND move."entryKind" = 'proxy_payment')
    )
  ) THEN
    RAISE EXCEPTION 'company_proxy_repayment_parallel_approval_required';
  END IF;
  IF NOT NEW."requiresParallelRepaymentApproval" THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."approvalInstanceId" IS DISTINCT FROM OLD."approvalInstanceId" THEN
    RAISE EXCEPTION 'company_proxy_repayment_approval_round_immutable';
  END IF;

  SELECT * INTO approval FROM public."ApprovalInstance" WHERE "id" = NEW."approvalInstanceId";
  IF approval."businessType" IS DISTINCT FROM 'company_transfer'
    OR approval."businessId" IS DISTINCT FROM NEW."id"
    OR approval."flowType" IS DISTINCT FROM 'company_transfer.approve'
    OR approval."applicantUserId" IS DISTINCT FROM NEW."applicantUserId"
    OR jsonb_typeof(approval."frozenNodes") IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'company_proxy_repayment_approval_round_required';
  END IF;
  IF jsonb_array_length(approval."frozenNodes") <> 4 THEN
    RAISE EXCEPTION 'company_proxy_repayment_four_duties_required';
  END IF;

  FOR duty IN SELECT * FROM (VALUES
    (0, ARRAY['comprehensive_director'], '{"comprehensive_director":"global"}'::jsonb),
    (1, ARRAY['project_manager'], '{"project_manager":"project"}'::jsonb),
    (2, ARRAY['finance_director'], '{"finance_director":"global"}'::jsonb),
    (3, ARRAY['chairman','general_manager'], '{"chairman":"global","general_manager":"global"}'::jsonb)
  ) AS duties(index, roles, scopes)
  LOOP
    node := approval."frozenNodes" -> duty.index;
    IF node -> 'protocolVersion' IS DISTINCT FROM '1'::jsonb
      OR node ->> 'executionMode' IS DISTINCT FROM 'parallel'
      OR node ->> 'mode' IS DISTINCT FROM 'any'
      OR node -> 'roleKeys' IS DISTINCT FROM to_jsonb(duty.roles)
      OR node -> 'roleScopesByRole' IS DISTINCT FROM duty.scopes
    THEN
      RAISE EXCEPTION 'company_proxy_repayment_duty_protocol_required';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW."status" <> 'submitted' OR node -> 'approvedRoleKeys' IS DISTINCT FROM '[]'::jsonb) THEN
      RAISE EXCEPTION 'company_proxy_repayment_initial_duties_must_be_pending';
    END IF;
    IF NEW."status" = 'approved' AND NOT EXISTS (
      SELECT 1 FROM public."ApprovalActionLog" signed
      WHERE signed."approvalInstanceId" = approval."id"
        AND signed."action" = 'approve'
        AND (
          signed."actorUserId" <> NEW."applicantUserId"
          OR (signed."metadata" -> 'selfReview' = 'true'::jsonb
            AND length(btrim(signed."metadata" ->> 'selfReviewReason')) > 0)
        )
        AND signed."approvedRoleKey" = ANY(duty.roles)
        AND signed."signatureVersionIdSnapshot" IS NOT NULL
        AND signed."metadata" -> 'nodeIndex' = to_jsonb(duty.index)
        AND node -> 'approvedRoleKeys' = jsonb_build_array(signed."approvedRoleKey")
        AND (duty.index <> 3 OR signed."actorUserId" = NEW."approvedByUserId")
    ) THEN
      RAISE EXCEPTION 'company_proxy_repayment_four_signed_duties_required';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CompanyTransfer_proxy_repayment_approval_guard"
BEFORE INSERT OR UPDATE ON public."CompanyTransfer"
FOR EACH ROW EXECUTE FUNCTION public.guard_company_proxy_repayment_approval();

CREATE TABLE public."RegisteredOperationalPayment" (
  "id" TEXT PRIMARY KEY,
  "expenseExecutionId" TEXT UNIQUE REFERENCES public."ExpenseClaimPaymentExecution"("id") ON DELETE RESTRICT,
  "spotExecutionId" TEXT UNIQUE REFERENCES public."SpotProcurementPaymentExecution"("id") ON DELETE RESTRICT,
  "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
  "registrationId" TEXT NOT NULL UNIQUE REFERENCES public."FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
  "previousRegistrationId" TEXT NOT NULL REFERENCES public."FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
  "projectId" TEXT NOT NULL REFERENCES public."Project"("id") ON DELETE RESTRICT,
  "originalDebtorCompanyId" TEXT NOT NULL REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
  "actualPayerCompanyId" TEXT NOT NULL REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
  "actualPayerName" TEXT NOT NULL CHECK (length(btrim("actualPayerName")) > 0),
  "actorUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
  "paidAt" TIMESTAMP(3) NOT NULL,
  "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (num_nonnulls("expenseExecutionId", "spotExecutionId") = 1)
);

CREATE INDEX "RegisteredOperationalPayment_projectId_debtor_actualPayer_idx"
  ON public."RegisteredOperationalPayment"("projectId", "originalDebtorCompanyId", "actualPayerCompanyId");

ALTER TABLE public."CompanyTransfer"
  ADD COLUMN "originalOperationalPaymentId" TEXT REFERENCES public."RegisteredOperationalPayment"("id") ON DELETE RESTRICT;
DO $$
DECLARE original_check TEXT;
BEGIN
  SELECT conname INTO STRICT original_check FROM pg_constraint
  WHERE conrelid = 'public."CompanyTransfer"'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%num_nonnulls(%originalTransferId%originalInterEntityRelationshipId%';
  EXECUTE format('ALTER TABLE public."CompanyTransfer" DROP CONSTRAINT %I', original_check);
END
$$;
ALTER TABLE public."CompanyTransfer" ADD CONSTRAINT "CompanyTransfer_exactly_one_original" CHECK (
  num_nonnulls("originalTransferId", "originalProxyId", "originalFundMovementRelationshipId",
    "originalInterEntityRelationshipId", "originalOperationalPaymentId") = CASE WHEN "kind" = 'repayment' THEN 1 ELSE 0 END
);

CREATE TABLE public."RegisteredOperationalPaymentAllocation" (
  "paymentId" TEXT NOT NULL REFERENCES public."RegisteredOperationalPayment"("id") ON DELETE RESTRICT,
  "sourceBatchId" TEXT NOT NULL REFERENCES public."FundAccountSourceBatch"("id") ON DELETE RESTRICT,
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
  PRIMARY KEY ("paymentId", "sourceBatchId")
);

ALTER TABLE public."FundAccountBalanceRegistration"
  DROP CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check",
  ADD CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check" CHECK (
    ("kind" = 'opening' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed')
    OR ("kind" = 'correction' AND "transferId" IS NULL AND "approvalInstanceId" IS NOT NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review', 'confirmed', 'returned', 'withdrawn'))
    OR ("kind" = 'transfer' AND "transferId" IS NOT NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
    OR ("kind" IN ('advance_receipt', 'principal_return', 'operational_payment') AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
  );

CREATE FUNCTION public.jg_registered_operational_payment_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'registered operational payments are append only';
END
$$;
CREATE TRIGGER "RegisteredOperationalPayment_immutable"
  BEFORE UPDATE OR DELETE ON public."RegisteredOperationalPayment"
  FOR EACH ROW EXECUTE FUNCTION public.jg_registered_operational_payment_immutable();
CREATE TRIGGER "RegisteredOperationalPaymentAllocation_immutable"
  BEFORE UPDATE OR DELETE ON public."RegisteredOperationalPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION public.jg_registered_operational_payment_immutable();

CREATE FUNCTION public.jg_registered_operational_payment_registration()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."RegisteredFundAccount" account
    JOIN LATERAL (
      SELECT registration.id FROM public."FundAccountBalanceRegistration" registration
      WHERE registration."accountId" = account.id AND registration.status = 'confirmed'
      ORDER BY registration.version DESC LIMIT 1
    ) active ON true
    WHERE account.id = NEW."accountId" AND account.kind = 'company'
      AND active.id = NEW."previousRegistrationId"
      AND account.xmin::text = (txid_current() % 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'registered operational payment needs the current locked company account';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "FundAccountBalanceRegistration_operational_payment_start"
  BEFORE INSERT ON public."FundAccountBalanceRegistration"
  FOR EACH ROW WHEN (NEW.kind = 'operational_payment')
  EXECUTE FUNCTION public.jg_registered_operational_payment_registration();

CREATE FUNCTION public.jg_registered_operational_payment_allocation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."RegisteredOperationalPayment" payment
    WHERE payment.id = NEW."paymentId" AND payment.xmin::text = (txid_current() % 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'registered operational payment allocations require same transaction';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "RegisteredOperationalPaymentAllocation_insert"
  BEFORE INSERT ON public."RegisteredOperationalPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION public.jg_registered_operational_payment_allocation();

CREATE FUNCTION public.jg_registered_operational_payment_conservation()
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
    OR NOT EXISTS (SELECT 1 FROM public."RegisteredFundAccount" account JOIN public."CompanyEntity" company ON company.id = account."companyEntityId"
      WHERE account.id = fact."accountId" AND account.kind = 'company' AND company.id = fact."actualPayerCompanyId" AND company.name = fact."actualPayerName")
    OR fact."amountCents" <> (SELECT coalesce(sum(line."amountCents"), 0) FROM public."RegisteredOperationalPaymentAllocation" line WHERE line."paymentId" = fact.id)
    OR EXISTS (SELECT 1 FROM public."ProjectFundingAllocation" legacy WHERE legacy."executionId" = execution_id AND legacy."executionType" = execution_type)
  THEN
    RAISE EXCEPTION 'registered operational payment requires exactly one balanced company debit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."RegisteredOperationalPaymentAllocation" line
    JOIN public."FundAccountSourceBatch" batch ON batch.id = line."sourceBatchId"
    WHERE line."paymentId" = fact.id AND (
      batch."registrationId" <> prior.id OR NOT (
        (batch."projectStatus" = 'project' AND batch."projectId" IS NOT DISTINCT FROM fact."projectId")
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
CREATE CONSTRAINT TRIGGER "RegisteredOperationalPayment_conservation"
  AFTER INSERT ON public."RegisteredOperationalPayment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jg_registered_operational_payment_conservation();
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_operational_payment"
  AFTER INSERT ON public."FundAccountBalanceRegistration"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind = 'operational_payment')
  EXECUTE FUNCTION public.jg_registered_operational_payment_conservation();

CREATE OR REPLACE FUNCTION public.company_transfer_debt_limit(t "CompanyTransfer", cutoff TIMESTAMP DEFAULT NULL) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE loan "CompanyTransfer"%ROWTYPE; proxy "ContractProxyExecution"%ROWTYPE; movement "FundMovementRelationshipEntry"%ROWTYPE; inter "InterEntityRelationshipEntry"%ROWTYPE; operational public."RegisteredOperationalPayment"%ROWTYPE; cap BIGINT; changes BIGINT;
BEGIN
 IF t."kind"<>'repayment' THEN RETURN NULL; END IF;
 IF t."originalTransferId" IS NOT NULL THEN
  SELECT * INTO loan FROM "CompanyTransfer" WHERE "id"=t."originalTransferId" FOR UPDATE;
  IF loan."kind" IS DISTINCT FROM 'loan' OR loan."status" IS DISTINCT FROM 'approved' OR loan."sourceCompanyId"<>t."destinationCompanyId" OR loan."destinationCompanyId"<>t."sourceCompanyId" OR loan."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" OR loan."destinationProjectId" IS DISTINCT FROM t."sourceProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO cap FROM "CompanyTransferEvent" WHERE "transferId"=loan."id" AND "kind"='incoming' AND (cutoff IS NULL OR "occurredAt"<=cutoff);
 ELSIF t."originalProxyId" IS NOT NULL THEN
  SELECT * INTO proxy FROM "ContractProxyExecution" WHERE "id"=t."originalProxyId" FOR UPDATE;
  IF proxy."status" IS DISTINCT FROM 'confirmed' OR proxy."entryKind" IS DISTINCT FROM 'payment' OR proxy."frozenSource"#>>'{debtor,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{actualPayer,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM t."sourceCompanyId" OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" OR proxy."projectId" IS DISTINCT FROM t."sourceProjectId" OR proxy."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "ContractProxyExecution" WHERE "originalId"=proxy."id" AND "status" IN ('pending_confirm','confirmed') AND (cutoff IS NULL OR "occurredAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR proxy."occurredAt"<=cutoff THEN proxy."amountCents" ELSE 0 END-changes;
 ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
  SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE "id"=t."originalFundMovementRelationshipId" FOR UPDATE;
  IF movement."status" IS DISTINCT FROM 'confirmed' OR movement."direction" IS DISTINCT FROM 'increase' OR movement."adjustsEntryId" IS NOT NULL OR movement."debtorCompanyEntityId" IS DISTINCT FROM t."sourceCompanyId" OR movement."creditorCompanyEntityId" IS DISTINCT FROM t."destinationCompanyId" OR movement."beneficiaryProjectId" IS DISTINCT FROM t."sourceProjectId" OR movement."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=movement."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(movement."confirmedAt",movement."createdAt")<=cutoff THEN movement."amountCents" ELSE 0 END-changes;
 ELSIF t."originalOperationalPaymentId" IS NOT NULL THEN
  SELECT * INTO operational FROM public."RegisteredOperationalPayment" WHERE id = t."originalOperationalPaymentId" FOR UPDATE;
  IF operational.id IS NULL OR operational."originalDebtorCompanyId" IS DISTINCT FROM t."sourceCompanyId"
    OR operational."actualPayerCompanyId" IS DISTINCT FROM t."destinationCompanyId"
    OR operational."projectId" IS DISTINCT FROM t."sourceProjectId"
    OR operational."projectId" IS DISTINCT FROM t."destinationProjectId"
    OR operational."originalDebtorCompanyId" = operational."actualPayerCompanyId"
  THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  cap := CASE WHEN cutoff IS NULL OR operational."paidAt" <= cutoff THEN operational."amountCents" ELSE 0 END;
 ELSE
  SELECT * INTO inter FROM "InterEntityRelationshipEntry" WHERE "id"=t."originalInterEntityRelationshipId" FOR UPDATE;
  IF inter."status" IS DISTINCT FROM 'confirmed' OR inter."entryKind" IS DISTINCT FROM 'proxy_payment' OR inter."direction" IS DISTINCT FROM 'increase' OR inter."adjustsEntryId" IS NOT NULL OR inter."originalDebtorCompanyId" IS DISTINCT FROM t."sourceCompanyId" OR inter."creditorCompanyId" IS DISTINCT FROM t."destinationCompanyId" OR inter."projectId" IS NULL OR inter."projectId" IS DISTINCT FROM t."sourceProjectId" OR inter."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=inter."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(inter."confirmedAt",inter."createdAt")<=cutoff THEN inter."amountCents" ELSE 0 END-changes;
 END IF;
 RETURN cap;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_company_transfer_original_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap BIGINT; reserved BIGINT;
BEGIN
 IF NEW."kind"<>'repayment' OR NEW."status" NOT IN ('submitted','approved') THEN RETURN NEW; END IF;
 cap:=company_transfer_debt_limit(NEW,NULL);
 SELECT coalesce(sum(t."amountCents"-coalesce((SELECT sum(e."amountCents") FROM "CompanyTransferEvent" e WHERE e."transferId"=t."id" AND e."kind"='returned'),0)),0) INTO reserved FROM "CompanyTransfer" t WHERE t."id"<>NEW."id" AND t."status" IN ('submitted','approved') AND t."originalTransferId" IS NOT DISTINCT FROM NEW."originalTransferId" AND t."originalProxyId" IS NOT DISTINCT FROM NEW."originalProxyId" AND t."originalFundMovementRelationshipId" IS NOT DISTINCT FROM NEW."originalFundMovementRelationshipId" AND t."originalInterEntityRelationshipId" IS NOT DISTINCT FROM NEW."originalInterEntityRelationshipId" AND t."originalOperationalPaymentId" IS NOT DISTINCT FROM NEW."originalOperationalPaymentId";
 IF reserved+NEW."amountCents">cap THEN RAISE EXCEPTION 'company_transfer_original_capacity'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_company_transfer_dated_repayment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "CompanyTransfer"%ROWTYPE; cap BIGINT; used BIGINT; checkpoint TIMESTAMP;
BEGIN
 IF NEW."kind"<>'outgoing' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM "CompanyTransfer" WHERE "id"=NEW."transferId";
 IF t."kind"<>'repayment' THEN RETURN NEW; END IF;
 -- A backdated insertion must preserve every later recorded repayment boundary.
 PERFORM company_transfer_debt_limit(t,NEW."occurredAt");
 FOR checkpoint IN SELECT NEW."occurredAt" UNION SELECT e."occurredAt" FROM "CompanyTransferEvent" e JOIN "CompanyTransfer" r ON r."id"=e."transferId" WHERE e."kind"='outgoing' AND e."occurredAt">NEW."occurredAt" AND r."originalTransferId" IS NOT DISTINCT FROM t."originalTransferId" AND r."originalProxyId" IS NOT DISTINCT FROM t."originalProxyId" AND r."originalFundMovementRelationshipId" IS NOT DISTINCT FROM t."originalFundMovementRelationshipId" AND r."originalInterEntityRelationshipId" IS NOT DISTINCT FROM t."originalInterEntityRelationshipId" AND r."originalOperationalPaymentId" IS NOT DISTINCT FROM t."originalOperationalPaymentId" LOOP
  cap:=company_transfer_debt_limit(t,checkpoint);
  SELECT coalesce(sum(CASE WHEN e."kind"='outgoing' THEN e."amountCents" ELSE -e."amountCents" END),0) INTO used FROM "CompanyTransferEvent" e JOIN "CompanyTransfer" r ON r."id"=e."transferId" WHERE e."kind" IN ('outgoing','returned') AND e."occurredAt"<=checkpoint AND r."originalTransferId" IS NOT DISTINCT FROM t."originalTransferId" AND r."originalProxyId" IS NOT DISTINCT FROM t."originalProxyId" AND r."originalFundMovementRelationshipId" IS NOT DISTINCT FROM t."originalFundMovementRelationshipId" AND r."originalInterEntityRelationshipId" IS NOT DISTINCT FROM t."originalInterEntityRelationshipId" AND r."originalOperationalPaymentId" IS NOT DISTINCT FROM t."originalOperationalPaymentId";
  IF used+NEW."amountCents">cap THEN RAISE EXCEPTION 'company_transfer_dated_original_capacity'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.jg_company_repayment_ownership_date(source_type TEXT, source_id TEXT, project_id TEXT)
RETURNS TIMESTAMP(3) LANGUAGE plpgsql STABLE AS $$
DECLARE
  e "CompanyTransferEvent"%ROWTYPE;
  t "CompanyTransfer"%ROWTYPE;
  original "CompanyTransfer"%ROWTYPE;
  proxy "ContractProxyExecution"%ROWTYPE;
  movement "FundMovementRelationshipEntry"%ROWTYPE;
  debt "InterEntityRelationshipEntry"%ROWTYPE;
  ownership_at TIMESTAMP(3);
  is_relationship BOOLEAN := split_part(source_id, ':', 2) = 'relationship';
BEGIN
  IF source_type <> 'company_transfer_event' THEN RETURN NULL; END IF;
  SELECT * INTO e FROM "CompanyTransferEvent" WHERE id = split_part(source_id, ':', 1);
  IF NOT FOUND THEN RAISE EXCEPTION '互转资金事实不存在' USING ERRCODE='23514'; END IF;
  SELECT * INTO t FROM "CompanyTransfer" WHERE id=e."transferId";
  IF t.kind <> 'repayment' THEN RETURN NULL; END IF;
  IF t.status <> 'approved' OR
    (is_relationship AND (t."originalFundMovementRelationshipId" IS NULL OR e.kind <> 'incoming')) OR
    (NOT is_relationship AND project_id IS DISTINCT FROM CASE WHEN e.kind='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END) THEN
    RAISE EXCEPTION '归还事实与批准项目不一致' USING ERRCODE='23514';
  END IF;
  IF t."originalTransferId" IS NOT NULL THEN
    SELECT * INTO original FROM "CompanyTransfer" WHERE id=t."originalTransferId";
    IF original.kind <> 'loan' OR original.status <> 'approved' OR
      (original."sourceCompanyId",original."destinationCompanyId",original."sourceProjectId",original."destinationProjectId") IS DISTINCT FROM
      (t."destinationCompanyId",t."sourceCompanyId",t."destinationProjectId",t."sourceProjectId") THEN
      RAISE EXCEPTION '归还主体与原借款不一致' USING ERRCODE='23514';
    END IF;
    SELECT min("occurredAt") INTO ownership_at FROM "CompanyTransferEvent"
      WHERE "transferId"=original.id AND kind=CASE WHEN e.kind='incoming' THEN 'outgoing' ELSE 'incoming' END AND "occurredAt"<=e."occurredAt";
  ELSIF t."originalProxyId" IS NOT NULL THEN
    SELECT * INTO proxy FROM "ContractProxyExecution" WHERE id=t."originalProxyId";
    IF proxy.status <> 'confirmed' OR proxy."entryKind" <> 'payment' OR proxy."projectId" IS DISTINCT FROM project_id OR
      proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM t."sourceCompanyId" OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" THEN
      RAISE EXCEPTION '归还主体与原代付不一致' USING ERRCODE='23514';
    END IF;
    ownership_at:=proxy."occurredAt";
  ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
    SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE id=t."originalFundMovementRelationshipId";
    IF movement.status <> 'confirmed' OR movement.direction <> 'increase' OR movement."adjustsEntryId" IS NOT NULL OR
      (movement."debtorCompanyEntityId",movement."creditorCompanyEntityId",movement."beneficiaryProjectId",movement."sourceProjectId") IS DISTINCT FROM
      (t."sourceCompanyId",t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") THEN
      RAISE EXCEPTION '归还主体与原资金往来不一致' USING ERRCODE='23514';
    END IF;
    SELECT f."occurredAt" INTO ownership_at FROM "FundMovementLeg" l JOIN "OperatingFact" f ON f.id=l."operatingFactId"
      WHERE l."movementId"=movement."movementId" AND l."projectId"=project_id AND (NOT is_relationship OR l.id=split_part(source_id,':',3)) ORDER BY l.id LIMIT 1;
  ELSIF t."originalOperationalPaymentId" IS NOT NULL THEN
    SELECT "paidAt" INTO ownership_at FROM public."RegisteredOperationalPayment"
      WHERE id = t."originalOperationalPaymentId" AND "originalDebtorCompanyId" = t."sourceCompanyId"
        AND "actualPayerCompanyId" = t."destinationCompanyId" AND "projectId" = project_id;
  ELSIF t."originalInterEntityRelationshipId" IS NOT NULL THEN
    SELECT * INTO debt FROM "InterEntityRelationshipEntry" WHERE id=t."originalInterEntityRelationshipId";
    IF debt.status <> 'confirmed' OR debt."entryKind" <> 'proxy_payment' OR debt.direction <> 'increase' OR debt."adjustsEntryId" IS NOT NULL OR
      (debt."originalDebtorCompanyId",debt."creditorCompanyId",debt."projectId",debt."projectId") IS DISTINCT FROM
      (t."sourceCompanyId",t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") OR debt."projectId" IS DISTINCT FROM project_id THEN
      RAISE EXCEPTION '归还主体与原跨主体往来不一致' USING ERRCODE='23514';
    END IF;
    IF debt."paymentExecutionId" IS NOT NULL THEN SELECT "paidAt" INTO ownership_at FROM "PaymentExecution" WHERE id=debt."paymentExecutionId";
    ELSE SELECT "occurredAt" INTO ownership_at FROM "FundExecution" WHERE id=debt."fundExecutionId"; END IF;
  END IF;
  IF ownership_at IS NULL OR ownership_at>e."occurredAt" THEN RAISE EXCEPTION '缺少原债有效归属依据' USING ERRCODE='23514'; END IF;
  RETURN ownership_at;
END;
$$;

CREATE FUNCTION public.jg_registered_operational_payment_exclusive_debit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."RegisteredOperationalPayment" payment
    WHERE (NEW."executionType" = 'expense_claim_payment_execution' AND payment."expenseExecutionId" = NEW."executionId")
      OR (NEW."executionType" = 'spot_procurement_payment_execution' AND payment."spotExecutionId" = NEW."executionId")
  ) THEN
    RAISE EXCEPTION 'registered operational payment cannot have a second project funding debit';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.jg_registered_operational_payment_exclusive_debit() FROM PUBLIC;
CREATE TRIGGER "ProjectFundingAllocation_registered_operational_payment"
  BEFORE INSERT ON public."ProjectFundingAllocation"
  FOR EACH ROW WHEN (NEW."executionType" IN ('expense_claim_payment_execution', 'spot_procurement_payment_execution'))
  EXECUTE FUNCTION public.jg_registered_operational_payment_exclusive_debit();

CREATE FUNCTION public.jg_registered_operational_spot_payment_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."RegisteredOperationalPayment" payment WHERE payment."spotExecutionId" = OLD.id) THEN
    RAISE EXCEPTION 'registered procurement payments require a reviewed compensating entry';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.jg_registered_operational_spot_payment_immutable() FROM PUBLIC;
CREATE TRIGGER "SpotProcurementPaymentExecution_registered_operational_payment"
  BEFORE UPDATE OF "voidedAt" ON public."SpotProcurementPaymentExecution"
  FOR EACH ROW WHEN (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt")
  EXECUTE FUNCTION public.jg_registered_operational_spot_payment_immutable();

COMMIT;
