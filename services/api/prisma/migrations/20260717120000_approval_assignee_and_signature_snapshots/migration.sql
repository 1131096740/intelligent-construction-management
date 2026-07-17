BEGIN;

ALTER TABLE "ApprovalActionLog"
  ADD COLUMN "approvedRoleKey" TEXT,
  ADD COLUMN "signatureFileIdSnapshot" TEXT,
  ADD COLUMN "signatureSha256Snapshot" TEXT,
  ADD COLUMN "representedUserId" TEXT;

COMMIT;
