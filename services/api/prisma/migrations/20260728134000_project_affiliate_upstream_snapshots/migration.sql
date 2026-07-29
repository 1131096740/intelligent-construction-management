-- Freeze explicit affiliate identity on upstream and cash facts. Existing rows
-- remain nullable for manual reconciliation and are never name-backfilled.
ALTER TABLE "ProjectReceipt"
  ADD COLUMN "affiliateAssignmentId" TEXT,
  ADD COLUMN "affiliateBusinessPartyVersionId" TEXT,
  ADD COLUMN "affiliateNameSnapshot" TEXT;

ALTER TABLE "ProjectReceipt"
  ADD CONSTRAINT "ProjectReceipt_affiliate_snapshot_check"
  CHECK (
    (
      "affiliateAssignmentId" IS NULL
      AND "affiliateBusinessPartyVersionId" IS NULL
      AND "affiliateNameSnapshot" IS NULL
    )
    OR
    (
      "affiliateAssignmentId" IS NOT NULL
      AND "affiliateBusinessPartyVersionId" IS NOT NULL
      AND "affiliateNameSnapshot" IS NOT NULL
    )
  );

ALTER TABLE "ProjectProxyPayment"
  ADD COLUMN "affiliateBusinessPartyVersionId" TEXT;

ALTER TABLE "ProjectProxyPayment"
  ADD CONSTRAINT "ProjectProxyPayment_affiliate_snapshot_check"
  CHECK (
    (
      "affiliateAssignmentId" IS NULL
      AND "affiliateBusinessPartyVersionId" IS NULL
      AND "affiliateNameSnapshot" IS NULL
    )
    OR
    (
      "affiliateAssignmentId" IS NOT NULL
      AND "affiliateBusinessPartyVersionId" IS NOT NULL
      AND "affiliateNameSnapshot" IS NOT NULL
    )
  );

ALTER TABLE "ProjectUpstreamSettlement"
  ADD COLUMN "affiliateAssignmentId" TEXT,
  ADD COLUMN "affiliateBusinessPartyVersionId" TEXT,
  ADD COLUMN "affiliateNameSnapshot" TEXT;

ALTER TABLE "ProjectUpstreamSettlement"
  ADD CONSTRAINT "ProjectUpstreamSettlement_affiliate_snapshot_check"
  CHECK (
    (
      "affiliateAssignmentId" IS NULL
      AND "affiliateBusinessPartyVersionId" IS NULL
      AND "affiliateNameSnapshot" IS NULL
    )
    OR
    (
      "affiliateAssignmentId" IS NOT NULL
      AND "affiliateBusinessPartyVersionId" IS NOT NULL
      AND "affiliateNameSnapshot" IS NOT NULL
    )
  );

CREATE INDEX "ProjectReceipt_affiliateAssignmentId_idx"
  ON "ProjectReceipt"("affiliateAssignmentId");
CREATE INDEX "ProjectProxyPayment_affiliateBusinessPartyVersionId_idx"
  ON "ProjectProxyPayment"("affiliateBusinessPartyVersionId");
CREATE INDEX "ProjectUpstreamSettlement_affiliateAssignmentId_idx"
  ON "ProjectUpstreamSettlement"("affiliateAssignmentId");
