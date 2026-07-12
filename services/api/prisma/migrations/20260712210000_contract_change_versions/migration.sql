ALTER TABLE "ContractVersion"
  ADD COLUMN "baseVersionId" TEXT,
  ADD COLUMN "supersedesVersionId" TEXT,
  ADD COLUMN "changeReason" TEXT,
  ADD COLUMN "changeDirection" TEXT,
  ADD COLUMN "changeAmountCents" BIGINT,
  ADD COLUMN "originalBaseAmountCents" BIGINT,
  ADD COLUMN "cumulativeIncreaseCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "cumulativeDecreaseCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "amountLimitType" TEXT NOT NULL DEFAULT 'capped';

ALTER TABLE "ContractBusinessTemplateVersion"
  ADD COLUMN "supplementChangePolicy" JSONB;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_amount_limit_type_check"
    CHECK ("amountLimitType" IN ('capped', 'unlimited')),
  ADD CONSTRAINT "ContractVersion_change_direction_check"
    CHECK ("changeDirection" IS NULL OR "changeDirection" IN ('increase', 'decrease', 'unchanged')),
  ADD CONSTRAINT "ContractVersion_change_amount_check"
    CHECK ("changeAmountCents" IS NULL OR "changeAmountCents" >= 0),
  ADD CONSTRAINT "ContractVersion_change_declaration_check"
    CHECK (
      ("changeType" IN ('original', 'historical_takeover')
        AND "changeReason" IS NULL AND "changeDirection" IS NULL AND "changeAmountCents" IS NULL)
      OR
      ("changeType" IN ('change', 'supplement')
        AND length(btrim("changeReason")) > 0
        AND (
          ("changeDirection" = 'unchanged' AND "changeAmountCents" = 0)
          OR ("changeDirection" IN ('increase', 'decrease') AND "changeAmountCents" > 0)
        ))
    ),
  ADD CONSTRAINT "ContractVersion_cumulative_change_check"
    CHECK ("cumulativeIncreaseCents" >= 0 AND "cumulativeDecreaseCents" >= 0),
  ADD CONSTRAINT "ContractVersion_change_lineage_check"
    CHECK (
      ("changeType" IN ('original', 'historical_takeover') AND "baseVersionId" IS NULL AND "supersedesVersionId" IS NULL)
      OR
      ("changeType" IN ('change', 'supplement') AND "baseVersionId" IS NOT NULL)
    );

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_baseVersionId_fkey"
    FOREIGN KEY ("baseVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractVersion_supersedesVersionId_fkey"
    FOREIGN KEY ("supersedesVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ContractVersion_baseVersionId_idx" ON "ContractVersion"("baseVersionId");
CREATE INDEX "ContractVersion_supersedesVersionId_idx" ON "ContractVersion"("supersedesVersionId");

CREATE UNIQUE INDEX "ContractVersion_one_active_change_per_contract_key"
  ON "ContractVersion"("contractId")
  WHERE "changeType" IN ('change', 'supplement')
    AND "status" IN (
      'draft', 'in_approval', 'approval_rejected', 'approved_pending_seal',
      'in_seal', 'seal_approved_pending_archive', 'pending_archive_confirm'
    );

CREATE UNIQUE INDEX "ContractVersion_one_effective_per_contract_key"
  ON "ContractVersion"("contractId")
  WHERE "status" = 'effective';
