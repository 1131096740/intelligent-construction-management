CREATE TABLE "ProjectReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "payerName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "description" TEXT,
    "voucherFileId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectReceipt_projectId_receivedAt_idx" ON "ProjectReceipt"("projectId", "receivedAt");
CREATE INDEX "ProjectReceipt_voucherFileId_idx" ON "ProjectReceipt"("voucherFileId");

ALTER TABLE "ProjectReceipt"
    ADD CONSTRAINT "ProjectReceipt_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectReceipt_sourceType_check" CHECK (
        "sourceType" IN ('general_contractor_payment', 'owner_direct_payment', 'other')
    );
