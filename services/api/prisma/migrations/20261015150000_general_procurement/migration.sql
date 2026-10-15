BEGIN;

CREATE TABLE "GeneralProcurement" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "creationFingerprint" TEXT NOT NULL, "projectId" TEXT NOT NULL, "companyEntityId" TEXT NOT NULL,
  "companyNameSnapshot" TEXT NOT NULL, "applicantUserId" TEXT NOT NULL, "applicantNameSnapshot" TEXT NOT NULL,
  "category" TEXT NOT NULL, "reason" TEXT NOT NULL, "requestedAmountCents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft', "revision" INTEGER NOT NULL DEFAULT 1,
  "approvalInstanceId" TEXT, "submissions" JSONB NOT NULL DEFAULT '[]',
  "archivedByUserId" TEXT, "archivedAt" TIMESTAMP(3), "archiveFileId" TEXT, "archiveNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneralProcurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneralProcurement_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT,
  CONSTRAINT "GeneralProcurement_company_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT,
  CONSTRAINT "GeneralProcurement_applicant_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "GeneralProcurement_archive_file_fkey" FOREIGN KEY ("archiveFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT,
  CONSTRAINT "GeneralProcurement_amount_check" CHECK ("requestedAmountCents" > 0),
  CONSTRAINT "GeneralProcurement_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "GeneralProcurement_status_check" CHECK ("status" IN ('draft','approval_pending','returned','approved_pending_archive','archived')),
  CONSTRAINT "GeneralProcurement_category_check" CHECK ("category" IN ('office_supplies','construction_tools','gifts','logistics','meals','utilities','other')),
  CONSTRAINT "GeneralProcurement_archive_check" CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL AND "archivedByUserId" IS NOT NULL AND "archiveFileId" IS NOT NULL AND "archiveNote" IS NOT NULL))
);
CREATE UNIQUE INDEX "GeneralProcurement_code_key" ON "GeneralProcurement"("code");
CREATE UNIQUE INDEX "GeneralProcurement_requestKey_key" ON "GeneralProcurement"("requestKey");
CREATE INDEX "GeneralProcurement_projectId_status_idx" ON "GeneralProcurement"("projectId", "status");
CREATE INDEX "GeneralProcurement_applicantUserId_updatedAt_idx" ON "GeneralProcurement"("applicantUserId", "updatedAt");
CREATE INDEX "GeneralProcurement_archiveFileId_idx" ON "GeneralProcurement"("archiveFileId");

CREATE FUNCTION "guard_general_procurement_archive"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."submissions" <> '[]'::jsonb OR OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'submitted procurement history cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'archived procurement cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GeneralProcurement_archive_guard" BEFORE UPDATE OR DELETE ON "GeneralProcurement"
FOR EACH ROW EXECUTE FUNCTION "guard_general_procurement_archive"();

ALTER TABLE "ExpenseClaim" ADD COLUMN "generalProcurementId" TEXT, ADD COLUMN "generalProcurementRequestKey" TEXT, ADD COLUMN "generalProcurementFingerprint" TEXT;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_general_procurement_fkey" FOREIGN KEY ("generalProcurementId") REFERENCES "GeneralProcurement"("id") ON DELETE RESTRICT;
CREATE INDEX "ExpenseClaim_generalProcurementId_idx" ON "ExpenseClaim"("generalProcurementId");
CREATE UNIQUE INDEX "ExpenseClaim_generalProcurementRequestKey_key" ON "ExpenseClaim"("generalProcurementRequestKey");
ALTER TABLE "ExpenseClaim" DROP CONSTRAINT "ExpenseClaim_incidental_expense_category_check";
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_incidental_expense_category_check" CHECK (
  ("claimType" = 'incidental_expense' AND "projectId" IS NOT NULL AND
    (("generalProcurementId" IS NULL AND "incidentalExpenseCategory" IN ('temporary_service','temporary_machinery_shift','sporadic_labor','other_incidental')) OR
     ("generalProcurementId" IS NOT NULL AND "incidentalExpenseCategory" IN ('procurement_office_supplies','procurement_construction_tools','procurement_gifts','procurement_logistics','procurement_meals','procurement_utilities','procurement_other')))) OR
  ("claimType" <> 'incidental_expense' AND "incidentalExpenseCategory" IS NULL AND "generalProcurementId" IS NULL)
);
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_general_procurement_identity_check" CHECK (
  ("generalProcurementId" IS NULL AND "generalProcurementRequestKey" IS NULL AND "generalProcurementFingerprint" IS NULL) OR
  ("generalProcurementId" IS NOT NULL AND "generalProcurementRequestKey" IS NOT NULL AND "generalProcurementFingerprint" IS NOT NULL)
);
CREATE FUNCTION "guard_general_procurement_payment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "GeneralProcurement"%ROWTYPE; reserved BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."generalProcurementId", NEW."generalProcurementRequestKey", NEW."generalProcurementFingerprint") IS DISTINCT FROM (OLD."generalProcurementId", OLD."generalProcurementRequestKey", OLD."generalProcurementFingerprint") THEN
    RAISE EXCEPTION 'procurement payment source is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."generalProcurementId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO source FROM "GeneralProcurement" WHERE "id" = NEW."generalProcurementId" FOR UPDATE;
  IF source."status" IS DISTINCT FROM 'archived' OR NEW."projectId" IS DISTINCT FROM source."projectId" OR NEW."companyEntityId" IS DISTINCT FROM source."companyEntityId" OR NEW."incidentalExpenseCategory" IS DISTINCT FROM ('procurement_' || source."category") THEN
    RAISE EXCEPTION 'procurement payment source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("requestedAmountCents"),0) INTO reserved FROM "ExpenseClaim" WHERE "generalProcurementId" = source."id" AND "id" <> NEW."id" AND "status" <> 'rejected';
  IF NEW."status" <> 'rejected' AND reserved + NEW."requestedAmountCents" > source."requestedAmountCents" THEN
    RAISE EXCEPTION 'procurement payment exceeds approved amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ExpenseClaim_general_procurement_guard" BEFORE INSERT OR UPDATE ON "ExpenseClaim" FOR EACH ROW EXECUTE FUNCTION "guard_general_procurement_payment"();

SELECT pg_advisory_xact_lock(190731, 13);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_general_procurement;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_general_procurement()
  UNION ALL
  VALUES ('GeneralProcurement', 'archiveFileId', FALSE);
$$;
CREATE TRIGGER jg_efb_general_procurement_archive
BEFORE INSERT OR UPDATE OF "archiveFileId" ON "GeneralProcurement"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('archiveFileId', 'false');

COMMIT;
