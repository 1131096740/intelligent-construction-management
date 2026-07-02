CREATE TABLE "ProjectSettlementExceptionQuota" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
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

    CONSTRAINT "ProjectSettlementExceptionQuota_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectSettlementExceptionQuotaUsage" (
    "id" TEXT NOT NULL,
    "quotaId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'occupied',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSettlementExceptionQuotaUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectSettlementExceptionQuota_projectId_contractId_validUntil_idx"
    ON "ProjectSettlementExceptionQuota"("projectId", "contractId", "validUntil");
CREATE INDEX "ProjectSettlementExceptionQuota_attachmentFileId_idx"
    ON "ProjectSettlementExceptionQuota"("attachmentFileId");

CREATE UNIQUE INDEX "ProjectSettlementExceptionQuotaUsage_quotaId_settlementId_key"
    ON "ProjectSettlementExceptionQuotaUsage"("quotaId", "settlementId");
CREATE INDEX "ProjectSettlementExceptionQuotaUsage_settlementId_idx"
    ON "ProjectSettlementExceptionQuotaUsage"("settlementId");
CREATE INDEX "ProjectSettlementExceptionQuotaUsage_projectId_contractId_idx"
    ON "ProjectSettlementExceptionQuotaUsage"("projectId", "contractId");

ALTER TABLE "ProjectSettlementExceptionQuota"
    ADD CONSTRAINT "ProjectSettlementExceptionQuota_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectSettlementExceptionQuota_status_check" CHECK ("status" IN ('approval_pending', 'approved', 'rejected'));

ALTER TABLE "ProjectSettlementExceptionQuotaUsage"
    ADD CONSTRAINT "ProjectSettlementExceptionQuotaUsage_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectSettlementExceptionQuotaUsage_status_check" CHECK ("status" IN ('occupied', 'used', 'released'));
