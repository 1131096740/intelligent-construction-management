-- POL-11A-REPAIR / #275: append-only reconciliation relationships.
-- Forward-only artifact. Applying this migration to production is not authorized here.
BEGIN;

SELECT pg_advisory_xact_lock(190909, 275);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol275_owner') THEN
    CREATE ROLE "jg_pol275_owner" NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol275_runtime') THEN
    CREATE ROLE "jg_pol275_runtime" NOLOGIN NOINHERIT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."ClearingEventVersion"
    WHERE "id" IS NULL OR "clearingCaseId" IS NULL
  ) THEN
    RAISE EXCEPTION 'POL-275 EventVersion 同案候选键前置检查失败' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public."ClearingAllocation"
    WHERE "reversesAllocationId" = "id"
  ) THEN
    RAISE EXCEPTION 'POL-275 存在自反清算分配' USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public."ClearingEventVersion"
  ADD CONSTRAINT "ClearingEventVersion_id_clearingCaseId_key"
  UNIQUE ("id", "clearingCaseId");

ALTER TABLE public."ClearingAllocation"
  ADD CONSTRAINT "ClearingAllocation_no_self_reversal"
  CHECK ("reversesAllocationId" IS NULL OR "reversesAllocationId" <> "id");

CREATE INDEX "ClearingAllocation_source_reversal_idx"
  ON public."ClearingAllocation"("sourceEventVersionId", "reversesAllocationId")
  WHERE "sourceEventVersionId" IS NOT NULL;

CREATE TABLE "ClearingReconciliationItem" (
  "id" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "lineageRootItemId" TEXT NOT NULL,
  "additionOfItemId" TEXT,
  "openingDecisionEventVersionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationItem_id_case_key" UNIQUE ("id", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationItem_opening_decision_key" UNIQUE ("openingDecisionEventVersionId"),
  CONSTRAINT "ClearingReconciliationItem_opening_decision_case_key" UNIQUE ("openingDecisionEventVersionId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationItem_shape_check" CHECK (
    ("additionOfItemId" IS NULL AND "lineageRootItemId" = "id")
    OR ("additionOfItemId" IS NOT NULL AND "additionOfItemId" <> "id")
  )
);

CREATE TABLE "ClearingReconciliationRevision" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "decisionEventVersionId" TEXT NOT NULL,
  "adoptsLegacyPendingEventVersionId" TEXT,
  "replacesRevisionId" TEXT,
  "replacedOpenAmountCents" BIGINT,
  "correctsDefinitionReversalId" TEXT,
  "effectiveCaseRevision" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationRevision_id_item_case_key" UNIQUE ("id", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationRevision_item_revision_key" UNIQUE ("itemId", "revisionNo"),
  CONSTRAINT "ClearingReconciliationRevision_decision_key" UNIQUE ("decisionEventVersionId"),
  CONSTRAINT "ClearingReconciliationRevision_case_order_key" UNIQUE ("clearingCaseId", "effectiveCaseRevision"),
  CONSTRAINT "ClearingReconciliationRevision_shape_check" CHECK (
    "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND "effectiveCaseRevision" >= 1
    AND (
      ("kind" = 'open' AND "revisionNo" = 1 AND "replacesRevisionId" IS NULL
        AND "replacedOpenAmountCents" IS NULL AND "correctsDefinitionReversalId" IS NULL)
      OR
      ("kind" = 'replace' AND "revisionNo" > 1 AND "replacesRevisionId" IS NOT NULL
        AND (
          ("correctsDefinitionReversalId" IS NULL AND "replacedOpenAmountCents" > 0)
          OR ("correctsDefinitionReversalId" IS NOT NULL AND "replacedOpenAmountCents" >= 0)
        ))
    )
    AND (
      "adoptsLegacyPendingEventVersionId" IS NULL
      OR ("kind" = 'open' AND "adoptsLegacyPendingEventVersionId" <> "decisionEventVersionId")
    )
  )
);

CREATE UNIQUE INDEX "ClearingReconciliationRevision_legacy_adoption_key"
  ON "ClearingReconciliationRevision"("adoptsLegacyPendingEventVersionId")
  WHERE "adoptsLegacyPendingEventVersionId" IS NOT NULL;

CREATE TABLE "ClearingReconciliationCoverage" (
  "id" TEXT NOT NULL,
  "reconciliationRevisionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "withheldEventVersionId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "decisionEventVersionId" TEXT NOT NULL,
  "intentLineNo" INTEGER NOT NULL,
  "effectiveCaseRevision" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationCoverage_id_revision_item_case_key"
    UNIQUE ("id", "reconciliationRevisionId", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationCoverage_decision_source_key"
    UNIQUE ("decisionEventVersionId", "withheldEventVersionId"),
  CONSTRAINT "ClearingReconciliationCoverage_decision_line_key"
    UNIQUE ("decisionEventVersionId", "intentLineNo"),
  CONSTRAINT "ClearingReconciliationCoverage_shape_check"
    CHECK ("amountCents" > 0 AND "intentLineNo" >= 1 AND "effectiveCaseRevision" >= 1)
);

CREATE TABLE "ClearingReconciliationResolution" (
  "id" TEXT NOT NULL,
  "reconciliationRevisionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL,
  "resultKind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "decisionEventVersionId" TEXT NOT NULL,
  "intentItemNo" INTEGER NOT NULL,
  "reversesResolutionId" TEXT,
  "effectiveCaseRevision" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationResolution_id_revision_item_case_key"
    UNIQUE ("id", "reconciliationRevisionId", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationResolution_decision_item_no_key"
    UNIQUE ("decisionEventVersionId", "intentItemNo"),
  CONSTRAINT "ClearingReconciliationResolution_shape_check" CHECK (
    "amountCents" > 0
    AND "intentItemNo" >= 1
    AND "effectiveCaseRevision" >= 1
    AND "resultKind" IN ('final_confirmed', 'real_return', 'continued_withheld')
    AND (
      ("entryKind" = 'resolution' AND "reversesResolutionId" IS NULL)
      OR ("entryKind" = 'technical_reversal' AND "reversesResolutionId" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "ClearingReconciliationResolution_original_decision_item_key"
  ON "ClearingReconciliationResolution"("decisionEventVersionId", "itemId")
  WHERE "entryKind" = 'resolution';
CREATE UNIQUE INDEX "ClearingReconciliationResolution_reversal_target_key"
  ON "ClearingReconciliationResolution"("decisionEventVersionId", "reversesResolutionId")
  WHERE "entryKind" = 'technical_reversal';

CREATE TABLE "ClearingReconciliationDefinitionReversal" (
  "id" TEXT NOT NULL,
  "targetRevisionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "decisionEventVersionId" TEXT NOT NULL,
  "reversedAmountCents" BIGINT NOT NULL,
  "effectiveCaseRevision" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationDefinitionReversal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationDefinitionReversal_id_item_case_key"
    UNIQUE ("id", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationDefinitionReversal_target_key" UNIQUE ("targetRevisionId"),
  CONSTRAINT "ClearingReconciliationDefinitionReversal_target_item_case_key"
    UNIQUE ("targetRevisionId", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationDefinitionReversal_decision_key" UNIQUE ("decisionEventVersionId"),
  CONSTRAINT "ClearingReconciliationDefinitionReversal_shape_check"
    CHECK ("reversedAmountCents" > 0 AND "effectiveCaseRevision" >= 1)
);

CREATE TABLE "ClearingReconciliationResolutionLine" (
  "id" TEXT NOT NULL,
  "resolutionId" TEXT NOT NULL,
  "reconciliationRevisionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "coverageId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "intentLineNo" INTEGER NOT NULL,
  "clearingAllocationId" TEXT,
  "reversesResolutionLineId" TEXT,
  CONSTRAINT "ClearingReconciliationResolutionLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClearingReconciliationResolutionLine_id_revision_item_case_key"
    UNIQUE ("id", "reconciliationRevisionId", "itemId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationResolutionLine_resolution_line_key"
    UNIQUE ("resolutionId", "intentLineNo"),
  CONSTRAINT "ClearingReconciliationResolutionLine_allocation_key" UNIQUE ("clearingAllocationId"),
  CONSTRAINT "ClearingReconciliationResolutionLine_shape_check" CHECK (
    "amountCents" > 0
    AND "intentLineNo" >= 1
    AND (
      ("sourceKind" = 'withheld_coverage' AND "coverageId" IS NOT NULL)
      OR ("sourceKind" IN ('authority_cap', 'prior_economic_event') AND "coverageId" IS NULL)
    )
  )
);

CREATE UNIQUE INDEX "ClearingReconciliationResolutionLine_original_coverage_key"
  ON "ClearingReconciliationResolutionLine"("resolutionId", "coverageId")
  WHERE "sourceKind" = 'withheld_coverage' AND "reversesResolutionLineId" IS NULL;
CREATE UNIQUE INDEX "ClearingReconciliationResolutionLine_original_authority_key"
  ON "ClearingReconciliationResolutionLine"("resolutionId")
  WHERE "sourceKind" = 'authority_cap' AND "reversesResolutionLineId" IS NULL;
CREATE UNIQUE INDEX "ClearingReconciliationResolutionLine_reversal_key"
  ON "ClearingReconciliationResolutionLine"("resolutionId", "reversesResolutionLineId")
  WHERE "reversesResolutionLineId" IS NOT NULL;

CREATE TABLE "ClearingReconciliationDecisionSeal" (
  "decisionEventVersionId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "intentSchema" TEXT NOT NULL,
  "eventVersionFingerprint" TEXT NOT NULL,
  "relationSetHash" TEXT NOT NULL,
  "revisionCount" INTEGER NOT NULL,
  "coverageCount" INTEGER NOT NULL,
  "resolutionCount" INTEGER NOT NULL,
  "resolutionLineCount" INTEGER NOT NULL,
  "definitionReversalCount" INTEGER NOT NULL,
  "eventAllocationCount" INTEGER NOT NULL,
  "ordinaryAllocationCount" INTEGER NOT NULL,
  "sealedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClearingReconciliationDecisionSeal_pkey" PRIMARY KEY ("decisionEventVersionId"),
  CONSTRAINT "ClearingReconciliationDecisionSeal_decision_case_key"
    UNIQUE ("decisionEventVersionId", "clearingCaseId"),
  CONSTRAINT "ClearingReconciliationDecisionSeal_shape_check" CHECK (
    "intentSchema" = 'clearing_reconciliation_intent/V1'
    AND "eventVersionFingerprint" ~ '^[0-9a-f]{64}$'
    AND "relationSetHash" ~ '^[0-9a-f]{64}$'
    AND "revisionCount" >= 0
    AND "coverageCount" >= 0
    AND "resolutionCount" >= 0
    AND "resolutionLineCount" >= 0
    AND "definitionReversalCount" >= 0
    AND "eventAllocationCount" >= 0
    AND "ordinaryAllocationCount" >= 0
    AND "ordinaryAllocationCount" <= "eventAllocationCount"
  )
);

ALTER TABLE "ClearingReconciliationItem"
  ADD CONSTRAINT "ClearingReconciliationItem_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationItem_root_fkey"
    FOREIGN KEY ("lineageRootItemId", "clearingCaseId") REFERENCES "ClearingReconciliationItem"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationItem_addition_fkey"
    FOREIGN KEY ("additionOfItemId", "clearingCaseId") REFERENCES "ClearingReconciliationItem"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationItem_opening_decision_fkey"
    FOREIGN KEY ("openingDecisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationRevision"
  ADD CONSTRAINT "ClearingReconciliationRevision_item_fkey"
    FOREIGN KEY ("itemId", "clearingCaseId") REFERENCES "ClearingReconciliationItem"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationRevision_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationRevision_decision_fkey"
    FOREIGN KEY ("decisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationRevision_adoption_fkey"
    FOREIGN KEY ("adoptsLegacyPendingEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationRevision_replaces_fkey"
    FOREIGN KEY ("replacesRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationRevision"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationCoverage"
  ADD CONSTRAINT "ClearingReconciliationCoverage_revision_fkey"
    FOREIGN KEY ("reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationRevision"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationCoverage_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationCoverage_withheld_fkey"
    FOREIGN KEY ("withheldEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationCoverage_decision_fkey"
    FOREIGN KEY ("decisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationResolution"
  ADD CONSTRAINT "ClearingReconciliationResolution_revision_fkey"
    FOREIGN KEY ("reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationRevision"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolution_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolution_decision_fkey"
    FOREIGN KEY ("decisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolution_reverses_fkey"
    FOREIGN KEY ("reversesResolutionId", "reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationResolution"("id", "reconciliationRevisionId", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationDefinitionReversal"
  ADD CONSTRAINT "ClearingReconciliationDefinitionReversal_target_fkey"
    FOREIGN KEY ("targetRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationRevision"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationDefinitionReversal_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationDefinitionReversal_decision_fkey"
    FOREIGN KEY ("decisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationRevision"
  ADD CONSTRAINT "ClearingReconciliationRevision_definition_correction_fkey"
    FOREIGN KEY ("correctsDefinitionReversalId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationDefinitionReversal"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationResolutionLine"
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_resolution_fkey"
    FOREIGN KEY ("resolutionId", "reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationResolution"("id", "reconciliationRevisionId", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_revision_fkey"
    FOREIGN KEY ("reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationRevision"("id", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_coverage_fkey"
    FOREIGN KEY ("coverageId", "reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationCoverage"("id", "reconciliationRevisionId", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_allocation_fkey"
    FOREIGN KEY ("clearingAllocationId") REFERENCES "ClearingAllocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationResolutionLine_reverses_fkey"
    FOREIGN KEY ("reversesResolutionLineId", "reconciliationRevisionId", "itemId", "clearingCaseId") REFERENCES "ClearingReconciliationResolutionLine"("id", "reconciliationRevisionId", "itemId", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClearingReconciliationDecisionSeal"
  ADD CONSTRAINT "ClearingReconciliationDecisionSeal_case_fkey"
    FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationDecisionSeal_version_fkey"
    FOREIGN KEY ("decisionEventVersionId", "clearingCaseId") REFERENCES "ClearingEventVersion"("id", "clearingCaseId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClearingReconciliationDecisionSeal_confirmation_fkey"
    FOREIGN KEY ("decisionEventVersionId") REFERENCES "ClearingConfirmation"("eventVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "ClearingReconciliationItem_case_created_idx" ON "ClearingReconciliationItem"("clearingCaseId", "createdAt", "id");
CREATE INDEX "ClearingReconciliationItem_root_created_idx" ON "ClearingReconciliationItem"("lineageRootItemId", "createdAt", "id");
CREATE INDEX "ClearingReconciliationItem_addition_idx" ON "ClearingReconciliationItem"("additionOfItemId");
CREATE INDEX "ClearingReconciliationRevision_case_confirmed_idx" ON "ClearingReconciliationRevision"("clearingCaseId", "confirmedAt", "effectiveCaseRevision");
CREATE INDEX "ClearingReconciliationCoverage_withheld_confirmed_idx" ON "ClearingReconciliationCoverage"("withheldEventVersionId", "confirmedAt");
CREATE INDEX "ClearingReconciliationCoverage_revision_confirmed_idx" ON "ClearingReconciliationCoverage"("reconciliationRevisionId", "confirmedAt");
CREATE INDEX "ClearingReconciliationCoverage_case_confirmed_item_idx" ON "ClearingReconciliationCoverage"("clearingCaseId", "confirmedAt", "itemId");
CREATE INDEX "ClearingReconciliationResolution_item_confirmed_idx" ON "ClearingReconciliationResolution"("itemId", "confirmedAt", "effectiveCaseRevision");
CREATE INDEX "ClearingReconciliationResolution_reverses_idx" ON "ClearingReconciliationResolution"("reversesResolutionId");
CREATE INDEX "ClearingReconciliationResolution_decision_idx" ON "ClearingReconciliationResolution"("decisionEventVersionId");
CREATE INDEX "ClearingReconciliationDefinitionReversal_item_confirmed_idx" ON "ClearingReconciliationDefinitionReversal"("itemId", "confirmedAt", "effectiveCaseRevision");
CREATE INDEX "ClearingReconciliationResolutionLine_coverage_idx" ON "ClearingReconciliationResolutionLine"("coverageId");
CREATE INDEX "ClearingReconciliationResolutionLine_reverses_idx" ON "ClearingReconciliationResolutionLine"("reversesResolutionLineId");

CREATE FUNCTION "pol275_reject_reconciliation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'POL-275 核对关系为追加式证据，禁止更新、删除或截断' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ClearingReconciliationItem_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationItem" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationRevision_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationRevision" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationCoverage_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationCoverage" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationResolution_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationResolution" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationDefinitionReversal_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationDefinitionReversal" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationResolutionLine_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationResolutionLine" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationDecisionSeal_pol275_immutable" BEFORE UPDATE OR DELETE ON "ClearingReconciliationDecisionSeal" FOR EACH ROW EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();

CREATE TRIGGER "ClearingReconciliationItem_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationItem" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationRevision_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationRevision" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationCoverage_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationCoverage" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationResolution_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationResolution" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationDefinitionReversal_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationDefinitionReversal" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationResolutionLine_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationResolutionLine" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();
CREATE TRIGGER "ClearingReconciliationDecisionSeal_pol275_no_truncate" BEFORE TRUNCATE ON "ClearingReconciliationDecisionSeal" FOR EACH STATEMENT EXECUTE FUNCTION "pol275_reject_reconciliation_mutation"();

CREATE FUNCTION "pol275_jsonb_has_exact_keys"(p_value JSONB, p_keys TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_typeof(p_value) = 'object'
    AND (SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::TEXT[]) FROM jsonb_object_keys(p_value) key)
      = (SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::TEXT[]) FROM unnest(p_keys) key);
$$;

CREATE FUNCTION "pol275_active_coverage_occupancy"(p_withheld_event_version_id TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH effective_revisions AS (
    SELECT revision."id"
    FROM public."ClearingReconciliationRevision" revision
    WHERE NOT EXISTS (
      SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
      WHERE reversed."targetRevisionId" = revision."id"
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public."ClearingReconciliationRevision" later
        WHERE later."itemId" = revision."itemId"
          AND later."revisionNo" > revision."revisionNo"
          AND NOT EXISTS (
            SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" later_reversed
            WHERE later_reversed."targetRevisionId" = later."id"
          )
      )
  ),
  line_effects AS (
    SELECT
      line."coverageId",
      resolution."reconciliationRevisionId",
      resolution."resultKind",
      line."amountCents" - COALESCE(SUM(reversal_line."amountCents"), 0)::BIGINT AS net_amount
    FROM public."ClearingReconciliationResolution" resolution
    JOIN public."ClearingReconciliationResolutionLine" line
      ON line."resolutionId" = resolution."id"
    LEFT JOIN public."ClearingReconciliationResolutionLine" reversal_line
      ON reversal_line."reversesResolutionLineId" = line."id"
    WHERE resolution."entryKind" = 'resolution'
      AND line."sourceKind" = 'withheld_coverage'
    GROUP BY line."id", line."coverageId", resolution."reconciliationRevisionId",
      resolution."resultKind", line."amountCents"
  ),
  open_coverage AS (
    SELECT coverage."id",
      coverage."amountCents" - COALESCE(SUM(effect.net_amount), 0)::BIGINT AS amount
    FROM public."ClearingReconciliationCoverage" coverage
    JOIN effective_revisions current_revision ON current_revision."id" = coverage."reconciliationRevisionId"
    LEFT JOIN line_effects effect ON effect."coverageId" = coverage."id"
    WHERE coverage."withheldEventVersionId" = p_withheld_event_version_id
    GROUP BY coverage."id", coverage."amountCents"
  ),
  retained AS (
    SELECT COALESCE(SUM(effect.net_amount), 0)::BIGINT AS amount
    FROM line_effects effect
    JOIN public."ClearingReconciliationCoverage" coverage ON coverage."id" = effect."coverageId"
    WHERE effect."resultKind" = 'continued_withheld'
      AND coverage."withheldEventVersionId" = p_withheld_event_version_id
      AND NOT EXISTS (
        SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
        WHERE reversed."targetRevisionId" = effect."reconciliationRevisionId"
      )
  )
  SELECT COALESCE((SELECT SUM(amount) FROM open_coverage), 0)::BIGINT
    + COALESCE((SELECT amount FROM retained), 0)::BIGINT;
$$;

CREATE OR REPLACE FUNCTION "pol214_clearing_allocation_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_case_id TEXT;
  target_kind TEXT;
  target_intent JSONB;
  allocation_plan JSONB;
  resolution_line_plan JSONB;
  case_record RECORD;
  source_record RECORD;
  original_record RECORD;
  net_used BIGINT;
  reversed_used BIGINT;
  final_net_used BIGINT;
  occupancy BIGINT;
  coverage_relief BIGINT := 0;
BEGIN
  IF NEW."amountCents" <= 0 THEN
    RAISE EXCEPTION '清算分配金额必须为正整数分' USING ERRCODE = '23514';
  END IF;
  SELECT version."clearingCaseId", event."kind",
         version."payloadSnapshot" -> 'reconciliationIntent'
    INTO target_case_id, target_kind, target_intent
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingEvent" event ON event."id" = version."clearingEventId"
   WHERE version."id" = NEW."eventVersionId";
  IF target_case_id IS NULL THEN
    RAISE EXCEPTION 'POL-275 分配目标版本不存在' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pol275:case:' || target_case_id, 0)
  );
  SELECT "id", "sourceDiscriminator", "authoritativeGrossCapCents"
    INTO case_record
    FROM public."ClearingCase"
   WHERE "id" = target_case_id;

  IF target_intent ->> 'schema' = 'clearing_reconciliation_intent/V1' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."ClearingConfirmation"
      WHERE "eventVersionId" = NEW."eventVersionId"
    ) THEN
      RAISE EXCEPTION 'POL-275 V1 分配只能与确认同事务写入' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public."ClearingReconciliationDecisionSeal"
      WHERE "decisionEventVersionId" = NEW."eventVersionId"
    ) THEN
      RAISE EXCEPTION 'POL-275 已封印决策不得迟到追加分配' USING ERRCODE = '23514';
    END IF;
    SELECT entry INTO allocation_plan
    FROM jsonb_array_elements(target_intent -> 'eventAllocations') entry
    WHERE entry ->> 'clearingAllocationId' = NEW."id";
    IF target_kind = 'technical_reversal'
      AND target_intent ->> 'operation' = 'reverse_resolution'
    THEN
      SELECT line_entry INTO resolution_line_plan
      FROM jsonb_array_elements(target_intent -> 'resolutions') resolution_entry
      CROSS JOIN LATERAL jsonb_array_elements(resolution_entry -> 'lines') line_entry
      WHERE line_entry ->> 'resolutionLineId'
        = allocation_plan ->> 'resolutionLineId';
    END IF;
    IF allocation_plan IS NULL
      OR allocation_plan ->> 'allocationSourceKind' <> NEW."sourceKind"
      OR allocation_plan ->> 'sourceEventVersionId' IS DISTINCT FROM NEW."sourceEventVersionId"
      OR (allocation_plan ->> 'amountCents')::BIGINT <> NEW."amountCents"
      OR (
        target_kind = 'technical_reversal'
        AND target_intent ->> 'operation' = 'reverse_resolution'
        AND (
          resolution_line_plan IS NULL
          OR resolution_line_plan ->> 'plannedClearingAllocationId' <> NEW."id"
          OR NOT EXISTS (
            SELECT 1
            FROM public."ClearingReconciliationResolutionLine" original_line
            WHERE original_line."id"
              = resolution_line_plan ->> 'reversesResolutionLineId'
              AND original_line."clearingAllocationId"
                = NEW."reversesAllocationId"
          )
        )
      )
      OR (
        target_kind <> 'technical_reversal'
        AND NEW."reversesAllocationId" IS NOT NULL
      )
    THEN
      RAISE EXCEPTION 'POL-275 V1 分配与冻结完整计划不一致' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."sourceKind" = 'authority_cap' THEN
    IF NEW."sourceEventVersionId" IS NOT NULL THEN
      RAISE EXCEPTION '权威额度分配不得引用来源版本' USING ERRCODE = '23514';
    END IF;
    IF NEW."reversesAllocationId" IS NOT NULL THEN
      IF target_kind <> 'technical_reversal' THEN
        RAISE EXCEPTION '只有技术反向事件可以反向清算分配' USING ERRCODE = '23514';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pol275:allocation:' || NEW."reversesAllocationId", 0)
      );
      SELECT * INTO original_record
      FROM public."ClearingAllocation"
      WHERE "id" = NEW."reversesAllocationId";
      IF NOT FOUND OR original_record."reversesAllocationId" IS NOT NULL
        OR original_record."sourceKind" <> 'authority_cap'
        OR original_record."sourceEventVersionId" IS NOT NULL
      THEN
        RAISE EXCEPTION '技术反向未精确引用原权威额度分配' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(SUM("amountCents"), 0)::BIGINT INTO reversed_used
      FROM public."ClearingAllocation"
      WHERE "reversesAllocationId" = original_record."id";
      IF reversed_used + NEW."amountCents" > original_record."amountCents" THEN
        RAISE EXCEPTION '技术反向超过原分配剩余效果' USING ERRCODE = '23514';
      END IF;
    END IF;
    SELECT COALESCE(SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
      THEN allocation."amountCents" ELSE -allocation."amountCents" END), 0)::BIGINT
      INTO net_used
    FROM public."ClearingAllocation" allocation
    JOIN public."ClearingEventVersion" target ON target."id" = allocation."eventVersionId"
    WHERE target."clearingCaseId" = target_case_id
      AND allocation."sourceKind" = 'authority_cap';
    IF NEW."reversesAllocationId" IS NULL THEN
      final_net_used := net_used + NEW."amountCents";
    ELSE
      final_net_used := net_used - NEW."amountCents";
    END IF;
    IF case_record."sourceDiscriminator" = 'construction_enterprise_guarantee'
      AND final_net_used > case_record."authoritativeGrossCapCents"
    THEN
      RAISE EXCEPTION 'POL-214 保证金权威额度分配超过上限' USING ERRCODE = '23514';
    END IF;
    IF final_net_used < 0 THEN
      RAISE EXCEPTION '权威额度技术反向产生负净分配' USING ERRCODE = '23514';
    END IF;
    IF NEW."sourceRemainingAfterCents" <> case_record."authoritativeGrossCapCents" - final_net_used THEN
      RAISE EXCEPTION '权威额度分配剩余快照不一致' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."sourceEventVersionId" IS NULL THEN
    RAISE EXCEPTION '非权威额度分配必须引用来源版本' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pol275:event-version:' || NEW."sourceEventVersionId", 0)
  );
  SELECT version."id", version."clearingCaseId", version."amountCents", event."kind"
    INTO source_record
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingEvent" event ON event."id" = version."clearingEventId"
    JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = version."id"
   WHERE version."id" = NEW."sourceEventVersionId";
  IF NOT FOUND OR source_record."clearingCaseId" <> target_case_id
    OR source_record."kind" <> NEW."sourceKind"
  THEN
    RAISE EXCEPTION '清算分配来源不存在、未确认、跨案或类型不一致' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
    THEN allocation."amountCents" ELSE -allocation."amountCents" END), 0)::BIGINT
    INTO net_used
    FROM public."ClearingAllocation" allocation
   WHERE allocation."sourceEventVersionId" = NEW."sourceEventVersionId";

  IF NEW."reversesAllocationId" IS NULL THEN
    final_net_used := net_used + NEW."amountCents";
  ELSE
    IF target_kind <> 'technical_reversal' THEN
      RAISE EXCEPTION '只有技术反向事件可以反向清算分配' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('pol275:allocation:' || NEW."reversesAllocationId", 0)
    );
    SELECT * INTO original_record
      FROM public."ClearingAllocation"
     WHERE "id" = NEW."reversesAllocationId";
    IF NOT FOUND OR original_record."reversesAllocationId" IS NOT NULL
      OR original_record."sourceEventVersionId" IS DISTINCT FROM NEW."sourceEventVersionId"
      OR original_record."sourceKind" IS DISTINCT FROM NEW."sourceKind"
    THEN
      RAISE EXCEPTION '技术反向未精确引用原清算分配' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0)::BIGINT INTO reversed_used
      FROM public."ClearingAllocation"
     WHERE "reversesAllocationId" = original_record."id";
    IF reversed_used + NEW."amountCents" > original_record."amountCents" THEN
      RAISE EXCEPTION '技术反向超过原分配剩余效果' USING ERRCODE = '23514';
    END IF;
    final_net_used := net_used - NEW."amountCents";
  END IF;
  occupancy := public."pol275_active_coverage_occupancy"(NEW."sourceEventVersionId");
  IF target_intent ->> 'schema' = 'clearing_reconciliation_intent/V1'
    AND NEW."reversesAllocationId" IS NULL
    AND NEW."sourceKind" = 'withheld'
    AND allocation_plan ->> 'purpose' = 'reconciliation_line'
  THEN
    SELECT line_entry INTO resolution_line_plan
    FROM jsonb_array_elements(target_intent -> 'resolutions') resolution_entry
    CROSS JOIN LATERAL jsonb_array_elements(resolution_entry -> 'lines') line_entry
    WHERE line_entry ->> 'resolutionLineId' = allocation_plan ->> 'resolutionLineId';
    IF resolution_line_plan ->> 'sourceKind' = 'withheld_coverage'
      AND resolution_line_plan ->> 'plannedClearingAllocationId' = NEW."id"
      AND (resolution_line_plan ->> 'amountCents')::BIGINT = NEW."amountCents"
      AND EXISTS (
        SELECT 1 FROM public."ClearingReconciliationCoverage" coverage
        WHERE coverage."id" = resolution_line_plan ->> 'coverageId'
          AND coverage."withheldEventVersionId" = NEW."sourceEventVersionId"
      )
    THEN
      coverage_relief := NEW."amountCents";
    END IF;
  END IF;
  IF final_net_used < 0
    OR final_net_used + occupancy - coverage_relief > source_record."amountCents"
  THEN
    RAISE EXCEPTION '清算分配与有效覆盖合计超过来源余额' USING ERRCODE = '23514';
  END IF;
  IF NEW."sourceRemainingAfterCents" <> source_record."amountCents" - final_net_used THEN
    RAISE EXCEPTION '清算分配剩余余额快照不一致' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "pol275_relation_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_json JSONB := to_jsonb(NEW);
  decision_id TEXT;
  case_id TEXT;
  row_id TEXT;
  planned_key TEXT;
  version_record RECORD;
  intent JSONB;
  expected_confirmed_at TIMESTAMPTZ(3);
BEGIN
  IF TG_TABLE_NAME = 'ClearingReconciliationItem' THEN
    decision_id := row_json ->> 'openingDecisionEventVersionId';
    planned_key := 'newItemId';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationRevision' THEN
    decision_id := row_json ->> 'decisionEventVersionId';
    planned_key := 'revisionId';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationCoverage' THEN
    decision_id := row_json ->> 'decisionEventVersionId';
    planned_key := 'coverageIds';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationResolution' THEN
    decision_id := row_json ->> 'decisionEventVersionId';
    planned_key := 'resolutionIds';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationDefinitionReversal' THEN
    decision_id := row_json ->> 'decisionEventVersionId';
    planned_key := 'definitionReversalId';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationResolutionLine' THEN
    SELECT resolution."decisionEventVersionId" INTO decision_id
      FROM public."ClearingReconciliationResolution" resolution
     WHERE resolution."id" = row_json ->> 'resolutionId';
    planned_key := 'resolutionLineIds';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationDecisionSeal' THEN
    decision_id := row_json ->> 'decisionEventVersionId';
  ELSE
    RAISE EXCEPTION 'POL-275 未知关系表' USING ERRCODE = '23514';
  END IF;
  case_id := row_json ->> 'clearingCaseId';
  row_id := row_json ->> 'id';
  SELECT version."payloadSnapshot", version."fingerprint", version."clearingCaseId",
         clearing_case."revision" AS case_revision,
         confirmation."confirmedAt" AT TIME ZONE 'UTC' AS confirmed_at
    INTO version_record
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = version."id"
    JOIN public."ClearingCase" clearing_case ON clearing_case."id" = version."clearingCaseId"
   WHERE version."id" = decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POL-275 关系写入缺少同事务精确确认' USING ERRCODE = '23514';
  END IF;
  intent := version_record."payloadSnapshot" -> 'reconciliationIntent';
  IF intent ->> 'schema' <> 'clearing_reconciliation_intent/V1'
    OR version_record."clearingCaseId" <> case_id
  THEN
    RAISE EXCEPTION 'POL-275 关系写入版本或案件不匹配' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME <> 'ClearingReconciliationDecisionSeal'
    AND EXISTS (
      SELECT 1 FROM public."ClearingReconciliationDecisionSeal"
      WHERE "decisionEventVersionId" = decision_id
    )
  THEN
    RAISE EXCEPTION 'POL-275 已封印版本禁止迟到追加' USING ERRCODE = '23514';
  END IF;
  IF row_json ? 'effectiveCaseRevision'
    AND (row_json ->> 'effectiveCaseRevision')::INTEGER <> version_record.case_revision + 1
  THEN
    RAISE EXCEPTION 'POL-275 关系生效顺序必须由案件修订号派生' USING ERRCODE = '23514';
  END IF;
  IF row_json ? 'confirmedAt' THEN
    expected_confirmed_at := version_record.confirmed_at;
    IF (row_json ->> 'confirmedAt')::TIMESTAMPTZ(3) IS DISTINCT FROM expected_confirmed_at THEN
      RAISE EXCEPTION 'POL-275 关系确认时间必须由正式确认派生' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF planned_key IN ('newItemId', 'revisionId', 'definitionReversalId')
    AND intent -> 'plannedIds' ->> planned_key IS DISTINCT FROM row_id
  THEN
    RAISE EXCEPTION 'POL-275 关系 ID 不在冻结计划内' USING ERRCODE = '23514';
  ELSIF planned_key IN ('coverageIds', 'resolutionIds', 'resolutionLineIds')
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(intent -> 'plannedIds' -> planned_key) planned_id
      WHERE planned_id = row_id
    )
  THEN
    RAISE EXCEPTION 'POL-275 关系行 ID 不在冻结计划内' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClearingReconciliationItem_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationItem" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationRevision_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationRevision" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationCoverage_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationCoverage" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationResolution_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationResolution" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationDefinitionReversal_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationDefinitionReversal" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationResolutionLine_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationResolutionLine" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();
CREATE TRIGGER "ClearingReconciliationDecisionSeal_pol275_insert_guard" BEFORE INSERT ON "ClearingReconciliationDecisionSeal" FOR EACH ROW EXECUTE FUNCTION "pol275_relation_insert_guard"();

CREATE FUNCTION "pol275_clearing_impact_link_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_intent JSONB;
  target_kind TEXT;
  source_record RECORD;
  reversed_total BIGINT;
BEGIN
  SELECT version."payloadSnapshot" -> 'reconciliationIntent', event."kind"
    INTO target_intent, target_kind
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingEvent" event ON event."id" = version."clearingEventId"
   WHERE version."id" = NEW."eventVersionId";
  IF target_intent ->> 'schema' IS DISTINCT FROM 'clearing_reconciliation_intent/V1' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."ClearingConfirmation"
    WHERE "eventVersionId" = NEW."eventVersionId"
  ) THEN
    RAISE EXCEPTION 'POL-275 V1 impact 只能与确认同事务写入' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."ClearingReconciliationDecisionSeal"
    WHERE "decisionEventVersionId" = NEW."eventVersionId"
  ) THEN
    RAISE EXCEPTION 'POL-275 已封印决策不得迟到追加 impact' USING ERRCODE = '23514';
  END IF;
  IF target_kind <> 'technical_reversal' THEN
    RETURN NEW;
  END IF;
  IF target_intent ->> 'operation' <> 'reverse_resolution'
    OR NEW."reversesImpactId" IS NULL
  THEN
    RAISE EXCEPTION 'POL-275 定义反向不得生成 impact，解决反向必须精确引用原 impact' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pol275:impact:' || NEW."reversesImpactId", 0)
  );
  SELECT source_link."amountCents" AS source_link_amount,
         source_link."operatingFactId" AS source_fact_id,
         source_impact."impactKind" AS source_impact_kind,
         source_impact."amountCents" AS source_impact_amount,
         source_impact."direction" AS source_direction,
         source_impact."subjectRole" AS source_subject_role,
         source_impact."subjectKind" AS source_subject_kind,
         source_impact."subjectId" AS source_subject_id,
         source_impact."costCategoryCode" AS source_cost_category_code,
         source_impact."fundPurpose" AS source_fund_purpose,
         target_impact."impactKind" AS target_impact_kind,
         target_impact."amountCents" AS target_impact_amount,
         target_impact."direction" AS target_direction,
         target_impact."subjectRole" AS target_subject_role,
         target_impact."subjectKind" AS target_subject_kind,
         target_impact."subjectId" AS target_subject_id,
         target_impact."costCategoryCode" AS target_cost_category_code,
         target_impact."fundPurpose" AS target_fund_purpose,
         target_fact."entryKind" AS target_entry_kind,
         target_fact."adjustsFactId" AS target_adjusts_fact_id
    INTO source_record
    FROM public."ClearingImpactLink" source_link
    JOIN public."OperatingImpactEntry" source_impact
      ON source_impact."id" = source_link."operatingImpactId"
    JOIN public."OperatingImpactEntry" target_impact
      ON target_impact."id" = NEW."operatingImpactId"
    JOIN public."OperatingFact" target_fact
      ON target_fact."id" = NEW."operatingFactId"
   WHERE source_link."id" = NEW."reversesImpactId";
  IF NOT FOUND
    OR NEW."amountCents" <= 0
    OR NEW."amountCents" <> source_record.target_impact_amount
    OR NEW."amountCents" > source_record.source_link_amount
    OR NEW."amountCents" > source_record.source_impact_amount
    OR source_record.source_impact_kind <> source_record.target_impact_kind
    OR NOT (
      (source_record.source_direction = 'increase' AND source_record.target_direction = 'decrease')
      OR (source_record.source_direction = 'decrease' AND source_record.target_direction = 'increase')
      OR (source_record.source_direction = 'notice' AND source_record.target_direction = 'notice')
    )
    OR source_record.source_subject_role IS DISTINCT FROM source_record.target_subject_role
    OR source_record.source_subject_kind IS DISTINCT FROM source_record.target_subject_kind
    OR source_record.source_subject_id IS DISTINCT FROM source_record.target_subject_id
    OR source_record.source_cost_category_code IS DISTINCT FROM source_record.target_cost_category_code
    OR source_record.source_fund_purpose IS DISTINCT FROM source_record.target_fund_purpose
    OR source_record.target_entry_kind <> 'correction'
    OR source_record.target_adjusts_fact_id IS DISTINCT FROM source_record.source_fact_id
  THEN
    RAISE EXCEPTION 'POL-275 技术反向 impact 未精确反向原经营影响' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0)::BIGINT INTO reversed_total
    FROM public."ClearingImpactLink"
   WHERE "reversesImpactId" = NEW."reversesImpactId";
  IF reversed_total + NEW."amountCents" > source_record.source_link_amount THEN
    RAISE EXCEPTION 'POL-275 技术反向 impact 超过原影响剩余效果' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClearingImpactLink_pol275_insert_guard"
  BEFORE INSERT ON "ClearingImpactLink"
  FOR EACH ROW EXECUTE FUNCTION "pol275_clearing_impact_link_guard"();

CREATE FUNCTION "pol275_relation_set_hash_v1"(p_decision_event_version_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT encode(public.digest(convert_to(
    'pol275/relation-set/V1' || chr(10) || jsonb_build_object(
      'decisionEventVersionId', version."id",
      'clearingCaseId', version."clearingCaseId",
      'counts', jsonb_build_object(
        'items', (SELECT COUNT(*) FROM public."ClearingReconciliationItem" item WHERE item."openingDecisionEventVersionId" = version."id"),
        'revisions', (SELECT COUNT(*) FROM public."ClearingReconciliationRevision" revision WHERE revision."decisionEventVersionId" = version."id"),
        'coverages', (SELECT COUNT(*) FROM public."ClearingReconciliationCoverage" coverage WHERE coverage."decisionEventVersionId" = version."id"),
        'resolutions', (SELECT COUNT(*) FROM public."ClearingReconciliationResolution" resolution WHERE resolution."decisionEventVersionId" = version."id"),
        'resolutionLines', (SELECT COUNT(*) FROM public."ClearingReconciliationResolutionLine" line JOIN public."ClearingReconciliationResolution" resolution ON resolution."id" = line."resolutionId" WHERE resolution."decisionEventVersionId" = version."id"),
        'definitionReversals', (SELECT COUNT(*) FROM public."ClearingReconciliationDefinitionReversal" reversal WHERE reversal."decisionEventVersionId" = version."id"),
        'eventAllocations', (SELECT COUNT(*) FROM public."ClearingAllocation" allocation WHERE allocation."eventVersionId" = version."id")
      ),
      'items', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) ORDER BY item."id")
        FROM public."ClearingReconciliationItem" item
        WHERE item."openingDecisionEventVersionId" = version."id"
      ), '[]'::JSONB),
      'revisions', COALESCE((
        SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision."id")
        FROM public."ClearingReconciliationRevision" revision
        WHERE revision."decisionEventVersionId" = version."id"
      ), '[]'::JSONB),
      'coverages', COALESCE((
        SELECT jsonb_agg(to_jsonb(coverage) ORDER BY coverage."intentLineNo", coverage."id")
        FROM public."ClearingReconciliationCoverage" coverage
        WHERE coverage."decisionEventVersionId" = version."id"
      ), '[]'::JSONB),
      'resolutions', COALESCE((
        SELECT jsonb_agg(to_jsonb(resolution) ORDER BY resolution."intentItemNo", resolution."id")
        FROM public."ClearingReconciliationResolution" resolution
        WHERE resolution."decisionEventVersionId" = version."id"
      ), '[]'::JSONB),
      'resolutionLines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line) ORDER BY resolution."intentItemNo", line."intentLineNo", line."id")
        FROM public."ClearingReconciliationResolutionLine" line
        JOIN public."ClearingReconciliationResolution" resolution ON resolution."id" = line."resolutionId"
        WHERE resolution."decisionEventVersionId" = version."id"
      ), '[]'::JSONB),
      'definitionReversal', (
        SELECT to_jsonb(reversal)
        FROM public."ClearingReconciliationDefinitionReversal" reversal
        WHERE reversal."decisionEventVersionId" = version."id"
      ),
      'eventAllocations', COALESCE((
        SELECT jsonb_agg(to_jsonb(allocation) - 'createdAt' ORDER BY allocation."id")
        FROM public."ClearingAllocation" allocation
        WHERE allocation."eventVersionId" = version."id"
      ), '[]'::JSONB)
    )::TEXT,
    'UTF8'
  ), 'sha256'), 'hex')
  FROM public."ClearingEventVersion" version
  WHERE version."id" = p_decision_event_version_id;
$$;

CREATE FUNCTION "pol275_assert_reconciliation_closure"(p_decision_event_version_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  version_record RECORD;
  seal_record RECORD;
  intent JSONB;
  expected_revision_count INTEGER;
  expected_coverage_count INTEGER;
  expected_resolution_count INTEGER;
  expected_line_count INTEGER;
  expected_definition_count INTEGER;
  expected_allocation_count INTEGER;
  expected_ordinary_count INTEGER;
  impact_mismatch BOOLEAN;
BEGIN
  SELECT version."clearingCaseId", version."fingerprint", version."payloadSnapshot",
         event."kind" AS event_kind,
         confirmation."confirmedAt" AT TIME ZONE 'UTC' AS confirmed_at
    INTO version_record
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingEvent" event ON event."id" = version."clearingEventId"
    JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = version."id"
   WHERE version."id" = p_decision_event_version_id;
  IF NOT FOUND THEN RETURN; END IF;
  intent := version_record."payloadSnapshot" -> 'reconciliationIntent';
  IF intent IS NULL OR intent ->> 'schema' IS DISTINCT FROM 'clearing_reconciliation_intent/V1' THEN
    RETURN;
  END IF;
  SELECT * INTO seal_record
    FROM public."ClearingReconciliationDecisionSeal"
   WHERE "decisionEventVersionId" = p_decision_event_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POL-275 V1 确认缺少同事务决策封印' USING ERRCODE = '23514';
  END IF;

  expected_revision_count := CASE WHEN jsonb_typeof(intent -> 'itemDefinition') = 'object' THEN 1 ELSE 0 END;
  expected_coverage_count := jsonb_array_length(intent -> 'coverages');
  expected_resolution_count := jsonb_array_length(intent -> 'resolutions');
  SELECT COALESCE(SUM(jsonb_array_length(resolution -> 'lines')), 0)::INTEGER
    INTO expected_line_count
    FROM jsonb_array_elements(intent -> 'resolutions') resolution;
  expected_definition_count := CASE WHEN jsonb_typeof(intent -> 'definitionReversal') = 'object' THEN 1 ELSE 0 END;
  expected_allocation_count := jsonb_array_length(intent -> 'eventAllocations');
  SELECT COUNT(*)::INTEGER INTO expected_ordinary_count
    FROM jsonb_array_elements(intent -> 'eventAllocations') allocation
   WHERE allocation ->> 'purpose' = 'ordinary_remainder';

  IF seal_record."clearingCaseId" <> version_record."clearingCaseId"
    OR seal_record."intentSchema" <> 'clearing_reconciliation_intent/V1'
    OR seal_record."eventVersionFingerprint" <> version_record."fingerprint"
    OR seal_record."sealedAt" <> version_record.confirmed_at
    OR seal_record."revisionCount" <> expected_revision_count
    OR seal_record."coverageCount" <> expected_coverage_count
    OR seal_record."resolutionCount" <> expected_resolution_count
    OR seal_record."resolutionLineCount" <> expected_line_count
    OR seal_record."definitionReversalCount" <> expected_definition_count
    OR seal_record."eventAllocationCount" <> expected_allocation_count
    OR seal_record."ordinaryAllocationCount" <> expected_ordinary_count
    OR seal_record."relationSetHash" <> public."pol275_relation_set_hash_v1"(p_decision_event_version_id)
  THEN
    RAISE EXCEPTION 'POL-275 冻结意图、关系集合、分配与封印不闭合' USING ERRCODE = '23514';
  END IF;

  IF (SELECT COUNT(*) FROM public."ClearingReconciliationRevision" WHERE "decisionEventVersionId" = p_decision_event_version_id) <> expected_revision_count
    OR (SELECT COUNT(*) FROM public."ClearingReconciliationCoverage" WHERE "decisionEventVersionId" = p_decision_event_version_id) <> expected_coverage_count
    OR (SELECT COUNT(*) FROM public."ClearingReconciliationResolution" WHERE "decisionEventVersionId" = p_decision_event_version_id) <> expected_resolution_count
    OR (SELECT COUNT(*) FROM public."ClearingReconciliationResolutionLine" line JOIN public."ClearingReconciliationResolution" resolution ON resolution."id" = line."resolutionId" WHERE resolution."decisionEventVersionId" = p_decision_event_version_id) <> expected_line_count
    OR (SELECT COUNT(*) FROM public."ClearingReconciliationDefinitionReversal" WHERE "decisionEventVersionId" = p_decision_event_version_id) <> expected_definition_count
    OR (SELECT COUNT(*) FROM public."ClearingAllocation" WHERE "eventVersionId" = p_decision_event_version_id) <> expected_allocation_count
  THEN
    RAISE EXCEPTION 'POL-275 关系或分配实际计数不闭合' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."ClearingReconciliationResolution" resolution
    LEFT JOIN public."ClearingReconciliationResolutionLine" line ON line."resolutionId" = resolution."id"
    WHERE resolution."decisionEventVersionId" = p_decision_event_version_id
    GROUP BY resolution."id", resolution."amountCents"
    HAVING COALESCE(SUM(line."amountCents"), 0) <> resolution."amountCents"
  ) THEN
    RAISE EXCEPTION 'POL-275 解决行金额不平' USING ERRCODE = '23514';
  END IF;

  IF version_record.event_kind = 'technical_reversal' THEN
    WITH reverse_lines AS (
      SELECT line."amountCents" AS amount_cents,
             original_resolution."resultKind" AS result_kind,
             original_line."sourceKind" AS source_kind,
             original_resolution."decisionEventVersionId" AS source_version_id,
             original_line."clearingAllocationId" AS source_allocation_id,
             original_event."kind" AS source_event_kind,
             original_version."payloadSnapshot" AS source_payload
      FROM public."ClearingReconciliationResolution" resolution
      JOIN public."ClearingReconciliationResolutionLine" line
        ON line."resolutionId" = resolution."id"
      JOIN public."ClearingReconciliationResolutionLine" original_line
        ON original_line."id" = line."reversesResolutionLineId"
      JOIN public."ClearingReconciliationResolution" original_resolution
        ON original_resolution."id" = original_line."resolutionId"
      JOIN public."ClearingEventVersion" original_version
        ON original_version."id" = original_resolution."decisionEventVersionId"
      JOIN public."ClearingEvent" original_event
        ON original_event."id" = original_version."clearingEventId"
      WHERE resolution."decisionEventVersionId" = p_decision_event_version_id
        AND resolution."entryKind" = 'technical_reversal'
        AND line."clearingAllocationId" IS NOT NULL
    ), expected_keys AS (
      SELECT reverse_lines.*,
             key_rule.impact_key,
             CASE WHEN reverse_lines.source_event_kind = 'returned' THEN
               'return-' || (
                 SELECT allocation_plan ->> 'allocationNo'
                 FROM jsonb_array_elements(
                   reverse_lines.source_payload -> 'reconciliationIntent' -> 'eventAllocations'
                 ) allocation_plan
                 WHERE allocation_plan ->> 'clearingAllocationId'
                   = reverse_lines.source_allocation_id
               ) || ':'
             ELSE 'original:' END || key_rule.impact_key AS source_impact_key
      FROM reverse_lines
      CROSS JOIN LATERAL (VALUES
        ('confirmed-cost', reverse_lines.result_kind = 'final_confirmed'),
        ('construction-enterprise-funds-decrease', reverse_lines.result_kind = 'final_confirmed'),
        ('construction-enterprise-funds-release',
          reverse_lines.source_kind = 'withheld_coverage'),
        ('confirmed-cost-return',
          reverse_lines.result_kind = 'real_return'
            AND reverse_lines.source_kind = 'prior_economic_event'),
        ('construction-enterprise-funds-return',
          reverse_lines.result_kind = 'real_return'
            AND reverse_lines.source_kind = 'prior_economic_event')
      ) key_rule(impact_key, included)
      WHERE key_rule.included
    ), expected_group AS (
      SELECT source_link."id" AS source_link_id,
             COUNT(*)::BIGINT AS expected_count,
             SUM(expected_keys.amount_cents)::BIGINT AS expected_amount
      FROM expected_keys
      LEFT JOIN public."ClearingImpactLink" source_link
        ON source_link."eventVersionId" = expected_keys.source_version_id
       AND source_link."sourceImpactKey" = expected_keys.source_impact_key
      GROUP BY source_link."id"
    ), actual_group AS (
      SELECT link."reversesImpactId" AS source_link_id,
             COUNT(*)::BIGINT AS actual_count,
             SUM(link."amountCents")::BIGINT AS actual_amount
      FROM public."ClearingImpactLink" link
      WHERE link."eventVersionId" = p_decision_event_version_id
      GROUP BY link."reversesImpactId"
    )
    SELECT EXISTS (
      SELECT 1
      FROM expected_group expected
      FULL OUTER JOIN actual_group actual
        ON COALESCE(actual.source_link_id, '') = COALESCE(expected.source_link_id, '')
      WHERE expected.source_link_id IS NULL
        OR actual.source_link_id IS NULL
        OR expected.expected_count IS DISTINCT FROM actual.actual_count
        OR expected.expected_amount IS DISTINCT FROM actual.actual_amount
    ) INTO impact_mismatch;
    IF impact_mismatch THEN
      RAISE EXCEPTION 'POL-275 技术反向 resolution、allocation 与 impact 集合不闭合' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT coverage."withheldEventVersionId" AS source_id
      FROM public."ClearingReconciliationCoverage" coverage
      WHERE coverage."decisionEventVersionId" = p_decision_event_version_id
      UNION
      SELECT DISTINCT allocation."sourceEventVersionId"
      FROM public."ClearingAllocation" allocation
      WHERE allocation."eventVersionId" = p_decision_event_version_id
        AND allocation."sourceEventVersionId" IS NOT NULL
    ) affected
    JOIN public."ClearingEventVersion" source ON source."id" = affected.source_id
    WHERE public."pol275_active_coverage_occupancy"(affected.source_id)
      + COALESCE((
        SELECT SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
          THEN allocation."amountCents" ELSE -allocation."amountCents" END)
        FROM public."ClearingAllocation" allocation
        WHERE allocation."sourceEventVersionId" = affected.source_id
      ), 0) > source."amountCents"
  ) THEN
    RAISE EXCEPTION 'POL-275 覆盖与净经济分配超过暂扣来源容量' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "pol275_reconciliation_closure_trigger"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  row_json JSONB := to_jsonb(NEW);
  decision_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ClearingConfirmation' THEN
    decision_id := row_json ->> 'eventVersionId';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationItem' THEN
    decision_id := row_json ->> 'openingDecisionEventVersionId';
  ELSIF TG_TABLE_NAME IN (
    'ClearingReconciliationRevision',
    'ClearingReconciliationCoverage',
    'ClearingReconciliationResolution',
    'ClearingReconciliationDefinitionReversal',
    'ClearingReconciliationDecisionSeal'
  ) THEN
    decision_id := row_json ->> 'decisionEventVersionId';
  ELSIF TG_TABLE_NAME = 'ClearingReconciliationResolutionLine' THEN
    SELECT "decisionEventVersionId" INTO decision_id
    FROM public."ClearingReconciliationResolution"
    WHERE "id" = row_json ->> 'resolutionId';
  ELSIF TG_TABLE_NAME IN ('ClearingAllocation', 'ClearingImpactLink') THEN
    decision_id := row_json ->> 'eventVersionId';
  END IF;
  IF decision_id IS NOT NULL THEN
    PERFORM public."pol275_assert_reconciliation_closure"(decision_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "ClearingConfirmation_pol275_v1_closure" AFTER INSERT ON "ClearingConfirmation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationItem_pol275_closure" AFTER INSERT ON "ClearingReconciliationItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationRevision_pol275_closure" AFTER INSERT ON "ClearingReconciliationRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationCoverage_pol275_closure" AFTER INSERT ON "ClearingReconciliationCoverage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationResolution_pol275_closure" AFTER INSERT ON "ClearingReconciliationResolution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationDefinitionReversal_pol275_closure" AFTER INSERT ON "ClearingReconciliationDefinitionReversal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationResolutionLine_pol275_closure" AFTER INSERT ON "ClearingReconciliationResolutionLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingReconciliationDecisionSeal_pol275_closure" AFTER INSERT ON "ClearingReconciliationDecisionSeal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingAllocation_pol275_v1_closure" AFTER INSERT ON "ClearingAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();
CREATE CONSTRAINT TRIGGER "ClearingImpactLink_pol275_v1_closure" AFTER INSERT ON "ClearingImpactLink" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pol275_reconciliation_closure_trigger"();

CREATE FUNCTION "pol275_append_reconciliation_set"(
  p_decision_event_version_id TEXT,
  p_expected_event_version_fingerprint TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  version_record RECORD;
  intent JSONB;
  planned_ids JSONB;
  item_definition JSONB;
  definition_reversal JSONB;
  coverage JSONB;
  resolution JSONB;
  resolution_line JSONB;
  allocation_plan JSONB;
  target_revision RECORD;
  parent_item RECORD;
  source_version RECORD;
  original_resolution RECORD;
  original_line RECORD;
  confirmed_at TIMESTAMPTZ(3);
  effective_case_revision INTEGER;
  open_amount BIGINT;
  coverage_total BIGINT;
  resolution_total BIGINT;
  reversed_total BIGINT;
  relation_hash TEXT;
  expected_line_count INTEGER;
  expected_ordinary_count INTEGER;
BEGIN
  IF p_expected_event_version_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'POL-275 事件版本指纹格式无效' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pol275:decision:' || p_decision_event_version_id, 0)
  );
  SELECT version."id", version."clearingCaseId", version."amountCents",
         version."currencyCode", version."fingerprint", version."payloadSnapshot",
         version."createdByUserId", version."workflowStatus",
         event."kind" AS event_kind, event."workflowStatus" AS event_status,
         clearing_case."revision" AS case_revision,
         confirmation."confirmedAt" AT TIME ZONE 'UTC' AS confirmed_at
    INTO version_record
    FROM public."ClearingEventVersion" version
    JOIN public."ClearingEvent" event ON event."id" = version."clearingEventId"
    JOIN public."ClearingCase" clearing_case ON clearing_case."id" = version."clearingCaseId"
    JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = version."id"
   WHERE version."id" = p_decision_event_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POL-275 受控写入缺少同事务精确确认' USING ERRCODE = '23514';
  END IF;
  IF version_record."fingerprint" <> p_expected_event_version_fingerprint
    OR version_record."workflowStatus" <> 'submitted'
    OR version_record.event_status <> 'submitted'
  THEN
    RAISE EXCEPTION 'POL-275 受控写入版本、指纹或状态已漂移' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."ClearingReconciliationDecisionSeal"
    WHERE "decisionEventVersionId" = p_decision_event_version_id
  ) THEN
    RAISE EXCEPTION 'POL-275 决策版本已经封印' USING ERRCODE = '23505';
  END IF;

  intent := version_record."payloadSnapshot" -> 'reconciliationIntent';
  IF NOT public."pol275_jsonb_has_exact_keys"(intent, ARRAY[
    'schema', 'operation', 'plannedIds', 'plannedPairedWithheld',
    'itemDefinition', 'coverages', 'resolutions', 'definitionReversal',
    'eventAllocations'
  ]) OR intent ->> 'schema' <> 'clearing_reconciliation_intent/V1' THEN
    RAISE EXCEPTION 'POL-275 冻结核对意图版本或字段集合无效' USING ERRCODE = '23514';
  END IF;
  planned_ids := intent -> 'plannedIds';
  IF NOT public."pol275_jsonb_has_exact_keys"(planned_ids, ARRAY[
    'newItemId', 'revisionId', 'coverageIds', 'resolutionIds',
    'resolutionLineIds', 'definitionReversalId', 'clearingAllocationIds'
  ]) OR jsonb_typeof(intent -> 'coverages') <> 'array'
    OR jsonb_typeof(intent -> 'resolutions') <> 'array'
    OR jsonb_typeof(intent -> 'eventAllocations') <> 'array'
  THEN
    RAISE EXCEPTION 'POL-275 冻结计划形状无效' USING ERRCODE = '23514';
  END IF;
  IF intent -> 'plannedPairedWithheld' <> 'null'::JSONB THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'pol275:event-version:' || (intent -> 'plannedPairedWithheld' ->> 'eventVersionId'),
        0
      )
    );
    SELECT source."id", source."fingerprint", source."amountCents", source."currencyCode",
           source."clearingCaseId", event."kind", confirmation."eventVersionId" AS confirmed
      INTO source_version
      FROM public."ClearingEventVersion" source
      JOIN public."ClearingEvent" event ON event."id" = source."clearingEventId"
      LEFT JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = source."id"
     WHERE source."id" = intent -> 'plannedPairedWithheld' ->> 'eventVersionId';
    IF NOT FOUND OR source_version."clearingCaseId" <> version_record."clearingCaseId"
      OR source_version."kind" <> 'withheld' OR source_version.confirmed IS NULL
      OR source_version."fingerprint" <> intent -> 'plannedPairedWithheld' ->> 'eventVersionFingerprint'
      OR source_version."amountCents" <> (intent -> 'plannedPairedWithheld' ->> 'amountCents')::BIGINT
      OR source_version."currencyCode" <> 'CNY'
    THEN
      RAISE EXCEPTION 'POL-275 原子配对暂扣与冻结计划不一致' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF intent ->> 'operation' IN ('open_item', 'replace_item') THEN
    IF version_record.event_kind <> 'pending_reconciliation' THEN
      RAISE EXCEPTION 'POL-275 待核对定义只能由 pending_reconciliation 决策' USING ERRCODE = '23514';
    END IF;
  ELSIF intent ->> 'operation' = 'add_coverage' THEN
    IF version_record.event_kind <> 'coverage_added' THEN
      RAISE EXCEPTION 'POL-275 补充覆盖只能由 coverage_added 决策' USING ERRCODE = '23514';
    END IF;
  ELSIF intent ->> 'operation' = 'resolve' THEN
    IF version_record.event_kind NOT IN ('final_confirmed', 'supplemental', 'returned', 'continued_withheld') THEN
      RAISE EXCEPTION 'POL-275 解决结果与事件类型不匹配' USING ERRCODE = '23514';
    END IF;
  ELSIF intent ->> 'operation' IN ('reverse_resolution', 'reverse_definition') THEN
    IF version_record.event_kind <> 'technical_reversal' THEN
      RAISE EXCEPTION 'POL-275 技术反向只能由 technical_reversal 决策' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'POL-275 未知冻结核对操作' USING ERRCODE = '23514';
  END IF;

  confirmed_at := version_record.confirmed_at;
  effective_case_revision := version_record.case_revision + 1;
  item_definition := intent -> 'itemDefinition';
  IF jsonb_typeof(item_definition) = 'object' THEN
    IF item_definition ->> 'adoptsLegacyPendingEventVersionId' IS NOT NULL THEN
      RAISE EXCEPTION 'POL-275 本票未开放历史待核对接管' USING ERRCODE = '0A000';
    END IF;
    IF item_definition ->> 'amountCents' <> version_record."amountCents"::TEXT
      OR item_definition ->> 'currencyCode' <> 'CNY'
    THEN
      RAISE EXCEPTION 'POL-275 待核对定义金额与决策版本不一致' USING ERRCODE = '23514';
    END IF;
    IF item_definition ->> 'mode' IN ('independent', 'addition') THEN
      IF planned_ids ->> 'newItemId' IS DISTINCT FROM item_definition ->> 'itemId' THEN
        RAISE EXCEPTION 'POL-275 新待核对项 ID 未冻结' USING ERRCODE = '23514';
      END IF;
      IF item_definition ->> 'mode' = 'independent' THEN
        IF item_definition ->> 'lineageRootItemId' <> item_definition ->> 'itemId'
          OR item_definition ->> 'additionOfItemId' IS NOT NULL
        THEN
          RAISE EXCEPTION 'POL-275 独立项谱系形状无效' USING ERRCODE = '23514';
        END IF;
      ELSE
        SELECT * INTO parent_item
        FROM public."ClearingReconciliationItem"
        WHERE "id" = item_definition ->> 'additionOfItemId'
          AND "clearingCaseId" = version_record."clearingCaseId"
        FOR UPDATE;
        IF NOT FOUND OR parent_item."lineageRootItemId" <> item_definition ->> 'lineageRootItemId' THEN
          RAISE EXCEPTION 'POL-275 新增项必须精确继承同案父项根谱系' USING ERRCODE = '23514';
        END IF;
      END IF;
      INSERT INTO public."ClearingReconciliationItem"(
        "id", "clearingCaseId", "lineageRootItemId", "additionOfItemId",
        "openingDecisionEventVersionId", "createdByUserId", "createdAt"
      ) VALUES (
        item_definition ->> 'itemId', version_record."clearingCaseId",
        item_definition ->> 'lineageRootItemId', item_definition ->> 'additionOfItemId',
        p_decision_event_version_id, version_record."createdByUserId", confirmed_at
      );
    ELSIF item_definition ->> 'mode' = 'replacement' THEN
      IF planned_ids -> 'newItemId' <> 'null'::JSONB THEN
        RAISE EXCEPTION 'POL-275 替代不得创建新 item' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO target_revision
      FROM public."ClearingReconciliationRevision"
      WHERE "id" = item_definition ->> 'replacesRevisionId'
        AND "itemId" = item_definition ->> 'itemId'
        AND "clearingCaseId" = version_record."clearingCaseId"
      FOR UPDATE;
      IF NOT FOUND OR EXISTS (
        SELECT 1 FROM public."ClearingReconciliationRevision" later
        WHERE later."itemId" = target_revision."itemId"
          AND later."revisionNo" > target_revision."revisionNo"
          AND NOT EXISTS (
            SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
            WHERE reversed."targetRevisionId" = later."id"
          )
      ) OR EXISTS (
        SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
        WHERE reversed."targetRevisionId" = target_revision."id"
      ) THEN
        RAISE EXCEPTION 'POL-275 替代目标不是当前有效 revision' USING ERRCODE = '40001';
      END IF;
      SELECT target_revision."amountCents"
        - COALESCE(SUM(CASE WHEN result."entryKind" = 'resolution' THEN result."amountCents" ELSE -result."amountCents" END), 0)::BIGINT
        INTO open_amount
        FROM public."ClearingReconciliationResolution" result
       WHERE result."reconciliationRevisionId" = target_revision."id";
      IF open_amount IS NULL THEN open_amount := target_revision."amountCents"; END IF;
      IF item_definition ->> 'replacedOpenAmountCents' <> open_amount::TEXT
        OR (item_definition ->> 'revisionNo')::INTEGER <> target_revision."revisionNo" + 1
      THEN
        RAISE EXCEPTION 'POL-275 替代前未解决金额或 revisionNo 已漂移' USING ERRCODE = '40001';
      END IF;
    ELSE
      RAISE EXCEPTION 'POL-275 itemDefinition mode 无效' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public."ClearingReconciliationRevision"(
      "id", "itemId", "clearingCaseId", "revisionNo", "kind", "amountCents",
      "currencyCode", "decisionEventVersionId", "adoptsLegacyPendingEventVersionId",
      "replacesRevisionId", "replacedOpenAmountCents", "correctsDefinitionReversalId",
      "effectiveCaseRevision", "confirmedAt"
    ) VALUES (
      item_definition ->> 'revisionId', item_definition ->> 'itemId',
      version_record."clearingCaseId", (item_definition ->> 'revisionNo')::INTEGER,
      CASE WHEN item_definition ->> 'mode' IN ('independent', 'addition') THEN 'open' ELSE 'replace' END,
      (item_definition ->> 'amountCents')::BIGINT, 'CNY', p_decision_event_version_id,
      item_definition ->> 'adoptsLegacyPendingEventVersionId', item_definition ->> 'replacesRevisionId',
      (item_definition ->> 'replacedOpenAmountCents')::BIGINT,
      item_definition ->> 'correctsDefinitionReversalId', effective_case_revision, confirmed_at
    );
  ELSIF intent -> 'plannedIds' -> 'revisionId' <> 'null'::JSONB
    OR intent -> 'plannedIds' -> 'newItemId' <> 'null'::JSONB
  THEN
    RAISE EXCEPTION 'POL-275 空 itemDefinition 不得预留 item/revision ID' USING ERRCODE = '23514';
  END IF;

  coverage_total := 0;
  FOR coverage IN SELECT value FROM jsonb_array_elements(intent -> 'coverages') LOOP
    SELECT revision.*, item."lineageRootItemId"
      INTO target_revision
      FROM public."ClearingReconciliationRevision" revision
      JOIN public."ClearingReconciliationItem" item ON item."id" = revision."itemId"
     WHERE revision."id" = coverage ->> 'reconciliationRevisionId'
       AND revision."clearingCaseId" = version_record."clearingCaseId"
     FOR UPDATE OF revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'POL-275 覆盖目标 revision 不存在或跨案' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'pol275:event-version:' || (coverage ->> 'withheldEventVersionId'),
        0
      )
    );
    SELECT source."id", source."fingerprint", source."amountCents", source."clearingCaseId",
           event."kind", confirmation."eventVersionId" AS confirmed
      INTO source_version
      FROM public."ClearingEventVersion" source
      JOIN public."ClearingEvent" event ON event."id" = source."clearingEventId"
      LEFT JOIN public."ClearingConfirmation" confirmation ON confirmation."eventVersionId" = source."id"
     WHERE source."id" = coverage ->> 'withheldEventVersionId';
    IF NOT FOUND OR source_version."clearingCaseId" <> version_record."clearingCaseId"
      OR source_version."kind" <> 'withheld' OR source_version.confirmed IS NULL
      OR source_version."fingerprint" <> coverage ->> 'withheldEventVersionFingerprint'
    THEN
      RAISE EXCEPTION 'POL-275 覆盖来源不是同案精确已确认暂扣版本' USING ERRCODE = '23514';
    END IF;
    IF intent ->> 'operation' = 'add_coverage' AND EXISTS (
      SELECT 1 FROM public."ClearingReconciliationRevision" later
      WHERE later."itemId" = target_revision."itemId"
        AND later."revisionNo" > target_revision."revisionNo"
        AND NOT EXISTS (
          SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
          WHERE reversed."targetRevisionId" = later."id"
        )
    ) THEN
      RAISE EXCEPTION 'POL-275 只能给当前有效 revision 补充覆盖' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public."ClearingReconciliationCoverage"(
      "id", "reconciliationRevisionId", "itemId", "clearingCaseId",
      "withheldEventVersionId", "amountCents", "decisionEventVersionId",
      "intentLineNo", "effectiveCaseRevision", "confirmedAt"
    ) VALUES (
      coverage ->> 'coverageId', target_revision."id", target_revision."itemId",
      version_record."clearingCaseId", coverage ->> 'withheldEventVersionId',
      (coverage ->> 'amountCents')::BIGINT, p_decision_event_version_id,
      (coverage ->> 'lineNo')::INTEGER, effective_case_revision, confirmed_at
    );
    coverage_total := coverage_total + (coverage ->> 'amountCents')::BIGINT;
  END LOOP;
  IF intent ->> 'operation' = 'add_coverage' AND coverage_total <> version_record."amountCents" THEN
    RAISE EXCEPTION 'POL-275 coverage_added 金额必须等于冻结覆盖行合计' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(item_definition) = 'object' AND EXISTS (
    SELECT 1
    FROM public."ClearingReconciliationRevision" revision
    LEFT JOIN public."ClearingReconciliationCoverage" coverage ON coverage."reconciliationRevisionId" = revision."id"
    WHERE revision."decisionEventVersionId" = p_decision_event_version_id
    GROUP BY revision."id", revision."amountCents"
    HAVING COALESCE(SUM(coverage."amountCents"), 0) > revision."amountCents"
  ) THEN
    RAISE EXCEPTION 'POL-275 revision 覆盖合计超过定义金额' USING ERRCODE = '23514';
  END IF;

  resolution_total := 0;
  FOR resolution IN SELECT value FROM jsonb_array_elements(intent -> 'resolutions') LOOP
    SELECT * INTO target_revision
    FROM public."ClearingReconciliationRevision"
    WHERE "id" = resolution ->> 'reconciliationRevisionId'
      AND "itemId" = resolution ->> 'itemId'
      AND "clearingCaseId" = version_record."clearingCaseId"
    FOR UPDATE;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
      WHERE reversed."targetRevisionId" = target_revision."id"
    ) OR EXISTS (
      SELECT 1 FROM public."ClearingReconciliationRevision" later
      WHERE later."itemId" = target_revision."itemId"
        AND later."revisionNo" > target_revision."revisionNo"
        AND NOT EXISTS (
          SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
          WHERE reversed."targetRevisionId" = later."id"
        )
    ) THEN
      RAISE EXCEPTION 'POL-275 解决目标不是当前有效 revision' USING ERRCODE = '40001';
    END IF;

    IF resolution ->> 'entryKind' = 'resolution' THEN
      IF (resolution ->> 'resultKind' = 'final_confirmed' AND version_record.event_kind NOT IN ('final_confirmed', 'supplemental'))
        OR (resolution ->> 'resultKind' = 'real_return' AND version_record.event_kind <> 'returned')
        OR (resolution ->> 'resultKind' = 'continued_withheld' AND version_record.event_kind <> 'continued_withheld')
      THEN
        RAISE EXCEPTION 'POL-275 解决结果与决策事件类型不匹配' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT * INTO original_resolution
      FROM public."ClearingReconciliationResolution"
      WHERE "id" = resolution ->> 'reversesResolutionId'
        AND "reconciliationRevisionId" = target_revision."id"
        AND "itemId" = target_revision."itemId"
      FOR UPDATE;
      IF NOT FOUND OR original_resolution."entryKind" <> 'resolution'
        OR original_resolution."resultKind" <> resolution ->> 'resultKind'
      THEN
        RAISE EXCEPTION 'POL-275 技术反向未精确引用原解决' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(SUM("amountCents"), 0)::BIGINT INTO reversed_total
      FROM public."ClearingReconciliationResolution"
      WHERE "reversesResolutionId" = original_resolution."id";
      IF reversed_total + (resolution ->> 'amountCents')::BIGINT > original_resolution."amountCents" THEN
        RAISE EXCEPTION 'POL-275 技术反向超过原解决剩余效果' USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT target_revision."amountCents"
      - COALESCE(SUM(CASE WHEN existing."entryKind" = 'resolution' THEN existing."amountCents" ELSE -existing."amountCents" END), 0)::BIGINT
      INTO open_amount
      FROM public."ClearingReconciliationResolution" existing
     WHERE existing."reconciliationRevisionId" = target_revision."id";
    IF open_amount IS NULL THEN open_amount := target_revision."amountCents"; END IF;
    IF resolution ->> 'entryKind' = 'resolution'
      AND (resolution ->> 'amountCents')::BIGINT > open_amount
    THEN
      RAISE EXCEPTION 'POL-275 解决金额超过当前未解决金额' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public."ClearingReconciliationResolution"(
      "id", "reconciliationRevisionId", "itemId", "clearingCaseId", "entryKind",
      "resultKind", "amountCents", "decisionEventVersionId", "intentItemNo",
      "reversesResolutionId", "effectiveCaseRevision", "confirmedAt"
    ) VALUES (
      resolution ->> 'resolutionId', target_revision."id", target_revision."itemId",
      version_record."clearingCaseId", resolution ->> 'entryKind', resolution ->> 'resultKind',
      (resolution ->> 'amountCents')::BIGINT, p_decision_event_version_id,
      (resolution ->> 'itemNo')::INTEGER, resolution ->> 'reversesResolutionId',
      effective_case_revision, confirmed_at
    );

    FOR resolution_line IN SELECT value FROM jsonb_array_elements(resolution -> 'lines') LOOP
      IF resolution ->> 'entryKind' = 'technical_reversal' THEN
        SELECT * INTO original_line
        FROM public."ClearingReconciliationResolutionLine"
        WHERE "id" = resolution_line ->> 'reversesResolutionLineId'
          AND "resolutionId" = original_resolution."id"
        FOR UPDATE;
        IF NOT FOUND OR original_line."sourceKind" <> resolution_line ->> 'sourceKind'
          OR original_line."coverageId" IS DISTINCT FROM resolution_line ->> 'coverageId'
        THEN
          RAISE EXCEPTION 'POL-275 技术反向行未精确引用原解决行' USING ERRCODE = '23514';
        END IF;
        SELECT COALESCE(SUM("amountCents"), 0)::BIGINT INTO reversed_total
        FROM public."ClearingReconciliationResolutionLine"
        WHERE "reversesResolutionLineId" = original_line."id";
        IF reversed_total + (resolution_line ->> 'amountCents')::BIGINT > original_line."amountCents" THEN
          RAISE EXCEPTION 'POL-275 技术反向行超过原行剩余效果' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF resolution ->> 'resultKind' = 'continued_withheld'
        AND (resolution_line ->> 'sourceKind' <> 'withheld_coverage'
          OR resolution_line ->> 'plannedClearingAllocationId' IS NOT NULL)
      THEN
        RAISE EXCEPTION 'POL-275 继续暂扣只能引用覆盖且不产生经济分配' USING ERRCODE = '23514';
      END IF;
      IF resolution ->> 'resultKind' = 'real_return'
        AND resolution_line ->> 'sourceKind' NOT IN ('withheld_coverage', 'prior_economic_event')
      THEN
        RAISE EXCEPTION 'POL-275 真实退回来源类型无效' USING ERRCODE = '23514';
      END IF;
      IF resolution ->> 'resultKind' = 'final_confirmed'
        AND resolution_line ->> 'sourceKind' NOT IN ('withheld_coverage', 'authority_cap')
      THEN
        RAISE EXCEPTION 'POL-275 最终解决来源类型无效' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public."ClearingReconciliationResolutionLine"(
        "id", "resolutionId", "reconciliationRevisionId", "itemId", "clearingCaseId",
        "sourceKind", "coverageId", "amountCents", "intentLineNo",
        "clearingAllocationId", "reversesResolutionLineId"
      ) VALUES (
        resolution_line ->> 'resolutionLineId', resolution ->> 'resolutionId',
        target_revision."id", target_revision."itemId", version_record."clearingCaseId",
        resolution_line ->> 'sourceKind', resolution_line ->> 'coverageId',
        (resolution_line ->> 'amountCents')::BIGINT,
        (resolution_line ->> 'lineNo')::INTEGER,
        resolution_line ->> 'plannedClearingAllocationId',
        resolution_line ->> 'reversesResolutionLineId'
      );
    END LOOP;
    IF (SELECT COALESCE(SUM("amountCents"), 0) FROM public."ClearingReconciliationResolutionLine" WHERE "resolutionId" = resolution ->> 'resolutionId')
      <> (resolution ->> 'amountCents')::BIGINT
    THEN
      RAISE EXCEPTION 'POL-275 解决行合计与解决金额不平' USING ERRCODE = '23514';
    END IF;
    resolution_total := resolution_total + (resolution ->> 'amountCents')::BIGINT;
  END LOOP;
  IF version_record.event_kind IN ('continued_withheld', 'technical_reversal')
    AND intent ->> 'operation' <> 'reverse_definition'
    AND resolution_total <> version_record."amountCents"
  THEN
    RAISE EXCEPTION 'POL-275 继续暂扣或技术反向金额必须完整闭合' USING ERRCODE = '23514';
  ELSIF version_record.event_kind IN ('final_confirmed', 'supplemental', 'returned')
    AND resolution_total > version_record."amountCents"
  THEN
    RAISE EXCEPTION 'POL-275 关系解决金额超过决策事件金额' USING ERRCODE = '23514';
  END IF;

  definition_reversal := intent -> 'definitionReversal';
  IF jsonb_typeof(definition_reversal) = 'object' THEN
    SELECT * INTO target_revision
    FROM public."ClearingReconciliationRevision"
    WHERE "id" = definition_reversal ->> 'targetRevisionId'
      AND "clearingCaseId" = version_record."clearingCaseId"
    FOR UPDATE;
    IF NOT FOUND OR target_revision."amountCents" <> (definition_reversal ->> 'reversedAmountCents')::BIGINT
      OR EXISTS (
        SELECT 1 FROM public."ClearingReconciliationRevision" later
        WHERE later."itemId" = target_revision."itemId"
          AND later."revisionNo" > target_revision."revisionNo"
          AND NOT EXISTS (
            SELECT 1 FROM public."ClearingReconciliationDefinitionReversal" reversed
            WHERE reversed."targetRevisionId" = later."id"
          )
      )
    THEN
      RAISE EXCEPTION 'POL-275 定义反向目标不是当前因果前沿' USING ERRCODE = '40001';
    END IF;
    SELECT COALESCE(SUM(CASE WHEN existing."entryKind" = 'resolution' THEN existing."amountCents" ELSE -existing."amountCents" END), 0)::BIGINT
      INTO resolution_total
      FROM public."ClearingReconciliationResolution" existing
     WHERE existing."reconciliationRevisionId" = target_revision."id";
    IF resolution_total <> 0 THEN
      RAISE EXCEPTION 'POL-275 定义反向前必须精确反向全部后继解决' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public."ClearingReconciliationDefinitionReversal"(
      "id", "targetRevisionId", "itemId", "clearingCaseId", "decisionEventVersionId",
      "reversedAmountCents", "effectiveCaseRevision", "confirmedAt"
    ) VALUES (
      definition_reversal ->> 'definitionReversalId', target_revision."id", target_revision."itemId",
      version_record."clearingCaseId", p_decision_event_version_id,
      (definition_reversal ->> 'reversedAmountCents')::BIGINT,
      effective_case_revision, confirmed_at
    );
  ELSIF planned_ids -> 'definitionReversalId' <> 'null'::JSONB THEN
    RAISE EXCEPTION 'POL-275 空定义反向不得预留 ID' USING ERRCODE = '23514';
  END IF;

  FOR allocation_plan IN SELECT value FROM jsonb_array_elements(intent -> 'eventAllocations') LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public."ClearingAllocation" allocation
      WHERE allocation."id" = allocation_plan ->> 'clearingAllocationId'
        AND allocation."eventVersionId" = p_decision_event_version_id
        AND allocation."sourceKind" = allocation_plan ->> 'allocationSourceKind'
        AND allocation."sourceEventVersionId" IS NOT DISTINCT FROM allocation_plan ->> 'sourceEventVersionId'
        AND allocation."amountCents" = (allocation_plan ->> 'amountCents')::BIGINT
    ) THEN
      RAISE EXCEPTION 'POL-275 实际清算分配与冻结完整计划不一致' USING ERRCODE = '23514';
    END IF;
    IF allocation_plan ->> 'purpose' = 'reconciliation_line' AND NOT EXISTS (
      SELECT 1 FROM public."ClearingReconciliationResolutionLine" line
      WHERE line."id" = allocation_plan ->> 'resolutionLineId'
        AND line."clearingAllocationId" = allocation_plan ->> 'clearingAllocationId'
    ) THEN
      RAISE EXCEPTION 'POL-275 关系解决行与经济分配不是一一对应' USING ERRCODE = '23514';
    ELSIF allocation_plan ->> 'purpose' = 'ordinary_remainder'
      AND allocation_plan ->> 'resolutionLineId' IS NOT NULL
    THEN
      RAISE EXCEPTION 'POL-275 普通剩余分配不得伪装为关系解决行' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF (SELECT COUNT(*) FROM public."ClearingAllocation" WHERE "eventVersionId" = p_decision_event_version_id)
    <> jsonb_array_length(intent -> 'eventAllocations')
  THEN
    RAISE EXCEPTION 'POL-275 实际目标分配存在遗漏或额外行' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(jsonb_array_length(entry -> 'lines')), 0)::INTEGER
    INTO expected_line_count FROM jsonb_array_elements(intent -> 'resolutions') entry;
  SELECT COUNT(*)::INTEGER INTO expected_ordinary_count
    FROM jsonb_array_elements(intent -> 'eventAllocations') entry
   WHERE entry ->> 'purpose' = 'ordinary_remainder';
  relation_hash := public."pol275_relation_set_hash_v1"(p_decision_event_version_id);
  INSERT INTO public."ClearingReconciliationDecisionSeal"(
    "decisionEventVersionId", "clearingCaseId", "intentSchema",
    "eventVersionFingerprint", "relationSetHash", "revisionCount", "coverageCount",
    "resolutionCount", "resolutionLineCount", "definitionReversalCount",
    "eventAllocationCount", "ordinaryAllocationCount", "sealedAt"
  ) VALUES (
    p_decision_event_version_id, version_record."clearingCaseId",
    'clearing_reconciliation_intent/V1', version_record."fingerprint", relation_hash,
    CASE WHEN jsonb_typeof(item_definition) = 'object' THEN 1 ELSE 0 END,
    jsonb_array_length(intent -> 'coverages'),
    jsonb_array_length(intent -> 'resolutions'), expected_line_count,
    CASE WHEN jsonb_typeof(definition_reversal) = 'object' THEN 1 ELSE 0 END,
    jsonb_array_length(intent -> 'eventAllocations'), expected_ordinary_count, confirmed_at
  );
  PERFORM public."pol275_assert_reconciliation_closure"(p_decision_event_version_id);
  RETURN relation_hash;
END;
$$;

ALTER ROLE "jg_pol275_owner"
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;
ALTER ROLE "jg_pol275_runtime"
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;

ALTER TABLE "ClearingReconciliationItem" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationRevision" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationCoverage" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationResolution" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationDefinitionReversal" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationResolutionLine" OWNER TO "jg_pol275_owner";
ALTER TABLE "ClearingReconciliationDecisionSeal" OWNER TO "jg_pol275_owner";

ALTER FUNCTION "pol275_reject_reconciliation_mutation"() OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_jsonb_has_exact_keys"(JSONB, TEXT[]) OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_active_coverage_occupancy"(TEXT) OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_relation_insert_guard"() OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_clearing_impact_link_guard"() OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_relation_set_hash_v1"(TEXT) OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_assert_reconciliation_closure"(TEXT) OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_reconciliation_closure_trigger"() OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol275_append_reconciliation_set"(TEXT, TEXT) OWNER TO "jg_pol275_owner";
ALTER FUNCTION "pol214_clearing_allocation_guard"() OWNER TO "jg_pol275_owner";

GRANT USAGE ON SCHEMA public TO "jg_pol275_owner", "jg_pol275_runtime";
GRANT SELECT ON TABLE
  "ClearingCase", "ClearingEvent", "ClearingEventVersion", "ClearingConfirmation",
  "ClearingEvidenceAttestation", "ClearingAllocation", "ClearingImpactLink",
  "OperatingFact", "OperatingImpactEntry"
  TO "jg_pol275_owner";
GRANT SELECT ON TABLE
  "ClearingReconciliationItem", "ClearingReconciliationRevision",
  "ClearingReconciliationCoverage", "ClearingReconciliationResolution",
  "ClearingReconciliationDefinitionReversal", "ClearingReconciliationResolutionLine",
  "ClearingReconciliationDecisionSeal"
  TO "jg_pol275_runtime";

REVOKE ALL ON TABLE
  "ClearingReconciliationItem", "ClearingReconciliationRevision",
  "ClearingReconciliationCoverage", "ClearingReconciliationResolution",
  "ClearingReconciliationDefinitionReversal", "ClearingReconciliationResolutionLine",
  "ClearingReconciliationDecisionSeal"
  FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ClearingReconciliationItem", "ClearingReconciliationRevision",
  "ClearingReconciliationCoverage", "ClearingReconciliationResolution",
  "ClearingReconciliationDefinitionReversal", "ClearingReconciliationResolutionLine",
  "ClearingReconciliationDecisionSeal"
  FROM "jg_pol275_runtime";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM "jg_pol275_runtime";

REVOKE ALL ON FUNCTION "pol275_reject_reconciliation_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_jsonb_has_exact_keys"(JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_active_coverage_occupancy"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_relation_insert_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_clearing_impact_link_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_relation_set_hash_v1"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_assert_reconciliation_closure"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_reconciliation_closure_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol275_append_reconciliation_set"(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol214_clearing_allocation_guard"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "pol275_append_reconciliation_set"(TEXT, TEXT)
  TO "jg_pol275_runtime";

COMMIT;
