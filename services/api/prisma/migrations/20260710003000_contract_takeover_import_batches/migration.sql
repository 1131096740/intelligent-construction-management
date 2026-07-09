CREATE TABLE "ContractTakeoverBatch" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "batchNo" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "takeoverCutoffDate" TIMESTAMP(3) NOT NULL,
  "responsibleUserId" TEXT NOT NULL,
  "reviewComment" TEXT NOT NULL,
  "acceptanceConclusion" TEXT NOT NULL,
  "importFingerprint" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "readyRows" INTEGER NOT NULL DEFAULT 0,
  "blockedRows" INTEGER NOT NULL DEFAULT 0,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractTakeoverBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTakeoverBatch_status_check"
    CHECK ("status" IN ('drafts_generated', 'under_review', 'accepted', 'limited_accepted', 'disputed'))
);

ALTER TABLE "ContractTakeover"
  ADD COLUMN "takeoverBatchId" TEXT,
  ADD COLUMN "importRowNo" INTEGER;

CREATE UNIQUE INDEX "ContractTakeoverBatch_project_batchNo_key"
  ON "ContractTakeoverBatch"("projectId", "batchNo");

CREATE UNIQUE INDEX "ContractTakeoverBatch_project_fingerprint_key"
  ON "ContractTakeoverBatch"("projectId", "importFingerprint");

CREATE INDEX "ContractTakeoverBatch_project_status_idx"
  ON "ContractTakeoverBatch"("projectId", "status");

CREATE INDEX "ContractTakeover_takeoverBatchId_idx"
  ON "ContractTakeover"("takeoverBatchId");

CREATE UNIQUE INDEX "ContractTakeover_batch_row_key"
  ON "ContractTakeover"("takeoverBatchId", "importRowNo");

ALTER TABLE "ContractTakeover"
  ADD CONSTRAINT "ContractTakeover_takeoverBatchId_fkey"
  FOREIGN KEY ("takeoverBatchId") REFERENCES "ContractTakeoverBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
