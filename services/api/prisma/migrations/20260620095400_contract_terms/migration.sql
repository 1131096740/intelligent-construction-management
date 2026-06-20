-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTermsVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTermsStage" (
    "id" TEXT NOT NULL,
    "paymentTermsVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "ratioBps" INTEGER,
    "fixedAmountCents" INTEGER,
    "triggerEvent" TEXT NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "requiresInvoice" BOOLEAN NOT NULL DEFAULT false,
    "allowsEarlyPayment" BOOLEAN NOT NULL DEFAULT false,
    "allowsInstallments" BOOLEAN NOT NULL DEFAULT true,
    "retentionBps" INTEGER,
    "originalText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTermsStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractArchiveFile" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractArchiveFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_code_key" ON "Contract"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_versionNo_key" ON "ContractVersion"("contractId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTermsVersion_contractId_versionNo_key" ON "PaymentTermsVersion"("contractId", "versionNo");
