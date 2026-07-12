ALTER TABLE "ContractLayoutTemplateVersion"
ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "inspectionRevision" INTEGER;

UPDATE "ContractLayoutTemplateVersion"
SET "inspectionRevision" = 1
WHERE "inspectionReport" IS NOT NULL;

ALTER TABLE "ContractLayoutPreviewJob"
ADD COLUMN "sourceRevision" INTEGER NOT NULL DEFAULT 1;
