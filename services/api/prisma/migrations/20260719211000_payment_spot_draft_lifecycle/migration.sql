-- M71: add auditable payment and spot-procurement draft lifecycle facts.
BEGIN;

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'PaymentRequest'::regclass
    AND conname = 'PaymentRequest_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''paid''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected PaymentRequest_status_check definition';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'SpotProcurementReceipt'::regclass
    AND conname = 'SpotProcurementReceipt_status_check'
    AND contype = 'c';
  IF definition IS NULL OR position('''draft''' IN definition) = 0 OR position('''locked''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected SpotProcurementReceipt_status_check definition';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "SpotProcurement"
    WHERE "status" NOT IN (
      'draft', 'approval_pending', 'approved_in_progress', 'closed', 'abnormally_terminated', 'voided'
    )
  ) THEN
    RAISE EXCEPTION 'unexpected SpotProcurement status value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "SpotProcurementVersion"
    WHERE "status" NOT IN ('draft', 'approval_pending', 'rejected', 'approved', 'invalidated')
  ) THEN
    RAISE EXCEPTION 'unexpected SpotProcurementVersion status value';
  END IF;
END $$;

ALTER TABLE "PaymentRequest" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "PaymentRequest" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "SpotProcurement" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "SpotProcurement" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "SpotProcurement" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "SpotProcurementVersion" ADD COLUMN "abandonedAt" TIMESTAMP(3);
ALTER TABLE "SpotProcurementVersion" ADD COLUMN "abandonedByUserId" TEXT;
ALTER TABLE "SpotProcurementVersion" ADD COLUMN "abandonReason" TEXT;

ALTER TABLE "SpotProcurementPayment" ADD COLUMN "draftOrigin" TEXT;
ALTER TABLE "SpotProcurementPayment" ADD COLUMN "sourcePaymentId" TEXT;

ALTER TABLE "SpotProcurementReceipt" ADD COLUMN "invalidatedAt" TIMESTAMP(3);
ALTER TABLE "SpotProcurementReceipt" ADD COLUMN "invalidatedByUserId" TEXT;
ALTER TABLE "SpotProcurementReceipt" ADD COLUMN "invalidationReason" TEXT;

ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_status_check";
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_status_check"
  CHECK (
    "status" IN (
      'draft',
      'approval_pending',
      'in_approval',
      'approval_rejected',
      'withdrawn',
      'approved_pending_payment',
      'partially_paid',
      'paid',
      'voided',
      'abandoned'
    )
  ) NOT VALID;
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "SpotProcurement"
  ADD CONSTRAINT "SpotProcurement_status_check"
  CHECK (
    "status" IN (
      'draft',
      'approval_pending',
      'approved_in_progress',
      'closed',
      'abnormally_terminated',
      'voided',
      'abandoned'
    )
  ) NOT VALID;
ALTER TABLE "SpotProcurement"
  ADD CONSTRAINT "SpotProcurement_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "SpotProcurementVersion"
  ADD CONSTRAINT "SpotProcurementVersion_status_check"
  CHECK ("status" IN ('draft', 'approval_pending', 'rejected', 'approved', 'invalidated', 'abandoned')) NOT VALID;
ALTER TABLE "SpotProcurementVersion"
  ADD CONSTRAINT "SpotProcurementVersion_abandonment_facts_check"
  CHECK (
    ("status" = 'abandoned' AND "abandonedAt" IS NOT NULL AND "abandonedByUserId" IS NOT NULL)
    OR
    ("status" <> 'abandoned' AND "abandonedAt" IS NULL AND "abandonedByUserId" IS NULL AND "abandonReason" IS NULL)
  ) NOT VALID;

ALTER TABLE "SpotProcurementReceipt" DROP CONSTRAINT "SpotProcurementReceipt_status_check";
ALTER TABLE "SpotProcurementReceipt"
  ADD CONSTRAINT "SpotProcurementReceipt_status_check"
  CHECK (
    "status" IN (
      'draft',
      'submitted',
      'returned',
      'reviewed',
      'review_revoked',
      'locked',
      'invalidated'
    )
  ) NOT VALID;
ALTER TABLE "SpotProcurementReceipt"
  ADD CONSTRAINT "SpotProcurementReceipt_invalidation_facts_check"
  CHECK (
    (
      "status" = 'invalidated'
      AND "invalidatedAt" IS NOT NULL
      AND "invalidatedByUserId" IS NOT NULL
      AND "invalidationReason" IS NOT NULL
    )
    OR
    (
      "status" <> 'invalidated'
      AND "invalidatedAt" IS NULL
      AND "invalidatedByUserId" IS NULL
      AND "invalidationReason" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "SpotProcurementPayment"
  ADD CONSTRAINT "SpotProcurementPayment_sourcePaymentId_fkey"
  FOREIGN KEY ("sourcePaymentId")
  REFERENCES "SpotProcurementPayment"("id")
  ON DELETE RESTRICT
  ON UPDATE RESTRICT;

CREATE INDEX "PaymentRequest_status_updatedAt_idx" ON "PaymentRequest"("status", "updatedAt");
CREATE INDEX "SpotProcurement_status_updatedAt_idx" ON "SpotProcurement"("status", "updatedAt");
CREATE INDEX "SpotProcurementVersion_status_updatedAt_idx" ON "SpotProcurementVersion"("status", "updatedAt");
CREATE INDEX "SpotProcurementPayment_sourcePaymentId_idx" ON "SpotProcurementPayment"("sourcePaymentId");
CREATE INDEX "SpotProcurementReceipt_status_updatedAt_idx" ON "SpotProcurementReceipt"("status", "updatedAt");

COMMIT;
