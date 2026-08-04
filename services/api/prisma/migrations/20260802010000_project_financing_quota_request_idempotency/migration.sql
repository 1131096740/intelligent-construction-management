-- Freeze new project-financing quota requests without fabricating idempotency,
-- role or file-digest facts for historical quota rows.
BEGIN;

DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 13) THEN
    RAISE EXCEPTION
      'project_financing_quota_request_migration_requires_quiescence'
      USING ERRCODE = '55P03';
  END IF;
END;
$$;

-- Install file exclusivity under the same global lock order as runtime writers.
-- NOWAIT makes a non-quiescent deployment fail without deadlocking.
DO $$
DECLARE
  binding_table RECORD;
BEGIN
  FOR binding_table IN
    SELECT
      "tableName",
      CASE
        WHEN "tableName" IN ('ApprovalInstance', 'ProjectFinancingQuota')
          THEN 'ACCESS EXCLUSIVE'
        ELSE 'SHARE ROW EXCLUSIVE'
      END AS "lockMode"
    FROM (
      SELECT DISTINCT "tableName"
      FROM jg_file_business_binding_columns()
      UNION
      SELECT *
      FROM (VALUES
        ('ApprovalInstance'),
        ('FileObject'),
        ('ProjectFinancingQuota')
      ) required_table("tableName")
    ) binding_tables
    ORDER BY "tableName"
  LOOP
    BEGIN
      EXECUTE format(
        'LOCK TABLE %I IN %s MODE NOWAIT',
        binding_table."tableName",
        binding_table."lockMode"
      );
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION
          'project_financing_quota_request_migration_requires_quiescence table=%',
          binding_table."tableName"
          USING ERRCODE = '55P03';
    END;
  END LOOP;
END;
$$;

ALTER TABLE "ProjectFinancingQuota"
  ADD COLUMN "attachmentFileSha256Snapshot" TEXT,
  ADD COLUMN "requestedByRoleKey" TEXT,
  ADD COLUMN "requestIdempotencyKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

ALTER TABLE "ProjectFinancingQuota"
  ADD CONSTRAINT "ProjectFinancingQuota_request_snapshot_check"
  CHECK (
    (
      "attachmentFileSha256Snapshot" IS NULL
      AND "requestedByRoleKey" IS NULL
      AND "requestIdempotencyKey" IS NULL
      AND "requestFingerprint" IS NULL
    )
    OR
    (
      "attachmentFileSha256Snapshot" IS NOT NULL
      AND "requestedByRoleKey" IS NOT NULL
      AND "requestIdempotencyKey" IS NOT NULL
      AND "requestFingerprint" IS NOT NULL
      AND "attachmentFileSha256Snapshot" ~ '^[0-9a-f]{64}$'
      AND "requestedByRoleKey" IN ('finance_staff', 'finance_director')
      AND "requestIdempotencyKey" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
    )
  );

-- Existing quota attachments must already be one-file/one-business facts.
-- Historical conflicts stop the migration; no attachment is selected, moved
-- or deleted automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectFinancingQuota"
    GROUP BY "attachmentFileId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_financing_quota_duplicate_attachment'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'ProjectFinancingQuota_attachmentFileId_key';
  END IF;
END;
$$;

DO $$
DECLARE
  quota_attachment RECORD;
  registered_binding RECORD;
  binding_exists BOOLEAN;
BEGIN
  FOR quota_attachment IN
    SELECT "id", "attachmentFileId"
    FROM "ProjectFinancingQuota"
    ORDER BY "attachmentFileId", "id"
  LOOP
    FOR registered_binding IN
      SELECT *
      FROM jg_file_business_collision_columns()
      WHERE NOT (
        "tableName" = 'ProjectFinancingQuota'
        AND "columnName" = 'attachmentFileId'
      )
      ORDER BY "tableName", "columnName"
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)',
        registered_binding."tableName",
        registered_binding."columnName"
      )
      INTO binding_exists
      USING quota_attachment."attachmentFileId";

      IF binding_exists THEN
        RAISE EXCEPTION
          'project_financing_quota_cross_business_attachment fileId=%',
          quota_attachment."attachmentFileId"
          USING
            ERRCODE = '23514',
            CONSTRAINT = 'exclusive_file_business_binding_guard';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM "FileObject"
      WHERE (
          "id" = quota_attachment."attachmentFileId"
          AND "supersedesFileObjectId" IS NOT NULL
        )
        OR "supersedesFileObjectId" = quota_attachment."attachmentFileId"
    ) THEN
      RAISE EXCEPTION
        'project_financing_quota_cross_business_attachment fileId=%',
        quota_attachment."attachmentFileId"
        USING
          ERRCODE = '23514',
          CONSTRAINT = 'exclusive_file_business_binding_guard';
    END IF;
  END LOOP;
END;
$$;

-- Keep the historical non-unique index until the separately authorised
-- physical-deletion gate. The unique index is additive and authoritative.
CREATE UNIQUE INDEX "ProjectFinancingQuota_attachmentFileId_key"
  ON "ProjectFinancingQuota"("attachmentFileId");

CREATE UNIQUE INDEX "ProjectFinancingQuota_requestIdempotencyKey_key"
  ON "ProjectFinancingQuota"("requestIdempotencyKey");

-- A financing quota may use only the exact lifecycle namespace and may have at
-- most one such instance. The application still fail-closes missing legacy
-- instances; the index removes duplicate and concurrent-instance ambiguity.
ALTER TABLE "ApprovalInstance"
  ADD CONSTRAINT "ApprovalInstance_project_financing_quota_flow_check"
  CHECK (
    "businessType" <> 'project_financing_quota'
    OR "flowType" = 'project_financing_quota.approve'
  );

CREATE UNIQUE INDEX "ApprovalInstance_project_financing_quota_lifecycle_key"
  ON "ApprovalInstance"("businessType", "businessId")
  WHERE "businessType" = 'project_financing_quota';

CREATE FUNCTION project_financing_quota_request_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."attachmentFileSha256Snapshot" IS NULL
    OR NEW."requestedByRoleKey" IS NULL
    OR NEW."requestIdempotencyKey" IS NULL
    OR NEW."requestFingerprint" IS NULL
  THEN
    RAISE EXCEPTION 'new project financing quotas require a complete request snapshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFinancingQuota_request_snapshot_required"
BEFORE INSERT ON "ProjectFinancingQuota"
FOR EACH ROW EXECUTE FUNCTION project_financing_quota_request_insert_guard();

CREATE FUNCTION project_financing_quota_request_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW."projectId", NEW."amountCents", NEW."reason", NEW."validUntil",
    NEW."attachmentFileId", NEW."attachmentFileSha256Snapshot",
    NEW."requestedByUserId", NEW."requestedByRoleKey",
    NEW."requestIdempotencyKey", NEW."requestFingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."projectId", OLD."amountCents", OLD."reason", OLD."validUntil",
    OLD."attachmentFileId", OLD."attachmentFileSha256Snapshot",
    OLD."requestedByUserId", OLD."requestedByRoleKey",
    OLD."requestIdempotencyKey", OLD."requestFingerprint"
  ) THEN
    RAISE EXCEPTION 'project financing quota request facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFinancingQuota_request_immutable"
BEFORE UPDATE ON "ProjectFinancingQuota"
FOR EACH ROW EXECUTE FUNCTION project_financing_quota_request_immutable_guard();

-- Quota requests, lifecycle history and their idempotency coordinates are
-- append-only business facts. Termination changes status; it never deletes the
-- quota row. Any future physical purge requires a separately authorised
-- migration that explicitly replaces this guard.
CREATE FUNCTION project_financing_quota_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project financing quota facts cannot be deleted'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ProjectFinancingQuota_delete_guard"
BEFORE DELETE ON "ProjectFinancingQuota"
FOR EACH ROW EXECUTE FUNCTION project_financing_quota_delete_guard();

-- Promote quota attachments to the unified exclusive-file registry. This
-- closes both directions: an attachment cannot already be bound, and later
-- ordinary business facts cannot reuse a quota attachment.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_project_financing_quota_request;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    "tableName",
    "columnName",
    CASE
      WHEN "tableName" = 'ProjectFinancingQuota'
        AND "columnName" = 'attachmentFileId' THEN TRUE
      ELSE "exclusive"
    END
  FROM jg_file_business_binding_columns_before_project_financing_quota_request();
$$;

DO $$
DECLARE
  existing_trigger RECORD;
BEGIN
  FOR existing_trigger IN
    SELECT trigger.tgname AS trigger_name
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
    WHERE NOT trigger.tgisinternal
      AND namespace.nspname = current_schema()
      AND relation.relname = 'ProjectFinancingQuota'
      AND procedure.proname = 'jg_enforce_exclusive_file_business_binding'
    ORDER BY trigger.tgname
  LOOP
    EXECUTE format(
      'DROP TRIGGER %I ON "ProjectFinancingQuota"',
      existing_trigger.trigger_name
    );
  END LOOP;
END;
$$;

CREATE TRIGGER jg_efb_project_financing_quota_request_attachment
BEFORE INSERT OR UPDATE OF "attachmentFileId" ON "ProjectFinancingQuota"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'attachmentFileId',
  'true'
);

CREATE TRIGGER jg_efb_project_financing_quota_termination_signature
BEFORE INSERT OR UPDATE OF "terminationSignatureFileId" ON "ProjectFinancingQuota"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'terminationSignatureFileId',
  'false'
);

COMMIT;
