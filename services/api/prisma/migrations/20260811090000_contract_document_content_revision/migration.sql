BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "ContractVersion"
  ADD COLUMN "documentContentRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "documentContentFingerprint" TEXT;

COMMIT;
