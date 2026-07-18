-- New governed contract-due requests freeze the selected payment stage.
-- Existing requests intentionally remain NULL and are not backfilled.
ALTER TABLE "PaymentRequest"
  ADD COLUMN "paymentTermsStageId" TEXT;

CREATE INDEX "PaymentRequest_paymentTermsStageId_idx"
  ON "PaymentRequest"("paymentTermsStageId");

CREATE UNIQUE INDEX "PaymentTermsStage_id_paymentTermsVersionId_key"
  ON "PaymentTermsStage"("id", "paymentTermsVersionId");

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_paymentTermsStage_terms_fkey"
  FOREIGN KEY ("paymentTermsStageId", "paymentTermsVersionId")
  REFERENCES "PaymentTermsStage"("id", "paymentTermsVersionId")
  ON DELETE RESTRICT
  ON UPDATE RESTRICT;

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_paymentTermsStage_source_check"
  CHECK (
    "paymentTermsStageId" IS NULL
    OR "sourceType" = 'contract_due'
  );
