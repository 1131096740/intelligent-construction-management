ALTER TABLE "ContractTakeover"
  DROP CONSTRAINT "ContractTakeover_activation_tuple_check",
  ADD CONSTRAINT "ContractTakeover_activation_tuple_check"
  CHECK (
    (
      "activationIdempotencyKey" IS NULL
      AND "activatedAt" IS NULL
      AND "activatedByUserId" IS NULL
      AND "historicalInitialSettlementId" IS NULL
    )
    OR (
      "activationIdempotencyKey" IS NOT NULL
      AND "activatedAt" IS NOT NULL
      AND "activatedByUserId" IS NOT NULL
    )
  );
