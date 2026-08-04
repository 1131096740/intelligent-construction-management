BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);

-- Close the inspection-to-install window for every registered FileObject owner.
DO $$
DECLARE
  binding_table RECORD;
BEGIN
  FOR binding_table IN
    SELECT "tableName"
    FROM (
      SELECT DISTINCT "tableName"
      FROM jg_file_business_binding_columns()
      UNION
      SELECT 'FileObject'
    ) binding_tables
    ORDER BY "tableName"
  LOOP
    EXECUTE format(
      'LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',
      binding_table."tableName"
    );
  END LOOP;
END;
$$;

-- A voucher represents one immutable payment fact. Existing conflicts are
-- deployment blockers; this migration never deduplicates or rewrites them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution"
    GROUP BY "voucherFileId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'payment_execution_duplicate_voucher'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'PaymentExecution_voucherFileId_key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    LEFT JOIN "FileObject" file
      ON file."id" = execution."voucherFileId"
    WHERE file."id" IS NULL
      OR file."storageStatus" IS DISTINCT FROM 'active'
      OR file."uploadedByUserId"
        IS DISTINCT FROM execution."executedByUserId"
  ) THEN
    RAISE EXCEPTION
      'payment_execution_voucher_owner_or_status_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- The cached paid amount and settlement owner are part of the same immutable
-- money fact. Any historical drift must be reconciled explicitly before the
-- release; this migration never rewrites amounts or ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    JOIN "PaymentRequest" payment
      ON payment."id" = execution."paymentRequestId"
    WHERE execution."settlementId"
      IS DISTINCT FROM payment."settlementId"
  ) THEN
    RAISE EXCEPTION 'payment_execution_settlement_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentRequest" payment
    LEFT JOIN (
      SELECT
        "paymentRequestId",
        SUM("amountCents") AS "executedAmountCents"
      FROM "PaymentExecution"
      GROUP BY "paymentRequestId"
    ) execution_total
      ON execution_total."paymentRequestId" = payment."id"
    WHERE payment."paidAmountCents"
      <> COALESCE(execution_total."executedAmountCents", 0::BIGINT)
  ) THEN
    RAISE EXCEPTION 'payment_execution_payment_paid_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Settlement" settlement
    LEFT JOIN (
      SELECT
        "settlementId",
        SUM("amountCents") AS "executedAmountCents"
      FROM "PaymentExecution"
      GROUP BY "settlementId"
    ) execution_total
      ON execution_total."settlementId" = settlement."id"
    WHERE settlement."sourceType" IS DISTINCT FROM 'historical_takeover'
      AND settlement."paidAmountCents"
        <> COALESCE(execution_total."executedAmountCents", 0::BIGINT)
  ) THEN
    RAISE EXCEPTION 'payment_execution_settlement_paid_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentRequest"
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
  ) THEN
    RAISE EXCEPTION 'payment_execution_payment_status_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Settlement" settlement
    WHERE settlement."sourceType" IS DISTINCT FROM 'historical_takeover'
      AND (
        (
          settlement."status" = 'effective'
          AND settlement."paidAmountCents" <> 0
        )
        OR (
          settlement."status" = 'partially_paid'
          AND (
            settlement."paidAmountCents" <= 0
            OR settlement."paidAmountCents" >= settlement."payableAmountCents"
          )
        )
        OR (
          settlement."status" = 'paid'
          AND settlement."paidAmountCents" <> settlement."payableAmountCents"
        )
      )
  ) THEN
    RAISE EXCEPTION 'payment_execution_settlement_status_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    JOIN "PaymentRequest" payment
      ON payment."id" = execution."paymentRequestId"
    WHERE payment."status" NOT IN ('partially_paid', 'paid')
  ) THEN
    RAISE EXCEPTION 'payment_execution_payment_owner_status_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    JOIN "Settlement" settlement
      ON settlement."id" = execution."settlementId"
    WHERE settlement."status" NOT IN ('partially_paid', 'paid')
  ) THEN
    RAISE EXCEPTION 'payment_execution_settlement_owner_status_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Every retained execution must already have the project-funding debit and
-- minimum legacy audit evidence emitted by the payment service. The migration
-- accepts a project-cash plus multi-quota split, but never invents either fact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "ProjectFundingAllocation" allocation
      WHERE allocation."executionType" = 'payment_execution'
        AND allocation."executionId" = execution."id"
        AND allocation."direction" = 'debit'
        AND allocation."reversalKey" = 'original'
    )
  ) THEN
    RAISE EXCEPTION 'payment_execution_funding_allocation_missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    LEFT JOIN "PaymentRequest" payment
      ON payment."id" = execution."paymentRequestId"
    WHERE payment."id" IS NULL
      OR (
        SELECT SUM(allocation."amountCents")
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'payment_execution'
          AND allocation."executionId" = execution."id"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
      ) IS DISTINCT FROM execution."amountCents"
      OR EXISTS (
        SELECT 1
        FROM "ProjectFundingAllocation" allocation
        WHERE allocation."executionType" = 'payment_execution'
          AND allocation."executionId" = execution."id"
          AND allocation."direction" = 'debit'
          AND allocation."reversalKey" = 'original'
          AND (
            allocation."projectId"
              IS DISTINCT FROM payment."projectId"
            OR allocation."businessType"
              IS DISTINCT FROM 'payment_request'
            OR allocation."businessId"
              IS DISTINCT FROM payment."id"
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
    RAISE EXCEPTION 'payment_execution_funding_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "AuditLog" audit
      WHERE audit."action" = 'payment.execution.record'
        AND audit."businessType" = 'payment_request'
        AND audit."businessId" = execution."paymentRequestId"
    )
  ) THEN
    RAISE EXCEPTION 'payment_execution_audit_missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    WHERE NOT EXISTS (
      SELECT 1
      FROM "AuditLog" audit
      WHERE audit."action" = 'payment.execution.record'
        AND audit."businessType" = 'payment_request'
        AND audit."businessId" = execution."paymentRequestId"
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
    RAISE EXCEPTION 'payment_execution_audit_mismatch'
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
    FROM "PaymentExecution"
    ORDER BY "voucherFileId", "id"
  LOOP
    FOR registered_binding IN
      SELECT *
      FROM jg_file_business_collision_columns()
      WHERE NOT (
        "tableName" = 'PaymentExecution'
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
          'payment_execution_cross_business_voucher fileId=%',
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
        'payment_execution_cross_business_voucher fileId=%',
        execution_voucher."voucherFileId"
        USING
          ERRCODE = '23514',
          CONSTRAINT = 'exclusive_file_business_binding_guard';
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE "PaymentExecution"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "companyEntityIdSnapshot" TEXT,
  ADD COLUMN "companyEntityNameSnapshot" TEXT,
  ADD COLUMN "companyEntityCreditCodeSnapshot" TEXT;

UPDATE "PaymentExecution" execution
SET
  "idempotencyKey" = 'legacy:payment_execution:' || execution."id",
  "companyEntityIdSnapshot" = version."companyEntityIdSnapshot",
  "companyEntityNameSnapshot" = version."companyEntityNameSnapshot",
  "companyEntityCreditCodeSnapshot" = version."companyEntityCreditCodeSnapshot"
FROM "PaymentRequest" payment
JOIN "ContractVersion" version
  ON version."id" = payment."contractVersionId"
WHERE payment."id" = execution."paymentRequestId";

UPDATE "PaymentExecution"
SET "idempotencyKey" = 'legacy:payment_execution:' || "id"
WHERE "idempotencyKey" IS NULL;

-- A payment execution is an immutable company-payment fact. Do not invent a
-- historical payer from today's company master: incomplete legacy facts and
-- active requests must be remediated explicitly before this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution"
    WHERE "paymentSubjectType" <> 'our_company'
      OR NULLIF(BTRIM("companyEntityIdSnapshot"), '') IS NULL
      OR NULLIF(BTRIM("companyEntityNameSnapshot"), '') IS NULL
      OR NULLIF(BTRIM("companyEntityCreditCodeSnapshot"), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'payment_execution_incomplete_payer_snapshot'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'PaymentExecution_company_payer_snapshot_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentExecution" execution
    LEFT JOIN "PaymentRequest" payment
      ON payment."id" = execution."paymentRequestId"
    LEFT JOIN "ContractVersion" version
      ON version."id" = payment."contractVersionId"
    WHERE payment."id" IS NULL
      OR payment."paymentSubjectType" <> 'our_company'
      OR version."id" IS NULL
      OR version."signingSubjectType" <> 'our_company'
      OR execution."companyEntityIdSnapshot"
        IS DISTINCT FROM version."companyEntityIdSnapshot"
      OR execution."companyEntityNameSnapshot"
        IS DISTINCT FROM version."companyEntityNameSnapshot"
      OR execution."companyEntityCreditCodeSnapshot"
        IS DISTINCT FROM version."companyEntityCreditCodeSnapshot"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_lineage_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PaymentRequest" payment
    LEFT JOIN "ContractVersion" version
      ON version."id" = payment."contractVersionId"
    WHERE payment."status" IN (
        'draft',
        'approval_pending',
        'in_approval',
        'approved_pending_payment',
        'partially_paid'
      )
      AND (
        payment."paymentSubjectType" <> 'our_company'
        OR version."id" IS NULL
        OR version."signingSubjectType" <> 'our_company'
        OR NULLIF(BTRIM(version."companyEntityIdSnapshot"), '') IS NULL
        OR NULLIF(BTRIM(version."companyEntityNameSnapshot"), '') IS NULL
        OR NULLIF(BTRIM(version."companyEntityCreditCodeSnapshot"), '') IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'payment_execution_active_request_payer_snapshot_incomplete'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "PaymentExecution"
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "companyEntityIdSnapshot" SET NOT NULL,
  ALTER COLUMN "companyEntityNameSnapshot" SET NOT NULL,
  ALTER COLUMN "companyEntityCreditCodeSnapshot" SET NOT NULL;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_company_payer_snapshot_check"
  CHECK (
    "paymentSubjectType" = 'our_company'
    AND BTRIM("companyEntityIdSnapshot") <> ''
    AND BTRIM("companyEntityNameSnapshot") <> ''
    AND BTRIM("companyEntityCreditCodeSnapshot") <> ''
  ) NOT VALID;

ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_idempotency_key_format_check"
  CHECK (
    "idempotencyKey" LIKE 'legacy:payment_execution:%'
    OR (
      "idempotencyKey" = LOWER("idempotencyKey")
      AND "idempotencyKey" ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) NOT VALID;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_payment_status_amount_check"
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
      "status" NOT IN (
        'approved_pending_payment',
        'partially_paid',
        'paid'
      )
      AND "paidAmountCents" = 0
    )
  ) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_payment_status_amount_check"
  CHECK (
    "sourceType" = 'historical_takeover'
    OR (
      (
        "status" = 'effective'
        AND "paidAmountCents" = 0
      )
      OR (
        "status" = 'partially_paid'
        AND "paidAmountCents" > 0
        AND "paidAmountCents" < "payableAmountCents"
      )
      OR (
        "status" = 'paid'
        AND "paidAmountCents" = "payableAmountCents"
      )
      OR (
        "status" NOT IN ('effective', 'partially_paid', 'paid')
        AND "paidAmountCents" = 0
      )
    )
  ) NOT VALID;

CREATE UNIQUE INDEX "PaymentExecution_idempotencyKey_key"
  ON "PaymentExecution"("idempotencyKey");

CREATE UNIQUE INDEX "PaymentExecution_voucherFileId_key"
  ON "PaymentExecution"("voucherFileId");

-- Promote the standard payment voucher from a reusable reference to an
-- exclusive business fact without copying the frozen manifest.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_payment_execution;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    "tableName",
    "columnName",
    CASE
      WHEN "tableName" = 'PaymentExecution' AND "columnName" = 'voucherFileId' THEN TRUE
      ELSE "exclusive"
    END
  FROM jg_file_business_binding_columns_before_payment_execution();
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
      AND relation.relname = 'PaymentExecution'
      AND procedure.proname = 'jg_enforce_exclusive_file_business_binding'
    ORDER BY trigger.tgname
  LOOP
    EXECUTE format(
      'DROP TRIGGER %I ON "PaymentExecution"',
      existing_trigger.trigger_name
    );
  END LOOP;
END;
$$;

CREATE TRIGGER jg_efb_payment_execution_voucher
BEFORE INSERT OR UPDATE OF "voucherFileId" ON "PaymentExecution"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('voucherFileId', 'true');

CREATE FUNCTION guard_payment_execution_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_execution_immutable_delete'
      USING ERRCODE = '23514';
  END IF;

  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'payment_execution_immutable_update'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "PaymentExecution_immutable"
BEFORE UPDATE OR DELETE ON "PaymentExecution"
FOR EACH ROW
EXECUTE FUNCTION guard_payment_execution_immutable();

-- These historical NOT VALID constraints already protect new rows. Validating
-- them now turns the release gate into evidence for all retained payment facts.
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_request_fk";
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_settlement_fk";
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_voucher_file_fk";
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_amount_positive_check";
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_company_payer_snapshot_check";
ALTER TABLE "PaymentExecution"
  VALIDATE CONSTRAINT "PaymentExecution_idempotency_key_format_check";
ALTER TABLE "PaymentRequest"
  VALIDATE CONSTRAINT "PaymentRequest_payment_status_amount_check";
ALTER TABLE "PaymentRequest"
  VALIDATE CONSTRAINT "PaymentRequest_paid_nonnegative_check";
ALTER TABLE "PaymentRequest"
  VALIDATE CONSTRAINT "PaymentRequest_paid_lte_approved_check";
ALTER TABLE "Settlement"
  VALIDATE CONSTRAINT "Settlement_payment_status_amount_check";
ALTER TABLE "Settlement"
  VALIDATE CONSTRAINT "Settlement_paid_nonnegative_check";
ALTER TABLE "Settlement"
  VALIDATE CONSTRAINT "Settlement_paid_lte_payable_check";

COMMIT;
