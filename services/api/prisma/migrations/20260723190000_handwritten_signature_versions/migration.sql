-- Forward-compatible Canvas signature versions. Existing uploaded signature images remain readable
-- through User.signatureFileId and are intentionally not backfilled as handwritten facts.
CREATE TABLE "HandwrittenSignatureVersion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'canvas',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandwrittenSignatureVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandwrittenSignatureVersion_fileId_key" ON "HandwrittenSignatureVersion"("fileId");
CREATE INDEX "HandwrittenSignatureVersion_userId_createdAt_idx" ON "HandwrittenSignatureVersion"("userId", "createdAt");

ALTER TABLE "HandwrittenSignatureVersion"
  ADD CONSTRAINT "HandwrittenSignatureVersion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalActionLog" ADD COLUMN "signatureVersionIdSnapshot" TEXT;
ALTER TABLE "Settlement" ADD COLUMN "preparerSignatureVersionId" TEXT;
