-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "companyEntityId" TEXT,
ADD COLUMN     "companyEntityName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signatureFileId" TEXT;

-- CreateTable
CREATE TABLE "CompanyEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unifiedSocialCreditCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEntity_pkey" PRIMARY KEY ("id")
);
