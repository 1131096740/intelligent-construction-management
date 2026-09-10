-- POL-15P1 / #279: formal necessary-expense reserve source.
-- Forward-only artifact. Applying this migration to production is not authorized here.
BEGIN;

SELECT pg_advisory_xact_lock(190910, 279);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol279_runtime') THEN
    CREATE ROLE "jg_pol279_runtime" NOLOGIN NOINHERIT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles candidate
    WHERE candidate.rolname = 'jg_pol279_runtime'
      AND (candidate.rolcanlogin OR candidate.rolinherit OR candidate.rolsuper OR
           candidate.rolcreaterole OR candidate.rolcreatedb OR candidate.rolreplication OR
           candidate.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'POL-279 同名技术角色属性不安全，拒绝复用' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.roleid = (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol279_runtime'
    ) OR membership.member = (
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'jg_pol279_runtime'
    )
  ) THEN
    RAISE EXCEPTION 'POL-279 同名技术角色已有成员关系，拒绝迁移且不自动清理' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Extend the canonical operating-ledger envelopes before the adapter can
-- append the new neutral restriction fact. These constraints are the database
-- authority; changing TypeScript catalogs alone would still reject every
-- confirmed source at insert time.
ALTER TABLE "OperatingFact"
  DROP CONSTRAINT "OperatingFact_fact_kind_check",
  ADD CONSTRAINT "OperatingFact_fact_kind_check"
    CHECK ("factKind" IN (
      'owner_settlement', 'owner_payment', 'downstream_contract', 'downstream_settlement',
      'downstream_payment', 'expense', 'employee_loan', 'project_wage',
      'construction_enterprise_deduction', 'invoice', 'fund_movement',
      'profit_distribution', 'project_cash_restriction', 'historical_gap'
    ));

ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check",
  ADD CONSTRAINT "OperatingImpactEntry_impact_kind_check"
    CHECK ("impactKind" IN (
      'confirmed_income', 'confirmed_cost', 'contract_commitment_reference',
      'estimated_clearing_expense', 'necessary_expense_reserve_increase',
      'necessary_expense_reserve_decrease', 'receivable_increase', 'receivable_decrease',
      'payable_increase', 'payable_decrease', 'construction_enterprise_funds_increase',
      'construction_enterprise_funds_decrease', 'construction_enterprise_funds_freeze',
      'construction_enterprise_funds_release', 'company_project_funds_increase',
      'company_project_funds_decrease', 'company_advance_for_project_increase',
      'company_advance_for_project_decrease', 'company_returnable_to_project_increase',
      'company_returnable_to_project_decrease', 'inter_subject_balance_increase',
      'inter_subject_balance_decrease', 'temporary_profit_distribution',
      'final_profit_distribution', 'profit_distribution_adjustment', 'invoice_reference',
      'evidence_gap_notice'
    )),
  DROP CONSTRAINT "OperatingImpactEntry_subject_check",
  ADD CONSTRAINT "OperatingImpactEntry_subject_check"
    CHECK (
      ("subjectRole" IS NULL OR "subjectRole" IN (
        'debtor', 'creditor', 'approved_payer', 'actual_payer', 'payee',
        'cost_bearing_company', 'fund_holder'
      ))
      AND ("subjectRole" IS NULL OR "subjectKind" IS NOT NULL)
      AND (("subjectKind" IS NULL) = ("subjectId" IS NULL))
      AND COALESCE("subjectKind" IN (
        'owner', 'construction_enterprise', 'participating_company',
        'downstream_counterparty', 'employee'
      ), TRUE)
    );

ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_supported_subject_check",
  ADD CONSTRAINT "OperatingImpactEntry_supported_subject_check"
    CHECK (
      "subjectKind" IS NULL OR (
        "subjectKind" IN (
          'owner', 'construction_enterprise', 'participating_company',
          'downstream_counterparty', 'employee'
        )
        AND CASE "subjectRole"
          WHEN 'debtor' THEN "subjectKind" IN (
            'owner', 'construction_enterprise', 'participating_company', 'employee'
          )
          WHEN 'creditor' THEN "subjectKind" IN (
            'construction_enterprise', 'participating_company', 'downstream_counterparty'
          )
          WHEN 'approved_payer' THEN "subjectKind" IN (
            'construction_enterprise', 'participating_company'
          )
          WHEN 'actual_payer' THEN "subjectKind" IN (
            'owner', 'construction_enterprise', 'participating_company', 'employee'
          )
          WHEN 'payee' THEN TRUE
          WHEN 'cost_bearing_company' THEN "subjectKind" IN (
            'construction_enterprise', 'participating_company'
          )
          WHEN 'fund_holder' THEN "subjectKind" IN (
            'construction_enterprise', 'participating_company'
          )
          ELSE "subjectRole" IS NULL
        END
      )
    );

CREATE TABLE "ProjectNecessaryExpenseReserve" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "businessCode" TEXT NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "affiliateCreditCodeSnapshot" TEXT,
  "fundHolderKind" TEXT NOT NULL,
  "fundHolderId" TEXT NOT NULL,
  "reasonKind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "basisKind" TEXT NOT NULL,
  "basisBusinessIdOrEvidenceSha256" TEXT NOT NULL,
  "basisSummary" TEXT NOT NULL,
  "economicIdentityKey" TEXT NOT NULL,
  "sourceIdentityKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectNecessaryExpenseReserve_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectNecessaryExpenseReserve_project_business_key" UNIQUE ("projectId", "businessCode"),
  CONSTRAINT "ProjectNecessaryExpenseReserve_economicIdentityKey_key" UNIQUE ("economicIdentityKey"),
  CONSTRAINT "ProjectNecessaryExpenseReserve_sourceIdentityKey_key" UNIQUE ("sourceIdentityKey"),
  CONSTRAINT "ProjectNecessaryExpenseReserve_shape_check" CHECK (
    length(btrim("businessCode")) > 0
    AND length(btrim("affiliateNameSnapshot")) > 0
    AND "fundHolderKind" IN ('construction_enterprise', 'participating_company')
    AND "reasonKind" IN (
      'warranty_or_remediation', 'legal_or_compliance',
      'mandatory_closeout', 'other_approved_necessary'
    )
    AND length(btrim("title")) > 0
    AND length(btrim("basisKind")) > 0
    AND length(btrim("basisBusinessIdOrEvidenceSha256")) > 0
    AND length(btrim("basisSummary")) > 0
    AND "economicIdentityKey" ~ '^[0-9a-f]{64}$'
    AND "sourceIdentityKey" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ProjectNecessaryExpenseReserve_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectNecessaryExpenseReserve_assignment_fkey"
    FOREIGN KEY ("affiliateAssignmentId") REFERENCES "ProjectAffiliateAssignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectNecessaryExpenseReserveEntry" (
  "id" TEXT NOT NULL,
  "reserveId" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "draftRevision" INTEGER NOT NULL DEFAULT 1,
  "entryKind" TEXT NOT NULL,
  "adjustsEntryId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "occurredAt" DATE NOT NULL,
  "reason" TEXT NOT NULL,
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
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_reserve_sequence_key" UNIQUE ("reserveId", "sequenceNo"),
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_shape_check" CHECK (
    "sequenceNo" >= 1
    AND "draftRevision" >= 1
    AND "entryKind" IN ('establish', 'increase', 'release', 'technical_reversal')
    AND (("entryKind" IN ('release', 'technical_reversal')) = ("adjustsEntryId" IS NOT NULL))
    AND "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND length(btrim("reason")) > 0
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
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_no_self_adjustment"
    CHECK ("adjustsEntryId" IS NULL OR "adjustsEntryId" <> "id"),
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_reserve_fkey"
    FOREIGN KEY ("reserveId") REFERENCES "ProjectNecessaryExpenseReserve"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_adjusts_fkey"
    FOREIGN KEY ("adjustsEntryId") REFERENCES "ProjectNecessaryExpenseReserveEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectNecessaryExpenseReserveEntry_evidence_file_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectNecessaryExpenseReserveReplacement" (
  "id" TEXT NOT NULL,
  "reserveEntryId" TEXT NOT NULL,
  "operatingImpactEntryId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_entry_impact_key" UNIQUE ("reserveEntryId", "operatingImpactEntryId"),
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_operatingImpactEntryId_key" UNIQUE ("operatingImpactEntryId"),
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_entry_fkey"
    FOREIGN KEY ("reserveEntryId") REFERENCES "ProjectNecessaryExpenseReserveEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectNecessaryExpenseReserveReplacement_impact_fkey"
    FOREIGN KEY ("operatingImpactEntryId") REFERENCES "OperatingImpactEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProjectNecessaryExpenseReserveCommandReceipt" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "commandFingerprint" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectNecessaryExpenseReserveCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectNecessaryExpenseReserveCommandReceipt_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ProjectNecessaryExpenseReserveCommandReceipt_shape_check" CHECK (
    "action" IN ('create_draft', 'update_draft', 'submit', 'attest', 'confirm', 'return')
    AND "idempotencyKey" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "commandFingerprint" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("resultSnapshot") = 'object'
  ),
  CONSTRAINT "ProjectNecessaryExpenseReserveCommandReceipt_entry_fkey"
    FOREIGN KEY ("entryId") REFERENCES "ProjectNecessaryExpenseReserveEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ProjectNecessaryExpenseReserve_project_updated_idx"
  ON "ProjectNecessaryExpenseReserve"("projectId", "updatedAt");
CREATE INDEX "ProjectNecessaryExpenseReserve_assignment_idx"
  ON "ProjectNecessaryExpenseReserve"("affiliateAssignmentId");
CREATE INDEX "ProjectNecessaryExpenseReserve_holder_idx"
  ON "ProjectNecessaryExpenseReserve"("fundHolderKind", "fundHolderId");
CREATE INDEX "ProjectNecessaryExpenseReserveEntry_reserve_status_date_idx"
  ON "ProjectNecessaryExpenseReserveEntry"("reserveId", "status", "occurredAt");
CREATE INDEX "ProjectNecessaryExpenseReserveEntry_adjusts_idx"
  ON "ProjectNecessaryExpenseReserveEntry"("adjustsEntryId");
CREATE INDEX "ProjectNecessaryExpenseReserveReplacement_entry_idx"
  ON "ProjectNecessaryExpenseReserveReplacement"("reserveEntryId");
CREATE INDEX "ProjectNecessaryExpenseReserveCommandReceipt_entry_action_idx"
  ON "ProjectNecessaryExpenseReserveCommandReceipt"("entryId", "action", "createdAt");

CREATE FUNCTION "pol279_command_receipt_immutable"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'POL-279 command receipts are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectNecessaryExpenseReserveCommandReceipt_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectNecessaryExpenseReserveCommandReceipt"
  FOR EACH ROW EXECUTE FUNCTION "pol279_command_receipt_immutable"();

CREATE FUNCTION "pol279_cross_source_identity_exists"(economic_identity TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  duplicate_exists BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public."ProjectFundDispute"') IS NULL
     AND to_regclass('public."ProjectFundDisputeEntry"') IS NULL THEN
    RETURN FALSE;
  END IF;
  IF to_regclass('public."ProjectFundDispute"') IS NULL
     OR to_regclass('public."ProjectFundDisputeEntry"') IS NULL THEN
    RAISE EXCEPTION 'POL-279 cross-source duplicate guard found an incomplete dispute schema'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE $query$
    SELECT COALESCE(SUM(
      CASE WHEN entry."entryKind" IN ('establish', 'increase') THEN entry."amountCents"
           WHEN entry."entryKind" IN ('release', 'technical_reversal') THEN -entry."amountCents"
           ELSE 0 END
    ), 0) > 0
      FROM public."ProjectFundDispute" dispute
      JOIN public."ProjectFundDisputeEntry" entry ON entry."disputeId" = dispute."id"
     WHERE dispute."economicIdentityKey" = $1
       AND entry."status" = 'confirmed'
  $query$ INTO duplicate_exists USING economic_identity;
  RETURN duplicate_exists;
END;
$$;

CREATE FUNCTION "pol279_entry_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_entry public."ProjectNecessaryExpenseReserveEntry"%ROWTYPE;
  consumed BIGINT;
  entry_count INTEGER;
  establishment_confirmed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POL-279 reserve entries are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'POL-279 confirmed reserve entries are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'draft' THEN
    RAISE EXCEPTION 'POL-279 reserve entries must start as draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol279:reserve:' || NEW."reserveId", 0));
    SELECT COUNT(*) INTO entry_count
      FROM public."ProjectNecessaryExpenseReserveEntry"
     WHERE "reserveId" = NEW."reserveId";
    IF entry_count = 0 AND NEW."entryKind" <> 'establish' THEN
      RAISE EXCEPTION 'POL-279 first reserve entry must establish the reserve' USING ERRCODE = '23514';
    END IF;
    IF entry_count > 0 AND NEW."entryKind" = 'establish' THEN
      RAISE EXCEPTION 'POL-279 reserve has already been established' USING ERRCODE = '23514';
    END IF;
    IF NEW."entryKind" = 'increase' THEN
      SELECT EXISTS (
        SELECT 1
          FROM public."ProjectNecessaryExpenseReserveEntry"
         WHERE "reserveId" = NEW."reserveId"
           AND "entryKind" = 'establish'
           AND "status" = 'confirmed'
      ) INTO establishment_confirmed;
      IF NOT establishment_confirmed THEN
        RAISE EXCEPTION 'POL-279 reserve establishment must be confirmed before an increase' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD."status" = 'draft' AND NEW."status" IN ('draft', 'submitted'))
    OR (OLD."status" = 'submitted' AND NEW."status" IN ('attested', 'returned'))
    OR (OLD."status" = 'attested' AND NEW."status" IN ('confirmed', 'returned'))
    OR (OLD."status" = 'returned' AND NEW."status" IN ('draft', 'submitted'))
  ) THEN
    RAISE EXCEPTION 'POL-279 reserve entry status transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" <> OLD."id" OR NEW."reserveId" <> OLD."reserveId"
    OR NEW."sequenceNo" <> OLD."sequenceNo" OR NEW."entryKind" <> OLD."entryKind"
    OR NEW."adjustsEntryId" IS DISTINCT FROM OLD."adjustsEntryId"
    OR NEW."preparedByUserId" <> OLD."preparedByUserId"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'POL-279 reserve entry identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('submitted', 'attested') AND ROW(
    NEW."draftRevision", NEW."amountCents", NEW."currencyCode", NEW."occurredAt",
    NEW."reason", NEW."evidenceLevel", NEW."evidenceFileId", NEW."evidenceSha256",
    NEW."payloadSnapshot", NEW."fingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."draftRevision", OLD."amountCents", OLD."currencyCode", OLD."occurredAt",
    OLD."reason", OLD."evidenceLevel", OLD."evidenceFileId", OLD."evidenceSha256",
    OLD."payloadSnapshot", OLD."fingerprint"
  ) THEN
    RAISE EXCEPTION 'POL-279 submitted reserve payload is frozen' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."entryKind" = 'increase' AND NEW."status" = 'confirmed' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol279:reserve:' || NEW."reserveId", 0));
    SELECT EXISTS (
      SELECT 1
        FROM public."ProjectNecessaryExpenseReserveEntry"
       WHERE "reserveId" = NEW."reserveId"
         AND "entryKind" = 'establish'
         AND "status" = 'confirmed'
    ) INTO establishment_confirmed;
    IF NOT establishment_confirmed THEN
      RAISE EXCEPTION 'POL-279 reserve establishment must be confirmed before an increase' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" = 'confirmed' AND NEW."adjustsEntryId" IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pol279:entry:' || NEW."adjustsEntryId", 0));
    SELECT * INTO target_entry
      FROM public."ProjectNecessaryExpenseReserveEntry"
     WHERE "id" = NEW."adjustsEntryId"
     FOR UPDATE;
    IF NOT FOUND OR target_entry."status" <> 'confirmed'
       OR target_entry."reserveId" <> NEW."reserveId"
       OR target_entry."entryKind" NOT IN ('establish', 'increase') THEN
      RAISE EXCEPTION 'POL-279 adjustment target is not an exact confirmed reserve increase' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM("amountCents"), 0) INTO consumed
      FROM public."ProjectNecessaryExpenseReserveEntry"
     WHERE "adjustsEntryId" = NEW."adjustsEntryId"
       AND "status" = 'confirmed'
       AND "id" <> NEW."id";
    IF NEW."entryKind" = 'technical_reversal' AND NEW."amountCents" <> target_entry."amountCents" THEN
      RAISE EXCEPTION 'POL-279 technical reversal must exactly reverse the prior entry' USING ERRCODE = '23514';
    END IF;
    IF consumed + NEW."amountCents" > target_entry."amountCents" THEN
      RAISE EXCEPTION 'POL-279 release or reversal exceeds remaining reserve capacity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectNecessaryExpenseReserveEntry_confirmed_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProjectNecessaryExpenseReserveEntry"
  FOR EACH ROW EXECUTE FUNCTION "pol279_entry_guard"();

CREATE FUNCTION "pol279_replacement_guard"() RETURNS trigger
LANGUAGE plpgsql
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
    hashtextextended('pol279:replacement-impact:' || NEW."operatingImpactEntryId", 0)
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
  SELECT COALESCE(SUM("amountCents"), 0) INTO impact_allocated
    FROM public."ProjectNecessaryExpenseReserveReplacement"
   WHERE "operatingImpactEntryId" = NEW."operatingImpactEntryId";
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

CREATE TRIGGER "ProjectNecessaryExpenseReserveReplacement_immutable_capacity"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProjectNecessaryExpenseReserveReplacement"
  FOR EACH ROW EXECUTE FUNCTION "pol279_replacement_guard"();

CREATE FUNCTION "pol279_reserve_identity_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POL-279 reserve roots cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    NEW."projectId", NEW."affiliateAssignmentId", NEW."affiliateBusinessPartyVersionId",
    NEW."affiliateNameSnapshot", NEW."affiliateCreditCodeSnapshot",
    NEW."fundHolderKind", NEW."fundHolderId", NEW."businessCode", NEW."reasonKind",
    NEW."basisKind", NEW."basisBusinessIdOrEvidenceSha256",
    NEW."economicIdentityKey", NEW."sourceIdentityKey", NEW."createdByUserId", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."projectId", OLD."affiliateAssignmentId", OLD."affiliateBusinessPartyVersionId",
    OLD."affiliateNameSnapshot", OLD."affiliateCreditCodeSnapshot",
    OLD."fundHolderKind", OLD."fundHolderId", OLD."businessCode", OLD."reasonKind",
    OLD."basisKind", OLD."basisBusinessIdOrEvidenceSha256",
    OLD."economicIdentityKey", OLD."sourceIdentityKey", OLD."createdByUserId", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'POL-279 reserve root identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."title", NEW."basisSummary") IS DISTINCT FROM ROW(OLD."title", OLD."basisSummary")
     AND (
       (SELECT COUNT(*) FROM public."ProjectNecessaryExpenseReserveEntry" WHERE "reserveId" = OLD."id") <> 1
       OR EXISTS (
         SELECT 1 FROM public."ProjectNecessaryExpenseReserveEntry"
          WHERE "reserveId" = OLD."id" AND "status" NOT IN ('draft', 'returned')
       )
     ) THEN
    RAISE EXCEPTION 'POL-279 reserve description is frozen outside its sole editable draft'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectNecessaryExpenseReserve_identity_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectNecessaryExpenseReserve"
  FOR EACH ROW EXECUTE FUNCTION "pol279_reserve_identity_guard"();

-- Register the evidence reference in the canonical private-file inventory.
-- The evidence relation is non-exclusive, but it must still reject reuse of a
-- file already owned by an exclusive business binding in either direction.
SELECT pg_advisory_xact_lock(190731, 279);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol279_necessary_expense_reserve;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol279_necessary_expense_reserve()
  UNION ALL
  VALUES ('ProjectNecessaryExpenseReserveEntry', 'evidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_project_necessary_expense_reserve_entry_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "ProjectNecessaryExpenseReserveEntry"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'evidenceFileId',
  'false'
);

ALTER ROLE "jg_pol279_runtime"
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO "jg_pol279_runtime";
REVOKE ALL ON TABLE
  "ProjectNecessaryExpenseReserve", "ProjectNecessaryExpenseReserveEntry",
  "ProjectNecessaryExpenseReserveReplacement", "ProjectNecessaryExpenseReserveCommandReceipt"
  FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE
  "ProjectNecessaryExpenseReserve", "ProjectNecessaryExpenseReserveEntry"
  TO "jg_pol279_runtime";
GRANT SELECT, INSERT ON TABLE
  "ProjectNecessaryExpenseReserveReplacement", "ProjectNecessaryExpenseReserveCommandReceipt"
  TO "jg_pol279_runtime";
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ProjectNecessaryExpenseReserveReplacement", "ProjectNecessaryExpenseReserveCommandReceipt"
  FROM "jg_pol279_runtime";
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ProjectNecessaryExpenseReserve", "ProjectNecessaryExpenseReserveEntry"
  FROM "jg_pol279_runtime";
REVOKE CREATE ON SCHEMA public FROM "jg_pol279_runtime";
REVOKE ALL ON FUNCTION "pol279_entry_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol279_replacement_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol279_reserve_identity_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol279_command_receipt_immutable"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol279_cross_source_identity_exists"(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "pol279_cross_source_identity_exists"(TEXT)
  TO "jg_pol279_runtime";

COMMIT;
