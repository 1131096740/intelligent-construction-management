ALTER TABLE "InvoiceRecord"
  ADD COLUMN "commandIdempotencyKey" TEXT,
  ADD COLUMN "commandFingerprint" TEXT;

CREATE UNIQUE INDEX "InvoiceRecord_commandIdempotencyKey_key"
  ON "InvoiceRecord"("commandIdempotencyKey");
CREATE INDEX "InvoiceRecord_commandFingerprint_idx"
  ON "InvoiceRecord"("commandFingerprint");
