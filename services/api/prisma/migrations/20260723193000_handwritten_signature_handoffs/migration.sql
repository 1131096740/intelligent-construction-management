-- Desktop QR handoffs only persist an opaque token hash. The phone must authenticate as the same user
-- before it can view or complete the handoff, and a completed/invalidated handoff is never reusable.
CREATE TABLE "HandwrittenSignatureHandoff" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "signatureVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandwrittenSignatureHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandwrittenSignatureHandoff_tokenHash_key" ON "HandwrittenSignatureHandoff"("tokenHash");
CREATE INDEX "HandwrittenSignatureHandoff_ownerUserId_expiresAt_idx" ON "HandwrittenSignatureHandoff"("ownerUserId", "expiresAt");

ALTER TABLE "HandwrittenSignatureHandoff"
  ADD CONSTRAINT "HandwrittenSignatureHandoff_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
