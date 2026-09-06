BEGIN;

SELECT pg_advisory_xact_lock(190731, 255);

ALTER TABLE "BusinessEntrySubmissionSnapshot"
  DROP CONSTRAINT "BusinessEntrySubmissionSnapshot_project_target_check";

ALTER TABLE "BusinessEntrySubmissionSnapshot"
  ADD CONSTRAINT "BusinessEntrySubmissionSnapshot_project_target_check"
  CHECK (
    "revision" > 0 AND
    "definitionVersion" > 0 AND
    (
      (
        "entityType" = 'project' AND
        "entityId" = "projectId"
      ) OR (
        "entityType" <> 'project' AND
        btrim("entityType") <> '' AND
        btrim("entityId") <> ''
      )
    )
  );

COMMIT;
