-- The nullable fields deliberately leave historical contract versions unconfirmed.
-- Runtime gates require a contract director confirmation before a new ordinary
-- settlement or contract-due payment can be created from those versions.
ALTER TABLE "ContractVersion"
  ADD COLUMN "settlementMode" TEXT,
  ADD COLUMN "settlementModeSource" TEXT,
  ADD COLUMN "settlementModeConfirmedByUserId" TEXT,
  ADD COLUMN "settlementModeConfirmedAt" TIMESTAMP(3);

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_settlementMode_check"
  CHECK (
    "settlementMode" IS NULL
    OR "settlementMode" IN ('settlement_required', 'direct_payment')
  ) NOT VALID,
  ADD CONSTRAINT "ContractVersion_settlementModeSource_check"
  CHECK (
    "settlementModeSource" IS NULL
    OR "settlementModeSource" IN ('rule', 'contract_director', 'inherited', 'backfill')
  ) NOT VALID,
  ADD CONSTRAINT "ContractVersion_settlementModeSource_required_check"
  CHECK (("settlementMode" IS NULL) = ("settlementModeSource" IS NULL)) NOT VALID,
  ADD CONSTRAINT "ContractVersion_settlementModeConfirmation_check"
  CHECK (
    "settlementModeConfirmedAt" IS NULL
    OR "settlementModeConfirmedByUserId" IS NOT NULL
  ) NOT VALID;
