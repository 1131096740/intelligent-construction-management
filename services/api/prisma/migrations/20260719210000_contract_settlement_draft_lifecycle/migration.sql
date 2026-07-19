-- M70: add auditable abandonment facts without rewriting existing business rows.
BEGIN;

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"ContractVersion"'::regclass
    AND conname = 'ContractVersion_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''voided''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractVersion_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"ContractTakeover"'::regclass
    AND conname = 'ContractTakeover_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''confirmed''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractTakeover_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"ContractTaxFactRevision"'::regclass
    AND conname = 'ContractTaxFactRevision_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''confirmed''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractTaxFactRevision_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"SettlementDraft"'::regclass
    AND conname = 'SettlementDraft_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''submitted''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SettlementDraft_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"SettlementDraft"'::regclass
    AND conname = 'SettlementDraft_submission_state_check'
    AND contype = 'c';
  IF definition IS NULL OR position('"submittedSettlementId"' IN definition) = 0 OR position('"submittedAt"' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SettlementDraft_submission_state_check definition';
  END IF;
END $$;

ALTER TABLE "ContractVersion" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "ContractVersion" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "ContractVersion" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "ContractTakeover" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "ContractTakeover" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "ContractTakeover" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "ContractTaxFactRevision" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "ContractTaxFactRevision" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "ContractTaxFactRevision" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "SettlementDraft" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "SettlementDraft" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "SettlementDraft" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "ContractVersion" DROP CONSTRAINT "ContractVersion_status_check";
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_status_check"
  CHECK (
    "status" IN (
      'draft',
      'in_approval',
      'approval_rejected',
      'approved_pending_seal',
      'in_seal',
      'seal_approved_pending_archive',
      'pending_archive_confirm',
      'effective',
      'superseded',
      'voided',
      'abandoned'
    )
  ) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "ContractTakeover" DROP CONSTRAINT "ContractTakeover_status_check";
ALTER TABLE "ContractTakeover"
  ADD CONSTRAINT "ContractTakeover_status_check"
  CHECK ("takeoverStatus" IN ('draft', 'pending_review', 'confirmed', 'needs_supplement', 'voided', 'abandoned')) NOT VALID;
ALTER TABLE "ContractTakeover"
  ADD CONSTRAINT "ContractTakeover_abandonment_facts_check"
  CHECK (
    ("takeoverStatus" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("takeoverStatus" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "ContractTaxFactRevision" DROP CONSTRAINT "ContractTaxFactRevision_status_check";
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_status_check"
  CHECK (
    "status" IN (
      'draft',
      'pending_finance_review',
      'pending_contract_confirmation',
      'confirmed',
      'rejected',
      'abandoned'
    )
  ) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "SettlementDraft" DROP CONSTRAINT "SettlementDraft_status_check";
ALTER TABLE "SettlementDraft" DROP CONSTRAINT "SettlementDraft_submission_state_check";
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'abandoned')) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_submission_state_check"
  CHECK (
    (
      "status" IN ('draft', 'abandoned')
      AND "submittedSettlementId" IS NULL
      AND "submittedAt" IS NULL
    )
    OR
    (
      "status" = 'submitted'
      AND "submittedSettlementId" IS NOT NULL
      AND "submittedAt" IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ContractVersion_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractVersion_status_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ContractTakeover_takeoverStatus_updatedAt_idx';
  IF definition IS NOT NULL AND position('("takeoverStatus", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractTakeover_takeoverStatus_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ContractTaxFactRevision_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractTaxFactRevision_status_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'SettlementDraft_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SettlementDraft_status_updatedAt_idx definition';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ContractVersion_status_updatedAt_idx" ON "ContractVersion"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "ContractTakeover_takeoverStatus_updatedAt_idx" ON "ContractTakeover"("takeoverStatus", "updatedAt");
CREATE INDEX IF NOT EXISTS "ContractTaxFactRevision_status_updatedAt_idx" ON "ContractTaxFactRevision"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "SettlementDraft_status_updatedAt_idx" ON "SettlementDraft"("status", "updatedAt");

COMMIT;
