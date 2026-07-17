BEGIN;

ALTER TABLE "CompanyEntity"
  ADD COLUMN "registeredAddress" TEXT,
  ADD COLUMN "dataStatus" TEXT NOT NULL DEFAULT 'legacy_incomplete',
  ADD COLUMN "currentVersionNo" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ContractVersion"
  ADD COLUMN "companyEntityIdSnapshot" TEXT,
  ADD COLUMN "companyEntityVersionId" TEXT,
  ADD COLUMN "companyEntityNameSnapshot" TEXT,
  ADD COLUMN "companyEntityCreditCodeSnapshot" TEXT,
  ADD COLUMN "companyEntityRegisteredAddressSnapshot" TEXT;

CREATE TABLE "CompanyEntityVersion" (
  "id" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "unifiedSocialCreditCode" TEXT,
  "registeredAddress" TEXT,
  "isActive" BOOLEAN NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorRoleKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyEntityVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyEntityVersion_companyEntityId_versionNo_key"
  ON "CompanyEntityVersion"("companyEntityId", "versionNo");
CREATE INDEX "CompanyEntityVersion_name_idx"
  ON "CompanyEntityVersion"("name");
CREATE INDEX "CompanyEntityVersion_unifiedSocialCreditCode_idx"
  ON "CompanyEntityVersion"("unifiedSocialCreditCode");
CREATE UNIQUE INDEX "CompanyEntity_unifiedSocialCreditCode_normalized_key"
  ON "CompanyEntity" (upper(btrim("unifiedSocialCreditCode")))
  WHERE "unifiedSocialCreditCode" IS NOT NULL
    AND btrim("unifiedSocialCreditCode") <> '';
CREATE INDEX "ContractVersion_companyEntityIdSnapshot_idx"
  ON "ContractVersion"("companyEntityIdSnapshot");
CREATE INDEX "ContractVersion_companyEntityVersionId_idx"
  ON "ContractVersion"("companyEntityVersionId");

INSERT INTO "CompanyEntityVersion" (
  "id",
  "companyEntityId",
  "versionNo",
  "name",
  "unifiedSocialCreditCode",
  "registeredAddress",
  "isActive",
  "action",
  "actorUserId",
  "actorRoleKey"
)
SELECT
  'company-entity-version-v1-' || ce."id",
  ce."id",
  1,
  ce."name",
  ce."unifiedSocialCreditCode",
  ce."registeredAddress",
  ce."isActive",
  'legacy_backfill',
  NULL,
  NULL
FROM "CompanyEntity" ce;

UPDATE "CompanyEntity"
SET "currentVersionNo" = 1;

UPDATE "ContractVersion" cv
SET
  "companyEntityIdSnapshot" = ce."id",
  "companyEntityVersionId" = cev."id",
  "companyEntityNameSnapshot" = CASE
    WHEN NULLIF(BTRIM(c."companyEntityName"), '') IS NOT NULL
      THEN c."companyEntityName"
    ELSE ce."name"
  END
FROM "Contract" c
LEFT JOIN "CompanyEntity" ce ON ce."id" = c."companyEntityId"
LEFT JOIN "CompanyEntityVersion" cev
  ON cev."companyEntityId" = ce."id"
  AND cev."versionNo" = 1
WHERE c."id" = cv."contractId"
  AND (
    ce."id" IS NOT NULL
    OR NULLIF(BTRIM(c."companyEntityName"), '') IS NOT NULL
  );

ALTER TABLE "CompanyEntityVersion"
  ADD CONSTRAINT "CompanyEntityVersion_company_entity_fk"
  FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_company_entity_snapshot_fk"
  FOREIGN KEY ("companyEntityIdSnapshot") REFERENCES "CompanyEntity"("id") NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_company_entity_version_fk"
  FOREIGN KEY ("companyEntityVersionId") REFERENCES "CompanyEntityVersion"("id") NOT VALID;

ALTER TABLE "CompanyEntity"
  ADD CONSTRAINT "CompanyEntity_data_status_check"
  CHECK ("dataStatus" IN ('legacy_incomplete', 'complete')) NOT VALID;
ALTER TABLE "CompanyEntity"
  ADD CONSTRAINT "CompanyEntity_current_version_no_check"
  CHECK ("currentVersionNo" >= 0) NOT VALID;
ALTER TABLE "CompanyEntityVersion"
  ADD CONSTRAINT "CompanyEntityVersion_version_no_check"
  CHECK ("versionNo" > 0) NOT VALID;

COMMIT;
