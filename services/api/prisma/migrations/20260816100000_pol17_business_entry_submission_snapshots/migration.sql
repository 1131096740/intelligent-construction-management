BEGIN;

SELECT pg_advisory_xact_lock(190731, 29);

CREATE TABLE "BusinessEntrySubmissionSnapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sceneKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "definitionSnapshot" JSONB NOT NULL,
  "valuesSnapshot" JSONB NOT NULL,
  "frozenAt" TIMESTAMP(3) NOT NULL,
  "frozenByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessEntrySubmissionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessEntrySubmissionSnapshot_project_target_check"
    CHECK (
      "entityType" = 'project' AND
      "entityId" = "projectId" AND
      "revision" > 0 AND
      "definitionVersion" > 0
    )
);

CREATE UNIQUE INDEX "BusinessEntrySubmissionSnapshot_target_revision_key"
  ON "BusinessEntrySubmissionSnapshot"("projectId", "sceneKey", "entityType", "entityId", "revision");
CREATE INDEX "BusinessEntrySubmissionSnapshot_project_scene_frozen_idx"
  ON "BusinessEntrySubmissionSnapshot"("projectId", "sceneKey", "frozenAt");

ALTER TABLE "BusinessEntrySubmissionSnapshot"
  ADD CONSTRAINT "BusinessEntrySubmissionSnapshot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessEntrySubmissionSnapshot"
  ADD CONSTRAINT "BusinessEntrySubmissionSnapshot_frozenByUserId_fkey"
  FOREIGN KEY ("frozenByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_business_entry_submission_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'business_entry_submission_snapshot_immutable';
END;
$$;

CREATE TRIGGER "BusinessEntrySubmissionSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "BusinessEntrySubmissionSnapshot"
FOR EACH ROW
EXECUTE FUNCTION guard_business_entry_submission_snapshot_immutable();

CREATE TRIGGER "BusinessEntrySubmissionSnapshot_immutable_truncate"
BEFORE TRUNCATE ON "BusinessEntrySubmissionSnapshot"
FOR EACH STATEMENT
EXECUTE FUNCTION guard_business_entry_submission_snapshot_immutable();

COMMIT;
