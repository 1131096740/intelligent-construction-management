ALTER TABLE "PaymentRequest"
  DROP CONSTRAINT "PaymentRequest_source_settlement_check";

ALTER TABLE "PaymentRequest"
  DROP CONSTRAINT "PaymentRequest_sourceType_check";

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_sourceType_check"
  CHECK ("sourceType" IN ('settlement', 'contract_advance', 'contract_due'));

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_source_settlement_check"
  CHECK (
    ("sourceType" = 'settlement' AND "settlementId" IS NOT NULL)
    OR ("sourceType" IN ('contract_advance', 'contract_due') AND "settlementId" IS NULL)
  );
