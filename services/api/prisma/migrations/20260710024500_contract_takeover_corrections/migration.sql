CREATE TABLE "ContractTakeoverCorrection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "takeoverId" TEXT NOT NULL,
  "correctionType" TEXT NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "afterSnapshot" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "responsibleUserId" TEXT NOT NULL,
  "attachmentFileId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractTakeoverCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractTakeoverCorrection_project_takeover_created_idx"
  ON "ContractTakeoverCorrection"("projectId", "takeoverId", "createdAt");

CREATE INDEX "ContractTakeoverCorrection_takeover_idx"
  ON "ContractTakeoverCorrection"("takeoverId");
