BEGIN;

-- FND-22：公共现金成本归属确认。
-- 只记录“把原成本事实的承担公司从未明改为明确公司”的确认过程，
-- 不改写 OperatingFact，不改金额、不新增成本或付款。
CREATE TABLE "OperatingCostAttributionConfirmation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "operatingFactId" TEXT NOT NULL,
  "operatingFactProjectId" TEXT NOT NULL,
  "sourceDedupKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "activeKey" TEXT,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityVersionId" TEXT NOT NULL,
  "companyNameSnapshot" TEXT NOT NULL,
  "companyCreditCodeSnapshot" TEXT,
  "reason" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OperatingCostAttributionConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingCostAttributionConfirmation_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingCostAttributionConfirmation_fact_fkey"
    FOREIGN KEY ("operatingFactId", "operatingFactProjectId")
    REFERENCES "OperatingFact"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingCostAttributionConfirmation_requester_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingCostAttributionConfirmation_reviewer_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingCostAttributionConfirmation_project_fact_check"
    CHECK ("projectId" = "operatingFactProjectId"),
  CONSTRAINT "OperatingCostAttributionConfirmation_status_check"
    CHECK ("status" IN ('pending_review', 'confirmed', 'returned')),
  CONSTRAINT "OperatingCostAttributionConfirmation_active_key_check"
    CHECK (
      ("status" IN ('pending_review', 'confirmed') AND "activeKey" = 'active')
      OR ("status" = 'returned' AND "activeKey" IS NULL)
    ),
  CONSTRAINT "OperatingCostAttributionConfirmation_company_check"
    CHECK (
      btrim("companyEntityId") <> ''
      AND btrim("companyEntityVersionId") <> ''
      AND btrim("companyNameSnapshot") <> ''
    ),
  CONSTRAINT "OperatingCostAttributionConfirmation_reason_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "OperatingCostAttributionConfirmation_review_check"
    CHECK (
      ("status" = 'pending_review' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
      OR ("status" = 'confirmed' AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
      OR ("status" = 'returned' AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL AND btrim("reviewReason") <> '')
    ),
  CONSTRAINT "OperatingCostAttributionConfirmation_revision_check"
    CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "OperatingCostAttributionConfirmation_idempotencyKey_key"
  ON "OperatingCostAttributionConfirmation"("idempotencyKey");
-- Postgres 唯一索引允许 NULL 重复：退回记录不占有效确认槽位，同一事实最多一条待确认/已确认。
CREATE UNIQUE INDEX "OperatingCostAttributionConfirmation_active_key"
  ON "OperatingCostAttributionConfirmation"("operatingFactId", "activeKey");
CREATE INDEX "OperatingCostAttributionConfirmation_project_status_idx"
  ON "OperatingCostAttributionConfirmation"("projectId", "status");
CREATE INDEX "OperatingCostAttributionConfirmation_source_dedup_idx"
  ON "OperatingCostAttributionConfirmation"("sourceDedupKey");
CREATE INDEX "OperatingCostAttributionConfirmation_fact_idx"
  ON "OperatingCostAttributionConfirmation"("operatingFactId");

COMMIT;
