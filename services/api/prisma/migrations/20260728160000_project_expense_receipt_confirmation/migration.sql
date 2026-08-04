BEGIN;

-- The retained ProjectExpenseRequest receipt fact is historical compatibility
-- only. Freeze receipt writers while legacy rows are scanned and guards are
-- installed; deployment fails immediately instead of racing a live writer.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(190731, 15) THEN
    RAISE EXCEPTION
      'project_expense_receipt_migration_requires_quiescence'
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
        ('AuditLog'),
        ('ProjectExpenseRequest'),
        ('User')
    ) tables("tableName")
    ORDER BY "tableName"
  LOOP
    BEGIN
      EXECUTE format(
        'LOCK TABLE %I IN ACCESS EXCLUSIVE MODE NOWAIT',
        required_table."tableName"
      );
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION
          'project_expense_receipt_migration_requires_quiescence table=%',
          required_table."tableName"
          USING ERRCODE = '55P03';
    END;
  END LOOP;
END;
$$;

-- Retained rows must already be complete receipt facts. No actor, timestamp,
-- purchase execution or lifecycle state is guessed or repaired here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    WHERE (request."receiptConfirmedAt" IS NULL)
      IS DISTINCT FROM
      (request."receiptConfirmedByUserId" IS NULL)
      OR (
        request."receiptConfirmedAt" IS NULL
        AND request."receiptConfirmationNote" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_shape_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    WHERE request."receiptConfirmedAt" IS NOT NULL
      AND (
        request."expenseType" IS DISTINCT FROM 'spot_purchase'
        OR request."purchaseExecutedAt" IS NULL
        OR request."status" NOT IN (
          'approved_pending_payment',
          'partially_paid',
          'paid',
          'payment_blocked'
        )
        OR request."receiptConfirmedAt" < request."purchaseExecutedAt"
        OR request."receiptConfirmedByUserId"
          IS DISTINCT FROM request."applicantUserId"
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_business_fact_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    LEFT JOIN "User" actor
      ON actor."id" = request."receiptConfirmedByUserId"
    WHERE request."receiptConfirmedAt" IS NOT NULL
      AND actor."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_actor_missing'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Legacy receipt audits predate idempotency metadata. They must still close
-- exactly over business, project, actor and server timestamp in both
-- directions before immutable guards are installed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    WHERE request."receiptConfirmedAt" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "AuditLog" audit
        WHERE audit."action" = 'project_expense.receipt.confirm'
          AND audit."businessType" = 'project_expense_request'
          AND audit."businessId" = request."id"
          AND audit."actorUserId"
            IS NOT DISTINCT FROM request."receiptConfirmedByUserId"
          AND audit."metadata"->>'projectId'
            IS NOT DISTINCT FROM request."projectId"
          AND audit."metadata"->>'confirmedAt'
            IS NOT DISTINCT FROM to_char(
              request."receiptConfirmedAt",
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_audit_missing_or_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.receipt.confirm'
      AND audit."businessType" = 'project_expense_request'
      AND NOT EXISTS (
        SELECT 1
        FROM "ProjectExpenseRequest" request
        WHERE request."id" = audit."businessId"
          AND request."receiptConfirmedAt" IS NOT NULL
          AND request."receiptConfirmedByUserId"
            IS NOT DISTINCT FROM audit."actorUserId"
          AND request."projectId"
            IS NOT DISTINCT FROM audit."metadata"->>'projectId'
          AND to_char(
            request."receiptConfirmedAt",
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) IS NOT DISTINCT FROM audit."metadata"->>'confirmedAt'
      )
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_audit_reverse_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.receipt.confirm'
      AND audit."businessType" = 'project_expense_request'
      AND audit."businessId" IS NOT NULL
    GROUP BY audit."businessId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_audit_duplicate'
      USING
        ERRCODE = '23514',
        CONSTRAINT =
          'AuditLog_project_expense_receipt_confirm_business_key';
  END IF;
END;
$$;

ALTER TABLE "ProjectExpenseRequest"
  ADD COLUMN "receiptConfirmationIdempotencyKey" TEXT;

CREATE UNIQUE INDEX
  "ProjectExpenseRequest_receiptConfirmationIdempotencyKey_key"
  ON "ProjectExpenseRequest"("receiptConfirmationIdempotencyKey");

CREATE UNIQUE INDEX
  "AuditLog_project_expense_receipt_confirm_business_key"
  ON "AuditLog"("businessId")
  WHERE "action" = 'project_expense.receipt.confirm'
    AND "businessType" = 'project_expense_request'
    AND "businessId" IS NOT NULL;

ALTER TABLE "ProjectExpenseRequest"
  ADD CONSTRAINT
    "ProjectExpenseRequest_receiptConfirmedByUserId_fkey"
  FOREIGN KEY ("receiptConfirmedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "ProjectExpenseRequest"
  ADD CONSTRAINT "ProjectExpenseRequest_receipt_shape_check"
  CHECK (
    (
      "receiptConfirmedAt" IS NULL
      AND "receiptConfirmedByUserId" IS NULL
      AND "receiptConfirmationIdempotencyKey" IS NULL
      AND "receiptConfirmationNote" IS NULL
    )
    OR (
      "receiptConfirmedAt" IS NOT NULL
      AND "receiptConfirmedByUserId" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "ProjectExpenseRequest"
  ADD CONSTRAINT
    "ProjectExpenseRequest_receipt_idempotency_format_check"
  CHECK (
    "receiptConfirmationIdempotencyKey" IS NULL
    OR (
      "receiptConfirmationIdempotencyKey" =
        LOWER("receiptConfirmationIdempotencyKey")
      AND "receiptConfirmationIdempotencyKey" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) NOT VALID;

ALTER TABLE "ProjectExpenseRequest"
  ADD CONSTRAINT "ProjectExpenseRequest_receipt_business_check"
  CHECK (
    "receiptConfirmedAt" IS NULL
    OR (
      "expenseType" = 'spot_purchase'
      AND "purchaseExecutedAt" IS NOT NULL
      AND "receiptConfirmedAt" >= "purchaseExecutedAt"
      AND "receiptConfirmedByUserId" = "applicantUserId"
      AND "status" IN (
        'approved_pending_payment',
        'partially_paid',
        'paid',
        'payment_blocked'
      )
    )
  ) NOT VALID;

CREATE FUNCTION guard_project_expense_receipt_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."receiptConfirmedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'project_expense_receipt_immutable_delete'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."receiptConfirmedAt" IS NOT NULL
      OR NEW."receiptConfirmedByUserId" IS NOT NULL
      OR NEW."receiptConfirmationIdempotencyKey" IS NOT NULL
      OR NEW."receiptConfirmationNote" IS NOT NULL
    THEN
      RAISE EXCEPTION 'project_expense_receipt_insert_forbidden'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."receiptConfirmedAt" IS NOT NULL THEN
    IF NEW."receiptConfirmedAt"
        IS DISTINCT FROM OLD."receiptConfirmedAt"
      OR NEW."receiptConfirmedByUserId"
        IS DISTINCT FROM OLD."receiptConfirmedByUserId"
      OR NEW."receiptConfirmationIdempotencyKey"
        IS DISTINCT FROM OLD."receiptConfirmationIdempotencyKey"
      OR NEW."receiptConfirmationNote"
        IS DISTINCT FROM OLD."receiptConfirmationNote"
    THEN
      RAISE EXCEPTION 'project_expense_receipt_immutable_update'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
      OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."expenseType" IS DISTINCT FROM OLD."expenseType"
      OR NEW."applicantUserId"
        IS DISTINCT FROM OLD."applicantUserId"
      OR NEW."purchaseExecutedAt"
        IS DISTINCT FROM OLD."purchaseExecutedAt"
    THEN
      RAISE EXCEPTION
        'project_expense_receipt_coordinates_immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."receiptConfirmedAt" IS NULL THEN
    IF NEW."receiptConfirmedByUserId" IS NOT NULL
      OR NEW."receiptConfirmationIdempotencyKey" IS NOT NULL
      OR NEW."receiptConfirmationNote" IS NOT NULL
    THEN
      RAISE EXCEPTION 'project_expense_receipt_shape_invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."receiptConfirmedByUserId" IS NOT NULL
    OR OLD."receiptConfirmationIdempotencyKey" IS NOT NULL
    OR OLD."receiptConfirmationNote" IS NOT NULL
  THEN
    RAISE EXCEPTION 'project_expense_receipt_shape_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."expenseType" IS DISTINCT FROM OLD."expenseType"
    OR NEW."applicantUserId" IS DISTINCT FROM OLD."applicantUserId"
    OR NEW."purchaseExecutedAt"
      IS DISTINCT FROM OLD."purchaseExecutedAt"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  THEN
    RAISE EXCEPTION 'project_expense_receipt_coordinates_changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."receiptConfirmationIdempotencyKey" IS NULL THEN
    RAISE EXCEPTION 'project_expense_receipt_idempotency_required'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."receiptConfirmationIdempotencyKey" <>
      LOWER(NEW."receiptConfirmationIdempotencyKey")
    OR NEW."receiptConfirmationIdempotencyKey" !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'project_expense_receipt_idempotency_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."expenseType" IS DISTINCT FROM 'spot_purchase'
    OR NEW."purchaseExecutedAt" IS NULL
    OR NEW."receiptConfirmedAt" < NEW."purchaseExecutedAt"
    OR NEW."receiptConfirmedByUserId"
      IS DISTINCT FROM NEW."applicantUserId"
    OR NEW."status" NOT IN (
      'approved_pending_payment',
      'partially_paid',
      'paid',
      'payment_blocked'
    )
  THEN
    RAISE EXCEPTION 'project_expense_receipt_business_fact_invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectExpenseRequest_receipt_fact_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ProjectExpenseRequest"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_receipt_fact();

CREATE FUNCTION validate_project_expense_receipt_closed_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "AuditLog" audit
    WHERE audit."action" = 'project_expense.receipt.confirm'
      AND audit."businessType" = 'project_expense_request'
      AND audit."businessId" = NEW."id"
      AND audit."actorUserId"
        IS NOT DISTINCT FROM NEW."receiptConfirmedByUserId"
      AND audit."metadata"->>'code'
        IS NOT DISTINCT FROM NEW."code"
      AND audit."metadata"->>'projectId'
        IS NOT DISTINCT FROM NEW."projectId"
      AND audit."metadata"->>'idempotencyKey'
        IS NOT DISTINCT FROM
          NEW."receiptConfirmationIdempotencyKey"
      AND audit."metadata"->>'confirmedByUserId'
        IS NOT DISTINCT FROM NEW."receiptConfirmedByUserId"
      AND audit."metadata"->>'confirmedAt'
        IS NOT DISTINCT FROM to_char(
          NEW."receiptConfirmedAt",
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      AND audit."metadata"->>'note'
        IS NOT DISTINCT FROM NEW."receiptConfirmationNote"
      AND audit."metadata"->>'statusAtConfirmation'
        IS NOT DISTINCT FROM NEW."status"
      AND audit."metadata"->>'paymentCompleted'
        IS NOT DISTINCT FROM (NEW."status" = 'paid')::TEXT
      AND audit."metadata"->>'expectedExpenseUpdatedAt'
        IS NOT DISTINCT FROM to_char(
          OLD."updatedAt",
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
  ) THEN
    RAISE EXCEPTION 'project_expense_receipt_closed_fact_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "ProjectExpenseRequest_receipt_closed_fact_guard"
AFTER UPDATE ON "ProjectExpenseRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD."receiptConfirmedAt" IS NULL
  AND NEW."receiptConfirmedAt" IS NOT NULL
)
EXECUTE FUNCTION validate_project_expense_receipt_closed_fact();

CREATE FUNCTION validate_project_expense_receipt_audit_fact()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ProjectExpenseRequest" request
    WHERE request."id" = NEW."businessId"
      AND request."receiptConfirmedAt" IS NOT NULL
      AND request."receiptConfirmedByUserId"
        IS NOT DISTINCT FROM NEW."actorUserId"
      AND request."code"
        IS NOT DISTINCT FROM NEW."metadata"->>'code'
      AND request."projectId"
        IS NOT DISTINCT FROM NEW."metadata"->>'projectId'
      AND request."receiptConfirmationIdempotencyKey"
        IS NOT DISTINCT FROM NEW."metadata"->>'idempotencyKey'
      AND request."receiptConfirmedByUserId"
        IS NOT DISTINCT FROM NEW."metadata"->>'confirmedByUserId'
      AND to_char(
        request."receiptConfirmedAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) IS NOT DISTINCT FROM NEW."metadata"->>'confirmedAt'
      AND request."receiptConfirmationNote"
        IS NOT DISTINCT FROM NEW."metadata"->>'note'
      AND request."status"
        IS NOT DISTINCT FROM NEW."metadata"->>'statusAtConfirmation'
      AND (request."status" = 'paid')::TEXT
        IS NOT DISTINCT FROM NEW."metadata"->>'paymentCompleted'
  ) THEN
    RAISE EXCEPTION
      'project_expense_receipt_audit_closed_fact_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "AuditLog_project_expense_receipt_closed_fact_guard"
AFTER INSERT ON "AuditLog"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  NEW."action" = 'project_expense.receipt.confirm'
  AND NEW."businessType" = 'project_expense_request'
)
EXECUTE FUNCTION validate_project_expense_receipt_audit_fact();

CREATE FUNCTION guard_project_expense_receipt_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."action" = 'project_expense.receipt.confirm'
      AND OLD."businessType" = 'project_expense_request'
    THEN
      RAISE EXCEPTION
        'project_expense_receipt_audit_immutable_delete'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF (
    OLD."action" = 'project_expense.receipt.confirm'
    AND OLD."businessType" = 'project_expense_request'
  ) OR (
    NEW."action" = 'project_expense.receipt.confirm'
    AND NEW."businessType" = 'project_expense_request'
  ) THEN
    RAISE EXCEPTION
      'project_expense_receipt_audit_immutable_update'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_project_expense_receipt_immutable"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION guard_project_expense_receipt_audit_immutable();

ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT
    "ProjectExpenseRequest_receiptConfirmedByUserId_fkey";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT "ProjectExpenseRequest_receipt_shape_check";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT
    "ProjectExpenseRequest_receipt_idempotency_format_check";
ALTER TABLE "ProjectExpenseRequest"
  VALIDATE CONSTRAINT "ProjectExpenseRequest_receipt_business_check";

COMMIT;
