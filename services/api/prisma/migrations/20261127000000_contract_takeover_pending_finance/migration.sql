BEGIN;

ALTER TABLE "ContractTakeover"
  DROP CONSTRAINT "ContractTakeover_status_check",
  ADD CONSTRAINT "ContractTakeover_status_check"
  CHECK (
    "takeoverStatus" IN ('draft', 'pending_review', 'pending_finance', 'confirmed', 'needs_supplement', 'voided', 'abandoned')
  ) NOT VALID;

COMMIT;
