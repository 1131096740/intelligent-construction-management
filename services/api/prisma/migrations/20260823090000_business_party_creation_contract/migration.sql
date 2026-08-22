BEGIN;

SELECT pg_advisory_xact_lock(190731, 43);

ALTER TABLE "BusinessParty"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'organization',
  ADD COLUMN "normalizedName" TEXT;

UPDATE "BusinessParty"
SET "normalizedName" = "name"
WHERE "normalizedName" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BusinessParty"
    WHERE "normalizedName" IS NULL OR "normalizedName" = ''
      OR "normalizedName" <> btrim("normalizedName")
      OR "normalizedName" ~ E'[[:space:]][[:space:]]+'
  ) THEN
    RAISE EXCEPTION 'BusinessParty contains an invalid normalized name';
  END IF;

  IF EXISTS (
    SELECT "normalizedName"
    FROM "BusinessParty"
    GROUP BY "normalizedName"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'BusinessParty contains duplicate normalized names';
  END IF;
END;
$$;

ALTER TABLE "BusinessParty"
  ALTER COLUMN "normalizedName" SET NOT NULL;

ALTER TABLE "BusinessParty"
  ADD CONSTRAINT "BusinessParty_type_organization_check"
  CHECK ("type" = 'organization');

CREATE UNIQUE INDEX "BusinessParty_normalizedName_key"
  ON "BusinessParty"("normalizedName");

CREATE TABLE "BusinessPartyCreateIdempotency" (
  "idempotencyKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "normalizedSnapshot" JSONB NOT NULL,
  "businessPartyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "BusinessPartyCreateIdempotency_pkey" PRIMARY KEY ("idempotencyKey"),
  CONSTRAINT "BusinessPartyCreateIdempotency_definition_version_check"
    CHECK ("definitionVersion" > 0),
  CONSTRAINT "BusinessPartyCreateIdempotency_action_check"
    CHECK ("action" = 'business_party.create'),
  CONSTRAINT "BusinessPartyCreateIdempotency_businessPartyId_fkey"
    FOREIGN KEY ("businessPartyId") REFERENCES "BusinessParty"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessPartyCreateIdempotency_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BusinessPartyCreateIdempotency_businessPartyId_idx"
  ON "BusinessPartyCreateIdempotency"("businessPartyId");
CREATE INDEX "BusinessPartyCreateIdempotency_actorUserId_createdAt_idx"
  ON "BusinessPartyCreateIdempotency"("actorUserId", "createdAt");

COMMIT;
