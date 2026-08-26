-- POL-11B: legal invoice headers are global. Historical procurement headers keep
-- their project coordinate, while new clearing headers reach projects only by an
-- immutable InvoiceClearingAllocation.
ALTER TABLE "InvoiceRecord"
  ALTER COLUMN "projectId" DROP NOT NULL;
