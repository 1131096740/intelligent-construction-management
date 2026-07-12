CREATE TABLE "SettlementImport" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'preview',
  "preview" JSONB NOT NULL,
  "result" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "appliedByUserId" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SettlementImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementImport_status_check" CHECK ("status" IN ('preview', 'applied'))
);

CREATE INDEX "SettlementImport_projectId_createdAt_idx"
  ON "SettlementImport"("projectId", "createdAt");
CREATE INDEX "SettlementImport_contractVersionId_createdAt_idx"
  ON "SettlementImport"("contractVersionId", "createdAt");
CREATE INDEX "SettlementImport_fileId_idx" ON "SettlementImport"("fileId");

ALTER TABLE "SettlementImport"
  ADD CONSTRAINT "SettlementImport_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;
ALTER TABLE "SettlementImport"
  ADD CONSTRAINT "SettlementImport_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;
ALTER TABLE "SettlementImport"
  ADD CONSTRAINT "SettlementImport_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") NOT VALID;
