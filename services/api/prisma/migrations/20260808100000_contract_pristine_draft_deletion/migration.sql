CREATE TABLE "ContractPristineDraftDeletionReceipt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "contractName" TEXT NOT NULL,
  "formalCode" TEXT,
  "ownerUserId" TEXT,
  "deletedByUserId" TEXT NOT NULL,
  "requestedRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'deleting',
  "exclusiveFileCount" INTEGER NOT NULL DEFAULT 0,
  "sharedFileCount" INTEGER NOT NULL DEFAULT 0,
  "aggregateHash" TEXT,
  "failureCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractPristineDraftDeletionReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_contractVersionId_key" UNIQUE ("contractVersionId"),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_requested_revision_check"
    CHECK ("requestedRevision" > 0),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_status_check"
    CHECK ("status" IN ('deleting', 'retryable', 'completed')),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_file_counts_check"
    CHECK ("exclusiveFileCount" >= 0 AND "sharedFileCount" >= 0),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_hash_check"
    CHECK ("aggregateHash" IS NULL OR "aggregateHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContractPristineDraftDeletionReceipt_completion_check"
    CHECK (("status" = 'completed') = ("completedAt" IS NOT NULL))
);

CREATE INDEX "ContractPristineDraftDeletionReceipt_status_expiresAt_idx"
  ON "ContractPristineDraftDeletionReceipt"("status", "expiresAt");

CREATE TABLE "ContractNumberTombstone" (
  "id" TEXT NOT NULL,
  "formalCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractNumberTombstone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractNumberTombstone_formalCode_key" UNIQUE ("formalCode"),
  CONSTRAINT "ContractNumberTombstone_formal_code_check"
    CHECK (length(btrim("formalCode")) > 0)
);
