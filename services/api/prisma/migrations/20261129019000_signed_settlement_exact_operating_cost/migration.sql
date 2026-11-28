BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Keep the review signature, role grants and transaction/contract lock. The V2
-- marker is frozen only by a new successful review of a non-cent amount.
DO $upgrade$
DECLARE
  routine oid := 'public.jg_review_signed_settlement_draft_v1(text,text,text,integer,text,text,boolean,text,text)'::regprocedure;
  before_row record;
  after_body text;
  declaration constant text := '  confirmed_yuan numeric;';
  capacity_check constant text := $old$    IF confirmed_yuan+draft."amountYuan"<0
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CAPACITY' USING ERRCODE='23514'; END IF;$old$;
  freeze_exact constant text := $new$
    IF trunc(draft."amountYuan", 2) <> draft."amountYuan" THEN
      IF confirmed_yuan < 0 THEN
        RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CAPACITY' USING ERRCODE = '23514';
      END IF;
      payable_delta_cents := round((confirmed_yuan + draft."amountYuan") * 100) - round(confirmed_yuan * 100);
      IF draft."contractKind" <> 'upward' AND abs(payable_delta_cents) >= 10000000000000000000000 THEN
        RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_OPERATING_RANGE' USING ERRCODE = '22003';
      END IF;
      frozen_source := frozen_source || jsonb_build_object('operatingNumericFacts', jsonb_build_object(
        'protocolVersion', 2,
        'cumulativeBeforeYuan', round(confirmed_yuan, 4)::text,
        'cumulativeAfterYuan', round(confirmed_yuan + draft."amountYuan", 4)::text,
        'payableDeltaCents', CASE WHEN draft."contractKind" = 'upward' THEN '0' ELSE payable_delta_cents::text END
      ));
    END IF;$new$;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p) - 'prosrc' AS metadata
    INTO STRICT before_row FROM pg_proc p WHERE p.oid = routine AND p.proowner = current_user::regrole::oid;
  IF encode(sha256(convert_to(before_row.prosrc, 'UTF8')), 'hex') <> 'bb255527d0454028caf034bae9f279aac799d5e1a4026423f3b6106ebcf11cf0'
    OR cardinality(string_to_array(before_row.prosrc, declaration)) <> 2
    OR cardinality(string_to_array(before_row.prosrc, capacity_check)) <> 2
    OR cardinality(string_to_array(before_row.definition, before_row.prosrc)) <> 2
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_REVIEW_PREIMAGE' USING ERRCODE = '55000'; END IF;

  after_body := replace(replace(before_row.prosrc, declaration,
    declaration || chr(10) || '  payable_delta_cents numeric;'), capacity_check, capacity_check || freeze_exact);
  IF encode(sha256(convert_to(after_body, 'UTF8')), 'hex') <> '05fbb37f45cc8b3a19a695d9e410b5f9725be11537c8497e9e34233aee73ca57'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_REVIEW_PATCH' USING ERRCODE = '55000'; END IF;
  EXECUTE replace(before_row.definition, before_row.prosrc, after_body);
  IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid = routine AND p.prosrc = after_body
      AND (to_jsonb(p) - 'prosrc') = before_row.metadata)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_REVIEW_POSTIMAGE' USING ERRCODE = '55000'; END IF;
END;
$upgrade$;

-- Add only the signed-settlement branch to each exact 349 check. Every old
-- clause is retained verbatim from the admitted PostgreSQL definition.
DO $upgrade$
DECLARE
  rule record;
  previous_sql text;
  previous_expression text;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('public."OperatingFact"'::regclass, 'OperatingFact_numeric_protocol_check',
      '8144b48b02f9807a065b79240b0824b2504f00c9a098965d06f94ee91eb40146',
      $fact$"sourceType" = 'signed_contract_settlement' AND "numericProtocolVersion" = 2 AND "amountCents" IS NULL
        AND "factKind" = 'downstream_settlement' AND direction = 'neutral'
        AND "entryKind" = 'original' AND "adjustsFactId" IS NULL AND "historicalTakeoverBatchId" IS NULL
        AND "operatingLevel" IN ('project', 'participating_company')
        AND "evidenceLevel" = 'A' AND status = 'confirmed' AND "currencyCode" = 'CNY'
        AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
        AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
        AND "sourceSnapshot"#>'{numericFacts,protocolVersion}' = '2'::jsonb
        AND "sourceSnapshot"#>>'{numericFacts,amountState}' = 'known'
        AND "sourceSnapshot"#>'{numericFacts,amountYuan}' = to_jsonb("amountYuan"::text)$fact$),
    ('public."OperatingImpactEntry"'::regclass, 'OperatingImpactEntry_numeric_protocol_check',
      '8f40f0c593112c133bd6c4617985d2f80b3fd1cb97642ad88755ceea0a80dd04',
      $impact$"sourceType" = 'signed_contract_settlement' AND "numericProtocolVersion" = 2 AND "amountCents" IS NULL
        AND direction IN ('increase', 'decrease') AND "sourceImpactKey" = "impactKind"
        AND (("impactKind" = 'confirmed_cost' AND "subjectRole" = 'debtor' AND "costCategoryCode" IS NOT NULL)
          OR ("impactKind" IN ('receivable_increase', 'payable_increase', 'payable_decrease')
            AND "subjectRole" = 'creditor' AND "costCategoryCode" IS NULL))
        AND "fundPurpose" IS NULL AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL
        AND "fundExecutionCaseId" IS NULL AND "executionAllocationLineId" IS NULL
        AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
        AND "impactSnapshot"#>'{numericFacts,protocolVersion}' = '2'::jsonb
        AND "impactSnapshot"#>>'{numericFacts,amountState}' = 'known'
        AND "impactSnapshot"#>'{numericFacts,amountYuan}' = to_jsonb("amountYuan"::text)$impact$)
  ) AS entries(relation, constraint_name, digest, extra)
  LOOP
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', rule.relation);
    SELECT pg_get_constraintdef(c.oid), pg_get_expr(c.conbin, c.conrelid) INTO STRICT previous_sql, previous_expression
      FROM pg_constraint c WHERE c.conrelid = rule.relation AND c.conname = rule.constraint_name
        AND c.contype = 'c' AND c.convalidated AND NOT c.condeferrable AND NOT c.connoinherit;
    IF encode(sha256(convert_to(previous_sql, 'UTF8')), 'hex') <> rule.digest
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_CHECK_PREIMAGE: %', rule.constraint_name USING ERRCODE = '55000'; END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK ((%s) OR COALESCE((%s), FALSE))',
      rule.relation, rule.constraint_name, rule.constraint_name, previous_expression, rule.extra);
  END LOOP;
END;
$upgrade$;

CREATE FUNCTION public.jg_validate_signed_settlement_exact_fact()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  source_row public."SignedContractSettlement"%ROWTYPE;
  source_contract jsonb;
  frozen jsonb;
  before_yuan numeric;
  after_yuan numeric;
  payable_cents numeric;
  debtor_id text;
BEGIN
  SELECT s.* INTO source_row FROM public."SignedContractSettlement" s
    WHERE s.id = NEW."sourceBusinessId" FOR SHARE OF s;
  source_contract := source_row."confirmedContractSource";
  frozen := source_contract->'operatingNumericFacts';

  IF NEW."numericProtocolVersion" = 1 THEN
    IF frozen IS NOT NULL OR NEW."sourceSnapshot" ? 'operatingNumericFacts'
    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_FACT_LEGACY' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;

  IF source_row.state IS DISTINCT FROM 'confirmed'
    OR jsonb_typeof(frozen) IS DISTINCT FROM 'object'
    OR frozen->'protocolVersion' IS DISTINCT FROM '2'::jsonb
    OR NEW."sourceSnapshot"->'operatingNumericFacts' IS DISTINCT FROM frozen
    OR NOT coalesce(jsonb_typeof(frozen->'cumulativeBeforeYuan') = 'string'
      AND jsonb_typeof(frozen->'cumulativeAfterYuan') = 'string'
      AND jsonb_typeof(frozen->'payableDeltaCents') = 'string'
      AND frozen->>'cumulativeBeforeYuan' ~ '^(0|[1-9][0-9]*)\.[0-9]{4}$'
      AND frozen->>'cumulativeAfterYuan' ~ '^(0|[1-9][0-9]*)\.[0-9]{4}$'
      AND frozen->>'payableDeltaCents' ~ '^(0|-?[1-9][0-9]*)$', false)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_FACT_SOURCE' USING ERRCODE = '23514'; END IF;

  before_yuan := (frozen->>'cumulativeBeforeYuan')::numeric;
  after_yuan := (frozen->>'cumulativeAfterYuan')::numeric;
  payable_cents := (frozen->>'payableDeltaCents')::numeric;
  debtor_id := CASE source_contract->>'payerKind'
    WHEN 'construction_enterprise' THEN NEW."affiliateBusinessPartyVersionId"
    WHEN 'participating_company' THEN source_contract->>'payerVersionId' END;
  IF source_row."amountYuan" IS NULL OR source_row."amountYuan" = 'NaN'::numeric
    OR trunc(source_row."amountYuan", 2) = source_row."amountYuan"
    OR after_yuan - before_yuan IS DISTINCT FROM source_row."amountYuan"
    OR payable_cents IS DISTINCT FROM (CASE WHEN source_row."contractKind" = 'upward' THEN 0
      ELSE round(after_yuan * 100) - round(before_yuan * 100) END)
    OR abs(payable_cents) >= 10000000000000000000000
    OR NOT coalesce(
      (source_row."contractKind" = 'downstream' AND source_contract->>'relationship' IN ('inside','outside')
        AND source_contract->>'contractTypeKey' IN ('material_purchase','equipment_rental','labor_subcontract','professional_subcontract'))
      OR (source_row."contractKind" = 'outside_fact' AND source_contract->>'relationship' = 'outside')
      OR (source_row."contractKind" = 'upward' AND source_contract->>'relationship' = 'upward'), false)
    OR debtor_id IS NULL OR nullif(source_contract->>'counterpartyVersionId','') IS NULL
    OR NEW."projectId" IS DISTINCT FROM source_row."projectId"
    OR NEW."sourceVersion"::bigint IS DISTINCT FROM source_row."confirmationNo"
    OR NEW."sourceBusinessCode" IS DISTINCT FROM source_row.number
    OR NEW."confirmedAt" IS DISTINCT FROM source_row."reviewedAt"
    OR NEW."occurredAt" IS DISTINCT FROM source_row."reviewedAt"
    OR NEW."confirmedByUserId" IS DISTINCT FROM source_row."reviewedByUserId"
    OR NEW."amountYuan" IS DISTINCT FROM abs(source_row."amountYuan")
    OR NEW."idempotencyKey" IS DISTINCT FROM 'signed_contract_settlement:' || source_row.id
    OR NEW."operatingLevel" IS DISTINCT FROM (CASE WHEN source_row."contractKind" = 'upward' THEN 'participating_company' ELSE 'project' END)
    OR NEW."debtorSubjectKind" IS DISTINCT FROM source_contract->>'payerKind'
    OR NEW."debtorSubjectId" IS DISTINCT FROM debtor_id
    OR NEW."creditorSubjectKind" IS DISTINCT FROM (CASE WHEN source_row."contractKind" = 'upward' THEN 'participating_company' ELSE 'downstream_counterparty' END)
    OR NEW."creditorSubjectId" IS DISTINCT FROM source_contract->>'counterpartyVersionId'
    OR (source_contract->>'affiliateAssignmentId' IS NOT NULL
      AND NEW."affiliateAssignmentId" IS DISTINCT FROM source_contract->>'affiliateAssignmentId')
    OR (source_contract->>'affiliateBusinessPartyVersionId' IS NOT NULL
      AND NEW."affiliateBusinessPartyVersionId" IS DISTINCT FROM source_contract->>'affiliateBusinessPartyVersionId')
    OR NEW."sourceSnapshot"->>'formalStatus' IS DISTINCT FROM 'confirmed'
    OR NEW."sourceSnapshot"->>'settlementId' IS DISTINCT FROM source_row.id
    OR NEW."sourceSnapshot"->>'settlementNumber' IS DISTINCT FROM source_row.number
    OR NEW."sourceSnapshot"->>'contractKind' IS DISTINCT FROM source_row."contractKind"
    OR NEW."sourceSnapshot"->>'contractId' IS DISTINCT FROM source_row."contractId"
    OR NEW."sourceSnapshot"->>'contractVersionId' IS DISTINCT FROM source_contract->>'sourceRecordId'
    OR NEW."sourceSnapshot"->>'contractVersionNo' IS DISTINCT FROM source_contract->>'sourceVersion'
    OR NEW."sourceSnapshot"->>'contractTypeKey' IS DISTINCT FROM source_contract->>'contractTypeKey'
    OR NEW."sourceSnapshot"->>'relationship' IS DISTINCT FROM source_contract->>'relationship'
    OR NEW."sourceSnapshot"->>'signedAmountYuan' IS DISTINCT FROM source_row."amountYuan"::text
    OR NEW."sourceSnapshot"->'signedAmountYuan' IS DISTINCT FROM to_jsonb(source_row."amountYuan"::text)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_FACT_MISMATCH' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_validate_signed_settlement_exact_fact() FROM PUBLIC;

CREATE TRIGGER "OperatingFact_signed_settlement_exact_source"
  BEFORE INSERT ON public."OperatingFact" FOR EACH ROW
  WHEN (NEW."sourceType" = 'signed_contract_settlement')
  EXECUTE FUNCTION public.jg_validate_signed_settlement_exact_fact();

-- Keep the same parent trigger OID and effective privileges. Bind the extra
-- branch to the already verified fact and its frozen signed source.
DO $upgrade$
DECLARE
  routine oid := 'public."requireOperatingImpactMoneyProtocol"()'::regprocedure;
  before_row record;
  after_body text;
  anchor constant text := '      AND (NEW."numericProtocolVersion" = 1 OR (';
  branch constant text := $signed$      AND (NEW."numericProtocolVersion" = 1 OR CASE WHEN f."sourceType" = 'signed_contract_settlement' THEN (
        ((
          (f."operatingLevel" = 'project' AND NEW."impactKind" = 'confirmed_cost'
            AND NEW."subjectRole" = 'debtor' AND NEW."subjectKind" = f."debtorSubjectKind" AND NEW."subjectId" = f."debtorSubjectId"
            AND NEW."idempotencyKey" = f."idempotencyKey" || ':confirmed_cost'
            AND NEW."costCategoryCode" = CASE f."sourceSnapshot"->>'contractTypeKey'
              WHEN 'material_purchase' THEN 'material'
              WHEN 'equipment_rental' THEN 'machinery_and_rental'
              WHEN 'labor_subcontract' THEN 'crew_and_labor'
              WHEN 'professional_subcontract' THEN 'professional_subcontract'
              ELSE 'other_project_cost' END)
          OR
          (f."operatingLevel" = 'participating_company' AND NEW."impactKind" = 'receivable_increase'
            AND NEW."subjectRole" = 'creditor' AND NEW."subjectKind" = f."creditorSubjectKind" AND NEW."subjectId" = f."creditorSubjectId"
            AND NEW."idempotencyKey" = f."idempotencyKey" || ':internal-receivable'
            AND NEW."impactSnapshot"->>'relationship' = 'upward'
            AND NEW."impactSnapshot"->>'projectConsolidation' = 'exclude_internal'))
          AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
          AND NEW.direction = CASE WHEN f."sourceSnapshot"->>'signedAmountYuan' LIKE '-%' THEN 'decrease' ELSE 'increase' END)
        OR (f."operatingLevel" = 'project' AND NEW."subjectRole" = 'creditor'
          AND NEW."subjectKind" = f."creditorSubjectKind" AND NEW."subjectId" = f."creditorSubjectId"
          AND NEW."idempotencyKey" = f."idempotencyKey" || ':payable'
          AND NEW."amountYuan" * 100 = abs((f."sourceSnapshot"#>>'{operatingNumericFacts,payableDeltaCents}')::numeric)
          AND CASE
            WHEN f."sourceSnapshot"#>>'{operatingNumericFacts,payableDeltaCents}' = '0' THEN false
            WHEN f."sourceSnapshot"#>>'{operatingNumericFacts,payableDeltaCents}' LIKE '-%' THEN
              NEW."impactKind" = 'payable_decrease' AND NEW.direction = 'decrease'
            ELSE NEW."impactKind" = 'payable_increase' AND NEW.direction = 'increase' END)
      ) ELSE FALSE END OR ($signed$;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p) - 'prosrc' AS metadata
    INTO STRICT before_row FROM pg_proc p WHERE p.oid = routine AND p.proowner = current_user::regrole::oid;
  IF encode(sha256(convert_to(before_row.prosrc, 'UTF8')), 'hex') <> 'ee6c957720c75515173c5858194c6589c3b7cc20a479a02be53863243b0e04fa'
    OR cardinality(string_to_array(before_row.prosrc, anchor)) <> 2
    OR cardinality(string_to_array(before_row.definition, before_row.prosrc)) <> 2
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_PARENT_PREIMAGE' USING ERRCODE = '55000'; END IF;

  after_body := replace(before_row.prosrc, anchor, branch);
  IF encode(sha256(convert_to(after_body, 'UTF8')), 'hex') <> '9b8980f85312ae53e4e94c98badefe460746536ab2e0786ef6f0e22286dc27f7'
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_PARENT_PATCH' USING ERRCODE = '55000'; END IF;
  EXECUTE replace(before_row.definition, before_row.prosrc, after_body);
  IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid = routine AND p.prosrc = after_body
      AND (to_jsonb(p) - 'prosrc') = before_row.metadata)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_PARENT_POSTIMAGE' USING ERRCODE = '55000'; END IF;
END;
$upgrade$;

CREATE FUNCTION public.jg_require_signed_settlement_exact_impacts()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  expected_count integer;
  expected_primary text;
BEGIN
  expected_primary := CASE WHEN NEW."operatingLevel" = 'participating_company' THEN 'receivable_increase' ELSE 'confirmed_cost' END;
  expected_count := CASE WHEN NEW."operatingLevel" = 'participating_company' THEN 1
    WHEN NEW."sourceSnapshot"#>>'{operatingNumericFacts,payableDeltaCents}' = '0' THEN 1 ELSE 2 END;
  IF (SELECT count(*) FROM public."OperatingImpactEntry" i WHERE i."factId" = NEW.id) <> expected_count
    OR NOT EXISTS (SELECT FROM public."OperatingImpactEntry" i
      WHERE i."factId" = NEW.id AND i."sourceImpactKey" = expected_primary)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_EXACT_IMPACTS_INCOMPLETE' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_require_signed_settlement_exact_impacts() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "OperatingFact_signed_settlement_exact_impacts"
  AFTER INSERT ON public."OperatingFact" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."sourceType" = 'signed_contract_settlement' AND NEW."numericProtocolVersion" = 2)
  EXECUTE FUNCTION public.jg_require_signed_settlement_exact_impacts();

COMMIT;
