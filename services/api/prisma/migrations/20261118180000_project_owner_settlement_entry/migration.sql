BEGIN;

CREATE TABLE public."ProjectOwnerSettlementEntry" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES public."Project"("id") ON DELETE RESTRICT,
  "ownerName" TEXT NOT NULL,
  "ownerSubjectId" TEXT NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "amountYuan" NUMERIC(24, 4) NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL REFERENCES public."ProjectAffiliateAssignment"("id") ON DELETE RESTRICT,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "voucherFileId" TEXT NOT NULL REFERENCES public."FileObject"("id") ON DELETE RESTRICT,
  "voucherSha256" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "ProjectOwnerSettlementEntry_nonzero_amount_check"
    CHECK ("amountYuan" <> 0 AND "amountYuan" <> 'NaN'::numeric)
);

CREATE UNIQUE INDEX "ProjectOwnerSettlementEntry_idempotencyKey_key"
  ON public."ProjectOwnerSettlementEntry"("idempotencyKey");
CREATE INDEX "ProjectOwnerSettlementEntry_projectId_settledAt_idx"
  ON public."ProjectOwnerSettlementEntry"("projectId", "settledAt");
CREATE INDEX "ProjectOwnerSettlementEntry_voucherFileId_idx"
  ON public."ProjectOwnerSettlementEntry"("voucherFileId");

CREATE TRIGGER "ProjectOwnerSettlementEntry_append_only"
BEFORE UPDATE OR DELETE ON public."ProjectOwnerSettlementEntry"
FOR EACH ROW EXECUTE FUNCTION public."protectOperatingLedgerAppendOnly"();

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

CREATE TRIGGER "ProjectOwnerSettlementEntry_append_only_truncate"
BEFORE TRUNCATE ON public."ProjectOwnerSettlementEntry"
FOR EACH STATEMENT EXECUTE FUNCTION public."protectOperatingLedgerAppendOnly"();

CREATE FUNCTION public."requireProjectOwnerSettlementSource"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  source public."ProjectOwnerSettlementEntry"%ROWTYPE;
  enterprise_id text;
  cumulative numeric;
BEGIN
  IF NEW."sourceType" <> 'project_owner_settlement_entry' THEN
    RETURN NEW;
  END IF;
  -- The API takes the same project lock before reading history and appending
  -- the signed entry. Retain that serialization at the ledger boundary.
  PERFORM 1 FROM public."Project" p WHERE p.id = NEW."projectId"
    AND p."isActive" AND p."operatingLedgerEffectiveDate" <= NEW."occurredAt"
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '项目经营账尚未启用或业主结算属于历史期间' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO source FROM public."ProjectOwnerSettlementEntry"
  WHERE id = NEW."sourceBusinessId" AND "projectId" = NEW."projectId";
  IF NOT FOUND OR NEW."numericProtocolVersion" IS DISTINCT FROM 2
    OR NEW."sourceVersion" IS DISTINCT FROM 1
    OR NEW."occurredAt" IS DISTINCT FROM source."settledAt"
    OR NEW."confirmedAt" IS DISTINCT FROM source."recordedAt"
    OR NEW."confirmedByUserId" IS DISTINCT FROM source."recordedByUserId"
    OR NEW."affiliateAssignmentId" IS DISTINCT FROM source."affiliateAssignmentId"
    OR NEW."affiliateBusinessPartyVersionId" IS DISTINCT FROM source."affiliateBusinessPartyVersionId"
    OR NEW."creditorSubjectId" IS DISTINCT FROM source."affiliateBusinessPartyVersionId"
    OR NEW."debtorSubjectId" IS DISTINCT FROM source."ownerSubjectId"
    OR source."ownerSubjectId" IS DISTINCT FROM ('owner:' || btrim(source."ownerName"))
    OR NEW."amountYuan" IS DISTINCT FROM abs(source."amountYuan")
    OR NEW.direction IS DISTINCT FROM (CASE WHEN source."amountYuan" < 0 THEN 'outflow' ELSE 'inflow' END)
    OR NEW."basisSnapshot" ->> 'voucherFileId' IS DISTINCT FROM source."voucherFileId"
    OR NEW."basisSnapshot" ->> 'voucherSha256' IS DISTINCT FROM source."voucherSha256" THEN
    RAISE EXCEPTION '业主结算金额、主体或凭证与登记来源不一致' USING ERRCODE = '23514';
  END IF;

  IF source."amountYuan" < 0 THEN
    SELECT a."businessPartyId" INTO STRICT enterprise_id FROM public."ProjectAffiliateAssignment" a
    WHERE a.id = source."affiliateAssignmentId" AND a."projectId" = source."projectId";
    SELECT COALESCE(SUM(
      CASE i.direction WHEN 'decrease' THEN -1 ELSE 1 END *
      CASE i."numericProtocolVersion" WHEN 1 THEN i."amountCents"::numeric / 100
        WHEN 2 THEN i."amountYuan" END
    ), 0) INTO cumulative
    FROM public."OperatingFact" f
    JOIN public."OperatingImpactEntry" i ON i."factId" = f.id AND i."projectId" = f."projectId"
    JOIN public."ProjectAffiliateAssignment" a ON a.id = f."affiliateAssignmentId" AND a."projectId" = f."projectId"
    WHERE f."projectId" = source."projectId" AND f.status = 'confirmed' AND f."evidenceLevel" IN ('A', 'B')
      AND f."factKind" = 'owner_settlement' AND f."debtorSubjectKind" = 'owner' AND f."debtorSubjectId" = source."ownerSubjectId"
      AND a."businessPartyId" = enterprise_id AND i."impactKind" = 'confirmed_income'
      AND i.direction IN ('increase', 'decrease');
    IF cumulative + source."amountYuan" < 0 THEN
      RAISE EXCEPTION '业主累计结算不能低于零' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public."requireProjectOwnerSettlementSource"() FROM PUBLIC;
CREATE TRIGGER "OperatingFact_require_project_owner_settlement_source"
BEFORE INSERT ON public."OperatingFact"
FOR EACH ROW EXECUTE FUNCTION public."requireProjectOwnerSettlementSource"();

CREATE FUNCTION public."requireProjectOwnerSettlementImpacts"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF 2 <> (
    SELECT count(*) FROM public."OperatingImpactEntry" i WHERE i."factId" = NEW.id
      AND i."impactKind" IN ('confirmed_income', CASE NEW.direction WHEN 'outflow'
        THEN 'receivable_decrease' ELSE 'receivable_increase' END)
  ) THEN
    RAISE EXCEPTION '业主结算须同时写入收入与应收影响' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public."requireProjectOwnerSettlementImpacts"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "OperatingFact_project_owner_settlement_impact_set"
AFTER INSERT ON public."OperatingFact"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW."sourceType" = 'project_owner_settlement_entry')
EXECUTE FUNCTION public."requireProjectOwnerSettlementImpacts"();


CREATE FUNCTION public."requireProjectOwnerSettlementLedgerFact"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."OperatingFact" f WHERE f."projectId" = NEW."projectId"
      AND f."sourceType" = 'project_owner_settlement_entry' AND f."sourceBusinessId" = NEW.id
  ) THEN
    RAISE EXCEPTION '业主结算登记必须同步生成收入及应收事实' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public."requireProjectOwnerSettlementLedgerFact"() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "ProjectOwnerSettlementEntry_operating_fact"
AFTER INSERT ON public."ProjectOwnerSettlementEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public."requireProjectOwnerSettlementLedgerFact"();

COMMIT;
