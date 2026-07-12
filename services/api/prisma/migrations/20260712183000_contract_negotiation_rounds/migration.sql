CREATE TABLE "ContractNegotiationRound" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "roundNo" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "sourceGeneratedDocumentId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "note" TEXT,
  "openedByUserId" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedByUserId" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractNegotiationRound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractNegotiationRound_status_check"
    CHECK ("status" IN ('open', 'closed'))
);

CREATE UNIQUE INDEX "ContractNegotiationRound_version_round_key"
  ON "ContractNegotiationRound"("contractVersionId", "roundNo");
CREATE UNIQUE INDEX "ContractNegotiationRound_one_open_per_version_key"
  ON "ContractNegotiationRound"("contractVersionId") WHERE "status" = 'open';
CREATE INDEX "ContractNegotiationRound_version_status_idx"
  ON "ContractNegotiationRound"("contractVersionId", "status");

ALTER TABLE "ContractOfflineRevision"
  ADD COLUMN "negotiationRoundId" TEXT,
  ADD COLUMN "sourceRevision" INTEGER,
  ADD COLUMN "previewPdfFileId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ContractOfflineRevision"
SET "status" = 'stale', "completedAt" = "confirmedAt";

-- Existing rows predate negotiation-round governance. Preserve them as
-- ungoverned, read-only history without making them approval blockers.
UPDATE "ContractOfflineRevision" revision
SET
  "sourceRevision" = document."sourceRevision",
  "status" = 'stale',
  "completedAt" = revision."confirmedAt"
FROM "ContractGeneratedDocument" document
WHERE document."id" = revision."sourceGeneratedDocumentId";

UPDATE "ContractOfflineRevision" revision
SET "sourceGeneratedDocumentId" = NULL
WHERE revision."sourceGeneratedDocumentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ContractGeneratedDocument" document
    WHERE document."id" = revision."sourceGeneratedDocumentId"
  );

ALTER TABLE "ContractOfflineRevision"
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ADD CONSTRAINT "ContractOfflineRevision_status_check"
    CHECK ("status" IN ('queued', 'processing', 'succeeded', 'failed', 'stale'));

CREATE INDEX "ContractOfflineRevision_round_createdAt_idx"
  ON "ContractOfflineRevision"("negotiationRoundId", "createdAt");

CREATE TABLE "ContractDocumentComparison" (
  "id" TEXT NOT NULL,
  "negotiationRoundId" TEXT NOT NULL,
  "offlineRevisionId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "algorithmVersion" TEXT,
  "baseNormalizedSha256" TEXT,
  "revisedNormalizedSha256" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractDocumentComparison_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractDocumentComparison_status_check"
    CHECK ("status" IN ('queued', 'processing', 'succeeded', 'failed', 'stale'))
);

CREATE UNIQUE INDEX "ContractDocumentComparison_revision_key"
  ON "ContractDocumentComparison"("offlineRevisionId");
CREATE INDEX "ContractDocumentComparison_round_status_idx"
  ON "ContractDocumentComparison"("negotiationRoundId", "status");

CREATE TABLE "ContractDocumentDifference" (
  "id" TEXT NOT NULL,
  "comparisonId" TEXT NOT NULL,
  "differenceKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "changeType" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "locationPath" TEXT NOT NULL,
  "basePath" TEXT,
  "revisedPath" TEXT,
  "beforeText" TEXT,
  "afterText" TEXT,
  "candidate" JSONB,
  "disposition" TEXT NOT NULL DEFAULT 'pending',
  "dispositionReason" TEXT,
  "disposedByUserId" TEXT,
  "disposedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractDocumentDifference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractDocumentDifference_change_type_check"
    CHECK ("changeType" IN ('insert', 'delete', 'replace')),
  CONSTRAINT "ContractDocumentDifference_kind_check"
    CHECK ("kind" IN ('paragraph', 'table_cell')),
  CONSTRAINT "ContractDocumentDifference_disposition_check"
    CHECK ("disposition" IN ('pending', 'confirmed', 'rejected', 'no_material_change'))
);

CREATE UNIQUE INDEX "ContractDocumentDifference_comparison_key_key"
  ON "ContractDocumentDifference"("comparisonId", "differenceKey");
CREATE INDEX "ContractDocumentDifference_comparison_sort_idx"
  ON "ContractDocumentDifference"("comparisonId", "sortOrder");
CREATE INDEX "ContractDocumentDifference_comparison_disposition_idx"
  ON "ContractDocumentDifference"("comparisonId", "disposition");

ALTER TABLE "ContractNegotiationRound"
  ADD CONSTRAINT "ContractNegotiationRound_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id"),
  ADD CONSTRAINT "ContractNegotiationRound_source_document_fk"
  FOREIGN KEY ("sourceGeneratedDocumentId") REFERENCES "ContractGeneratedDocument"("id");
ALTER TABLE "ContractOfflineRevision"
  ADD CONSTRAINT "ContractOfflineRevision_round_fk"
  FOREIGN KEY ("negotiationRoundId") REFERENCES "ContractNegotiationRound"("id"),
  ADD CONSTRAINT "ContractOfflineRevision_source_document_fk"
  FOREIGN KEY ("sourceGeneratedDocumentId") REFERENCES "ContractGeneratedDocument"("id"),
  ADD CONSTRAINT "ContractOfflineRevision_preview_pdf_file_fk"
  FOREIGN KEY ("previewPdfFileId") REFERENCES "FileObject"("id");
ALTER TABLE "ContractDocumentComparison"
  ADD CONSTRAINT "ContractDocumentComparison_round_fk"
  FOREIGN KEY ("negotiationRoundId") REFERENCES "ContractNegotiationRound"("id"),
  ADD CONSTRAINT "ContractDocumentComparison_revision_fk"
  FOREIGN KEY ("offlineRevisionId") REFERENCES "ContractOfflineRevision"("id");
ALTER TABLE "ContractDocumentDifference"
  ADD CONSTRAINT "ContractDocumentDifference_comparison_fk"
  FOREIGN KEY ("comparisonId") REFERENCES "ContractDocumentComparison"("id") ON DELETE CASCADE;
