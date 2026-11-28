-- Preparation only: preserve legacy values and NULL. No data rewrite or execution.
ALTER TABLE "SpotProcurementVersion"
  ADD COLUMN "requestProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "estimatedTotalAmount" DECIMAL(24,4),
  ALTER COLUMN "requestedArrivalAt" DROP NOT NULL,
  ADD CONSTRAINT "SpotProcurementVersion_request_protocol_check" CHECK ("requestProtocolVersion" IN (1,2)),
  ADD CONSTRAINT "SpotProcurementVersion_draft_revision_check" CHECK ("draftRevision" >= 1),
  ADD CONSTRAINT "SpotProcurementVersion_estimate_nonnegative_check" CHECK ("estimatedTotalAmount" IS NULL OR "estimatedTotalAmount" >= 0);
ALTER TABLE "SpotProcurementLine"
  ALTER COLUMN "unit" DROP NOT NULL,
  ALTER COLUMN "quantity" DROP NOT NULL,
  ADD COLUMN "estimatedUnitPrice" DECIMAL(24,4),
  ADD COLUMN "estimatedAmount" DECIMAL(24,4),
  ADD CONSTRAINT "SpotProcurementLine_estimate_price_nonnegative_check" CHECK ("estimatedUnitPrice" IS NULL OR "estimatedUnitPrice" >= 0),
  ADD CONSTRAINT "SpotProcurementLine_estimate_amount_nonnegative_check" CHECK ("estimatedAmount" IS NULL OR "estimatedAmount" >= 0);
