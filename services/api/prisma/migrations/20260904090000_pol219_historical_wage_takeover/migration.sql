-- POL-219：历史工资接管的双权威、三分级、版本级原子作用域。
-- 仅定义不可变 schema/约束；不扫描、回填、激活或修改任何业务数据。
BEGIN;

ALTER TABLE "WageStatementVersion"
  ADD COLUMN "projectionOrigin" TEXT NOT NULL DEFAULT 'ordinary',
  ADD CONSTRAINT "WageStatementVersion_projection_origin_check"
    CHECK ("projectionOrigin" IN ('ordinary', 'historical_takeover_legacy_link'));
CREATE INDEX "WageStatementVersion_projectionOrigin_status_idx"
  ON "WageStatementVersion"("projectionOrigin", "status");

CREATE TABLE "OperatingTakeoverAtomicScopeVersion" (
  "id" TEXT NOT NULL,
  "scopeKind" TEXT NOT NULL,
  "authoritySourceRef" TEXT NOT NULL,
  "authoritySourceFingerprint" TEXT NOT NULL,
  "sourceClosureFingerprint" TEXT NOT NULL,
  "reservedWageStatementVersionId" TEXT,
  "candidateBaselineSha" TEXT NOT NULL,
  "permissionSnapshotFingerprint" TEXT NOT NULL,
  "readSetFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverAtomicScopeVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverAtomicScopeVersion_hash_check" CHECK (
    "authoritySourceFingerprint" ~ '^[0-9a-f]{64}$' AND
    "sourceClosureFingerprint" ~ '^[0-9a-f]{64}$' AND
    "permissionSnapshotFingerprint" ~ '^[0-9a-f]{64}$' AND
    "readSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "candidateBaselineSha" ~ '^[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT "OperatingTakeoverAtomicScopeVersion_kind_check" CHECK ("scopeKind" = 'historical_wage')
);
CREATE UNIQUE INDEX "OperatingTakeoverAtomicScopeVersion_authority_closure_key"
  ON "OperatingTakeoverAtomicScopeVersion"("scopeKind", "authoritySourceRef", "authoritySourceFingerprint", "sourceClosureFingerprint");
CREATE UNIQUE INDEX "OperatingTakeoverAtomicScopeVersion_reserved_wage_key"
  ON "OperatingTakeoverAtomicScopeVersion"("reservedWageStatementVersionId")
  WHERE "reservedWageStatementVersionId" IS NOT NULL;
CREATE INDEX "OperatingTakeoverAtomicScopeVersion_kind_created_idx"
  ON "OperatingTakeoverAtomicScopeVersion"("scopeKind", "createdAt");

-- A prepared scope reserves the exact future confirmed version UUID without
-- creating a draft/canonical WageStatementVersion.  The immutable reservation
-- is the only A-level mapping target before activation.
CREATE TABLE "WageTakeoverWageStatementReservation" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "targetWageStatementId" TEXT NOT NULL,
  "expectedCurrentRevision" INTEGER NOT NULL,
  "reservedRevision" INTEGER NOT NULL,
  "versionKind" TEXT NOT NULL,
  "priorConfirmedVersionId" TEXT,
  "priorSourceVersionId" TEXT,
  "sourceDeltaFingerprint" TEXT NOT NULL,
  "canonicalRootClosureFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageTakeoverWageStatementReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageTakeoverWageStatementReservation_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverWageStatementReservation_shape_check" CHECK (
    "expectedCurrentRevision" >= 0 AND
    "reservedRevision" = "expectedCurrentRevision" + 1 AND
    "versionKind" IN ('base', 'correction', 'reversal') AND
    "sourceDeltaFingerprint" ~ '^[0-9a-f]{64}$' AND
    "canonicalRootClosureFingerprint" ~ '^[0-9a-f]{64}$' AND
    (("expectedCurrentRevision" = 0 AND "reservedRevision" = 1 AND "versionKind" = 'base' AND
      "priorConfirmedVersionId" IS NULL AND "priorSourceVersionId" IS NULL) OR
     ("expectedCurrentRevision" > 0 AND "versionKind" IN ('correction', 'reversal') AND
      "priorConfirmedVersionId" IS NOT NULL AND "priorSourceVersionId" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "WageTakeoverWageStatementReservation_scope_key"
  ON "WageTakeoverWageStatementReservation"("atomicScopeVersionId");
CREATE UNIQUE INDEX "WageTakeoverWageStatementReservation_id_scope_key"
  ON "WageTakeoverWageStatementReservation"("id", "atomicScopeVersionId");
CREATE UNIQUE INDEX "WageTakeoverWageStatementReservation_target_revision_key"
  ON "WageTakeoverWageStatementReservation"("targetWageStatementId", "reservedRevision");

ALTER TABLE "OperatingTakeoverManifestVersion"
  ADD COLUMN "atomicScopeVersionId" TEXT,
  ADD COLUMN "adapterKind" TEXT NOT NULL DEFAULT 'construction_enterprise_clearing';
ALTER TABLE "OperatingTakeoverManifestVersion"
  ADD CONSTRAINT "OperatingTakeoverManifestVersion_atomicScopeVersionId_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatingTakeoverManifestVersion_adapter_kind_check"
    CHECK ("adapterKind" IN ('construction_enterprise_clearing', 'historical_wage'));
CREATE UNIQUE INDEX "OperatingTakeoverManifestVersion_scope_manifest_key"
  ON "OperatingTakeoverManifestVersion"("atomicScopeVersionId", "id");
CREATE INDEX "OperatingTakeoverManifestVersion_scope_project_idx"
  ON "OperatingTakeoverManifestVersion"("atomicScopeVersionId", "projectId");

CREATE TABLE "OperatingTakeoverAtomicScopeProject" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "manifestVersionId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverAtomicScopeProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingTakeoverAtomicScopeProject_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingTakeoverAtomicScopeProject_manifest_fkey"
    FOREIGN KEY ("manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperatingTakeoverAtomicScopeProject_scope_project_key"
  ON "OperatingTakeoverAtomicScopeProject"("atomicScopeVersionId", "projectId");
CREATE UNIQUE INDEX "OperatingTakeoverAtomicScopeProject_scope_manifest_key"
  ON "OperatingTakeoverAtomicScopeProject"("atomicScopeVersionId", "manifestVersionId");
CREATE UNIQUE INDEX "OperatingTakeoverAtomicScopeProject_manifest_key"
  ON "OperatingTakeoverAtomicScopeProject"("manifestVersionId");

ALTER TABLE "OperatingTakeoverRowMapping"
  ADD COLUMN "adapterKind" TEXT NOT NULL DEFAULT 'construction_enterprise_clearing',
  ADD COLUMN "wageApprovedSourceVersionId" TEXT,
  ADD COLUMN "wageStatementReservationId" TEXT,
  ADD COLUMN "historicalWageSummaryAuthorityVersionId" TEXT;
ALTER TABLE "OperatingTakeoverRowMapping"
  ADD CONSTRAINT "OperatingTakeoverRowMapping_adapter_kind_check"
    CHECK ("adapterKind" IN ('construction_enterprise_clearing', 'historical_wage'));
CREATE INDEX "OperatingTakeoverRowMapping_wage_source_idx" ON "OperatingTakeoverRowMapping"("wageApprovedSourceVersionId");
CREATE INDEX "OperatingTakeoverRowMapping_wage_reservation_idx" ON "OperatingTakeoverRowMapping"("wageStatementReservationId");
CREATE UNIQUE INDEX "OperatingTakeoverRowMapping_envelope_scope_key"
  ON "OperatingTakeoverRowMapping"("id", "manifestVersionId", "projectId");

ALTER TABLE "OperatingTakeoverCommandReceipt"
  ALTER COLUMN "manifestVersionId" DROP NOT NULL,
  ADD COLUMN "atomicScopeVersionId" TEXT,
  ADD COLUMN "commandSnapshotSchemaVersion" INTEGER,
  ADD COLUMN "commandSnapshot" JSONB,
  ADD COLUMN "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current();
ALTER TABLE "OperatingTakeoverCommandReceipt"
  ADD CONSTRAINT "OperatingTakeoverCommandReceipt_atomicScopeVersionId_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatingTakeoverCommandReceipt_owner_xor_check"
    CHECK (num_nonnulls("manifestVersionId", "atomicScopeVersionId") = 1);
CREATE INDEX "OperatingTakeoverCommandReceipt_scope_action_created_idx"
  ON "OperatingTakeoverCommandReceipt"("atomicScopeVersionId", "action", "createdAt");

ALTER TABLE "OperatingTakeoverCommandReceiptLine"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "causesLineId" TEXT;
ALTER TABLE "OperatingTakeoverCommandReceiptLine"
  ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_causesLineId_fkey"
    FOREIGN KEY ("causesLineId") REFERENCES "OperatingTakeoverCommandReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OperatingTakeoverCommandReceiptLine_causesLineId_idx"
  ON "OperatingTakeoverCommandReceiptLine"("causesLineId");

-- #215 bridge rows remain valid with NULL here; only #219 inserts are bound to
-- their creating transaction by the historical-wage trigger below.
ALTER TABLE "OperatingTakeoverLegacySourceBridge"
  ADD COLUMN "createdTransactionId" BIGINT;

CREATE TABLE "HistoricalWageSummaryAuthorityVersion" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "summaryBucketKey" TEXT NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "catalogVersion" TEXT NOT NULL,
  "positionCategoryCode" TEXT NOT NULL,
  "positionCategoryLabelSnapshot" TEXT NOT NULL,
  "evidenceCoordinate" JSONB NOT NULL,
  "sourceSchemaVersion" INTEGER NOT NULL,
  "sourcePayload" JSONB NOT NULL,
  "sourceVersionFingerprint" TEXT NOT NULL,
  "authoritySchemaVersion" INTEGER NOT NULL,
  "authorityPayload" JSONB NOT NULL,
  "authorityFingerprint" TEXT NOT NULL,
  "assignedWageExclusionSchemaVersion" INTEGER NOT NULL,
  "assignedWageExclusionPayload" JSONB NOT NULL,
  "assignedWageExclusionSetFingerprint" TEXT NOT NULL,
  "scopeCreatorIdentitySnapshot" JSONB NOT NULL,
  "permissionScopeFingerprint" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "supersedesVersionId" TEXT,
  "lineageRootAuthorityVersionId" TEXT,
  "sourceDeltaFingerprint" TEXT NOT NULL,
  "rootClosureFingerprint" TEXT NOT NULL,
  "declaredByUserId" TEXT NOT NULL,
  "declaredDelegatorUserId" TEXT,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_supersedes_fkey"
    FOREIGN KEY ("supersedesVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_root_fkey"
    FOREIGN KEY ("lineageRootAuthorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_hash_check" CHECK (
    "sourceVersionFingerprint" ~ '^[0-9a-f]{64}$' AND
    "authorityFingerprint" ~ '^[0-9a-f]{64}$' AND
    "assignedWageExclusionSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "permissionScopeFingerprint" ~ '^[0-9a-f]{64}$' AND
    "sourceDeltaFingerprint" ~ '^[0-9a-f]{64}$' AND
    "rootClosureFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_revision_check" CHECK (
    "revision" > 0 AND
    (("revision" = 1 AND "supersedesVersionId" IS NULL AND "lineageRootAuthorityVersionId" IS NULL) OR
     ("revision" > 1 AND "supersedesVersionId" IS NOT NULL AND "lineageRootAuthorityVersionId" IS NOT NULL))
  ),
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_month_check" CHECK ("wageMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "HistoricalWageSummaryAuthorityVersion_catalog_check" CHECK (
    "catalogVersion" = 'historical_wage_position_category_v1' AND
    (
      ("positionCategoryCode" = 'project_leadership' AND "positionCategoryLabelSnapshot" = '项目领导班子') OR
      ("positionCategoryCode" = 'engineering_technical' AND "positionCategoryLabelSnapshot" = '工程技术人员') OR
      ("positionCategoryCode" = 'quality_safety' AND "positionCategoryLabelSnapshot" = '质量安全人员') OR
      ("positionCategoryCode" = 'commercial_contract_cost' AND "positionCategoryLabelSnapshot" = '商务合约与成本预算人员') OR
      ("positionCategoryCode" = 'material_equipment' AND "positionCategoryLabelSnapshot" = '材料设备人员') OR
      ("positionCategoryCode" = 'finance_administration' AND "positionCategoryLabelSnapshot" = '财务与综合行政人员') OR
      ("positionCategoryCode" = 'project_management_unspecified' AND "positionCategoryLabelSnapshot" = '项目管理人员（未细分）')
    )
  )
);
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityVersion_scope_bucket_key"
  ON "HistoricalWageSummaryAuthorityVersion"("atomicScopeVersionId", "summaryBucketKey");
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityVersion_scope_fingerprint_key"
  ON "HistoricalWageSummaryAuthorityVersion"("atomicScopeVersionId", "authorityFingerprint");
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityVersion_bucket_revision_key"
  ON "HistoricalWageSummaryAuthorityVersion"("summaryBucketKey", "revision");
CREATE UNIQUE INDEX "HWSAuthority_business_revision_key"
  ON "HistoricalWageSummaryAuthorityVersion"("employmentCompanyId", "projectId", "wageMonth", "positionCategoryCode", "revision");
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityVersion_direct_successor_key"
  ON "HistoricalWageSummaryAuthorityVersion"("supersedesVersionId") WHERE "supersedesVersionId" IS NOT NULL;
CREATE INDEX "HistoricalWageSummaryAuthorityVersion_bucket_idx"
  ON "HistoricalWageSummaryAuthorityVersion"("employmentCompanyId", "projectId", "wageMonth");
CREATE INDEX "HistoricalWageSummaryAuthorityVersion_root_idx"
  ON "HistoricalWageSummaryAuthorityVersion"("lineageRootAuthorityVersionId");

CREATE TABLE "HistoricalWageSummaryAuthorityCreditorLine" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "stableBucketKey" TEXT NOT NULL,
  "stableBucketKeyFingerprint" TEXT NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "positionCategoryCode" TEXT NOT NULL,
  "wageCreditorCategoryCode" TEXT NOT NULL,
  "wageCreditorCategoryLabelSnapshot" TEXT NOT NULL,
  "creditorIdentityKind" TEXT NOT NULL,
  "creditorPartyVersionId" TEXT,
  "controlledScopeCode" TEXT,
  "controlledScopeDescription" TEXT,
  "controlledScopeEvidenceCoordinate" JSONB,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "debtStatus" TEXT NOT NULL,
  "grossDebtCents" BIGINT NOT NULL,
  "historicallySettledCents" BIGINT NOT NULL,
  "outstandingBalanceCents" BIGINT NOT NULL,
  "isTombstone" BOOLEAN NOT NULL DEFAULT false,
  "targetKind" TEXT NOT NULL,
  "targetSchemaVersion" INTEGER NOT NULL,
  "targetBusinessKey" TEXT NOT NULL,
  "targetPayload" JSONB NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "signedGrossDeltaCents" BIGINT NOT NULL,
  "signedHistoricallySettledDeltaCents" BIGINT NOT NULL,
  "signedOutstandingBalanceDeltaCents" BIGINT NOT NULL,
  "deltaFingerprint" TEXT NOT NULL,
  "rootCreditorLineId" TEXT,
  "rootPayableRefId" TEXT,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryAuthorityCreditorLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HWSAuthorityCreditorLine_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HWSAuthorityCreditorLine_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HWSAuthorityCreditorLine_root_fkey"
    FOREIGN KEY ("rootCreditorLineId") REFERENCES "HistoricalWageSummaryAuthorityCreditorLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HWSAuthorityCreditorLine_shape_check" CHECK (
    "revision" > 0 AND "currencyCode" = 'CNY' AND
    "stableBucketKeyFingerprint" ~ '^[0-9a-f]{64}$' AND
    "wageMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND
    "grossDebtCents" >= 0 AND "historicallySettledCents" >= 0 AND "outstandingBalanceCents" >= 0 AND
    "grossDebtCents" = "historicallySettledCents" + "outstandingBalanceCents" AND
    "debtStatus" IN ('settled', 'partially_settled', 'outstanding') AND
    (("debtStatus" = 'settled' AND "outstandingBalanceCents" = 0) OR
     ("debtStatus" = 'partially_settled' AND "historicallySettledCents" > 0 AND "outstandingBalanceCents" > 0) OR
     ("debtStatus" = 'outstanding' AND "historicallySettledCents" = 0 AND "outstandingBalanceCents" > 0)) AND
    "isTombstone" = ("grossDebtCents" = 0) AND
    (NOT "isTombstone" OR ("historicallySettledCents" = 0 AND "outstandingBalanceCents" = 0 AND "debtStatus" = 'settled')) AND
    "targetKind" IN ('existing_verified_payment_execution_set', 'historical_wage_balance_reconciliation_version') AND
    "targetSchemaVersion" = 1 AND
    length(btrim("targetBusinessKey")) > 0 AND
    "targetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "creditorIdentityKind" = 'aggregate_creditor_scope' AND
    "creditorPartyVersionId" IS NULL AND
    "deltaFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "HWSAuthorityCreditorLine_creditor_check" CHECK (
    ("wageCreditorCategoryCode" = 'employee_net_pay' AND "wageCreditorCategoryLabelSnapshot" = '员工实发工资') OR
    ("wageCreditorCategoryCode" = 'withheld_individual_income_tax' AND "wageCreditorCategoryLabelSnapshot" = '代扣代缴个人所得税') OR
    ("wageCreditorCategoryCode" = 'employee_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担社会保险') OR
    ("wageCreditorCategoryCode" = 'employee_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担住房公积金') OR
    ("wageCreditorCategoryCode" = 'employer_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '单位承担社会保险') OR
    ("wageCreditorCategoryCode" = 'employer_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '单位承担住房公积金') OR
    ("wageCreditorCategoryCode" = 'other_controlled_payee' AND "wageCreditorCategoryLabelSnapshot" = '其他受控收款方' AND
      length(btrim(COALESCE("controlledScopeDescription", ''))) > 0 AND
      "controlledScopeEvidenceCoordinate" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "HWSAuthorityCreditorLine_authority_stable_key"
  ON "HistoricalWageSummaryAuthorityCreditorLine"("authorityVersionId", "stableBucketKeyFingerprint");
CREATE UNIQUE INDEX "HWSCreditor_business_revision_stable_key"
  ON "HistoricalWageSummaryAuthorityCreditorLine"("employmentCompanyId", "projectId", "wageMonth", "positionCategoryCode", "revision", "stableBucketKeyFingerprint");
CREATE INDEX "HWSAuthorityCreditorLine_scope_project_month_idx"
  ON "HistoricalWageSummaryAuthorityCreditorLine"("atomicScopeVersionId", "projectId", "wageMonth");
CREATE INDEX "HWSAuthorityCreditorLine_root_idx"
  ON "HistoricalWageSummaryAuthorityCreditorLine"("rootCreditorLineId");

ALTER TABLE "OperatingTakeoverRowMapping"
  ADD CONSTRAINT "OperatingTakeoverRowMapping_wage_source_fkey"
    FOREIGN KEY ("wageApprovedSourceVersionId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingTakeoverRowMapping_wage_reservation_fkey"
    FOREIGN KEY ("wageStatementReservationId") REFERENCES "WageTakeoverWageStatementReservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingTakeoverRowMapping_wage_summary_authority_fkey"
    FOREIGN KEY ("historicalWageSummaryAuthorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "OperatingTakeoverRowMapping_wage_summary_authority_idx"
  ON "OperatingTakeoverRowMapping"("historicalWageSummaryAuthorityVersionId");

CREATE TABLE "HistoricalWageBalanceReconciliationVersion" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "authorityCreditorLineId" TEXT NOT NULL,
  "reconciliationAuthorityVersionId" TEXT NOT NULL,
  "reconciliationReference" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "canonicalPayload" JSONB NOT NULL,
  "sourceVersionFingerprint" TEXT NOT NULL,
  "reconciliationFingerprint" TEXT NOT NULL,
  "asOfDate" DATE NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "employmentCompanyNameSnapshot" TEXT NOT NULL,
  "employmentCompanyCreditCodeSnapshot" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectCodeSnapshot" TEXT NOT NULL,
  "projectNameSnapshot" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "catalogVersion" TEXT NOT NULL,
  "positionCategoryCode" TEXT NOT NULL,
  "positionCategoryLabelSnapshot" TEXT NOT NULL,
  "wageCreditorCategoryCode" TEXT NOT NULL,
  "wageCreditorCategoryLabelSnapshot" TEXT NOT NULL,
  "creditorIdentityKind" TEXT NOT NULL,
  "creditorPartyVersionId" TEXT,
  "controlledScopeCode" TEXT,
  "controlledScopeDescription" TEXT,
  "targetBusinessKey" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "debtStatus" TEXT NOT NULL,
  "grossDebtCents" BIGINT NOT NULL,
  "historicallySettledCents" BIGINT NOT NULL,
  "outstandingBalanceCents" BIGINT NOT NULL,
  "evidenceSnapshot" JSONB NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageBalanceReconciliationVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageBalanceReconciliationVersion_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageBalanceReconciliationVersion_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HWSBalanceRecon_creditor_line_fkey"
    FOREIGN KEY ("authorityCreditorLineId") REFERENCES "HistoricalWageSummaryAuthorityCreditorLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageBalanceReconciliationVersion_shape_check" CHECK (
    "schemaVersion" = 1 AND
    "currencyCode" = 'CNY' AND
    "creditorIdentityKind" = 'aggregate_creditor_scope' AND
    "creditorPartyVersionId" IS NULL AND
    length(btrim("targetBusinessKey")) > 0 AND
    "sourceVersionFingerprint" ~ '^[0-9a-f]{64}$' AND
    "reconciliationFingerprint" ~ '^[0-9a-f]{64}$' AND
    "wageMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND
    "catalogVersion" = 'historical_wage_position_category_v1' AND
    (
      ("positionCategoryCode" = 'project_leadership' AND "positionCategoryLabelSnapshot" = '项目领导班子') OR
      ("positionCategoryCode" = 'engineering_technical' AND "positionCategoryLabelSnapshot" = '工程技术人员') OR
      ("positionCategoryCode" = 'quality_safety' AND "positionCategoryLabelSnapshot" = '质量安全人员') OR
      ("positionCategoryCode" = 'commercial_contract_cost' AND "positionCategoryLabelSnapshot" = '商务合约与成本预算人员') OR
      ("positionCategoryCode" = 'material_equipment' AND "positionCategoryLabelSnapshot" = '材料设备人员') OR
      ("positionCategoryCode" = 'finance_administration' AND "positionCategoryLabelSnapshot" = '财务与综合行政人员') OR
      ("positionCategoryCode" = 'project_management_unspecified' AND "positionCategoryLabelSnapshot" = '项目管理人员（未细分）')
    ) AND
    (
      ("wageCreditorCategoryCode" = 'employee_net_pay' AND "wageCreditorCategoryLabelSnapshot" = '员工实发工资') OR
      ("wageCreditorCategoryCode" = 'withheld_individual_income_tax' AND "wageCreditorCategoryLabelSnapshot" = '代扣代缴个人所得税') OR
      ("wageCreditorCategoryCode" = 'employee_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担社会保险') OR
      ("wageCreditorCategoryCode" = 'employee_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担住房公积金') OR
      ("wageCreditorCategoryCode" = 'employer_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '单位承担社会保险') OR
      ("wageCreditorCategoryCode" = 'employer_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '单位承担住房公积金') OR
      ("wageCreditorCategoryCode" = 'other_controlled_payee' AND "wageCreditorCategoryLabelSnapshot" = '其他受控收款方')
    ) AND
    "grossDebtCents" >= 0 AND
    "historicallySettledCents" >= 0 AND
    "outstandingBalanceCents" >= 0 AND
    "grossDebtCents" = "historicallySettledCents" + "outstandingBalanceCents" AND
    "debtStatus" IN ('settled', 'partially_settled', 'outstanding') AND
    (("debtStatus" = 'settled' AND "outstandingBalanceCents" = 0) OR
      ("debtStatus" = 'partially_settled' AND "historicallySettledCents" > 0 AND "outstandingBalanceCents" > 0) OR
      ("debtStatus" = 'outstanding' AND "historicallySettledCents" = 0 AND "outstandingBalanceCents" > 0))
  )
);
CREATE UNIQUE INDEX "HWSBalanceRecon_creditor_line_key"
  ON "HistoricalWageBalanceReconciliationVersion"("authorityCreditorLineId");
CREATE UNIQUE INDEX "HWSBalanceRecon_scope_reconciliation_key"
  ON "HistoricalWageBalanceReconciliationVersion"("atomicScopeVersionId", "reconciliationAuthorityVersionId", "reconciliationFingerprint");
CREATE INDEX "HistoricalWageBalanceReconciliationVersion_project_month_idx"
  ON "HistoricalWageBalanceReconciliationVersion"("employmentCompanyId", "projectId", "wageMonth");

CREATE TABLE "HistoricalWageSummaryPayableRef" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "authorityCreditorLineId" TEXT NOT NULL,
  "rowMappingId" TEXT NOT NULL,
  "stableBucketKey" TEXT NOT NULL,
  "employmentCompanyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "wageMonth" TEXT NOT NULL,
  "positionCategoryCode" TEXT NOT NULL,
  "wageCreditorCategoryCode" TEXT NOT NULL,
  "wageCreditorCategoryLabelSnapshot" TEXT NOT NULL,
  "creditorIdentityKind" TEXT NOT NULL,
  "creditorPartyVersionId" TEXT,
  "controlledScopeCode" TEXT,
  "controlledScopeDescription" TEXT,
  "controlledScopeEvidenceCoordinate" JSONB,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "debtStatus" TEXT NOT NULL,
  "grossDebtCents" BIGINT NOT NULL,
  "historicallySettledCents" BIGINT NOT NULL,
  "outstandingBalanceCents" BIGINT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetBusinessKey" TEXT NOT NULL,
  "targetPayload" JSONB NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "historicalWageBalanceReconciliationVersionId" TEXT,
  "usageScope" TEXT NOT NULL DEFAULT 'historical_reconciliation_only',
  "newPaymentAllowed" BOOLEAN NOT NULL DEFAULT false,
  "settlementAllocationAllowed" BOOLEAN NOT NULL DEFAULT false,
  "direction" TEXT NOT NULL,
  "deltaAmountCents" BIGINT NOT NULL,
  "adjustsSummaryPayableRefId" TEXT,
  "deltaFingerprint" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryPayableRef_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageSummaryPayableRef_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_creditor_line_fkey"
    FOREIGN KEY ("authorityCreditorLineId") REFERENCES "HistoricalWageSummaryAuthorityCreditorLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_mapping_fkey"
    FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_reconciliation_fkey"
    FOREIGN KEY ("historicalWageBalanceReconciliationVersionId") REFERENCES "HistoricalWageBalanceReconciliationVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_adjustment_fkey"
    FOREIGN KEY ("adjustsSummaryPayableRefId") REFERENCES "HistoricalWageSummaryPayableRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPayableRef_shape_check" CHECK (
    "currencyCode" = 'CNY' AND
    "usageScope" = 'historical_reconciliation_only' AND
    NOT "newPaymentAllowed" AND
    NOT "settlementAllocationAllowed" AND
    "creditorIdentityKind" = 'aggregate_creditor_scope' AND
    "creditorPartyVersionId" IS NULL AND
    length(btrim("targetBusinessKey")) > 0 AND
    "targetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "grossDebtCents" >= 0 AND
    "historicallySettledCents" >= 0 AND
    "outstandingBalanceCents" >= 0 AND
    "grossDebtCents" = "historicallySettledCents" + "outstandingBalanceCents" AND
    "debtStatus" IN ('settled', 'partially_settled', 'outstanding') AND
    (("debtStatus" = 'settled' AND "outstandingBalanceCents" = 0) OR
      ("debtStatus" = 'partially_settled' AND "historicallySettledCents" > 0 AND "outstandingBalanceCents" > 0) OR
      ("debtStatus" = 'outstanding' AND "historicallySettledCents" = 0 AND "outstandingBalanceCents" > 0)) AND
    "targetKind" IN ('existing_verified_payment_execution_set', 'historical_wage_balance_reconciliation_version') AND
    "direction" IN ('increase', 'decrease') AND
    "deltaAmountCents" > 0 AND
    (("targetKind" = 'existing_verified_payment_execution_set' AND "historicalWageBalanceReconciliationVersionId" IS NULL) OR
     ("targetKind" = 'historical_wage_balance_reconciliation_version' AND "historicalWageBalanceReconciliationVersionId" IS NOT NULL)) AND
    ("targetKind" <> 'existing_verified_payment_execution_set' OR
      ("debtStatus" = 'settled' AND "historicallySettledCents" = "grossDebtCents" AND "outstandingBalanceCents" = 0)) AND
    "deltaFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "HistoricalWageSummaryPayableRef_creditor_check" CHECK (
    ("wageCreditorCategoryCode" = 'employee_net_pay' AND "wageCreditorCategoryLabelSnapshot" = '员工实发工资') OR
    ("wageCreditorCategoryCode" = 'withheld_individual_income_tax' AND "wageCreditorCategoryLabelSnapshot" = '代扣代缴个人所得税') OR
    ("wageCreditorCategoryCode" = 'employee_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担社会保险') OR
    ("wageCreditorCategoryCode" = 'employee_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '员工个人承担住房公积金') OR
    ("wageCreditorCategoryCode" = 'employer_social_insurance' AND "wageCreditorCategoryLabelSnapshot" = '单位承担社会保险') OR
    ("wageCreditorCategoryCode" = 'employer_housing_fund' AND "wageCreditorCategoryLabelSnapshot" = '单位承担住房公积金') OR
    ("wageCreditorCategoryCode" = 'other_controlled_payee' AND "wageCreditorCategoryLabelSnapshot" = '其他受控收款方' AND
      length(btrim(COALESCE("controlledScopeDescription", ''))) > 0 AND
      "controlledScopeEvidenceCoordinate" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "HistoricalWageSummaryPayableRef_creditor_line_key"
  ON "HistoricalWageSummaryPayableRef"("authorityCreditorLineId");
CREATE INDEX "HistoricalWageSummaryPayableRef_scope_project_month_idx"
  ON "HistoricalWageSummaryPayableRef"("atomicScopeVersionId", "projectId", "wageMonth");
CREATE INDEX "HistoricalWageSummaryPayableRef_mapping_idx"
  ON "HistoricalWageSummaryPayableRef"("rowMappingId");
CREATE INDEX "HistoricalWageSummaryPayableRef_adjustment_idx"
  ON "HistoricalWageSummaryPayableRef"("adjustsSummaryPayableRefId");
CREATE INDEX "HistoricalWageSummaryPayableRef_stable_bucket_idx"
  ON "HistoricalWageSummaryPayableRef"("stableBucketKey");
CREATE INDEX "HistoricalWageSummaryPayableRef_reconciliation_idx"
  ON "HistoricalWageSummaryPayableRef"("historicalWageBalanceReconciliationVersionId");

CREATE TABLE "HistoricalWageSummaryPaymentExecutionLink" (
  "id" TEXT NOT NULL,
  "authorityCreditorLineId" TEXT NOT NULL,
  "summaryPayableRefId" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "paymentExecutionFingerprint" TEXT NOT NULL,
  "paymentExecutionSetFingerprint" TEXT NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "paymentEvidenceSnapshot" JSONB NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryPaymentExecutionLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageSummaryPaymentExecutionLink_line_fkey"
    FOREIGN KEY ("authorityCreditorLineId") REFERENCES "HistoricalWageSummaryAuthorityCreditorLine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPaymentExecutionLink_ref_fkey"
    FOREIGN KEY ("summaryPayableRefId") REFERENCES "HistoricalWageSummaryPayableRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPaymentExecutionLink_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryPaymentExecutionLink_shape_check" CHECK (
    "paymentExecutionFingerprint" ~ '^[0-9a-f]{64}$' AND
    "paymentExecutionSetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "targetFingerprint" ~ '^[0-9a-f]{64}$' AND
    "amountCents" > 0 AND "ordinal" > 0
  )
);
CREATE UNIQUE INDEX "HWSummaryPaymentLink_line_ordinal_key"
  ON "HistoricalWageSummaryPaymentExecutionLink"("authorityCreditorLineId", "ordinal");
CREATE UNIQUE INDEX "HWSummaryPaymentLink_line_execution_key"
  ON "HistoricalWageSummaryPaymentExecutionLink"("authorityCreditorLineId", "paymentExecutionId");
CREATE INDEX "HistoricalWageSummaryPaymentExecutionLink_execution_idx"
  ON "HistoricalWageSummaryPaymentExecutionLink"("paymentExecutionId");
CREATE INDEX "HistoricalWageSummaryPaymentExecutionLink_ref_idx"
  ON "HistoricalWageSummaryPaymentExecutionLink"("summaryPayableRefId");

ALTER TABLE "HistoricalWageSummaryAuthorityCreditorLine"
  ADD CONSTRAINT "HWSAuthorityCreditorLine_root_payable_fkey"
    FOREIGN KEY ("rootPayableRefId") REFERENCES "HistoricalWageSummaryPayableRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "HistoricalWageSummaryPayableRefEligibilityRevocation" (
  "id" TEXT NOT NULL,
  "summaryPayableRefId" TEXT NOT NULL,
  "compensationReceiptId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryPayableRefEligibilityRevocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageSummaryPayableRefEligibilityRevocation_ref_fkey"
    FOREIGN KEY ("summaryPayableRefId") REFERENCES "HistoricalWageSummaryPayableRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HWSummaryRefRevocation_receipt_fkey"
    FOREIGN KEY ("compensationReceiptId") REFERENCES "OperatingTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "HistoricalWageSummaryRefRevocation_ref_key"
  ON "HistoricalWageSummaryPayableRefEligibilityRevocation"("summaryPayableRefId");
CREATE INDEX "HistoricalWageSummaryRefRevocation_receipt_idx"
  ON "HistoricalWageSummaryPayableRefEligibilityRevocation"("compensationReceiptId");

CREATE TABLE "UnresolvedWagePayableGap" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "manifestVersionId" TEXT NOT NULL,
  "rowMappingId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "wageMonth" TEXT,
  "reasonCode" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "gapSnapshot" JSONB NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnresolvedWagePayableGap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnresolvedWagePayableGap_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "UnresolvedWagePayableGap_manifest_fkey"
    FOREIGN KEY ("manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "UnresolvedWagePayableGap_mapping_fkey"
    FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "UnresolvedWagePayableGap_source_check" CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "UnresolvedWagePayableGap_mapping_key" ON "UnresolvedWagePayableGap"("rowMappingId");
CREATE INDEX "UnresolvedWagePayableGap_project_month_idx" ON "UnresolvedWagePayableGap"("projectId", "wageMonth");

CREATE TABLE "WageTakeoverProjectionEnvelope" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "manifestVersionId" TEXT NOT NULL,
  "rowMappingId" TEXT NOT NULL,
  "wageStatementVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "legacySourceType" TEXT NOT NULL,
  "legacySourceBusinessId" TEXT NOT NULL,
  "legacySourceVersion" INTEGER NOT NULL,
  "legacySourceFingerprint" TEXT NOT NULL,
  "legacyImpactSnapshot" JSONB NOT NULL,
  "projectionOrigin" TEXT NOT NULL,
  "deltaDirection" TEXT NOT NULL,
  "canonicalFingerprint" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageTakeoverProjectionEnvelope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageTakeoverProjectionEnvelope_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_manifest_fkey"
    FOREIGN KEY ("manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_mapping_fkey"
    FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_scope_manifest_fkey"
    FOREIGN KEY ("atomicScopeVersionId", "manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("atomicScopeVersionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_mapping_manifest_project_fkey"
    FOREIGN KEY ("rowMappingId", "manifestVersionId", "projectId") REFERENCES "OperatingTakeoverRowMapping"("id", "manifestVersionId", "projectId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_reservation_scope_fkey"
    FOREIGN KEY ("wageStatementVersionId", "atomicScopeVersionId") REFERENCES "WageTakeoverWageStatementReservation"("id", "atomicScopeVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_wage_version_fkey"
    FOREIGN KEY ("wageStatementVersionId") REFERENCES "WageStatementVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelope_shape_check" CHECK (
    "legacySourceType" = 'project_wage' AND
    "legacySourceVersion" > 0 AND
    "legacySourceFingerprint" ~ '^[0-9a-f]{64}$' AND
    "canonicalFingerprint" ~ '^[0-9a-f]{64}$' AND
    "projectionOrigin" = 'historical_takeover_legacy_link' AND
    "deltaDirection" IN ('increase', 'decrease')
  )
);
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelope_mapping_key" ON "WageTakeoverProjectionEnvelope"("rowMappingId");
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelope_legacy_coordinate_key"
  ON "WageTakeoverProjectionEnvelope"("projectId", "legacySourceType", "legacySourceBusinessId", "legacySourceVersion");
CREATE INDEX "WageTakeoverProjectionEnvelope_wage_project_idx"
  ON "WageTakeoverProjectionEnvelope"("wageStatementVersionId", "projectId");

CREATE TABLE "WageTakeoverProjectionEnvelopePayableRef" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "payableRefId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  CONSTRAINT "WageTakeoverProjectionEnvelopePayableRef_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageTakeoverProjectionEnvelopePayableRef_envelope_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "WageTakeoverProjectionEnvelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelopePayableRef_payable_fkey"
    FOREIGN KEY ("payableRefId") REFERENCES "WagePayableRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelopePayableRef_amount_check" CHECK (
    "amountCents" > 0 AND "direction" IN ('increase', 'decrease')
  )
);
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelopePayableRef_envelope_payable_key"
  ON "WageTakeoverProjectionEnvelopePayableRef"("envelopeId", "payableRefId");
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelopePayableRef_payable_key"
  ON "WageTakeoverProjectionEnvelopePayableRef"("payableRefId");

CREATE TABLE "WageTakeoverProjectionEnvelopeCostCell" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "costCellId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  CONSTRAINT "WageTakeoverProjectionEnvelopeCostCell_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageTakeoverProjectionEnvelopeCostCell_envelope_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "WageTakeoverProjectionEnvelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelopeCostCell_cell_fkey"
    FOREIGN KEY ("costCellId") REFERENCES "WageProjectCostComponentAllocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverProjectionEnvelopeCostCell_amount_check" CHECK (
    "amountCents" > 0 AND "direction" IN ('increase', 'decrease')
  )
);
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelopeCostCell_envelope_cell_key"
  ON "WageTakeoverProjectionEnvelopeCostCell"("envelopeId", "costCellId");
CREATE UNIQUE INDEX "WageTakeoverProjectionEnvelopeCostCell_cell_key"
  ON "WageTakeoverProjectionEnvelopeCostCell"("costCellId");

CREATE TABLE "WageTakeoverLegacyImpactBridge" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT,
  "summaryAuthorityVersionId" TEXT,
  "rowMappingId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "legacyImpactEntryId" TEXT NOT NULL,
  "impactKind" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageTakeoverLegacyImpactBridge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageLegacyImpactBridge_envelope_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "WageTakeoverProjectionEnvelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageLegacyImpactBridge_summary_authority_fkey"
    FOREIGN KEY ("summaryAuthorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageLegacyImpactBridge_mapping_fkey"
    FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageLegacyImpactBridge_impact_fkey"
    FOREIGN KEY ("legacyImpactEntryId") REFERENCES "OperatingImpactEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageLegacyImpactBridge_shape_check" CHECK (
    num_nonnulls("envelopeId", "summaryAuthorityVersionId") = 1 AND
    "impactKind" IN ('confirmed_cost', 'payable_increase', 'payable_decrease') AND
    "direction" IN ('increase', 'decrease') AND
    "amountCents" > 0 AND
    "sourceFingerprint" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "WageLegacyImpactBridge_impact_key"
  ON "WageTakeoverLegacyImpactBridge"("legacyImpactEntryId");
CREATE UNIQUE INDEX "WageLegacyImpactBridge_envelope_kind_key"
  ON "WageTakeoverLegacyImpactBridge"("envelopeId", "impactKind")
  WHERE "envelopeId" IS NOT NULL;
CREATE UNIQUE INDEX "WageLegacyImpactBridge_summary_kind_key"
  ON "WageTakeoverLegacyImpactBridge"("summaryAuthorityVersionId", "impactKind")
  WHERE "summaryAuthorityVersionId" IS NOT NULL;
CREATE INDEX "WageLegacyImpactBridge_mapping_idx"
  ON "WageTakeoverLegacyImpactBridge"("rowMappingId");
CREATE INDEX "WageLegacyImpactBridge_summary_idx"
  ON "WageTakeoverLegacyImpactBridge"("summaryAuthorityVersionId");
CREATE INDEX "WageLegacyImpactBridge_project_created_idx"
  ON "WageTakeoverLegacyImpactBridge"("projectId", "createdAt");

CREATE TABLE "WageTakeoverProjectionEnvelopeEligibilityRevocation" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "compensationReceiptId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageTakeoverProjectionEnvelopeEligibilityRevocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WageTakeoverEnvelopeRevocation_envelope_fkey"
    FOREIGN KEY ("envelopeId") REFERENCES "WageTakeoverProjectionEnvelope"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WageTakeoverEnvelopeRevocation_receipt_fkey"
    FOREIGN KEY ("compensationReceiptId") REFERENCES "OperatingTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WageTakeoverEnvelopeRevocation_envelope_key"
  ON "WageTakeoverProjectionEnvelopeEligibilityRevocation"("envelopeId");

CREATE TABLE "HistoricalWageSummaryAuthorityAttestation" (
  "id" TEXT NOT NULL,
  "atomicScopeVersionId" TEXT NOT NULL,
  "authorityVersionId" TEXT NOT NULL,
  "summaryBucketKey" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "delegatorUserId" TEXT,
  "permissionScopeFingerprint" TEXT NOT NULL,
  "attestationOrdinal" INTEGER NOT NULL DEFAULT 0,
  "createdTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalWageSummaryAuthorityAttestation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalWageSummaryAuthorityAttestation_scope_fkey"
    FOREIGN KEY ("atomicScopeVersionId") REFERENCES "OperatingTakeoverAtomicScopeVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryAuthorityAttestation_authority_fkey"
    FOREIGN KEY ("authorityVersionId") REFERENCES "HistoricalWageSummaryAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryAuthorityAttestation_receipt_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "OperatingTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalWageSummaryAuthorityAttestation_hash_check"
    CHECK ("permissionScopeFingerprint" ~ '^[0-9a-f]{64}$' AND "attestationOrdinal" IN (1, 2))
);
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityAttestation_authority_actor_key"
  ON "HistoricalWageSummaryAuthorityAttestation"("authorityVersionId", "actorUserId");
CREATE UNIQUE INDEX "HWSummaryAuthorityAttestation_authority_ordinal_key"
  ON "HistoricalWageSummaryAuthorityAttestation"("authorityVersionId", "attestationOrdinal");
CREATE UNIQUE INDEX "HistoricalWageSummaryAuthorityAttestation_receipt_key"
  ON "HistoricalWageSummaryAuthorityAttestation"("receiptId");
CREATE INDEX "HistoricalWageSummaryAuthorityAttestation_scope_bucket_idx"
  ON "HistoricalWageSummaryAuthorityAttestation"("atomicScopeVersionId", "summaryBucketKey");

-- Preserve all #215 formal checks for its adapter.  The historical branch is
-- narrow and cannot borrow its authority fields to bypass the old invariant.
ALTER TABLE "OperatingTakeoverRowMapping"
  DROP CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_check",
  DROP CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_shape_check";
ALTER TABLE "OperatingTakeoverRowMapping"
  ADD CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_check" CHECK (
    ("adapterKind" = 'construction_enterprise_clearing' AND (
      "mappingDecision" <> 'FORMAL' OR
      ("authorityCategory" IS NOT NULL AND "authoritySnapshotRef" IS NOT NULL AND "authorityFingerprint" IS NOT NULL AND "authorityVersionId" IS NOT NULL AND "authoritativeGrossCapCents" IS NOT NULL AND "currencyCode" IS NOT NULL AND "sourceDiscriminator" IS NOT NULL AND "governedSubjectKey" IS NOT NULL)
    ) AND "wageApprovedSourceVersionId" IS NULL AND "wageStatementReservationId" IS NULL AND "historicalWageSummaryAuthorityVersionId" IS NULL) OR
    ("adapterKind" = 'historical_wage' AND (
      "mappingDecision" <> 'FORMAL' OR
      (("evidenceLevel" = 'A' AND "sourceType" = 'project_wage' AND "sourceDiscriminator" = 'wage_statement_version' AND "wageApprovedSourceVersionId" IS NOT NULL AND "wageStatementReservationId" IS NOT NULL AND "historicalWageSummaryAuthorityVersionId" IS NULL) OR
       ("evidenceLevel" = 'B' AND "sourceType" = 'project_wage' AND "sourceDiscriminator" = 'historical_wage_summary' AND "wageApprovedSourceVersionId" IS NULL AND "wageStatementReservationId" IS NULL AND "historicalWageSummaryAuthorityVersionId" IS NOT NULL))
    ))
  ),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_shape_check" CHECK (
    "adapterKind" <> 'construction_enterprise_clearing' OR "mappingDecision" <> 'FORMAL' OR
    (("authorityCategory" = 'assigned_management_salary' AND "sourceDiscriminator" = 'construction_enterprise_assigned_wage' AND "authorityLineId" IS NOT NULL AND "authorityLineFingerprint" ~ '^[0-9a-f]{64}$') OR
     ("authorityCategory" = 'deposit' AND "sourceDiscriminator" = 'construction_enterprise_guarantee' AND "obligationId" IS NOT NULL))
  ),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_historical_shape_check" CHECK (
    "adapterKind" <> 'historical_wage' OR
    ("sourceType" = 'project_wage' AND
     "authorityCategory" IS NULL AND "authoritySnapshotRef" IS NULL AND "authorityFingerprint" IS NULL AND
     "authorityVersionId" IS NULL AND "authorityLineId" IS NULL AND "authorityLineFingerprint" IS NULL AND
     "obligationId" IS NULL AND "authoritativeGrossCapCents" IS NULL AND "currencyCode" IS NULL AND
     "governedSubjectKey" IS NULL AND
      (("mappingDecision" = 'FORMAL' AND "entryKind" = 'formal' AND "evidenceLevel" IN ('A', 'B')) OR
       ("mappingDecision" = 'GAP' AND "entryKind" = 'gap' AND "evidenceLevel" = 'C' AND
        "sourceDiscriminator" IS NULL AND "wageApprovedSourceVersionId" IS NULL AND
        "wageStatementReservationId" IS NULL AND "historicalWageSummaryAuthorityVersionId" IS NULL)))
  );

CREATE FUNCTION jg_pol219_validate_wage_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  source_row "WageApprovedSourceVersion"%ROWTYPE;
  statement_row "WageStatement"%ROWTYPE;
  prior_version_row "WageStatementVersion"%ROWTYPE;
  prior_source_row "WageApprovedSourceVersion"%ROWTYPE;
BEGIN
  SELECT * INTO scope_row
  FROM "OperatingTakeoverAtomicScopeVersion"
  WHERE "id" = NEW."atomicScopeVersionId";
  IF scope_row."id" IS NULL OR
     scope_row."scopeKind" <> 'historical_wage' OR
     scope_row."reservedWageStatementVersionId" IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资版本预留必须与同一原子 scope 的服务端预留 UUID 完全一致';
  END IF;
  SELECT * INTO source_row
  FROM "WageApprovedSourceVersion"
  WHERE "id" = scope_row."authoritySourceRef";
  IF source_row."id" IS NULL OR source_row."sourceFingerprint" <> scope_row."authoritySourceFingerprint" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资版本预留必须冻结仍有效的完整批准来源';
  END IF;
  IF EXISTS (SELECT 1 FROM "WageStatementVersion" WHERE "id" = NEW."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 scope 准备阶段不得提前创建工资正式版本';
  END IF;
  SELECT * INTO statement_row
  FROM "WageStatement"
  WHERE "id" = NEW."targetWageStatementId";
  IF NEW."expectedCurrentRevision" = 0 THEN
    IF statement_row."id" IS NOT NULL OR EXISTS (
      SELECT 1 FROM "WageStatement"
      WHERE "employmentCompanyId" = source_row."employmentCompanyId"
        AND "wageMonth" = source_row."wageMonth"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 基础工资预留不得采用已存在的 canonical statement';
    END IF;
  ELSE
    SELECT * INTO prior_version_row
    FROM "WageStatementVersion"
    WHERE "id" = NEW."priorConfirmedVersionId";
    SELECT * INTO prior_source_row
    FROM "WageApprovedSourceVersion"
    WHERE "id" = NEW."priorSourceVersionId";
    IF statement_row."id" IS NULL OR
       statement_row."currentRevision" <> NEW."expectedCurrentRevision" OR
       statement_row."employmentCompanyId" <> source_row."employmentCompanyId" OR
       statement_row."wageMonth" <> source_row."wageMonth" OR
       prior_version_row."id" IS NULL OR prior_version_row."statementId" <> statement_row."id" OR
       prior_version_row."revision" <> NEW."expectedCurrentRevision" OR prior_version_row."status" <> 'confirmed' OR
       prior_version_row."sourceVersionId" <> NEW."priorSourceVersionId" OR
       prior_source_row."id" IS NULL OR
       prior_source_row."employmentCompanyId" <> source_row."employmentCompanyId" OR
       prior_source_row."wageMonth" <> source_row."wageMonth" OR
       prior_source_row."externalReference" <> source_row."externalReference" OR
       prior_source_row."id" = source_row."id" THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 后续工资预留必须冻结当前 statement、直接前置 confirmed 版本及同一来源 lineage';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_command_canonical_json(value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN COALESCE((
      SELECT '{' || string_agg(
        to_jsonb(entry.key)::TEXT || ':' || jg_pol219_command_canonical_json(entry.value),
        ',' ORDER BY entry.key COLLATE "C"
      ) || '}'
      FROM jsonb_each(value) AS entry
    ), '{}')
    WHEN 'array' THEN COALESCE((
      SELECT '[' || string_agg(
        jg_pol219_command_canonical_json(entry.value),
        ',' ORDER BY entry.ordinality
      ) || ']'
      FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(value, ordinality)
    ), '[]')
    ELSE value::TEXT
  END
$$;

CREATE FUNCTION jg_pol219_bind_scope_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."atomicScopeVersionId" IS NOT NULL THEN
    IF NEW."action" NOT IN (
         'historical_wage_takeover.scope.create',
         'historical_wage_takeover.scope.apply',
         'historical_wage_takeover.scope.attest',
         'historical_wage_takeover.scope.activate',
         'historical_wage_takeover.scope.compensate'
       ) OR
       NEW."commandSnapshotSchemaVersion" IS DISTINCT FROM 1 OR
       jsonb_typeof(NEW."commandSnapshot") IS DISTINCT FROM 'object' OR
       NOT NEW."commandSnapshot" ?& ARRAY[
         'action', 'actorUserId', 'binding', 'businessReason',
         'delegatorUserId', 'evidenceRefs', 'expectedRevision'
       ] OR
       NEW."commandSnapshot" - ARRAY[
         'action', 'actorUserId', 'binding', 'businessReason',
         'delegatorUserId', 'evidenceRefs', 'expectedRevision'
       ] <> '{}'::JSONB OR
       jsonb_typeof(NEW."commandSnapshot"->'binding') IS DISTINCT FROM 'object' OR
       jsonb_typeof(NEW."commandSnapshot"->'businessReason') IS DISTINCT FROM 'string' OR
       jsonb_typeof(NEW."commandSnapshot"->'evidenceRefs') IS DISTINCT FROM 'array' OR
       NEW."commandSnapshot"->'binding'->>'actorUserId' IS DISTINCT FROM NEW."actorUserId" OR
       NEW."commandSnapshot"->'binding'->>'delegatorUserId' IS DISTINCT FROM NEW."delegatorUserId" OR
       NOT COALESCE(
         NEW."commandSnapshot"->'binding'->>'selectionFingerprint' ~ '^[0-9a-f]{64}$',
         FALSE
       ) OR
       jsonb_typeof(NEW."commandSnapshot"->'binding'->'legacyCoordinates') IS DISTINCT FROM 'array' OR
       (
         NEW."action" = 'historical_wage_takeover.scope.create' AND
         NEW."commandSnapshot"->'binding' ? 'atomicScopeVersionId'
       ) OR
       (
         NEW."action" <> 'historical_wage_takeover.scope.create' AND
         NEW."commandSnapshot"->'binding'->>'atomicScopeVersionId' IS DISTINCT FROM NEW."atomicScopeVersionId"
       ) OR
       NOT COALESCE(
         NEW."commandSnapshot"->>'businessReason' = btrim(NEW."commandSnapshot"->>'businessReason') AND
         btrim(NEW."commandSnapshot"->>'businessReason') <> '',
         FALSE
       ) OR
       NEW."commandSnapshot"->'action' IS DISTINCT FROM to_jsonb(NEW."action") OR
       NEW."commandSnapshot"->'actorUserId' IS DISTINCT FROM to_jsonb(NEW."actorUserId") OR
       NEW."commandSnapshot"->'delegatorUserId' IS DISTINCT FROM COALESCE(to_jsonb(NEW."delegatorUserId"), 'null'::JSONB) OR
       NEW."commandSnapshot"->'expectedRevision' IS DISTINCT FROM to_jsonb(NEW."expectedRevision") OR
       NEW."fingerprint" IS DISTINCT FROM encode(
         public.digest(jg_pol219_command_canonical_json(NEW."commandSnapshot"), 'sha256'),
         'hex'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 receipt 必须保存可精确重算指纹的版本化 canonical command snapshot';
    END IF;
    NEW."createdTransactionId" := txid_current();
  END IF;
  RETURN NEW;
END;
$$;

-- Heap xmin stores the low 32 bits of the assigning xid, whereas
-- txid_current() is an epoch-aware bigint. Compare them only after reducing
-- the current xid to the same 32-bit representation so the guard remains
-- correct across transaction-id wraparound.
CREATE FUNCTION jg_pol219_current_xid32()
RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
  SELECT mod(txid_current()::numeric, 4294967296)::bigint
$$;

CREATE FUNCTION jg_pol219_require_scope_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reservedWageStatementVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "WageTakeoverWageStatementReservation"
    WHERE "id" = NEW."reservedWageStatementVersionId"
      AND "atomicScopeVersionId" = NEW."id"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 A级原子 scope 必须在同一事务创建 exact UUID reservation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_validate_historical_mapping()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  manifest_row "OperatingTakeoverManifestVersion"%ROWTYPE;
  reservation_row "WageTakeoverWageStatementReservation"%ROWTYPE;
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  source_row "WageApprovedSourceVersion"%ROWTYPE;
  summary_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  legacy_fact "OperatingFact"%ROWTYPE;
  legacy_root "OperatingFact"%ROWTYPE;
BEGIN
  IF NEW."adapterKind" <> 'historical_wage' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO manifest_row
  FROM "OperatingTakeoverManifestVersion"
  WHERE "id" = NEW."manifestVersionId";
  IF manifest_row."id" IS NULL OR
     manifest_row."adapterKind" <> 'historical_wage' OR
     manifest_row."projectId" <> NEW."projectId" OR
     manifest_row."atomicScopeVersionId" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资映射必须属于同项目、同 scope 的工资子 manifest';
  END IF;

  SELECT * INTO scope_row
  FROM "OperatingTakeoverAtomicScopeVersion"
  WHERE "id" = manifest_row."atomicScopeVersionId";
  IF scope_row."id" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资映射缺少原子 scope';
  END IF;

  SELECT * INTO legacy_fact
  FROM "OperatingFact"
  WHERE "sourceType" = NEW."sourceType" AND "sourceBusinessId" = NEW."sourceBusinessId";
  IF legacy_fact."id" IS NULL OR legacy_fact."sourceType" <> 'project_wage' OR
     legacy_fact."projectId" <> NEW."projectId" OR legacy_fact."sourceVersion" <> NEW."sourceVersion" OR
     legacy_fact."factKind" <> 'project_wage' OR legacy_fact."status" <> 'confirmed' OR
     legacy_fact."amountCents" <> NEW."amountCents" OR
     legacy_fact."entryKind" NOT IN ('original', 'correction', 'reversal') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资映射必须直接冻结同坐标 confirmed project_wage 事实';
  END IF;
  IF legacy_fact."entryKind" = 'original' THEN
    IF legacy_fact."adjustsFactId" IS NOT NULL OR NEW."adjustmentTargetRef" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 legacy 原始工资事实不得伪装 adjustment lineage';
    END IF;
  ELSE
    SELECT * INTO legacy_root FROM "OperatingFact" WHERE "id" = legacy_fact."adjustsFactId";
    IF legacy_root."id" IS NULL OR NEW."adjustmentTargetRef" IS DISTINCT FROM legacy_root."id" OR
       legacy_root."entryKind" <> 'original' OR legacy_root."adjustsFactId" IS NOT NULL OR
       legacy_root."sourceType" <> 'project_wage' OR legacy_root."factKind" <> 'project_wage' OR
       legacy_root."status" <> 'confirmed' OR legacy_root."projectId" <> NEW."projectId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 legacy 更正/冲销必须直接指向同项目不可变原始 project_wage root';
    END IF;
  END IF;

  IF NEW."evidenceLevel" = 'A' THEN
    SELECT * INTO reservation_row
    FROM "WageTakeoverWageStatementReservation"
    WHERE "id" = NEW."wageStatementReservationId";
    SELECT * INTO source_row
    FROM "WageApprovedSourceVersion"
    WHERE "id" = NEW."wageApprovedSourceVersionId";
    IF reservation_row."id" IS NULL OR
       reservation_row."atomicScopeVersionId" <> scope_row."id" OR
       reservation_row."id" <> scope_row."reservedWageStatementVersionId" OR
       source_row."id" IS NULL OR
       source_row."id" <> scope_row."authoritySourceRef" OR
       source_row."sourceFingerprint" <> scope_row."authoritySourceFingerprint" THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 A级映射的 reservation、scope 与工资权威来源不一致';
    END IF;
  ELSIF NEW."evidenceLevel" = 'B' THEN
    SELECT * INTO summary_row
    FROM "HistoricalWageSummaryAuthorityVersion"
    WHERE "id" = NEW."historicalWageSummaryAuthorityVersionId";
    IF summary_row."id" IS NULL OR
       summary_row."atomicScopeVersionId" <> scope_row."id" OR
       summary_row."projectId" <> NEW."projectId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级映射必须绑定同 scope、同项目的汇总权威';
    END IF;
  ELSIF NEW."evidenceLevel" <> 'C' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资映射证据等级无效';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_projection_envelope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  manifest_row "OperatingTakeoverManifestVersion"%ROWTYPE;
  reservation_row "WageTakeoverWageStatementReservation"%ROWTYPE;
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  version_row "WageStatementVersion"%ROWTYPE;
  statement_row "WageStatement"%ROWTYPE;
  source_row "WageApprovedSourceVersion"%ROWTYPE;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  SELECT * INTO manifest_row FROM "OperatingTakeoverManifestVersion" WHERE "id" = NEW."manifestVersionId";
  SELECT * INTO reservation_row FROM "WageTakeoverWageStatementReservation" WHERE "id" = NEW."wageStatementVersionId";
  SELECT * INTO scope_row FROM "OperatingTakeoverAtomicScopeVersion" WHERE "id" = NEW."atomicScopeVersionId";
  SELECT * INTO version_row FROM "WageStatementVersion" WHERE "id" = NEW."wageStatementVersionId";
  IF version_row."id" IS NOT NULL THEN
    SELECT * INTO statement_row FROM "WageStatement" WHERE "id" = version_row."statementId";
    SELECT * INTO source_row FROM "WageApprovedSourceVersion" WHERE "id" = version_row."sourceVersionId";
  END IF;

  IF mapping_row."id" IS NULL OR manifest_row."id" IS NULL OR reservation_row."id" IS NULL OR
     scope_row."id" IS NULL OR version_row."id" IS NULL OR statement_row."id" IS NULL OR source_row."id" IS NULL OR
     mapping_row."adapterKind" <> 'historical_wage' OR mapping_row."evidenceLevel" <> 'A' OR
     mapping_row."mappingDecision" <> 'FORMAL' OR mapping_row."sourceDiscriminator" <> 'wage_statement_version' OR
     mapping_row."manifestVersionId" <> manifest_row."id" OR manifest_row."atomicScopeVersionId" <> scope_row."id" OR
     reservation_row."atomicScopeVersionId" <> scope_row."id" OR mapping_row."wageStatementReservationId" <> reservation_row."id" OR
     reservation_row."id" <> scope_row."reservedWageStatementVersionId" OR
     NEW."atomicScopeVersionId" <> scope_row."id" OR NEW."manifestVersionId" <> mapping_row."manifestVersionId" OR
     NEW."projectId" <> mapping_row."projectId" OR manifest_row."projectId" <> NEW."projectId" OR
     NEW."wageStatementVersionId" <> reservation_row."id" OR version_row."id" <> reservation_row."id" OR
     version_row."status" <> 'confirmed' OR version_row."projectionOrigin" <> 'historical_takeover_legacy_link' OR
     version_row."statementId" <> reservation_row."targetWageStatementId" OR
     version_row."kind" <> reservation_row."versionKind" OR
     version_row."revision" <> reservation_row."reservedRevision" OR
     statement_row."currentRevision" <> reservation_row."reservedRevision" OR
     version_row."sourceVersionId" <> mapping_row."wageApprovedSourceVersionId" OR
     source_row."id" <> scope_row."authoritySourceRef" OR source_row."sourceFingerprint" <> scope_row."authoritySourceFingerprint" OR
     statement_row."employmentCompanyId" <> source_row."employmentCompanyId" OR statement_row."wageMonth" <> source_row."wageMonth" OR
     version_row."sourceSnapshot" IS DISTINCT FROM source_row."sourceSnapshot" OR
     NEW."legacySourceType" <> mapping_row."sourceType" OR
     NEW."legacySourceBusinessId" <> mapping_row."sourceBusinessId" OR
     NEW."legacySourceVersion" <> mapping_row."sourceVersion" OR
     NEW."legacySourceFingerprint" <> mapping_row."sourceFingerprint" OR
     NEW."deltaDirection" IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'direction' OR
     mapping_row."legacySourceSnapshot"->>'factId' IS NULL OR
     mapping_row."legacySourceSnapshot"->>'costImpactId' IS NULL OR
     mapping_row."legacySourceSnapshot"->>'payableImpactId' IS NULL OR
     mapping_row."legacySourceSnapshot"->>'amountCents' IS DISTINCT FROM mapping_row."amountCents"::text OR
     NEW."legacyImpactSnapshot"->>'factId' IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'factId' OR
     NEW."legacyImpactSnapshot"->>'costImpactId' IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'costImpactId' OR
     NEW."legacyImpactSnapshot"->>'payableImpactId' IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'payableImpactId' OR
     NEW."createdTransactionId" <> txid_current() THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 工资 envelope 必须原子绑定同 scope、manifest、mapping、reservation 与最终 confirmed 版本';
  END IF;
  RETURN NEW;
END;
$$;

-- A/B targets are provenance links, not a second operating projection. Every
-- declared legacy impact is checked against the immutable project_wage fact,
-- the live impact row, the mapping read-set and the exact frozen snapshot.
CREATE FUNCTION jg_pol219_validate_legacy_impact_bridge()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  envelope_row "WageTakeoverProjectionEnvelope"%ROWTYPE;
  summary_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  impact_row "OperatingImpactEntry"%ROWTYPE;
  fact_row "OperatingFact"%ROWTYPE;
  expected_impact_id TEXT;
  expected_impact_kind TEXT;
  expected_snapshot JSONB;
  expected_fingerprint TEXT;
  expected_direction TEXT;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  IF NEW."envelopeId" IS NOT NULL THEN
    SELECT * INTO envelope_row FROM "WageTakeoverProjectionEnvelope" WHERE "id" = NEW."envelopeId";
  ELSE
    SELECT * INTO summary_row FROM "HistoricalWageSummaryAuthorityVersion" WHERE "id" = NEW."summaryAuthorityVersionId";
  END IF;
  SELECT * INTO impact_row FROM "OperatingImpactEntry" WHERE "id" = NEW."legacyImpactEntryId";
  IF impact_row."id" IS NOT NULL THEN
    SELECT * INTO fact_row FROM "OperatingFact" WHERE "id" = impact_row."factId";
  END IF;

  expected_direction := mapping_row."legacySourceSnapshot"->>'direction';
  IF NEW."impactKind" = 'confirmed_cost' THEN
    expected_impact_id := mapping_row."legacySourceSnapshot"->>'costImpactId';
    expected_impact_kind := 'confirmed_cost';
    expected_snapshot := mapping_row."legacySourceSnapshot"->'costImpactSnapshot';
    expected_fingerprint := mapping_row."legacySourceSnapshot"->>'costImpactFingerprint';
  ELSE
    expected_impact_id := mapping_row."legacySourceSnapshot"->>'payableImpactId';
    expected_impact_kind := CASE WHEN expected_direction = 'increase' THEN 'payable_increase' ELSE 'payable_decrease' END;
    expected_snapshot := mapping_row."legacySourceSnapshot"->'payableImpactSnapshot';
    expected_fingerprint := mapping_row."legacySourceSnapshot"->>'payableImpactFingerprint';
  END IF;

  IF mapping_row."id" IS NULL OR mapping_row."adapterKind" <> 'historical_wage' OR
     mapping_row."evidenceLevel" NOT IN ('A', 'B') OR mapping_row."mappingDecision" <> 'FORMAL' OR
     (mapping_row."evidenceLevel" = 'A' AND (
       envelope_row."id" IS NULL OR NEW."summaryAuthorityVersionId" IS NOT NULL OR
       envelope_row."rowMappingId" <> mapping_row."id" OR envelope_row."atomicScopeVersionId" IS NULL OR
       NEW."rowMappingId" <> envelope_row."rowMappingId" OR NEW."projectId" <> envelope_row."projectId" OR
       envelope_row."deltaDirection" <> expected_direction OR
       envelope_row."legacyImpactSnapshot"->>'factId' IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'factId' OR
       (NEW."impactKind" = 'confirmed_cost' AND (
         envelope_row."legacyImpactSnapshot"->>'costImpactId' IS DISTINCT FROM expected_impact_id OR
         envelope_row."legacyImpactSnapshot"->'costImpactSnapshot' IS DISTINCT FROM expected_snapshot OR
         envelope_row."legacyImpactSnapshot"->>'costImpactFingerprint' IS DISTINCT FROM expected_fingerprint
       )) OR
       (NEW."impactKind" <> 'confirmed_cost' AND (
         envelope_row."legacyImpactSnapshot"->>'payableImpactId' IS DISTINCT FROM expected_impact_id OR
         envelope_row."legacyImpactSnapshot"->'payableImpactSnapshot' IS DISTINCT FROM expected_snapshot OR
         envelope_row."legacyImpactSnapshot"->>'payableImpactFingerprint' IS DISTINCT FROM expected_fingerprint
       ))
     )) OR
     (mapping_row."evidenceLevel" = 'B' AND (
       summary_row."id" IS NULL OR NEW."envelopeId" IS NOT NULL OR
       summary_row."id" <> mapping_row."historicalWageSummaryAuthorityVersionId" OR
       summary_row."id" <> NEW."summaryAuthorityVersionId" OR
       summary_row."atomicScopeVersionId" IS NULL OR summary_row."projectId" <> mapping_row."projectId"
     )) OR
     NEW."projectId" <> mapping_row."projectId" OR NEW."direction" IS DISTINCT FROM expected_direction OR
     NEW."amountCents" <> mapping_row."amountCents" OR
     NEW."amountCents"::text IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'amountCents' OR
     NEW."legacyImpactEntryId" IS DISTINCT FROM expected_impact_id OR
     NEW."impactKind" IS DISTINCT FROM expected_impact_kind OR
     NEW."sourceFingerprint" IS DISTINCT FROM expected_fingerprint OR
     expected_fingerprint !~ '^[0-9a-f]{64}$' OR expected_snapshot IS NULL OR
     impact_row."id" IS NULL OR fact_row."id" IS NULL OR
     fact_row."id" IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'factId' OR
     fact_row."projectId" <> mapping_row."projectId" OR fact_row."sourceType" <> mapping_row."sourceType" OR
     fact_row."sourceBusinessId" <> mapping_row."sourceBusinessId" OR fact_row."sourceVersion" <> mapping_row."sourceVersion" OR
     fact_row."amountCents" <> mapping_row."amountCents" OR
     fact_row."entryKind" NOT IN ('original', 'correction', 'reversal') OR fact_row."status" <> 'confirmed' OR
     impact_row."factId" <> fact_row."id" OR impact_row."projectId" <> fact_row."projectId" OR
     impact_row."sourceType" <> fact_row."sourceType" OR impact_row."sourceBusinessId" <> fact_row."sourceBusinessId" OR
     impact_row."impactKind" <> expected_impact_kind OR impact_row."direction" <> expected_direction OR
     impact_row."amountCents" <> mapping_row."amountCents" OR impact_row."impactSnapshot" IS DISTINCT FROM expected_snapshot OR
     NEW."createdTransactionId" <> txid_current() THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 A/B级 impact bridge 必须逐一绑定同一 legacy fact 的精确成本/应付影响与冻结快照';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_reject_historical_operating_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  historical_version_id TEXT;
BEGIN
  IF NEW."sourceType" <> 'wage_statement_version' THEN
    RETURN NEW;
  END IF;
  historical_version_id := split_part(NEW."sourceBusinessId", ':', 1);
  IF EXISTS (
    SELECT 1 FROM "WageStatementVersion"
    WHERE "id" = historical_version_id
      AND "projectionOrigin" = 'historical_takeover_legacy_link'
  ) OR EXISTS (
    SELECT 1 FROM "WageTakeoverWageStatementReservation"
    WHERE "id" = historical_version_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 historical-confirmation 禁止新建 OperatingFact/OperatingImpactEntry，只能链接既有 legacy impacts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_historical_bridge()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
BEGIN
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  IF mapping_row."adapterKind" <> 'historical_wage' THEN
    RETURN NEW;
  END IF;
  NEW."createdTransactionId" := txid_current();
  IF NEW."mappingDecision" NOT IN ('FORMAL', 'GAP') OR
     NEW."mappingDecision" <> mapping_row."mappingDecision" OR
     NEW."projectId" <> mapping_row."projectId" OR NEW."sourceType" <> mapping_row."sourceType" OR
     NEW."sourceBusinessId" <> mapping_row."sourceBusinessId" OR
     NEW."sourceVersion" <> mapping_row."sourceVersion" OR
     NEW."sourceFingerprint" <> mapping_row."sourceFingerprint" OR
     (mapping_row."evidenceLevel" = 'A' AND (
       NEW."targetKind" <> 'wage_takeover_projection_envelope' OR NOT EXISTS (
         SELECT 1 FROM "WageTakeoverProjectionEnvelope"
         WHERE "id" = NEW."targetRef" AND "rowMappingId" = mapping_row."id"
       ))) OR
     (mapping_row."evidenceLevel" = 'B' AND (
       NEW."targetKind" <> 'historical_wage_summary_authority_version' OR
       NEW."targetRef" <> mapping_row."historicalWageSummaryAuthorityVersionId")) OR
     (mapping_row."evidenceLevel" = 'C' AND (
       NEW."targetKind" <> 'unresolved_wage_payable_gap' OR NOT EXISTS (
         SELECT 1 FROM "UnresolvedWagePayableGap"
         WHERE "id" = NEW."targetRef" AND "rowMappingId" = mapping_row."id"
       ))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 legacy bridge 只允许当前 scope 首次 FORMAL/GAP 物化，禁止 LINK/SKIP 或跨 mapping target';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_historical_receipt_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  receipt_row "OperatingTakeoverCommandReceipt"%ROWTYPE;
  manifest_scope TEXT;
BEGIN
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  IF mapping_row."adapterKind" <> 'historical_wage' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO receipt_row FROM "OperatingTakeoverCommandReceipt" WHERE "id" = NEW."receiptId";
  SELECT "atomicScopeVersionId" INTO manifest_scope
  FROM "OperatingTakeoverManifestVersion" WHERE "id" = mapping_row."manifestVersionId";
  IF receipt_row."id" IS NULL OR receipt_row."atomicScopeVersionId" IS DISTINCT FROM manifest_scope OR
     NEW."projectId" IS DISTINCT FROM mapping_row."projectId" OR NEW."entryKind" <> 'historical_wage' OR
     NEW."decision" IN ('LINK', 'SKIP') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 receipt line 必须绑定同一 atomic scope/mapping，且永远不得输出 LINK/SKIP';
  END IF;
  IF receipt_row."action" = 'historical_wage_takeover.scope.activate' AND (
    NEW."decision" NOT IN ('FORMAL', 'GAP') OR NEW."decision" <> mapping_row."mappingDecision" OR
    NEW."targetKind" IS NULL OR NEW."targetRef" IS NULL OR
    (mapping_row."evidenceLevel" = 'A' AND NEW."targetKind" <> 'wage_takeover_projection_envelope') OR
    (mapping_row."evidenceLevel" = 'B' AND (NEW."targetKind" <> 'historical_wage_summary_authority_version' OR
      NEW."targetRef" <> mapping_row."historicalWageSummaryAuthorityVersionId")) OR
    (mapping_row."evidenceLevel" = 'C' AND NEW."targetKind" <> 'unresolved_wage_payable_gap')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 activate receipt line 只允许服务端解析的 FORMAL/GAP target';
  END IF;
  IF receipt_row."action" = 'historical_wage_takeover.scope.compensate' AND (
    NEW."decision" <> 'compensated' OR NEW."targetKind" IS NOT NULL OR NEW."targetRef" IS NOT NULL OR
    NEW."causesLineId" IS NULL OR NOT EXISTS (
      SELECT 1
      FROM "OperatingTakeoverCommandReceiptLine" activation_line
      JOIN "OperatingTakeoverLegacySourceBridge" bridge
        ON bridge."rowMappingId" = activation_line."rowMappingId"
       AND bridge."targetKind" = activation_line."targetKind"
       AND bridge."targetRef" = activation_line."targetRef"
      WHERE activation_line."id" = NEW."causesLineId"
        AND activation_line."receiptId" = receipt_row."causesReceiptId"
        AND activation_line."rowMappingId" = NEW."rowMappingId"
        AND activation_line."projectId" = NEW."projectId"
        AND activation_line."entryKind" = 'historical_wage'
        AND activation_line."decision" = mapping_row."mappingDecision"
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 compensate receipt line 必须逐行直接因果引用同 mapping 的 activation target line';
  ELSIF receipt_row."action" <> 'historical_wage_takeover.scope.compensate' AND NEW."causesLineId" IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 非补偿 receipt line 不得伪造 causesLineId';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_guard_historical_wage_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_row "WageTakeoverWageStatementReservation"%ROWTYPE;
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  statement_row "WageStatement"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."projectionOrigin" = 'historical_takeover_legacy_link' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 已创建的历史接管工资版本不可删除';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO reservation_row FROM "WageTakeoverWageStatementReservation" WHERE "id" = NEW."id";
    IF NEW."projectionOrigin" <> 'historical_takeover_legacy_link' AND (
      reservation_row."id" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "WageTakeoverWageStatementReservation"
        WHERE "targetWageStatementId" = NEW."statementId"
          AND "reservedRevision" = NEW."revision"
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 已预留 UUID/statement revision 不得由普通工资入口创建';
    END IF;
    IF NEW."projectionOrigin" <> 'historical_takeover_legacy_link' THEN
      RETURN NEW;
    END IF;
    IF reservation_row."id" IS NOT NULL THEN
      SELECT * INTO scope_row FROM "OperatingTakeoverAtomicScopeVersion" WHERE "id" = reservation_row."atomicScopeVersionId";
      SELECT * INTO statement_row FROM "WageStatement" WHERE "id" = reservation_row."targetWageStatementId";
    END IF;
    IF reservation_row."id" IS NULL OR scope_row."id" IS NULL OR
       scope_row."reservedWageStatementVersionId" <> NEW."id" OR
       scope_row."authoritySourceRef" <> NEW."sourceVersionId" OR
       statement_row."id" IS NULL OR NEW."statementId" <> reservation_row."targetWageStatementId" OR
       NEW."kind" <> reservation_row."versionKind" OR NEW."revision" <> reservation_row."reservedRevision" OR
       statement_row."currentRevision" NOT IN (reservation_row."expectedCurrentRevision", reservation_row."reservedRevision") OR
       NEW."status" <> 'submitted' OR
       NEW."submittedByUserId" IS NULL OR NEW."submittedAt" IS NULL OR
       NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL OR
       EXISTS (SELECT 1 FROM "WageTakeoverProjectionEnvelope" WHERE "wageStatementVersionId" = NEW."id") THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 historical-confirmation 只能以有效 reservation 创建 exact submitted N+1 版本';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND
     (OLD."projectionOrigin" = 'historical_takeover_legacy_link' OR NEW."projectionOrigin" = 'historical_takeover_legacy_link') THEN
    IF OLD."projectionOrigin" <> 'historical_takeover_legacy_link' OR
       NEW."projectionOrigin" <> OLD."projectionOrigin" OR
       OLD."id" <> NEW."id" OR OLD."statementId" <> NEW."statementId" OR
       OLD."revision" <> NEW."revision" OR OLD."kind" <> NEW."kind" OR
       OLD."sourceVersionId" <> NEW."sourceVersionId" OR OLD."sourceSnapshot" IS DISTINCT FROM NEW."sourceSnapshot" OR
       OLD."createdByUserId" <> NEW."createdByUserId" OR OLD."lastEditedByUserId" <> NEW."lastEditedByUserId" OR
       OLD."submittedByUserId" IS DISTINCT FROM NEW."submittedByUserId" OR OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt" OR
       OLD."reviewReturnedByUserId" IS DISTINCT FROM NEW."reviewReturnedByUserId" OR
       OLD."reviewReturnedAt" IS DISTINCT FROM NEW."reviewReturnedAt" OR
       OLD."reviewReturnReason" IS DISTINCT FROM NEW."reviewReturnReason" OR
       OLD."reviewDisposition" IS DISTINCT FROM NEW."reviewDisposition" OR
       OLD."supersededAt" IS DISTINCT FROM NEW."supersededAt" OR
       OLD."status" <> 'submitted' OR NEW."status" NOT IN ('submitted', 'confirmed') OR
       (OLD."operatingProjectionSnapshot" IS NOT NULL AND
        OLD."operatingProjectionSnapshot" IS DISTINCT FROM NEW."operatingProjectionSnapshot") OR
       (NEW."status" = 'submitted' AND (NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL)) OR
       (NEW."status" = 'confirmed' AND
        (NEW."confirmedByUserId" IS NULL OR NEW."confirmedAt" IS NULL OR NEW."confirmedByUserId" <> NEW."createdByUserId")) OR
       EXISTS (SELECT 1 FROM "WageTakeoverProjectionEnvelope" WHERE "wageStatementVersionId" = OLD."id") THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 historical-confirmation 版本只允许在首次激活事务内从 submitted 完成投影并确认';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_require_reserved_statement_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_row "WageTakeoverWageStatementReservation"%ROWTYPE;
  actual_current_revision INTEGER;
BEGIN
  SELECT "currentRevision" INTO actual_current_revision FROM "WageStatement" WHERE "id" = NEW."id";
  SELECT * INTO reservation_row
  FROM "WageTakeoverWageStatementReservation"
  WHERE "targetWageStatementId" = NEW."id"
    AND ("expectedCurrentRevision" = 0 OR "reservedRevision" = actual_current_revision)
  ORDER BY CASE WHEN "reservedRevision" = actual_current_revision THEN 0 ELSE 1 END,
           "reservedRevision" ASC
  LIMIT 1;
  IF reservation_row."id" IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "WageStatementVersion"
    WHERE "id" = reservation_row."id"
      AND "statementId" = NEW."id"
      AND "revision" = reservation_row."reservedRevision"
      AND "kind" = reservation_row."versionKind"
      AND "projectionOrigin" = 'historical_takeover_legacy_link'
      AND "status" = 'confirmed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 已预留 statement revision 只能由同 scope exact historical-confirmation target 占用';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_require_historical_activation_graph()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_id TEXT;
  version_row "WageStatementVersion"%ROWTYPE;
  reservation_row "WageTakeoverWageStatementReservation"%ROWTYPE;
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  statement_row "WageStatement"%ROWTYPE;
  source_row "WageApprovedSourceVersion"%ROWTYPE;
  mapping_count INTEGER;
  envelope_count INTEGER;
  version_tx BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'WageTakeoverProjectionEnvelope' THEN
    version_id := NEW."wageStatementVersionId";
  ELSIF TG_TABLE_NAME IN ('WageTakeoverProjectionEnvelopeCostCell', 'WageTakeoverProjectionEnvelopePayableRef', 'WageTakeoverLegacyImpactBridge') THEN
    SELECT "wageStatementVersionId" INTO version_id
    FROM "WageTakeoverProjectionEnvelope"
    WHERE "id" = NEW."envelopeId";
  ELSE
    version_id := NEW."id";
  END IF;
  SELECT * INTO version_row FROM "WageStatementVersion" WHERE "id" = version_id;
  IF version_row."id" IS NULL OR version_row."projectionOrigin" <> 'historical_takeover_legacy_link' THEN
    RETURN NULL;
  END IF;
  SELECT xmin::text::bigint INTO version_tx FROM "WageStatementVersion" WHERE "id" = version_id;
  SELECT * INTO reservation_row FROM "WageTakeoverWageStatementReservation" WHERE "id" = version_id;
  IF reservation_row."id" IS NOT NULL THEN
    SELECT * INTO scope_row FROM "OperatingTakeoverAtomicScopeVersion" WHERE "id" = reservation_row."atomicScopeVersionId";
  END IF;
  SELECT * INTO statement_row FROM "WageStatement" WHERE "id" = version_row."statementId";
  SELECT * INTO source_row FROM "WageApprovedSourceVersion" WHERE "id" = version_row."sourceVersionId";
  SELECT COUNT(*) INTO mapping_count
  FROM "OperatingTakeoverRowMapping"
  WHERE "wageStatementReservationId" = version_id
    AND "adapterKind" = 'historical_wage'
    AND "evidenceLevel" = 'A'
    AND "mappingDecision" = 'FORMAL';
  SELECT COUNT(*) INTO envelope_count
  FROM "WageTakeoverProjectionEnvelope"
  WHERE "wageStatementVersionId" = version_id
    AND "atomicScopeVersionId" = scope_row."id";

  IF reservation_row."id" IS NULL OR scope_row."id" IS NULL OR statement_row."id" IS NULL OR source_row."id" IS NULL OR
     version_tx <> jg_pol219_current_xid32() OR version_row."status" <> 'confirmed' OR
     version_row."statementId" <> reservation_row."targetWageStatementId" OR
     version_row."kind" <> reservation_row."versionKind" OR
     version_row."revision" <> reservation_row."reservedRevision" OR
     statement_row."currentRevision" <> reservation_row."reservedRevision" OR
     scope_row."reservedWageStatementVersionId" <> version_id OR
     scope_row."authoritySourceRef" <> source_row."id" OR
     scope_row."authoritySourceFingerprint" <> source_row."sourceFingerprint" OR
     statement_row."employmentCompanyId" <> source_row."employmentCompanyId" OR
     statement_row."wageMonth" <> source_row."wageMonth" OR
     mapping_count < 1 OR envelope_count <> mapping_count OR
     EXISTS (
       SELECT 1
       FROM "WageTakeoverProjectionEnvelope"
       WHERE "wageStatementVersionId" = version_id
         AND "createdTransactionId" <> txid_current()
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "OperatingTakeoverCommandReceipt"
       WHERE "atomicScopeVersionId" = scope_row."id"
         AND "action" = 'historical_wage_takeover.scope.activate'
         AND "status" = 'activated'
         AND "createdTransactionId" = txid_current()
     ) OR
     EXISTS (
       SELECT 1
       FROM "OperatingTakeoverRowMapping" mapping
       JOIN "WageTakeoverProjectionEnvelope" envelope
         ON envelope."rowMappingId" = mapping."id"
        AND envelope."wageStatementVersionId" = version_id
       WHERE mapping."wageStatementReservationId" = version_id
         AND (
           NOT EXISTS (
             SELECT 1
             FROM "OperatingTakeoverCommandReceipt" receipt
             JOIN "OperatingTakeoverCommandReceiptLine" line ON line."receiptId" = receipt."id"
             WHERE receipt."atomicScopeVersionId" = scope_row."id"
               AND receipt."action" = 'historical_wage_takeover.scope.activate'
               AND receipt."status" = 'activated'
               AND receipt."createdTransactionId" = txid_current()
               AND line."rowMappingId" = mapping."id"
               AND line."projectId" = mapping."projectId"
               AND line."entryKind" = 'historical_wage'
               AND line."decision" = 'FORMAL'
               AND line."amountCents" = mapping."amountCents"
               AND line."targetKind" = 'wage_takeover_projection_envelope'
               AND line."targetRef" = envelope."id"
           ) OR
           NOT EXISTS (
             SELECT 1
             FROM "OperatingTakeoverLegacySourceBridge" bridge
             WHERE bridge."rowMappingId" = mapping."id"
               AND bridge."projectId" = mapping."projectId"
               AND bridge."sourceType" = mapping."sourceType"
               AND bridge."sourceBusinessId" = mapping."sourceBusinessId"
               AND bridge."sourceVersion" = mapping."sourceVersion"
               AND bridge."sourceFingerprint" = mapping."sourceFingerprint"
               AND bridge."targetKind" = 'wage_takeover_projection_envelope'
               AND bridge."targetRef" = envelope."id"
               AND bridge."mappingDecision" = 'FORMAL'
               AND bridge.xmin::text::bigint = jg_pol219_current_xid32()
           )
         )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 最终工资版本、全部 envelope 与激活回执必须在同一事务原子完成';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OperatingTakeoverRowMapping" mapping
    JOIN "WageTakeoverProjectionEnvelope" envelope
      ON envelope."rowMappingId" = mapping."id"
     AND envelope."wageStatementVersionId" = version_id
    WHERE mapping."wageStatementReservationId" = version_id
      AND (
        (SELECT COALESCE(SUM(CASE WHEN link."direction" = 'increase' THEN link."amountCents" ELSE -link."amountCents" END), 0)
         FROM "WageTakeoverProjectionEnvelopeCostCell" link
         WHERE link."envelopeId" = envelope."id") <>
           CASE WHEN envelope."deltaDirection" = 'increase' THEN mapping."amountCents" ELSE -mapping."amountCents" END OR
        (SELECT COALESCE(SUM(CASE WHEN link."direction" = 'increase' THEN link."amountCents" ELSE -link."amountCents" END), 0)
         FROM "WageTakeoverProjectionEnvelopePayableRef" link
         WHERE link."envelopeId" = envelope."id") <>
           CASE WHEN envelope."deltaDirection" = 'increase' THEN mapping."amountCents" ELSE -mapping."amountCents" END OR
        EXISTS (
          SELECT 1
          FROM "WageTakeoverProjectionEnvelopeCostCell" link
          JOIN "WageProjectCostComponentAllocation" cell ON cell."id" = link."costCellId"
          JOIN "WageProjectAllocation" allocation ON allocation."id" = cell."projectAllocationId"
          JOIN "WagePersonLine" person ON person."id" = allocation."personLineId"
          WHERE link."envelopeId" = envelope."id"
            AND (allocation."projectId" <> envelope."projectId" OR
                 person."statementVersionId" <> version_id)
        ) OR
        EXISTS (
          SELECT 1
          FROM "WageTakeoverProjectionEnvelopePayableRef" link
          JOIN "WagePayableRef" payable ON payable."id" = link."payableRefId"
          WHERE link."envelopeId" = envelope."id"
            AND (link."amountCents" <> payable."amountCents" OR payable."confirmedVersionId" <> version_id OR
                 payable."projectId" <> envelope."projectId" OR payable."direction" <> link."direction")
        ) OR
        (SELECT COUNT(*) FROM "WageTakeoverLegacyImpactBridge" impact_bridge
         WHERE impact_bridge."envelopeId" = envelope."id") <> 2 OR
        EXISTS (
          SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
          WHERE impact_bridge."envelopeId" = envelope."id"
            AND (impact_bridge."summaryAuthorityVersionId" IS NOT NULL OR
                 impact_bridge."rowMappingId" <> mapping."id" OR
                 impact_bridge."projectId" <> mapping."projectId" OR
                 impact_bridge."createdTransactionId" <> txid_current())
        ) OR
        NOT EXISTS (
          SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
          WHERE impact_bridge."envelopeId" = envelope."id"
            AND impact_bridge."impactKind" = 'confirmed_cost'
            AND impact_bridge."direction" = envelope."deltaDirection"
            AND impact_bridge."amountCents" = mapping."amountCents"
        ) OR
        NOT EXISTS (
          SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
          WHERE impact_bridge."envelopeId" = envelope."id"
            AND impact_bridge."impactKind" = CASE
              WHEN envelope."deltaDirection" = 'increase' THEN 'payable_increase'
              ELSE 'payable_decrease'
            END
            AND impact_bridge."direction" = envelope."deltaDirection"
            AND impact_bridge."amountCents" = mapping."amountCents"
        ) OR
        NOT EXISTS (SELECT 1 FROM "WageTakeoverProjectionEnvelopeCostCell" link WHERE link."envelopeId" = envelope."id") OR
        NOT EXISTS (SELECT 1 FROM "WageTakeoverProjectionEnvelopePayableRef" link WHERE link."envelopeId" = envelope."id")
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 envelope 必须完整覆盖同项目 canonical 成本与应付 cells，且逐分闭合 legacy 影响';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "WagePayableRef" payable
    WHERE payable."confirmedVersionId" = version_id
      AND payable."amountCents" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "WageTakeoverProjectionEnvelopePayableRef" link
        WHERE link."payableRefId" = payable."id"
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 A级版本的每个非零 canonical payable delta 必须全局且仅一次绑定 envelope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "OperatingFact"
    WHERE "sourceType" = 'wage_statement_version'
      AND "sourceBusinessId" LIKE version_id || ':%'
      AND xmin::text::bigint = jg_pol219_current_xid32()
  ) OR EXISTS (
    SELECT 1 FROM "OperatingImpactEntry"
    WHERE "sourceType" = 'wage_statement_version'
      AND "sourceBusinessId" LIKE version_id || ':%'
      AND xmin::text::bigint = jg_pol219_current_xid32()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 historical-confirmation 只能链接既有 legacy impacts，禁止新建经营事实或影响';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "WageProjectCostComponentAllocation" current_cell
    JOIN "WageProjectAllocation" current_allocation ON current_allocation."id" = current_cell."projectAllocationId"
    JOIN "WagePersonLine" current_person ON current_person."id" = current_allocation."personLineId"
    JOIN "WageCostComponent" current_component ON current_component."id" = current_cell."costComponentId"
    LEFT JOIN "WagePersonLine" prior_person
      ON prior_person."statementVersionId" = reservation_row."priorConfirmedVersionId"
     AND prior_person."employeeId" = current_person."employeeId"
     AND prior_person."employmentSnapshotId" = current_person."employmentSnapshotId"
    LEFT JOIN "WageProjectAllocation" prior_allocation
      ON prior_allocation."personLineId" = prior_person."id"
     AND prior_allocation."projectId" = current_allocation."projectId"
    LEFT JOIN "WageCostComponent" prior_component
      ON prior_component."personLineId" = prior_person."id"
     AND prior_component."componentCode" = current_component."componentCode"
    LEFT JOIN "WageProjectCostComponentAllocation" prior_cell
      ON prior_cell."projectAllocationId" = prior_allocation."id"
     AND prior_cell."costComponentId" = prior_component."id"
    WHERE current_person."statementVersionId" = version_id
      AND current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0) <> 0
      AND NOT EXISTS (
        SELECT 1
        FROM "WageTakeoverProjectionEnvelopeCostCell" link
        JOIN "WageTakeoverProjectionEnvelope" envelope ON envelope."id" = link."envelopeId"
        WHERE link."costCellId" = current_cell."id"
          AND envelope."wageStatementVersionId" = version_id
          AND envelope."projectId" = current_allocation."projectId"
          AND link."amountCents" = abs(current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0))
          AND link."direction" = CASE
            WHEN current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0) > 0 THEN 'increase'
            ELSE 'decrease'
          END
      )
  ) OR EXISTS (
    SELECT 1
    FROM "WageTakeoverProjectionEnvelopeCostCell" link
    JOIN "WageTakeoverProjectionEnvelope" envelope ON envelope."id" = link."envelopeId"
    JOIN "WageProjectCostComponentAllocation" current_cell ON current_cell."id" = link."costCellId"
    JOIN "WageProjectAllocation" current_allocation ON current_allocation."id" = current_cell."projectAllocationId"
    JOIN "WagePersonLine" current_person ON current_person."id" = current_allocation."personLineId"
    JOIN "WageCostComponent" current_component ON current_component."id" = current_cell."costComponentId"
    LEFT JOIN "WagePersonLine" prior_person
      ON prior_person."statementVersionId" = reservation_row."priorConfirmedVersionId"
     AND prior_person."employeeId" = current_person."employeeId"
     AND prior_person."employmentSnapshotId" = current_person."employmentSnapshotId"
    LEFT JOIN "WageProjectAllocation" prior_allocation
      ON prior_allocation."personLineId" = prior_person."id"
     AND prior_allocation."projectId" = current_allocation."projectId"
    LEFT JOIN "WageCostComponent" prior_component
      ON prior_component."personLineId" = prior_person."id"
     AND prior_component."componentCode" = current_component."componentCode"
    LEFT JOIN "WageProjectCostComponentAllocation" prior_cell
      ON prior_cell."projectAllocationId" = prior_allocation."id"
     AND prior_cell."costComponentId" = prior_component."id"
    WHERE envelope."wageStatementVersionId" = version_id
      AND (
        current_person."statementVersionId" <> version_id OR
        current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0) = 0 OR
        link."amountCents" <> abs(current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0)) OR
        link."direction" <> CASE
          WHEN current_cell."amountCents" - COALESCE(prior_cell."amountCents", 0) > 0 THEN 'increase'
          ELSE 'decrease'
        END
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 A级 envelope 必须全局且仅一次覆盖相邻版本的每个非零 canonical cost delta';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_reject_historical_wage_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POL-219 历史工资接管 scope、权威、bridge、回执、资格撤销记录不可更新或删除';
END;
$$;

CREATE FUNCTION jg_pol219_validate_scope_project()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  manifest_project TEXT;
  manifest_scope TEXT;
BEGIN
  SELECT "projectId", "atomicScopeVersionId" INTO manifest_project, manifest_scope
  FROM "OperatingTakeoverManifestVersion" WHERE "id" = NEW."manifestVersionId";
  IF manifest_project IS NULL OR manifest_project <> NEW."projectId" OR manifest_scope IS DISTINCT FROM NEW."atomicScopeVersionId" THEN
    RAISE EXCEPTION 'POL-219 原子 scope 子 manifest 必须属于相同 project 与 scope';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_authority_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  root_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
BEGIN
  IF NEW."summaryBucketKey" <> concat_ws(':', NEW."employmentCompanyId", NEW."projectId", NEW."wageMonth", NEW."positionCategoryCode") THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 authority bucket key 必须由公司、项目、月份和岗位类别确定性生成';
  END IF;
  IF NEW."revision" = 1 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO prior_row
  FROM "HistoricalWageSummaryAuthorityVersion"
  WHERE "id" = NEW."supersedesVersionId";
  SELECT * INTO root_row
  FROM "HistoricalWageSummaryAuthorityVersion"
  WHERE "id" = NEW."lineageRootAuthorityVersionId";
  IF prior_row."id" IS NULL OR root_row."id" IS NULL OR
     prior_row."revision" <> NEW."revision" - 1 OR
     prior_row."summaryBucketKey" <> NEW."summaryBucketKey" OR
     prior_row."employmentCompanyId" <> NEW."employmentCompanyId" OR
     prior_row."projectId" <> NEW."projectId" OR prior_row."wageMonth" <> NEW."wageMonth" OR
     prior_row."catalogVersion" <> NEW."catalogVersion" OR
     prior_row."positionCategoryCode" <> NEW."positionCategoryCode" OR
     root_row."revision" <> 1 OR root_row."summaryBucketKey" <> NEW."summaryBucketKey" OR
     NEW."lineageRootAuthorityVersionId" <> (CASE
       WHEN prior_row."revision" = 1 THEN prior_row."id"
       ELSE prior_row."lineageRootAuthorityVersionId"
     END) OR
     NEW."rootClosureFingerprint" <> root_row."rootClosureFingerprint" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级更正必须是单分支 N+1，并直接冻结原始 authority root';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_creditor_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authority_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  prior_line "HistoricalWageSummaryAuthorityCreditorLine"%ROWTYPE;
  root_ref "HistoricalWageSummaryPayableRef"%ROWTYPE;
  root_ref_count INTEGER;
  expected_root_id TEXT;
BEGIN
  SELECT * INTO authority_row
  FROM "HistoricalWageSummaryAuthorityVersion"
  WHERE "id" = NEW."authorityVersionId";
  NEW."createdTransactionId" := txid_current();
  IF NEW."stableBucketKey" <> jg_pol219_command_canonical_json(jsonb_build_array(
       NEW."wageCreditorCategoryCode",
       NEW."creditorIdentityKind",
       NEW."creditorPartyVersionId",
       NEW."controlledScopeCode",
       NEW."controlledScopeDescription",
       NEW."targetKind",
       NEW."targetBusinessKey"
     )) OR
     NEW."stableBucketKeyFingerprint" <> encode(digest(convert_to(NEW."stableBucketKey", 'UTF8'), 'sha256'), 'hex') OR
     authority_row."id" IS NULL OR
     NEW."atomicScopeVersionId" <> authority_row."atomicScopeVersionId" OR
     NEW."revision" <> authority_row."revision" OR
     NEW."employmentCompanyId" <> authority_row."employmentCompanyId" OR
     NEW."projectId" <> authority_row."projectId" OR NEW."wageMonth" <> authority_row."wageMonth" OR
     NEW."positionCategoryCode" <> authority_row."positionCategoryCode" OR
     NEW."targetSchemaVersion" <> 1 OR
     NEW."targetPayload"->>'schemaVersion' IS DISTINCT FROM '1' OR
     NEW."creditorIdentityKind" <> 'aggregate_creditor_scope' OR
     NEW."creditorPartyVersionId" IS NOT NULL OR
     NEW."createdTransactionId" <> txid_current() THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 creditor line 必须完整绑定同一 authority 版本和稳定 bucket';
  END IF;

  IF authority_row."revision" > 1 THEN
    SELECT * INTO prior_line
    FROM "HistoricalWageSummaryAuthorityCreditorLine"
    WHERE "authorityVersionId" = authority_row."supersedesVersionId"
      AND "stableBucketKey" = NEW."stableBucketKey";
  END IF;
  SELECT COUNT(*) INTO root_ref_count
  FROM "HistoricalWageSummaryPayableRef"
  WHERE "stableBucketKey" = NEW."stableBucketKey"
    AND "adjustsSummaryPayableRefId" IS NULL;
  SELECT * INTO root_ref
  FROM "HistoricalWageSummaryPayableRef"
  WHERE "stableBucketKey" = NEW."stableBucketKey"
    AND "adjustsSummaryPayableRefId" IS NULL
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1;
  IF root_ref_count > 1 OR
     (root_ref."id" IS NULL AND NEW."rootPayableRefId" IS NOT NULL) OR
     (root_ref."id" IS NOT NULL AND (
       NEW."rootPayableRefId" IS DISTINCT FROM root_ref."id" OR
       root_ref."employmentCompanyId" <> NEW."employmentCompanyId" OR
       root_ref."projectId" <> NEW."projectId" OR
       root_ref."wageMonth" <> NEW."wageMonth" OR
       root_ref."positionCategoryCode" <> NEW."positionCategoryCode"
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 creditor line 的 root payable 必须唯一且属于同一稳定债权身份';
  END IF;
  IF prior_line."id" IS NULL THEN
    IF NEW."rootCreditorLineId" IS NOT NULL OR
       NEW."rootPayableRefId" IS NOT NULL OR
       NEW."signedGrossDeltaCents" <> NEW."grossDebtCents" OR
       NEW."signedHistoricallySettledDeltaCents" <> NEW."historicallySettledCents" OR
       NEW."signedOutstandingBalanceDeltaCents" <> NEW."outstandingBalanceCents" OR
       EXISTS (
         SELECT 1 FROM "HistoricalWageSummaryAuthorityCreditorLine"
         WHERE "stableBucketKey" = NEW."stableBucketKey"
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级新增 creditor scope 必须从完整非负首版快照建立唯一 root';
    END IF;
  ELSE
    expected_root_id := COALESCE(prior_line."rootCreditorLineId", prior_line."id");
    IF NEW."stableBucketKey" <> prior_line."stableBucketKey" OR
       NEW."rootCreditorLineId" <> expected_root_id OR
       NEW."signedGrossDeltaCents" <> NEW."grossDebtCents" - prior_line."grossDebtCents" OR
       NEW."signedHistoricallySettledDeltaCents" <> NEW."historicallySettledCents" - prior_line."historicallySettledCents" OR
       NEW."signedOutstandingBalanceDeltaCents" <> NEW."outstandingBalanceCents" - prior_line."outstandingBalanceCents" THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级 creditor line 必须保存相邻完整快照的服务端 signed delta 并直接指向原始 root';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_require_summary_creditor_closure()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authority_id TEXT;
  authority_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'HistoricalWageSummaryAuthorityVersion' THEN
    authority_id := NEW."id";
  ELSE
    SELECT "authorityVersionId" INTO authority_id
    FROM "HistoricalWageSummaryAuthorityCreditorLine"
    WHERE "id" = NEW."id";
  END IF;
  SELECT * INTO authority_row
  FROM "HistoricalWageSummaryAuthorityVersion"
  WHERE "id" = authority_id;
  IF authority_row."id" IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "HistoricalWageSummaryAuthorityCreditorLine"
    WHERE "authorityVersionId" = authority_row."id"
  ) OR EXISTS (
    SELECT 1 FROM "HistoricalWageSummaryAuthorityCreditorLine" line
    WHERE line."authorityVersionId" = authority_row."id"
      AND (line."atomicScopeVersionId" <> authority_row."atomicScopeVersionId" OR
           line."revision" <> authority_row."revision" OR
           line."employmentCompanyId" <> authority_row."employmentCompanyId" OR
           line."projectId" <> authority_row."projectId" OR
           line."wageMonth" <> authority_row."wageMonth" OR
           line."positionCategoryCode" <> authority_row."positionCategoryCode")
  ) OR (authority_row."revision" > 1 AND EXISTS (
    SELECT 1
    FROM "HistoricalWageSummaryAuthorityCreditorLine" prior_line
    WHERE prior_line."authorityVersionId" = authority_row."supersedesVersionId"
      AND NOT EXISTS (
        SELECT 1 FROM "HistoricalWageSummaryAuthorityCreditorLine" current_line
        WHERE current_line."authorityVersionId" = authority_row."id"
          AND current_line."wageCreditorCategoryCode" = prior_line."wageCreditorCategoryCode"
      )
  )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 authority 每一版必须保存完整 creditor-scope 快照，归零时保留 tombstone';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_category_exclusivity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."positionCategoryCode" = 'project_management_unspecified' THEN
    IF EXISTS (
      SELECT 1 FROM "HistoricalWageSummaryAuthorityVersion"
      WHERE "sourceVersionFingerprint" = NEW."sourceVersionFingerprint"
        AND "employmentCompanyId" = NEW."employmentCompanyId"
        AND "projectId" = NEW."projectId"
        AND "wageMonth" = NEW."wageMonth"
        AND "positionCategoryCode" <> 'project_management_unspecified'
    ) THEN
      RAISE EXCEPTION 'POL-219 未细分项目管理类别不得与细分类别并存';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM "HistoricalWageSummaryAuthorityVersion"
      WHERE "sourceVersionFingerprint" = NEW."sourceVersionFingerprint"
        AND "employmentCompanyId" = NEW."employmentCompanyId"
        AND "projectId" = NEW."projectId"
        AND "wageMonth" = NEW."wageMonth"
        AND "positionCategoryCode" = 'project_management_unspecified'
    ) THEN
      RAISE EXCEPTION 'POL-219 细分类别不得与未细分项目管理类别并存';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_attestation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authority_scope TEXT;
  authority_bucket TEXT;
  authority_permission TEXT;
  declared_user TEXT;
  declared_delegator TEXT;
  receipt_scope TEXT;
  receipt_permission TEXT;
  receipt_tx BIGINT;
  receipt_action TEXT;
  receipt_status TEXT;
  receipt_actor TEXT;
  receipt_delegator TEXT;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT "atomicScopeVersionId", "summaryBucketKey", "permissionScopeFingerprint", "declaredByUserId", "declaredDelegatorUserId"
    INTO authority_scope, authority_bucket, authority_permission, declared_user, declared_delegator
  FROM "HistoricalWageSummaryAuthorityVersion" WHERE "id" = NEW."authorityVersionId";
  IF authority_scope IS NULL OR authority_scope <> NEW."atomicScopeVersionId" OR authority_bucket <> NEW."summaryBucketKey" THEN
    RAISE EXCEPTION 'POL-219 B 级确认必须绑定同一 authority scope 与 bucket';
  END IF;
  IF (SELECT COUNT(*) FROM "HistoricalWageSummaryAuthorityAttestation" WHERE "authorityVersionId" = NEW."authorityVersionId") >= 2 THEN
    RAISE EXCEPTION 'POL-219 B 级 authority 只允许声明人和一名独立复核人两份确认';
  END IF;
  SELECT "atomicScopeVersionId", "permissionSnapshotFingerprint", "createdTransactionId", "action", "status", "actorUserId", "delegatorUserId"
    INTO receipt_scope, receipt_permission, receipt_tx, receipt_action, receipt_status, receipt_actor, receipt_delegator
  FROM "OperatingTakeoverCommandReceipt" WHERE "id" = NEW."receiptId";
  IF receipt_scope IS NULL OR receipt_scope <> NEW."atomicScopeVersionId" OR
     receipt_action NOT IN ('historical_wage_takeover.scope.create', 'historical_wage_takeover.scope.attest') OR
     (receipt_action = 'historical_wage_takeover.scope.create' AND receipt_status <> 'prepared') OR
     (receipt_action = 'historical_wage_takeover.scope.attest' AND receipt_status <> 'attested') THEN
    RAISE EXCEPTION 'POL-219 B 级确认缺少同 scope 的确认 receipt';
  END IF;
  NEW."attestationOrdinal" := CASE
    WHEN receipt_action = 'historical_wage_takeover.scope.create' THEN 1
    ELSE 2
  END;
  IF receipt_actor <> NEW."actorUserId" OR receipt_delegator IS DISTINCT FROM NEW."delegatorUserId" THEN
    RAISE EXCEPTION 'POL-219 B 级确认身份必须与同事务 receipt 完全一致';
  END IF;
  IF authority_permission <> NEW."permissionScopeFingerprint" OR receipt_permission <> NEW."permissionScopeFingerprint" THEN
    RAISE EXCEPTION 'POL-219 B 级 authority、receipt 与确认必须使用同一权限委托 scope 指纹';
  END IF;
  IF receipt_tx <> txid_current() OR NEW."createdTransactionId" <> txid_current() THEN
    RAISE EXCEPTION 'POL-219 B 级确认与 receipt 必须在同一数据库事务';
  END IF;
  IF receipt_action = 'historical_wage_takeover.scope.create' AND
     (NEW."actorUserId" <> declared_user OR NEW."delegatorUserId" IS DISTINCT FROM declared_delegator) THEN
    RAISE EXCEPTION 'POL-219 B 级首次声明身份必须与权威版本及 receipt 完全一致';
  END IF;
  IF receipt_action = 'historical_wage_takeover.scope.attest' AND (
    NEW."actorUserId" = declared_user OR
    (declared_delegator IS NOT NULL AND NEW."actorUserId" = declared_delegator) OR
    (NEW."delegatorUserId" IS NOT NULL AND NEW."delegatorUserId" = declared_user) OR
    (NEW."delegatorUserId" IS NOT NULL AND declared_delegator IS NOT NULL AND NEW."delegatorUserId" = declared_delegator) OR
    (NEW."delegatorUserId" IS NOT NULL AND NEW."delegatorUserId" = NEW."actorUserId")
  ) THEN
    RAISE EXCEPTION 'POL-219 B 级声明人与复核人必须是不同的有效身份';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_require_summary_authority_attestation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HistoricalWageSummaryAuthorityAttestation"
    WHERE "authorityVersionId" = NEW."id"
      AND "atomicScopeVersionId" = NEW."atomicScopeVersionId"
      AND "summaryBucketKey" = NEW."summaryBucketKey"
      AND "permissionScopeFingerprint" = NEW."permissionScopeFingerprint"
  ) THEN
    RAISE EXCEPTION 'POL-219 B 级权威版本必须在同一事务附有绑定 attest receipt';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_validate_balance_reconciliation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authority_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  creditor_line "HistoricalWageSummaryAuthorityCreditorLine"%ROWTYPE;
  target JSONB;
  expected_evidence JSONB;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT * INTO creditor_line
  FROM "HistoricalWageSummaryAuthorityCreditorLine"
  WHERE "id" = NEW."authorityCreditorLineId";
  IF creditor_line."id" IS NOT NULL THEN
    SELECT * INTO authority_row
    FROM "HistoricalWageSummaryAuthorityVersion"
    WHERE "id" = creditor_line."authorityVersionId";
  END IF;
  target := creditor_line."targetPayload";

  IF jsonb_typeof(target->'evidence') IS DISTINCT FROM 'array' OR
     jsonb_array_length(target->'evidence') = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级余额对账 target 必须冻结至少一条完整证据坐标';
  END IF;
  expected_evidence := jsonb_build_object(
    'reconciliationReference', target->'reconciliationReference',
    'evidence', target->'evidence',
    'controlledScopeEvidenceCoordinate', creditor_line."controlledScopeEvidenceCoordinate",
    'creditorCategoryCode', creditor_line."wageCreditorCategoryCode"
  );

  IF creditor_line."id" IS NULL OR authority_row."id" IS NULL OR
     creditor_line."targetKind" <> 'historical_wage_balance_reconciliation_version' OR
     target->>'targetKind' IS DISTINCT FROM creditor_line."targetKind" OR
     NEW."id" IS DISTINCT FROM target->>'reservedTargetId' OR
     NEW."atomicScopeVersionId" <> creditor_line."atomicScopeVersionId" OR
     NEW."atomicScopeVersionId" <> authority_row."atomicScopeVersionId" OR
     NEW."authorityVersionId" <> creditor_line."authorityVersionId" OR
     NEW."reconciliationAuthorityVersionId" IS DISTINCT FROM target->>'reconciliationAuthorityVersionId' OR
     NEW."reconciliationReference" IS DISTINCT FROM target->>'reconciliationReference' OR
     NEW."schemaVersion" IS DISTINCT FROM (target->>'schemaVersion')::INTEGER OR
     NEW."canonicalPayload" IS DISTINCT FROM target OR
     NEW."sourceVersionFingerprint" IS DISTINCT FROM target->>'sourceVersionFingerprint' OR
     NEW."sourceVersionFingerprint" <> authority_row."sourceVersionFingerprint" OR
     NEW."reconciliationFingerprint" IS DISTINCT FROM creditor_line."targetFingerprint" OR
     to_char(NEW."asOfDate", 'YYYY-MM-DD') IS DISTINCT FROM target->>'asOfDate' OR
     NEW."employmentCompanyId" <> creditor_line."employmentCompanyId" OR
     NEW."employmentCompanyId" IS DISTINCT FROM target->>'employmentCompanyId' OR
     NEW."employmentCompanyNameSnapshot" IS DISTINCT FROM target->>'employmentCompanyNameSnapshot' OR
     NEW."employmentCompanyCreditCodeSnapshot" IS DISTINCT FROM target->>'employmentCompanyCreditCodeSnapshot' OR
     NEW."projectId" <> creditor_line."projectId" OR
     NEW."projectId" IS DISTINCT FROM target->>'projectId' OR
     NEW."projectCodeSnapshot" IS DISTINCT FROM target->>'projectCodeSnapshot' OR
     NEW."projectNameSnapshot" IS DISTINCT FROM target->>'projectNameSnapshot' OR
     NEW."wageMonth" <> creditor_line."wageMonth" OR
     NEW."wageMonth" IS DISTINCT FROM target->>'wageMonth' OR
     NEW."catalogVersion" <> authority_row."catalogVersion" OR
     NEW."catalogVersion" IS DISTINCT FROM target->>'catalogVersion' OR
     NEW."positionCategoryCode" <> creditor_line."positionCategoryCode" OR
     NEW."positionCategoryCode" IS DISTINCT FROM target->>'positionCategoryCode' OR
     NEW."positionCategoryLabelSnapshot" <> authority_row."positionCategoryLabelSnapshot" OR
     NEW."positionCategoryLabelSnapshot" IS DISTINCT FROM target->>'positionCategoryLabelSnapshot' OR
     NEW."wageCreditorCategoryCode" <> creditor_line."wageCreditorCategoryCode" OR
     NEW."wageCreditorCategoryCode" IS DISTINCT FROM target->>'categoryCode' OR
     NEW."wageCreditorCategoryLabelSnapshot" <> creditor_line."wageCreditorCategoryLabelSnapshot" OR
     NEW."wageCreditorCategoryLabelSnapshot" IS DISTINCT FROM target->>'categoryLabelSnapshot' OR
     NEW."creditorIdentityKind" <> creditor_line."creditorIdentityKind" OR
     NEW."creditorIdentityKind" IS DISTINCT FROM target->>'creditorIdentityKind' OR
     NEW."creditorPartyVersionId" IS DISTINCT FROM creditor_line."creditorPartyVersionId" OR
     NEW."creditorPartyVersionId" IS DISTINCT FROM target->>'creditorPartyVersionId' OR
     NEW."controlledScopeCode" IS DISTINCT FROM creditor_line."controlledScopeCode" OR
     NEW."controlledScopeCode" IS DISTINCT FROM target->>'controlledScopeCode' OR
     NEW."controlledScopeDescription" IS DISTINCT FROM creditor_line."controlledScopeDescription" OR
     NEW."controlledScopeDescription" IS DISTINCT FROM target->>'controlledScopeDescription' OR
     NEW."targetBusinessKey" <> creditor_line."targetBusinessKey" OR
     NEW."targetBusinessKey" IS DISTINCT FROM target->>'targetBusinessKey' OR
     NEW."currencyCode" <> creditor_line."currencyCode" OR
     NEW."currencyCode" IS DISTINCT FROM target->>'currencyCode' OR
     NEW."debtStatus" <> creditor_line."debtStatus" OR
     NEW."debtStatus" IS DISTINCT FROM target->>'debtStatus' OR
     NEW."grossDebtCents" <> creditor_line."grossDebtCents" OR
     NEW."grossDebtCents"::text IS DISTINCT FROM target->>'grossDebtCents' OR
     NEW."historicallySettledCents" <> creditor_line."historicallySettledCents" OR
     NEW."historicallySettledCents"::text IS DISTINCT FROM target->>'historicallySettledCents' OR
     NEW."outstandingBalanceCents" <> creditor_line."outstandingBalanceCents" OR
     NEW."outstandingBalanceCents"::text IS DISTINCT FROM target->>'outstandingBalanceCents' OR
     NEW."evidenceSnapshot" IS DISTINCT FROM expected_evidence OR
     NEW."createdTransactionId" <> txid_current() OR
     length(btrim(NEW."reconciliationAuthorityVersionId")) = 0 OR
     length(btrim(NEW."reconciliationReference")) = 0 OR
     NEW."schemaVersion" <> 1 OR
     jsonb_typeof(target->'supportingPaymentExecutions') IS DISTINCT FROM 'array' OR
     EXISTS (
       SELECT 1
       FROM jsonb_array_elements(target->'evidence') item
       LEFT JOIN "FileObject" file
         ON file."id" = item->>'fileObjectId'
        AND file."storageStatus" = 'active'
        AND file."contentSha256" = item->>'contentSha256'
       WHERE file."id" IS NULL OR
             COALESCE(item->>'contentSha256', '') !~ '^[0-9a-f]{64}$' OR
             length(btrim(COALESCE(item->>'evidenceCoordinate', ''))) = 0
     ) OR
     EXISTS (
       SELECT 1 FROM "HistoricalWageSummaryPaymentExecutionLink"
       WHERE "authorityCreditorLineId" = creditor_line."id"
     ) OR
     (creditor_line."wageCreditorCategoryCode" = 'other_controlled_payee' AND
       creditor_line."controlledScopeEvidenceCoordinate" IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级余额对账版本必须逐字段冻结同一 authority/creditor target、金额恒等式与有效证据';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_payable_target()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  authority "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  creditor_line "HistoricalWageSummaryAuthorityCreditorLine"%ROWTYPE;
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  mapping_scope TEXT;
  authority_mapping_count INTEGER;
  reconciliation "HistoricalWageBalanceReconciliationVersion"%ROWTYPE;
  root_ref "HistoricalWageSummaryPayableRef"%ROWTYPE;
  effective_amount BIGINT;
  linked_count INTEGER;
  linked_total BIGINT;
BEGIN
  SELECT * INTO authority FROM "HistoricalWageSummaryAuthorityVersion" WHERE "id" = NEW."authorityVersionId";
  SELECT * INTO creditor_line FROM "HistoricalWageSummaryAuthorityCreditorLine" WHERE "id" = NEW."authorityCreditorLineId";
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  SELECT "atomicScopeVersionId" INTO mapping_scope
  FROM "OperatingTakeoverManifestVersion" WHERE "id" = mapping_row."manifestVersionId";
  SELECT COUNT(*) INTO authority_mapping_count
  FROM "OperatingTakeoverRowMapping"
  WHERE "adapterKind" = 'historical_wage'
    AND "evidenceLevel" = 'B'
    AND "mappingDecision" = 'FORMAL'
    AND "historicalWageSummaryAuthorityVersionId" = NEW."authorityVersionId";
  IF authority."id" IS NULL OR authority."atomicScopeVersionId" <> NEW."atomicScopeVersionId" OR
    authority."employmentCompanyId" <> NEW."employmentCompanyId" OR authority."projectId" <> NEW."projectId" OR
    authority."wageMonth" <> NEW."wageMonth" OR authority."positionCategoryCode" <> NEW."positionCategoryCode" OR
    creditor_line."id" IS NULL OR creditor_line."authorityVersionId" <> authority."id" OR
    creditor_line."atomicScopeVersionId" <> NEW."atomicScopeVersionId" OR
    creditor_line."stableBucketKey" <> NEW."stableBucketKey" OR
    creditor_line."employmentCompanyId" <> NEW."employmentCompanyId" OR
    creditor_line."projectId" <> NEW."projectId" OR creditor_line."wageMonth" <> NEW."wageMonth" OR
    creditor_line."positionCategoryCode" <> NEW."positionCategoryCode" OR
    creditor_line."wageCreditorCategoryCode" <> NEW."wageCreditorCategoryCode" OR
    creditor_line."wageCreditorCategoryLabelSnapshot" <> NEW."wageCreditorCategoryLabelSnapshot" OR
    creditor_line."creditorIdentityKind" <> NEW."creditorIdentityKind" OR
    creditor_line."creditorPartyVersionId" IS DISTINCT FROM NEW."creditorPartyVersionId" OR
    creditor_line."controlledScopeCode" IS DISTINCT FROM NEW."controlledScopeCode" OR
    creditor_line."controlledScopeDescription" IS DISTINCT FROM NEW."controlledScopeDescription" OR
    creditor_line."controlledScopeEvidenceCoordinate" IS DISTINCT FROM NEW."controlledScopeEvidenceCoordinate" OR
    creditor_line."debtStatus" <> NEW."debtStatus" OR
    creditor_line."grossDebtCents" <> NEW."grossDebtCents" OR
    creditor_line."historicallySettledCents" <> NEW."historicallySettledCents" OR
    creditor_line."outstandingBalanceCents" <> NEW."outstandingBalanceCents" OR
    creditor_line."targetKind" <> NEW."targetKind" OR
    creditor_line."targetBusinessKey" <> NEW."targetBusinessKey" OR
    creditor_line."targetPayload" IS DISTINCT FROM NEW."targetPayload" OR
    creditor_line."targetFingerprint" <> NEW."targetFingerprint" OR
    mapping_row."id" IS NULL OR mapping_row."adapterKind" <> 'historical_wage' OR
    mapping_row."evidenceLevel" <> 'B' OR mapping_row."mappingDecision" <> 'FORMAL' OR
    mapping_row."historicalWageSummaryAuthorityVersionId" <> NEW."authorityVersionId" OR
    mapping_row."projectId" <> NEW."projectId" OR mapping_scope IS DISTINCT FROM NEW."atomicScopeVersionId" OR
    authority_mapping_count <> 1 OR NEW."createdTransactionId" <> txid_current() OR
    creditor_line."signedGrossDeltaCents" = 0 OR
    NEW."direction" <> (CASE
      WHEN creditor_line."signedGrossDeltaCents" > 0 THEN 'increase'
      ELSE 'decrease'
    END) OR
    NEW."deltaAmountCents" <> abs(creditor_line."signedGrossDeltaCents") OR
    NEW."adjustsSummaryPayableRefId" IS DISTINCT FROM creditor_line."rootPayableRefId" OR
    NEW."deltaFingerprint" <> creditor_line."deltaFingerprint" THEN
    RAISE EXCEPTION 'POL-219 B级 payable ref 必须绑定同一 scope、公司、项目、月份和岗位类别权威';
  END IF;
  IF NEW."targetKind" = 'historical_wage_balance_reconciliation_version' THEN
    SELECT * INTO reconciliation FROM "HistoricalWageBalanceReconciliationVersion"
      WHERE "id" = NEW."historicalWageBalanceReconciliationVersionId";
    IF reconciliation."id" IS NULL OR reconciliation."atomicScopeVersionId" <> NEW."atomicScopeVersionId" OR
      reconciliation."authorityVersionId" <> NEW."authorityVersionId" OR reconciliation."wageCreditorCategoryCode" <> NEW."wageCreditorCategoryCode" OR
      reconciliation."authorityCreditorLineId" <> NEW."authorityCreditorLineId" OR
      reconciliation."employmentCompanyId" <> NEW."employmentCompanyId" OR reconciliation."projectId" <> NEW."projectId" OR
      reconciliation."wageMonth" <> NEW."wageMonth" OR reconciliation."positionCategoryCode" <> NEW."positionCategoryCode" OR
      reconciliation."creditorIdentityKind" <> NEW."creditorIdentityKind" OR
      reconciliation."creditorPartyVersionId" IS DISTINCT FROM NEW."creditorPartyVersionId" OR
      reconciliation."controlledScopeCode" IS DISTINCT FROM NEW."controlledScopeCode" OR
      reconciliation."controlledScopeDescription" IS DISTINCT FROM NEW."controlledScopeDescription" OR
      reconciliation."targetBusinessKey" <> NEW."targetBusinessKey" OR
      reconciliation."canonicalPayload" IS DISTINCT FROM NEW."targetPayload" OR
      reconciliation."reconciliationFingerprint" <> NEW."targetFingerprint" OR
      reconciliation."grossDebtCents" <> NEW."grossDebtCents" OR reconciliation."historicallySettledCents" <> NEW."historicallySettledCents" OR
      reconciliation."outstandingBalanceCents" <> NEW."outstandingBalanceCents" OR reconciliation."debtStatus" <> NEW."debtStatus" OR
      EXISTS (SELECT 1 FROM "HistoricalWageSummaryPaymentExecutionLink" WHERE "authorityCreditorLineId" = creditor_line."id") THEN
      RAISE EXCEPTION 'POL-219 B级余额对账目标与 payable ref 冻结范围或金额不一致';
    END IF;
  ELSE
    SELECT COUNT(*), COALESCE(SUM("amountCents"), 0) INTO linked_count, linked_total
      FROM "HistoricalWageSummaryPaymentExecutionLink" WHERE "authorityCreditorLineId" = creditor_line."id";
    IF linked_count < 1 OR linked_total <> NEW."grossDebtCents" OR EXISTS (
      SELECT 1 FROM "HistoricalWageSummaryPaymentExecutionLink" link
      WHERE link."authorityCreditorLineId" = creditor_line."id"
        AND link."summaryPayableRefId" IS NOT NULL
        AND link."summaryPayableRefId" <> NEW."id"
    ) OR EXISTS (
      SELECT 1
      FROM "HistoricalWageSummaryPaymentExecutionLink" link
      JOIN "HistoricalWageSummaryAuthorityCreditorLine" other_line
        ON other_line."id" = link."authorityCreditorLineId"
      WHERE link."paymentExecutionId" IN (
        SELECT own_link."paymentExecutionId"
        FROM "HistoricalWageSummaryPaymentExecutionLink" own_link
        WHERE own_link."authorityCreditorLineId" = creditor_line."id"
      )
        AND other_line."stableBucketKey" <> creditor_line."stableBucketKey"
    ) THEN
      RAISE EXCEPTION 'POL-219 B级既有付款目标必须存在完整、不切片的付款执行链接且金额闭合';
    END IF;
  END IF;

  SELECT ref.* INTO root_ref
  FROM "HistoricalWageSummaryPayableRef" ref
  JOIN "HistoricalWageSummaryAuthorityCreditorLine" line ON line."id" = ref."authorityCreditorLineId"
  WHERE ref."stableBucketKey" = NEW."stableBucketKey"
    AND ref."wageCreditorCategoryCode" = NEW."wageCreditorCategoryCode"
    AND ref."id" <> NEW."id"
    AND line."revision" < creditor_line."revision"
    AND ref."adjustsSummaryPayableRefId" IS NULL
  ORDER BY line."revision" ASC, ref."createdAt" ASC
  LIMIT 1
  FOR UPDATE OF ref;
  IF root_ref."id" IS NULL THEN
    IF NEW."adjustsSummaryPayableRefId" IS NOT NULL OR NEW."direction" <> 'increase' THEN
      RAISE EXCEPTION 'POL-219 B级首个非零 delta 必须建立唯一正向原始 summary payable root';
    END IF;
    root_ref := NEW;
  ELSIF NEW."adjustsSummaryPayableRefId" IS DISTINCT FROM root_ref."id" OR
        root_ref."adjustsSummaryPayableRefId" IS NOT NULL THEN
    RAISE EXCEPTION 'POL-219 B级 adjustment 必须直接指向同一稳定 bucket 的不可变原始 payable root';
  END IF;
  SELECT
    root_ref."deltaAmountCents" + COALESCE(SUM(
      CASE
        WHEN adjustment."direction" = 'increase' THEN adjustment."deltaAmountCents"
        WHEN adjustment."direction" = 'decrease' THEN -adjustment."deltaAmountCents"
        ELSE 0
      END
    ), 0)
  INTO effective_amount
  FROM "HistoricalWageSummaryPayableRef" adjustment
  WHERE adjustment."adjustsSummaryPayableRefId" = root_ref."id";
  IF effective_amount < 0 OR effective_amount <> NEW."grossDebtCents" THEN
    RAISE EXCEPTION 'POL-219 B级 signed delta lineage 必须闭合到当前完整快照且有效债务不得为负';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_creditor_target()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reconciliation "HistoricalWageBalanceReconciliationVersion"%ROWTYPE;
  linked_count INTEGER;
  linked_total BIGINT;
BEGIN
  IF NEW."targetKind" = 'historical_wage_balance_reconciliation_version' THEN
    SELECT * INTO reconciliation
    FROM "HistoricalWageBalanceReconciliationVersion"
    WHERE "authorityCreditorLineId" = NEW."id";
    IF reconciliation."id" IS NULL OR
       reconciliation."atomicScopeVersionId" <> NEW."atomicScopeVersionId" OR
       reconciliation."authorityVersionId" <> NEW."authorityVersionId" OR
       reconciliation."employmentCompanyId" <> NEW."employmentCompanyId" OR
       reconciliation."projectId" <> NEW."projectId" OR reconciliation."wageMonth" <> NEW."wageMonth" OR
       reconciliation."positionCategoryCode" <> NEW."positionCategoryCode" OR
       reconciliation."grossDebtCents" <> NEW."grossDebtCents" OR
       reconciliation."historicallySettledCents" <> NEW."historicallySettledCents" OR
       reconciliation."outstandingBalanceCents" <> NEW."outstandingBalanceCents" OR
       reconciliation."debtStatus" <> NEW."debtStatus" OR
       EXISTS (SELECT 1 FROM "HistoricalWageSummaryPaymentExecutionLink" WHERE "authorityCreditorLineId" = NEW."id") THEN
      RAISE EXCEPTION 'POL-219 B级 creditor line 的余额对账 target 必须完整冻结同一非负快照';
    END IF;
  ELSE
    SELECT COUNT(*), COALESCE(SUM("amountCents"), 0)
    INTO linked_count, linked_total
    FROM "HistoricalWageSummaryPaymentExecutionLink"
    WHERE "authorityCreditorLineId" = NEW."id";
    IF NEW."isTombstone" OR linked_count < 1 OR linked_total <> NEW."grossDebtCents" OR
       NEW."debtStatus" <> 'settled' OR NEW."outstandingBalanceCents" <> 0 OR EXISTS (
         SELECT 1
         FROM "HistoricalWageSummaryPaymentExecutionLink" own_link
         JOIN "HistoricalWageSummaryPaymentExecutionLink" other_link
           ON other_link."paymentExecutionId" = own_link."paymentExecutionId"
          AND other_link."authorityCreditorLineId" <> own_link."authorityCreditorLineId"
         JOIN "HistoricalWageSummaryAuthorityCreditorLine" other_line
           ON other_line."id" = other_link."authorityCreditorLineId"
         WHERE own_link."authorityCreditorLineId" = NEW."id"
           AND other_line."stableBucketKey" <> NEW."stableBucketKey"
       ) OR EXISTS (
         SELECT 1 FROM "HistoricalWageBalanceReconciliationVersion"
         WHERE "authorityCreditorLineId" = NEW."id"
       ) THEN
      RAISE EXCEPTION 'POL-219 B级既有付款 target 必须全额结清、整笔归属同一稳定 creditor bucket 且不可跨 bucket 复用';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_validate_summary_payment_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  creditor_line "HistoricalWageSummaryAuthorityCreditorLine"%ROWTYPE;
  authority_row "HistoricalWageSummaryAuthorityVersion"%ROWTYPE;
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  summary_ref "HistoricalWageSummaryPayableRef"%ROWTYPE;
  execution_row "PaymentExecution"%ROWTYPE;
  request_row "PaymentRequest"%ROWTYPE;
  attestation_row "PaymentExecutionPayerAttestation"%ROWTYPE;
  claim_row "BankTransactionClaim"%ROWTYPE;
  observation_row "VerifiedBankTransactionObservation"%ROWTYPE;
  target JSONB;
  expected_evidence JSONB;
  expected_target_fingerprint TEXT;
  mapping_count INTEGER;
  voucher_hash TEXT;
  attestation_evidence_hash TEXT;
  observation_transaction_hash TEXT;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT * INTO creditor_line FROM "HistoricalWageSummaryAuthorityCreditorLine" WHERE "id" = NEW."authorityCreditorLineId";
  IF creditor_line."id" IS NOT NULL THEN
    SELECT * INTO authority_row
    FROM "HistoricalWageSummaryAuthorityVersion"
    WHERE "id" = creditor_line."authorityVersionId";
    SELECT COUNT(*) INTO mapping_count
    FROM "OperatingTakeoverRowMapping"
    WHERE "adapterKind" = 'historical_wage'
      AND "evidenceLevel" = 'B'
      AND "mappingDecision" = 'FORMAL'
      AND "historicalWageSummaryAuthorityVersionId" = creditor_line."authorityVersionId";
    IF mapping_count = 1 THEN
      SELECT * INTO mapping_row
      FROM "OperatingTakeoverRowMapping"
      WHERE "adapterKind" = 'historical_wage'
        AND "evidenceLevel" = 'B'
        AND "mappingDecision" = 'FORMAL'
        AND "historicalWageSummaryAuthorityVersionId" = creditor_line."authorityVersionId";
      SELECT item->>'targetFingerprint' INTO expected_target_fingerprint
      FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(mapping_row."readSetSnapshot"->'plan'->'summaryLines') = 'array'
          THEN mapping_row."readSetSnapshot"->'plan'->'summaryLines'
        ELSE '[]'::jsonb
      END) item
      WHERE item->>'stableBucketKey' = creditor_line."stableBucketKey"
        AND item->>'wageCreditorCategoryCode' = creditor_line."wageCreditorCategoryCode";
    END IF;
  END IF;
  target := creditor_line."targetPayload";
  IF jsonb_typeof(target->'paymentExecutionIds') IS DISTINCT FROM 'array' OR
     jsonb_typeof(target->'paymentExecutions') IS DISTINCT FROM 'array' OR
     jsonb_array_length(target->'paymentExecutionIds') = 0 OR
     jsonb_array_length(target->'paymentExecutionIds') <> jsonb_array_length(target->'paymentExecutions') OR
     NEW."ordinal" > jsonb_array_length(target->'paymentExecutions') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级付款 target 必须冻结非空、有序且等长的付款 ID/证据集合';
  END IF;
  expected_evidence := target->'paymentExecutions'->(NEW."ordinal" - 1);
  SELECT * INTO execution_row FROM "PaymentExecution" WHERE "id" = NEW."paymentExecutionId";
  IF execution_row."id" IS NOT NULL THEN
    SELECT * INTO request_row FROM "PaymentRequest" WHERE "id" = execution_row."paymentRequestId";
    SELECT * INTO attestation_row FROM "PaymentExecutionPayerAttestation" WHERE "paymentExecutionId" = execution_row."id";
    SELECT * INTO claim_row FROM "BankTransactionClaim" WHERE "paymentExecutionId" = execution_row."id";
    SELECT "contentSha256" INTO voucher_hash FROM "FileObject" WHERE "id" = execution_row."voucherFileId" AND "storageStatus" = 'active';
  END IF;
  IF claim_row."id" IS NOT NULL THEN
    SELECT * INTO observation_row FROM "VerifiedBankTransactionObservation" WHERE "id" = claim_row."observationId";
  END IF;
  IF attestation_row."id" IS NOT NULL THEN
    SELECT "contentSha256" INTO attestation_evidence_hash
    FROM "FileObject" WHERE "id" = attestation_row."verificationEvidenceFileId" AND "storageStatus" = 'active';
  END IF;
  IF observation_row."id" IS NOT NULL THEN
    SELECT "contentSha256" INTO observation_transaction_hash
    FROM "FileObject" WHERE "id" = observation_row."transactionEvidenceFileId" AND "storageStatus" = 'active';
  END IF;
  SELECT * INTO summary_ref FROM "HistoricalWageSummaryPayableRef" WHERE "id" = NEW."summaryPayableRefId";
  IF creditor_line."id" IS NULL OR authority_row."id" IS NULL OR mapping_count <> 1 OR
     mapping_row."id" IS NULL OR mapping_row."projectId" <> creditor_line."projectId" OR
     mapping_row."historicalWageSummaryAuthorityVersionId" <> creditor_line."authorityVersionId" OR
     creditor_line."targetKind" <> 'existing_verified_payment_execution_set' OR
     creditor_line."targetBusinessKey" <> creditor_line."targetFingerprint" OR
     creditor_line."targetFingerprint" IS DISTINCT FROM NEW."paymentExecutionSetFingerprint" OR
     target->'paymentExecutionIds'->>(NEW."ordinal" - 1) IS DISTINCT FROM NEW."paymentExecutionId" OR
     expected_evidence->>'paymentExecutionId' IS DISTINCT FROM NEW."paymentExecutionId" OR
     expected_evidence->>'paymentExecutionFingerprint' IS DISTINCT FROM NEW."paymentExecutionFingerprint" OR
     NEW."paymentEvidenceSnapshot" IS DISTINCT FROM expected_evidence OR
     NEW."targetFingerprint" IS DISTINCT FROM expected_target_fingerprint OR
     NEW."targetFingerprint" IS DISTINCT FROM creditor_line."targetFingerprint" OR
     NEW."createdTransactionId" <> txid_current() OR
     execution_row."id" IS NULL OR request_row."id" IS NULL OR
     execution_row."id" IS DISTINCT FROM expected_evidence->>'paymentExecutionId' OR
     execution_row."paymentRequestId" IS DISTINCT FROM expected_evidence->>'paymentRequestId' OR
     request_row."id" IS DISTINCT FROM expected_evidence->>'paymentRequestId' OR
     request_row."sourceType" IS DISTINCT FROM expected_evidence->>'paymentRequestSourceType' OR
     request_row."projectId" IS DISTINCT FROM expected_evidence->>'paymentRequestProjectId' OR
     request_row."projectId" <> creditor_line."projectId" OR
     COALESCE(expected_evidence->>'paymentRequestFingerprint', '') !~ '^[0-9a-f]{64}$' OR
     execution_row."paymentSubjectType" IS DISTINCT FROM expected_evidence->>'paymentSubjectType' OR
     request_row."paymentSubjectType" IS DISTINCT FROM expected_evidence->>'paymentSubjectType' OR
     execution_row."companyEntityIdSnapshot" IS DISTINCT FROM expected_evidence->>'payerCompanyId' OR
     execution_row."companyEntityNameSnapshot" IS DISTINCT FROM expected_evidence->>'payerCompanyNameSnapshot' OR
     execution_row."companyEntityCreditCodeSnapshot" IS DISTINCT FROM expected_evidence->>'payerCompanyCreditCodeSnapshot' OR
     execution_row."amountCents" <> NEW."amountCents" OR
     execution_row."amountCents"::text IS DISTINCT FROM expected_evidence->>'amountCents' OR
     execution_row."companyEntityIdSnapshot" <> creditor_line."employmentCompanyId" OR
     execution_row."paidAt" IS DISTINCT FROM (expected_evidence->>'paidAt')::timestamptz OR
     execution_row."voucherFileId" IS DISTINCT FROM expected_evidence->>'voucherFileId' OR
     voucher_hash IS DISTINCT FROM expected_evidence->>'voucherContentSha256' OR
     voucher_hash !~ '^[0-9a-f]{64}$' OR
     attestation_row."id" IS NULL OR
     attestation_row."id" IS DISTINCT FROM expected_evidence->>'payerAttestationId' OR
     attestation_row."payerVerificationId" IS DISTINCT FROM expected_evidence->>'payerVerificationId' OR
     attestation_row."bankAccountReference" IS DISTINCT FROM expected_evidence->>'bankAccountReference' OR
     attestation_row."holderCompanyEntityId" IS DISTINCT FROM expected_evidence->>'legalAccountHolderCompanyId' OR
     attestation_row."holderNameSnapshot" IS DISTINCT FROM expected_evidence->>'legalAccountHolderNameSnapshot' OR
     attestation_row."holderCreditCodeSnapshot" IS DISTINCT FROM expected_evidence->>'legalAccountHolderCreditCodeSnapshot' OR
     attestation_row."verificationEvidenceFileId" IS DISTINCT FROM expected_evidence->>'verificationEvidenceFileId' OR
     attestation_row."verificationEvidenceContentSha256" IS DISTINCT FROM expected_evidence->>'verificationEvidenceContentSha256' OR
     attestation_evidence_hash IS DISTINCT FROM attestation_row."verificationEvidenceContentSha256" OR
     claim_row."id" IS NULL OR claim_row."id" IS DISTINCT FROM expected_evidence->>'bankTransactionClaimId' OR
     claim_row."targetType" <> 'payment_execution' OR claim_row."paymentExecutionId" <> execution_row."id" OR
     observation_row."id" IS NULL OR observation_row."id" IS DISTINCT FROM expected_evidence->>'bankObservationId' OR
     observation_row."payerVerificationId" <> attestation_row."payerVerificationId" OR
     observation_row."holderCompanyEntityId" <> attestation_row."holderCompanyEntityId" OR
     observation_row."verificationEvidenceFileId" <> attestation_row."verificationEvidenceFileId" OR
     observation_row."verificationEvidenceContentSha256" <> attestation_row."verificationEvidenceContentSha256" OR
     observation_row."transactionSourceType" IS DISTINCT FROM expected_evidence->>'transactionSourceType' OR
     observation_row."transactionSourceId" IS DISTINCT FROM expected_evidence->>'transactionSourceId' OR
     observation_row."transactionSourceIdentity" IS DISTINCT FROM expected_evidence->>'transactionSourceIdentity' OR
     observation_row."amountCents"::text IS DISTINCT FROM expected_evidence->>'transactionAmountCents' OR
     observation_row."amountCents" <> execution_row."amountCents" OR
     observation_row."currencyCode" IS DISTINCT FROM expected_evidence->>'currencyCode' OR
     observation_row."currencyCode" <> 'CNY' OR
     observation_row."direction" IS DISTINCT FROM expected_evidence->>'direction' OR
     observation_row."occurredAt" IS DISTINCT FROM (expected_evidence->>'occurredAt')::timestamptz OR
     observation_row."transactionEvidenceFileId" IS DISTINCT FROM expected_evidence->>'transactionEvidenceFileId' OR
     observation_row."transactionEvidenceContentSha256" IS DISTINCT FROM expected_evidence->>'transactionEvidenceContentSha256' OR
     observation_transaction_hash IS DISTINCT FROM observation_row."transactionEvidenceContentSha256" OR
     observation_row."payloadFingerprint" IS DISTINCT FROM expected_evidence->>'observationPayloadFingerprint' OR
     observation_row."payloadFingerprint" !~ '^[0-9a-f]{64}$' OR
     jsonb_typeof(expected_evidence->'creditorScopeEvidenceCoordinate') IS DISTINCT FROM 'object' OR
     summary_ref."id" IS NULL OR
     summary_ref."authorityCreditorLineId" <> creditor_line."id" OR
     summary_ref."authorityVersionId" <> creditor_line."authorityVersionId" OR
     summary_ref."atomicScopeVersionId" <> creditor_line."atomicScopeVersionId" OR
     summary_ref."stableBucketKey" <> creditor_line."stableBucketKey" OR
     summary_ref."targetPayload" IS DISTINCT FROM creditor_line."targetPayload" OR
     summary_ref."targetFingerprint" <> creditor_line."targetFingerprint" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级付款 target 必须整体绑定同项目同公司且具备完整付款、付款主体和银行 observation/claim 证据链';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_assert_summary_target_closure(
  creditor_line_id TEXT,
  expected_scope_id TEXT,
  expected_mapping_id TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  creditor_line "HistoricalWageSummaryAuthorityCreditorLine"%ROWTYPE;
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  reconciliation_count INTEGER;
  payment_count INTEGER;
  payment_total BIGINT;
  ref_count INTEGER;
  expected_target_fingerprint TEXT;
BEGIN
  SELECT * INTO creditor_line
  FROM "HistoricalWageSummaryAuthorityCreditorLine"
  WHERE "id" = creditor_line_id;
  SELECT * INTO mapping_row
  FROM "OperatingTakeoverRowMapping"
  WHERE "id" = expected_mapping_id;
  IF creditor_line."id" IS NULL OR mapping_row."id" IS NULL OR
     creditor_line."atomicScopeVersionId" <> expected_scope_id OR
     mapping_row."historicalWageSummaryAuthorityVersionId" <> creditor_line."authorityVersionId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 target closure 必须绑定同一 scope、mapping 与 authority creditor line';
  END IF;

  SELECT item->>'targetFingerprint' INTO expected_target_fingerprint
  FROM jsonb_array_elements(CASE
    WHEN jsonb_typeof(mapping_row."readSetSnapshot"->'plan'->'summaryLines') = 'array'
      THEN mapping_row."readSetSnapshot"->'plan'->'summaryLines'
    ELSE '[]'::jsonb
  END) item
  WHERE item->>'stableBucketKey' = creditor_line."stableBucketKey"
    AND item->>'wageCreditorCategoryCode' = creditor_line."wageCreditorCategoryCode";
  IF COALESCE(expected_target_fingerprint, '') !~ '^[0-9a-f]{64}$' OR
     expected_target_fingerprint IS DISTINCT FROM creditor_line."targetFingerprint" THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级 target 必须与 prepare 阶段冻结的 read-set 指纹完全一致';
  END IF;

  SELECT COUNT(*) INTO reconciliation_count
  FROM "HistoricalWageBalanceReconciliationVersion"
  WHERE "authorityCreditorLineId" = creditor_line."id";
  SELECT COUNT(*), COALESCE(SUM("amountCents"), 0)
    INTO payment_count, payment_total
  FROM "HistoricalWageSummaryPaymentExecutionLink"
  WHERE "authorityCreditorLineId" = creditor_line."id";
  SELECT COUNT(*) INTO ref_count
  FROM "HistoricalWageSummaryPayableRef"
  WHERE "authorityCreditorLineId" = creditor_line."id";

  IF creditor_line."signedGrossDeltaCents" = 0 THEN
    IF reconciliation_count <> 0 OR payment_count <> 0 OR ref_count <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级零 signed delta 只保留 authority/creditor 快照，不得物化 target 或 payable ref';
    END IF;
    RETURN;
  END IF;

  IF creditor_line."targetKind" = 'historical_wage_balance_reconciliation_version' THEN
    IF reconciliation_count <> 1 OR payment_count <> 0 OR EXISTS (
      SELECT 1 FROM "HistoricalWageBalanceReconciliationVersion" reconciliation
      WHERE reconciliation."authorityCreditorLineId" = creditor_line."id"
        AND (reconciliation."createdTransactionId" <> txid_current() OR
             reconciliation."atomicScopeVersionId" <> expected_scope_id OR
             reconciliation."authorityVersionId" <> creditor_line."authorityVersionId" OR
             reconciliation."canonicalPayload" IS DISTINCT FROM creditor_line."targetPayload" OR
             reconciliation."reconciliationFingerprint" <> creditor_line."targetFingerprint" OR
             reconciliation."targetBusinessKey" <> creditor_line."targetBusinessKey")
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级余额 target 必须且只能在激活事务物化一个不可变余额对账版本';
    END IF;
  ELSE
    IF jsonb_typeof(creditor_line."targetPayload"->'paymentExecutionIds') IS DISTINCT FROM 'array' OR
       jsonb_typeof(creditor_line."targetPayload"->'paymentExecutions') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级付款 target 缺少有序付款集合';
    END IF;
    IF reconciliation_count <> 0 OR creditor_line."isTombstone" OR
       creditor_line."debtStatus" <> 'settled' OR creditor_line."outstandingBalanceCents" <> 0 OR
       payment_count < 1 OR payment_total <> creditor_line."grossDebtCents" OR
       payment_count <> jsonb_array_length(creditor_line."targetPayload"->'paymentExecutionIds') OR
       payment_count <> jsonb_array_length(creditor_line."targetPayload"->'paymentExecutions') OR
       EXISTS (
         SELECT 1
         FROM "HistoricalWageSummaryPaymentExecutionLink" link
         WHERE link."authorityCreditorLineId" = creditor_line."id"
           AND (link."createdTransactionId" <> txid_current() OR
                link."ordinal" > payment_count OR
                link."paymentExecutionId" IS DISTINCT FROM creditor_line."targetPayload"->'paymentExecutionIds'->>(link."ordinal" - 1) OR
                link."paymentEvidenceSnapshot" IS DISTINCT FROM creditor_line."targetPayload"->'paymentExecutions'->(link."ordinal" - 1) OR
                link."paymentExecutionFingerprint" IS DISTINCT FROM creditor_line."targetPayload"->'paymentExecutions'->(link."ordinal" - 1)->>'paymentExecutionFingerprint' OR
                link."paymentExecutionSetFingerprint" IS DISTINCT FROM creditor_line."targetFingerprint" OR
                link."targetFingerprint" IS DISTINCT FROM expected_target_fingerprint)
       ) OR EXISTS (
         SELECT 1
         FROM generate_series(1, payment_count) AS expected_ordinal(value)
         WHERE NOT EXISTS (
           SELECT 1 FROM "HistoricalWageSummaryPaymentExecutionLink" link
           WHERE link."authorityCreditorLineId" = creditor_line."id"
             AND link."ordinal" = expected_ordinal.value
         )
       ) OR EXISTS (
         SELECT 1
         FROM "HistoricalWageSummaryPaymentExecutionLink" own_link
         JOIN "HistoricalWageSummaryPaymentExecutionLink" other_link
           ON other_link."paymentExecutionId" = own_link."paymentExecutionId"
          AND other_link."authorityCreditorLineId" <> own_link."authorityCreditorLineId"
         JOIN "HistoricalWageSummaryAuthorityCreditorLine" other_line
           ON other_line."id" = other_link."authorityCreditorLineId"
         WHERE own_link."authorityCreditorLineId" = creditor_line."id"
           AND other_line."stableBucketKey" <> creditor_line."stableBucketKey"
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级付款 target 必须且只能物化同事务有序整笔付款集合，并与债务毛额闭合';
    END IF;
  END IF;

  IF ref_count <> 1 OR EXISTS (
       SELECT 1 FROM "HistoricalWageSummaryPayableRef" ref
       WHERE ref."authorityCreditorLineId" = creditor_line."id"
         AND (ref."rowMappingId" <> expected_mapping_id OR
              ref."atomicScopeVersionId" <> expected_scope_id OR
              ref."targetPayload" IS DISTINCT FROM creditor_line."targetPayload" OR
              ref."targetFingerprint" <> creditor_line."targetFingerprint" OR
              ref."adjustsSummaryPayableRefId" IS DISTINCT FROM creditor_line."rootPayableRefId" OR
              ref."createdTransactionId" <> txid_current())
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 B级零 signed delta 不得生成 ref，非零 signed delta 必须在激活事务生成唯一受控 ref';
  END IF;
END;
$$;

-- Every activation-time target owns the reverse edge back to the exact
-- mapping/bridge/receipt graph. This closes the orphan and late-append paths
-- that a trigger on the source bridge alone cannot observe.
CREATE FUNCTION jg_pol219_require_materialized_target_graph()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_id TEXT;
  scope_id TEXT;
  target_kind TEXT;
  target_ref TEXT;
  target_created_tx BIGINT;
  authority_id TEXT;
  creditor_line_id TEXT;
  mapping_count INTEGER;
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'WageTakeoverProjectionEnvelope' THEN
      mapping_id := NEW."rowMappingId";
      scope_id := NEW."atomicScopeVersionId";
      target_kind := 'wage_takeover_projection_envelope';
      target_ref := NEW."id";
      target_created_tx := NEW."createdTransactionId";
    WHEN 'WageTakeoverLegacyImpactBridge' THEN
      mapping_id := NEW."rowMappingId";
      IF NEW."envelopeId" IS NOT NULL THEN
        SELECT "atomicScopeVersionId" INTO scope_id
        FROM "WageTakeoverProjectionEnvelope" WHERE "id" = NEW."envelopeId";
        target_kind := 'wage_takeover_projection_envelope';
        target_ref := NEW."envelopeId";
      ELSE
        SELECT "atomicScopeVersionId" INTO scope_id
        FROM "HistoricalWageSummaryAuthorityVersion" WHERE "id" = NEW."summaryAuthorityVersionId";
        target_kind := 'historical_wage_summary_authority_version';
        target_ref := NEW."summaryAuthorityVersionId";
      END IF;
      target_created_tx := NEW."createdTransactionId";
    WHEN 'UnresolvedWagePayableGap' THEN
      mapping_id := NEW."rowMappingId";
      scope_id := NEW."atomicScopeVersionId";
      target_kind := 'unresolved_wage_payable_gap';
      target_ref := NEW."id";
      target_created_tx := NEW."createdTransactionId";
    WHEN 'HistoricalWageBalanceReconciliationVersion' THEN
      authority_id := NEW."authorityVersionId";
      creditor_line_id := NEW."authorityCreditorLineId";
      scope_id := NEW."atomicScopeVersionId";
      target_kind := 'historical_wage_summary_authority_version';
      target_ref := authority_id;
      target_created_tx := NEW."createdTransactionId";
    WHEN 'HistoricalWageSummaryPaymentExecutionLink' THEN
      creditor_line_id := NEW."authorityCreditorLineId";
      SELECT "authorityVersionId", "atomicScopeVersionId" INTO authority_id, scope_id
      FROM "HistoricalWageSummaryAuthorityCreditorLine" WHERE "id" = creditor_line_id;
      target_kind := 'historical_wage_summary_authority_version';
      target_ref := authority_id;
      target_created_tx := NEW."createdTransactionId";
    WHEN 'HistoricalWageSummaryPayableRef' THEN
      mapping_id := NEW."rowMappingId";
      authority_id := NEW."authorityVersionId";
      creditor_line_id := NEW."authorityCreditorLineId";
      scope_id := NEW."atomicScopeVersionId";
      target_kind := 'historical_wage_summary_authority_version';
      target_ref := authority_id;
      target_created_tx := NEW."createdTransactionId";
    ELSE
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POL-219 未知激活 target 类型';
  END CASE;

  IF authority_id IS NOT NULL THEN
    SELECT COUNT(*) INTO mapping_count
    FROM "OperatingTakeoverRowMapping"
    WHERE "adapterKind" = 'historical_wage'
      AND "evidenceLevel" = 'B'
      AND "mappingDecision" = 'FORMAL'
      AND "historicalWageSummaryAuthorityVersionId" = authority_id;
    IF mapping_count = 1 AND mapping_id IS NULL THEN
      SELECT "id" INTO mapping_id
      FROM "OperatingTakeoverRowMapping"
      WHERE "adapterKind" = 'historical_wage'
        AND "evidenceLevel" = 'B'
        AND "mappingDecision" = 'FORMAL'
        AND "historicalWageSummaryAuthorityVersionId" = authority_id;
    END IF;
  END IF;
  SELECT * INTO mapping_row
  FROM "OperatingTakeoverRowMapping"
  WHERE "id" = mapping_id;

  IF target_created_tx <> txid_current() OR mapping_row."id" IS NULL OR
     mapping_row."adapterKind" <> 'historical_wage' OR
     (authority_id IS NOT NULL AND mapping_count <> 1) OR
     scope_id IS NULL OR NOT EXISTS (
       SELECT 1
       FROM "OperatingTakeoverCommandReceipt" receipt
       JOIN "OperatingTakeoverCommandReceiptLine" line ON line."receiptId" = receipt."id"
       JOIN "OperatingTakeoverLegacySourceBridge" bridge ON bridge."rowMappingId" = mapping_row."id"
       WHERE receipt."atomicScopeVersionId" = scope_id
         AND receipt."action" = 'historical_wage_takeover.scope.activate'
         AND receipt."status" = 'activated'
         AND receipt."createdTransactionId" = txid_current()
         AND line."rowMappingId" = mapping_row."id"
         AND line."projectId" = mapping_row."projectId"
         AND line."entryKind" = 'historical_wage'
         AND line."decision" = mapping_row."mappingDecision"
         AND line."targetKind" = target_kind
         AND line."targetRef" = target_ref
         AND bridge."projectId" = mapping_row."projectId"
         AND bridge."targetKind" = target_kind
         AND bridge."targetRef" = target_ref
         AND bridge."mappingDecision" = mapping_row."mappingDecision"
         AND bridge.xmin::text::bigint = jg_pol219_current_xid32()
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 target 必须在同一激活事务由唯一 mapping、legacy bridge 与 activated receipt 可逆到达';
  END IF;
  IF authority_id IS NOT NULL THEN
    PERFORM jg_pol219_assert_summary_target_closure(creditor_line_id, scope_id, mapping_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_bind_created_transaction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."createdTransactionId" := txid_current();
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_validate_eligibility_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  compensation_receipt "OperatingTakeoverCommandReceipt"%ROWTYPE;
  activation_receipt "OperatingTakeoverCommandReceipt"%ROWTYPE;
  scope_row "OperatingTakeoverAtomicScopeVersion"%ROWTYPE;
  mapping_id TEXT;
  scope_id TEXT;
  target_kind TEXT;
  target_ref TEXT;
BEGIN
  NEW."createdTransactionId" := txid_current();
  SELECT * INTO compensation_receipt
  FROM "OperatingTakeoverCommandReceipt"
  WHERE "id" = NEW."compensationReceiptId";
  IF compensation_receipt."id" IS NOT NULL THEN
    SELECT * INTO activation_receipt
    FROM "OperatingTakeoverCommandReceipt"
    WHERE "id" = compensation_receipt."causesReceiptId";
    SELECT * INTO scope_row
    FROM "OperatingTakeoverAtomicScopeVersion"
    WHERE "id" = compensation_receipt."atomicScopeVersionId";
  END IF;

  IF TG_TABLE_NAME = 'WageTakeoverProjectionEnvelopeEligibilityRevocation' THEN
    SELECT "rowMappingId", "atomicScopeVersionId" INTO mapping_id, scope_id
    FROM "WageTakeoverProjectionEnvelope" WHERE "id" = NEW."envelopeId";
    target_kind := 'wage_takeover_projection_envelope';
    target_ref := NEW."envelopeId";
  ELSE
    SELECT "rowMappingId", "atomicScopeVersionId", "authorityVersionId"
      INTO mapping_id, scope_id, target_ref
    FROM "HistoricalWageSummaryPayableRef" WHERE "id" = NEW."summaryPayableRefId";
    target_kind := 'historical_wage_summary_authority_version';
  END IF;

  IF compensation_receipt."id" IS NULL OR activation_receipt."id" IS NULL OR scope_row."id" IS NULL OR
     length(btrim(COALESCE(NEW."reason", ''))) = 0 OR
     NEW."createdTransactionId" <> txid_current() OR
     compensation_receipt."atomicScopeVersionId" IS NULL OR
     compensation_receipt."atomicScopeVersionId" <> scope_id OR
     compensation_receipt."action" <> 'historical_wage_takeover.scope.compensate' OR
     compensation_receipt."status" <> 'compensated' OR
     compensation_receipt."createdTransactionId" <> txid_current() OR
     compensation_receipt."causesReceiptId" <> activation_receipt."id" OR
     compensation_receipt."permissionSnapshotFingerprint" <> scope_row."permissionSnapshotFingerprint" OR
     activation_receipt."atomicScopeVersionId" <> scope_id OR
     activation_receipt."action" <> 'historical_wage_takeover.scope.activate' OR
     activation_receipt."status" <> 'activated' OR
     activation_receipt."permissionSnapshotFingerprint" <> scope_row."permissionSnapshotFingerprint" OR
     compensation_receipt."actorUserId" IN (activation_receipt."actorUserId", activation_receipt."delegatorUserId") OR
     (compensation_receipt."delegatorUserId" IS NOT NULL AND
       compensation_receipt."delegatorUserId" IN (activation_receipt."actorUserId", activation_receipt."delegatorUserId")) OR
     EXISTS (
       SELECT 1 FROM "OperatingTakeoverCommandReceipt" successor
       WHERE successor."causesReceiptId" = activation_receipt."id"
         AND successor."id" <> compensation_receipt."id"
     ) OR
     NOT EXISTS (
       SELECT 1
       FROM "OperatingTakeoverCommandReceiptLine" line
       JOIN "OperatingTakeoverLegacySourceBridge" bridge ON bridge."rowMappingId" = mapping_id
       WHERE line."receiptId" = activation_receipt."id"
         AND line."rowMappingId" = mapping_id
         AND line."entryKind" = 'historical_wage'
         AND line."targetKind" = target_kind
         AND line."targetRef" = target_ref
         AND bridge."targetKind" = target_kind
         AND bridge."targetRef" = target_ref
     ) OR
     (TG_TABLE_NAME = 'WageTakeoverProjectionEnvelopeEligibilityRevocation' AND EXISTS (
       SELECT 1
       FROM "WageTakeoverProjectionEnvelopePayableRef" envelope_ref
       JOIN "PaymentExecutionWagePayableBinding" payment_binding
         ON payment_binding."wagePayableRefId" = envelope_ref."payableRefId"
       WHERE envelope_ref."envelopeId" = NEW."envelopeId"
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 补偿只能沿同 scope activation 因果链撤销未被下游消费的接管资格，绝不冲销 legacy 业务事实';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION jg_pol219_require_compensation_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_count INTEGER;
  receipt_line_count INTEGER;
  envelope_count INTEGER;
  envelope_revocation_count INTEGER;
  summary_ref_count INTEGER;
  summary_revocation_count INTEGER;
BEGIN
  IF NEW."atomicScopeVersionId" IS NULL OR
     NEW."action" <> 'historical_wage_takeover.scope.compensate' THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*) INTO mapping_count
  FROM "OperatingTakeoverRowMapping" mapping
  JOIN "OperatingTakeoverManifestVersion" manifest ON manifest."id" = mapping."manifestVersionId"
  WHERE manifest."atomicScopeVersionId" = NEW."atomicScopeVersionId"
    AND mapping."adapterKind" = 'historical_wage';
  SELECT COUNT(*) INTO receipt_line_count
  FROM "OperatingTakeoverCommandReceiptLine"
  WHERE "receiptId" = NEW."id";
  SELECT COUNT(*) INTO envelope_count
  FROM "WageTakeoverProjectionEnvelope"
  WHERE "atomicScopeVersionId" = NEW."atomicScopeVersionId";
  SELECT COUNT(*) INTO envelope_revocation_count
  FROM "WageTakeoverProjectionEnvelopeEligibilityRevocation" revocation
  JOIN "WageTakeoverProjectionEnvelope" envelope ON envelope."id" = revocation."envelopeId"
  WHERE envelope."atomicScopeVersionId" = NEW."atomicScopeVersionId"
    AND revocation."compensationReceiptId" = NEW."id"
    AND revocation."createdTransactionId" = txid_current();
  SELECT COUNT(*) INTO summary_ref_count
  FROM "HistoricalWageSummaryPayableRef"
  WHERE "atomicScopeVersionId" = NEW."atomicScopeVersionId";
  SELECT COUNT(*) INTO summary_revocation_count
  FROM "HistoricalWageSummaryPayableRefEligibilityRevocation" revocation
  JOIN "HistoricalWageSummaryPayableRef" ref ON ref."id" = revocation."summaryPayableRefId"
  WHERE ref."atomicScopeVersionId" = NEW."atomicScopeVersionId"
    AND revocation."compensationReceiptId" = NEW."id"
    AND revocation."createdTransactionId" = txid_current();

  IF NEW."status" <> 'compensated' OR NEW."createdTransactionId" <> txid_current() OR
     NEW."causesReceiptId" IS NULL OR mapping_count < 1 OR receipt_line_count <> mapping_count OR
     NOT EXISTS (
       SELECT 1
       FROM "OperatingTakeoverCommandReceipt" activation
       JOIN "OperatingTakeoverAtomicScopeVersion" scope
         ON scope."id" = NEW."atomicScopeVersionId"
       WHERE activation."id" = NEW."causesReceiptId"
         AND activation."atomicScopeVersionId" = NEW."atomicScopeVersionId"
         AND activation."action" = 'historical_wage_takeover.scope.activate'
         AND activation."status" = 'activated'
         AND activation."permissionSnapshotFingerprint" = scope."permissionSnapshotFingerprint"
         AND NEW."permissionSnapshotFingerprint" = scope."permissionSnapshotFingerprint"
         AND NEW."actorUserId" NOT IN (activation."actorUserId", COALESCE(activation."delegatorUserId", ''))
         AND (NEW."delegatorUserId" IS NULL OR
              NEW."delegatorUserId" NOT IN (activation."actorUserId", COALESCE(activation."delegatorUserId", '')))
     ) OR
     EXISTS (
       SELECT 1 FROM "OperatingTakeoverCommandReceipt" successor
       WHERE successor."causesReceiptId" = NEW."causesReceiptId"
         AND successor."id" <> NEW."id"
     ) OR
     envelope_revocation_count <> envelope_count OR summary_revocation_count <> summary_ref_count OR
     EXISTS (
       SELECT 1
       FROM "OperatingTakeoverRowMapping" mapping
       JOIN "OperatingTakeoverManifestVersion" manifest ON manifest."id" = mapping."manifestVersionId"
       WHERE manifest."atomicScopeVersionId" = NEW."atomicScopeVersionId"
         AND mapping."adapterKind" = 'historical_wage'
         AND NOT EXISTS (
           SELECT 1 FROM "OperatingTakeoverCommandReceiptLine" line
           WHERE line."receiptId" = NEW."id"
             AND line."rowMappingId" = mapping."id"
             AND line."projectId" = mapping."projectId"
             AND line."entryKind" = 'historical_wage'
             AND line."decision" = 'compensated'
             AND line."targetKind" IS NULL
             AND line."targetRef" IS NULL
         )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 补偿 receipt 必须在同一事务完整追加全部 A envelope/B ref 资格撤销，批次全有或全无';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION jg_pol219_require_historical_bridge_graph()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping_row "OperatingTakeoverRowMapping"%ROWTYPE;
  scope_id TEXT;
  attestation_count INTEGER;
  distinct_attester_count INTEGER;
  creditor_line_id TEXT;
BEGIN
  SELECT * INTO mapping_row FROM "OperatingTakeoverRowMapping" WHERE "id" = NEW."rowMappingId";
  IF mapping_row."adapterKind" <> 'historical_wage' THEN
    RETURN NULL;
  END IF;
  SELECT "atomicScopeVersionId" INTO scope_id
  FROM "OperatingTakeoverManifestVersion" WHERE "id" = mapping_row."manifestVersionId";
  IF (SELECT xmin::text::bigint FROM "OperatingTakeoverLegacySourceBridge" WHERE "id" = NEW."id") <> jg_pol219_current_xid32() OR scope_id IS NULL OR EXISTS (
    SELECT 1
    FROM "OperatingTakeoverRowMapping" scope_mapping
    JOIN "OperatingTakeoverManifestVersion" manifest ON manifest."id" = scope_mapping."manifestVersionId"
    WHERE manifest."atomicScopeVersionId" = scope_id
      AND scope_mapping."adapterKind" = 'historical_wage'
      AND ((SELECT COUNT(*) FROM "OperatingTakeoverLegacySourceBridge" bridge
            WHERE bridge."rowMappingId" = scope_mapping."id") <> 1 OR
           NOT EXISTS (
             SELECT 1 FROM "OperatingTakeoverLegacySourceBridge" bridge
             WHERE bridge."rowMappingId" = scope_mapping."id"
               AND bridge.xmin::text::bigint = jg_pol219_current_xid32()
           ))
  ) OR NOT EXISTS (
    SELECT 1
    FROM "OperatingTakeoverCommandReceipt" receipt
    JOIN "OperatingTakeoverCommandReceiptLine" line ON line."receiptId" = receipt."id"
    WHERE receipt."atomicScopeVersionId" = scope_id
      AND receipt."action" = 'historical_wage_takeover.scope.activate'
      AND receipt."status" = 'activated'
      AND receipt."createdTransactionId" = txid_current()
      AND line."rowMappingId" = mapping_row."id"
      AND line."decision" = NEW."mappingDecision"
      AND line."targetKind" = NEW."targetKind"
      AND line."targetRef" = NEW."targetRef"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'POL-219 所有 mapping、bridge、target 与 activate receipt 必须在同一 Serializable 批次全有或全无';
  END IF;

  IF mapping_row."evidenceLevel" = 'B' THEN
    SELECT COUNT(*), COUNT(DISTINCT "actorUserId")
      INTO attestation_count, distinct_attester_count
    FROM "HistoricalWageSummaryAuthorityAttestation"
    WHERE "authorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId";
    IF NEW."targetKind" <> 'historical_wage_summary_authority_version' OR
       NEW."targetRef" <> mapping_row."historicalWageSummaryAuthorityVersionId" OR
       attestation_count <> 2 OR distinct_attester_count <> 2 OR
       (SELECT COUNT(*) FROM "WageTakeoverLegacyImpactBridge" impact_bridge
        WHERE impact_bridge."summaryAuthorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId") <> 2 OR
       EXISTS (
         SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
         WHERE impact_bridge."summaryAuthorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId"
           AND (impact_bridge."envelopeId" IS NOT NULL OR
                impact_bridge."rowMappingId" <> mapping_row."id" OR
                impact_bridge."projectId" <> mapping_row."projectId" OR
                impact_bridge."direction" IS DISTINCT FROM mapping_row."legacySourceSnapshot"->>'direction' OR
                impact_bridge."amountCents" <> mapping_row."amountCents" OR
                impact_bridge."createdTransactionId" <> txid_current())
       ) OR
       NOT EXISTS (
         SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
         WHERE impact_bridge."summaryAuthorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId"
           AND impact_bridge."impactKind" = 'confirmed_cost'
       ) OR
       NOT EXISTS (
         SELECT 1 FROM "WageTakeoverLegacyImpactBridge" impact_bridge
         WHERE impact_bridge."summaryAuthorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId"
           AND impact_bridge."impactKind" = CASE
             WHEN mapping_row."legacySourceSnapshot"->>'direction' = 'increase' THEN 'payable_increase'
             ELSE 'payable_decrease'
           END
       ) OR
       NOT EXISTS (
         SELECT 1 FROM "HistoricalWageSummaryAuthorityCreditorLine"
         WHERE "authorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId"
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 B级激活必须具备两名有效确认人、完整快照/tombstone，且只为非零 signed delta 创建 ref';
    END IF;
    FOR creditor_line_id IN
      SELECT "id" FROM "HistoricalWageSummaryAuthorityCreditorLine"
      WHERE "authorityVersionId" = mapping_row."historicalWageSummaryAuthorityVersionId"
    LOOP
      PERFORM jg_pol219_assert_summary_target_closure(creditor_line_id, scope_id, mapping_row."id");
    END LOOP;
  ELSIF mapping_row."evidenceLevel" = 'C' THEN
    IF NEW."targetKind" <> 'unresolved_wage_payable_gap' OR NOT EXISTS (
      SELECT 1 FROM "UnresolvedWagePayableGap" gap
      WHERE gap."id" = NEW."targetRef"
        AND gap."rowMappingId" = mapping_row."id"
        AND gap."atomicScopeVersionId" = scope_id
        AND gap."manifestVersionId" = mapping_row."manifestVersionId"
        AND gap."projectId" = mapping_row."projectId"
        AND gap."sourceFingerprint" = mapping_row."sourceFingerprint"
        AND gap."createdTransactionId" = txid_current()
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'POL-219 C级激活只能在同一事务追加唯一 unresolved gap';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER jg_pol219_scope_project_guard BEFORE INSERT ON "OperatingTakeoverAtomicScopeProject"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_scope_project();
CREATE TRIGGER jg_pol219_scope_receipt_transaction_guard BEFORE INSERT ON "OperatingTakeoverCommandReceipt"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_bind_scope_receipt_transaction();
CREATE TRIGGER jg_pol219_wage_reservation_guard BEFORE INSERT ON "WageTakeoverWageStatementReservation"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_wage_reservation();
CREATE TRIGGER jg_pol219_historical_mapping_guard BEFORE INSERT ON "OperatingTakeoverRowMapping"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_historical_mapping();
CREATE TRIGGER jg_pol219_historical_bridge_guard BEFORE INSERT ON "OperatingTakeoverLegacySourceBridge"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_historical_bridge();
CREATE TRIGGER jg_pol219_historical_receipt_line_guard BEFORE INSERT ON "OperatingTakeoverCommandReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_historical_receipt_line();
CREATE TRIGGER jg_pol219_projection_envelope_guard BEFORE INSERT ON "WageTakeoverProjectionEnvelope"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_projection_envelope();
CREATE TRIGGER jg_pol219_legacy_impact_bridge_guard BEFORE INSERT ON "WageTakeoverLegacyImpactBridge"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_legacy_impact_bridge();
CREATE TRIGGER jg_pol219_operating_fact_projection_guard BEFORE INSERT ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_operating_projection();
CREATE TRIGGER jg_pol219_operating_impact_projection_guard BEFORE INSERT ON "OperatingImpactEntry"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_operating_projection();
CREATE TRIGGER jg_pol219_historical_wage_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "WageStatementVersion"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_guard_historical_wage_version();
CREATE CONSTRAINT TRIGGER jg_pol219_scope_reservation_final_guard
  AFTER INSERT ON "OperatingTakeoverAtomicScopeVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_scope_reservation();
CREATE TRIGGER jg_pol219_summary_category_guard BEFORE INSERT ON "HistoricalWageSummaryAuthorityVersion"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_category_exclusivity();
CREATE TRIGGER jg_pol219_summary_authority_lineage_guard BEFORE INSERT ON "HistoricalWageSummaryAuthorityVersion"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_authority_lineage();
CREATE TRIGGER jg_pol219_summary_creditor_line_guard BEFORE INSERT ON "HistoricalWageSummaryAuthorityCreditorLine"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_creditor_line();
CREATE TRIGGER jg_pol219_balance_reconciliation_guard BEFORE INSERT ON "HistoricalWageBalanceReconciliationVersion"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_balance_reconciliation();
CREATE TRIGGER jg_pol219_summary_payment_link_guard BEFORE INSERT ON "HistoricalWageSummaryPaymentExecutionLink"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_payment_link();
CREATE TRIGGER jg_pol219_summary_payable_transaction_guard BEFORE INSERT ON "HistoricalWageSummaryPayableRef"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_bind_created_transaction();
CREATE TRIGGER jg_pol219_gap_transaction_guard BEFORE INSERT ON "UnresolvedWagePayableGap"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_bind_created_transaction();
CREATE TRIGGER jg_pol219_envelope_revocation_guard BEFORE INSERT ON "WageTakeoverProjectionEnvelopeEligibilityRevocation"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_eligibility_revocation();
CREATE TRIGGER jg_pol219_summary_revocation_guard BEFORE INSERT ON "HistoricalWageSummaryPayableRefEligibilityRevocation"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_eligibility_revocation();
CREATE TRIGGER jg_pol219_summary_attestation_guard BEFORE INSERT ON "HistoricalWageSummaryAuthorityAttestation"
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_attestation();
CREATE CONSTRAINT TRIGGER jg_pol219_summary_authority_attestation_guard
  AFTER INSERT ON "HistoricalWageSummaryAuthorityVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_summary_authority_attestation();
CREATE CONSTRAINT TRIGGER jg_pol219_summary_authority_creditor_closure_guard
  AFTER INSERT ON "HistoricalWageSummaryAuthorityVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_summary_creditor_closure();
CREATE CONSTRAINT TRIGGER jg_pol219_summary_creditor_line_closure_guard
  AFTER INSERT ON "HistoricalWageSummaryAuthorityCreditorLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_summary_creditor_closure();
CREATE CONSTRAINT TRIGGER jg_pol219_summary_payable_target_guard
  AFTER INSERT ON "HistoricalWageSummaryPayableRef"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_validate_summary_payable_target();
CREATE CONSTRAINT TRIGGER jg_pol219_historical_wage_version_final_guard
  AFTER INSERT OR UPDATE ON "WageStatementVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_historical_activation_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_reserved_statement_owner_guard
  AFTER INSERT OR UPDATE OF "currentRevision" ON "WageStatement"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_reserved_statement_owner();
CREATE CONSTRAINT TRIGGER jg_pol219_projection_envelope_final_guard
  AFTER INSERT ON "WageTakeoverProjectionEnvelope"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_historical_activation_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_projection_envelope_cost_final_guard
  AFTER INSERT ON "WageTakeoverProjectionEnvelopeCostCell"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_historical_activation_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_projection_envelope_payable_final_guard
  AFTER INSERT ON "WageTakeoverProjectionEnvelopePayableRef"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_historical_activation_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_historical_bridge_final_guard
  AFTER INSERT ON "OperatingTakeoverLegacySourceBridge"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_historical_bridge_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_compensation_coverage_final_guard
  AFTER INSERT ON "OperatingTakeoverCommandReceipt"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_compensation_coverage();
CREATE CONSTRAINT TRIGGER jg_pol219_envelope_target_graph_final_guard
  AFTER INSERT ON "WageTakeoverProjectionEnvelope"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_impact_bridge_target_graph_final_guard
  AFTER INSERT ON "WageTakeoverLegacyImpactBridge"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_balance_target_graph_final_guard
  AFTER INSERT ON "HistoricalWageBalanceReconciliationVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_payment_target_graph_final_guard
  AFTER INSERT ON "HistoricalWageSummaryPaymentExecutionLink"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_summary_ref_target_graph_final_guard
  AFTER INSERT ON "HistoricalWageSummaryPayableRef"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();
CREATE CONSTRAINT TRIGGER jg_pol219_gap_target_graph_final_guard
  AFTER INSERT ON "UnresolvedWagePayableGap"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION jg_pol219_require_materialized_target_graph();

CREATE TRIGGER jg_pol219_scope_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverAtomicScopeVersion" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_wage_reservation_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverWageStatementReservation" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_scope_project_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverAtomicScopeProject" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_authority_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryAuthorityVersion" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_creditor_line_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryAuthorityCreditorLine" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_payable_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryPayableRef" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_balance_reconciliation_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageBalanceReconciliationVersion" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_payment_link_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryPaymentExecutionLink" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_ref_revocation_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryPayableRefEligibilityRevocation" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_gap_append_only BEFORE UPDATE OR DELETE ON "UnresolvedWagePayableGap" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverProjectionEnvelope" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_payable_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverProjectionEnvelopePayableRef" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_cost_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverProjectionEnvelopeCostCell" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_revocation_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverProjectionEnvelopeEligibilityRevocation" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_attestation_append_only BEFORE UPDATE OR DELETE ON "HistoricalWageSummaryAuthorityAttestation" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_legacy_impact_bridge_append_only BEFORE UPDATE OR DELETE ON "WageTakeoverLegacyImpactBridge" FOR EACH ROW EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();

CREATE TRIGGER jg_pol219_scope_no_truncate BEFORE TRUNCATE ON "OperatingTakeoverAtomicScopeVersion" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_reservation_no_truncate BEFORE TRUNCATE ON "WageTakeoverWageStatementReservation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_scope_project_no_truncate BEFORE TRUNCATE ON "OperatingTakeoverAtomicScopeProject" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_authority_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryAuthorityVersion" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_line_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryAuthorityCreditorLine" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_balance_no_truncate BEFORE TRUNCATE ON "HistoricalWageBalanceReconciliationVersion" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_ref_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryPayableRef" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_payment_link_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryPaymentExecutionLink" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_summary_revocation_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryPayableRefEligibilityRevocation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_gap_no_truncate BEFORE TRUNCATE ON "UnresolvedWagePayableGap" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_no_truncate BEFORE TRUNCATE ON "WageTakeoverProjectionEnvelope" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_payable_no_truncate BEFORE TRUNCATE ON "WageTakeoverProjectionEnvelopePayableRef" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_cost_no_truncate BEFORE TRUNCATE ON "WageTakeoverProjectionEnvelopeCostCell" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_impact_bridge_no_truncate BEFORE TRUNCATE ON "WageTakeoverLegacyImpactBridge" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_envelope_revocation_no_truncate BEFORE TRUNCATE ON "WageTakeoverProjectionEnvelopeEligibilityRevocation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();
CREATE TRIGGER jg_pol219_attestation_no_truncate BEFORE TRUNCATE ON "HistoricalWageSummaryAuthorityAttestation" FOR EACH STATEMENT EXECUTE FUNCTION jg_pol219_reject_historical_wage_mutation();

COMMIT;
