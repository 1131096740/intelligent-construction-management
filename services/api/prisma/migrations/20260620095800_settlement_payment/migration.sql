-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "paymentTermsVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payableAmountCents" INTEGER NOT NULL,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementArchiveFile" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementArchiveFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "paymentTermsVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAmountCents" INTEGER NOT NULL,
    "approvedAmountCents" INTEGER,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentExecution" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "voucherFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "paymentRequestId" TEXT,
    "settlementId" TEXT,
    "direction" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_code_key" ON "Settlement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_code_key" ON "PaymentRequest"("code");
