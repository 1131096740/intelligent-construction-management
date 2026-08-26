CREATE TABLE "InvoiceLifecycleEvent" (
  "id" TEXT NOT NULL,
  "invoiceRecordId" TEXT NOT NULL,
  "relatedInvoiceRecordId" TEXT,
  "kind" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLifecycleEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceLifecycleEvent_kind_check" CHECK ("kind" IN ('void', 'red', 'reissue')),
  CONSTRAINT "InvoiceLifecycleEvent_reason_check" CHECK (btrim("reasonCode") <> '')
);
CREATE UNIQUE INDEX "InvoiceLifecycleEvent_idempotencyKey_key" ON "InvoiceLifecycleEvent"("idempotencyKey");
CREATE INDEX "InvoiceLifecycleEvent_invoiceRecordId_createdAt_idx" ON "InvoiceLifecycleEvent"("invoiceRecordId", "createdAt");
CREATE INDEX "InvoiceLifecycleEvent_relatedInvoiceRecordId_idx" ON "InvoiceLifecycleEvent"("relatedInvoiceRecordId");
CREATE INDEX "InvoiceLifecycleEvent_kind_createdAt_idx" ON "InvoiceLifecycleEvent"("kind", "createdAt");
ALTER TABLE "InvoiceLifecycleEvent" ADD CONSTRAINT "InvoiceLifecycleEvent_invoiceRecordId_fkey" FOREIGN KEY ("invoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLifecycleEvent" ADD CONSTRAINT "InvoiceLifecycleEvent_relatedInvoiceRecordId_fkey" FOREIGN KEY ("relatedInvoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InvoiceRedAllocationReference" (
  "id" TEXT NOT NULL,
  "lifecycleEventId" TEXT NOT NULL,
  "redInvoiceRecordId" TEXT NOT NULL,
  "blueInvoiceAllocationId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceRedAllocationReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceRedAllocationReference_amount_positive_check" CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "InvoiceRedAllocationReference_lifecycleEventId_blueInvoiceAllocationId_key" ON "InvoiceRedAllocationReference"("lifecycleEventId", "blueInvoiceAllocationId");
CREATE INDEX "InvoiceRedAllocationReference_redInvoiceRecordId_idx" ON "InvoiceRedAllocationReference"("redInvoiceRecordId");
CREATE INDEX "InvoiceRedAllocationReference_blueInvoiceAllocationId_idx" ON "InvoiceRedAllocationReference"("blueInvoiceAllocationId");
ALTER TABLE "InvoiceRedAllocationReference" ADD CONSTRAINT "InvoiceRedAllocationReference_lifecycleEventId_fkey" FOREIGN KEY ("lifecycleEventId") REFERENCES "InvoiceLifecycleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRedAllocationReference" ADD CONSTRAINT "InvoiceRedAllocationReference_redInvoiceRecordId_fkey" FOREIGN KEY ("redInvoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceRedAllocationReference" ADD CONSTRAINT "InvoiceRedAllocationReference_blueInvoiceAllocationId_fkey" FOREIGN KEY ("blueInvoiceAllocationId") REFERENCES "InvoiceClearingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_invoice_lifecycle_mutation"()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'invoice lifecycle facts are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoiceLifecycleEvent_immutable" BEFORE UPDATE OR DELETE ON "InvoiceLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_lifecycle_mutation"();
CREATE TRIGGER "InvoiceRedAllocationReference_immutable" BEFORE UPDATE OR DELETE ON "InvoiceRedAllocationReference" FOR EACH ROW EXECUTE FUNCTION "prevent_invoice_lifecycle_mutation"();
