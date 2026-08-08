BEGIN;

ALTER TABLE "ContractVersion"
  ADD COLUMN "endedAt" TIMESTAMP(3);

CREATE INDEX "ContractVersion_status_endedAt_idx"
  ON "ContractVersion"("status", "endedAt");

CREATE TABLE "ContractEndedApplicationRetentionPolicy" (
  "id" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractEndedApplicationRetentionPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ContractEndedApplicationRetentionPolicy" ("id", "activatedAt", "updatedAt")
VALUES ('contract-ended-retention-v1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "ContractEndedApplicationRetentionHold" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" TEXT,
  "releaseReason" TEXT,
  CONSTRAINT "ContractEndedApplicationRetentionHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractEndedApplicationRetentionHold_contractVersionId_fkey"
    FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractEndedApplicationRetentionHold_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractEndedApplicationRetentionHold_releasedByUserId_fkey"
    FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ContractEndedApplicationRetentionHold_contractVersionId_releasedAt_idx"
  ON "ContractEndedApplicationRetentionHold"("contractVersionId", "releasedAt");

CREATE UNIQUE INDEX "ContractEndedApplicationRetentionHold_one_active_per_version"
  ON "ContractEndedApplicationRetentionHold"("contractVersionId")
  WHERE "releasedAt" IS NULL;

COMMIT;
