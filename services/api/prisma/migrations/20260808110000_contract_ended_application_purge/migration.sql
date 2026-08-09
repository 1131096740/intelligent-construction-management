BEGIN;

CREATE TABLE "ContractEndedApplicationPurgeReceipt" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "formalCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'purging',
  "exclusiveFileCount" INTEGER NOT NULL DEFAULT 0,
  "sharedFileCount" INTEGER NOT NULL DEFAULT 0,
  "aggregateHash" TEXT,
  "failureCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_contractVersionId_key" UNIQUE ("contractVersionId"),
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_status_check"
    CHECK ("status" IN ('purging', 'object_cleanup_pending', 'retryable', 'completed')),
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_fileCount_check"
    CHECK ("exclusiveFileCount" >= 0 AND "sharedFileCount" >= 0),
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_aggregateHash_check"
    CHECK ("aggregateHash" IS NULL OR "aggregateHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContractEndedApplicationPurgeReceipt_completion_check"
    CHECK (("status" = 'completed') = ("completedAt" IS NOT NULL))
);

CREATE INDEX "ContractEndedApplicationPurgeReceipt_batchId_status_idx"
  ON "ContractEndedApplicationPurgeReceipt"("batchId", "status");

CREATE INDEX "ContractEndedApplicationPurgeReceipt_status_updatedAt_idx"
  ON "ContractEndedApplicationPurgeReceipt"("status", "updatedAt");

ALTER TABLE "FileObject"
  ADD COLUMN "purgeReceiptId" TEXT;

CREATE INDEX "FileObject_purgeReceiptId_idx"
  ON "FileObject"("purgeReceiptId");

COMMIT;
