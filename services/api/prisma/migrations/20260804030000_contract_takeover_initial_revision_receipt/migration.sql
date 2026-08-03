BEGIN;

SELECT pg_advisory_xact_lock(190731, 28);

ALTER TABLE "ContractTakeoverSideSaveRequest"
  DROP CONSTRAINT "ContractTakeoverSideSaveRequest_revision_check";

ALTER TABLE "ContractTakeoverSideSaveRequest"
  ADD CONSTRAINT "ContractTakeoverSideSaveRequest_revision_check"
  CHECK (
    "expectedRevision" >= 0
    AND "resultRevision" > 0
    AND "resultRevision" >= "expectedRevision"
  );

COMMIT;
