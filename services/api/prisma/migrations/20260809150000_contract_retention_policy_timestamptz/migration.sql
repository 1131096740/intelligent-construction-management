BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "ContractEndedApplicationRetentionPolicy"
  ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3)
  USING ("activatedAt" AT TIME ZONE 'Asia/Shanghai');

COMMIT;
