BEGIN;

ALTER TABLE "ContractVersion"
  ADD COLUMN "estimatedAmountCents" BIGINT;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_estimated_amount_nonnegative_check"
  CHECK (
    "estimatedAmountCents" IS NULL
    OR "estimatedAmountCents" >= 0
  );

COMMENT ON COLUMN "ContractVersion"."estimatedAmountCents" IS
  'Optional planning estimate for an unlimited-total contract; never a legal amount or payment capacity.';

COMMIT;
