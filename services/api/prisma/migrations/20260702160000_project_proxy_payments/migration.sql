CREATE TABLE "ProjectProxyPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "generalContractorName" TEXT NOT NULL,
    "paidTargetName" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "description" TEXT,
    "voucherFileId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "contractId" TEXT,
    "settlementId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProxyPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectProxyPayment_projectId_paidAt_idx" ON "ProjectProxyPayment"("projectId", "paidAt");
CREATE INDEX "ProjectProxyPayment_contractId_idx" ON "ProjectProxyPayment"("contractId");
CREATE INDEX "ProjectProxyPayment_settlementId_idx" ON "ProjectProxyPayment"("settlementId");
CREATE INDEX "ProjectProxyPayment_voucherFileId_idx" ON "ProjectProxyPayment"("voucherFileId");

ALTER TABLE "ProjectProxyPayment"
    ADD CONSTRAINT "ProjectProxyPayment_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectProxyPayment_paymentType_check" CHECK (
        "paymentType" IN ('material', 'equipment', 'labor', 'professional_subcontract', 'other')
    );
