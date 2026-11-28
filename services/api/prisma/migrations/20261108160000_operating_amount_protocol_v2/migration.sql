-- Source only. No execution or PostgreSQL compatibility evidence is implied.
BEGIN;

ALTER TABLE public."OperatingFact"
  ADD COLUMN "numericProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "amountYuan" NUMERIC(24,4),
  ALTER COLUMN "amountCents" DROP NOT NULL;

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
            ELSE FALSE END))), FALSE));

ALTER TABLE public."OperatingImpactEntry"
  ADD COLUMN "numericProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "amountYuan" NUMERIC(24,4),
  ALTER COLUMN "amountCents" DROP NOT NULL;

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
            ELSE FALSE END))), FALSE));

CREATE TYPE public."OperatingLedgerFactWritePayloadV2" AS (
  "id" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT,
  "sourceVersion" INTEGER,
  "sourceBusinessCode" TEXT,
  "occurredAt" TIMESTAMPTZ,
  "confirmedAt" TIMESTAMPTZ,
  "affiliateAssignmentId" TEXT,
  "affiliateBusinessPartyVersionId" TEXT,
  "affiliateNameSnapshot" TEXT,
  "affiliateCreditCodeSnapshot" TEXT,
  "operatingLedgerEffectiveDateSnapshot" DATE,
  "isBeforeOperatingLedgerEffectiveDate" BOOLEAN,
  "historicalTakeoverBatchId" TEXT,
  "factKind" TEXT,
  "operatingLevel" TEXT,
  "evidenceLevel" TEXT,
  "amountCents" BIGINT,
  "currencyCode" TEXT,
  "direction" TEXT,
  "debtorSubjectKind" TEXT,
  "debtorSubjectId" TEXT,
  "creditorSubjectKind" TEXT,
  "creditorSubjectId" TEXT,
  "approvedPayerSubjectKind" TEXT,
  "approvedPayerSubjectId" TEXT,
  "actualPayerSubjectKind" TEXT,
  "actualPayerSubjectId" TEXT,
  "payeeSubjectKind" TEXT,
  "payeeSubjectId" TEXT,
  "costBearingCompanySubjectKind" TEXT,
  "costBearingCompanySubjectId" TEXT,
  "subjectSnapshot" JSONB,
  "sourceSnapshot" JSONB,
  "basisSnapshot" JSONB,
  "entryKind" TEXT,
  "adjustsFactId" TEXT,
  "idempotencyKey" TEXT,
  "confirmedByUserId" TEXT,
  "status" TEXT,
  "paymentExecutionId" TEXT,
  "fundExecutionId" TEXT,
  "fundExecutionCaseId" TEXT,
  "numericProtocolVersion" INTEGER,
  "amountYuan" NUMERIC
);
REVOKE ALL ON TYPE public."OperatingLedgerFactWritePayloadV2" FROM PUBLIC;

CREATE FUNCTION public."appendOperatingFactThroughService"(
  p_payload public."OperatingLedgerFactWritePayloadV2",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE(
  "id" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_review public."ContractEconomicReview"%ROWTYPE;
  v_original public."OperatingFact"%ROWTYPE;
  v_document JSONB;
  v_document_count BIGINT;
  v_baseline JSONB;
  v_delta NUMERIC;
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);
  -- Validate the unbounded NUMERIC payload before the NUMERIC(24,4) column can round it.
  IF p_payload."numericProtocolVersion" IS DISTINCT FROM 2 OR p_payload."amountCents" IS NOT NULL
    OR (p_payload."amountYuan" IS NOT NULL AND p_payload."amountYuan"::text !~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$') THEN
    RAISE EXCEPTION '新版经营金额协议不正确或超过四位精度' USING ERRCODE = '23514';
  END IF;


  IF p_payload."sourceType" = 'contract_economic_review' THEN
    -- Approved frozen source, not the caller's declaration of an approval.
    IF p_payload."amountYuan" IS NULL OR p_payload."amountYuan" <= 0
      OR jsonb_typeof(p_payload."sourceSnapshot" -> 'baseline') IS DISTINCT FROM 'object'
      OR (p_payload."sourceSnapshot" ->> 'excludedDeltaYuan') IS NULL
      OR (p_payload."sourceSnapshot" ->> 'excludedDeltaYuan') !~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$' THEN
      RAISE EXCEPTION '履约复核四位调整缺少有效冻结金额' USING ERRCODE = '23514';
    END IF;
    v_delta := (p_payload."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric;
    IF v_delta = 0 OR abs(v_delta) IS DISTINCT FROM p_payload."amountYuan" THEN
      RAISE EXCEPTION '履约复核四位调整与冻结差额不一致' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_review FROM public."ContractEconomicReview"
      WHERE "id" = p_payload."sourceSnapshot" ->> 'reviewId' FOR SHARE;
    IF NOT FOUND OR v_review."status" IS DISTINCT FROM 'confirmed'
      OR v_review."confirmedAt" IS NULL
      OR v_review."projectId" IS DISTINCT FROM p_payload."projectId"
      OR v_review."revision" IS DISTINCT FROM p_payload."sourceVersion"
      OR v_review."leftSourceRef" = v_review."rightSourceRef"
      OR NOT COALESCE((p_payload."sourceSnapshot" ->> 'sourceRef') IN (v_review."leftSourceRef", v_review."rightSourceRef"), FALSE)
      OR p_payload."sourceBusinessId" IS DISTINCT FROM (v_review."id" || ':' || (p_payload."sourceSnapshot" ->> 'sourceRef'))
      OR p_payload."confirmedByUserId" IS DISTINCT FROM COALESCE(v_review."financeReviewedById", v_review."contractReviewedById")
      OR p_payload."confirmedByUserId" IS NULL
      OR p_payload."occurredAt" IS DISTINCT FROM (v_review."confirmedAt" AT TIME ZONE 'UTC')
      OR p_payload."confirmedAt" IS DISTINCT FROM (v_review."confirmedAt" AT TIME ZONE 'UTC')
      OR jsonb_typeof(v_review."frozenSources") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '履约复核确认状态或版本已变化' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(v_review."frozenSources") NOT BETWEEN 1 AND 2 THEN
      RAISE EXCEPTION '履约复核冻结文书范围不正确' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), jsonb_agg(value) -> 0 INTO v_document_count, v_document
      FROM jsonb_array_elements(v_review."frozenSources") AS documents(value)
      WHERE value ->> 'ref' = p_payload."sourceSnapshot" ->> 'sourceRef';
    v_baseline := p_payload."sourceSnapshot" -> 'baseline';
    IF v_document_count <> 1 OR v_document -> 'formal' IS DISTINCT FROM 'true'::jsonb
      OR NOT COALESCE((v_document ->> 'coverageNumericProtocolVersion' = '2' OR v_document ->> 'numericProtocolVersion' = '2'), FALSE)
      OR v_document -> 'operatingBaseline' IS DISTINCT FROM v_baseline
      OR v_document ->> 'excludedDeltaYuan' IS DISTINCT FROM p_payload."sourceSnapshot" ->> 'excludedDeltaYuan' THEN
      RAISE EXCEPTION '履约复核冻结分项或差额已变化' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_original FROM public."OperatingFact"
      WHERE "id" = v_baseline ->> 'originalOperatingFactId' FOR KEY SHARE;
    IF NOT FOUND OR v_original."projectId" IS DISTINCT FROM p_payload."projectId"
      OR v_original."status" IS DISTINCT FROM 'confirmed' OR v_original."entryKind" IS DISTINCT FROM 'original'
      OR v_original."factKind" IS DISTINCT FROM 'downstream_contract'
      OR NOT COALESCE((v_original."sourceType" = 'contract_version' AND (p_payload."sourceSnapshot" ->> 'sourceRef') LIKE 'contract:%')
        OR (v_original."sourceType" = 'project_affiliate_contract_fact' AND (p_payload."sourceSnapshot" ->> 'sourceRef') LIKE 'affiliate:%'), FALSE)
      OR v_original."sourceType" IS DISTINCT FROM v_baseline ->> 'originalSourceType'
      OR v_original."sourceBusinessId" IS DISTINCT FROM v_baseline ->> 'originalSourceBusinessId'
      OR v_original."sourceBusinessId" IS DISTINCT FROM split_part(v_document ->> 'version', ':', 1)
      OR v_original."sourceVersion"::text IS DISTINCT FROM v_baseline ->> 'originalSourceVersion'
      OR v_original."numericProtocolVersion"::text IS DISTINCT FROM v_baseline ->> 'numericProtocolVersion'
      OR v_original."sourceSnapshot" IS DISTINCT FROM v_baseline -> 'sourceSnapshot'
      OR v_original."currencyCode" IS DISTINCT FROM COALESCE(NULLIF(p_payload."currencyCode", ''), 'CNY')
      OR (v_original."numericProtocolVersion" = 1 AND (
        (v_original."sourceSnapshot" ->> 'amountNature') IS NOT DISTINCT FROM 'uncapped'
        OR (v_original."sourceSnapshot" -> 'amountCents') IS NOT DISTINCT FROM 'null'::jsonb))
      OR NOT COALESCE((v_original."numericProtocolVersion" = 1 AND v_original."amountCents" IS NOT NULL
          AND v_original."amountCents"::text = v_baseline ->> 'amountCents' AND v_baseline -> 'amountYuan' = 'null'::jsonb)
        OR (v_original."numericProtocolVersion" = 2 AND v_baseline -> 'amountCents' = 'null'::jsonb
          AND v_baseline ? 'amountYuan'
          AND v_original."sourceSnapshot" #>> '{numericFacts,protocolVersion}' = '2'
          AND (v_original."sourceSnapshot" -> 'numericFacts') ? 'amountYuan'
          AND ((v_original."amountYuan" IS NULL AND v_baseline -> 'amountYuan' = 'null'::jsonb
            AND v_baseline ->> 'amountState' = 'unknown'
            AND v_original."sourceSnapshot" #>> '{numericFacts,amountState}' = 'unknown'
            AND v_original."sourceSnapshot" #> '{numericFacts,amountYuan}' = 'null'::jsonb)
          OR (v_original."amountYuan" IS NOT NULL AND v_original."amountYuan"::text = v_baseline ->> 'amountYuan'
            AND v_baseline ->> 'amountState' = 'known'
            AND v_original."sourceSnapshot" #>> '{numericFacts,amountState}' = 'known'
            AND v_original."amountYuan"::text = v_original."sourceSnapshot" #>> '{numericFacts,amountYuan}'))), FALSE)
      OR v_original."affiliateAssignmentId" IS DISTINCT FROM p_payload."affiliateAssignmentId"
      OR v_original."affiliateBusinessPartyVersionId" IS DISTINCT FROM p_payload."affiliateBusinessPartyVersionId"
      OR v_original."affiliateNameSnapshot" IS DISTINCT FROM p_payload."affiliateNameSnapshot"
      OR v_original."affiliateCreditCodeSnapshot" IS DISTINCT FROM p_payload."affiliateCreditCodeSnapshot"
      OR v_original."affiliateAssignmentId" IS DISTINCT FROM v_baseline ->> 'affiliateAssignmentId'
      OR v_original."affiliateBusinessPartyVersionId" IS DISTINCT FROM v_baseline ->> 'affiliateBusinessPartyVersionId'
      OR v_original."affiliateNameSnapshot" IS DISTINCT FROM v_baseline ->> 'affiliateNameSnapshot'
      OR v_original."affiliateCreditCodeSnapshot" IS DISTINCT FROM v_baseline ->> 'affiliateCreditCodeSnapshot'
      OR v_original."debtorSubjectKind" IS DISTINCT FROM p_payload."debtorSubjectKind"
      OR v_original."debtorSubjectId" IS DISTINCT FROM p_payload."debtorSubjectId"
      OR v_original."creditorSubjectKind" IS DISTINCT FROM p_payload."creditorSubjectKind"
      OR v_original."creditorSubjectId" IS DISTINCT FROM p_payload."creditorSubjectId"
      OR v_original."debtorSubjectKind" IS DISTINCT FROM v_baseline #>> '{subjects,debtor,kind}'
      OR v_original."debtorSubjectId" IS DISTINCT FROM v_baseline #>> '{subjects,debtor,id}'
      OR v_original."creditorSubjectKind" IS DISTINCT FROM v_baseline #>> '{subjects,creditor,kind}'
      OR v_original."creditorSubjectId" IS DISTINCT FROM v_baseline #>> '{subjects,creditor,id}' THEN
      RAISE EXCEPTION '履约复核原承诺身份、金额或主体已变化' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public."OperatingFact"(
    "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion",
    "sourceBusinessCode", "occurredAt", "confirmedAt", "affiliateAssignmentId",
    "affiliateBusinessPartyVersionId", "affiliateNameSnapshot",
    "affiliateCreditCodeSnapshot", "operatingLedgerEffectiveDateSnapshot",
    "isBeforeOperatingLedgerEffectiveDate", "historicalTakeoverBatchId",
    "factKind", "operatingLevel", "evidenceLevel", "amountCents",
    "currencyCode", "direction", "debtorSubjectKind", "debtorSubjectId",
    "creditorSubjectKind", "creditorSubjectId", "approvedPayerSubjectKind",
    "approvedPayerSubjectId", "actualPayerSubjectKind", "actualPayerSubjectId",
    "payeeSubjectKind", "payeeSubjectId", "costBearingCompanySubjectKind",
    "costBearingCompanySubjectId", "subjectSnapshot", "sourceSnapshot",
    "basisSnapshot", "entryKind", "adjustsFactId", "idempotencyKey",
    "recordedByUserId", "confirmedByUserId", "status", "paymentExecutionId",
    "fundExecutionId", "fundExecutionCaseId", "numericProtocolVersion", "amountYuan"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."projectId", p_payload."sourceType", p_payload."sourceBusinessId",
    p_payload."sourceVersion", p_payload."sourceBusinessCode",
    p_payload."occurredAt" AT TIME ZONE 'UTC',
    p_payload."confirmedAt" AT TIME ZONE 'UTC',
    p_payload."affiliateAssignmentId", p_payload."affiliateBusinessPartyVersionId",
    p_payload."affiliateNameSnapshot", p_payload."affiliateCreditCodeSnapshot",
    p_payload."operatingLedgerEffectiveDateSnapshot",
    p_payload."isBeforeOperatingLedgerEffectiveDate",
    p_payload."historicalTakeoverBatchId", p_payload."factKind",
    p_payload."operatingLevel", p_payload."evidenceLevel", p_payload."amountCents",
    COALESCE(NULLIF(p_payload."currencyCode", ''), 'CNY'), p_payload."direction",
    p_payload."debtorSubjectKind", p_payload."debtorSubjectId",
    p_payload."creditorSubjectKind", p_payload."creditorSubjectId",
    p_payload."approvedPayerSubjectKind", p_payload."approvedPayerSubjectId",
    p_payload."actualPayerSubjectKind", p_payload."actualPayerSubjectId",
    p_payload."payeeSubjectKind", p_payload."payeeSubjectId",
    p_payload."costBearingCompanySubjectKind", p_payload."costBearingCompanySubjectId",
    p_payload."subjectSnapshot", p_payload."sourceSnapshot", p_payload."basisSnapshot",
    COALESCE(NULLIF(p_payload."entryKind", ''), 'original'), p_payload."adjustsFactId",
    p_payload."idempotencyKey", p_actor_user_id, p_payload."confirmedByUserId",
    COALESCE(NULLIF(p_payload."status", ''), 'confirmed'),
    p_payload."paymentExecutionId", p_payload."fundExecutionId",
    p_payload."fundExecutionCaseId", p_payload."numericProtocolVersion", p_payload."amountYuan"
  )
  RETURNING "OperatingFact"."id", "OperatingFact"."projectId",
            "OperatingFact"."sourceType", "OperatingFact"."sourceBusinessId";
END;
$$;
REVOKE ALL ON FUNCTION public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2", TEXT, TEXT) FROM PUBLIC;

CREATE TYPE public."OperatingLedgerImpactWritePayloadV2" AS (
  "id" TEXT,
  "factId" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT,
  "sourceImpactKey" TEXT,
  "idempotencyKey" TEXT,
  "impactKind" TEXT,
  "amountCents" BIGINT,
  "direction" TEXT,
  "subjectRole" TEXT,
  "subjectKind" TEXT,
  "subjectId" TEXT,
  "costCategoryCode" TEXT,
  "fundPurpose" TEXT,
  "description" TEXT,
  "impactSnapshot" JSONB,
  "paymentExecutionId" TEXT,
  "fundExecutionId" TEXT,
  "fundExecutionCaseId" TEXT,
  "executionAllocationLineId" TEXT,
  "numericProtocolVersion" INTEGER,
  "amountYuan" NUMERIC
);
REVOKE ALL ON TYPE public."OperatingLedgerImpactWritePayloadV2" FROM PUBLIC;

CREATE FUNCTION public."appendOperatingImpactThroughService"(
  p_payload public."OperatingLedgerImpactWritePayloadV2",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE("id" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);
  -- Validate the unbounded NUMERIC payload before the NUMERIC(24,4) column can round it.
  IF p_payload."numericProtocolVersion" IS DISTINCT FROM 2 OR p_payload."amountCents" IS NOT NULL
    OR (p_payload."amountYuan" IS NOT NULL AND p_payload."amountYuan"::text !~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$') THEN
    RAISE EXCEPTION '新版经营金额协议不正确或超过四位精度' USING ERRCODE = '23514';
  END IF;


  RETURN QUERY
  INSERT INTO public."OperatingImpactEntry"(
    "id", "factId", "projectId", "sourceType", "sourceBusinessId",
    "sourceImpactKey", "idempotencyKey", "impactKind", "amountCents",
    "direction", "subjectRole", "subjectKind", "subjectId", "costCategoryCode",
    "fundPurpose", "description", "impactSnapshot", "paymentExecutionId",
    "fundExecutionId", "fundExecutionCaseId", "executionAllocationLineId", "numericProtocolVersion", "amountYuan"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."factId", p_payload."projectId", p_payload."sourceType",
    p_payload."sourceBusinessId", p_payload."sourceImpactKey",
    p_payload."idempotencyKey", p_payload."impactKind", p_payload."amountCents",
    p_payload."direction", p_payload."subjectRole", p_payload."subjectKind",
    p_payload."subjectId", p_payload."costCategoryCode", p_payload."fundPurpose",
    p_payload."description", p_payload."impactSnapshot", p_payload."paymentExecutionId",
    p_payload."fundExecutionId", p_payload."fundExecutionCaseId",
    p_payload."executionAllocationLineId", p_payload."numericProtocolVersion", p_payload."amountYuan"
  )
  RETURNING "OperatingImpactEntry"."id";
END;
$$;
REVOKE ALL ON FUNCTION public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2", TEXT, TEXT) FROM PUBLIC;

-- Pair protocol and source identity at the immutable parent, including attempts via the old overload.
CREATE FUNCTION public."requireOperatingImpactMoneyProtocol"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public."OperatingFact" f
    WHERE f."id" = NEW."factId" AND f."projectId" = NEW."projectId"
      AND f."sourceType" = NEW."sourceType" AND f."sourceBusinessId" = NEW."sourceBusinessId"
      AND f."numericProtocolVersion" = NEW."numericProtocolVersion"
      AND (NEW."numericProtocolVersion" = 1 OR (
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
REVOKE ALL ON FUNCTION public."requireOperatingImpactMoneyProtocol"() FROM PUBLIC;
CREATE TRIGGER "OperatingImpactEntry_money_protocol_parent"
BEFORE INSERT ON public."OperatingImpactEntry"
FOR EACH ROW EXECUTE FUNCTION public."requireOperatingImpactMoneyProtocol"();

-- Runtime EXECUTE and TYPE USAGE belong to an explicit deployment/registered-role ACL,
-- never PUBLIC. Existing v1 composite types, overloads and grants are not rewritten.

-- Review ownership is the verified original fact date. Its business date remains the new confirmation.
-- A separate invoker helper deliberately rechecks the source at both reference-trigger boundaries.
-- The existing SECURITY DEFINER overload keeps its own pre-insert source checks unchanged.
CREATE FUNCTION public.jg_contract_economic_review_ownership_date(p_fact public."OperatingFact")
RETURNS TIMESTAMP(3)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $review_ownership$
DECLARE
  v_review public."ContractEconomicReview"%ROWTYPE;
  v_original public."OperatingFact"%ROWTYPE;
  v_document JSONB;
  v_document_count BIGINT;
  v_baseline JSONB;
  v_delta NUMERIC;
BEGIN
  IF p_fact."numericProtocolVersion" IS DISTINCT FROM 2
    OR p_fact."sourceType" IS DISTINCT FROM 'contract_economic_review' THEN
    RETURN NULL;
  END IF;
  IF p_fact."factKind" IS DISTINCT FROM 'downstream_contract'
    OR p_fact."entryKind" IS DISTINCT FROM 'original'
    OR p_fact."direction" IS DISTINCT FROM 'neutral'
    OR p_fact."status" IS DISTINCT FROM 'confirmed'
    OR p_fact."amountCents" IS NOT NULL OR p_fact."adjustsFactId" IS NOT NULL
    OR p_fact."paymentExecutionId" IS NOT NULL OR p_fact."fundExecutionId" IS NOT NULL
    OR p_fact."fundExecutionCaseId" IS NOT NULL THEN
    RAISE EXCEPTION '履约复核归属仅适用于原承诺调整' USING ERRCODE = '23514';
  END IF;
    -- Approved frozen source, not the caller's declaration of an approval.
    IF p_fact."amountYuan" IS NULL OR p_fact."amountYuan" <= 0
      OR jsonb_typeof(p_fact."sourceSnapshot" -> 'baseline') IS DISTINCT FROM 'object'
      OR (p_fact."sourceSnapshot" ->> 'excludedDeltaYuan') IS NULL
      OR (p_fact."sourceSnapshot" ->> 'excludedDeltaYuan') !~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$' THEN
      RAISE EXCEPTION '履约复核四位调整缺少有效冻结金额' USING ERRCODE = '23514';
    END IF;
    v_delta := (p_fact."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric;
    IF v_delta = 0 OR abs(v_delta) IS DISTINCT FROM p_fact."amountYuan" THEN
      RAISE EXCEPTION '履约复核四位调整与冻结差额不一致' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_review FROM public."ContractEconomicReview"
      WHERE "id" = p_fact."sourceSnapshot" ->> 'reviewId' FOR SHARE;
    IF NOT FOUND OR v_review."status" IS DISTINCT FROM 'confirmed'
      OR v_review."confirmedAt" IS NULL
      OR v_review."projectId" IS DISTINCT FROM p_fact."projectId"
      OR v_review."revision" IS DISTINCT FROM p_fact."sourceVersion"
      OR v_review."leftSourceRef" = v_review."rightSourceRef"
      OR NOT COALESCE((p_fact."sourceSnapshot" ->> 'sourceRef') IN (v_review."leftSourceRef", v_review."rightSourceRef"), FALSE)
      OR p_fact."sourceBusinessId" IS DISTINCT FROM (v_review."id" || ':' || (p_fact."sourceSnapshot" ->> 'sourceRef'))
      OR p_fact."confirmedByUserId" IS DISTINCT FROM COALESCE(v_review."financeReviewedById", v_review."contractReviewedById")
      OR p_fact."confirmedByUserId" IS NULL
      OR p_fact."occurredAt" IS DISTINCT FROM v_review."confirmedAt"
      OR p_fact."confirmedAt" IS DISTINCT FROM v_review."confirmedAt"
      OR jsonb_typeof(v_review."frozenSources") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '履约复核确认状态或版本已变化' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(v_review."frozenSources") NOT BETWEEN 1 AND 2 THEN
      RAISE EXCEPTION '履约复核冻结文书范围不正确' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), jsonb_agg(value) -> 0 INTO v_document_count, v_document
      FROM jsonb_array_elements(v_review."frozenSources") AS documents(value)
      WHERE value ->> 'ref' = p_fact."sourceSnapshot" ->> 'sourceRef';
    v_baseline := p_fact."sourceSnapshot" -> 'baseline';
    IF v_document_count <> 1 OR v_document -> 'formal' IS DISTINCT FROM 'true'::jsonb
      OR NOT COALESCE((v_document ->> 'coverageNumericProtocolVersion' = '2' OR v_document ->> 'numericProtocolVersion' = '2'), FALSE)
      OR v_document -> 'operatingBaseline' IS DISTINCT FROM v_baseline
      OR v_document ->> 'excludedDeltaYuan' IS DISTINCT FROM p_fact."sourceSnapshot" ->> 'excludedDeltaYuan' THEN
      RAISE EXCEPTION '履约复核冻结分项或差额已变化' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_original FROM public."OperatingFact"
      WHERE "id" = v_baseline ->> 'originalOperatingFactId' FOR KEY SHARE;
    IF NOT FOUND OR v_original."projectId" IS DISTINCT FROM p_fact."projectId"
      OR v_original."status" IS DISTINCT FROM 'confirmed' OR v_original."entryKind" IS DISTINCT FROM 'original'
      OR v_original."factKind" IS DISTINCT FROM 'downstream_contract'
      OR NOT COALESCE((v_original."sourceType" = 'contract_version' AND (p_fact."sourceSnapshot" ->> 'sourceRef') LIKE 'contract:%')
        OR (v_original."sourceType" = 'project_affiliate_contract_fact' AND (p_fact."sourceSnapshot" ->> 'sourceRef') LIKE 'affiliate:%'), FALSE)
      OR v_original."sourceType" IS DISTINCT FROM v_baseline ->> 'originalSourceType'
      OR v_original."sourceBusinessId" IS DISTINCT FROM v_baseline ->> 'originalSourceBusinessId'
      OR v_original."sourceBusinessId" IS DISTINCT FROM split_part(v_document ->> 'version', ':', 1)
      OR v_original."sourceVersion"::text IS DISTINCT FROM v_baseline ->> 'originalSourceVersion'
      OR v_original."numericProtocolVersion"::text IS DISTINCT FROM v_baseline ->> 'numericProtocolVersion'
      OR v_original."sourceSnapshot" IS DISTINCT FROM v_baseline -> 'sourceSnapshot'
      OR v_original."currencyCode" IS DISTINCT FROM COALESCE(NULLIF(p_fact."currencyCode", ''), 'CNY')
      OR (v_original."numericProtocolVersion" = 1 AND (
        (v_original."sourceSnapshot" ->> 'amountNature') IS NOT DISTINCT FROM 'uncapped'
        OR (v_original."sourceSnapshot" -> 'amountCents') IS NOT DISTINCT FROM 'null'::jsonb))
      OR NOT COALESCE((v_original."numericProtocolVersion" = 1 AND v_original."amountCents" IS NOT NULL
          AND v_original."amountCents"::text = v_baseline ->> 'amountCents' AND v_baseline -> 'amountYuan' = 'null'::jsonb)
        OR (v_original."numericProtocolVersion" = 2 AND v_baseline -> 'amountCents' = 'null'::jsonb
          AND v_baseline ? 'amountYuan'
          AND v_original."sourceSnapshot" #>> '{numericFacts,protocolVersion}' = '2'
          AND (v_original."sourceSnapshot" -> 'numericFacts') ? 'amountYuan'
          AND ((v_original."amountYuan" IS NULL AND v_baseline -> 'amountYuan' = 'null'::jsonb
            AND v_baseline ->> 'amountState' = 'unknown'
            AND v_original."sourceSnapshot" #>> '{numericFacts,amountState}' = 'unknown'
            AND v_original."sourceSnapshot" #> '{numericFacts,amountYuan}' = 'null'::jsonb)
          OR (v_original."amountYuan" IS NOT NULL AND v_original."amountYuan"::text = v_baseline ->> 'amountYuan'
            AND v_baseline ->> 'amountState' = 'known'
            AND v_original."sourceSnapshot" #>> '{numericFacts,amountState}' = 'known'
            AND v_original."amountYuan"::text = v_original."sourceSnapshot" #>> '{numericFacts,amountYuan}'))), FALSE)
      OR v_original."affiliateAssignmentId" IS DISTINCT FROM p_fact."affiliateAssignmentId"
      OR v_original."affiliateBusinessPartyVersionId" IS DISTINCT FROM p_fact."affiliateBusinessPartyVersionId"
      OR v_original."affiliateNameSnapshot" IS DISTINCT FROM p_fact."affiliateNameSnapshot"
      OR v_original."affiliateCreditCodeSnapshot" IS DISTINCT FROM p_fact."affiliateCreditCodeSnapshot"
      OR v_original."affiliateAssignmentId" IS DISTINCT FROM v_baseline ->> 'affiliateAssignmentId'
      OR v_original."affiliateBusinessPartyVersionId" IS DISTINCT FROM v_baseline ->> 'affiliateBusinessPartyVersionId'
      OR v_original."affiliateNameSnapshot" IS DISTINCT FROM v_baseline ->> 'affiliateNameSnapshot'
      OR v_original."affiliateCreditCodeSnapshot" IS DISTINCT FROM v_baseline ->> 'affiliateCreditCodeSnapshot'
      OR v_original."debtorSubjectKind" IS DISTINCT FROM p_fact."debtorSubjectKind"
      OR v_original."debtorSubjectId" IS DISTINCT FROM p_fact."debtorSubjectId"
      OR v_original."creditorSubjectKind" IS DISTINCT FROM p_fact."creditorSubjectKind"
      OR v_original."creditorSubjectId" IS DISTINCT FROM p_fact."creditorSubjectId"
      OR v_original."debtorSubjectKind" IS DISTINCT FROM v_baseline #>> '{subjects,debtor,kind}'
      OR v_original."debtorSubjectId" IS DISTINCT FROM v_baseline #>> '{subjects,debtor,id}'
      OR v_original."creditorSubjectKind" IS DISTINCT FROM v_baseline #>> '{subjects,creditor,kind}'
      OR v_original."creditorSubjectId" IS DISTINCT FROM v_baseline #>> '{subjects,creditor,id}' THEN
      RAISE EXCEPTION '履约复核原承诺身份、金额或主体已变化' USING ERRCODE = '23514';
    END IF;
  IF v_original."occurredAt" IS NULL THEN
    RAISE EXCEPTION '履约复核缺少原事实归属日期' USING ERRCODE = '23514';
  END IF;
  RETURN v_original."occurredAt";
END;
$review_ownership$;
REVOKE ALL ON FUNCTION public.jg_contract_economic_review_ownership_date(public."OperatingFact") FROM PUBLIC;

-- Rewrite only the six ownership-period expressions and the one parent ownership-date projection.
-- Exact-count guards preserve unrelated business dates, locks and the existing company-repayment branch.
DO $review_reference_dates$
DECLARE
  definition TEXT;
  anchor TEXT;
  replacement TEXT;
  occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef('public."validateOperatingFactReferences"()'::regprocedure) INTO definition;
  anchor := 'COALESCE(public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE';
  replacement := 'COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE';
  occurrences := (length(definition) - length(replace(definition, anchor, ''))) / length(anchor);
  IF occurrences IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'Review ownership fact validator drift' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, anchor, replacement);

  SELECT pg_get_functiondef('public."validateOperatingImpactEntryReferences"()'::regprocedure) INTO definition;
  anchor := 'SELECT COALESCE(public.jg_company_repayment_ownership_date(fact."sourceType", fact."sourceBusinessId", fact."projectId"), fact."occurredAt"), fact."affiliateAssignmentId"';
  replacement := 'SELECT COALESCE(public.jg_contract_economic_review_ownership_date(fact), public.jg_company_repayment_ownership_date(fact."sourceType", fact."sourceBusinessId", fact."projectId"), fact."occurredAt"), fact."affiliateAssignmentId"';
  occurrences := (length(definition) - length(replace(definition, anchor, ''))) / length(anchor);
  IF occurrences IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Review ownership impact validator drift' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END;
$review_reference_dates$;

COMMIT;
