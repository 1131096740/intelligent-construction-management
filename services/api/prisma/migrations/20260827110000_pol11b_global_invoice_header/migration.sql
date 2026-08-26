-- POL-11B: retain legacy project coordinates for historical reads while adding
-- the immutable global invoice-header facts required by new allocations.
ALTER TABLE "InvoiceRecord"
  ADD COLUMN "identityKind" TEXT NOT NULL DEFAULT 'traditional',
  ADD COLUMN "owningCompanyEntityId" TEXT,
  ADD COLUMN "direction" TEXT,
  ADD COLUMN "sellerTaxId" TEXT,
  ADD COLUMN "buyerTaxId" TEXT,
  ADD COLUMN "taxExclusiveAmountCents" BIGINT,
  ADD COLUMN "taxAmountCents" BIGINT;

CREATE INDEX "InvoiceRecord_owningCompanyEntityId_direction_status_idx"
  ON "InvoiceRecord"("owningCompanyEntityId", "direction", "status");

ALTER TABLE "InvoiceRecord"
  ADD CONSTRAINT "InvoiceRecord_direction_check"
    CHECK ("direction" IS NULL OR "direction" IN ('inbound', 'outbound')),
  ADD CONSTRAINT "InvoiceRecord_money_components_check"
    CHECK (
      ("taxExclusiveAmountCents" IS NULL AND "taxAmountCents" IS NULL)
      OR (
        "taxExclusiveAmountCents" >= 0
        AND "taxAmountCents" >= 0
        AND "taxExclusiveAmountCents" + "taxAmountCents" = "totalAmountCents"
      )
    );

CREATE TABLE "InvoiceClearingAllocation" (
  "id" TEXT NOT NULL,
  "invoiceRecordId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "clearingEventVersionId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "structuredReasonCode" TEXT,
  "reversesAllocationId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceClearingAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceClearingAllocation_amount_positive_check" CHECK ("amountCents" > 0)
);
CREATE INDEX "InvoiceClearingAllocation_invoiceRecordId_createdAt_idx" ON "InvoiceClearingAllocation"("invoiceRecordId", "createdAt");
CREATE INDEX "InvoiceClearingAllocation_projectId_eventVersion_idx" ON "InvoiceClearingAllocation"("projectId", "clearingEventVersionId");
CREATE INDEX "InvoiceClearingAllocation_clearingCaseId_idx" ON "InvoiceClearingAllocation"("clearingCaseId");
CREATE INDEX "InvoiceClearingAllocation_reversesAllocationId_idx" ON "InvoiceClearingAllocation"("reversesAllocationId");
CREATE UNIQUE INDEX "InvoiceClearingAllocation_idempotencyKey_key" ON "InvoiceClearingAllocation"("idempotencyKey");
CREATE INDEX "InvoiceClearingAllocation_eventVersion_fingerprint_idx" ON "InvoiceClearingAllocation"("clearingEventVersionId", "requestFingerprint");
ALTER TABLE "InvoiceClearingAllocation" ADD CONSTRAINT "InvoiceClearingAllocation_invoiceRecordId_fkey" FOREIGN KEY ("invoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceClearingAllocation" ADD CONSTRAINT "InvoiceClearingAllocation_clearingCaseId_fkey" FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceClearingAllocation" ADD CONSTRAINT "InvoiceClearingAllocation_clearingEventVersionId_fkey" FOREIGN KEY ("clearingEventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceClearingAllocation" ADD CONSTRAINT "InvoiceClearingAllocation_reversesAllocationId_fkey" FOREIGN KEY ("reversesAllocationId") REFERENCES "InvoiceClearingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_invoice_clearing_allocation_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoice clearing allocations are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoiceClearingAllocation_immutable"
BEFORE UPDATE OR DELETE ON "InvoiceClearingAllocation"
FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_clearing_allocation_mutation"();
