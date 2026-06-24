-- AlterTable: Contract - make code nullable (keep unique), add new fields
ALTER TABLE "Contract" ADD COLUMN     "contractTypeKey" TEXT,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "temporaryCode" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedReason" TEXT,
ALTER COLUMN "code" DROP NOT NULL;

-- AlterTable: ContractVersion - add new fields, widen amountCents to BIGINT
-- For NOT NULL Json columns, use a temporary default to backfill existing 17 rows,
-- then drop the default so new rows must supply a value explicitly.
ALTER TABLE "ContractVersion"
ADD COLUMN     "amountAdjustmentReason" TEXT,
ADD COLUMN     "amountSource" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "businessTemplateVersionId" TEXT,
ADD COLUMN     "clauseSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "draftData" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "draftRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "layoutTemplateVersionId" TEXT,
ADD COLUMN     "pricingNature" TEXT NOT NULL DEFAULT 'fixed_total',
ADD COLUMN     "readinessSnapshot" JSONB,
ADD COLUMN     "templateSnapshot" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "amountCents" SET DATA TYPE BIGINT;

-- Drop temporary defaults from the three NOT NULL Json columns
-- (existing rows are already backfilled with '{}'; future rows must supply values)
ALTER TABLE "ContractVersion" ALTER COLUMN "clauseSnapshot" DROP DEFAULT;
ALTER TABLE "ContractVersion" ALTER COLUMN "draftData" DROP DEFAULT;
ALTER TABLE "ContractVersion" ALTER COLUMN "templateSnapshot" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ContractBusinessTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractTypeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractBusinessTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractBusinessTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fieldSchema" JSONB NOT NULL,
    "billSchema" JSONB NOT NULL,
    "clauseSchema" JSONB NOT NULL,
    "attachmentSchema" JSONB NOT NULL,
    "validationSchema" JSONB NOT NULL,
    "submittedByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractBusinessTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardClause" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardClauseVersion" (
    "id" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "submittedByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardClauseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessParty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unifiedSocialCreditCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPartyVersion" (
    "id" TEXT NOT NULL,
    "businessPartyId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessPartyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractPartySnapshot" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "businessPartyVersionId" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractPartySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLayoutTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractTypeKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractLayoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLayoutTemplateVersion" (
    "id" TEXT NOT NULL,
    "layoutTemplateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "docxFileId" TEXT NOT NULL,
    "placeholderSchema" JSONB NOT NULL,
    "previewPdfFileId" TEXT,
    "inspectionReport" JSONB,
    "submittedByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractLayoutTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLayoutPreviewJob" (
    "id" TEXT NOT NULL,
    "layoutTemplateVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sampleData" JSONB NOT NULL,
    "previewPdfFileId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractLayoutPreviewJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDraftCheckpoint" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "name" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractDraftCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractNumberRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "companyEntityId" TEXT,
    "projectId" TEXT,
    "contractTypeKey" TEXT,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "sequenceWidth" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractNumberRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractBill" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "billKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountRole" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL,
    "quantityScale" INTEGER NOT NULL,
    "unitPriceScale" INTEGER NOT NULL,
    "schemaSnapshot" JSONB NOT NULL,
    "sourceExcelFileId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "taxInclusiveAmountCents" BIGINT NOT NULL DEFAULT 0,
    "taxExclusiveAmountCents" BIGINT NOT NULL DEFAULT 0,
    "taxAmountCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractBillRow" (
    "id" TEXT NOT NULL,
    "contractBillId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "itemCode" TEXT,
    "itemName" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "taxRate" DECIMAL(9,6) NOT NULL,
    "taxInclusiveAmountCents" BIGINT NOT NULL,
    "taxExclusiveAmountCents" BIGINT NOT NULL,
    "taxAmountCents" BIGINT NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "settlementBasis" TEXT,
    "customData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractBillRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractBillImport" (
    "id" TEXT NOT NULL,
    "contractBillId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "appliedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractBillImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractGeneratedDocument" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "layoutTemplateVersionId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourceRevision" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "docxFileId" TEXT,
    "pdfFileId" TEXT,
    "errorMessage" TEXT,
    "engineVersion" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractGeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractBusinessTemplate_code_key" ON "ContractBusinessTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ContractBusinessTemplateVersion_templateId_versionNo_key" ON "ContractBusinessTemplateVersion"("templateId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "StandardClause_code_key" ON "StandardClause"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StandardClauseVersion_clauseId_versionNo_key" ON "StandardClauseVersion"("clauseId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessParty_unifiedSocialCreditCode_key" ON "BusinessParty"("unifiedSocialCreditCode");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartyVersion_businessPartyId_versionNo_key" ON "BusinessPartyVersion"("businessPartyId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "ContractPartySnapshot_contractVersionId_roleKey_displayOrde_key" ON "ContractPartySnapshot"("contractVersionId", "roleKey", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContractLayoutTemplateVersion_layoutTemplateId_versionNo_key" ON "ContractLayoutTemplateVersion"("layoutTemplateId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDraftCheckpoint_contractVersionId_sequenceNo_key" ON "ContractDraftCheckpoint"("contractVersionId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "ContractBill_contractVersionId_billKey_key" ON "ContractBill"("contractVersionId", "billKey");

-- CreateIndex
CREATE INDEX "ContractBillRow_contractBillId_sortOrder_idx" ON "ContractBillRow"("contractBillId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContractBillRow_contractBillId_rowKey_key" ON "ContractBillRow"("contractBillId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContractGeneratedDocument_idempotencyKey_key" ON "ContractGeneratedDocument"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_temporaryCode_key" ON "Contract"("temporaryCode");
