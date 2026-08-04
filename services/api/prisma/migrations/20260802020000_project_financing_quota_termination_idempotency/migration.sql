-- Add durable, quota-owned termination idempotency facts without fabricating
-- action coordinates for historical terminated quotas.
BEGIN;

DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 14) THEN
    RAISE EXCEPTION
      'project_financing_quota_termination_migration_requires_quiescence'
      USING ERRCODE = '55P03';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    LOCK TABLE "ProjectFinancingQuota" IN ACCESS EXCLUSIVE MODE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION
        'project_financing_quota_termination_migration_requires_quiescence table=ProjectFinancingQuota'
        USING ERRCODE = '55P03';
  END;
END;
$$;

ALTER TABLE "ProjectFinancingQuota"
  ADD COLUMN "terminationActionId" TEXT,
  ADD COLUMN "terminationRequestFingerprint" TEXT;

CREATE UNIQUE INDEX "ProjectFinancingQuota_terminationActionId_key"
  ON "ProjectFinancingQuota"("terminationActionId");

ALTER TABLE "ProjectFinancingQuota"
  ADD CONSTRAINT "ProjectFinancingQuota_termination_idempotency_check"
  CHECK (
    (
      "terminationActionId" IS NULL
      AND "terminationRequestFingerprint" IS NULL
    )
    OR
    (
      "status" = 'terminated'
      AND "terminationActionId" IS NOT NULL
      AND "terminationRequestFingerprint" IS NOT NULL
      AND "terminationActionId" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND "terminationRequestFingerprint" ~ '^[0-9a-f]{64}$'
    )
  );

CREATE FUNCTION project_financing_quota_termination_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'terminated'
      AND (
        NEW."terminationActionId" IS NULL
        OR NEW."terminationRequestFingerprint" IS NULL
      )
    THEN
      RAISE EXCEPTION
        'new project financing quota terminations require durable action facts'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."status" = 'terminated'
      AND OLD."status" IS DISTINCT FROM 'terminated'
      AND (
        NEW."terminationActionId" IS NULL
        OR NEW."terminationRequestFingerprint" IS NULL
      )
    THEN
      RAISE EXCEPTION
        'new project financing quota terminations require durable action facts'
        USING ERRCODE = '23514';
    END IF;

    IF OLD."status" = 'terminated'
      AND ROW(
        NEW."status",
        NEW."terminatedAt",
        NEW."terminatedByUserId",
        NEW."terminationReason",
        NEW."terminationSignatureFileId",
        NEW."terminationSignatureSha256",
        NEW."terminationSignatureVersionId",
        NEW."terminationActionId",
        NEW."terminationRequestFingerprint"
      ) IS DISTINCT FROM ROW(
        OLD."status",
        OLD."terminatedAt",
        OLD."terminatedByUserId",
        OLD."terminationReason",
        OLD."terminationSignatureFileId",
        OLD."terminationSignatureSha256",
        OLD."terminationSignatureVersionId",
        OLD."terminationActionId",
        OLD."terminationRequestFingerprint"
      )
    THEN
      RAISE EXCEPTION
        'project financing quota termination facts are immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFinancingQuota_termination_guard"
BEFORE INSERT OR UPDATE ON "ProjectFinancingQuota"
FOR EACH ROW EXECUTE FUNCTION project_financing_quota_termination_guard();

COMMIT;
