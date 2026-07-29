-- Project affiliate identity is explicit and append-only. Existing projects are
-- intentionally left unmapped for manual reconciliation; no names are guessed.
CREATE TABLE "ProjectAffiliateAssignment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "businessPartyId" TEXT NOT NULL,
  "businessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "affiliateCreditCodeSnapshot" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "changeReason" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAffiliateAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliateAssignment_effective_period_check"
    CHECK ("endedAt" IS NULL OR "endedAt" >= "effectiveFrom")
);

CREATE INDEX "ProjectAffiliateAssignment_projectId_effectiveFrom_idx"
  ON "ProjectAffiliateAssignment"("projectId", "effectiveFrom");
CREATE INDEX "ProjectAffiliateAssignment_businessPartyId_idx"
  ON "ProjectAffiliateAssignment"("businessPartyId");
CREATE INDEX "ProjectAffiliateAssignment_businessPartyVersionId_idx"
  ON "ProjectAffiliateAssignment"("businessPartyVersionId");
CREATE UNIQUE INDEX "ProjectAffiliateAssignment_one_current_per_project"
  ON "ProjectAffiliateAssignment"("projectId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "ContractVersion"
  ADD COLUMN "signingSubjectType" TEXT NOT NULL DEFAULT 'our_company',
  ADD COLUMN "affiliateAssignmentId" TEXT,
  ADD COLUMN "affiliateBusinessPartyVersionId" TEXT,
  ADD COLUMN "affiliateNameSnapshot" TEXT,
  ADD COLUMN "affiliateCreditCodeSnapshot" TEXT;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_signing_subject_check"
  CHECK (
    (
      "signingSubjectType" = 'our_company'
      AND "affiliateAssignmentId" IS NULL
      AND "affiliateBusinessPartyVersionId" IS NULL
      AND "affiliateNameSnapshot" IS NULL
      AND "affiliateCreditCodeSnapshot" IS NULL
    )
    OR
    (
      "signingSubjectType" = 'affiliate'
      AND "affiliateAssignmentId" IS NOT NULL
      AND "affiliateBusinessPartyVersionId" IS NOT NULL
      AND "affiliateNameSnapshot" IS NOT NULL
    )
  );

ALTER TABLE "ProjectOwnerContract"
  ADD COLUMN "affiliateAssignmentId" TEXT,
  ADD COLUMN "affiliateBusinessPartyVersionId" TEXT,
  ADD COLUMN "affiliateNameSnapshot" TEXT,
  ADD COLUMN "affiliateCreditCodeSnapshot" TEXT;

ALTER TABLE "ProjectOwnerContract"
  ADD CONSTRAINT "ProjectOwnerContract_affiliate_snapshot_check"
  CHECK (
    (
      "affiliateAssignmentId" IS NULL
      AND "affiliateBusinessPartyVersionId" IS NULL
      AND "affiliateNameSnapshot" IS NULL
      AND "affiliateCreditCodeSnapshot" IS NULL
    )
    OR
    (
      "affiliateAssignmentId" IS NOT NULL
      AND "affiliateBusinessPartyVersionId" IS NOT NULL
      AND "affiliateNameSnapshot" IS NOT NULL
    )
  );

ALTER TABLE "PaymentRequest"
  ADD COLUMN "paymentSubjectType" TEXT NOT NULL DEFAULT 'our_company';
ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_payment_subject_check"
  CHECK ("paymentSubjectType" IN ('affiliate', 'our_company'));

ALTER TABLE "PaymentExecution"
  ADD COLUMN "paymentSubjectType" TEXT NOT NULL DEFAULT 'our_company';
ALTER TABLE "PaymentExecution"
  ADD CONSTRAINT "PaymentExecution_payment_subject_check"
  CHECK ("paymentSubjectType" IN ('affiliate', 'our_company'));

ALTER TABLE "ProjectProxyPayment"
  ADD COLUMN "paymentSubjectType" TEXT NOT NULL DEFAULT 'affiliate',
  ADD COLUMN "affiliateAssignmentId" TEXT,
  ADD COLUMN "affiliateNameSnapshot" TEXT;
ALTER TABLE "ProjectProxyPayment"
  ADD CONSTRAINT "ProjectProxyPayment_payment_subject_check"
  CHECK ("paymentSubjectType" = 'affiliate');

CREATE INDEX "ContractVersion_affiliateAssignmentId_idx"
  ON "ContractVersion"("affiliateAssignmentId");
CREATE INDEX "ProjectOwnerContract_affiliateAssignmentId_idx"
  ON "ProjectOwnerContract"("affiliateAssignmentId");
CREATE INDEX "ProjectProxyPayment_affiliateAssignmentId_idx"
  ON "ProjectProxyPayment"("affiliateAssignmentId");
