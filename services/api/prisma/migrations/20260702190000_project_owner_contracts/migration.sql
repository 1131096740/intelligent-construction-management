CREATE TABLE "ProjectOwnerContract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "contractName" TEXT NOT NULL,
    "contractCode" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "pricingMethod" TEXT NOT NULL,
    "paymentTermsSummary" TEXT NOT NULL,
    "retentionSummary" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending_confirm',
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOwnerContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectOwnerContract_projectId_signedAt_idx" ON "ProjectOwnerContract"("projectId", "signedAt");
CREATE INDEX "ProjectOwnerContract_fileId_idx" ON "ProjectOwnerContract"("fileId");
CREATE UNIQUE INDEX "ProjectOwnerContract_projectId_contractCode_active_key"
    ON "ProjectOwnerContract"("projectId", "contractCode")
    WHERE "voidedAt" IS NULL;
CREATE UNIQUE INDEX "ProjectOwnerContract_fileId_active_key"
    ON "ProjectOwnerContract"("fileId")
    WHERE "voidedAt" IS NULL;

ALTER TABLE "ProjectOwnerContract"
    ADD CONSTRAINT "ProjectOwnerContract_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectOwnerContract_status_check" CHECK ("status" IN ('pending_confirm', 'effective'));
