BEGIN;

ALTER TABLE "ProjectFinancingQuota"
    ALTER COLUMN "validUntil" DROP NOT NULL,
    ADD COLUMN "terminatedAt" TIMESTAMP(3),
    ADD COLUMN "terminatedByUserId" TEXT,
    ADD COLUMN "terminationReason" TEXT,
    ADD COLUMN "terminationSignatureFileId" TEXT,
    ADD COLUMN "terminationSignatureSha256" TEXT,
    ADD COLUMN "terminationSignatureVersionId" TEXT;

ALTER TABLE "ProjectFinancingQuota"
    DROP CONSTRAINT "ProjectFinancingQuota_status_check",
    ADD CONSTRAINT "ProjectFinancingQuota_status_check"
      CHECK ("status" IN ('approval_pending', 'approved', 'rejected', 'terminated')),
    ADD CONSTRAINT "ProjectFinancingQuota_termination_facts_check"
      CHECK (
        (
          "status" = 'terminated'
          AND "terminatedAt" IS NOT NULL
          AND "terminatedByUserId" IS NOT NULL
          AND length(btrim("terminationReason")) > 0
          AND "terminationSignatureFileId" IS NOT NULL
          AND "terminationSignatureSha256" ~ '^[a-f0-9]{64}$'
          AND "terminationSignatureVersionId" IS NOT NULL
        )
        OR
        (
          "status" <> 'terminated'
          AND "terminatedAt" IS NULL
          AND "terminatedByUserId" IS NULL
          AND "terminationReason" IS NULL
          AND "terminationSignatureFileId" IS NULL
          AND "terminationSignatureSha256" IS NULL
          AND "terminationSignatureVersionId" IS NULL
        )
      ),
    ADD CONSTRAINT "ProjectFinancingQuota_terminatedByUserId_fkey"
      FOREIGN KEY ("terminatedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "ProjectFinancingQuota_terminationSignatureFileId_fkey"
      FOREIGN KEY ("terminationSignatureFileId") REFERENCES "FileObject"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "ProjectFinancingQuota_terminationSignatureVersionId_fkey"
      FOREIGN KEY ("terminationSignatureVersionId") REFERENCES "HandwrittenSignatureVersion"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "ProjectFinancingQuota_terminationSignatureFileId_idx"
    ON "ProjectFinancingQuota"("terminationSignatureFileId");
CREATE INDEX "ProjectFinancingQuota_terminationSignatureVersionId_idx"
    ON "ProjectFinancingQuota"("terminationSignatureVersionId");

COMMIT;
