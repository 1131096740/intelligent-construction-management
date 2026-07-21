-- M72: add auditable draft-discard facts to template versions without changing published snapshots.
BEGIN;

DO $$
DECLARE
  definition TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"ContractBusinessTemplateVersion"'::regclass
      AND conname = 'ContractBusinessTemplateVersion_status_check'
  ) THEN
    RAISE EXCEPTION 'unexpected ContractBusinessTemplateVersion_status_check definition';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"StandardClauseVersion"'::regclass
      AND conname = 'StandardClauseVersion_status_check'
  ) THEN
    RAISE EXCEPTION 'unexpected StandardClauseVersion_status_check definition';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"ContractLayoutTemplateVersion"'::regclass
      AND conname = 'ContractLayoutTemplateVersion_status_check'
  ) THEN
    RAISE EXCEPTION 'unexpected ContractLayoutTemplateVersion_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"SettlementTemplateVersion"'::regclass
    AND conname = 'SettlementTemplateVersion_status_check'
    AND contype = 'c';
  IF definition IS NULL
    OR position('''draft''' IN definition) = 0
    OR position('''submitted''' IN definition) = 0
    OR position('''published''' IN definition) = 0
    OR position('''stopped''' IN definition) = 0
  THEN
    RAISE EXCEPTION 'unexpected SettlementTemplateVersion_status_check definition';
  END IF;

  SELECT indexdef INTO definition
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'SettlementTemplateVersion_status_publishedAt_idx';
  IF definition IS NULL OR position('(status, "publishedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SettlementTemplateVersion_status_publishedAt_idx definition';
  END IF;

  SELECT indexdef INTO definition
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND indexname = 'SettlementTemplateVersion_one_published_per_template_key';
  IF definition IS NULL
    OR position('("settlementTemplateId")' IN definition) = 0
    OR position('WHERE' IN definition) = 0
    OR position('''published''' IN definition) = 0
  THEN
    RAISE EXCEPTION 'unexpected SettlementTemplateVersion_one_published_per_template_key definition';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ContractBusinessTemplateVersion"
    WHERE "status" NOT IN ('draft', 'submitted', 'published', 'stopped', 'revoked')
  ) THEN
    RAISE EXCEPTION 'unexpected ContractBusinessTemplateVersion status value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "StandardClauseVersion"
    WHERE "status" NOT IN ('draft', 'submitted', 'published')
  ) THEN
    RAISE EXCEPTION 'unexpected StandardClauseVersion status value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ContractLayoutTemplateVersion"
    WHERE "status" NOT IN ('draft', 'submitted', 'published', 'stopped', 'revoked')
  ) THEN
    RAISE EXCEPTION 'unexpected ContractLayoutTemplateVersion status value';
  END IF;
END $$;

ALTER TABLE "ContractBusinessTemplateVersion" ADD COLUMN "discardedAt" TIMESTAMP(3);
ALTER TABLE "ContractBusinessTemplateVersion" ADD COLUMN "discardedByUserId" TEXT;
ALTER TABLE "ContractBusinessTemplateVersion" ADD COLUMN "discardReason" TEXT;

ALTER TABLE "StandardClauseVersion" ADD COLUMN "discardedAt" TIMESTAMP(3);
ALTER TABLE "StandardClauseVersion" ADD COLUMN "discardedByUserId" TEXT;
ALTER TABLE "StandardClauseVersion" ADD COLUMN "discardReason" TEXT;

ALTER TABLE "ContractLayoutTemplateVersion" ADD COLUMN "discardedAt" TIMESTAMP(3);
ALTER TABLE "ContractLayoutTemplateVersion" ADD COLUMN "discardedByUserId" TEXT;
ALTER TABLE "ContractLayoutTemplateVersion" ADD COLUMN "discardReason" TEXT;

ALTER TABLE "SettlementTemplateVersion" ADD COLUMN "discardedAt" TIMESTAMP(3);
ALTER TABLE "SettlementTemplateVersion" ADD COLUMN "discardedByUserId" TEXT;
ALTER TABLE "SettlementTemplateVersion" ADD COLUMN "discardReason" TEXT;

ALTER TABLE "ContractBusinessTemplateVersion"
  ADD CONSTRAINT "ContractBusinessTemplateVersion_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'published', 'stopped', 'revoked', 'discarded')) NOT VALID;
ALTER TABLE "ContractBusinessTemplateVersion"
  ADD CONSTRAINT "ContractBusinessTemplateVersion_discard_facts_check"
  CHECK (
    ("status" = 'discarded' AND "discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL)
    OR
    ("status" <> 'discarded' AND "discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "StandardClauseVersion"
  ADD CONSTRAINT "StandardClauseVersion_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'published', 'discarded')) NOT VALID;
ALTER TABLE "StandardClauseVersion"
  ADD CONSTRAINT "StandardClauseVersion_discard_facts_check"
  CHECK (
    ("status" = 'discarded' AND "discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL)
    OR
    ("status" <> 'discarded' AND "discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "ContractLayoutTemplateVersion"
  ADD CONSTRAINT "ContractLayoutTemplateVersion_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'published', 'stopped', 'revoked', 'discarded')) NOT VALID;
ALTER TABLE "ContractLayoutTemplateVersion"
  ADD CONSTRAINT "ContractLayoutTemplateVersion_discard_facts_check"
  CHECK (
    ("status" = 'discarded' AND "discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL)
    OR
    ("status" <> 'discarded' AND "discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "SettlementTemplateVersion" DROP CONSTRAINT "SettlementTemplateVersion_status_check";
ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'published', 'stopped', 'discarded')) NOT VALID;
ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_discard_facts_check"
  CHECK (
    ("status" = 'discarded' AND "discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL)
    OR
    ("status" <> 'discarded' AND "discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardReason" IS NULL)
  ) NOT VALID;

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ContractBusinessTemplateVersion_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractBusinessTemplateVersion_status_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'StandardClauseVersion_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected StandardClauseVersion_status_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ContractLayoutTemplateVersion_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractLayoutTemplateVersion_status_updatedAt_idx definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'SettlementTemplateVersion_status_updatedAt_idx';
  IF definition IS NOT NULL AND position('("status", "updatedAt")' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SettlementTemplateVersion_status_updatedAt_idx definition';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ContractBusinessTemplateVersion_status_updatedAt_idx"
  ON "ContractBusinessTemplateVersion"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "StandardClauseVersion_status_updatedAt_idx"
  ON "StandardClauseVersion"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "ContractLayoutTemplateVersion_status_updatedAt_idx"
  ON "ContractLayoutTemplateVersion"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "SettlementTemplateVersion_status_updatedAt_idx"
  ON "SettlementTemplateVersion"("status", "updatedAt");

COMMIT;
