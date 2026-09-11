-- POL-15P2 / #280: formal general disputed-funds source.
-- Forward-only artifact. Applying this migration to production is not authorized here.
BEGIN;

SELECT pg_advisory_xact_lock(190911, 280);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol280_runtime') THEN
    CREATE ROLE "jg_pol280_runtime" NOLOGIN NOINHERIT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles candidate
    WHERE candidate.rolname = 'jg_pol280_runtime'
      AND (candidate.rolcanlogin OR candidate.rolinherit OR candidate.rolsuper OR
           candidate.rolcreaterole OR candidate.rolcreatedb OR candidate.rolreplication OR
           candidate.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'POL-280 同名技术角色属性不安全，拒绝复用' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    WHERE membership.roleid = (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol280_runtime'
    ) OR membership.member = (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol280_runtime'
    )
  ) THEN
    RAISE EXCEPTION 'POL-280 同名技术角色已有成员关系，拒绝迁移且不自动清理' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- M167 already introduced project_cash_restriction and fund_holder. M168 only
-- extends the canonical impact catalog with the two disputed-funds directions.
ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check",
  ADD CONSTRAINT "OperatingImpactEntry_impact_kind_check"
    CHECK ("impactKind" IN (
      'confirmed_income', 'confirmed_cost', 'contract_commitment_reference',
      'estimated_clearing_expense', 'necessary_expense_reserve_increase',
      'necessary_expense_reserve_decrease', 'project_disputed_funds_increase',
      'project_disputed_funds_decrease', 'receivable_increase', 'receivable_decrease',
      'payable_increase', 'payable_decrease', 'construction_enterprise_funds_increase',
      'construction_enterprise_funds_decrease', 'construction_enterprise_funds_freeze',
      'construction_enterprise_funds_release', 'company_project_funds_increase',
      'company_project_funds_decrease', 'company_advance_for_project_increase',
      'company_advance_for_project_decrease', 'company_returnable_to_project_increase',
      'company_returnable_to_project_decrease', 'inter_subject_balance_increase',
      'inter_subject_balance_decrease', 'temporary_profit_distribution',
      'final_profit_distribution', 'profit_distribution_adjustment', 'invoice_reference',
      'evidence_gap_notice'
    ));

CREATE TABLE "ProjectFundDispute" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "businessCode" TEXT NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "affiliateCreditCodeSnapshot" TEXT,
  "fundHolderKind" TEXT NOT NULL,
  "fundHolderId" TEXT NOT NULL,
  "counterpartyKind" TEXT NOT NULL,
  "counterpartyId" TEXT NOT NULL,
  "counterpartyNameSnapshot" TEXT NOT NULL,
  "disputeKind" TEXT NOT NULL,
  "referenceCode" TEXT NOT NULL,
  "basisKind" TEXT NOT NULL,
  "basisBusinessIdOrEvidenceSha256" TEXT NOT NULL,
  "economicIdentityKey" TEXT NOT NULL,
  "sourceIdentityKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectFundDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectFundDispute_project_business_key" UNIQUE ("projectId", "businessCode"),
  CONSTRAINT "ProjectFundDispute_economicIdentityKey_key" UNIQUE ("economicIdentityKey"),
  CONSTRAINT "ProjectFundDispute_sourceIdentityKey_key" UNIQUE ("sourceIdentityKey"),
  CONSTRAINT "ProjectFundDispute_shape_check" CHECK (
    length(btrim("businessCode")) > 0
    AND length(btrim("affiliateNameSnapshot")) > 0
    AND "fundHolderKind" IN ('construction_enterprise', 'participating_company')
    AND length(btrim("counterpartyKind")) > 0
    AND length(btrim("counterpartyId")) > 0
    AND length(btrim("counterpartyNameSnapshot")) > 0
    AND "disputeKind" IN ('upstream', 'downstream', 'inter_subject', 'external_restriction')
    AND length(btrim("referenceCode")) > 0
    AND length(btrim("basisKind")) > 0
    AND length(btrim("basisBusinessIdOrEvidenceSha256")) > 0
    AND "economicIdentityKey" ~ '^[0-9a-f]{64}$'
    AND "sourceIdentityKey" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ProjectFundDispute_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundDispute_assignment_fkey"
    FOREIGN KEY ("affiliateAssignmentId") REFERENCES "ProjectAffiliateAssignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectFundDisputeEntry" (
  "id" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "draftRevision" INTEGER NOT NULL DEFAULT 1,
  "entryKind" TEXT NOT NULL,
  "adjustsEntryId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "occurredAt" DATE NOT NULL,
  "disputeSummary" TEXT NOT NULL,
  "resolutionBasisSummary" TEXT,
  "evidenceLevel" TEXT NOT NULL,
  "evidenceFileId" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "payloadSnapshot" JSONB,
  "fingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "preparedByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "attestedByUserId" TEXT,
  "attestedAt" TIMESTAMP(3),
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "returnedByUserId" TEXT,
  "returnedAt" TIMESTAMP(3),
  "returnReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectFundDisputeEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectFundDisputeEntry_dispute_sequence_key" UNIQUE ("disputeId", "sequenceNo"),
  CONSTRAINT "ProjectFundDisputeEntry_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ProjectFundDisputeEntry_shape_check" CHECK (
    "sequenceNo" >= 1
    AND "draftRevision" >= 1
    AND "entryKind" IN ('establish', 'increase', 'release', 'technical_reversal')
    AND (("entryKind" IN ('release', 'technical_reversal')) = ("adjustsEntryId" IS NOT NULL))
    AND (("entryKind" = 'release') = (NULLIF(btrim("resolutionBasisSummary"), '') IS NOT NULL))
    AND "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND length(btrim("disputeSummary")) > 0
    AND "evidenceLevel" IN ('A', 'B')
    AND "evidenceSha256" ~ '^[0-9a-f]{64}$'
    AND "idempotencyKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "status" IN ('draft', 'submitted', 'attested', 'confirmed', 'returned')
    AND "fingerprint" ~ '^[0-9a-f]{64}$'
    AND (
      ("status" = 'draft'
          AND "submittedByUserId" IS NULL AND "submittedAt" IS NULL
          AND "attestedByUserId" IS NULL AND "attestedAt" IS NULL
          AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL
          AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL)
      OR ("status" = 'returned'
          AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL
          AND "returnedByUserId" IS NOT NULL AND "returnedAt" IS NOT NULL
          AND length(btrim("returnReason")) > 0)
      OR ("status" = 'submitted' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL
          AND "attestedByUserId" IS NULL AND "attestedAt" IS NULL
          AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL
          AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL
          AND "payloadSnapshot" IS NOT NULL)
      OR ("status" = 'attested' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL
          AND "attestedByUserId" IS NOT NULL AND "attestedAt" IS NOT NULL
          AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL
          AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL
          AND "payloadSnapshot" IS NOT NULL
          AND "attestedByUserId" <> "preparedByUserId")
      OR ("status" = 'confirmed' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL
          AND "attestedByUserId" IS NOT NULL AND "attestedAt" IS NOT NULL
          AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL
          AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL
          AND "payloadSnapshot" IS NOT NULL AND "attestedByUserId" <> "preparedByUserId")
    )
  ),
  CONSTRAINT "ProjectFundDisputeEntry_no_self_adjustment"
    CHECK ("adjustsEntryId" IS NULL OR "adjustsEntryId" <> "id"),
  CONSTRAINT "ProjectFundDisputeEntry_dispute_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "ProjectFundDispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundDisputeEntry_adjusts_fkey"
    FOREIGN KEY ("adjustsEntryId") REFERENCES "ProjectFundDisputeEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundDisputeEntry_evidence_file_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectFundDisputeReplacement" (
  "id" TEXT NOT NULL,
  "disputeEntryId" TEXT NOT NULL,
  "operatingImpactEntryId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFundDisputeReplacement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectFundDisputeReplacement_entry_impact_key" UNIQUE ("disputeEntryId", "operatingImpactEntryId"),
  CONSTRAINT "ProjectFundDisputeReplacement_operatingImpactEntryId_key" UNIQUE ("operatingImpactEntryId"),
  CONSTRAINT "ProjectFundDisputeReplacement_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ProjectFundDisputeReplacement_entry_fkey"
    FOREIGN KEY ("disputeEntryId") REFERENCES "ProjectFundDisputeEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundDisputeReplacement_impact_fkey"
    FOREIGN KEY ("operatingImpactEntryId") REFERENCES "OperatingImpactEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectFundDisputeCommandReceipt" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "commandFingerprint" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFundDisputeCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectFundDisputeCommandReceipt_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ProjectFundDisputeCommandReceipt_shape_check" CHECK (
    "action" IN ('create_draft', 'update_draft', 'submit', 'attest', 'confirm', 'return')
    AND "idempotencyKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "commandFingerprint" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("resultSnapshot") = 'object'
  ),
  CONSTRAINT "ProjectFundDisputeCommandReceipt_entry_fkey"
    FOREIGN KEY ("entryId") REFERENCES "ProjectFundDisputeEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ProjectFundDispute_project_updated_idx"
  ON "ProjectFundDispute"("projectId", "updatedAt");
CREATE INDEX "ProjectFundDispute_assignment_idx"
  ON "ProjectFundDispute"("affiliateAssignmentId");
CREATE INDEX "ProjectFundDispute_holder_idx"
  ON "ProjectFundDispute"("fundHolderKind", "fundHolderId");
CREATE INDEX "ProjectFundDispute_counterparty_idx"
  ON "ProjectFundDispute"("counterpartyKind", "counterpartyId");
CREATE INDEX "ProjectFundDisputeEntry_dispute_status_date_idx"
  ON "ProjectFundDisputeEntry"("disputeId", "status", "occurredAt");
CREATE INDEX "ProjectFundDisputeEntry_adjusts_idx"
  ON "ProjectFundDisputeEntry"("adjustsEntryId");
CREATE INDEX "ProjectFundDisputeReplacement_entry_idx"
  ON "ProjectFundDisputeReplacement"("disputeEntryId");
CREATE INDEX "ProjectFundDisputeCommandReceipt_entry_action_idx"
  ON "ProjectFundDisputeCommandReceipt"("entryId", "action", "createdAt");

CREATE FUNCTION "pol280_command_receipt_immutable"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'POL-280 command receipts are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFundDisputeCommandReceipt_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectFundDisputeCommandReceipt"
  FOR EACH ROW EXECUTE FUNCTION "pol280_command_receipt_immutable"();

CREATE FUNCTION "pol280_cross_source_identity_exists"(economic_identity TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN entry."entryKind" IN ('establish', 'increase') THEN entry."amountCents"
         WHEN entry."entryKind" IN ('release', 'technical_reversal') THEN -entry."amountCents"
         ELSE 0 END
  ), 0) > 0
    FROM public."ProjectNecessaryExpenseReserve" reserve
    JOIN public."ProjectNecessaryExpenseReserveEntry" entry ON entry."reserveId" = reserve."id"
   WHERE reserve."economicIdentityKey" = economic_identity
     AND entry."status" = 'confirmed';
$$;

CREATE FUNCTION "pol280_entry_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_entry public."ProjectFundDisputeEntry"%ROWTYPE;
  consumed BIGINT;
  entry_count INTEGER;
  establishment_confirmed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POL-280 dispute entries are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'POL-280 confirmed dispute entries are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'draft' THEN
    RAISE EXCEPTION 'POL-280 dispute entries must start as draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol280:dispute:' || NEW."disputeId", 0));
    SELECT COUNT(*) INTO entry_count FROM public."ProjectFundDisputeEntry"
     WHERE "disputeId" = NEW."disputeId";
    IF entry_count = 0 AND NEW."entryKind" <> 'establish' THEN
      RAISE EXCEPTION 'POL-280 first dispute entry must establish the dispute' USING ERRCODE = '23514';
    END IF;
    IF entry_count > 0 AND NEW."entryKind" = 'establish' THEN
      RAISE EXCEPTION 'POL-280 dispute has already been established' USING ERRCODE = '23514';
    END IF;
    IF NEW."entryKind" = 'increase' THEN
      SELECT EXISTS (
        SELECT 1 FROM public."ProjectFundDisputeEntry"
         WHERE "disputeId" = NEW."disputeId"
           AND "entryKind" = 'establish' AND "status" = 'confirmed'
      ) INTO establishment_confirmed;
      IF NOT establishment_confirmed THEN
        RAISE EXCEPTION 'POL-280 dispute establishment must be confirmed before an increase' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD."status" = 'draft' AND NEW."status" IN ('draft', 'submitted'))
    OR (OLD."status" = 'submitted' AND NEW."status" IN ('attested', 'returned'))
    OR (OLD."status" = 'attested' AND NEW."status" IN ('confirmed', 'returned'))
    OR (OLD."status" = 'returned' AND NEW."status" IN ('draft', 'submitted'))
  ) THEN
    RAISE EXCEPTION 'POL-280 dispute entry status transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" <> OLD."id" OR NEW."disputeId" <> OLD."disputeId"
    OR NEW."sequenceNo" <> OLD."sequenceNo" OR NEW."entryKind" <> OLD."entryKind"
    OR NEW."adjustsEntryId" IS DISTINCT FROM OLD."adjustsEntryId"
    OR NEW."preparedByUserId" <> OLD."preparedByUserId"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'POL-280 dispute entry identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('submitted', 'attested') AND ROW(
    NEW."draftRevision", NEW."amountCents", NEW."currencyCode", NEW."occurredAt",
    NEW."disputeSummary", NEW."resolutionBasisSummary", NEW."evidenceLevel",
    NEW."evidenceFileId", NEW."evidenceSha256", NEW."payloadSnapshot", NEW."fingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."draftRevision", OLD."amountCents", OLD."currencyCode", OLD."occurredAt",
    OLD."disputeSummary", OLD."resolutionBasisSummary", OLD."evidenceLevel",
    OLD."evidenceFileId", OLD."evidenceSha256", OLD."payloadSnapshot", OLD."fingerprint"
  ) THEN
    RAISE EXCEPTION 'POL-280 submitted dispute payload is frozen' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."entryKind" = 'increase' AND NEW."status" = 'confirmed' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol280:dispute:' || NEW."disputeId", 0));
    SELECT EXISTS (
      SELECT 1 FROM public."ProjectFundDisputeEntry"
       WHERE "disputeId" = NEW."disputeId"
         AND "entryKind" = 'establish' AND "status" = 'confirmed'
    ) INTO establishment_confirmed;
    IF NOT establishment_confirmed THEN
      RAISE EXCEPTION 'POL-280 dispute establishment must be confirmed before an increase' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" = 'confirmed' AND NEW."adjustsEntryId" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol280:entry:' || NEW."adjustsEntryId", 0));
    SELECT * INTO target_entry FROM public."ProjectFundDisputeEntry"
     WHERE "id" = NEW."adjustsEntryId" FOR UPDATE;
    IF NOT FOUND OR target_entry."status" <> 'confirmed'
       OR target_entry."disputeId" <> NEW."disputeId"
       OR target_entry."entryKind" NOT IN ('establish', 'increase') THEN
      RAISE EXCEPTION 'POL-280 adjustment target is not an exact confirmed dispute increase' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0) INTO consumed
      FROM public."ProjectFundDisputeEntry"
     WHERE "adjustsEntryId" = NEW."adjustsEntryId"
       AND "status" = 'confirmed' AND "id" <> NEW."id";
    IF NEW."entryKind" = 'technical_reversal' AND NEW."amountCents" <> target_entry."amountCents" THEN
      RAISE EXCEPTION 'POL-280 technical reversal must exactly reverse the prior entry' USING ERRCODE = '23514';
    END IF;
    IF consumed + NEW."amountCents" > target_entry."amountCents" THEN
      RAISE EXCEPTION 'POL-280 release or reversal exceeds remaining dispute capacity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFundDisputeEntry_confirmed_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProjectFundDisputeEntry"
  FOR EACH ROW EXECUTE FUNCTION "pol280_entry_guard"();

CREATE FUNCTION "pol280_replacement_guard"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  release_entry public."ProjectFundDisputeEntry"%ROWTYPE;
  impact_project TEXT;
  dispute_project TEXT;
  impact_kind TEXT;
  impact_direction TEXT;
  impact_source_type TEXT;
  fact_status TEXT;
  impact_amount BIGINT;
  release_allocated BIGINT;
  impact_allocated BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'POL-280 replacement allocations are append-only' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pol280:replacement:' || NEW."disputeEntryId", 0));
  SELECT * INTO release_entry FROM public."ProjectFundDisputeEntry"
   WHERE "id" = NEW."disputeEntryId" FOR UPDATE;
  IF NOT FOUND OR release_entry."status" <> 'confirmed' OR release_entry."entryKind" <> 'release' THEN
    RAISE EXCEPTION 'POL-280 replacement must reference a confirmed release entry' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pol:formal-impact-replacement:' || NEW."operatingImpactEntryId", 0)
  );
  SELECT impact."projectId", dispute."projectId", impact."impactKind", impact."direction",
         impact."sourceType", fact."status", impact."amountCents"
    INTO impact_project, dispute_project, impact_kind, impact_direction,
         impact_source_type, fact_status, impact_amount
    FROM public."OperatingImpactEntry" impact
    JOIN public."OperatingFact" fact ON fact."id" = impact."factId"
    CROSS JOIN public."ProjectFundDispute" dispute
   WHERE impact."id" = NEW."operatingImpactEntryId"
     AND dispute."id" = release_entry."disputeId"
   FOR UPDATE OF impact;
  IF impact_project IS NULL OR impact_project <> dispute_project THEN
    RAISE EXCEPTION 'POL-280 replacement impact must belong to the same project' USING ERRCODE = '23514';
  END IF;
  IF fact_status <> 'confirmed' OR impact_source_type = 'project_fund_dispute_entry' OR NOT (
    (impact_direction = 'increase' AND impact_kind IN (
      'confirmed_cost', 'payable_increase', 'estimated_clearing_expense',
      'necessary_expense_reserve_increase', 'inter_subject_balance_increase'
    )) OR
    (impact_direction = 'decrease' AND impact_kind IN (
      'construction_enterprise_funds_freeze', 'construction_enterprise_funds_decrease',
      'company_project_funds_decrease', 'inter_subject_balance_decrease'
    ))
  ) THEN
    RAISE EXCEPTION 'POL-280 replacement must reference an exact confirmed formal result impact'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE((
      SELECT SUM("amountCents")
        FROM public."ProjectFundDisputeReplacement"
       WHERE "operatingImpactEntryId" = NEW."operatingImpactEntryId"
    ), 0) +
    COALESCE((
      SELECT SUM("amountCents")
        FROM public."ProjectNecessaryExpenseReserveReplacement"
       WHERE "operatingImpactEntryId" = NEW."operatingImpactEntryId"
    ), 0)
    INTO impact_allocated;
  IF impact_allocated + NEW."amountCents" > impact_amount THEN
    RAISE EXCEPTION 'POL-280 replacement allocation exceeds formal impact amount' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0) INTO release_allocated
    FROM public."ProjectFundDisputeReplacement"
   WHERE "disputeEntryId" = NEW."disputeEntryId";
  IF release_allocated + NEW."amountCents" > release_entry."amountCents" THEN
    RAISE EXCEPTION 'POL-280 replacement allocation exceeds release amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFundDisputeReplacement_immutable_capacity"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProjectFundDisputeReplacement"
  FOR EACH ROW EXECUTE FUNCTION "pol280_replacement_guard"();

-- M167 protected each source independently. Once both formal sources exist,
-- replace its trigger body so #279 and #280 share one impact lock and one
-- aggregate capacity. SECURITY DEFINER keeps both NOLOGIN runtime roles on
-- least privilege while the trigger performs its bounded cross-table reads.
CREATE OR REPLACE FUNCTION "pol279_replacement_guard"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  release_entry public."ProjectNecessaryExpenseReserveEntry"%ROWTYPE;
  impact_project TEXT;
  reserve_project TEXT;
  impact_kind TEXT;
  impact_direction TEXT;
  impact_source_type TEXT;
  fact_status TEXT;
  impact_amount BIGINT;
  release_allocated BIGINT;
  impact_allocated BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'POL-279 replacement allocations are append-only' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pol279:replacement:' || NEW."reserveEntryId", 0));
  SELECT * INTO release_entry
    FROM public."ProjectNecessaryExpenseReserveEntry"
   WHERE "id" = NEW."reserveEntryId" FOR UPDATE;
  IF NOT FOUND OR release_entry."status" <> 'confirmed' OR release_entry."entryKind" <> 'release' THEN
    RAISE EXCEPTION 'POL-279 replacement must reference a confirmed release entry' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pol:formal-impact-replacement:' || NEW."operatingImpactEntryId", 0)
  );
  SELECT impact."projectId", reserve."projectId", impact."impactKind", impact."direction",
         impact."sourceType", fact."status", impact."amountCents"
    INTO impact_project, reserve_project, impact_kind, impact_direction,
         impact_source_type, fact_status, impact_amount
    FROM public."OperatingImpactEntry" impact
    JOIN public."OperatingFact" fact ON fact."id" = impact."factId"
    CROSS JOIN public."ProjectNecessaryExpenseReserve" reserve
   WHERE impact."id" = NEW."operatingImpactEntryId"
     AND reserve."id" = release_entry."reserveId"
   FOR UPDATE OF impact;
  IF impact_project IS NULL OR impact_project <> reserve_project THEN
    RAISE EXCEPTION 'POL-279 replacement impact must belong to the same project' USING ERRCODE = '23514';
  END IF;
  IF fact_status <> 'confirmed' OR impact_direction <> 'increase'
     OR impact_source_type = 'project_necessary_expense_reserve_entry'
     OR impact_kind NOT IN (
       'confirmed_cost', 'payable_increase', 'estimated_clearing_expense',
       'construction_enterprise_funds_freeze', 'project_disputed_funds_increase'
     ) THEN
    RAISE EXCEPTION 'POL-279 replacement must reference a confirmed formal deduction impact'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE((
      SELECT SUM("amountCents")
        FROM public."ProjectNecessaryExpenseReserveReplacement"
       WHERE "operatingImpactEntryId" = NEW."operatingImpactEntryId"
    ), 0) +
    COALESCE((
      SELECT SUM("amountCents")
        FROM public."ProjectFundDisputeReplacement"
       WHERE "operatingImpactEntryId" = NEW."operatingImpactEntryId"
    ), 0)
    INTO impact_allocated;
  IF impact_allocated + NEW."amountCents" > impact_amount THEN
    RAISE EXCEPTION 'POL-279 replacement allocation exceeds formal impact amount'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0) INTO release_allocated
    FROM public."ProjectNecessaryExpenseReserveReplacement"
   WHERE "reserveEntryId" = NEW."reserveEntryId";
  IF release_allocated + NEW."amountCents" > release_entry."amountCents" THEN
    RAISE EXCEPTION 'POL-279 replacement allocation exceeds release amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "pol280_dispute_identity_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POL-280 dispute roots cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    NEW."projectId", NEW."affiliateAssignmentId", NEW."affiliateBusinessPartyVersionId",
    NEW."affiliateNameSnapshot", NEW."affiliateCreditCodeSnapshot",
    NEW."fundHolderKind", NEW."fundHolderId", NEW."counterpartyKind", NEW."counterpartyId",
    NEW."businessCode", NEW."disputeKind", NEW."basisKind",
    NEW."basisBusinessIdOrEvidenceSha256", NEW."economicIdentityKey",
    NEW."sourceIdentityKey", NEW."createdByUserId", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."projectId", OLD."affiliateAssignmentId", OLD."affiliateBusinessPartyVersionId",
    OLD."affiliateNameSnapshot", OLD."affiliateCreditCodeSnapshot",
    OLD."fundHolderKind", OLD."fundHolderId", OLD."counterpartyKind", OLD."counterpartyId",
    OLD."businessCode", OLD."disputeKind", OLD."basisKind",
    OLD."basisBusinessIdOrEvidenceSha256", OLD."economicIdentityKey",
    OLD."sourceIdentityKey", OLD."createdByUserId", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'POL-280 dispute root identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."counterpartyNameSnapshot", NEW."referenceCode") IS DISTINCT FROM
     ROW(OLD."counterpartyNameSnapshot", OLD."referenceCode") AND (
       (SELECT COUNT(*) FROM public."ProjectFundDisputeEntry" WHERE "disputeId" = OLD."id") <> 1
       OR EXISTS (
         SELECT 1 FROM public."ProjectFundDisputeEntry"
          WHERE "disputeId" = OLD."id" AND "status" NOT IN ('draft', 'returned')
       )
     ) THEN
    RAISE EXCEPTION 'POL-280 dispute description is frozen outside its sole editable draft'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFundDispute_identity_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectFundDispute"
  FOR EACH ROW EXECUTE FUNCTION "pol280_dispute_identity_guard"();

-- Register the non-exclusive private evidence reference without weakening the
-- existing exclusive-file inventory.
SELECT pg_advisory_xact_lock(190731, 280);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol280_project_fund_dispute;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol280_project_fund_dispute()
  UNION ALL
  VALUES ('ProjectFundDisputeEntry', 'evidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_project_fund_dispute_entry_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ProjectFundDisputeEntry"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('evidenceFileId', 'false');

ALTER ROLE "jg_pol280_runtime"
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO "jg_pol280_runtime";
REVOKE ALL ON TABLE
  "ProjectFundDispute", "ProjectFundDisputeEntry",
  "ProjectFundDisputeReplacement", "ProjectFundDisputeCommandReceipt"
  FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE
  "ProjectFundDispute", "ProjectFundDisputeEntry"
  TO "jg_pol280_runtime";
GRANT SELECT, INSERT ON TABLE
  "ProjectFundDisputeReplacement", "ProjectFundDisputeCommandReceipt"
  TO "jg_pol280_runtime";
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ProjectFundDisputeReplacement", "ProjectFundDisputeCommandReceipt"
  FROM "jg_pol280_runtime";
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ProjectFundDispute", "ProjectFundDisputeEntry"
  FROM "jg_pol280_runtime";
REVOKE CREATE ON SCHEMA public FROM "jg_pol280_runtime";
REVOKE ALL ON FUNCTION "pol280_entry_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol280_replacement_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol280_dispute_identity_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol280_command_receipt_immutable"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol280_cross_source_identity_exists"(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol279_replacement_guard"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "pol280_cross_source_identity_exists"(TEXT)
  TO "jg_pol280_runtime";

COMMIT;
