BEGIN;

ALTER TABLE public."OperatingFact" DROP CONSTRAINT "OperatingFact_numeric_protocol_check";
ALTER TABLE public."OperatingFact"
  ADD CONSTRAINT "OperatingFact_numeric_protocol_check" CHECK (COALESCE(
    ("numericProtocolVersion" = 1 AND "amountCents" IS NOT NULL AND "amountYuan" IS NULL)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" IN ('contract_version', 'contract_economic_review') AND "factKind" = 'downstream_contract' AND "direction" = 'neutral' AND "entryKind" = 'original' AND "adjustsFactId" IS NULL
      AND ("sourceType" <> 'contract_economic_review' OR ("amountYuan" IS NOT NULL AND "amountYuan" > 0))
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND ("sourceSnapshot" IS NOT NULL)
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND (("amountYuan" IS NULL
          AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'unknown'
          AND ("sourceSnapshot" #> '{numericFacts,amountYuan}') = 'null'::jsonb)
        OR ("amountYuan" IS NOT NULL AND "amountYuan" >= 0 AND "amountYuan" <> 'NaN'::numeric
          AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
          AND CASE WHEN ("sourceSnapshot" #>> '{numericFacts,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
            THEN ("sourceSnapshot" #>> '{numericFacts,amountYuan}')::numeric = "amountYuan"
            ELSE FALSE END)))
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" = 'project_owner_settlement_entry' AND "factKind" = 'owner_settlement'
      AND "entryKind" = 'original' AND "adjustsFactId" IS NULL AND "operatingLevel" = 'project'
      AND "evidenceLevel" = 'A' AND status = 'confirmed' AND "currencyCode" = 'CNY'
      AND "debtorSubjectKind" = 'owner' AND "creditorSubjectKind" = 'construction_enterprise'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "direction" IN ('inflow', 'outflow')
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("sourceSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'contract_work_completion'
      AND "factKind" = 'expense' AND "direction" = 'neutral' AND "entryKind" = 'original' AND "adjustsFactId" IS NULL
      AND "operatingLevel" = 'project' AND "evidenceLevel" = 'A' AND status = 'confirmed' AND "currencyCode" = 'CNY'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("sourceSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'expense_claim_approval'
      AND "sourceVersion" = 1 AND "factKind" = 'expense' AND direction = 'outflow'
      AND "entryKind" = 'original' AND "adjustsFactId" IS NULL AND "historicalTakeoverBatchId" IS NULL
      AND "operatingLevel" = 'project' AND "evidenceLevel" = 'A' AND status = 'confirmed'
      AND "currencyCode" = 'CNY' AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "sourceSnapshot"->>'requestedAmountYuan' = "amountYuan"::text
      AND "sourceSnapshot"#>>'{numericFacts,protocolVersion}' = '2'
      AND "sourceSnapshot"#>>'{numericFacts,amountState}' = 'known'
      AND "sourceSnapshot"#>>'{numericFacts,amountYuan}' = "amountYuan"::text)
    , FALSE));

ALTER TABLE public."OperatingImpactEntry" DROP CONSTRAINT "OperatingImpactEntry_numeric_protocol_check";
ALTER TABLE public."OperatingImpactEntry"
  ADD CONSTRAINT "OperatingImpactEntry_numeric_protocol_check" CHECK (COALESCE(
    ("numericProtocolVersion" = 1 AND "amountCents" IS NOT NULL AND "amountYuan" IS NULL)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" IN ('contract_version', 'contract_economic_review') AND "impactKind" = 'contract_commitment_reference' AND "sourceImpactKey" = 'contract_commitment_reference' AND "subjectRole" = 'debtor' AND (("amountYuan" IS NULL AND "direction" = 'notice') OR ("amountYuan" IS NOT NULL AND "direction" IN ('increase', 'decrease')))
      AND ("sourceType" <> 'contract_economic_review' OR ("amountYuan" IS NOT NULL AND "amountYuan" > 0))
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NULL AND ("impactSnapshot" IS NOT NULL)
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND (("amountYuan" IS NULL
          AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'unknown'
          AND ("impactSnapshot" #> '{numericFacts,amountYuan}') = 'null'::jsonb)
        OR ("amountYuan" IS NOT NULL AND "amountYuan" >= 0 AND "amountYuan" <> 'NaN'::numeric
          AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
          AND CASE WHEN ("impactSnapshot" #>> '{numericFacts,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
            THEN ("impactSnapshot" #>> '{numericFacts,amountYuan}')::numeric = "amountYuan"
            ELSE FALSE END)))
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" = 'project_owner_settlement_entry'
      AND ("impactKind" = 'confirmed_income'
        OR ("impactKind" = 'receivable_increase' AND direction = 'increase')
        OR ("impactKind" = 'receivable_decrease' AND direction = 'decrease'))
      AND "sourceImpactKey" = "impactKind" AND direction IN ('increase', 'decrease')
      AND "subjectRole" = 'creditor' AND "subjectKind" = 'construction_enterprise'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NULL
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("impactSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'contract_work_completion'
      AND "impactKind" = 'confirmed_cost' AND "sourceImpactKey" = 'confirmed_cost' AND direction = 'increase'
      AND "subjectRole" = 'debtor' AND "costCategoryCode" = 'other_project_cost'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL AND "executionAllocationLineId" IS NULL
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("impactSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'expense_claim_approval'
      AND direction = 'increase' AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND (("impactKind" = 'confirmed_cost' AND "sourceImpactKey" ~ '^confirmed_cost:[1-9][0-9]*$'
        AND "costCategoryCode" = 'project_daily_expense'
        AND ("subjectRole" IS NULL OR "subjectRole" = 'cost_bearing_company'))
        OR ("impactKind" = 'payable_increase' AND "sourceImpactKey" = 'payable_increase'
          AND "costCategoryCode" IS NULL AND "subjectRole" = 'payee'
          AND "amountYuan" = trunc("amountYuan",2)))
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL AND "executionAllocationLineId" IS NULL
      AND "impactSnapshot"#>>'{numericFacts,protocolVersion}' = '2'
      AND "impactSnapshot"#>>'{numericFacts,amountState}' = 'known'
      AND "impactSnapshot"#>>'{numericFacts,amountYuan}' = "amountYuan"::text)
    , FALSE));

CREATE OR REPLACE FUNCTION public."requireOperatingImpactMoneyProtocol"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public."OperatingFact" f
    WHERE f."id" = NEW."factId" AND f."projectId" = NEW."projectId"
      AND f."sourceType" = NEW."sourceType" AND f."sourceBusinessId" = NEW."sourceBusinessId"
      AND f."numericProtocolVersion" = NEW."numericProtocolVersion"
      AND (NEW."numericProtocolVersion" = 1 OR (
        f."sourceType" = 'project_owner_settlement_entry'
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
        AND NEW."subjectId" IS NOT DISTINCT FROM f."creditorSubjectId"
        AND NEW.direction = CASE f.direction WHEN 'outflow' THEN 'decrease' ELSE 'increase' END
      ) OR (
        f."sourceType" = 'contract_work_completion' AND NEW."direction" = 'increase'
        AND NEW."sourceImpactKey" = 'confirmed_cost' AND NEW."impactKind" = 'confirmed_cost'
        AND NEW."subjectRole" = 'debtor' AND NEW."subjectKind" = f."debtorSubjectKind" AND NEW."subjectId" = f."debtorSubjectId"
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
      ) OR (
        f."sourceType" = 'expense_claim_approval' AND NEW.direction = 'increase'
        AND (
          (NEW."impactKind" = 'confirmed_cost'
            AND NEW."subjectKind" IS NOT DISTINCT FROM f."costBearingCompanySubjectKind"
            AND NEW."subjectId" IS NOT DISTINCT FROM f."costBearingCompanySubjectId"
            AND EXISTS (
              SELECT 1 FROM public."ExpenseClaimLine" line
              WHERE line."expenseClaimId" = f."sourceBusinessId"
                AND line."id" = NEW."impactSnapshot"->>'lineId'
                AND NEW."sourceImpactKey" = 'confirmed_cost:' || line."sortOrder"::text
                AND NEW."amountYuan" = line."amountYuan"
            ))
          OR (NEW."impactKind" = 'payable_increase' AND EXISTS (
            SELECT 1 FROM public."ExpenseClaim" claim
            WHERE claim.id = f."sourceBusinessId"
              AND NEW."amountYuan" * 100 = claim."companyPayableAmountCents"
              AND ((claim."applicantUserId" IS NOT NULL AND NEW."subjectKind" = 'employee' AND NEW."subjectId" = claim."applicantUserId")
              OR (claim."applicantUserId" IS NULL AND NEW."subjectKind" = 'employee'))
          ))
        )
      ) OR (
        NEW."sourceImpactKey" = 'contract_commitment_reference'
        AND NEW."impactKind" = 'contract_commitment_reference'
        AND ((NEW."amountYuan" IS NULL AND NEW."direction" = 'notice') OR (NEW."amountYuan" IS NOT NULL AND NEW."direction" IN ('increase', 'decrease'))) AND NEW."subjectRole" = 'debtor'
        AND NEW."subjectKind" = f."debtorSubjectKind" AND NEW."subjectId" = f."debtorSubjectId"
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
        AND (f."sourceType" <> 'contract_economic_review' OR CASE
          WHEN (f."sourceSnapshot" ->> 'excludedDeltaYuan') ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
          THEN (((f."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric > 0 AND NEW."direction" = 'decrease')
            OR ((f."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric < 0 AND NEW."direction" = 'increase'))
          ELSE FALSE END))) FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '经营影响必须与原事实使用同一来源及金额协议' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.jg_validate_reimbursement_exact_cost_source()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  claim_record record;
  source_lines jsonb;
  expected_bearer text;
BEGIN
  SELECT c.*, r.id AS approved_round_id INTO STRICT claim_record
  FROM public."ExpenseClaim" c
  JOIN public."ApprovalInstance" r ON r.id = c."approvalInstanceId"
    AND r."businessId" = c.id AND r."businessType" = 'expense_claim'
    AND r."flowType" = 'expense_claim.approve' AND r.status = 'approved'
  WHERE c.id = NEW."sourceBusinessId" AND c.code = NEW."sourceBusinessCode"
    AND c."projectId" = NEW."projectId" AND c."approvedAt" = NEW."occurredAt"
    AND c."claimType" = 'reimbursement' AND c."requestedAmountYuan" = NEW."amountYuan"
    AND c."actualPurchaseBatchId" IS NULL AND c."generalProcurementId" IS NULL
    AND c."voidedAt" IS NULL AND c.status IN ('approved_pending_payment', 'partially_paid', 'paid', 'offset_completed');

  expected_bearer := CASE WHEN claim_record."costBearingCompanySpecified"
    THEN claim_record."costBearingCompanyEntityId" ELSE claim_record."companyEntityId" END;
  SELECT jsonb_agg(jsonb_build_object(
    'id', l.id, 'sortOrder', l."sortOrder"::text, 'expenseCategory', l."expenseCategory", 'purpose', l.purpose,
    'amountCents', l."amountCents"::text, 'amountYuan', l."amountYuan"::text
  ) ORDER BY l."sortOrder") INTO source_lines
  FROM public."ExpenseClaimLine" l WHERE l."expenseClaimId" = claim_record.id;

  IF NEW."sourceSnapshot"->>'formalStatus' IS DISTINCT FROM 'confirmed'
    OR NEW."sourceSnapshot"->>'claimType' IS DISTINCT FROM 'reimbursement'
    OR NEW."sourceSnapshot"->>'requestedAmountCents' IS DISTINCT FROM claim_record."requestedAmountCents"::text
    OR NEW."sourceSnapshot"->>'companyPayableAmountCents' IS DISTINCT FROM claim_record."companyPayableAmountCents"::text
    OR NEW."costBearingCompanySubjectId" IS DISTINCT FROM expected_bearer
    OR NEW."costBearingCompanySubjectKind" IS DISTINCT FROM CASE WHEN expected_bearer IS NULL THEN NULL ELSE 'participating_company' END
    OR NEW."idempotencyKey" IS DISTINCT FROM 'expense_claim_approval:' || claim_record.id
    OR source_lines IS NULL
    OR (SELECT jsonb_agg(item - 'occurredOn' ORDER BY ordinality)
        FROM jsonb_array_elements(NEW."sourceSnapshot"->'reimbursementLines') WITH ORDINALITY AS lines(item, ordinality))
      IS DISTINCT FROM source_lines
    OR NOT EXISTS (
      SELECT 1 FROM public."ApprovalActionLog" a
      WHERE a."approvalInstanceId" = claim_record.approved_round_id AND a.action = 'approve'
        AND a."actorUserId" = NEW."confirmedByUserId" AND a."createdAt" = NEW."confirmedAt"
    )
  THEN
    RAISE EXCEPTION 'reimbursement exact operating source mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'reimbursement exact operating source not approved' USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER "OperatingFact_reimbursement_exact_source"
  BEFORE INSERT ON public."OperatingFact" FOR EACH ROW
  WHEN (NEW."sourceType" = 'expense_claim_approval' AND NEW."numericProtocolVersion" = 2)
  EXECUTE FUNCTION public.jg_validate_reimbursement_exact_cost_source();

CREATE FUNCTION public.jg_require_reimbursement_exact_cost_impacts()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  counted_costs bigint;
  counted_payables bigint;
  total_cost numeric;
BEGIN
  SELECT count(*) FILTER (WHERE i."impactKind" = 'confirmed_cost'),
    count(*) FILTER (WHERE i."impactKind" = 'payable_increase'),
    sum(i."amountYuan") FILTER (WHERE i."impactKind" = 'confirmed_cost')
  INTO counted_costs, counted_payables, total_cost
  FROM public."OperatingImpactEntry" i WHERE i."factId" = NEW.id;
  IF counted_costs <> jsonb_array_length(NEW."sourceSnapshot"->'reimbursementLines')
    OR total_cost IS DISTINCT FROM NEW."amountYuan"
    OR counted_payables <> CASE WHEN NEW."sourceSnapshot"->>'companyPayableAmountCents' = '0' THEN 0 ELSE 1 END
  THEN
    RAISE EXCEPTION 'reimbursement exact operating impacts are incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "OperatingFact_reimbursement_exact_impacts"
  AFTER INSERT ON public."OperatingFact" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."sourceType" = 'expense_claim_approval' AND NEW."numericProtocolVersion" = 2)
  EXECUTE FUNCTION public.jg_require_reimbursement_exact_cost_impacts();

-- Pending cost bearing still requires the same approved source and terminal actor. Only its
-- amount comparison differs between the existing integer-cent and new exact source.
DO $upgrade$
DECLARE
  routine oid := 'public."validateOperatingFactReferences"()'::regprocedure;
  body_before text;
  definition text;
  scope_before constant text := 'AND NEW."historicalTakeoverBatchId" IS NULL AND NEW."numericProtocolVersion" = 1';
  amount_before constant text := 'AND expense."requestedAmountCents" = NEW."amountCents"';
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) INTO STRICT body_before, definition
  FROM pg_proc p WHERE p.oid = routine
    AND p.proowner = current_user::regrole::oid;
  IF encode(sha256(convert_to(body_before, 'UTF8')), 'hex') NOT IN (
      'bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6',
      '61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb',
      'f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987'
    ) OR cardinality(string_to_array(body_before, scope_before)) <> 2
      OR cardinality(string_to_array(body_before, amount_before)) <> 2
  THEN
    RAISE EXCEPTION 'REIMBURSEMENT_EXACT_COST_BEARER_PREIMAGE' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition, body_before, replace(replace(body_before, scope_before,
    'AND NEW."historicalTakeoverBatchId" IS NULL AND NEW."numericProtocolVersion" IN (1,2)'), amount_before,
    'AND ((NEW."numericProtocolVersion" = 1 AND expense."requestedAmountCents" = NEW."amountCents")
      OR (NEW."numericProtocolVersion" = 2 AND expense."claimType" = ''reimbursement''
        AND expense."requestedAmountYuan" = NEW."amountYuan"))'));
END
$upgrade$;

COMMIT;
