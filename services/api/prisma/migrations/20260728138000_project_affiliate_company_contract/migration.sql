-- The affiliate-company agreement was already signed offline. The system only
-- freezes both legal subjects, the signed file, contract-staff recording and an
-- independent contract-director confirmation; it never creates company approval,
-- seal, owner-receipt, settlement, payment-request or cash-execution records.
BEGIN;

CREATE TABLE "ProjectAffiliateCompanyContract" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractReference" TEXT NOT NULL,
  "contractName" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "rightsObligationsSummary" TEXT NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "affiliateCreditCodeSnapshot" TEXT,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityVersionId" TEXT NOT NULL,
  "companyEntityNameSnapshot" TEXT NOT NULL,
  "companyEntityCreditCodeSnapshot" TEXT NOT NULL,
  "companyEntityRegisteredAddressSnapshot" TEXT,
  "fileId" TEXT NOT NULL,
  "documentVersion" INTEGER NOT NULL DEFAULT 1,
  "fileContentSha256Snapshot" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "recordedByRoleKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_confirm',
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationActionId" TEXT,
  "confirmationSignatureVersionId" TEXT,
  "confirmationSignatureFileId" TEXT,
  "confirmationSignatureSha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectAffiliateCompanyContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAffiliateCompanyContract_fileId_key" UNIQUE ("fileId"),
  CONSTRAINT "ProjectAffiliateCompanyContract_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "ProjectAffiliateCompanyContract_confirmationActionId_key" UNIQUE ("confirmationActionId"),
  CONSTRAINT "ProjectAffiliateCompanyContract_projectId_contractReference_key"
    UNIQUE ("projectId", "contractReference"),
  CONSTRAINT "ProjectAffiliateCompanyContract_business_check" CHECK (
    length(btrim("contractReference")) > 0
    AND length(btrim("contractName")) > 0
    AND length(btrim("rightsObligationsSummary")) > 0
    AND length(btrim("affiliateNameSnapshot")) > 0
    AND length(btrim("companyEntityNameSnapshot")) > 0
    AND length(btrim("companyEntityCreditCodeSnapshot")) > 0
    AND "documentVersion" >= 1
    AND "recordedByRoleKey" = 'contract_staff'
    AND "status" IN ('pending_confirm', 'confirmed')
  ),
  CONSTRAINT "ProjectAffiliateCompanyContract_file_sha256_check" CHECK (
    "fileContentSha256Snapshot" ~ '^[0-9a-f]{64}$'
    AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ProjectAffiliateCompanyContract_confirmation_check" CHECK (
    (
      "status" = 'pending_confirm'
      AND "confirmedByUserId" IS NULL
      AND "confirmedAt" IS NULL
      AND "confirmationActionId" IS NULL
      AND "confirmationSignatureVersionId" IS NULL
      AND "confirmationSignatureFileId" IS NULL
      AND "confirmationSignatureSha256" IS NULL
    )
    OR
    (
      "status" = 'confirmed'
      AND "confirmedByUserId" IS NOT NULL
      AND "confirmedAt" IS NOT NULL
      AND "confirmationActionId" IS NOT NULL
      AND "confirmationSignatureVersionId" IS NOT NULL
      AND "confirmationSignatureFileId" IS NOT NULL
      AND "confirmationSignatureSha256" ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "ProjectAffiliateCompanyContract_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_affiliateAssignmentId_fkey"
    FOREIGN KEY ("affiliateAssignmentId") REFERENCES "ProjectAffiliateAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_affiliateBusinessPartyVersionId_fkey"
    FOREIGN KEY ("affiliateBusinessPartyVersionId") REFERENCES "BusinessPartyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_companyEntityId_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_companyEntityVersionId_fkey"
    FOREIGN KEY ("companyEntityVersionId") REFERENCES "CompanyEntityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_confirmedByUserId_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_confirmationSignatureVersionId_fkey"
    FOREIGN KEY ("confirmationSignatureVersionId") REFERENCES "HandwrittenSignatureVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAffiliateCompanyContract_confirmationSignatureFileId_fkey"
    FOREIGN KEY ("confirmationSignatureFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProjectAffiliateCompanyContract_projectId_status_signedAt_idx"
  ON "ProjectAffiliateCompanyContract"("projectId", "status", "signedAt");
CREATE INDEX "ProjectAffiliateCompanyContract_affiliateAssignmentId_idx"
  ON "ProjectAffiliateCompanyContract"("affiliateAssignmentId");
CREATE INDEX "ProjectAffiliateCompanyContract_affiliateBusinessPartyVersionId_idx"
  ON "ProjectAffiliateCompanyContract"("affiliateBusinessPartyVersionId");
CREATE INDEX "ProjectAffiliateCompanyContract_companyEntityId_idx"
  ON "ProjectAffiliateCompanyContract"("companyEntityId");
CREATE INDEX "ProjectAffiliateCompanyContract_companyEntityVersionId_idx"
  ON "ProjectAffiliateCompanyContract"("companyEntityVersionId");

CREATE OR REPLACE FUNCTION "project_affiliate_company_contract_immutable_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed affiliate-company contracts are append-only';
  END IF;
  IF ROW(
    NEW."projectId", NEW."contractReference", NEW."contractName", NEW."signedAt",
    NEW."rightsObligationsSummary", NEW."affiliateAssignmentId",
    NEW."affiliateBusinessPartyVersionId", NEW."affiliateNameSnapshot",
    NEW."affiliateCreditCodeSnapshot", NEW."companyEntityId",
    NEW."companyEntityVersionId", NEW."companyEntityNameSnapshot",
    NEW."companyEntityCreditCodeSnapshot",
    NEW."companyEntityRegisteredAddressSnapshot", NEW."fileId",
    NEW."documentVersion", NEW."fileContentSha256Snapshot",
    NEW."idempotencyKey", NEW."requestFingerprint", NEW."recordedByUserId",
    NEW."recordedByRoleKey"
  ) IS DISTINCT FROM ROW(
    OLD."projectId", OLD."contractReference", OLD."contractName", OLD."signedAt",
    OLD."rightsObligationsSummary", OLD."affiliateAssignmentId",
    OLD."affiliateBusinessPartyVersionId", OLD."affiliateNameSnapshot",
    OLD."affiliateCreditCodeSnapshot", OLD."companyEntityId",
    OLD."companyEntityVersionId", OLD."companyEntityNameSnapshot",
    OLD."companyEntityCreditCodeSnapshot",
    OLD."companyEntityRegisteredAddressSnapshot", OLD."fileId",
    OLD."documentVersion", OLD."fileContentSha256Snapshot",
    OLD."idempotencyKey", OLD."requestFingerprint", OLD."recordedByUserId",
    OLD."recordedByRoleKey"
  ) THEN
    RAISE EXCEPTION 'affiliate-company contract business fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "project_affiliate_company_contract_delete_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'affiliate-company contracts cannot be deleted';
END;
$$;

CREATE TRIGGER "ProjectAffiliateCompanyContract_immutable"
BEFORE UPDATE ON "ProjectAffiliateCompanyContract"
FOR EACH ROW EXECUTE FUNCTION "project_affiliate_company_contract_immutable_guard"();

CREATE TRIGGER "ProjectAffiliateCompanyContract_no_delete"
BEFORE DELETE ON "ProjectAffiliateCompanyContract"
FOR EACH ROW EXECUTE FUNCTION "project_affiliate_company_contract_delete_guard"();

-- Preserve the previously frozen manifest and append only the two new file
-- bindings. The compatibility function remains so historical migrations stay
-- verifiable without copying or editing their immutable SQL.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_affiliate_company_contract;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_affiliate_company_contract()
  UNION ALL
  VALUES
    ('ProjectAffiliateCompanyContract','fileId',TRUE),
    ('ProjectAffiliateCompanyContract','confirmationSignatureFileId',FALSE);
$$;

CREATE TRIGGER jg_efb_project_affiliate_company_contract_file
BEFORE INSERT OR UPDATE OF "fileId" ON "ProjectAffiliateCompanyContract"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true');

CREATE TRIGGER jg_efb_project_affiliate_company_contract_signature
BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId" ON "ProjectAffiliateCompanyContract"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('confirmationSignatureFileId', 'false');

COMMIT;
