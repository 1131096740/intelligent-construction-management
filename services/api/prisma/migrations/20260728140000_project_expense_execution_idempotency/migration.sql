BEGIN;

-- This migration is quiesced-only. Taking the shared advisory lock with a
-- non-blocking probe, followed by non-blocking table locks, makes every
-- in-flight writer fail this migration immediately instead of forming either
-- of the two writer lock-order cycles (trigger writer: table -> advisory;
-- explicit file guard: advisory -> table).
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 13) THEN
    RAISE EXCEPTION
      'project_expense_execution_migration_requires_quiescence'
      USING ERRCODE = '55P03';
  END IF;
END;
$$;

-- Close the inspection-to-install window for every registered FileObject owner.
DO $$
DECLARE
  binding_table RECORD;
BEGIN
  FOR binding_table IN
    SELECT
      "tableName",
      CASE
        WHEN "tableName" IN (
          'ProjectExpenseExecution',
          'ProjectExpenseRequest',
          'ProjectFinancingQuota',
          'ProjectFundingAllocation'
        ) THEN 'ACCESS EXCLUSIVE'
        ELSE 'SHARE ROW EXCLUSIVE'
      END AS "lockMode"
    FROM (
      SELECT DISTINCT "tableName"
      FROM jg_file_business_binding_columns()
      UNION
      SELECT *
      FROM (
        VALUES
          ('AuditLog'),
          ('FileObject'),
          ('Project'),
          ('ProjectExpenseExecution'),
          ('ProjectExpenseRequest'),
          ('ProjectFinancingQuota'),
          ('ProjectFundingAllocation'),
          ('User')
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
          'project_expense_execution_migration_requires_quiescence table=%',
          binding_table."tableName"
          USING ERRCODE = '55P03';
    END;
  END LOOP;
END;
$$;

-- One active voucher is one immutable project-expense payment fact. Historical
-- conflicts block deployment; this migration never chooses or deletes a row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution"
    GROUP BY "voucherFileId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_duplicate_voucher'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'ProjectExpenseExecution_voucherFileId_key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    LEFT JOIN "FileObject" file
      ON file."id" = execution."voucherFileId"
    WHERE file."id" IS NULL
      OR file."storageStatus" IS DISTINCT FROM 'active'
      OR file."uploadedByUserId"
        IS DISTINCT FROM execution."executedByUserId"
  ) THEN
    RAISE EXCEPTION
      'project_expense_execution_voucher_owner_or_status_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- The execution owner, cached paid amount and payment status must already form
-- one closed money fact. No amount, status or ownership is repaired here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    LEFT JOIN "ProjectExpenseRequest" request
      ON request."id" = execution."projectExpenseRequestId"
    LEFT JOIN "Project" project
      ON project."id" = execution."projectId"
    LEFT JOIN "User" executor
      ON executor."id" = execution."executedByUserId"
    WHERE request."id" IS NULL
      OR project."id" IS NULL
      OR executor."id" IS NULL
      OR request."projectId" IS DISTINCT FROM execution."projectId"
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_request_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    LEFT JOIN (
      SELECT
        "projectExpenseRequestId",
        SUM("amountCents") AS "executedAmountCents"
      FROM "ProjectExpenseExecution"
      GROUP BY "projectExpenseRequestId"
    ) execution_total
      ON execution_total."projectExpenseRequestId" = request."id"
    WHERE request."paidAmountCents"
      <> COALESCE(execution_total."executedAmountCents", 0::BIGINT)
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_request_paid_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest"
    WHERE (
        "status" = 'approved_pending_payment'
        AND (
          "approvedAmountCents" IS NULL
          OR "paidAmountCents" <> 0
        )
      )
      OR (
        "status" = 'partially_paid'
        AND (
          "approvedAmountCents" IS NULL
          OR "paidAmountCents" <= 0
          OR "paidAmountCents" >= "approvedAmountCents"
        )
      )
      OR (
        "status" = 'paid'
        AND (
          "approvedAmountCents" IS NULL
          OR "paidAmountCents" <> "approvedAmountCents"
        )
      )
      OR (
        "status" = 'payment_blocked'
        AND (
          "approvedAmountCents" IS NULL
          OR "paidAmountCents" < 0
          OR "paidAmountCents" >= "approvedAmountCents"
        )
      )
      OR (
        "status" NOT IN (
          'approved_pending_payment',
          'partially_paid',
          'paid',
          'payment_blocked'
        )
        AND "paidAmountCents" <> 0
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_request_status_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    JOIN "ProjectExpenseRequest" request
      ON request."id" = execution."projectExpenseRequestId"
    WHERE request."status" NOT IN (
      'partially_paid',
      'paid',
      'payment_blocked'
    )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_request_owner_status_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Every retained execution must already own an exact unified funding debit and
-- the legacy-compatible audit emitted by ProjectExpenseService.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectFundingAllocation" allocation
    LEFT JOIN "ProjectExpenseExecution" execution
      ON execution."id" = allocation."executionId"
    LEFT JOIN "ProjectExpenseRequest" request
      ON request."id" = execution."projectExpenseRequestId"
    WHERE allocation."executionType" = 'project_expense_execution'
      AND (
        execution."id" IS NULL
        OR request."id" IS NULL
        OR allocation."direction" IS DISTINCT FROM 'debit'
        OR allocation."reversalKey" IS DISTINCT FROM 'original'
        OR allocation."reversalOfAllocationId" IS NOT NULL
        OR allocation."projectId" IS DISTINCT FROM execution."projectId"
        OR allocation."businessType"
          IS DISTINCT FROM 'project_expense_request'
        OR allocation."businessId" IS DISTINCT FROM request."id"
        OR allocation."occurredAt" IS DISTINCT FROM execution."paidAt"
        OR allocation."createdByUserId"
          IS DISTINCT FROM execution."executedByUserId"
      )
  ) THEN
    RAISE EXCEPTION
      'project_expense_execution_funding_allocation_orphan_or_reversal'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectFundingAllocation" allocation
    LEFT JOIN "ProjectFinancingQuota" quota
      ON quota."id" = allocation."sourceId"
    WHERE allocation."sourceType" = 'financing_quota'
      AND (
        quota."id" IS NULL
        OR quota."projectId" IS DISTINCT FROM allocation."projectId"
      )
  ) THEN
    RAISE EXCEPTION
      'project_funding_allocation_quota_project_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "ProjectFundingAllocation" allocation
      WHERE allocation."executionType" = 'project_expense_execution'
        AND allocation."executionId" = execution."id"
        AND allocation."direction" = 'debit'
        AND allocation."reversalKey" = 'original'
    )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_funding_allocation_missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    LEFT JOIN "ProjectExpenseRequest" request
      ON request."id" = execution."projectExpenseRequestId"
    WHERE request."id" IS NULL
      OR (
        SELECT SUM(allocation."amountCents")
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'project_expense_execution'
          AND allocation."executionId" = execution."id"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
      ) IS DISTINCT FROM execution."amountCents"
      OR EXISTS (
        SELECT 1
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'project_expense_execution'
          AND allocation."executionId" = execution."id"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
          AND (
            allocation."projectId"
              IS DISTINCT FROM execution."projectId"
            OR allocation."businessType"
              IS DISTINCT FROM 'project_expense_request'
            OR allocation."businessId"
              IS DISTINCT FROM request."id"
            OR allocation."occurredAt"
              IS DISTINCT FROM execution."paidAt"
            OR allocation."createdByUserId"
              IS DISTINCT FROM execution."executedByUserId"
            OR allocation."sourceType" NOT IN (
              'project_cash',
              'financing_quota'
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_funding_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "AuditLog" audit
      WHERE audit."action" = 'project_expense.execution.record'
        AND audit."businessType" = 'project_expense_request'
        AND audit."businessId" = execution."projectExpenseRequestId"
    )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_audit_missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "AuditLog" audit
      WHERE audit."action" = 'project_expense.execution.record'
        AND audit."businessType" = 'project_expense_request'
        AND audit."businessId" = execution."projectExpenseRequestId"
        AND audit."actorUserId"
          IS NOT DISTINCT FROM execution."executedByUserId"
        AND audit."metadata"->>'executionId'
          IS NOT DISTINCT FROM execution."id"
        AND audit."metadata"->>'amountCents'
          IS NOT DISTINCT FROM execution."amountCents"::TEXT
        AND audit."metadata"->>'voucherFileId'
          IS NOT DISTINCT FROM execution."voucherFileId"
    )
  ) THEN
    RAISE EXCEPTION 'project_expense_execution_audit_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $$
DECLARE
  execution_voucher RECORD;
  registered_binding RECORD;
  binding_exists BOOLEAN;
BEGIN
  FOR execution_voucher IN
    SELECT "id", "voucherFileId"
    FROM "ProjectExpenseExecution"
    ORDER BY "voucherFileId", "id"
  LOOP
    FOR registered_binding IN
      SELECT *
      FROM jg_file_business_collision_columns()
      WHERE NOT (
        "tableName" = 'ProjectExpenseExecution'
        AND "columnName" = 'voucherFileId'
      )
      ORDER BY "tableName", "columnName"
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)',
        registered_binding."tableName",
        registered_binding."columnName"
      )
      INTO binding_exists
      USING execution_voucher."voucherFileId";

      IF binding_exists THEN
        RAISE EXCEPTION
          'project_expense_execution_cross_business_voucher fileId=%',
          execution_voucher."voucherFileId"
          USING
            ERRCODE = '23514',
            CONSTRAINT = 'exclusive_file_business_binding_guard';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM "FileObject"
      WHERE (
          "id" = execution_voucher."voucherFileId"
          AND "supersedesFileObjectId" IS NOT NULL
        )
        OR "supersedesFileObjectId" = execution_voucher."voucherFileId"
    ) THEN
      RAISE EXCEPTION
        'project_expense_execution_cross_business_voucher fileId=%',
        execution_voucher."voucherFileId"
        USING
          ERRCODE = '23514',
          CONSTRAINT = 'exclusive_file_business_binding_guard';
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE "ProjectExpenseExecution"
  ADD COLUMN "idempotencyKey" TEXT;

UPDATE "ProjectExpenseExecution" execution
SET "idempotencyKey" = 'legacy:project_expense_execution:' || execution."id";

ALTER TABLE "ProjectExpenseExecution"
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "ProjectExpenseRequest_id_projectId_key"
  ON "ProjectExpenseRequest"("id", "projectId");

CREATE UNIQUE INDEX "ProjectFinancingQuota_id_projectId_key"
  ON "ProjectFinancingQuota"("id", "projectId");

ALTER TABLE "ProjectExpenseExecution"
  ADD CONSTRAINT "ProjectExpenseExecution_request_fk"
  FOREIGN KEY ("projectExpenseRequestId", "projectId")
  REFERENCES "ProjectExpenseRequest"("id", "projectId") NOT VALID;

ALTER TABLE "ProjectExpenseExecution"
  ADD CONSTRAINT "ProjectExpenseExecution_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;

ALTER TABLE "ProjectExpenseExecution"
  ADD CONSTRAINT "ProjectExpenseExecution_voucher_file_fk"
  FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "ProjectExpenseExecution"
  ADD CONSTRAINT "ProjectExpenseExecution_executor_fk"
  FOREIGN KEY ("executedByUserId") REFERENCES "User"("id") NOT VALID;

ALTER TABLE "ProjectFundingAllocation"
  ADD CONSTRAINT "ProjectFundingAllocation_quota_project_fk"
  FOREIGN KEY ("sourceId", "projectId")
  REFERENCES "ProjectFinancingQuota"("id", "projectId") NOT VALID;

ALTER TABLE "ProjectFundingAllocation"
  ADD CONSTRAINT "ProjectFundingAllocation_project_expense_execution_guard"
  CHECK (
    "executionType" <> 'project_expense_execution'
    OR (
      "direction" = 'debit'
      AND "reversalOfAllocationId" IS NULL
      AND "reversalKey" = 'original'
    )
  ) NOT VALID;

ALTER TABLE "ProjectExpenseExecution"
  ADD CONSTRAINT "ProjectExpenseExecution_idempotency_key_format_check"
  CHECK (
    "idempotencyKey" ~
      '^legacy:project_expense_execution:[[:graph:]]+$'
    OR (
      "idempotencyKey" = LOWER("idempotencyKey")
      AND "idempotencyKey" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) NOT VALID;

ALTER TABLE "ProjectExpenseRequest"
  ADD CONSTRAINT "ProjectExpenseRequest_payment_status_amount_check"
  CHECK (
    (
      "status" = 'approved_pending_payment'
      AND "approvedAmountCents" IS NOT NULL
      AND "paidAmountCents" = 0
    )
    OR (
      "status" = 'partially_paid'
      AND "approvedAmountCents" IS NOT NULL
      AND "paidAmountCents" > 0
      AND "paidAmountCents" < "approvedAmountCents"
    )
    OR (
      "status" = 'paid'
      AND "approvedAmountCents" IS NOT NULL
      AND "paidAmountCents" = "approvedAmountCents"
    )
    OR (
      "status" = 'payment_blocked'
      AND "approvedAmountCents" IS NOT NULL
      AND "paidAmountCents" >= 0
      AND "paidAmountCents" < "approvedAmountCents"
    )
    OR (
      "status" NOT IN (
        'approved_pending_payment',
        'partially_paid',
        'paid',
        'payment_blocked'
      )
      AND "paidAmountCents" = 0
    )
  ) NOT VALID;

CREATE FUNCTION guard_project_expense_funding_allocation_owner()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."executionType" = 'project_expense_execution' THEN
      RAISE EXCEPTION
        'project_expense_execution_funding_allocation_immutable_delete'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."executionType" = 'project_expense_execution'
      OR NEW."executionType" = 'project_expense_execution'
    THEN
      RAISE EXCEPTION
        'project_expense_execution_funding_allocation_immutable_update'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."executionType" <> 'project_expense_execution' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    JOIN "ProjectExpenseRequest" request
      ON request."id" = execution."projectExpenseRequestId"
    WHERE execution."id" = NEW."executionId"
      AND execution."projectId" = NEW."projectId"
      AND request."projectId" = NEW."projectId"
      AND NEW."businessType" = 'project_expense_request'
      AND NEW."businessId" = request."id"
      AND NEW."occurredAt" IS NOT DISTINCT FROM execution."paidAt"
      AND NEW."createdByUserId"
        IS NOT DISTINCT FROM execution."executedByUserId"
  ) THEN
    RAISE EXCEPTION
      'project_expense_execution_funding_allocation_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectFundingAllocation_project_expense_owner_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ProjectFundingAllocation"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_funding_allocation_owner();

CREATE FUNCTION validate_project_expense_funding_allocation_total()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ProjectExpenseExecution" execution
    WHERE execution."id" = NEW."executionId"
      AND (
        SELECT SUM(allocation."amountCents")
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'project_expense_execution'
          AND allocation."executionId" = NEW."executionId"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
      ) IS NOT DISTINCT FROM execution."amountCents"
  ) THEN
    RAISE EXCEPTION
      'project_expense_execution_funding_allocation_total_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "ProjectFundingAllocation_project_expense_total_guard"
AFTER INSERT ON "ProjectFundingAllocation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."executionType" = 'project_expense_execution')
EXECUTE FUNCTION validate_project_expense_funding_allocation_total();

CREATE UNIQUE INDEX "ProjectExpenseExecution_idempotencyKey_key"
  ON "ProjectExpenseExecution"("idempotencyKey");

CREATE UNIQUE INDEX "ProjectExpenseExecution_voucherFileId_key"
  ON "ProjectExpenseExecution"("voucherFileId");

-- Promote the project-expense voucher from a reusable reference to one
-- exclusive business fact while preserving the frozen registry.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_project_expense_execution;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    "tableName",
    "columnName",
    CASE
      WHEN "tableName" = 'ProjectExpenseExecution' AND "columnName" = 'voucherFileId' THEN TRUE
      ELSE "exclusive"
    END
  FROM jg_file_business_binding_columns_before_project_expense_execution();
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
      AND relation.relname = 'ProjectExpenseExecution'
      AND procedure.proname = 'jg_enforce_exclusive_file_business_binding'
    ORDER BY trigger.tgname
  LOOP
    EXECUTE format(
      'DROP TRIGGER %I ON "ProjectExpenseExecution"',
      existing_trigger.trigger_name
    );
  END LOOP;
END;
$$;

CREATE TRIGGER jg_efb_project_expense_execution_voucher
BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ProjectExpenseExecution"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('voucherFileId', 'true');

CREATE FUNCTION guard_project_expense_execution_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project_expense_execution_immutable_delete'
      USING ERRCODE = '23514';
  END IF;

  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'project_expense_execution_immutable_update'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "ProjectExpenseExecution_immutable"
BEFORE UPDATE OR DELETE ON "ProjectExpenseExecution"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_execution_immutable();

CREATE FUNCTION validate_project_expense_execution_closed_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    JOIN "FileObject" file
      ON file."id" = NEW."voucherFileId"
    WHERE request."id" = NEW."projectExpenseRequestId"
      AND request."projectId" = NEW."projectId"
      AND file."storageStatus" = 'active'
      AND file."uploadedByUserId" = NEW."executedByUserId"
      AND request."paidAmountCents" = (
        SELECT COALESCE(SUM(execution."amountCents"), 0::BIGINT)
        FROM "ProjectExpenseExecution" execution
        WHERE execution."projectExpenseRequestId" = request."id"
      )
      AND NEW."amountCents" = (
        SELECT SUM(allocation."amountCents")
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'project_expense_execution'
          AND allocation."executionId" = NEW."id"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
      )
      AND EXISTS (
        SELECT 1
        FROM "AuditLog" audit
        WHERE audit."action" = 'project_expense.execution.record'
          AND audit."businessType" = 'project_expense_request'
          AND audit."businessId" = request."id"
          AND audit."actorUserId"
            IS NOT DISTINCT FROM NEW."executedByUserId"
          AND audit."metadata"->>'executionId'
            IS NOT DISTINCT FROM NEW."id"
          AND audit."metadata"->>'amountCents'
            IS NOT DISTINCT FROM NEW."amountCents"::TEXT
          AND audit."metadata"->>'voucherFileId'
            IS NOT DISTINCT FROM NEW."voucherFileId"
      )
  ) THEN
    RAISE EXCEPTION
      'project_expense_execution_closed_fact_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ProjectExpenseExecution_closed_fact_guard"
AFTER INSERT ON "ProjectExpenseExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_project_expense_execution_closed_fact();

ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_request_fk";
ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_project_fk";
ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_voucher_file_fk";
ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_executor_fk";
ALTER TABLE "ProjectFundingAllocation"
  VALIDATE CONSTRAINT "ProjectFundingAllocation_quota_project_fk";
ALTER TABLE "ProjectFundingAllocation"
  VALIDATE CONSTRAINT "ProjectFundingAllocation_project_expense_execution_guard";
ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_amountCents_positive_check";
ALTER TABLE "ProjectExpenseExecution"
  VALIDATE CONSTRAINT "ProjectExpenseExecution_idempotency_key_format_check";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT "ProjectExpenseRequest_payment_status_amount_check";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT "ProjectExpenseRequest_paidAmountCents_nonnegative_check";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT "ProjectExpenseRequest_paidAmountCents_lte_approved_check";

COMMIT;
