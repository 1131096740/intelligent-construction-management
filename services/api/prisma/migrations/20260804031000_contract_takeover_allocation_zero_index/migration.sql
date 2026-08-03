BEGIN;

SELECT pg_advisory_xact_lock(190731, 28);

ALTER TABLE "ContractTakeoverHistoricalPaymentAllocation"
  DROP CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_order_positive_check";

ALTER TABLE "ContractTakeoverHistoricalPaymentAllocation"
  ADD CONSTRAINT "ContractTakeoverHistoricalPaymentAllocation_order_positive_check"
  CHECK ("allocationOrder" >= 0);

COMMIT;
