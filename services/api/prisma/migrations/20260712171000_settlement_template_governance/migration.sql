ALTER TABLE "Settlement"
  ADD COLUMN "settlementTemplateVersionId" TEXT;

ALTER TABLE "SettlementImport"
  ADD COLUMN "settlementTemplateVersionId" TEXT;

CREATE INDEX "Settlement_settlementTemplateVersionId_idx"
  ON "Settlement"("settlementTemplateVersionId");
CREATE INDEX "SettlementImport_settlementTemplateVersionId_idx"
  ON "SettlementImport"("settlementTemplateVersionId");

CREATE TABLE "SettlementTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementTemplate_code_key" ON "SettlementTemplate"("code");

CREATE TABLE "SettlementTemplateVersion" (
  "id" TEXT NOT NULL,
  "settlementTemplateId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "draftRevision" INTEGER NOT NULL DEFAULT 1,
  "xlsxFileId" TEXT NOT NULL,
  "compatibleContractTypeKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "compatibleAmountRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "compatiblePricingModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "columnSchema" JSONB NOT NULL,
  "printRules" JSONB NOT NULL,
  "evidenceRules" JSONB NOT NULL,
  "anomalyRules" JSONB NOT NULL,
  "inspectionReport" JSONB,
  "inspectionRevision" INTEGER,
  "previewXlsxFileId" TEXT,
  "previewPdfFileId" TEXT,
  "submittedByUserId" TEXT,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "changeSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementTemplateVersion_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'published', 'stopped')),
  CONSTRAINT "SettlementTemplateVersion_amount_roles_check"
    CHECK ("compatibleAmountRoles" <@ ARRAY['included', 'reference', 'non_priced', 'provisional']::TEXT[]),
  CONSTRAINT "SettlementTemplateVersion_pricing_modes_check"
    CHECK ("compatiblePricingModes" <@ ARRAY['tax_inclusive', 'tax_exclusive']::TEXT[])
);

CREATE UNIQUE INDEX "SettlementTemplateVersion_template_version_key"
  ON "SettlementTemplateVersion"("settlementTemplateId", "versionNo");
CREATE INDEX "SettlementTemplateVersion_status_publishedAt_idx"
  ON "SettlementTemplateVersion"("status", "publishedAt");
CREATE UNIQUE INDEX "SettlementTemplateVersion_one_published_per_template_key"
  ON "SettlementTemplateVersion"("settlementTemplateId")
  WHERE "status" = 'published';

CREATE TABLE "SettlementTemplatePreviewJob" (
  "id" TEXT NOT NULL,
  "settlementTemplateVersionId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "sampleData" JSONB NOT NULL,
  "previewXlsxFileId" TEXT,
  "previewPdfFileId" TEXT,
  "errorMessage" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SettlementTemplatePreviewJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementTemplatePreviewJob_status_check"
    CHECK ("status" IN ('queued', 'processing', 'succeeded', 'failed', 'stale'))
);

CREATE INDEX "SettlementTemplatePreviewJob_version_createdAt_idx"
  ON "SettlementTemplatePreviewJob"("settlementTemplateVersionId", "createdAt");

ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_template_fk"
  FOREIGN KEY ("settlementTemplateId") REFERENCES "SettlementTemplate"("id");
ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_xlsx_file_fk"
  FOREIGN KEY ("xlsxFileId") REFERENCES "FileObject"("id");
ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_preview_xlsx_file_fk"
  FOREIGN KEY ("previewXlsxFileId") REFERENCES "FileObject"("id");
ALTER TABLE "SettlementTemplateVersion"
  ADD CONSTRAINT "SettlementTemplateVersion_preview_pdf_file_fk"
  FOREIGN KEY ("previewPdfFileId") REFERENCES "FileObject"("id");
ALTER TABLE "SettlementTemplatePreviewJob"
  ADD CONSTRAINT "SettlementTemplatePreviewJob_version_fk"
  FOREIGN KEY ("settlementTemplateVersionId") REFERENCES "SettlementTemplateVersion"("id");
ALTER TABLE "SettlementTemplatePreviewJob"
  ADD CONSTRAINT "SettlementTemplatePreviewJob_preview_xlsx_file_fk"
  FOREIGN KEY ("previewXlsxFileId") REFERENCES "FileObject"("id");
ALTER TABLE "SettlementTemplatePreviewJob"
  ADD CONSTRAINT "SettlementTemplatePreviewJob_preview_pdf_file_fk"
  FOREIGN KEY ("previewPdfFileId") REFERENCES "FileObject"("id");
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_template_version_fk"
  FOREIGN KEY ("settlementTemplateVersionId") REFERENCES "SettlementTemplateVersion"("id");
ALTER TABLE "SettlementImport"
  ADD CONSTRAINT "SettlementImport_template_version_fk"
  FOREIGN KEY ("settlementTemplateVersionId") REFERENCES "SettlementTemplateVersion"("id");
