BEGIN;

ALTER TABLE "ContractVersion"
  DROP CONSTRAINT "ContractVersion_status_check";

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
      'voided'
    )
  ) NOT VALID;

ALTER TABLE "PaymentTermsVersion"
  DROP CONSTRAINT "PaymentTermsVersion_status_check";

ALTER TABLE "PaymentTermsVersion"
  ADD CONSTRAINT "PaymentTermsVersion_status_check"
  CHECK ("status" IN ('draft', 'effective', 'superseded', 'voided')) NOT VALID;

COMMIT;
