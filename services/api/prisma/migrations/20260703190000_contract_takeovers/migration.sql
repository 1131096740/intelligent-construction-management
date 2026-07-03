ALTER TABLE "Contract"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'system';

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_source_check"
    CHECK ("source" IN ('system', 'historical_takeover'));

CREATE TABLE "ContractTakeover" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "paymentTermsVersionId" TEXT NOT NULL,
  "takeoverLevel" TEXT NOT NULL,
  "takeoverStatus" TEXT NOT NULL,
  "lifecycleStatus" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "historicalSettledCents" BIGINT NOT NULL DEFAULT 0,
  "historicalApprovalPendingPaymentCents" BIGINT NOT NULL DEFAULT 0,
  "historicalApprovedPendingPaymentCents" BIGINT NOT NULL DEFAULT 0,
  "historicalPaidCents" BIGINT NOT NULL DEFAULT 0,
  "historicalProxyPaidCents" BIGINT NOT NULL DEFAULT 0,
  "historicalAdvancePaidCents" BIGINT NOT NULL DEFAULT 0,
  "historicalAdvanceDeductedCents" BIGINT NOT NULL DEFAULT 0,
  "historicalRetentionWithheldCents" BIGINT NOT NULL DEFAULT 0,
  "historicalRetentionReleasedCents" BIGINT NOT NULL DEFAULT 0,
  "otherConfirmedOccupancyCents" BIGINT NOT NULL DEFAULT 0,
  "balanceSourceSummary" TEXT,
  "evidenceSummary" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "historicalBalanceConfirmedByUserId" TEXT,
  "historicalBalanceConfirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTakeover_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeover_level_check"
    CHECK ("takeoverLevel" IN ('A', 'B', 'C')),
  CONSTRAINT "ContractTakeover_status_check"
    CHECK ("takeoverStatus" IN ('draft', 'pending_review', 'confirmed', 'needs_supplement', 'voided')),
  CONSTRAINT "ContractTakeover_lifecycle_status_check"
    CHECK ("lifecycleStatus" IN ('signed_not_started', 'in_progress', 'suspended', 'completed', 'terminated', 'disputed')),
  CONSTRAINT "ContractTakeover_amounts_non_negative_check"
    CHECK (
      "historicalSettledCents" >= 0
      AND "historicalApprovalPendingPaymentCents" >= 0
      AND "historicalApprovedPendingPaymentCents" >= 0
      AND "historicalPaidCents" >= 0
      AND "historicalProxyPaidCents" >= 0
      AND "historicalAdvancePaidCents" >= 0
      AND "historicalAdvanceDeductedCents" >= 0
      AND "historicalRetentionWithheldCents" >= 0
      AND "historicalRetentionReleasedCents" >= 0
      AND "otherConfirmedOccupancyCents" >= 0
    ),
  CONSTRAINT "ContractTakeover_confirmed_fields_check"
    CHECK (
      "takeoverStatus" <> 'confirmed'
      OR (
        "confirmedByUserId" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
        AND "historicalBalanceConfirmedByUserId" IS NOT NULL
        AND "historicalBalanceConfirmedAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "ContractTakeover_contractVersionId_key"
  ON "ContractTakeover"("contractVersionId");

CREATE INDEX "ContractTakeover_project_status_idx"
  ON "ContractTakeover"("projectId", "takeoverStatus");

CREATE INDEX "ContractTakeover_contractId_idx"
  ON "ContractTakeover"("contractId");

CREATE INDEX "ContractTakeover_contractVersionId_idx"
  ON "ContractTakeover"("contractVersionId");
