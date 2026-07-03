ALTER TABLE "PaymentRequest" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'settlement';

ALTER TABLE "PaymentRequest" ALTER COLUMN "settlementId" DROP NOT NULL;

ALTER TABLE "PaymentExecution" ALTER COLUMN "settlementId" DROP NOT NULL;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_sourceType_check"
  CHECK ("sourceType" IN ('settlement', 'contract_advance'));

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_source_settlement_check"
  CHECK (
    ("sourceType" = 'settlement' AND "settlementId" IS NOT NULL)
    OR ("sourceType" = 'contract_advance' AND "settlementId" IS NULL)
  );
