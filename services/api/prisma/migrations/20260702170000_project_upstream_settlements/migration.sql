CREATE TABLE "ProjectUpstreamSettlement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "reportedAmountCents" BIGINT NOT NULL,
    "approvedAmountCents" BIGINT NOT NULL,
    "approvingPartyName" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "voucherFileId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectUpstreamSettlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectUpstreamSettlement_projectId_settledAt_idx" ON "ProjectUpstreamSettlement"("projectId", "settledAt");
CREATE INDEX "ProjectUpstreamSettlement_voucherFileId_idx" ON "ProjectUpstreamSettlement"("voucherFileId");

ALTER TABLE "ProjectUpstreamSettlement"
    ADD CONSTRAINT "ProjectUpstreamSettlement_reportedAmountCents_positive_check" CHECK ("reportedAmountCents" > 0),
    ADD CONSTRAINT "ProjectUpstreamSettlement_approvedAmountCents_positive_check" CHECK ("approvedAmountCents" > 0);
