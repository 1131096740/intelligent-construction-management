-- POL-13C: explicit project/company fund movements and immutable legs.
--
-- This migration is intended for the isolated non-production #222 candidate.
-- A movement is an auditable aggregate over an existing PaymentExecution (when
-- one exists); it is not a second bank-payment fact.  The rows below are
-- append-only once submitted/confirmed and every confirmed leg must point at
-- exactly one OperatingFact for its own project.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 222);

CREATE TABLE "FundMovement" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "paymentExecutionId" TEXT,
  "sourceProjectId" TEXT NOT NULL,
  "beneficiaryProjectId" TEXT NOT NULL,
  "sourceCompanyEntityId" TEXT NOT NULL,
  "beneficiaryCompanyEntityId" TEXT NOT NULL,
  "paymentAmountCents" BIGINT NOT NULL,
  "projectFundUsedCents" BIGINT NOT NULL,
  "companyAdvanceCents" BIGINT NOT NULL,
  "profitAuthorizationId" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "confirmedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundMovement_kind_check"
    CHECK ("kind" IN (
      'cross_project_payment',
      'same_project_company_transfer',
      'temporary_project_fund_use',
      'temporary_project_fund_return',
      'company_advance',
      'company_advance_recovery',
      'profit_distribution_execution'
    )),
  CONSTRAINT "FundMovement_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'review_returned', 'confirmed')),
  CONSTRAINT "FundMovement_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "FundMovement_amount_check"
    CHECK ("paymentAmountCents" > 0),
  CONSTRAINT "FundMovement_amount_conservation_check"
    CHECK (
      "projectFundUsedCents" >= 0
      AND "companyAdvanceCents" >= 0
      AND "projectFundUsedCents" <= "paymentAmountCents"
      AND "projectFundUsedCents" + "companyAdvanceCents" = "paymentAmountCents"
    ),
  CONSTRAINT "FundMovement_scope_check"
    CHECK (
      btrim("sourceProjectId") <> ''
      AND btrim("beneficiaryProjectId") <> ''
      AND btrim("sourceCompanyEntityId") <> ''
      AND btrim("beneficiaryCompanyEntityId") <> ''
      AND (
        ("kind" = 'cross_project_payment'
          AND "sourceProjectId" <> "beneficiaryProjectId")
        OR ("kind" = 'same_project_company_transfer'
          AND "sourceProjectId" = "beneficiaryProjectId"
          AND "sourceCompanyEntityId" <> "beneficiaryCompanyEntityId")
        OR ("kind" IN (
          'temporary_project_fund_use',
          'temporary_project_fund_return',
          'company_advance',
          'company_advance_recovery',
          'profit_distribution_execution'
        ) AND "sourceProjectId" = "beneficiaryProjectId")
      )
    ),
  CONSTRAINT "FundMovement_profit_authorization_shape_check"
    CHECK (
      ("kind" = 'profit_distribution_execution'
        AND btrim(COALESCE("profitAuthorizationId", '')) <> '')
      OR ("kind" <> 'profit_distribution_execution'
        AND "profitAuthorizationId" IS NULL)
    ),
  CONSTRAINT "FundMovement_fingerprint_check"
    CHECK ("payloadFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FundMovement_idempotency_uuidv4_check"
    CHECK ("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "FundMovement_lifecycle_audit_check"
    CHECK (
      ("status" = 'draft'
        AND "submittedByUserId" IS NULL
        AND "submittedAt" IS NULL
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL)
      OR ("status" IN ('submitted', 'review_returned')
        AND btrim(COALESCE("submittedByUserId", '')) <> ''
        AND "submittedAt" IS NOT NULL
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL)
      OR ("status" = 'confirmed'
        AND btrim(COALESCE("submittedByUserId", '')) <> ''
        AND "submittedAt" IS NOT NULL
        AND btrim(COALESCE("confirmedByUserId", '')) <> ''
        AND "confirmedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "FundMovement_idempotencyKey_key"
  ON "FundMovement"("idempotencyKey");
CREATE INDEX "FundMovement_status_updatedAt_idx"
  ON "FundMovement"("status", "updatedAt");
CREATE INDEX "FundMovement_paymentExecutionId_idx"
  ON "FundMovement"("paymentExecutionId");
CREATE UNIQUE INDEX "FundMovement_payment_execution_unique"
  ON "FundMovement"("paymentExecutionId");
CREATE INDEX "FundMovement_project_scope_idx"
  ON "FundMovement"("sourceProjectId", "beneficiaryProjectId");
CREATE INDEX "FundMovement_company_scope_idx"
  ON "FundMovement"("sourceCompanyEntityId", "beneficiaryCompanyEntityId");

ALTER TABLE "FundMovement"
  ADD CONSTRAINT "FundMovement_payment_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_source_project_fkey"
    FOREIGN KEY ("sourceProjectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_beneficiary_project_fkey"
    FOREIGN KEY ("beneficiaryProjectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_source_company_fkey"
    FOREIGN KEY ("sourceCompanyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_beneficiary_company_fkey"
    FOREIGN KEY ("beneficiaryCompanyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_created_by_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_submitted_by_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovement_confirmed_by_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FundMovementLeg" (
  "id" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "legNo" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "counterpartyProjectId" TEXT,
  "counterpartyCompanyEntityId" TEXT,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "projectFundUsedCents" BIGINT NOT NULL,
  "companyAdvanceCents" BIGINT NOT NULL,
  "paymentExecutionId" TEXT,
  "relationshipEntryId" TEXT,
  "sourceType" TEXT,
  "sourceAggregateId" TEXT,
  "sourceAllocationCount" INTEGER,
  "sourceAllocationAmountCents" BIGINT,
  "contractId" TEXT,
  "contractVersionId" TEXT,
  "operatingFactId" TEXT,
  "sourceSnapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundMovementLeg_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundMovementLeg_role_check"
    CHECK ("role" IN ('source', 'beneficiary')),
  CONSTRAINT "FundMovementLeg_direction_check"
    CHECK ("direction" IN ('increase', 'decrease', 'neutral')),
  CONSTRAINT "FundMovementLeg_leg_no_check"
    CHECK ("legNo" > 0),
  CONSTRAINT "FundMovementLeg_amount_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "FundMovementLeg_amount_conservation_check"
    CHECK (
      "projectFundUsedCents" >= 0
      AND "companyAdvanceCents" >= 0
      AND "projectFundUsedCents" <= "amountCents"
      AND (
        ("role" = 'source' AND "projectFundUsedCents" + "companyAdvanceCents" = "amountCents")
        OR ("role" = 'beneficiary' AND "projectFundUsedCents" = 0 AND "companyAdvanceCents" = 0)
      )
    ),
  CONSTRAINT "FundMovementLeg_scope_check"
    CHECK (
      btrim("movementId") <> ''
      AND btrim("projectId") <> ''
      AND btrim("companyEntityId") <> ''
      AND (
        ("sourceType" IS NULL
          AND "sourceAggregateId" IS NULL
          AND "sourceAllocationCount" IS NULL
          AND "sourceAllocationAmountCents" IS NULL)
        OR (btrim(COALESCE("sourceType", '')) <> ''
          AND btrim(COALESCE("sourceAggregateId", '')) <> ''
          AND "sourceAllocationCount" IS NOT NULL
          AND "sourceAllocationCount" > 0
          AND "sourceAllocationAmountCents" IS NOT NULL
          AND "sourceAllocationAmountCents" = "amountCents")
      )
      AND (("contractId" IS NULL) = ("contractVersionId" IS NULL))
    ),
  CONSTRAINT "FundMovementLeg_source_snapshot_check"
    CHECK (
      jsonb_typeof("sourceSnapshot") = 'object'
      AND "sourceSnapshot" ?& ARRAY[
        'sourceType',
        'sourceAggregateId',
        'sourceAllocationCount',
        'sourceAllocationAmountCents',
        'contractId',
        'contractVersionId'
      ]
      AND ("sourceSnapshot"->>'sourceType') IS NOT DISTINCT FROM "sourceType"
      AND ("sourceSnapshot"->>'sourceAggregateId') IS NOT DISTINCT FROM "sourceAggregateId"
      AND (("sourceSnapshot"->>'sourceAllocationCount')::INTEGER) IS NOT DISTINCT FROM "sourceAllocationCount"
      AND (("sourceSnapshot"->>'sourceAllocationAmountCents')::BIGINT) IS NOT DISTINCT FROM "sourceAllocationAmountCents"
      AND ("sourceSnapshot"->>'contractId') IS NOT DISTINCT FROM "contractId"
      AND ("sourceSnapshot"->>'contractVersionId') IS NOT DISTINCT FROM "contractVersionId"
    ),
  CONSTRAINT "FundMovementLeg_fingerprint_check"
    CHECK ("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

CREATE UNIQUE INDEX "FundMovementLeg_idempotencyKey_key"
  ON "FundMovementLeg"("idempotencyKey");
CREATE UNIQUE INDEX "FundMovementLeg_operating_fact_unique"
  ON "FundMovementLeg"("operatingFactId");
CREATE UNIQUE INDEX "FundMovementLeg_movement_leg_no_key"
  ON "FundMovementLeg"("movementId", "legNo");
CREATE INDEX "FundMovementLeg_project_createdAt_idx"
  ON "FundMovementLeg"("projectId", "createdAt");
CREATE INDEX "FundMovementLeg_movement_role_idx"
  ON "FundMovementLeg"("movementId", "role");
CREATE INDEX "FundMovementLeg_paymentExecutionId_idx"
  ON "FundMovementLeg"("paymentExecutionId");
CREATE UNIQUE INDEX "FundMovementLeg_relationship_entry_unique"
  ON "FundMovementLeg"("relationshipEntryId");

ALTER TABLE "FundMovementLeg"
  ADD CONSTRAINT "FundMovementLeg_movement_fkey"
    FOREIGN KEY ("movementId") REFERENCES "FundMovement"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementLeg_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementLeg_company_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementLeg_payment_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementLeg_operating_fact_fkey"
    FOREIGN KEY ("operatingFactId") REFERENCES "OperatingFact"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundMovementLeg_created_by_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FundMovementRelationshipEntry" (
  "id" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "legId" TEXT,
  "entryKind" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "adjustsEntryId" TEXT,
  "sourceProjectId" TEXT NOT NULL,
  "beneficiaryProjectId" TEXT NOT NULL,
  "debtorCompanyEntityId" TEXT NOT NULL,
  "creditorCompanyEntityId" TEXT NOT NULL,
  "sourceType" TEXT,
  "sourceAggregateId" TEXT,
  "sourceAllocationCount" INTEGER,
  "sourceAllocationAmountCents" BIGINT,
  "contractId" TEXT,
  "contractVersionId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "sourceSnapshot" JSONB NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "FundMovementRelationshipEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundMovementRelationshipEntry_entry_kind_check"
    CHECK ("entryKind" IN (
      'project_internal_receivable',
      'project_internal_payable',
      'temporary_project_fund_use',
      'temporary_project_fund_return',
      'company_advance',
      'company_advance_recovery'
    )),
  CONSTRAINT "FundMovementRelationshipEntry_direction_check"
    CHECK ("direction" IN ('increase', 'decrease')),
  CONSTRAINT "FundMovementRelationshipEntry_status_check"
    CHECK ("status" IN ('draft', 'confirmed')),
  CONSTRAINT "FundMovementRelationshipEntry_amount_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "FundMovementRelationshipEntry_currency_check"
    CHECK ("currencyCode" = 'CNY'),
  CONSTRAINT "FundMovementRelationshipEntry_scope_check"
    CHECK (
      btrim("movementId") <> ''
      AND btrim("sourceProjectId") <> ''
      AND btrim("beneficiaryProjectId") <> ''
      AND btrim("debtorCompanyEntityId") <> ''
      AND btrim("creditorCompanyEntityId") <> ''
      AND "adjustsEntryId" IS DISTINCT FROM "id"
      AND (
        ("sourceType" IS NULL
          AND "sourceAggregateId" IS NULL
          AND "sourceAllocationCount" IS NULL
          AND "sourceAllocationAmountCents" IS NULL)
        OR (btrim(COALESCE("sourceType", '')) <> ''
          AND btrim(COALESCE("sourceAggregateId", '')) <> ''
          AND "sourceAllocationCount" IS NOT NULL
          AND "sourceAllocationCount" > 0
          AND "sourceAllocationAmountCents" IS NOT NULL
          AND "sourceAllocationAmountCents" = "amountCents")
      )
      AND (("contractId" IS NULL) = ("contractVersionId" IS NULL))
    ),
  CONSTRAINT "FundMovementRelationshipEntry_source_snapshot_check"
    CHECK (
      jsonb_typeof("sourceSnapshot") = 'object'
      AND "sourceSnapshot" ?& ARRAY[
        'sourceType',
        'sourceAggregateId',
        'sourceAllocationCount',
        'sourceAllocationAmountCents',
        'contractId',
        'contractVersionId'
      ]
      AND ("sourceSnapshot"->>'sourceType') IS NOT DISTINCT FROM "sourceType"
      AND ("sourceSnapshot"->>'sourceAggregateId') IS NOT DISTINCT FROM "sourceAggregateId"
      AND (("sourceSnapshot"->>'sourceAllocationCount')::INTEGER) IS NOT DISTINCT FROM "sourceAllocationCount"
      AND (("sourceSnapshot"->>'sourceAllocationAmountCents')::BIGINT) IS NOT DISTINCT FROM "sourceAllocationAmountCents"
      AND ("sourceSnapshot"->>'contractId') IS NOT DISTINCT FROM "contractId"
      AND ("sourceSnapshot"->>'contractVersionId') IS NOT DISTINCT FROM "contractVersionId"
    ),
  CONSTRAINT "FundMovementRelationshipEntry_fingerprint_check"
    CHECK ("payloadFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FundMovementRelationshipEntry_idempotency_uuidv4_check"
    CHECK ("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "FundMovementRelationshipEntry_lifecycle_audit_check"
    CHECK (
      ("status" = 'draft'
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL)
      OR ("status" = 'confirmed'
        AND btrim(COALESCE("confirmedByUserId", '')) <> ''
        AND "confirmedAt" IS NOT NULL)
    ),
  CONSTRAINT "FundMovementRelationshipEntry_direction_shape_check"
    CHECK (
      ("direction" = 'increase' AND "adjustsEntryId" IS NULL)
      OR ("direction" = 'decrease' AND "adjustsEntryId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "FundMovementRelationshipEntry_idempotencyKey_key"
  ON "FundMovementRelationshipEntry"("idempotencyKey");
CREATE INDEX "FundMovementRelationshipEntry_movement_status_idx"
  ON "FundMovementRelationshipEntry"("movementId", "status");
CREATE INDEX "FundMovementRelationshipEntry_project_createdAt_idx"
  ON "FundMovementRelationshipEntry"("sourceProjectId", "beneficiaryProjectId", "createdAt");
CREATE INDEX "FundMovementRelationshipEntry_company_createdAt_idx"
  ON "FundMovementRelationshipEntry"("debtorCompanyEntityId", "creditorCompanyEntityId", "createdAt");
CREATE INDEX "FundMovementRelationshipEntry_adjustsEntryId_idx"
  ON "FundMovementRelationshipEntry"("adjustsEntryId");

ALTER TABLE "FundMovementRelationshipEntry"
  ADD CONSTRAINT "FundMovementRelationshipEntry_movement_fkey"
    FOREIGN KEY ("movementId") REFERENCES "FundMovement"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_leg_fkey"
    FOREIGN KEY ("legId") REFERENCES "FundMovementLeg"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_original_fkey"
    FOREIGN KEY ("adjustsEntryId") REFERENCES "FundMovementRelationshipEntry"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_source_project_fkey"
    FOREIGN KEY ("sourceProjectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_beneficiary_project_fkey"
    FOREIGN KEY ("beneficiaryProjectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_created_by_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_confirmed_by_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_debtor_company_fkey"
    FOREIGN KEY ("debtorCompanyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FundMovementRelationshipEntry_creditor_company_fkey"
    FOREIGN KEY ("creditorCompanyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FundMovementLeg"
  ADD CONSTRAINT "FundMovementLeg_relationship_entry_fkey"
    FOREIGN KEY ("relationshipEntryId") REFERENCES "FundMovementRelationshipEntry"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FundMovementCommandReceipt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "movementId" TEXT,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundMovementCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundMovementCommandReceipt_action_check"
    CHECK ("action" IN ('create', 'submit', 'confirm', 'return', 'cancel')),
  CONSTRAINT "FundMovementCommandReceipt_idempotency_uuidv4_check"
    CHECK ("idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "FundMovementCommandReceipt_fingerprint_check"
    CHECK ("payloadFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FundMovementCommandReceipt_response_snapshot_check"
    CHECK (jsonb_typeof("responseSnapshot") = 'object')
);

CREATE UNIQUE INDEX "FundMovementCommandReceipt_idempotencyKey_key"
  ON "FundMovementCommandReceipt"("idempotencyKey");
CREATE INDEX "FundMovementCommandReceipt_movementId_idx"
  ON "FundMovementCommandReceipt"("movementId");

ALTER TABLE "FundMovementCommandReceipt"
  ADD CONSTRAINT "FundMovementCommandReceipt_movement_fkey"
    FOREIGN KEY ("movementId") REFERENCES "FundMovement"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fund-movement rows are backend command facts, not client-writable ledger
-- rows. Keep reads available while revoking direct DML from PUBLIC; every
-- command write must first establish the transaction context below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE "FundMovement", "FundMovementLeg",
             "FundMovementRelationshipEntry", "FundMovementCommandReceipt"
  FROM PUBLIC;

-- A direct SQL/ORM insert can never create a submitted or confirmed movement.
-- It must be a draft first, and only the audited service transition may move it
-- forward.  The trigger also freezes identity fields after submission.
CREATE FUNCTION assert_fund_movement_sod(
  p_created_by TEXT,
  p_submitted_by TEXT,
  p_confirmed_by TEXT
)
RETURNS VOID AS $$
BEGIN
  IF NULLIF(btrim(p_created_by), '') IS NULL THEN
    RAISE EXCEPTION 'fund_movement_sod_invalid';
  END IF;
  IF p_submitted_by IS NOT NULL AND p_submitted_by = p_created_by THEN
    RAISE EXCEPTION 'fund_movement_sod_invalid';
  END IF;
  IF p_confirmed_by IS NOT NULL
     AND (p_confirmed_by = p_created_by OR p_confirmed_by = p_submitted_by) THEN
    RAISE EXCEPTION 'fund_movement_sod_invalid';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Every fund-movement write must run inside the application command context.
-- The service sets this transaction-local marker immediately after opening its
-- Serializable transaction.  Keeping the check in the database closes the
-- direct SQL/ORM bypass that could otherwise skip the audited command path.
CREATE FUNCTION assert_fund_movement_write_context()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor TEXT;
  authorized_actor TEXT;
BEGIN
  actor := NULLIF(btrim(current_setting('app.fund_movement_actor', true)), '');
  SELECT "actorUserId"
    INTO authorized_actor
    FROM public."OperatingLedgerWriteContext"
   WHERE "backendPid" = pg_backend_pid()
     AND "transactionId" = txid_current();
  IF actor IS NULL OR authorized_actor IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'fund_movement_write_context_invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION require_fund_movement_write_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM assert_fund_movement_write_context();
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FundMovement_require_write_context"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovement"
FOR EACH ROW EXECUTE FUNCTION require_fund_movement_write_context();

CREATE TRIGGER "FundMovementLeg_require_write_context"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementLeg"
FOR EACH ROW EXECUTE FUNCTION require_fund_movement_write_context();

CREATE TRIGGER "FundMovementRelationshipEntry_require_write_context"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementRelationshipEntry"
FOR EACH ROW EXECUTE FUNCTION require_fund_movement_write_context();

CREATE TRIGGER "FundMovementCommandReceipt_require_write_context"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementCommandReceipt"
FOR EACH ROW EXECUTE FUNCTION require_fund_movement_write_context();

CREATE FUNCTION guard_fund_movement_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."status" := 'draft';
    NEW."submittedByUserId" := NULL;
    NEW."submittedAt" := NULL;
    NEW."confirmedByUserId" := NULL;
    NEW."confirmedAt" := NULL;
    PERFORM assert_fund_movement_sod(NEW."createdByUserId", NULL, NULL);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FundMovement_confirmed_immutable';
  END IF;

  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'FundMovement_confirmed_immutable';
  END IF;

  IF NOT (
    (OLD."status" = 'draft' AND NEW."status" IN ('draft', 'submitted'))
    OR (OLD."status" = 'submitted' AND NEW."status" IN ('submitted', 'confirmed', 'review_returned'))
    OR (OLD."status" = 'review_returned' AND NEW."status" IN ('review_returned', 'draft'))
  ) THEN
    RAISE EXCEPTION 'FundMovement_invalid_transition';
  END IF;

  IF OLD."status" = 'review_returned'
     AND NEW."status" = 'draft'
     AND NEW."revision" <= OLD."revision" THEN
    RAISE EXCEPTION 'FundMovement_revision_must_increase';
  END IF;

  IF OLD."status" = 'draft'
     AND NEW."status" = 'submitted'
     AND NEW."revision" <= OLD."revision" THEN
    RAISE EXCEPTION 'FundMovement_revision_must_increase';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'FundMovement_confirmed_immutable';
  END IF;

  -- A submitted payload is frozen. A returned row may be edited only after it
  -- transitions to a new draft revision; it still cannot change its identity.
  IF OLD."status" = 'submitted'
     OR (OLD."status" = 'review_returned' AND NEW."status" = 'review_returned') THEN
    IF NEW."kind" IS DISTINCT FROM OLD."kind"
       OR (
         NEW."revision" IS DISTINCT FROM OLD."revision"
         AND NOT (
           OLD."status" = 'submitted'
           AND NEW."status" = 'confirmed'
           AND NEW."revision" = OLD."revision" + 1
         )
       )
       OR NEW."paymentExecutionId" IS DISTINCT FROM OLD."paymentExecutionId"
       OR NEW."sourceProjectId" IS DISTINCT FROM OLD."sourceProjectId"
       OR NEW."beneficiaryProjectId" IS DISTINCT FROM OLD."beneficiaryProjectId"
       OR NEW."sourceCompanyEntityId" IS DISTINCT FROM OLD."sourceCompanyEntityId"
       OR NEW."beneficiaryCompanyEntityId" IS DISTINCT FROM OLD."beneficiaryCompanyEntityId"
       OR NEW."paymentAmountCents" IS DISTINCT FROM OLD."paymentAmountCents"
       OR NEW."projectFundUsedCents" IS DISTINCT FROM OLD."projectFundUsedCents"
       OR NEW."companyAdvanceCents" IS DISTINCT FROM OLD."companyAdvanceCents"
       OR NEW."profitAuthorizationId" IS DISTINCT FROM OLD."profitAuthorizationId"
       OR NEW."payloadFingerprint" IS DISTINCT FROM OLD."payloadFingerprint" THEN
      RAISE EXCEPTION 'FundMovement_confirmed_immutable';
    END IF;
    IF NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId"
       OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
      RAISE EXCEPTION 'FundMovement_confirmed_immutable';
    END IF;
  END IF;

  IF OLD."status" = 'submitted'
     AND NEW."status" = 'confirmed'
     AND NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'FundMovement_revision_must_increase';
  END IF;

  IF NEW."status" = 'draft' THEN
    IF NEW."submittedByUserId" IS NOT NULL
       OR NEW."submittedAt" IS NOT NULL
       OR NEW."confirmedByUserId" IS NOT NULL
       OR NEW."confirmedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'FundMovement_invalid_transition';
    END IF;
  ELSIF NEW."status" IN ('submitted', 'review_returned') THEN
    IF NULLIF(btrim(COALESCE(NEW."submittedByUserId", '')), '') IS NULL
       OR NEW."submittedAt" IS NULL
       OR NEW."confirmedByUserId" IS NOT NULL
       OR NEW."confirmedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'FundMovement_invalid_transition';
    END IF;
  ELSIF NEW."status" = 'confirmed' THEN
    IF NULLIF(btrim(COALESCE(NEW."submittedByUserId", '')), '') IS NULL
       OR NEW."submittedAt" IS NULL
       OR NULLIF(btrim(COALESCE(NEW."confirmedByUserId", '')), '') IS NULL
       OR NEW."confirmedAt" IS NULL THEN
      RAISE EXCEPTION 'FundMovement_invalid_transition';
    END IF;
  END IF;

  PERFORM assert_fund_movement_sod(
    NEW."createdByUserId",
    NEW."submittedByUserId",
    NEW."confirmedByUserId"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FundMovement_insert_forces_draft"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovement"
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_lifecycle();

-- The only submitted-state source-snapshot mutation is the server projection
-- performed by the confirm command.  The transaction-local marker is paired
-- with the existing actor marker and the movement id; it is never a client
-- field, business id, authorization, or receipt key.  The old/new authority
-- shape below makes the seam one-way and prevents replay on an already
-- projected child row.
CREATE FUNCTION assert_fund_movement_source_snapshot_projection_context(
  p_movement_id TEXT,
  p_payment_execution_id TEXT,
  p_old_snapshot JSONB,
  p_new_snapshot JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor TEXT;
  projection_marker TEXT;
BEGIN
  actor := NULLIF(btrim(current_setting('app.fund_movement_actor', true)), '');
  projection_marker := NULLIF(btrim(current_setting('app.fund_movement_snapshot_projection', true)), '');
  IF actor IS NULL
     OR projection_marker IS DISTINCT FROM (p_movement_id || ':' || actor)
     OR p_payment_execution_id IS NULL
     OR jsonb_typeof(p_old_snapshot) IS DISTINCT FROM 'object'
     OR p_old_snapshot->>'authority' IS DISTINCT FROM 'fund_movement_draft'
     OR p_old_snapshot->>'status' IS DISTINCT FROM 'pending_server_resolution'
     OR jsonb_typeof(p_new_snapshot) IS DISTINCT FROM 'object'
     OR p_new_snapshot->>'authority' IS DISTINCT FROM 'payment_execution_source'
     OR p_new_snapshot->>'paymentExecutionId' IS DISTINCT FROM p_payment_execution_id THEN
    RAISE EXCEPTION 'fund_movement_snapshot_projection_context_invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Legs are immutable evidence once a movement is submitted. A server-side
-- operating projection may fill the one nullable operatingFactId before the
-- movement is confirmed; the project and source identity are rechecked here.
CREATE FUNCTION guard_fund_movement_leg_immutable()
RETURNS TRIGGER AS $$
DECLARE
  movement_status TEXT;
  movement_kind TEXT;
  movement_payment_execution_id TEXT;
  operating_fact_project_id TEXT;
  operating_fact_kind TEXT;
  operating_fact_source_type TEXT;
  operating_fact_source_business_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund_movement_leg_append_only';
  END IF;

  SELECT movement."status", movement."kind", movement."paymentExecutionId"
  INTO movement_status, movement_kind, movement_payment_execution_id
  FROM "FundMovement" movement
  WHERE movement."id" = NEW."movementId"
  FOR KEY SHARE;
  IF NOT FOUND OR movement_status = 'confirmed' THEN
    RAISE EXCEPTION 'fund_movement_leg_movement_invalid';
  END IF;
  IF TG_OP = 'INSERT' AND movement_status <> 'draft' THEN
    RAISE EXCEPTION 'fund_movement_leg_insert_requires_draft';
  END IF;
  IF movement_status IN ('draft', 'review_returned')
     AND NEW."operatingFactId" IS NOT NULL THEN
    RAISE EXCEPTION 'fund_movement_operating_fact_requires_confirmed_movement';
  END IF;
  IF movement_status IN ('draft', 'review_returned')
     AND NEW."sourceSnapshot"->>'authority' = 'payment_execution_source' THEN
    RAISE EXCEPTION 'fund_movement_snapshot_projection_context_invalid';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."movementId" IS DISTINCT FROM OLD."movementId"
       OR NEW."legNo" IS DISTINCT FROM OLD."legNo"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
      RAISE EXCEPTION 'fund_movement_leg_immutable';
    END IF;
    IF movement_status IN ('submitted', 'review_returned') THEN
      IF NEW."role" IS DISTINCT FROM OLD."role"
         OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
         OR NEW."companyEntityId" IS DISTINCT FROM OLD."companyEntityId"
         OR NEW."counterpartyProjectId" IS DISTINCT FROM OLD."counterpartyProjectId"
         OR NEW."counterpartyCompanyEntityId" IS DISTINCT FROM OLD."counterpartyCompanyEntityId"
         OR NEW."direction" IS DISTINCT FROM OLD."direction"
         OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
         OR NEW."projectFundUsedCents" IS DISTINCT FROM OLD."projectFundUsedCents"
         OR NEW."companyAdvanceCents" IS DISTINCT FROM OLD."companyAdvanceCents"
         OR NEW."paymentExecutionId" IS DISTINCT FROM OLD."paymentExecutionId"
         OR NEW."relationshipEntryId" IS DISTINCT FROM OLD."relationshipEntryId"
         OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
         OR NEW."sourceAggregateId" IS DISTINCT FROM OLD."sourceAggregateId"
         OR NEW."sourceAllocationCount" IS DISTINCT FROM OLD."sourceAllocationCount"
         OR NEW."sourceAllocationAmountCents" IS DISTINCT FROM OLD."sourceAllocationAmountCents"
         OR NEW."contractId" IS DISTINCT FROM OLD."contractId"
         OR NEW."contractVersionId" IS DISTINCT FROM OLD."contractVersionId" THEN
        RAISE EXCEPTION 'fund_movement_leg_immutable';
      END IF;
      IF NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot" THEN
        IF movement_status <> 'submitted'
           OR movement_kind <> 'cross_project_payment' THEN
          RAISE EXCEPTION 'fund_movement_leg_immutable';
        END IF;
        PERFORM assert_fund_movement_source_snapshot_projection_context(
          NEW."movementId",
          movement_payment_execution_id,
          OLD."sourceSnapshot",
          NEW."sourceSnapshot"
        );
      END IF;
      -- Confirmation is the one server-side projection seam: while the
      -- movement is submitted, a missing fact may be filled exactly once. A
      -- returned movement remains fully frozen until it is edited as a new
      -- draft revision.
      IF (movement_status = 'review_returned'
          OR OLD."operatingFactId" IS NOT NULL)
         AND NEW."operatingFactId" IS DISTINCT FROM OLD."operatingFactId" THEN
        RAISE EXCEPTION 'fund_movement_leg_immutable';
      END IF;
    ELSIF OLD."operatingFactId" IS NOT NULL
      AND NEW."operatingFactId" IS DISTINCT FROM OLD."operatingFactId" THEN
      RAISE EXCEPTION 'fund_movement_leg_immutable';
    END IF;
  END IF;

  IF NEW."operatingFactId" IS NOT NULL THEN
    SELECT fact."projectId", fact."factKind", fact."sourceType", fact."sourceBusinessId"
    INTO operating_fact_project_id, operating_fact_kind,
         operating_fact_source_type, operating_fact_source_business_id
    FROM "OperatingFact" fact
    WHERE fact."id" = NEW."operatingFactId"
    FOR KEY SHARE;
    IF NOT FOUND
       OR operating_fact_project_id IS DISTINCT FROM NEW."projectId"
       OR operating_fact_kind IS DISTINCT FROM 'fund_movement'
       OR operating_fact_source_type IS DISTINCT FROM 'fund_movement_leg'
       OR operating_fact_source_business_id IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'fund_movement_operating_fact_scope_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FundMovementLeg_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementLeg"
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_leg_immutable();

CREATE FUNCTION guard_fund_movement_relationship_immutable()
RETURNS TRIGGER AS $$
DECLARE
  movement_status TEXT;
  movement_kind TEXT;
  movement_payment_execution_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."status" := 'draft';
    NEW."confirmedByUserId" := NULL;
    NEW."confirmedAt" := NULL;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund_movement_relationship_append_only';
  ELSIF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'fund_movement_relationship_immutable';
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."movementId" IS DISTINCT FROM OLD."movementId"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
      RAISE EXCEPTION 'fund_movement_relationship_immutable';
    END IF;
    IF NOT (OLD."status" = 'draft' AND NEW."status" IN ('draft', 'confirmed')) THEN
      RAISE EXCEPTION 'fund_movement_relationship_transition_invalid';
    END IF;
  END IF;

  SELECT movement."status", movement."kind", movement."paymentExecutionId"
  INTO movement_status, movement_kind, movement_payment_execution_id
  FROM "FundMovement" movement
  WHERE movement."id" = NEW."movementId"
  FOR KEY SHARE;
  IF NOT FOUND OR movement_status = 'confirmed' THEN
    RAISE EXCEPTION 'fund_movement_relationship_movement_invalid';
  END IF;
  IF TG_OP = 'INSERT' AND movement_status <> 'draft' THEN
    RAISE EXCEPTION 'fund_movement_relationship_insert_requires_draft';
  END IF;
  IF movement_status IN ('draft', 'review_returned')
     AND NEW."sourceSnapshot"->>'authority' = 'payment_execution_source' THEN
    RAISE EXCEPTION 'fund_movement_snapshot_projection_context_invalid';
  END IF;
  IF NEW."status" = 'confirmed' AND movement_status <> 'submitted' THEN
    RAISE EXCEPTION 'fund_movement_relationship_parent_transition_invalid';
  END IF;

  IF TG_OP = 'UPDATE' AND movement_status IN ('submitted', 'review_returned') THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."movementId" IS DISTINCT FROM OLD."movementId"
       OR NEW."legId" IS DISTINCT FROM OLD."legId"
       OR NEW."entryKind" IS DISTINCT FROM OLD."entryKind"
       OR NEW."direction" IS DISTINCT FROM OLD."direction"
       OR NEW."adjustsEntryId" IS DISTINCT FROM OLD."adjustsEntryId"
       OR NEW."sourceProjectId" IS DISTINCT FROM OLD."sourceProjectId"
       OR NEW."beneficiaryProjectId" IS DISTINCT FROM OLD."beneficiaryProjectId"
       OR NEW."debtorCompanyEntityId" IS DISTINCT FROM OLD."debtorCompanyEntityId"
       OR NEW."creditorCompanyEntityId" IS DISTINCT FROM OLD."creditorCompanyEntityId"
       OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
       OR NEW."sourceAggregateId" IS DISTINCT FROM OLD."sourceAggregateId"
       OR NEW."sourceAllocationCount" IS DISTINCT FROM OLD."sourceAllocationCount"
       OR NEW."sourceAllocationAmountCents" IS DISTINCT FROM OLD."sourceAllocationAmountCents"
       OR NEW."contractId" IS DISTINCT FROM OLD."contractId"
       OR NEW."contractVersionId" IS DISTINCT FROM OLD."contractVersionId"
       OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
       OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
       OR NEW."payloadFingerprint" IS DISTINCT FROM OLD."payloadFingerprint"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
      RAISE EXCEPTION 'fund_movement_relationship_immutable';
    END IF;
    IF NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot" THEN
      IF movement_status <> 'submitted'
         OR movement_kind <> 'cross_project_payment' THEN
        RAISE EXCEPTION 'fund_movement_relationship_immutable';
      END IF;
      PERFORM assert_fund_movement_source_snapshot_projection_context(
        NEW."movementId",
        movement_payment_execution_id,
        OLD."sourceSnapshot",
        NEW."sourceSnapshot"
      );
    END IF;
  END IF;

  IF NEW."legId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "FundMovementLeg" leg
    WHERE leg."id" = NEW."legId"
      AND leg."movementId" = NEW."movementId"
  ) THEN
    RAISE EXCEPTION 'fund_movement_relationship_leg_scope_invalid';
  END IF;

  IF NEW."status" = 'draft' THEN
    IF NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'fund_movement_relationship_transition_invalid';
    END IF;
  ELSE
    IF NULLIF(btrim(COALESCE(NEW."confirmedByUserId", '')), '') IS NULL
       OR NEW."confirmedAt" IS NULL THEN
      RAISE EXCEPTION 'fund_movement_relationship_transition_invalid';
    END IF;
    IF NEW."createdByUserId" = NEW."confirmedByUserId" THEN
      RAISE EXCEPTION 'fund_movement_relationship_sod_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FundMovementRelationshipEntry_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementRelationshipEntry"
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_relationship_immutable();

CREATE FUNCTION guard_fund_movement_receipt_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'fund_movement_receipt_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FundMovementCommandReceipt_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "FundMovementCommandReceipt"
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_receipt_immutable();

-- A confirmed aggregate is a complete set: all legs are present and linked to
-- distinct same-project OperatingFacts; cross-project payment additionally
-- requires the existing PaymentExecution, both project legs and a confirmed
-- internal relationship whose source/contract/allocation coordinates match.
CREATE FUNCTION assert_fund_movement_lineage(p_movement_id TEXT)
RETURNS VOID AS $$
DECLARE
  movement RECORD;
  execution_amount BIGINT;
  execution_payment_request_id TEXT;
  execution_settlement_id TEXT;
  execution_actual_payer_company_id TEXT;
  execution_payer_attestation_fingerprint TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_contract_version_id TEXT;
  request_settlement_id TEXT;
  request_status TEXT;
  request_payment_subject_type TEXT;
  request_abandoned_at TIMESTAMPTZ;
  request_approved_amount BIGINT;
  request_paid_amount BIGINT;
  contract_project_id TEXT;
  contract_voided_at TIMESTAMPTZ;
  contract_version_status TEXT;
  contract_version_signing_subject_type TEXT;
  contract_version_company_id TEXT;
  contract_version_company_version_id TEXT;
  contract_version_effective_at TIMESTAMPTZ;
  contract_version_ended_at TIMESTAMPTZ;
  source_leg_source_type TEXT;
  source_leg_source_aggregate_id TEXT;
  source_leg_source_allocation_count INTEGER;
  source_leg_source_allocation_amount_cents BIGINT;
  source_leg_contract_id TEXT;
  source_leg_contract_version_id TEXT;
  authoritative_source_snapshot JSONB;
  leg_count BIGINT;
  source_leg_count BIGINT;
  beneficiary_leg_count BIGINT;
  missing_fact_count BIGINT;
  duplicate_fact_count BIGINT;
  confirmed_relationship_count BIGINT;
  relationship_count BIGINT;
  payable_case_count BIGINT;
  payable_case_id TEXT;
  payable_case_revision INTEGER;
  payable_allocation_count BIGINT;
  payable_allocation_amount BIGINT;
  payable_debtor_company_id TEXT;
  payable_invalid_count BIGINT;
  payable_settlement_overdrawn_count BIGINT;
  approval_instance_count BIGINT;
  approval_complete_count BIGINT;
  approval_action_count BIGINT;
  attestation_fingerprint TEXT;
  proxy_relationship_count BIGINT;
  funding_allocation_count BIGINT;
  funding_allocation_amount BIGINT;
  original_relationship RECORD;
  original_movement_status TEXT;
  consumed_adjustment_amount BIGINT;
  expected_relationship_kind TEXT;
  expected_relationship_direction TEXT;
  expected_original_kind TEXT;
BEGIN
  SELECT * INTO movement
  FROM "FundMovement"
  WHERE "id" = p_movement_id;
  IF NOT FOUND OR movement."status" IS DISTINCT FROM 'confirmed' THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE "role" = 'source')::BIGINT,
         COUNT(*) FILTER (WHERE "role" = 'beneficiary')::BIGINT,
         COUNT(*) FILTER (WHERE "operatingFactId" IS NULL)::BIGINT,
         (COUNT("operatingFactId") - COUNT(DISTINCT "operatingFactId"))::BIGINT
  INTO leg_count, source_leg_count, beneficiary_leg_count,
       missing_fact_count, duplicate_fact_count
  FROM "FundMovementLeg"
  WHERE "movementId" = p_movement_id;

  IF leg_count <> 2
     OR source_leg_count <> 1
     OR beneficiary_leg_count <> 1
     OR missing_fact_count > 0
     OR duplicate_fact_count > 0 THEN
    RAISE EXCEPTION 'fund_movement_confirmed_leg_operating_fact_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FundMovementLeg" leg
    INNER JOIN "OperatingFact" fact ON fact."id" = leg."operatingFactId"
    WHERE leg."movementId" = p_movement_id
      AND (
        fact."projectId" IS DISTINCT FROM leg."projectId"
        OR fact."factKind" IS DISTINCT FROM 'fund_movement'
        OR fact."sourceType" IS DISTINCT FROM 'fund_movement_leg'
        OR fact."sourceBusinessId" IS DISTINCT FROM leg."id"
      )
  ) THEN
    RAISE EXCEPTION 'fund_movement_operating_fact_scope_invalid';
  END IF;

  IF movement."kind" = 'profit_distribution_execution' THEN
    RAISE EXCEPTION 'fund_movement_profit_authorization_unavailable';
  END IF;

  IF movement."paymentExecutionId" IS NOT NULL
     AND movement."kind" <> 'cross_project_payment' THEN
    RAISE EXCEPTION 'fund_movement_payment_execution_scope_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FundMovementLeg" leg
    WHERE leg."movementId" = p_movement_id
      AND (
        leg."amountCents" IS DISTINCT FROM movement."paymentAmountCents"
        OR leg."paymentExecutionId" IS DISTINCT FROM movement."paymentExecutionId"
        OR (leg."role" = 'source' AND (
          leg."projectId" IS DISTINCT FROM movement."sourceProjectId"
          OR leg."companyEntityId" IS DISTINCT FROM movement."sourceCompanyEntityId"
        ))
        OR (leg."role" = 'beneficiary' AND (
          leg."projectId" IS DISTINCT FROM movement."beneficiaryProjectId"
          OR leg."companyEntityId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
        ))
        OR (leg."role" = 'source' AND (
          leg."projectFundUsedCents" IS DISTINCT FROM movement."projectFundUsedCents"
          OR leg."companyAdvanceCents" IS DISTINCT FROM movement."companyAdvanceCents"
        ))
        OR (
          movement."kind" IN ('temporary_project_fund_return', 'company_advance_recovery')
          AND (
            (leg."role" = 'source' AND leg."direction" <> 'increase')
            OR (leg."role" = 'beneficiary' AND leg."direction" <> 'decrease')
          )
        )
        OR (
          movement."kind" NOT IN ('temporary_project_fund_return', 'company_advance_recovery')
          AND (
            (leg."role" = 'source' AND leg."direction" <> 'decrease')
            OR (leg."role" = 'beneficiary' AND leg."direction" <> 'increase')
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'fund_movement_leg_lineage_invalid';
  END IF;

  IF movement."kind" = 'cross_project_payment' THEN
    IF movement."paymentExecutionId" IS NULL THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    SELECT execution."amountCents",
           execution."paymentRequestId",
           execution."settlementId",
           execution."companyEntityIdSnapshot",
           execution."payerAttestationFingerprint"
    INTO execution_amount, execution_payment_request_id, execution_settlement_id,
         execution_actual_payer_company_id, execution_payer_attestation_fingerprint
    FROM "PaymentExecution" execution
    WHERE execution."id" = movement."paymentExecutionId"
    FOR KEY SHARE;
    IF NOT FOUND OR execution_amount IS DISTINCT FROM movement."paymentAmountCents" THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    SELECT request."projectId",
           request."contractId",
           request."contractVersionId",
           request."settlementId",
           request."status",
           request."paymentSubjectType",
           request."abandonedAt",
           COALESCE(request."approvedAmountCents", request."requestedAmountCents"),
           request."paidAmountCents"
    INTO request_project_id, request_contract_id,
         request_contract_version_id, request_settlement_id,
         request_status, request_payment_subject_type, request_abandoned_at,
         request_approved_amount, request_paid_amount
    FROM "PaymentRequest" request
    WHERE request."id" = execution_payment_request_id
    FOR KEY SHARE;
    IF NOT FOUND
       OR request_project_id IS DISTINCT FROM movement."beneficiaryProjectId"
       OR request_settlement_id IS DISTINCT FROM execution_settlement_id
       OR request_payment_subject_type IS DISTINCT FROM 'our_company'
       OR request_status NOT IN ('approved_pending_payment', 'partially_paid', 'paid')
       OR request_abandoned_at IS NOT NULL
       OR request_approved_amount IS NULL
       OR request_approved_amount <= 0
       OR request_paid_amount IS NULL
       OR request_paid_amount < execution_amount
       OR request_paid_amount > request_approved_amount
       OR execution_amount > request_approved_amount - (request_paid_amount - execution_amount) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;

    -- The confirmed PaymentExecution must point at exactly one completed
    -- payment-request approval.  A status-only row is not an approval fact;
    -- the frozen node list, terminal index and an immutable approve action
    -- are all required before a movement can consume the payment.
    SELECT COUNT(*)::BIGINT,
           COUNT(*) FILTER (
             WHERE instance."status" = 'approved'
               AND jsonb_typeof(instance."frozenNodes") = 'array'
               AND jsonb_array_length(instance."frozenNodes") > 0
               AND instance."currentNodeIndex" >= jsonb_array_length(instance."frozenNodes")
           )::BIGINT
    INTO approval_instance_count, approval_complete_count
    FROM "ApprovalInstance" instance
    WHERE instance."businessType" = 'payment_request'
      AND instance."businessId" = execution_payment_request_id
      AND instance."flowType" = 'payment.approve'
      AND instance."status" = 'approved';
    SELECT COUNT(*)::BIGINT
    INTO approval_action_count
    FROM "ApprovalActionLog" action_log
    INNER JOIN "ApprovalInstance" instance
      ON instance."id" = action_log."approvalInstanceId"
    WHERE instance."businessType" = 'payment_request'
      AND instance."businessId" = execution_payment_request_id
      AND instance."flowType" = 'payment.approve'
      AND instance."status" = 'approved'
      AND action_log."action" = 'approve'
      AND NULLIF(btrim(COALESCE(action_log."actorUserId", '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(action_log."approvedRoleKey", '')), '') IS NOT NULL;
    IF approval_instance_count <> 1
       OR approval_complete_count <> 1
       OR approval_action_count = 0 THEN
      RAISE EXCEPTION 'fund_movement_payment_approval_lineage_invalid';
    END IF;

    SELECT contract."projectId", contract."voidedAt",
           version."status", version."signingSubjectType",
           version."companyEntityIdSnapshot", version."companyEntityVersionId",
           version."effectiveAt", version."endedAt"
    INTO contract_project_id, contract_voided_at,
         contract_version_status, contract_version_signing_subject_type,
         contract_version_company_id, contract_version_company_version_id,
         contract_version_effective_at, contract_version_ended_at
    FROM "Contract" contract
    INNER JOIN "ContractVersion" version
      ON version."id" = request_contract_version_id
     AND version."contractId" = request_contract_id
    WHERE contract."id" = request_contract_id
    FOR KEY SHARE;
    IF NOT FOUND
       OR contract_project_id IS DISTINCT FROM request_project_id
       OR contract_voided_at IS NOT NULL
       OR contract_version_status IS DISTINCT FROM 'effective'
       OR contract_version_signing_subject_type IS DISTINCT FROM 'our_company'
       OR NULLIF(btrim(COALESCE(contract_version_company_id, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(contract_version_company_version_id, '')), '') IS NULL
       OR (execution_payer_attestation_fingerprint IS NULL
           AND execution_actual_payer_company_id IS DISTINCT FROM contract_version_company_id)
       OR contract_version_effective_at IS NULL
       OR contract_version_effective_at > (SELECT "paidAt" FROM "PaymentExecution" WHERE "id" = movement."paymentExecutionId")
       OR (contract_version_ended_at IS NOT NULL AND contract_version_ended_at <= (SELECT "paidAt" FROM "PaymentExecution" WHERE "id" = movement."paymentExecutionId")) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    SELECT source_leg."sourceType",
           source_leg."sourceAggregateId",
           source_leg."sourceAllocationCount",
           source_leg."sourceAllocationAmountCents",
           source_leg."contractId",
           source_leg."contractVersionId"
    INTO source_leg_source_type, source_leg_source_aggregate_id,
         source_leg_source_allocation_count,
         source_leg_source_allocation_amount_cents, source_leg_contract_id,
         source_leg_contract_version_id
    FROM "FundMovementLeg" source_leg
    WHERE source_leg."movementId" = p_movement_id
      AND source_leg."role" = 'source'
    FOR KEY SHARE;
    IF NOT FOUND
       OR request_contract_id IS DISTINCT FROM source_leg_contract_id
       OR request_contract_version_id IS DISTINCT FROM source_leg_contract_version_id THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "FundMovementLeg" leg
      WHERE leg."movementId" = p_movement_id
        AND (
          (leg."role" = 'source' AND leg."projectId" IS DISTINCT FROM movement."sourceProjectId")
          OR (leg."role" = 'beneficiary' AND leg."projectId" IS DISTINCT FROM movement."beneficiaryProjectId")
          OR leg."sourceType" IS NULL
          OR leg."sourceAggregateId" IS NULL
          OR leg."sourceAllocationCount" IS NULL
          OR leg."sourceAllocationCount" <= 0
              OR leg."sourceAllocationAmountCents" IS DISTINCT FROM leg."amountCents"
              OR leg."sourceType" IS DISTINCT FROM source_leg_source_type
              OR leg."sourceAggregateId" IS DISTINCT FROM source_leg_source_aggregate_id
              OR leg."sourceAllocationCount" IS DISTINCT FROM source_leg_source_allocation_count
              OR leg."sourceAllocationAmountCents" IS DISTINCT FROM source_leg_source_allocation_amount_cents
              OR leg."contractId" IS NULL
              OR leg."contractVersionId" IS NULL
              OR leg."contractId" IS DISTINCT FROM source_leg_contract_id
              OR leg."contractVersionId" IS DISTINCT FROM source_leg_contract_version_id
            )
    ) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;

    -- The authoritative source snapshot is projected once by the server
    -- confirm command while the parent is submitted.  All two legs and the
    -- relationship must carry that exact immutable projection before the
    -- parent may become confirmed; a draft snapshot can never be promoted by
    -- direct SQL alone.
    SELECT source_leg."sourceSnapshot"
    INTO authoritative_source_snapshot
    FROM "FundMovementLeg" source_leg
    WHERE source_leg."movementId" = p_movement_id
      AND source_leg."role" = 'source'
    LIMIT 1;
    IF authoritative_source_snapshot->>'authority' IS DISTINCT FROM 'payment_execution_source'
       OR authoritative_source_snapshot->>'paymentExecutionId' IS DISTINCT FROM movement."paymentExecutionId"
       OR EXISTS (
         SELECT 1
         FROM "FundMovementLeg" leg
         WHERE leg."movementId" = p_movement_id
           AND leg."sourceSnapshot" IS DISTINCT FROM authoritative_source_snapshot
       )
       OR EXISTS (
         SELECT 1
         FROM "FundMovementRelationshipEntry" relationship
         WHERE relationship."movementId" = p_movement_id
           AND relationship."sourceSnapshot" IS DISTINCT FROM authoritative_source_snapshot
       ) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_snapshot_projection_invalid';
    END IF;

    -- A confirmed payment movement must consume the already-confirmed,
    -- append-only payable settlement case.  The database repeats the scope
    -- checks so direct SQL cannot bypass the application transaction.
    SELECT COUNT(*)::BIGINT
    INTO payable_case_count
    FROM "PayableSettlementCase"
    WHERE "paymentExecutionId" = movement."paymentExecutionId"
      AND "status" = 'confirmed';
    IF payable_case_count <> 1 THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    SELECT "id", "revision"
    INTO payable_case_id, payable_case_revision
    FROM "PayableSettlementCase"
    WHERE "paymentExecutionId" = movement."paymentExecutionId"
      AND "status" = 'confirmed'
    ORDER BY "revision" DESC, "id" DESC
    LIMIT 1
    FOR KEY SHARE;
    SELECT COUNT(*)::BIGINT,
           COALESCE(SUM(allocation."amountCents"), 0),
           COUNT(*) FILTER (WHERE
             allocation."paymentExecutionId" IS DISTINCT FROM movement."paymentExecutionId"
             OR allocation."beneficiaryProjectId" IS DISTINCT FROM movement."beneficiaryProjectId"
             OR allocation."debtorCompanyId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
             OR allocation."currencyCode" IS DISTINCT FROM 'CNY'
             OR NULLIF(btrim(allocation."payableRef"), '') IS NULL
             OR NULLIF(btrim(allocation."sourceType"), '') IS NULL
             OR NULLIF(btrim(allocation."sourceAggregateId"), '') IS NULL
             OR NULLIF(btrim(allocation."sourceLineId"), '') IS NULL
             OR NULLIF(btrim(allocation."confirmedVersionId"), '') IS NULL
             OR allocation."amountCents" <= 0
             OR allocation."confirmedAmountCents" < allocation."amountCents")::BIGINT
    INTO payable_allocation_count, payable_allocation_amount, payable_invalid_count
    FROM "PayableSettlementAllocation" allocation
    WHERE allocation."settlementCaseId" = payable_case_id;
    IF payable_allocation_count = 0
       OR payable_allocation_amount IS DISTINCT FROM movement."paymentAmountCents"
       OR payable_invalid_count > 0 THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "PayableSettlementAllocation" allocation
      LEFT JOIN "WagePayableRef" payable
        ON payable."id" = allocation."payableRef"
      LEFT JOIN "WageCreditorBreakdown" breakdown
        ON breakdown."id" = payable."creditorBreakdownId"
      LEFT JOIN "WageStatementVersion" version
        ON version."id" = payable."confirmedVersionId"
      WHERE allocation."settlementCaseId" = payable_case_id
        AND (
          payable."id" IS NULL
          OR breakdown."id" IS NULL
          OR version."status" IS DISTINCT FROM 'confirmed'
          OR allocation."sourceType" IS DISTINCT FROM 'wage_payable_ref'
          OR allocation."sourceAggregateId" IS DISTINCT FROM payable."confirmedVersionId"
          OR allocation."sourceLineId" IS DISTINCT FROM payable."id"
          OR allocation."confirmedVersionId" IS DISTINCT FROM payable."confirmedVersionId"
          OR payable."projectId" IS DISTINCT FROM movement."beneficiaryProjectId"
          OR payable."debtorCompanyId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
          OR payable."confirmedVersionId" IS DISTINCT FROM allocation."confirmedVersionId"
          OR payable."direction" IS DISTINCT FROM 'increase'
          OR payable."adjustsPayableRefId" IS NOT NULL
          OR allocation."payeeSubjectType" IS DISTINCT FROM breakdown."creditorSubjectType"
          OR allocation."payeeSubjectId" IS DISTINCT FROM breakdown."creditorSubjectIdentityKey"
          OR allocation."beneficiaryProjectId" IS DISTINCT FROM payable."projectId"
          OR allocation."debtorCompanyId" IS DISTINCT FROM payable."debtorCompanyId"
          OR allocation."confirmedAmountCents" IS DISTINCT FROM payable."amountCents"
          OR payable."amountCents" < allocation."amountCents"
        )
    ) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;

    -- The immutable wage binding is the many-to-many creditor proof for the
    -- execution.  Repeat its frozen subject, project, debtor and snapshot
    -- coordinates here so a direct SQL confirmer cannot replace a wage
    -- creditor with a different ref or silently loosen the binding amount.
    IF EXISTS (
      SELECT 1
      FROM "PayableSettlementAllocation" allocation
      LEFT JOIN "WagePayableRef" payable
        ON payable."id" = allocation."payableRef"
      LEFT JOIN "WageCreditorBreakdown" breakdown
        ON breakdown."id" = payable."creditorBreakdownId"
      LEFT JOIN "PaymentExecutionWagePayableBinding" binding
        ON binding."paymentExecutionId" = movement."paymentExecutionId"
       AND binding."wagePayableRefId" = allocation."payableRef"
      WHERE allocation."settlementCaseId" = payable_case_id
        AND (
          binding."id" IS NULL
          OR binding."debtorCompanyId" IS DISTINCT FROM allocation."debtorCompanyId"
          OR binding."debtorCompanySnapshot" IS DISTINCT FROM payable."debtorCompanySnapshot"
          OR binding."projectId" IS DISTINCT FROM allocation."beneficiaryProjectId"
          OR binding."projectSnapshot" IS DISTINCT FROM payable."projectSnapshot"
          OR binding."creditorSubjectType" IS DISTINCT FROM breakdown."creditorSubjectType"
          OR binding."creditorUserId" IS DISTINCT FROM breakdown."creditorUserId"
          OR binding."creditorBusinessPartyVersionId" IS DISTINCT FROM breakdown."creditorBusinessPartyVersionId"
          OR binding."creditorSubjectIdentityKey" IS DISTINCT FROM breakdown."creditorSubjectIdentityKey"
          OR binding."creditorNameSnapshot" IS DISTINCT FROM breakdown."creditorNameSnapshot"
          OR binding."creditorUnifiedIdentitySnapshot" IS DISTINCT FROM breakdown."creditorUnifiedIdentitySnapshot"
          OR binding."creditorVersionFingerprint" IS DISTINCT FROM breakdown."creditorVersionFingerprint"
          OR binding."creditorSnapshot" IS DISTINCT FROM payable."creditorSnapshot"
          OR binding."currencyCode" IS DISTINCT FROM allocation."currencyCode"
          OR binding."amountCents" < allocation."amountCents"
        )
    ) THEN
      RAISE EXCEPTION 'fund_movement_wage_binding_lineage_invalid';
    END IF;

    -- Every confirmed allocation for each immutable ref participates in the
    -- same effective-balance calculation used by the application.  This is
    -- the database-side fail-closed check against a second direct confirmer
    -- racing or bypassing the payable service; it never creates a negative
    -- payable or changes the PaymentExecution fact.
    WITH effective_payables AS (
      SELECT ref."id",
             ref."amountCents" + COALESCE(SUM(
               CASE adjustment."direction"
                 WHEN 'increase' THEN adjustment."amountCents"
                 WHEN 'decrease' THEN -adjustment."amountCents"
                 ELSE 0
               END
             ), 0) AS effective_amount_cents
      FROM "WagePayableRef" ref
      LEFT JOIN "WagePayableRef" adjustment
        ON adjustment."adjustsPayableRefId" = ref."id"
      WHERE ref."direction" = 'increase'
        AND ref."adjustsPayableRefId" IS NULL
      GROUP BY ref."id", ref."amountCents"
    ), settled_payables AS (
      SELECT allocation."payableRef",
             SUM(allocation."amountCents") AS settled_amount_cents
      FROM "PayableSettlementAllocation" allocation
      INNER JOIN "PayableSettlementCase" settlement_case
        ON settlement_case."id" = allocation."settlementCaseId"
      WHERE settlement_case."status" = 'confirmed'
      GROUP BY allocation."payableRef"
    )
    SELECT COUNT(*)::BIGINT
    INTO payable_settlement_overdrawn_count
    FROM settled_payables settled
    INNER JOIN effective_payables effective
      ON effective."id" = settled."payableRef"
    WHERE settled.settled_amount_cents > effective.effective_amount_cents;
    IF payable_settlement_overdrawn_count > 0 THEN
      RAISE EXCEPTION 'fund_movement_payable_balance_invalid';
    END IF;

    -- If the bank account holder differs from the wage debtor, #221's
    -- confirmed proxy-payment relation is the only accepted cross-company
    -- authority.  The relation itself remains append-only and auditable.
    IF execution_payer_attestation_fingerprint IS NOT NULL THEN
      SELECT attestation."holderCompanyEntityId",
             encode(
               public.digest(
                 CASE
                   WHEN attestation."proxyAuthorizationReason" IS NULL THEN
                     '{"bankAccountReference":' || to_json(attestation."bankAccountReference")::TEXT ||
                     ',"authorization":null}'
                   ELSE
                     '{"bankAccountReference":' || to_json(attestation."bankAccountReference")::TEXT ||
                     ',"authorization":{"reason":' || to_json(attestation."proxyAuthorizationReason")::TEXT ||
                     ',"evidenceFileId":' || to_json(attestation."proxyAuthorizationEvidenceFileId")::TEXT ||
                     ',"reauthorizationReference":' || to_json(attestation."reauthorizationReference")::TEXT ||
                     ',"reauthorizedByUserId":' || to_json(attestation."reauthorizedByUserId")::TEXT ||
                     ',"reauthorizedAt":' || to_json(to_char(
                       attestation."reauthorizedAt" AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                     ))::TEXT || '}'
                 END,
                 'sha256'
               ),
               'hex'
             )
      INTO execution_actual_payer_company_id, attestation_fingerprint
      FROM "PaymentExecutionPayerAttestation" attestation
      WHERE attestation."paymentExecutionId" = movement."paymentExecutionId"
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
      END IF;
      IF attestation_fingerprint IS DISTINCT FROM execution_payer_attestation_fingerprint THEN
        RAISE EXCEPTION 'fund_movement_payer_attestation_fingerprint_invalid';
      END IF;
    END IF;
    SELECT MIN(allocation."debtorCompanyId")
    INTO payable_debtor_company_id
    FROM "PayableSettlementAllocation" allocation
    WHERE allocation."settlementCaseId" = payable_case_id;
    IF execution_actual_payer_company_id IS DISTINCT FROM payable_debtor_company_id THEN
      SELECT COUNT(*)::BIGINT
      INTO proxy_relationship_count
      FROM "InterEntityRelationshipEntry" proxy
      WHERE proxy."paymentExecutionId" = movement."paymentExecutionId"
        AND proxy."settlementCaseId" = payable_case_id
        AND proxy."entryKind" = 'proxy_payment'
        AND proxy."direction" = 'increase'
        AND proxy."status" = 'confirmed'
        AND proxy."originalDebtorCompanyId" = payable_debtor_company_id
        AND proxy."creditorCompanyId" = execution_actual_payer_company_id
        AND proxy."approvedPayerCompanyId" = contract_version_company_id
        AND proxy."projectId" = movement."beneficiaryProjectId"
        AND proxy."contractId" = request_contract_id
        AND proxy."contractVersionId" = request_contract_version_id
        AND proxy."sourceType" = 'wage_payable_ref'
        AND proxy."amountCents" = movement."paymentAmountCents"
        AND proxy."sourceAllocationCount" = payable_allocation_count
        AND proxy."sourceAllocationAmountCents" = payable_allocation_amount;
      IF proxy_relationship_count <> 1 THEN
        RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
      END IF;
    END IF;

    IF movement."projectFundUsedCents" > 0
       AND movement."kind" IN ('cross_project_payment', 'temporary_project_fund_use', 'company_advance_recovery') THEN
      SELECT COUNT(*)::BIGINT, COALESCE(SUM("amountCents"), 0)
      INTO funding_allocation_count, funding_allocation_amount
      FROM "ProjectFundingAllocation"
      WHERE "projectId" = movement."sourceProjectId"
        AND "executionType" = 'fund_movement'
        AND "executionId" = movement."id"
        AND "direction" = 'debit';
      IF funding_allocation_count = 0
         OR funding_allocation_amount IS DISTINCT FROM movement."projectFundUsedCents" THEN
        RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
      END IF;
    END IF;

    SELECT COUNT(*)::BIGINT,
           COUNT(*) FILTER (WHERE "status" = 'confirmed')::BIGINT
    INTO relationship_count, confirmed_relationship_count
    FROM "FundMovementRelationshipEntry"
    WHERE "movementId" = p_movement_id;
    IF relationship_count <> 1
       OR confirmed_relationship_count <> relationship_count
       OR EXISTS (
         SELECT 1
         FROM "FundMovementRelationshipEntry" relationship
         WHERE relationship."movementId" = p_movement_id
           AND (
             relationship."legId" IS DISTINCT FROM (
             SELECT source_leg."id"
               FROM "FundMovementLeg" source_leg
               WHERE source_leg."movementId" = p_movement_id
                 AND source_leg."role" = 'source'
             )
             OR (
               SELECT source_leg."relationshipEntryId"
               FROM "FundMovementLeg" source_leg
               WHERE source_leg."movementId" = p_movement_id
                 AND source_leg."role" = 'source'
             ) IS DISTINCT FROM relationship."id"
             OR relationship."sourceProjectId" IS DISTINCT FROM movement."sourceProjectId"
             OR relationship."beneficiaryProjectId" IS DISTINCT FROM movement."beneficiaryProjectId"
             OR relationship."entryKind" IS DISTINCT FROM 'project_internal_receivable'
             OR relationship."direction" IS DISTINCT FROM 'increase'
             OR relationship."adjustsEntryId" IS NOT NULL
             OR relationship."debtorCompanyEntityId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
             OR relationship."creditorCompanyEntityId" IS DISTINCT FROM movement."sourceCompanyEntityId"
             OR relationship."amountCents" IS DISTINCT FROM movement."paymentAmountCents"
             OR relationship."sourceType" IS NULL
             OR relationship."sourceAggregateId" IS NULL
             OR relationship."sourceAllocationCount" IS NULL
             OR relationship."sourceAllocationAmountCents" IS DISTINCT FROM relationship."amountCents"
             OR relationship."contractId" IS NULL
             OR relationship."contractVersionId" IS NULL
           )
       )
       OR EXISTS (
         SELECT 1
         FROM "FundMovementRelationshipEntry" relationship
         INNER JOIN "FundMovementLeg" source_leg
           ON source_leg."id" = relationship."legId"
          AND source_leg."movementId" = p_movement_id
          AND source_leg."role" = 'source'
         WHERE relationship."movementId" = p_movement_id
           AND (
             relationship."sourceType" IS DISTINCT FROM source_leg."sourceType"
             OR relationship."sourceAggregateId" IS DISTINCT FROM source_leg."sourceAggregateId"
             OR relationship."sourceAllocationCount" IS DISTINCT FROM source_leg."sourceAllocationCount"
             OR relationship."sourceAllocationAmountCents" IS DISTINCT FROM source_leg."sourceAllocationAmountCents"
             OR relationship."contractId" IS DISTINCT FROM source_leg."contractId"
             OR relationship."contractVersionId" IS DISTINCT FROM source_leg."contractVersionId"
           )
       ) THEN
      RAISE EXCEPTION 'fund_movement_cross_project_lineage_invalid';
    END IF;
  ELSIF movement."kind" = 'same_project_company_transfer' THEN
    IF EXISTS (
      SELECT 1
      FROM "FundMovementRelationshipEntry" relationship
      WHERE relationship."movementId" = p_movement_id
    ) THEN
      RAISE EXCEPTION 'fund_movement_same_project_lineage_invalid';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "FundMovementLeg" leg
      WHERE leg."movementId" = p_movement_id
        AND leg."projectId" IS DISTINCT FROM movement."sourceProjectId"
      ) THEN
      RAISE EXCEPTION 'fund_movement_project_scope_invalid';
    END IF;

    SELECT COUNT(*)::BIGINT,
           COUNT(*) FILTER (WHERE "status" = 'confirmed')::BIGINT
    INTO relationship_count, confirmed_relationship_count
    FROM "FundMovementRelationshipEntry"
    WHERE "movementId" = p_movement_id;
    IF relationship_count <> 1
       OR confirmed_relationship_count <> 1 THEN
      RAISE EXCEPTION 'fund_movement_relationship_lineage_invalid';
    END IF;
    expected_relationship_kind := CASE movement."kind"
      WHEN 'temporary_project_fund_use' THEN 'temporary_project_fund_use'
      WHEN 'temporary_project_fund_return' THEN 'temporary_project_fund_return'
      WHEN 'company_advance' THEN 'company_advance'
      WHEN 'company_advance_recovery' THEN 'company_advance_recovery'
      ELSE NULL
    END;
    expected_relationship_direction := CASE
      WHEN movement."kind" IN ('temporary_project_fund_return', 'company_advance_recovery') THEN 'decrease'
      ELSE 'increase'
    END;
    IF EXISTS (
      SELECT 1
      FROM "FundMovementRelationshipEntry" relationship
      WHERE relationship."movementId" = p_movement_id
        AND (
          relationship."legId" IS DISTINCT FROM (
            SELECT source_leg."id"
            FROM "FundMovementLeg" source_leg
            WHERE source_leg."movementId" = p_movement_id
              AND source_leg."role" = 'source'
          )
          OR (
            SELECT source_leg."relationshipEntryId"
            FROM "FundMovementLeg" source_leg
            WHERE source_leg."movementId" = p_movement_id
              AND source_leg."role" = 'source'
          ) IS DISTINCT FROM relationship."id"
          OR relationship."sourceProjectId" IS DISTINCT FROM movement."sourceProjectId"
          OR relationship."beneficiaryProjectId" IS DISTINCT FROM movement."beneficiaryProjectId"
          OR relationship."debtorCompanyEntityId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
          OR relationship."creditorCompanyEntityId" IS DISTINCT FROM movement."sourceCompanyEntityId"
          OR relationship."amountCents" IS DISTINCT FROM movement."paymentAmountCents"
          OR relationship."entryKind" IS DISTINCT FROM expected_relationship_kind
          OR relationship."direction" IS DISTINCT FROM expected_relationship_direction
          OR ((movement."kind" IN ('temporary_project_fund_return', 'company_advance_recovery'))
              AND relationship."adjustsEntryId" IS NULL)
          OR ((movement."kind" IN ('temporary_project_fund_use', 'company_advance'))
              AND relationship."adjustsEntryId" IS NOT NULL)
        )
    ) THEN
      RAISE EXCEPTION 'fund_movement_relationship_lineage_invalid';
    END IF;

    IF movement."kind" IN ('temporary_project_fund_return', 'company_advance_recovery') THEN
      expected_original_kind := CASE
        WHEN movement."kind" = 'temporary_project_fund_return' THEN 'temporary_project_fund_use'
        ELSE 'company_advance'
      END;
      SELECT original.*
      INTO original_relationship
      FROM "FundMovementRelationshipEntry" relationship
          INNER JOIN "FundMovementRelationshipEntry" original
            ON original."id" = relationship."adjustsEntryId"
          WHERE relationship."movementId" = p_movement_id
          ORDER BY original."id"
          FOR UPDATE;
      IF NOT FOUND
         OR original_relationship."status" IS DISTINCT FROM 'confirmed'
         OR original_relationship."direction" IS DISTINCT FROM 'increase'
         OR original_relationship."sourceProjectId" IS DISTINCT FROM movement."sourceProjectId"
         OR original_relationship."beneficiaryProjectId" IS DISTINCT FROM movement."beneficiaryProjectId"
         OR original_relationship."debtorCompanyEntityId" IS DISTINCT FROM movement."beneficiaryCompanyEntityId"
         OR original_relationship."creditorCompanyEntityId" IS DISTINCT FROM movement."sourceCompanyEntityId"
         OR original_relationship."entryKind" IS DISTINCT FROM expected_original_kind
      THEN
        RAISE EXCEPTION 'fund_movement_adjustment_lineage_invalid';
      END IF;
      SELECT source_movement."status"
      INTO original_movement_status
      FROM "FundMovement" source_movement
      WHERE source_movement."id" = original_relationship."movementId";
      IF original_movement_status IS DISTINCT FROM 'confirmed' THEN
        RAISE EXCEPTION 'fund_movement_adjustment_lineage_invalid';
      END IF;
      PERFORM 1
      FROM "FundMovementRelationshipEntry" adjustment
      WHERE adjustment."adjustsEntryId" = original_relationship."id"
        AND adjustment."status" = 'confirmed'
        AND adjustment."direction" = 'decrease'
      ORDER BY adjustment."id"
      FOR UPDATE;
      SELECT COALESCE(SUM(adjustment."amountCents"), 0)
      INTO consumed_adjustment_amount
      FROM "FundMovementRelationshipEntry" adjustment
      WHERE adjustment."adjustsEntryId" = original_relationship."id"
        AND adjustment."status" = 'confirmed'
        AND adjustment."direction" = 'decrease';
      IF consumed_adjustment_amount > original_relationship."amountCents" THEN
        RAISE EXCEPTION 'fund_movement_adjustment_overdrawn';
      END IF;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION assert_fund_movement_snapshot_projection_confirmed(p_movement_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FundMovement" movement
    WHERE movement."id" = p_movement_id
      AND movement."status" = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'fund_movement_snapshot_projection_requires_confirmation';
  END IF;
END;
$$;

CREATE FUNCTION guard_fund_movement_lineage_deferred()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND TG_TABLE_NAME IN ('FundMovementLeg', 'FundMovementRelationshipEntry') THEN
    IF OLD."sourceSnapshot" IS DISTINCT FROM NEW."sourceSnapshot"
       AND OLD."sourceSnapshot"->>'authority' = 'fund_movement_draft'
       AND OLD."sourceSnapshot"->>'status' = 'pending_server_resolution'
       AND NEW."sourceSnapshot"->>'authority' = 'payment_execution_source' THEN
      PERFORM assert_fund_movement_snapshot_projection_confirmed(NEW."movementId");
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_fund_movement_lineage(OLD."id");
  ELSIF TG_TABLE_NAME = 'FundMovement' THEN
    PERFORM assert_fund_movement_lineage(NEW."id");
  ELSE
    PERFORM assert_fund_movement_lineage(NEW."movementId");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FundMovement_confirmed_lineage_guard"
AFTER INSERT OR UPDATE ON "FundMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_lineage_deferred();

CREATE CONSTRAINT TRIGGER "FundMovementLeg_confirmed_lineage_guard"
AFTER INSERT OR UPDATE ON "FundMovementLeg"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_lineage_deferred();

CREATE CONSTRAINT TRIGGER "FundMovementRelationshipEntry_confirmed_lineage_guard"
AFTER INSERT OR UPDATE ON "FundMovementRelationshipEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guard_fund_movement_lineage_deferred();

COMMIT;
