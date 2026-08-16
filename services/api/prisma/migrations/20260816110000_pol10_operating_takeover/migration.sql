BEGIN;

CREATE TABLE "OperatingTakeoverBatch" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "batchNo" TEXT NOT NULL,
  "sourceFileId" TEXT,
  "sourceFileName" TEXT,
  "sceneKeys" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "importFingerprint" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "readyRows" INTEGER NOT NULL DEFAULT 0,
  "blockedRows" INTEGER NOT NULL DEFAULT 0,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatingTakeoverBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverBatch_status_check" CHECK ("status" IN ('draft', 'under_review', 'activated')),
  CONSTRAINT "OperatingTakeoverBatch_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "OperatingTakeoverBatch_rows_check" CHECK ("totalRows" >= 0 AND "readyRows" >= 0 AND "blockedRows" >= 0 AND "warningRows" >= 0)
);
CREATE UNIQUE INDEX "OperatingTakeoverBatch_projectId_batchNo_key" ON "OperatingTakeoverBatch"("projectId", "batchNo");
CREATE UNIQUE INDEX "OperatingTakeoverBatch_projectId_importFingerprint_key" ON "OperatingTakeoverBatch"("projectId", "importFingerprint");
CREATE INDEX "OperatingTakeoverBatch_projectId_status_idx" ON "OperatingTakeoverBatch"("projectId", "status");
CREATE INDEX "OperatingTakeoverBatch_projectId_createdAt_idx" ON "OperatingTakeoverBatch"("projectId", "createdAt");

CREATE TABLE "OperatingTakeoverRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNo" INTEGER NOT NULL,
  "sceneKey" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "businessRef" TEXT,
  "occurredAt" DATE,
  "periodLabel" TEXT,
  "amountCents" BIGINT,
  "valuesSnapshot" JSONB NOT NULL,
  "evidenceLevel" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  "duplicateStatus" TEXT NOT NULL DEFAULT 'none',
  "duplicateNote" TEXT,
  "reviewConclusion" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "generatedFactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatingTakeoverRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverRow_rowNo_check" CHECK ("rowNo" > 0),
  CONSTRAINT "OperatingTakeoverRow_definitionVersion_check" CHECK ("definitionVersion" > 0),
  CONSTRAINT "OperatingTakeoverRow_amount_check" CHECK ("amountCents" IS NULL OR "amountCents" >= 0),
  CONSTRAINT "OperatingTakeoverRow_evidence_check" CHECK ("evidenceLevel" IN ('A', 'B', 'C')),
  CONSTRAINT "OperatingTakeoverRow_status_check" CHECK ("reviewStatus" IN ('pending', 'accepted', 'blocked', 'activated')),
  CONSTRAINT "OperatingTakeoverRow_duplicate_check" CHECK ("duplicateStatus" IN ('none', 'suspected', 'confirmed')),
  CONSTRAINT "OperatingTakeoverRow_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "OperatingTakeoverRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OperatingTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperatingTakeoverRow_batchId_rowNo_key" ON "OperatingTakeoverRow"("batchId", "rowNo");
CREATE UNIQUE INDEX "OperatingTakeoverRow_generatedFactId_key" ON "OperatingTakeoverRow"("generatedFactId");
CREATE INDEX "OperatingTakeoverRow_batchId_reviewStatus_idx" ON "OperatingTakeoverRow"("batchId", "reviewStatus");
CREATE INDEX "OperatingTakeoverRow_batchId_duplicateStatus_idx" ON "OperatingTakeoverRow"("batchId", "duplicateStatus");
CREATE INDEX "OperatingTakeoverRow_sceneKey_idx" ON "OperatingTakeoverRow"("sceneKey");

CREATE TABLE "OperatingTakeoverIssue" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowId" TEXT,
  "code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "fieldKey" TEXT,
  "message" TEXT NOT NULL,
  "suggestion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverIssue_severity_check" CHECK ("severity" IN ('error', 'warning', 'suspected_duplicate', 'confirmed_duplicate', 'evidence_gap')),
  CONSTRAINT "OperatingTakeoverIssue_status_check" CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "OperatingTakeoverIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OperatingTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingTakeoverIssue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "OperatingTakeoverRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OperatingTakeoverIssue_batchId_severity_status_idx" ON "OperatingTakeoverIssue"("batchId", "severity", "status");
CREATE INDEX "OperatingTakeoverIssue_rowId_status_idx" ON "OperatingTakeoverIssue"("rowId", "status");

CREATE TABLE "OperatingTakeoverAttachmentGroup" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowId" TEXT,
  "purpose" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverAttachmentGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverAttachmentGroup_scope_check" CHECK ("rowId" IS NULL OR length(btrim("rowId")) > 0),
  CONSTRAINT "OperatingTakeoverAttachmentGroup_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OperatingTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingTakeoverAttachmentGroup_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "OperatingTakeoverRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OperatingTakeoverAttachmentGroup_batchId_rowId_idx" ON "OperatingTakeoverAttachmentGroup"("batchId", "rowId");

CREATE TABLE "OperatingTakeoverAttachmentLink" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverAttachmentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverAttachmentLink_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OperatingTakeoverAttachmentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperatingTakeoverAttachmentLink_groupId_fileId_key" ON "OperatingTakeoverAttachmentLink"("groupId", "fileId");
CREATE INDEX "OperatingTakeoverAttachmentLink_fileId_idx" ON "OperatingTakeoverAttachmentLink"("fileId");

CREATE TABLE "OperatingTakeoverConfirmation" (
  "idempotencyKey" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "profession" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverConfirmation_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "OperatingTakeoverConfirmation_profession_check" CHECK ("profession" IN ('contract', 'finance')),
  CONSTRAINT "OperatingTakeoverConfirmation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "OperatingTakeoverConfirmation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OperatingTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperatingTakeoverConfirmation_batchId_profession_revision_key" ON "OperatingTakeoverConfirmation"("batchId", "profession", "revision");
CREATE INDEX "OperatingTakeoverConfirmation_batchId_profession_confirmedAt_idx" ON "OperatingTakeoverConfirmation"("batchId", "profession", "confirmedAt");

CREATE TABLE "OperatingTakeoverActivation" (
  "idempotencyKey" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "generatedFactIds" JSONB NOT NULL,
  "gapRowIds" JSONB NOT NULL,
  "activatedByUserId" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverActivation_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "OperatingTakeoverActivation_batchId_key" UNIQUE ("batchId"),
  CONSTRAINT "OperatingTakeoverActivation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "OperatingTakeoverActivation_status_check" CHECK ("status" IN ('activated')),
  CONSTRAINT "OperatingTakeoverActivation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OperatingTakeoverBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Historical takeover files are evidence references, not exclusive owners.
-- Extend the deployed unified manifest before either new table can write one.
SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "OperatingTakeoverBatch" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "OperatingTakeoverAttachmentLink" IN SHARE ROW EXCLUSIVE MODE;

ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_operating_takeover;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_operating_takeover()
  UNION ALL
  VALUES
    ('OperatingTakeoverBatch', 'sourceFileId', FALSE),
    ('OperatingTakeoverAttachmentLink', 'fileId', FALSE);
$$;

CREATE TRIGGER jg_efb_operating_takeover_batch_source_file
BEFORE INSERT OR UPDATE OF "sourceFileId" ON "OperatingTakeoverBatch"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('sourceFileId', 'false');

CREATE TRIGGER jg_efb_operating_takeover_attachment_link_file
BEFORE INSERT OR UPDATE OF "fileId" ON "OperatingTakeoverAttachmentLink"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'false');

COMMIT;
