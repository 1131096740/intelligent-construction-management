-- Owner master contracts and upstream settlements are external facts. Their
-- formal files are frozen by document version and digest; upstream settlement
-- recording is separated from an independently signed confirmation.
ALTER TABLE "ProjectOwnerContract"
  ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "fileContentSha256Snapshot" TEXT;

UPDATE "ProjectOwnerContract" AS owner_contract
SET "fileContentSha256Snapshot" = file_object."contentSha256"
FROM "FileObject" AS file_object
WHERE file_object."id" = owner_contract."fileId";

ALTER TABLE "ProjectOwnerContract"
  ADD CONSTRAINT "ProjectOwnerContract_external_confirmation_check"
  CHECK (
    "documentVersion" >= 1
    AND "fileContentSha256Snapshot" IS NOT NULL
    AND length("fileContentSha256Snapshot") = 64
    AND "status" IN ('pending_confirm', 'effective')
    AND (
      (
        "status" = 'pending_confirm'
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
      )
      OR
      (
        "status" = 'effective'
        AND "confirmedByUserId" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
      )
    )
  );

ALTER TABLE "ProjectUpstreamSettlement"
  ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "fileContentSha256Snapshot" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "confirmedByUserId" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmationSignatureVersionId" TEXT,
  ADD COLUMN "confirmationSignatureFileId" TEXT,
  ADD COLUMN "confirmationSignatureSha256" TEXT;

UPDATE "ProjectUpstreamSettlement" AS upstream_settlement
SET "fileContentSha256Snapshot" = file_object."contentSha256"
FROM "FileObject" AS file_object
WHERE file_object."id" = upstream_settlement."voucherFileId";

-- Existing rows were written by the old combined record/password path. They
-- are retained read-only and are not guessed to be independently confirmed.
UPDATE "ProjectUpstreamSettlement"
SET "status" = 'legacy_recorded'
WHERE "status" IS NULL;

ALTER TABLE "ProjectUpstreamSettlement"
  ALTER COLUMN "status" SET DEFAULT 'pending_confirm',
  ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "ProjectUpstreamSettlement"
  ADD CONSTRAINT "ProjectUpstreamSettlement_confirmation_check"
  CHECK (
    "documentVersion" >= 1
    AND "fileContentSha256Snapshot" IS NOT NULL
    AND length("fileContentSha256Snapshot") = 64
    AND "status" IN ('legacy_recorded', 'pending_confirm', 'confirmed')
    AND (
      (
        "status" = 'legacy_recorded'
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
        AND "confirmationSignatureVersionId" IS NULL
        AND "confirmationSignatureFileId" IS NULL
        AND "confirmationSignatureSha256" IS NULL
      )
      OR
      (
        "status" = 'pending_confirm'
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND "confirmedByUserId" IS NULL
        AND "confirmedAt" IS NULL
        AND "confirmationSignatureVersionId" IS NULL
        AND "confirmationSignatureFileId" IS NULL
        AND "confirmationSignatureSha256" IS NULL
      )
      OR
      (
        "status" = 'confirmed'
        AND "fileContentSha256Snapshot" IS NOT NULL
        AND "confirmedByUserId" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
        AND "confirmationSignatureVersionId" IS NOT NULL
        AND "confirmationSignatureFileId" IS NOT NULL
        AND length("confirmationSignatureSha256") = 64
      )
    )
  );

CREATE INDEX "ProjectUpstreamSettlement_projectId_status_idx"
  ON "ProjectUpstreamSettlement"("projectId", "status");
