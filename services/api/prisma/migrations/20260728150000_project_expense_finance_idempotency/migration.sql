BEGIN;

-- This migration must run while project-expense finance writes are quiesced.
-- The migration-operation advisory probe and non-blocking table locks make a
-- live writer fail deployment immediately instead of leaving a scan/install
-- window or waiting behind production traffic.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 14) THEN
    RAISE EXCEPTION
      'project_expense_finance_migration_requires_quiescence'
      USING ERRCODE = '55P03';
  END IF;
END;
$$;

DO $$
DECLARE
  required_table RECORD;
BEGIN
  FOR required_table IN
    SELECT *
    FROM (
      VALUES
        ('AuditLog', 'ACCESS EXCLUSIVE'),
        ('FinanceRecord', 'ACCESS EXCLUSIVE'),
        ('PdfDocument', 'ACCESS EXCLUSIVE'),
        ('Project', 'ACCESS EXCLUSIVE'),
        ('ProjectExpenseRequest', 'ACCESS EXCLUSIVE'),
        ('User', 'ACCESS EXCLUSIVE')
    ) tables("tableName", "lockMode")
    ORDER BY "tableName"
  LOOP
    BEGIN
      EXECUTE format(
        'LOCK TABLE %I IN %s MODE NOWAIT',
        required_table."tableName",
        required_table."lockMode"
      );
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION
          'project_expense_finance_migration_requires_quiescence table=%',
          required_table."tableName"
          USING ERRCODE = '55P03';
    END;
  END LOOP;
END;
$$;

-- Retained project-expense finance facts must already belong to the same
-- project as their parent request. No owner is guessed or repaired here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    LEFT JOIN "ProjectExpenseRequest" request
      ON request."id" = finance."projectExpenseRequestId"
    LEFT JOIN "Project" project
      ON project."id" = finance."projectId"
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND (
        request."id" IS NULL
        OR project."id" IS NULL
        OR request."projectId" IS DISTINCT FROM finance."projectId"
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_request_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Every retained finance actor must still be a real user. The actor may later
-- become inactive, but its historical identity cannot be fabricated or
-- deleted while a finance fact points at it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    LEFT JOIN "User" actor
      ON actor."id" = finance."createdByUserId"
    WHERE actor."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_actor_missing'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- A project-expense finance fact is one positive outflow and cannot also be a
-- payment-request or settlement source. Existing conflicts block deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND (
        finance."paymentRequestId" IS NOT NULL
        OR finance."settlementId" IS NOT NULL
        OR finance."direction" IS DISTINCT FROM 'outflow'
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_source_direction_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND finance."amountCents" <= 0
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_amount_invalid'
      USING ERRCODE = '23514';
  END IF;

END;
$$;

-- Finance can only follow a real payment state. The aggregate is append-only
-- and must never exceed the parent's paid projection.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    JOIN "ProjectExpenseRequest" request
      ON request."id" = finance."projectExpenseRequestId"
     AND request."projectId" = finance."projectId"
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND request."status" NOT IN (
        'partially_paid',
        'paid',
        'payment_blocked'
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_request_status_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    JOIN "ProjectExpenseRequest" request
      ON request."id" = finance."projectExpenseRequestId"
     AND request."projectId" = finance."projectId"
    WHERE finance."projectExpenseRequestId" IS NOT NULL
    GROUP BY request."id", request."paidAmountCents"
    HAVING SUM(finance."amountCents") > request."paidAmountCents"
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_cumulative_exceeds_paid'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Legal legacy rows retain NULL idempotency keys. Their historical audit shape
-- predates occurredAt/idempotencyKey metadata, but it must still identify the
-- exact fact, actor and amount. New rows are checked against the stronger shape
-- by the deferred trigger installed below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "AuditLog" audit
        WHERE audit."action" = 'project_expense.finance.record'
          AND audit."businessType" = 'project_expense_request'
          AND audit."businessId" = finance."projectExpenseRequestId"
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_audit_missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "AuditLog" audit
        WHERE audit."action" = 'project_expense.finance.record'
          AND audit."businessType" = 'project_expense_request'
          AND audit."businessId" = finance."projectExpenseRequestId"
          AND audit."actorUserId"
            IS NOT DISTINCT FROM finance."createdByUserId"
          AND audit."metadata"->>'financeRecordId'
            IS NOT DISTINCT FROM finance."id"
          AND audit."metadata"->>'amountCents'
            IS NOT DISTINCT FROM finance."amountCents"::TEXT
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_audit_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Every retained finance audit must point back to exactly the legacy fact it
-- claims to record. This reverse scan runs before immutable audit guards are
-- installed so an orphan or misbound historical audit can never be locked in.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.finance.record'
      AND audit."businessType" = 'project_expense_request'
      AND NOT EXISTS (
        SELECT 1
        FROM "FinanceRecord" finance
        WHERE finance."projectExpenseRequestId" IS NOT NULL
          AND finance."id"
            IS NOT DISTINCT FROM
              audit."metadata"->>'financeRecordId'
          AND finance."projectExpenseRequestId"
            IS NOT DISTINCT FROM audit."businessId"
          AND finance."createdByUserId"
            IS NOT DISTINCT FROM audit."actorUserId"
          AND finance."amountCents"::TEXT
            IS NOT DISTINCT FROM
              audit."metadata"->>'amountCents'
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_audit_reverse_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.finance.record'
      AND audit."businessType" = 'project_expense_request'
      AND COALESCE(audit."metadata"->>'financeRecordId', '') <> ''
    GROUP BY audit."metadata"->>'financeRecordId'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_audit_duplicate'
      USING
        ERRCODE = '23514',
        CONSTRAINT =
          'AuditLog_project_expense_finance_record_key';
  END IF;
END;
$$;

-- A project expense has at most one generated finance archive. Historical
-- duplicates are never selected, merged or deleted automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PdfDocument"
    WHERE "businessType" = 'project_expense_request'
      AND "templateKey" = 'project_expense_finance_archive'
    GROUP BY "businessId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_pdf_duplicate'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'PdfDocument_project_expense_finance_archive_key';
  END IF;
END;
$$;

ALTER TABLE "FinanceRecord"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "FinanceRecord_idempotencyKey_key"
  ON "FinanceRecord"("idempotencyKey");

CREATE UNIQUE INDEX "AuditLog_project_expense_finance_record_key"
  ON "AuditLog"(("metadata"->>'financeRecordId'))
  WHERE "action" = 'project_expense.finance.record'
    AND "businessType" = 'project_expense_request'
    AND COALESCE("metadata"->>'financeRecordId', '') <> '';

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_project_expense_owner_fk"
  FOREIGN KEY ("projectExpenseRequestId", "projectId")
  REFERENCES "ProjectExpenseRequest"("id", "projectId") NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT
    "FinanceRecord_project_expense_idempotency_key_format_check"
  CHECK (
    "projectExpenseRequestId" IS NULL
    OR "idempotencyKey" IS NULL
    OR (
      "idempotencyKey" = LOWER("idempotencyKey")
      AND "idempotencyKey" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_project_expense_source_check"
  CHECK (
    "projectExpenseRequestId" IS NULL
    OR (
      "paymentRequestId" IS NULL
      AND "settlementId" IS NULL
      AND "direction" = 'outflow'
    )
  ) NOT VALID;

ALTER TABLE "FinanceRecord"
  ADD CONSTRAINT "FinanceRecord_project_expense_amount_positive_check"
  CHECK (
    "projectExpenseRequestId" IS NULL
    OR "amountCents" > 0
  ) NOT VALID;

CREATE UNIQUE INDEX "PdfDocument_project_expense_finance_archive_key"
  ON "PdfDocument"("businessId")
  WHERE "businessType" = 'project_expense_request'
    AND "templateKey" = 'project_expense_finance_archive';

CREATE FUNCTION guard_project_expense_finance_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_status TEXT;
  request_paid_amount BIGINT;
  finance_total BIGINT;
BEGIN
  IF NEW."projectExpenseRequestId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."idempotencyKey" IS NULL THEN
    RAISE EXCEPTION 'project_expense_finance_idempotency_required'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."idempotencyKey" <> LOWER(NEW."idempotencyKey")
    OR NEW."idempotencyKey" !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'project_expense_finance_idempotency_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."paymentRequestId" IS NOT NULL
    OR NEW."settlementId" IS NOT NULL
    OR NEW."direction" IS DISTINCT FROM 'outflow'
  THEN
    RAISE EXCEPTION 'project_expense_finance_source_direction_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."amountCents" <= 0 THEN
    RAISE EXCEPTION 'project_expense_finance_amount_invalid'
      USING ERRCODE = '23514';
  END IF;

  -- Fail fast when another transaction is writing finance facts for the same
  -- request. Waiting inside one INSERT would retain that statement's stale
  -- snapshot, so a non-blocking transaction advisory lock is intentional.
  IF NOT pg_try_advisory_xact_lock(
    190731,
    hashtext(NEW."projectExpenseRequestId")
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_concurrent_write'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM actor."id"
  FROM "User" actor
  WHERE actor."id" = NEW."createdByUserId"
  FOR KEY SHARE OF actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_expense_finance_actor_missing'
      USING ERRCODE = '23514';
  END IF;

  SELECT request."status", request."paidAmountCents"
  INTO request_status, request_paid_amount
  FROM "ProjectExpenseRequest" request
  WHERE request."id" = NEW."projectExpenseRequestId"
    AND request."projectId" = NEW."projectId"
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_expense_finance_request_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF request_status NOT IN (
    'partially_paid',
    'paid',
    'payment_blocked'
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_request_status_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(finance."amountCents"), 0::BIGINT)
  INTO finance_total
  FROM "FinanceRecord" finance
  WHERE finance."projectExpenseRequestId" = NEW."projectExpenseRequestId";

  IF finance_total + NEW."amountCents" > request_paid_amount THEN
    RAISE EXCEPTION 'project_expense_finance_cumulative_exceeds_paid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceRecord_project_expense_insert_guard"
BEFORE INSERT ON "FinanceRecord"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_finance_insert();

CREATE FUNCTION guard_project_expense_finance_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."projectExpenseRequestId" IS NOT NULL THEN
      RAISE EXCEPTION 'project_expense_finance_immutable_delete'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."projectExpenseRequestId" IS NOT NULL
    OR NEW."projectExpenseRequestId" IS NOT NULL
  THEN
    RAISE EXCEPTION 'project_expense_finance_immutable_update'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceRecord_project_expense_immutable"
BEFORE UPDATE OR DELETE ON "FinanceRecord"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_finance_immutable();

CREATE FUNCTION validate_project_expense_finance_closed_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_status TEXT;
  request_paid_amount BIGINT;
  finance_total BIGINT;
BEGIN
  IF NEW."projectExpenseRequestId" IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT request."status", request."paidAmountCents"
  INTO request_status, request_paid_amount
  FROM "ProjectExpenseRequest" request
  WHERE request."id" = NEW."projectExpenseRequestId"
    AND request."projectId" = NEW."projectId"
  FOR UPDATE OF request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_expense_finance_request_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF request_status NOT IN (
    'partially_paid',
    'paid',
    'payment_blocked'
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_request_status_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(finance."amountCents"), 0::BIGINT)
  INTO finance_total
  FROM "FinanceRecord" finance
  WHERE finance."projectExpenseRequestId" = NEW."projectExpenseRequestId";

  IF finance_total > request_paid_amount THEN
    RAISE EXCEPTION 'project_expense_finance_cumulative_exceeds_paid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.finance.record'
      AND audit."businessType" = 'project_expense_request'
      AND audit."businessId" = NEW."projectExpenseRequestId"
      AND audit."actorUserId"
        IS NOT DISTINCT FROM NEW."createdByUserId"
      AND audit."metadata"->>'financeRecordId'
        IS NOT DISTINCT FROM NEW."id"
      AND audit."metadata"->>'idempotencyKey'
        IS NOT DISTINCT FROM NEW."idempotencyKey"
      AND audit."metadata"->>'amountCents'
        IS NOT DISTINCT FROM NEW."amountCents"::TEXT
      AND audit."metadata"->>'occurredAt'
        IS NOT DISTINCT FROM to_char(
          NEW."occurredAt",
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_closed_fact_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "FinanceRecord_project_expense_closed_fact_guard"
AFTER INSERT ON "FinanceRecord"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."projectExpenseRequestId" IS NOT NULL)
EXECUTE FUNCTION validate_project_expense_finance_closed_fact();

CREATE FUNCTION validate_project_expense_finance_audit_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" IS NOT NULL
      AND finance."id"
        IS NOT DISTINCT FROM
          NEW."metadata"->>'financeRecordId'
      AND finance."projectExpenseRequestId"
        IS NOT DISTINCT FROM NEW."businessId"
      AND finance."createdByUserId"
        IS NOT DISTINCT FROM NEW."actorUserId"
      AND finance."idempotencyKey"
        IS NOT DISTINCT FROM
          NEW."metadata"->>'idempotencyKey'
      AND finance."amountCents"::TEXT
        IS NOT DISTINCT FROM
          NEW."metadata"->>'amountCents'
      AND to_char(
        finance."occurredAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) IS NOT DISTINCT FROM
        NEW."metadata"->>'occurredAt'
  ) THEN
    RAISE EXCEPTION
      'project_expense_finance_audit_closed_fact_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "AuditLog_project_expense_finance_closed_fact_guard"
AFTER INSERT ON "AuditLog"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  NEW."action" = 'project_expense.finance.record'
  AND NEW."businessType" = 'project_expense_request'
)
EXECUTE FUNCTION validate_project_expense_finance_audit_fact();

CREATE FUNCTION guard_project_expense_finance_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."action" = 'project_expense.finance.record'
      AND OLD."businessType" = 'project_expense_request'
    THEN
      RAISE EXCEPTION
        'project_expense_finance_audit_immutable_delete'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF (
    OLD."action" = 'project_expense.finance.record'
    AND OLD."businessType" = 'project_expense_request'
  ) OR (
    NEW."action" = 'project_expense.finance.record'
    AND NEW."businessType" = 'project_expense_request'
  ) THEN
    RAISE EXCEPTION
      'project_expense_finance_audit_immutable_update'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_project_expense_finance_immutable"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_finance_audit_immutable();

-- Keep the parent status and paid projection compatible with any retained
-- finance facts. Normal execution updates may increase paidAmount and move
-- between the three post-payment statuses, but cannot strand an over-recorded
-- finance aggregate.
CREATE FUNCTION guard_project_expense_finance_parent_projection()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  finance_total BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" = OLD."id"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(finance."amountCents"), 0::BIGINT)
  INTO finance_total
  FROM "FinanceRecord" finance
  WHERE finance."projectExpenseRequestId" = OLD."id";

  IF NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    RAISE EXCEPTION 'project_expense_finance_request_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" NOT IN (
    'partially_paid',
    'paid',
    'payment_blocked'
  ) THEN
    RAISE EXCEPTION 'project_expense_finance_request_status_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF finance_total > NEW."paidAmountCents" THEN
    RAISE EXCEPTION 'project_expense_finance_cumulative_exceeds_paid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectExpenseRequest_finance_projection_guard"
BEFORE UPDATE OF "projectId", "status", "paidAmountCents"
ON "ProjectExpenseRequest"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_finance_parent_projection();

ALTER TABLE "FinanceRecord"
  VALIDATE CONSTRAINT "FinanceRecord_project_expense_owner_fk";
ALTER TABLE "FinanceRecord"
  VALIDATE CONSTRAINT "FinanceRecord_createdByUserId_fkey";
ALTER TABLE "FinanceRecord"
  VALIDATE CONSTRAINT
    "FinanceRecord_project_expense_idempotency_key_format_check";
ALTER TABLE "FinanceRecord"
  VALIDATE CONSTRAINT "FinanceRecord_project_expense_source_check";
ALTER TABLE "FinanceRecord"
  VALIDATE CONSTRAINT
    "FinanceRecord_project_expense_amount_positive_check";

COMMIT;
