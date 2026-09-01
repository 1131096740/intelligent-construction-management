-- POL-214: the minimum server-authoritative financial source layer.
-- Artifact only; applying it to any database remains outside this ticket.

BEGIN;

CREATE TABLE "AffiliateClearingAuthorityVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "constructionEnterpriseAssignmentId" TEXT NOT NULL,
  "affiliateCompanyContractId" TEXT NOT NULL,
  "protocolNameSnapshot" TEXT NOT NULL,
  "protocolReferenceSnapshot" TEXT NOT NULL,
  "assignmentNameSnapshot" TEXT NOT NULL,
  "assignmentCreditCodeSnapshot" TEXT,
  "versionNo" INTEGER NOT NULL DEFAULT 1,
  "supersedesVersionId" TEXT,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "coverageKind" TEXT NOT NULL,
  "evidenceFileId" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "evidenceManifestSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "authoritySnapshotRef" TEXT NOT NULL,
  "authorityFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "returnedByUserId" TEXT,
  "returnedAt" TIMESTAMP(3),
  "returnReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateClearingAuthorityVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateClearingAuthorityVersion_contract_version_key" UNIQUE ("affiliateCompanyContractId", "versionNo"),
  CONSTRAINT "AffiliateClearingAuthorityVersion_snapshot_ref_key" UNIQUE ("authoritySnapshotRef"),
  CONSTRAINT "AffiliateClearingAuthorityVersion_fingerprint_key" UNIQUE ("authorityFingerprint"),
  CONSTRAINT "AffiliateClearingAuthorityVersion_idempotency_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "AffiliateClearingAuthorityVersion_business_check" CHECK (
    length(btrim("protocolNameSnapshot")) > 0
    AND length(btrim("protocolReferenceSnapshot")) > 0
    AND length(btrim("assignmentNameSnapshot")) > 0
    AND "versionNo" > 0
    AND "coverageKind" IN ('PERSON', 'ROLE_SUMMARY')
    AND "status" IN ('draft', 'submitted', 'confirmed', 'returned')
    AND ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo")
  ),
  CONSTRAINT "AffiliateClearingAuthorityVersion_hash_check" CHECK (
    "evidenceSha256" ~ '^[0-9a-f]{64}$'
    AND "evidenceManifestSha256" ~ '^[0-9a-f]{64}$'
    AND "authorityFingerprint" ~ '^[0-9a-f]{64}$'
    AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AffiliateClearingAuthorityVersion_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClearingAuthorityVersion_assignment_fkey"
    FOREIGN KEY ("constructionEnterpriseAssignmentId") REFERENCES "ProjectAffiliateAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClearingAuthorityVersion_contract_fkey"
    FOREIGN KEY ("affiliateCompanyContractId") REFERENCES "ProjectAffiliateCompanyContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClearingAuthorityVersion_evidence_file_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateClearingAuthorityVersion_supersedes_fkey"
    FOREIGN KEY ("supersedesVersionId") REFERENCES "AffiliateClearingAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssignedWageAuthorityLine" (
  "id" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "constructionEnterpriseAssignmentId" TEXT NOT NULL,
  "affiliateCompanyContractId" TEXT NOT NULL,
  "coverageKind" TEXT NOT NULL,
  "coverageKey" TEXT NOT NULL,
  "personAuthorityKey" TEXT,
  "personNameSnapshot" TEXT,
  "roleCategoryKey" TEXT,
  "roleNameSnapshot" TEXT,
  "employerNameSnapshot" TEXT NOT NULL,
  "employerCreditCodeSnapshot" TEXT,
  "wageMonth" DATE NOT NULL,
  "amountRuleVersion" INTEGER NOT NULL,
  "amountMode" TEXT NOT NULL,
  "approvedAmountCents" BIGINT NOT NULL,
  "grossCapCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "midMonthPolicy" TEXT NOT NULL,
  "evidenceLevel" TEXT NOT NULL,
  "evidenceCoordinate" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "lineFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignedWageAuthorityLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignedWageAuthorityLine_authority_key" UNIQUE ("authorityVersionId", "wageMonth", "coverageKind", "coverageKey"),
  CONSTRAINT "AssignedWageAuthorityLine_natural_key" UNIQUE ("projectId", "constructionEnterpriseAssignmentId", "wageMonth", "coverageKey"),
  CONSTRAINT "AssignedWageAuthorityLine_coverage_check" CHECK (
    ("coverageKind" = 'PERSON' AND "personAuthorityKey" IS NOT NULL AND "roleCategoryKey" IS NULL AND "personNameSnapshot" IS NOT NULL)
    OR
    ("coverageKind" = 'ROLE_SUMMARY' AND "personAuthorityKey" IS NULL AND "personNameSnapshot" IS NULL AND "roleCategoryKey" IS NOT NULL AND "roleNameSnapshot" IS NOT NULL)
  ),
  CONSTRAINT "AssignedWageAuthorityLine_amount_check" CHECK (
    "amountRuleVersion" > 0
    AND "amountMode" IN ('CONFIRMED_AMOUNT', 'EXPLICIT_TYPED_PRORATION')
    AND "approvedAmountCents" > 0
    AND "grossCapCents" >= "approvedAmountCents"
    AND "currencyCode" = 'CNY'
    AND "midMonthPolicy" IN ('NOT_APPLICABLE', 'EXPLICIT_TYPED_RULE')
    AND "evidenceLevel" IN ('A', 'B')
  ),
  CONSTRAINT "AssignedWageAuthorityLine_hash_check" CHECK (
    "evidenceSha256" ~ '^[0-9a-f]{64}$'
    AND "lineFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AssignedWageAuthorityLine_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "AffiliateClearingAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GuaranteeObligationVersion" (
  "id" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "constructionEnterpriseAssignmentId" TEXT NOT NULL,
  "affiliateCompanyContractId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL DEFAULT 1,
  "supersedesVersionId" TEXT,
  "baseAmountCents" BIGINT NOT NULL,
  "calculationMode" TEXT NOT NULL,
  "rateBps" INTEGER,
  "fixedAmountCents" BIGINT,
  "capCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "returnCondition" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "disabledAt" TIMESTAMP(3),
  "disableReason" TEXT,
  "evidenceLevel" TEXT NOT NULL,
  "evidenceCoordinate" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "obligationFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuaranteeObligationVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuaranteeObligationVersion_natural_key" UNIQUE ("obligationId", "versionNo"),
  CONSTRAINT "GuaranteeObligationVersion_fingerprint_key" UNIQUE ("obligationFingerprint"),
  CONSTRAINT "GuaranteeObligationVersion_business_check" CHECK (
    length(btrim("obligationId")) > 0
    AND "versionNo" > 0
    AND "calculationMode" IN ('FIXED_AMOUNT', 'RATE_BPS')
    AND (("calculationMode" = 'FIXED_AMOUNT' AND "fixedAmountCents" > 0 AND "rateBps" IS NULL)
      OR ("calculationMode" = 'RATE_BPS' AND "rateBps" BETWEEN 0 AND 10000 AND "fixedAmountCents" IS NULL))
    AND "baseAmountCents" > 0
    AND "capCents" > 0
    AND "currencyCode" = 'CNY'
    AND length(btrim("returnCondition")) > 0
    AND "evidenceLevel" IN ('A', 'B')
    AND ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo")
    AND (("enabled" = TRUE AND "disabledAt" IS NULL AND "disableReason" IS NULL)
      OR ("enabled" = FALSE AND "disabledAt" IS NOT NULL AND length(btrim("disableReason")) > 0))
  ),
  CONSTRAINT "GuaranteeObligationVersion_hash_check" CHECK ("evidenceSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GuaranteeObligationVersion_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "AffiliateClearingAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GuaranteeObligationVersion_supersedes_fkey"
    FOREIGN KEY ("supersedesVersionId") REFERENCES "GuaranteeObligationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "ClearingCase"
  ADD COLUMN "authorityVersionId" TEXT,
  ADD COLUMN "authoritySnapshotRef" TEXT,
  ADD COLUMN "sourceDiscriminator" TEXT,
  ADD COLUMN "coverageKind" TEXT,
  ADD COLUMN "periodStart" DATE,
  ADD CONSTRAINT "ClearingCase_authority_fields_check" CHECK (
    ("authorityVersionId" IS NULL AND "authoritySnapshotRef" IS NULL AND "sourceDiscriminator" IS NULL AND "coverageKind" IS NULL AND "periodStart" IS NULL)
    OR
    ("authorityVersionId" IS NOT NULL AND "authoritySnapshotRef" IS NOT NULL AND "sourceDiscriminator" IN ('construction_enterprise_assigned_wage', 'construction_enterprise_guarantee') AND "coverageKind" IN ('PERSON', 'ROLE_SUMMARY') AND ("sourceDiscriminator" = 'construction_enterprise_guarantee' OR "periodStart" IS NOT NULL))
  );

ALTER TABLE "ClearingCase"
  ADD CONSTRAINT "ClearingCase_authority_version_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "AffiliateClearingAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliateClearingAuthorityVersion"
  ADD CONSTRAINT "AffiliateClearingAuthorityVersion_created_by_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AffiliateClearingAuthorityVersion_submitted_by_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AffiliateClearingAuthorityVersion_confirmed_by_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AffiliateClearingAuthorityVersion_returned_by_fkey"
    FOREIGN KEY ("returnedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GuaranteeObligationVersion"
  ADD CONSTRAINT "GuaranteeObligationVersion_created_by_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "GuaranteeObligationVersion_confirmed_by_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AffiliateClearingAuthorityVersion_project_status_effective_idx"
  ON "AffiliateClearingAuthorityVersion"("projectId", "status", "effectiveFrom");
CREATE INDEX "AffiliateClearingAuthorityVersion_assignment_status_idx"
  ON "AffiliateClearingAuthorityVersion"("constructionEnterpriseAssignmentId", "status");
CREATE INDEX "AssignedWageAuthorityLine_project_assignment_month_idx"
  ON "AssignedWageAuthorityLine"("projectId", "constructionEnterpriseAssignmentId", "wageMonth");
CREATE INDEX "GuaranteeObligationVersion_project_assignment_obligation_idx"
  ON "GuaranteeObligationVersion"("projectId", "constructionEnterpriseAssignmentId", "obligationId");
CREATE INDEX "ClearingCase_authoritySnapshotRef_idx" ON "ClearingCase"("authoritySnapshotRef");

CREATE OR REPLACE FUNCTION "pol214_authority_nonoverlap_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_id TEXT;
  contract_id TEXT;
  effective_from_value DATE;
  effective_to_value DATE;
BEGIN
  row_id := NEW."id";
  contract_id := NEW."affiliateCompanyContractId";
  effective_from_value := NEW."effectiveFrom";
  effective_to_value := NEW."effectiveTo";
  PERFORM pg_advisory_xact_lock(hashtextextended(contract_id, 214));
  IF EXISTS (
    SELECT 1
      FROM "AffiliateClearingAuthorityVersion" existing
     WHERE existing."affiliateCompanyContractId" = contract_id
       AND existing."id" <> row_id
       AND daterange(existing."effectiveFrom", existing."effectiveTo", '[)')
           && daterange(effective_from_value, effective_to_value, '[)')
  ) THEN
    RAISE EXCEPTION 'POL-214 authority effective ranges overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AffiliateClearingAuthorityVersion_nonoverlap"
BEFORE INSERT ON "AffiliateClearingAuthorityVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_nonoverlap_guard"();

CREATE OR REPLACE FUNCTION "pol214_authority_immutable_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POL-214 authority rows are append-only';
END;
$$;

CREATE TRIGGER "AffiliateClearingAuthorityVersion_no_delete"
BEFORE DELETE ON "AffiliateClearingAuthorityVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_immutable_guard"();

CREATE OR REPLACE FUNCTION "pol214_authority_parent_update_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'confirmed' THEN
    RAISE EXCEPTION 'POL-214 confirmed authority rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AffiliateClearingAuthorityVersion_confirmed_immutable"
BEFORE UPDATE ON "AffiliateClearingAuthorityVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_parent_update_guard"();

CREATE TRIGGER "AssignedWageAuthorityLine_immutable"
BEFORE UPDATE OR DELETE ON "AssignedWageAuthorityLine"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_immutable_guard"();
CREATE TRIGGER "GuaranteeObligationVersion_immutable"
BEFORE UPDATE OR DELETE ON "GuaranteeObligationVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_immutable_guard"();

CREATE OR REPLACE FUNCTION "pol214_authority_parent_consistency_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_record RECORD;
BEGIN
  SELECT "coverageKind", "projectId", "constructionEnterpriseAssignmentId", "affiliateCompanyContractId", "status"
    INTO parent_record
    FROM "AffiliateClearingAuthorityVersion"
   WHERE "id" = NEW."authorityVersionId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POL-214 authority parent is missing'; END IF;
  IF parent_record."status" <> 'draft' THEN
    RAISE EXCEPTION 'POL-214 child authority rows can only be added to a draft parent';
  END IF;
  IF TG_TABLE_NAME = 'AssignedWageAuthorityLine' THEN
    IF parent_record."coverageKind" <> NEW."coverageKind"
       OR parent_record."projectId" <> NEW."projectId"
       OR parent_record."constructionEnterpriseAssignmentId" <> NEW."constructionEnterpriseAssignmentId"
       OR parent_record."affiliateCompanyContractId" <> NEW."affiliateCompanyContractId" THEN
      RAISE EXCEPTION 'POL-214 child snapshot does not match authority parent';
    END IF;
  ELSE
    IF parent_record."projectId" <> NEW."projectId"
       OR parent_record."constructionEnterpriseAssignmentId" <> NEW."constructionEnterpriseAssignmentId"
       OR parent_record."affiliateCompanyContractId" <> NEW."affiliateCompanyContractId" THEN
      RAISE EXCEPTION 'POL-214 guarantee snapshot does not match authority parent';
    END IF;
  END IF;
  IF parent_record."status" = 'confirmed' THEN
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AssignedWageAuthorityLine_parent_consistency"
BEFORE INSERT ON "AssignedWageAuthorityLine"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_parent_consistency_guard"();
CREATE TRIGGER "GuaranteeObligationVersion_parent_consistency"
BEFORE INSERT ON "GuaranteeObligationVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_authority_parent_consistency_guard"();

CREATE OR REPLACE FUNCTION "pol214_guarantee_nonoverlap_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_id TEXT;
  obligation_id_value TEXT;
  effective_from_value DATE;
  effective_to_value DATE;
BEGIN
  row_id := NEW."id";
  obligation_id_value := NEW."obligationId";
  effective_from_value := NEW."effectiveFrom";
  effective_to_value := NEW."effectiveTo";
  PERFORM pg_advisory_xact_lock(hashtextextended(obligation_id_value, 214));
  IF EXISTS (
    SELECT 1 FROM "GuaranteeObligationVersion" existing
     WHERE existing."obligationId" = obligation_id_value
       AND existing."id" <> row_id
       AND daterange(existing."effectiveFrom", existing."effectiveTo", '[)')
           && daterange(effective_from_value, effective_to_value, '[)')
  ) THEN
    RAISE EXCEPTION 'POL-214 guarantee obligation effective ranges overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "GuaranteeObligationVersion_nonoverlap"
BEFORE INSERT ON "GuaranteeObligationVersion"
FOR EACH ROW EXECUTE FUNCTION "pol214_guarantee_nonoverlap_guard"();

-- A confirmed guarantee withholding is a financial reservation. Lock the case
-- row before checking the aggregate so two Serializable/ordinary writers
-- cannot both pass an optimistic cap check.
CREATE OR REPLACE FUNCTION "pol214_guarantee_confirmation_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  case_record RECORD;
  requested BIGINT;
  current_total BIGINT;
BEGIN
  SELECT c."id", c."sourceDiscriminator", c."authoritativeGrossCapCents"
    INTO case_record
    FROM "ClearingEventVersion" v
    JOIN "ClearingEvent" e ON e."id" = v."clearingEventId"
    JOIN "ClearingCase" c ON c."id" = v."clearingCaseId"
   WHERE v."id" = NEW."eventVersionId";
  IF NOT FOUND OR case_record."sourceDiscriminator" <> 'construction_enterprise_guarantee' THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "ClearingCase" WHERE "id" = case_record."id" FOR UPDATE;
  SELECT v."amountCents" INTO requested FROM "ClearingEventVersion" v WHERE v."id" = NEW."eventVersionId";
  SELECT COALESCE(SUM(v."amountCents"), 0)::bigint INTO current_total
    FROM "ClearingConfirmation" existing
    JOIN "ClearingEventVersion" v ON v."id" = existing."eventVersionId"
    JOIN "ClearingEvent" e ON e."id" = v."clearingEventId"
   WHERE e."clearingCaseId" = case_record."id" AND e."kind" = 'withheld';
  IF current_total + requested > case_record."authoritativeGrossCapCents" THEN
    RAISE EXCEPTION 'POL-214 guarantee withholding exceeds authority cap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClearingConfirmation_pol214_guarantee_cap"
BEFORE INSERT ON "ClearingConfirmation"
FOR EACH ROW EXECUTE FUNCTION "pol214_guarantee_confirmation_guard"();

-- Every allocation is checked against its immutable source balance. The same
-- trigger also caps authority-cap allocations for #214 guarantee cases.
CREATE OR REPLACE FUNCTION "pol214_clearing_allocation_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_case_id TEXT;
  case_record RECORD;
  source_amount BIGINT;
  used_amount BIGINT;
BEGIN
  SELECT "clearingCaseId" INTO target_case_id FROM "ClearingEventVersion" WHERE "id" = NEW."eventVersionId";
  IF target_case_id IS NULL THEN RAISE EXCEPTION 'POL-214 allocation target version is missing'; END IF;
  SELECT "id", "sourceDiscriminator", "authoritativeGrossCapCents"
    INTO case_record FROM "ClearingCase" WHERE "id" = target_case_id FOR UPDATE;
  IF NEW."sourceKind" = 'authority_cap' THEN
    IF NEW."sourceEventVersionId" IS NOT NULL THEN RAISE EXCEPTION 'authority-cap allocation cannot have a source version'; END IF;
    SELECT COALESCE(SUM("amountCents"), 0)::bigint INTO used_amount
      FROM "ClearingAllocation" a
      JOIN "ClearingEventVersion" target ON target."id" = a."eventVersionId"
     WHERE target."clearingCaseId" = target_case_id AND a."sourceKind" = 'authority_cap';
    IF case_record."sourceDiscriminator" = 'construction_enterprise_guarantee'
       AND used_amount + NEW."amountCents" > case_record."authoritativeGrossCapCents" THEN
      RAISE EXCEPTION 'POL-214 guarantee authority allocation exceeds cap';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."sourceEventVersionId" IS NULL THEN RAISE EXCEPTION 'non-authority allocation requires a source version'; END IF;
  SELECT "amountCents" INTO source_amount FROM "ClearingEventVersion" WHERE "id" = NEW."sourceEventVersionId" FOR UPDATE;
  IF source_amount IS NULL THEN RAISE EXCEPTION 'allocation source version is missing'; END IF;
  SELECT COALESCE(SUM("amountCents"), 0)::bigint INTO used_amount
    FROM "ClearingAllocation" WHERE "sourceEventVersionId" = NEW."sourceEventVersionId";
  IF used_amount + NEW."amountCents" > source_amount THEN
    RAISE EXCEPTION 'allocation exceeds immutable source balance';
  END IF;
  IF NEW."sourceRemainingAfterCents" <> source_amount - used_amount - NEW."amountCents" THEN
    RAISE EXCEPTION 'allocation remaining balance snapshot is inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClearingAllocation_pol214_balance_guard"
BEFORE INSERT ON "ClearingAllocation"
FOR EACH ROW EXECUTE FUNCTION "pol214_clearing_allocation_guard"();

-- Evidence is an immutable, non-exclusive authority snapshot. Extend the
-- canonical file-binding inventory and protect the reference at the database
-- boundary so later file replacement/deletion cannot alter the authority.
SELECT pg_advisory_xact_lock(190731, 214);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority()
  UNION ALL
  VALUES ('AffiliateClearingAuthorityVersion', 'evidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_affiliate_clearing_authority_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId"
ON "AffiliateClearingAuthorityVersion"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'evidenceFileId', 'false'
);

COMMIT;
