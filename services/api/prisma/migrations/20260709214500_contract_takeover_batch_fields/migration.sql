ALTER TABLE "ContractTakeover"
  ADD COLUMN "takeoverCutoffDate" TIMESTAMP(3),
  ADD COLUMN "responsibleUserId" TEXT,
  ADD COLUMN "reviewComment" TEXT,
  ADD COLUMN "acceptanceConclusion" TEXT;
