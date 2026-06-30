CREATE TABLE "ContractOfflineRevision" (
    "id" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "sourceGeneratedDocumentId" TEXT,
    "fileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractOfflineRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractOfflineRevision_contractVersionId_createdAt_idx" ON "ContractOfflineRevision"("contractVersionId", "createdAt");
CREATE INDEX "ContractOfflineRevision_fileId_idx" ON "ContractOfflineRevision"("fileId");
