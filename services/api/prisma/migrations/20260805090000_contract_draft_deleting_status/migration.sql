-- M119: persist the isolated deletion state before a background cleanup removes a pristine draft.
BEGIN;

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = '"ContractVersion"'::regclass
    AND conname = 'ContractVersion_status_check'
    AND contype = 'c';
  IF definition IS NULL
     OR position('''draft''' IN definition) = 0
     OR position('''abandoned''' IN definition) = 0
     OR position('''voided''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unexpected ContractVersion_status_check definition';
  END IF;
END $$;

ALTER TABLE "ContractVersion" DROP CONSTRAINT "ContractVersion_status_check";
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_status_check"
  CHECK (
    "status" IN (
      'draft',
      'in_approval',
      'approval_rejected',
      'approved_pending_seal',
      'in_seal',
      'seal_approved_pending_archive',
      'pending_archive_confirm',
      'effective',
      'superseded',
      'voided',
      'abandoned',
      'deleting'
    )
  ) NOT VALID;

COMMIT;
