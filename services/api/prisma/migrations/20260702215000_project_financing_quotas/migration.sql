CREATE TABLE "ProjectFinancingQuota" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "attachmentFileId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'approval_pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFinancingQuota_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectFinancingQuotaUsage" (
    "id" TEXT NOT NULL,
    "quotaId" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'occupied',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFinancingQuotaUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectFinancingQuota_projectId_validUntil_idx"
    ON "ProjectFinancingQuota"("projectId", "validUntil");
CREATE INDEX "ProjectFinancingQuota_attachmentFileId_idx"
    ON "ProjectFinancingQuota"("attachmentFileId");

CREATE INDEX "ProjectFinancingQuotaUsage_quotaId_paymentRequestId_idx"
    ON "ProjectFinancingQuotaUsage"("quotaId", "paymentRequestId");
CREATE INDEX "ProjectFinancingQuotaUsage_paymentRequestId_idx"
    ON "ProjectFinancingQuotaUsage"("paymentRequestId");
CREATE INDEX "ProjectFinancingQuotaUsage_projectId_idx"
    ON "ProjectFinancingQuotaUsage"("projectId");

ALTER TABLE "ProjectFinancingQuota"
    ADD CONSTRAINT "ProjectFinancingQuota_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectFinancingQuota_status_check" CHECK ("status" IN ('approval_pending', 'approved', 'rejected'));

ALTER TABLE "ProjectFinancingQuotaUsage"
    ADD CONSTRAINT "ProjectFinancingQuotaUsage_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectFinancingQuotaUsage_status_check" CHECK ("status" IN ('occupied', 'used', 'released'));
