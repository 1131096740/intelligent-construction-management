BEGIN;

DROP INDEX IF EXISTS "SpotProcurementPayment_one_current_per_procurement";

CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement"
  ON "SpotProcurementPayment"("procurementId")
  WHERE "status" NOT IN ('invalidated', 'voided', 'withdrawn', 'rejected', 'returned');

COMMIT;
