BEGIN;

CREATE TABLE "ProjectFundingAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "executionType" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceId" TEXT,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reversalOfAllocationId" TEXT,
  "reversalKey" TEXT NOT NULL DEFAULT 'original',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectFundingAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectFundingAllocation_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ProjectFundingAllocation_execution_type_check" CHECK (
    "executionType" IN (
      'payment_execution',
      'project_expense_execution',
      'spot_procurement_payment_execution',
      'expense_claim_payment_execution',
      'employee_loan_disbursement'
    )
  ),
  CONSTRAINT "ProjectFundingAllocation_source_type_check" CHECK (
    "sourceType" IN ('project_cash', 'financing_quota')
  ),
  CONSTRAINT "ProjectFundingAllocation_source_consistency_check" CHECK (
    (
      "sourceType" = 'project_cash'
      AND "sourceId" IS NULL
      AND "sourceKey" = 'project_cash'
    )
    OR (
      "sourceType" = 'financing_quota'
      AND "sourceId" IS NOT NULL
      AND "sourceKey" = 'financing_quota:' || "sourceId"::TEXT
    )
  ),
  CONSTRAINT "ProjectFundingAllocation_direction_check" CHECK ("direction" IN ('debit', 'credit')),
  CONSTRAINT "ProjectFundingAllocation_reversal_check" CHECK (
    (
      "direction" = 'debit'
      AND "reversalOfAllocationId" IS NULL
      AND "reversalKey" = 'original'
    )
    OR (
      "direction" = 'credit'
      AND "reversalOfAllocationId" IS NOT NULL
      AND "reversalKey" <> 'original'
      AND BTRIM("reversalKey") <> ''
      AND "reason" IS NOT NULL
      AND BTRIM("reason") <> ''
    )
  ),
  CONSTRAINT "ProjectFundingAllocation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundingAllocation_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "ProjectFinancingQuota"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundingAllocation_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ProjectFundingAllocation_reversalOfAllocationId_fkey"
    FOREIGN KEY ("reversalOfAllocationId") REFERENCES "ProjectFundingAllocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "ProjectFundingAllocation_exec_source_dir_reversal_key"
  ON "ProjectFundingAllocation"(
    "executionType",
    "executionId",
    "sourceKey",
    "direction",
    "reversalKey"
  );
CREATE INDEX "ProjectFundingAllocation_projectId_createdAt_idx"
  ON "ProjectFundingAllocation"("projectId", "createdAt");
CREATE INDEX "ProjectFundingAllocation_sourceId_createdAt_idx"
  ON "ProjectFundingAllocation"("sourceId", "createdAt");
CREATE INDEX "ProjectFundingAllocation_businessType_businessId_idx"
  ON "ProjectFundingAllocation"("businessType", "businessId");
CREATE INDEX "ProjectFundingAllocation_reversalOfAllocationId_idx"
  ON "ProjectFundingAllocation"("reversalOfAllocationId");

COMMIT;
