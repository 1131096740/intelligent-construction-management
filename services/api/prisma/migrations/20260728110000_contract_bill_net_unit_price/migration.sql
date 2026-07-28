BEGIN;

ALTER TABLE "ContractBillRow"
  ADD COLUMN "taxExclusiveUnitPrice" DECIMAL(24, 6);

COMMIT;
