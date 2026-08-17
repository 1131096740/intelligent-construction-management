CREATE TABLE "OperatingFact" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceBusinessCode" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "affiliateAssignmentId" TEXT NOT NULL,
  "affiliateBusinessPartyVersionId" TEXT NOT NULL,
  "affiliateNameSnapshot" TEXT NOT NULL,
  "affiliateCreditCodeSnapshot" TEXT,
  "operatingLedgerEffectiveDateSnapshot" DATE NOT NULL,
  "isBeforeOperatingLedgerEffectiveDate" BOOLEAN NOT NULL,
  "historicalTakeoverBatchId" TEXT,
  "factKind" TEXT NOT NULL,
  "operatingLevel" TEXT NOT NULL,
  "evidenceLevel" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "direction" TEXT NOT NULL,
  "debtorSubjectKind" TEXT,
  "debtorSubjectId" TEXT,
  "creditorSubjectKind" TEXT,
  "creditorSubjectId" TEXT,
  "approvedPayerSubjectKind" TEXT,
  "approvedPayerSubjectId" TEXT,
  "actualPayerSubjectKind" TEXT,
  "actualPayerSubjectId" TEXT,
  "payeeSubjectKind" TEXT,
  "payeeSubjectId" TEXT,
  "costBearingCompanySubjectKind" TEXT,
  "costBearingCompanySubjectId" TEXT,
  "subjectSnapshot" JSONB NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "basisSnapshot" JSONB,
  "entryKind" TEXT NOT NULL DEFAULT 'original',
  "adjustsFactId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OperatingFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingFact_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingFact_affiliateAssignmentId_fkey"
    FOREIGN KEY ("affiliateAssignmentId") REFERENCES "ProjectAffiliateAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingFact_adjustsFactId_fkey"
    FOREIGN KEY ("adjustsFactId") REFERENCES "OperatingFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingFact_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingFact_confirmedByUserId_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingFact_source_text_check"
    CHECK (btrim("sourceType") <> '' AND btrim("sourceBusinessId") <> '' AND btrim("sourceBusinessCode") <> ''),
  CONSTRAINT "OperatingFact_source_version_check"
    CHECK ("sourceVersion" > 0),
  CONSTRAINT "OperatingFact_amount_cents_check"
    CHECK ("amountCents" >= 0),
  CONSTRAINT "OperatingFact_currency_code_check"
    CHECK ("currencyCode" ~ '^[A-Z]{3}$'),
  CONSTRAINT "OperatingFact_direction_check"
    CHECK ("direction" IN ('inflow', 'outflow', 'neutral')),
  CONSTRAINT "OperatingFact_fact_kind_check"
    CHECK ("factKind" IN (
      'owner_settlement', 'owner_payment', 'downstream_settlement', 'downstream_payment',
      'expense', 'employee_loan', 'project_wage', 'construction_enterprise_deduction',
      'invoice', 'fund_movement', 'profit_distribution', 'historical_gap'
    )),
  CONSTRAINT "OperatingFact_operating_level_check"
    CHECK ("operatingLevel" IN ('project', 'construction_enterprise', 'participating_company', 'inter_subject')),
  CONSTRAINT "OperatingFact_evidence_level_check"
    CHECK ("evidenceLevel" IN ('A', 'B', 'C')),
  CONSTRAINT "OperatingFact_evidence_gap_check"
    CHECK (("evidenceLevel" = 'C') = ("factKind" = 'historical_gap')),
  CONSTRAINT "OperatingFact_subject_kind_check"
    CHECK (
      (("debtorSubjectKind" IS NULL) = ("debtorSubjectId" IS NULL)) AND
      (("creditorSubjectKind" IS NULL) = ("creditorSubjectId" IS NULL)) AND
      (("approvedPayerSubjectKind" IS NULL) = ("approvedPayerSubjectId" IS NULL)) AND
      (("actualPayerSubjectKind" IS NULL) = ("actualPayerSubjectId" IS NULL)) AND
      (("payeeSubjectKind" IS NULL) = ("payeeSubjectId" IS NULL)) AND
      (("costBearingCompanySubjectKind" IS NULL) = ("costBearingCompanySubjectId" IS NULL)) AND
      COALESCE("debtorSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("creditorSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("approvedPayerSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("actualPayerSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("payeeSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("costBearingCompanySubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE)
    ),
  CONSTRAINT "OperatingFact_supported_subject_check"
    CHECK (
      COALESCE("debtorSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("creditorSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("approvedPayerSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("actualPayerSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("payeeSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("costBearingCompanySubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE)
    ),
  CONSTRAINT "OperatingFact_amount_kind_check"
    CHECK ("factKind" = 'historical_gap' OR "amountCents" > 0),
  CONSTRAINT "OperatingFact_subject_snapshot_check"
    CHECK (jsonb_typeof("subjectSnapshot") = 'object'),
  CONSTRAINT "OperatingFact_entry_kind_check"
    CHECK (("entryKind" = 'original' AND "adjustsFactId" IS NULL) OR ("entryKind" IN ('correction', 'reversal') AND "adjustsFactId" IS NOT NULL)),
  CONSTRAINT "OperatingFact_status_check"
    CHECK ("status" = 'confirmed')
);

CREATE UNIQUE INDEX "OperatingFact_sourceType_sourceBusinessId_key"
  ON "OperatingFact"("sourceType", "sourceBusinessId");
CREATE UNIQUE INDEX "OperatingFact_idempotencyKey_key"
  ON "OperatingFact"("idempotencyKey");
CREATE UNIQUE INDEX "OperatingFact_id_projectId_key"
  ON "OperatingFact"("id", "projectId");
CREATE INDEX "OperatingFact_projectId_occurredAt_idx"
  ON "OperatingFact"("projectId", "occurredAt");
CREATE INDEX "OperatingFact_projectId_status_occurredAt_idx"
  ON "OperatingFact"("projectId", "status", "occurredAt");
CREATE INDEX "OperatingFact_adjustsFactId_idx"
  ON "OperatingFact"("adjustsFactId");
CREATE INDEX "OperatingFact_affiliateAssignmentId_idx"
  ON "OperatingFact"("affiliateAssignmentId");
CREATE INDEX "OperatingFact_historicalTakeoverBatchId_idx"
  ON "OperatingFact"("historicalTakeoverBatchId");

CREATE TABLE "OperatingImpactEntry" (
  "id" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceImpactKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "impactKind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "subjectRole" TEXT,
  "subjectKind" TEXT,
  "subjectId" TEXT,
  "costCategoryCode" TEXT,
  "fundPurpose" TEXT,
  "description" TEXT,
  "impactSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OperatingImpactEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperatingImpactEntry_fact_project_fkey"
    FOREIGN KEY ("factId", "projectId") REFERENCES "OperatingFact"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatingImpactEntry_source_text_check"
    CHECK (btrim("sourceType") <> '' AND btrim("sourceBusinessId") <> '' AND btrim("sourceImpactKey") <> ''),
  CONSTRAINT "OperatingImpactEntry_amount_cents_check"
    CHECK ("amountCents" >= 0),
  CONSTRAINT "OperatingImpactEntry_impact_kind_check"
    CHECK ("impactKind" IN (
      'confirmed_income', 'confirmed_cost', 'estimated_clearing_expense',
      'receivable_increase', 'receivable_decrease', 'payable_increase', 'payable_decrease',
      'construction_enterprise_funds_increase', 'construction_enterprise_funds_decrease',
      'construction_enterprise_funds_freeze', 'construction_enterprise_funds_release',
      'company_project_funds_increase', 'company_project_funds_decrease',
      'company_advance_for_project_increase', 'company_advance_for_project_decrease',
      'company_returnable_to_project_increase', 'company_returnable_to_project_decrease',
      'inter_subject_balance_increase', 'inter_subject_balance_decrease',
      'temporary_profit_distribution', 'final_profit_distribution',
      'profit_distribution_adjustment', 'evidence_gap_notice'
    )),
  CONSTRAINT "OperatingImpactEntry_amount_kind_check"
    CHECK ("impactKind" = 'evidence_gap_notice' OR "amountCents" > 0),
  CONSTRAINT "OperatingImpactEntry_direction_check"
    CHECK ("direction" IN ('increase', 'decrease', 'notice')),
  CONSTRAINT "OperatingImpactEntry_gap_direction_check"
    CHECK ("impactKind" <> 'evidence_gap_notice' OR "direction" = 'notice'),
  CONSTRAINT "OperatingImpactEntry_subject_check"
    CHECK (
      ("subjectRole" IS NULL OR "subjectRole" IN ('debtor', 'creditor', 'approved_payer', 'actual_payer', 'payee', 'cost_bearing_company')) AND
      ("subjectRole" IS NULL OR "subjectKind" IS NOT NULL) AND
      (("subjectKind" IS NULL) = ("subjectId" IS NULL)) AND
      COALESCE("subjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE)
    ),
  CONSTRAINT "OperatingImpactEntry_supported_subject_check"
    CHECK ("subjectKind" IS NULL OR "subjectKind" IN ('construction_enterprise', 'participating_company')),
  CONSTRAINT "OperatingImpactEntry_cost_category_check"
    CHECK ("costCategoryCode" IS NULL OR "costCategoryCode" IN (
      'material', 'crew_and_labor', 'professional_subcontract', 'machinery_and_rental',
      'site_construction_and_measures', 'project_daily_expense',
      'construction_enterprise_deduction', 'other_project_cost'
    )),
  CONSTRAINT "OperatingImpactEntry_profit_subject_check"
    CHECK (
      "impactKind" NOT IN ('temporary_profit_distribution', 'final_profit_distribution', 'profit_distribution_adjustment')
      OR "subjectKind" = 'participating_company'
    ),
  CONSTRAINT "OperatingImpactEntry_cost_category_required_check"
    CHECK (
      "impactKind" NOT IN ('confirmed_cost', 'estimated_clearing_expense')
      OR "costCategoryCode" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "OperatingImpactEntry_factId_sourceImpactKey_key"
  ON "OperatingImpactEntry"("factId", "sourceImpactKey");
CREATE UNIQUE INDEX "OperatingImpactEntry_source_impact_key"
  ON "OperatingImpactEntry"("sourceType", "sourceBusinessId", "sourceImpactKey");
CREATE UNIQUE INDEX "OperatingImpactEntry_idempotencyKey_key"
  ON "OperatingImpactEntry"("idempotencyKey");
CREATE INDEX "OperatingImpactEntry_projectId_impactKind_createdAt_idx"
  ON "OperatingImpactEntry"("projectId", "impactKind", "createdAt");
CREATE INDEX "OperatingImpactEntry_factId_idx"
  ON "OperatingImpactEntry"("factId");

CREATE OR REPLACE FUNCTION "validateOperatingFactReferences"()
RETURNS TRIGGER AS $$
DECLARE
  project_effective_date DATE;
  project_is_active BOOLEAN;
  assignment_version_id TEXT;
  assignment_name TEXT;
  assignment_credit_code TEXT;
  candidate_company_id TEXT;
  candidate_subject JSONB;
  candidate_subject_role TEXT;
BEGIN
  SELECT "operatingLedgerEffectiveDate", "isActive"
    INTO project_effective_date, project_is_active
    FROM "Project"
    WHERE "id" = NEW."projectId"
    FOR UPDATE;
  IF project_is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '项目不存在或已停用，不能登记正式经营事实' USING ERRCODE = '23514';
  END IF;
  IF project_effective_date IS NULL THEN
    RAISE EXCEPTION '项目尚未启用经营账，不能登记正式经营事实' USING ERRCODE = '23514';
  END IF;
  IF NEW."operatingLedgerEffectiveDateSnapshot" IS DISTINCT FROM project_effective_date
     OR NEW."isBeforeOperatingLedgerEffectiveDate" IS DISTINCT FROM (NEW."occurredAt"::DATE < project_effective_date) THEN
    RAISE EXCEPTION '经营事实的经营账生效日快照不一致' USING ERRCODE = '23514';
  END IF;
  FOREACH candidate_subject IN ARRAY ARRAY[
    CASE WHEN NEW."debtorSubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'debtor', 'kind', NEW."debtorSubjectKind", 'id', NEW."debtorSubjectId") ELSE NULL END,
    CASE WHEN NEW."creditorSubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'creditor', 'kind', NEW."creditorSubjectKind", 'id', NEW."creditorSubjectId") ELSE NULL END,
    CASE WHEN NEW."approvedPayerSubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'approvedPayer', 'kind', NEW."approvedPayerSubjectKind", 'id', NEW."approvedPayerSubjectId") ELSE NULL END,
    CASE WHEN NEW."actualPayerSubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'actualPayer', 'kind', NEW."actualPayerSubjectKind", 'id', NEW."actualPayerSubjectId") ELSE NULL END,
    CASE WHEN NEW."payeeSubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'payee', 'kind', NEW."payeeSubjectKind", 'id', NEW."payeeSubjectId") ELSE NULL END,
    CASE WHEN NEW."costBearingCompanySubjectKind" IS NOT NULL THEN jsonb_build_object('role', 'costBearingCompany', 'kind', NEW."costBearingCompanySubjectKind", 'id', NEW."costBearingCompanySubjectId") ELSE NULL END
  ]::JSONB[] LOOP
    IF candidate_subject IS NULL THEN CONTINUE; END IF;
    IF candidate_subject->>'kind' NOT IN ('construction_enterprise', 'participating_company') THEN
      RAISE EXCEPTION '当前经营账尚未接入该主体种类，不能登记正式事实' USING ERRCODE = '23514';
    END IF;
    candidate_subject_role := candidate_subject->>'role';
    IF NEW."subjectSnapshot"->candidate_subject_role IS NULL
       OR NEW."subjectSnapshot"->candidate_subject_role->>'kind' IS DISTINCT FROM candidate_subject->>'kind'
       OR NEW."subjectSnapshot"->candidate_subject_role->>'id' IS DISTINCT FROM candidate_subject->>'id' THEN
      RAISE EXCEPTION '经营事实主体快照必须与主体字段一致' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT "businessPartyVersionId", "affiliateNameSnapshot", "affiliateCreditCodeSnapshot"
    INTO assignment_version_id, assignment_name, assignment_credit_code
    FROM "ProjectAffiliateAssignment"
    WHERE "id" = NEW."affiliateAssignmentId"
      AND "projectId" = NEW."projectId"
      AND "effectiveFrom" <= NEW."occurredAt"::DATE
      AND ("endedAt" IS NULL OR "endedAt" > NEW."occurredAt"::DATE)
    FOR KEY SHARE;
  IF assignment_version_id IS NULL
     OR assignment_version_id <> NEW."affiliateBusinessPartyVersionId"
     OR assignment_name IS DISTINCT FROM NEW."affiliateNameSnapshot"
     OR assignment_credit_code IS DISTINCT FROM NEW."affiliateCreditCodeSnapshot" THEN
    RAISE EXCEPTION '正式经营事实引用的施工企业已失效' USING ERRCODE = '23514';
  END IF;

  FOREACH candidate_company_id IN ARRAY ARRAY[
    CASE WHEN NEW."debtorSubjectKind" = 'participating_company' THEN NEW."debtorSubjectId" ELSE NULL END,
    CASE WHEN NEW."creditorSubjectKind" = 'participating_company' THEN NEW."creditorSubjectId" ELSE NULL END,
    CASE WHEN NEW."approvedPayerSubjectKind" = 'participating_company' THEN NEW."approvedPayerSubjectId" ELSE NULL END,
    CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN NEW."actualPayerSubjectId" ELSE NULL END,
    CASE WHEN NEW."payeeSubjectKind" = 'participating_company' THEN NEW."payeeSubjectId" ELSE NULL END,
    CASE WHEN NEW."costBearingCompanySubjectKind" = 'participating_company' THEN NEW."costBearingCompanySubjectId" ELSE NULL END
  ]::TEXT[] LOOP
    IF candidate_company_id IS NULL THEN CONTINUE; END IF;
    PERFORM 1
      FROM "ProjectParticipatingCompany"
      WHERE "projectId" = NEW."projectId"
        AND ("companyEntityId" = candidate_company_id OR "companyEntityVersionId" = candidate_company_id)
        AND "effectiveFrom" <= NEW."occurredAt"::DATE
        AND ("endedAt" IS NULL OR "endedAt" > NEW."occurredAt"::DATE)
      FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '经营事实引用的我方公司未在本项目事实日参与' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NEW."adjustsFactId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "OperatingFact" original
    WHERE original."id" = NEW."adjustsFactId"
      AND original."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION '更正或冲销只能引用同一项目的经营事实' USING ERRCODE = '23514';
  END IF;
  IF current_setting('app.operating_ledger_actor', true) IS DISTINCT FROM NEW."recordedByUserId" THEN
    RAISE EXCEPTION '正式经营事实必须通过已授权的经营账服务登记' USING ERRCODE = '42501';
  END IF;
  IF NEW."factKind" IN ('owner_settlement', 'downstream_settlement')
     AND (NEW."debtorSubjectKind" IS NULL OR NEW."creditorSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '结算事实必须填写债务主体和债权主体' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" IN ('owner_payment', 'downstream_payment', 'fund_movement')
     AND (NEW."actualPayerSubjectKind" IS NULL OR NEW."payeeSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '付款或资金事实必须填写实际付款主体和收款主体' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" = 'expense' AND NEW."costBearingCompanySubjectKind" IS NULL THEN
    RAISE EXCEPTION '费用事实必须填写成本承担公司' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" = 'employee_loan'
     AND (NEW."debtorSubjectKind" IS NULL OR NEW."creditorSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '员工借款事实必须填写债务主体和债权主体' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" = 'project_wage'
     AND (NEW."costBearingCompanySubjectKind" IS NULL OR NEW."payeeSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '工资事实必须填写成本承担公司和收款主体' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" = 'construction_enterprise_deduction'
     AND NEW."costBearingCompanySubjectKind" IS NULL THEN
    RAISE EXCEPTION '施工企业扣费事实必须填写成本承担公司' USING ERRCODE = '23514';
  END IF;
  IF NEW."factKind" = 'invoice' AND NEW."payeeSubjectKind" IS NULL THEN
    RAISE EXCEPTION '发票事实必须填写收款主体' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatingFact_validate_references"
  BEFORE INSERT ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION "validateOperatingFactReferences"();

CREATE OR REPLACE FUNCTION "lockProjectFromOperatingFact"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."evidenceLevel" <> 'C' THEN
    UPDATE "Project"
    SET "constructionEnterpriseLockedAt" = COALESCE(
      "constructionEnterpriseLockedAt",
      CURRENT_TIMESTAMP
    )
    WHERE "id" = NEW."projectId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatingFact_lock_construction_enterprise"
  AFTER INSERT ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectFromOperatingFact"();

CREATE OR REPLACE FUNCTION "validateOperatingImpactEntryReferences"()
RETURNS TRIGGER AS $$
DECLARE
  fact_occurred_at TIMESTAMP(3);
  fact_affiliate_assignment_id TEXT;
  fact_affiliate_version_id TEXT;
  fact_evidence_level TEXT;
  fact_entry_kind TEXT;
  fact_adjusts_fact_id TEXT;
  fact_recorded_by_user_id TEXT;
  original_impact_kind TEXT;
  original_impact_amount BIGINT;
  original_impact_direction TEXT;
  original_subject_role TEXT;
  original_subject_kind TEXT;
  original_subject_id TEXT;
  original_cost_category_code TEXT;
  original_fund_purpose TEXT;
  original_impact_snapshot JSONB;
BEGIN
  SELECT fact."occurredAt", fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId",
         fact."evidenceLevel", fact."entryKind", fact."adjustsFactId", fact."recordedByUserId"
    INTO fact_occurred_at, fact_affiliate_assignment_id, fact_affiliate_version_id,
         fact_evidence_level, fact_entry_kind, fact_adjusts_fact_id, fact_recorded_by_user_id
    FROM "OperatingFact" fact
    WHERE fact."id" = NEW."factId"
      AND fact."projectId" = NEW."projectId"
      AND fact."sourceType" = NEW."sourceType"
      AND fact."sourceBusinessId" = NEW."sourceBusinessId";
  IF fact_occurred_at IS NULL THEN
    RAISE EXCEPTION '影响分录必须引用同一项目、同一来源的经营事实' USING ERRCODE = '23514';
  END IF;
  IF fact_evidence_level = 'C' AND NEW."impactKind" <> 'evidence_gap_notice' THEN
    RAISE EXCEPTION 'C级证据只能登记缺口提示，不能产生正式经营影响' USING ERRCODE = '23514';
  END IF;
  IF NEW."subjectKind" IS NOT NULL
     AND NEW."subjectKind" NOT IN ('construction_enterprise', 'participating_company') THEN
    RAISE EXCEPTION '当前经营账尚未接入该影响主体种类，不能登记正式分录' USING ERRCODE = '23514';
  END IF;
  IF NEW."subjectKind" = 'construction_enterprise' AND NOT EXISTS (
    SELECT 1
    FROM "ProjectAffiliateAssignment" assignment
    WHERE assignment."id" = fact_affiliate_assignment_id
      AND assignment."projectId" = NEW."projectId"
      AND assignment."businessPartyVersionId" = fact_affiliate_version_id
      AND (NEW."subjectId" = assignment."businessPartyId" OR NEW."subjectId" = assignment."businessPartyVersionId")
      AND assignment."effectiveFrom" <= fact_occurred_at::DATE
      AND (assignment."endedAt" IS NULL OR assignment."endedAt" > fact_occurred_at::DATE)
  ) THEN
    RAISE EXCEPTION '影响分录引用的施工企业在事实日无效' USING ERRCODE = '23514';
  END IF;
  IF NEW."subjectKind" = 'participating_company' AND NOT EXISTS (
    SELECT 1
    FROM "ProjectParticipatingCompany" participant
    WHERE participant."projectId" = NEW."projectId"
      AND (NEW."subjectId" = participant."companyEntityId" OR NEW."subjectId" = participant."companyEntityVersionId")
      AND participant."effectiveFrom" <= fact_occurred_at::DATE
      AND (participant."endedAt" IS NULL OR participant."endedAt" > fact_occurred_at::DATE)
  ) THEN
    RAISE EXCEPTION '影响分录引用的我方公司未在本项目事实日参与' USING ERRCODE = '23514';
  END IF;
  IF fact_entry_kind = 'reversal' THEN
    SELECT original_impact."impactKind", original_impact."amountCents", original_impact."direction",
           original_impact."subjectRole", original_impact."subjectKind", original_impact."subjectId",
           original_impact."costCategoryCode", original_impact."fundPurpose", original_impact."impactSnapshot"
      INTO original_impact_kind, original_impact_amount, original_impact_direction,
           original_subject_role, original_subject_kind, original_subject_id,
           original_cost_category_code, original_fund_purpose, original_impact_snapshot
      FROM "OperatingImpactEntry" original_impact
      WHERE original_impact."factId" = fact_adjusts_fact_id
        AND original_impact."sourceImpactKey" = NEW."sourceImpactKey";
    IF NOT FOUND THEN
      RAISE EXCEPTION '冲销必须逐笔引用原经营影响分录' USING ERRCODE = '23514';
    END IF;
    IF original_impact_kind <> NEW."impactKind"
       OR original_impact_amount <> NEW."amountCents"
       OR (
         (original_impact_direction = 'increase' AND NEW."direction" <> 'decrease') OR
         (original_impact_direction = 'decrease' AND NEW."direction" <> 'increase') OR
         (original_impact_direction = 'notice' AND NEW."direction" <> 'notice')
       ) OR original_subject_role IS DISTINCT FROM NEW."subjectRole"
       OR original_subject_kind IS DISTINCT FROM NEW."subjectKind"
       OR original_subject_id IS DISTINCT FROM NEW."subjectId"
       OR original_cost_category_code IS DISTINCT FROM NEW."costCategoryCode"
       OR original_fund_purpose IS DISTINCT FROM NEW."fundPurpose"
       OR original_impact_snapshot IS DISTINCT FROM NEW."impactSnapshot" THEN
      RAISE EXCEPTION '冲销分录必须使用原分录金额并登记反向影响' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF current_setting('app.operating_ledger_actor', true) IS DISTINCT FROM fact_recorded_by_user_id THEN
    RAISE EXCEPTION '正式经营影响必须通过已授权的经营账服务登记' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatingImpactEntry_validate_references"
  BEFORE INSERT ON "OperatingImpactEntry"
  FOR EACH ROW EXECUTE FUNCTION "validateOperatingImpactEntryReferences"();

CREATE OR REPLACE FUNCTION "validateOperatingReversalImpactSet"()
RETURNS TRIGGER AS $$
DECLARE
  original_impact_count BIGINT;
  reversal_impact_count BIGINT;
BEGIN
  IF NEW."entryKind" <> 'reversal' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "OperatingFact" other
    WHERE other."adjustsFactId" = NEW."adjustsFactId"
      AND other."entryKind" = 'reversal'
      AND other."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION '同一原经营事实不允许重复冲销' USING ERRCODE = '23514';
  END IF;
  SELECT COUNT(*)::BIGINT
    INTO original_impact_count
    FROM "OperatingImpactEntry"
    WHERE "factId" = NEW."adjustsFactId";
  SELECT COUNT(*)::BIGINT
    INTO reversal_impact_count
    FROM "OperatingImpactEntry"
    WHERE "factId" = NEW."id";
  IF original_impact_count <> reversal_impact_count
     OR EXISTS (
       SELECT 1
       FROM "OperatingImpactEntry" original_impact
       WHERE original_impact."factId" = NEW."adjustsFactId"
         AND NOT EXISTS (
           SELECT 1
           FROM "OperatingImpactEntry" reversal_impact
           WHERE reversal_impact."factId" = NEW."id"
             AND reversal_impact."sourceImpactKey" = original_impact."sourceImpactKey"
         )
     ) THEN
    RAISE EXCEPTION '冲销必须覆盖原经营事实的全部影响分录' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "OperatingFact_reversal_impact_set"
  AFTER INSERT ON "OperatingFact"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validateOperatingReversalImpactSet"();

CREATE OR REPLACE FUNCTION "protectOperatingLedgerAppendOnly"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '正式经营账只允许追加，不能修改或删除原记录' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatingFact_append_only"
  BEFORE UPDATE OR DELETE ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION "protectOperatingLedgerAppendOnly"();
CREATE TRIGGER "OperatingFact_append_only_truncate"
  BEFORE TRUNCATE ON "OperatingFact"
  FOR EACH STATEMENT EXECUTE FUNCTION "protectOperatingLedgerAppendOnly"();
CREATE TRIGGER "OperatingImpactEntry_append_only"
  BEFORE UPDATE OR DELETE ON "OperatingImpactEntry"
  FOR EACH ROW EXECUTE FUNCTION "protectOperatingLedgerAppendOnly"();
CREATE TRIGGER "OperatingImpactEntry_append_only_truncate"
  BEFORE TRUNCATE ON "OperatingImpactEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION "protectOperatingLedgerAppendOnly"();
