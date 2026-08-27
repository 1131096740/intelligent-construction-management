-- POL-12A：外部已批准工资来源与月度工资承担单的冻结聚合；不生成成本、应付或付款事实。
BEGIN;
CREATE TABLE "WageApprovedSourceVersion" (
  "id" TEXT NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "sourceType" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "basisDate" DATE NOT NULL,
  "evidenceFileId" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageApprovedSourceVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageStatement" (
  "id" TEXT NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WageStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageServiceBasisBinding" (
  "id" TEXT NOT NULL,
  "sourceVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "serviceSnapshotId" TEXT NOT NULL,
  "serviceMonth" TEXT NOT NULL,
  "evidenceSha256" TEXT NOT NULL,
  "authorityFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageServiceBasisBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageApprovedSourceCommandReceipt" (
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageApprovedSourceCommandReceipt_pkey" PRIMARY KEY ("idempotencyKey")
);

CREATE TABLE "WageStatementVersion" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'base',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceVersionId" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "lastEditedByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "reviewReturnedByUserId" TEXT,
  "reviewReturnedAt" TIMESTAMP(3),
  "reviewReturnReason" TEXT,
  "reviewDisposition" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WageStatementVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageCommandReceipt" (
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageCommandReceipt_pkey" PRIMARY KEY ("idempotencyKey")
);

CREATE TABLE "WagePersonLine" (
  "id" TEXT NOT NULL,
  "statementVersionId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employmentSnapshotId" TEXT NOT NULL,
  "employeeSnapshot" JSONB NOT NULL,
  "employmentSnapshot" JSONB NOT NULL,
  "periodSnapshot" JSONB NOT NULL,
  "positionCategorySnapshot" JSONB NOT NULL,
  "approvedAmountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WagePersonLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageCostComponent" (
  "id" TEXT NOT NULL,
  "personLineId" TEXT NOT NULL,
  "componentCode" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageCostComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageCreditorBreakdown" (
  "id" TEXT NOT NULL,
  "personLineId" TEXT NOT NULL,
  "creditorSubjectId" TEXT NOT NULL,
  "creditorCategory" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageCreditorBreakdown_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageProjectAllocation" (
  "id" TEXT NOT NULL,
  "personLineId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "serviceSnapshotId" TEXT NOT NULL,
  "serviceBasisBindingId" TEXT NOT NULL,
  "serviceSnapshot" JSONB NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageProjectAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WageApprovedSourceVersion_external_identity_key" ON "WageApprovedSourceVersion"("employmentCompanyId", "externalReference", "sourceVersion");
CREATE INDEX "WageApprovedSourceVersion_employmentCompanyId_wageMonth_periodStart_periodEnd_idx" ON "WageApprovedSourceVersion"("employmentCompanyId", "wageMonth", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "WageServiceBasisBinding_source_project_service_key" ON "WageServiceBasisBinding"("sourceVersionId", "projectId", "serviceSnapshotId");
CREATE INDEX "WageServiceBasisBinding_sourceVersionId_serviceMonth_idx" ON "WageServiceBasisBinding"("sourceVersionId", "serviceMonth");
CREATE UNIQUE INDEX "WageStatement_company_month_key" ON "WageStatement"("employmentCompanyId", "wageMonth");
CREATE INDEX "WageApprovedSourceCommandReceipt_aggregateId_createdAt_idx" ON "WageApprovedSourceCommandReceipt"("aggregateId", "createdAt");
CREATE UNIQUE INDEX "WageStatementVersion_statement_revision_key" ON "WageStatementVersion"("statementId", "revision");
CREATE INDEX "WageStatementVersion_sourceVersionId_idx" ON "WageStatementVersion"("sourceVersionId");
CREATE INDEX "WageStatementVersion_status_updatedAt_idx" ON "WageStatementVersion"("status", "updatedAt");
CREATE INDEX "WageStatementVersion_reviewDisposition_reviewReturnedAt_idx" ON "WageStatementVersion"("reviewDisposition", "reviewReturnedAt");
CREATE INDEX "WageCommandReceipt_aggregateId_createdAt_idx" ON "WageCommandReceipt"("aggregateId", "createdAt");
CREATE UNIQUE INDEX "WagePersonLine_version_employee_employment_key" ON "WagePersonLine"("statementVersionId", "employeeId", "employmentSnapshotId");
CREATE INDEX "WagePersonLine_employeeId_idx" ON "WagePersonLine"("employeeId");
CREATE UNIQUE INDEX "WageCostComponent_person_component_key" ON "WageCostComponent"("personLineId", "componentCode");
CREATE UNIQUE INDEX "WageCreditorBreakdown_person_creditor_category_key" ON "WageCreditorBreakdown"("personLineId", "creditorSubjectId", "creditorCategory");
CREATE UNIQUE INDEX "WageProjectAllocation_person_project_service_key" ON "WageProjectAllocation"("personLineId", "projectId", "serviceSnapshotId");
CREATE INDEX "WageProjectAllocation_projectId_idx" ON "WageProjectAllocation"("projectId");
CREATE INDEX "WageProjectAllocation_serviceBasisBindingId_idx" ON "WageProjectAllocation"("serviceBasisBindingId");

ALTER TABLE "WageStatementVersion" ADD CONSTRAINT "WageStatementVersion_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "WageStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageApprovedSourceVersion" ADD CONSTRAINT "WageApprovedSourceVersion_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageServiceBasisBinding" ADD CONSTRAINT "WageServiceBasisBinding_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageApprovedSourceCommandReceipt" ADD CONSTRAINT "WageApprovedSourceCommandReceipt_aggregateId_fkey" FOREIGN KEY ("aggregateId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageCommandReceipt" ADD CONSTRAINT "WageCommandReceipt_aggregateId_fkey" FOREIGN KEY ("aggregateId") REFERENCES "WageStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageStatementVersion" ADD CONSTRAINT "WageStatementVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WagePersonLine" ADD CONSTRAINT "WagePersonLine_statementVersionId_fkey" FOREIGN KEY ("statementVersionId") REFERENCES "WageStatementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageCostComponent" ADD CONSTRAINT "WageCostComponent_personLineId_fkey" FOREIGN KEY ("personLineId") REFERENCES "WagePersonLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageCreditorBreakdown" ADD CONSTRAINT "WageCreditorBreakdown_personLineId_fkey" FOREIGN KEY ("personLineId") REFERENCES "WagePersonLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageProjectAllocation" ADD CONSTRAINT "WageProjectAllocation_personLineId_fkey" FOREIGN KEY ("personLineId") REFERENCES "WagePersonLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WageProjectAllocation" ADD CONSTRAINT "WageProjectAllocation_serviceBasisBindingId_fkey" FOREIGN KEY ("serviceBasisBindingId") REFERENCES "WageServiceBasisBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WageApprovedSourceVersion"
  ADD CONSTRAINT "WageApprovedSourceVersion_source_type_check" CHECK ("sourceType" = 'external_approved_wage'),
  ADD CONSTRAINT "WageApprovedSourceVersion_wage_month_check" CHECK ("wageMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "WageApprovedSourceVersion_evidence_sha256_check" CHECK ("evidenceSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "WageStatement"
  ADD CONSTRAINT "WageStatement_wage_month_check" CHECK ("wageMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "WageStatementVersion"
  ADD CONSTRAINT "WageStatementVersion_kind_check" CHECK ("kind" IN ('base', 'normal', 'supplemental', 'correction', 'reversal')),
  ADD CONSTRAINT "WageStatementVersion_status_check" CHECK ("status" IN ('draft', 'submitted', 'confirmed', 'superseded')),
  ADD CONSTRAINT "WageStatementVersion_review_disposition_check" CHECK ("reviewDisposition" IS NULL OR "reviewDisposition" = 'review_returned');
ALTER TABLE "WagePersonLine" ADD CONSTRAINT "WagePersonLine_approved_amount_nonnegative_check" CHECK ("approvedAmountCents" >= 0);
ALTER TABLE "WageCostComponent"
  ADD CONSTRAINT "WageCostComponent_amount_nonnegative_check" CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "WageCostComponent_code_check" CHECK ("componentCode" IN ('gross_wage', 'project_post_allowance', 'project_bonus', 'employer_social_insurance', 'employer_housing_fund', 'other_evidenced_labor_cost'));
ALTER TABLE "WageCreditorBreakdown"
  ADD CONSTRAINT "WageCreditorBreakdown_amount_nonnegative_check" CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "WageCreditorBreakdown_category_check" CHECK ("creditorCategory" IN ('employee_net_pay', 'withheld_individual_income_tax', 'employee_social_insurance', 'employee_housing_fund', 'employer_social_insurance', 'employer_housing_fund', 'other_controlled_payee'));
ALTER TABLE "WageProjectAllocation" ADD CONSTRAINT "WageProjectAllocation_amount_nonnegative_check" CHECK ("amountCents" >= 0);
ALTER TABLE "WageServiceBasisBinding" ADD CONSTRAINT "WageServiceBasisBinding_evidence_sha256_check" CHECK ("evidenceSha256" ~ '^[0-9a-f]{64}$');

-- 已批准工资来源的证据是不可变来源事实。它必须进入全局 FileObject
-- 绑定守卫，且作为独占事实，禁止后续被其他业务记录或替换链复用。
SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "WageApprovedSourceVersion" IN SHARE ROW EXCLUSIVE MODE;

ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_wage_statement;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_wage_statement()
  UNION ALL
  VALUES
    ('WageApprovedSourceVersion', 'evidenceFileId', TRUE);
$$;

CREATE TRIGGER jg_efb_wage_approved_source_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "WageApprovedSourceVersion"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'evidenceFileId',
  'true'
);

COMMIT;
