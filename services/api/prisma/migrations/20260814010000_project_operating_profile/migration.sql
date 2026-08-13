ALTER TABLE "Project"
  ADD COLUMN "operatingLedgerEffectiveDate" DATE,
  ADD COLUMN "takeoverCompletedDate" DATE,
  ADD COLUMN "takeoverStatus" TEXT NOT NULL DEFAULT 'preparing',
  ADD COLUMN "constructionEnterpriseLockedAt" TIMESTAMP(3);

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_takeover_status_check"
  CHECK ("takeoverStatus" IN (
    'preparing',
    'operating_with_takeover',
    'balance_review',
    'takeover_completed',
    'supplemental_review'
  ));

CREATE TABLE "ProjectParticipatingCompany" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityVersionId" TEXT NOT NULL,
  "companyNameSnapshot" TEXT NOT NULL,
  "companyCreditCodeSnapshot" TEXT,
  "effectiveFrom" DATE NOT NULL,
  "endedAt" DATE,
  "changeReason" TEXT NOT NULL,
  "addedByUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectParticipatingCompany_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectParticipatingCompany_effective_period_check"
    CHECK ("endedAt" IS NULL OR "endedAt" >= "effectiveFrom"),
  CONSTRAINT "ProjectParticipatingCompany_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectParticipatingCompany_companyEntityId_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectParticipatingCompany_companyEntityVersionId_fkey"
    FOREIGN KEY ("companyEntityVersionId") REFERENCES "CompanyEntityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectParticipatingCompany_addedByUserId_fkey"
    FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectParticipatingCompany_endedByUserId_fkey"
    FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProjectParticipatingCompany_projectId_effectiveFrom_idx"
  ON "ProjectParticipatingCompany"("projectId", "effectiveFrom");
CREATE INDEX "ProjectParticipatingCompany_companyEntityId_idx"
  ON "ProjectParticipatingCompany"("companyEntityId");
CREATE INDEX "ProjectParticipatingCompany_companyEntityVersionId_idx"
  ON "ProjectParticipatingCompany"("companyEntityVersionId");
CREATE UNIQUE INDEX "ProjectParticipatingCompany_one_active_per_project_company"
  ON "ProjectParticipatingCompany"("projectId", "companyEntityId")
  WHERE "endedAt" IS NULL;

CREATE OR REPLACE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"()
RETURNS TRIGGER AS $$
DECLARE
  target_project_id TEXT;
  target_assignment_id TEXT;
  target_assignment_version_id TEXT;
  current_assignment_id TEXT;
  current_assignment_version_id TEXT;
  operating_ledger_effective_date DATE;
  candidate_fact_date DATE;
BEGIN
  IF TG_TABLE_NAME = 'ContractVersion' THEN
    IF NEW."status" <> 'effective' THEN
      RETURN NEW;
    END IF;
    SELECT contract."projectId"
      INTO target_project_id
      FROM "Contract" contract
      WHERE contract."id" = NEW."contractId";
  ELSIF TG_TABLE_NAME = 'Settlement' THEN
    IF NEW."status" <> 'effective' THEN
      RETURN NEW;
    END IF;
    target_project_id := NEW."projectId";
  ELSIF TG_TABLE_NAME = 'ProjectProxyPayment' THEN
    IF NEW."voidedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    target_project_id := NEW."projectId";
  ELSIF TG_TABLE_NAME = 'ProjectReceipt' THEN
    IF NEW."voidedAt" IS NOT NULL THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
  ELSIF TG_TABLE_NAME = 'ProjectExpenseExecution' OR TG_TABLE_NAME = 'PaymentExecutionAllocation' THEN
    target_project_id := NEW."projectId";
  ELSIF TG_TABLE_NAME = 'ExpenseClaim' THEN
    IF NEW."projectId" IS NULL OR NEW."voidedAt" IS NOT NULL OR NEW."status" NOT IN (
      'approved_pending_payment', 'partially_paid', 'paid',
      'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
      'offset_completed'
    ) THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
  ELSIF TG_TABLE_NAME = 'SpotProcurementPayment' THEN
    IF NEW."invalidatedAt" IS NOT NULL OR NEW."status" NOT IN ('approved_pending_payment', 'partially_paid', 'paid') THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
  ELSE
    IF NEW."status" <> 'confirmed' THEN
      RETURN NEW;
    END IF;
    target_project_id := NEW."projectId";
  END IF;

  IF target_project_id IS NULL THEN
    RAISE EXCEPTION '正式经营事实缺少项目，不能锁定施工企业'
      USING ERRCODE = '23514';
  END IF;

  candidate_fact_date := COALESCE(
    NULLIF(to_jsonb(NEW) ->> 'effectiveAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'occurredAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'signedAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'settledAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'paidAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'receivedAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'approvedAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'confirmedAt', '')::TIMESTAMP(3),
    NULLIF(to_jsonb(NEW) ->> 'createdAt', '')::TIMESTAMP(3)
  )::DATE;
  IF TG_TABLE_NAME = 'PaymentExecutionAllocation' THEN
    SELECT execution."paidAt"::DATE INTO candidate_fact_date
      FROM "PaymentExecution" execution WHERE execution."id" = NEW."paymentExecutionId";
  END IF;

  SELECT "operatingLedgerEffectiveDate" INTO operating_ledger_effective_date
    FROM "Project" WHERE "id" = target_project_id FOR UPDATE;

  SELECT "id", "businessPartyVersionId"
    INTO current_assignment_id, current_assignment_version_id
    FROM "ProjectAffiliateAssignment"
    WHERE "projectId" = target_project_id
      AND "effectiveFrom" <= candidate_fact_date
      AND "endedAt" IS NULL
    FOR KEY SHARE;
  IF current_assignment_id IS NULL THEN
    RAISE EXCEPTION '正式经营事实发生前必须先设置唯一施工企业'
      USING ERRCODE = '23514';
  END IF;

  target_assignment_id := to_jsonb(NEW) ->> 'affiliateAssignmentId';
  target_assignment_version_id := to_jsonb(NEW) ->> 'affiliateBusinessPartyVersionId';
  IF target_assignment_id IS NOT NULL THEN
    IF target_assignment_id <> current_assignment_id THEN
      RAISE EXCEPTION '正式经营事实引用的施工企业已失效，请刷新后重试'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF target_assignment_version_id IS NOT NULL
     AND target_assignment_version_id <> current_assignment_version_id THEN
    RAISE EXCEPTION '正式经营事实引用的施工企业已失效，请刷新后重试'
      USING ERRCODE = '23514';
  END IF;

  UPDATE "Project"
    SET "constructionEnterpriseLockedAt" = COALESCE(
      "constructionEnterpriseLockedAt",
      CURRENT_TIMESTAMP
    )
    WHERE "id" = target_project_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContractVersion_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ContractVersion"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "Settlement_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "Settlement"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectUpstreamFundFact_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectUpstreamFundFact"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectAffiliateContractFact_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectAffiliateContractFact"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectAffiliateSettlementFact_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectAffiliateSettlementFact"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectAffiliatePaymentFact_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectAffiliatePaymentFact"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectAffiliateCompanyContract_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectAffiliateCompanyContract"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectUpstreamSettlement_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectUpstreamSettlement"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectOwnerContract_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectOwnerContract"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectProxyPayment_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectProxyPayment"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectReceipt_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectReceipt"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ProjectExpenseExecution_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ProjectExpenseExecution"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "PaymentExecutionAllocation_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "PaymentExecutionAllocation"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "ExpenseClaim_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "ExpenseClaim"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();
CREATE TRIGGER "SpotProcurementPayment_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON "SpotProcurementPayment"
  FOR EACH ROW EXECUTE FUNCTION "lockProjectConstructionEnterpriseFromFormalFact"();

CREATE OR REPLACE FUNCTION "requireActiveProjectParticipatingCompany"()
RETURNS TRIGGER AS $$
DECLARE
  target_project_id TEXT;
  primary_company_id TEXT;
  secondary_company_id TEXT;
  candidate_company_id TEXT;
  operating_ledger_effective_date DATE;
  candidate_fact_date DATE;
BEGIN
  IF TG_TABLE_NAME = 'ContractVersion' THEN
    IF NEW."status" <> 'effective' THEN RETURN NEW; END IF;
    SELECT contract."projectId" INTO target_project_id FROM "Contract" contract WHERE contract."id" = NEW."contractId";
    primary_company_id := NEW."companyEntityIdSnapshot";
  ELSIF TG_TABLE_NAME = 'ProjectAffiliateCompanyContract' THEN
    IF NEW."status" <> 'confirmed' THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
    primary_company_id := NEW."companyEntityId";
    candidate_fact_date := NEW."signedAt"::DATE;
  ELSIF TG_TABLE_NAME = 'ExpenseClaim' THEN
    IF NEW."projectId" IS NULL OR NEW."voidedAt" IS NOT NULL OR NEW."status" NOT IN (
      'approved_pending_payment', 'partially_paid', 'paid',
      'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
      'offset_completed'
    ) THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
    primary_company_id := NEW."companyEntityId";
    secondary_company_id := NEW."paymentSubjectCompanyEntityId";
    candidate_fact_date := COALESCE(NEW."approvedAt", NEW."createdAt")::DATE;
  ELSIF TG_TABLE_NAME = 'SpotProcurementPayment' THEN
    IF NEW."invalidatedAt" IS NOT NULL OR NEW."status" NOT IN ('approved_pending_payment', 'partially_paid', 'paid') THEN RETURN NEW; END IF;
    target_project_id := NEW."projectId";
    primary_company_id := NEW."payerCompanyEntityId";
    candidate_fact_date := COALESCE(NEW."approvedAt", NEW."createdAt")::DATE;
  ELSIF TG_TABLE_NAME = 'PaymentExecutionAllocation' THEN
    target_project_id := NEW."projectId";
    SELECT execution."companyEntityIdSnapshot" INTO primary_company_id
      FROM "PaymentExecution" execution WHERE execution."id" = NEW."paymentExecutionId";
    SELECT execution."paidAt"::DATE INTO candidate_fact_date
      FROM "PaymentExecution" execution WHERE execution."id" = NEW."paymentExecutionId";
  END IF;

  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE;
  END IF;

  SELECT "operatingLedgerEffectiveDate" INTO operating_ledger_effective_date
    FROM "Project" WHERE "id" = target_project_id FOR UPDATE;
  IF operating_ledger_effective_date IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH candidate_company_id IN ARRAY ARRAY[primary_company_id, secondary_company_id] LOOP
    IF candidate_company_id IS NULL THEN CONTINUE; END IF;
    PERFORM 1 FROM "ProjectParticipatingCompany"
      WHERE "projectId" = target_project_id
        AND "companyEntityId" = candidate_company_id
        AND "effectiveFrom" <= candidate_fact_date
        AND ("endedAt" IS NULL OR "endedAt" > candidate_fact_date)
      FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '该公司未在本项目参与公司名单中，或已停止新增业务'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContractVersion_require_active_participant"
  BEFORE INSERT OR UPDATE ON "ContractVersion"
  FOR EACH ROW EXECUTE FUNCTION "requireActiveProjectParticipatingCompany"();
CREATE TRIGGER "ProjectAffiliateCompanyContract_require_active_participant"
  BEFORE INSERT OR UPDATE ON "ProjectAffiliateCompanyContract"
  FOR EACH ROW EXECUTE FUNCTION "requireActiveProjectParticipatingCompany"();
CREATE TRIGGER "ExpenseClaim_require_active_participant"
  BEFORE INSERT OR UPDATE ON "ExpenseClaim"
  FOR EACH ROW EXECUTE FUNCTION "requireActiveProjectParticipatingCompany"();
CREATE TRIGGER "SpotProcurementPayment_require_active_participant"
  BEFORE INSERT OR UPDATE ON "SpotProcurementPayment"
  FOR EACH ROW EXECUTE FUNCTION "requireActiveProjectParticipatingCompany"();
CREATE TRIGGER "PaymentExecutionAllocation_require_active_participant"
  BEFORE INSERT OR UPDATE ON "PaymentExecutionAllocation"
  FOR EACH ROW EXECUTE FUNCTION "requireActiveProjectParticipatingCompany"();

CREATE OR REPLACE FUNCTION "protectProjectParticipatingCompanyEndDate"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    PERFORM 1 FROM "Project" WHERE "id" = OLD."projectId" FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM "Contract" contract INNER JOIN "ContractVersion" version ON version."contractId" = contract."id"
        WHERE contract."projectId" = OLD."projectId" AND version."status" = 'effective'
          AND (contract."companyEntityId" = OLD."companyEntityId" OR version."companyEntityIdSnapshot" = OLD."companyEntityId")
          AND COALESCE(version."effectiveAt", version."createdAt")::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "ProjectAffiliateCompanyContract" fact
        WHERE fact."projectId" = OLD."projectId" AND fact."companyEntityId" = OLD."companyEntityId"
          AND fact."status" = 'confirmed' AND fact."signedAt"::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "ExpenseClaim" claim
        WHERE claim."projectId" = OLD."projectId" AND claim."voidedAt" IS NULL
          AND claim."status" IN ('approved_pending_payment','partially_paid','paid','approved_pending_disbursement','partially_disbursed','disbursed','offset_completed')
          AND (claim."companyEntityId" = OLD."companyEntityId" OR claim."paymentSubjectCompanyEntityId" = OLD."companyEntityId")
          AND COALESCE(claim."approvedAt", claim."createdAt")::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "PaymentExecutionAllocation" allocation INNER JOIN "PaymentExecution" execution ON execution."id" = allocation."paymentExecutionId"
        WHERE allocation."projectId" = OLD."projectId" AND execution."companyEntityIdSnapshot" = OLD."companyEntityId"
          AND execution."paidAt"::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "SpotProcurementPayment" payment
        WHERE payment."projectId" = OLD."projectId" AND payment."payerCompanyEntityId" = OLD."companyEntityId"
          AND payment."invalidatedAt" IS NULL AND payment."status" IN ('approved_pending_payment','partially_paid','paid')
          AND COALESCE(payment."approvedAt", payment."createdAt")::DATE >= NEW."endedAt"
    ) THEN
      RAISE EXCEPTION '停止日期当日或之后已有正式经营事实，不能截断参与期间'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectParticipatingCompany_protect_end_date"
  BEFORE UPDATE OF "endedAt" ON "ProjectParticipatingCompany"
  FOR EACH ROW EXECUTE FUNCTION "protectProjectParticipatingCompanyEndDate"();

CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Contract" contract
      INNER JOIN "ContractVersion" version ON version."contractId" = contract."id"
      WHERE contract."projectId" = OLD."projectId" AND version."status" = 'effective'
        AND (contract."companyEntityId" = OLD."companyEntityId" OR version."companyEntityIdSnapshot" = OLD."companyEntityId")
  ) OR EXISTS (
    SELECT 1 FROM "ProjectAffiliateCompanyContract" fact
      WHERE fact."projectId" = OLD."projectId" AND fact."companyEntityId" = OLD."companyEntityId" AND fact."status" = 'confirmed'
  ) OR EXISTS (
    SELECT 1 FROM "ExpenseClaim" claim
      WHERE claim."projectId" = OLD."projectId" AND claim."voidedAt" IS NULL AND claim."status" IN (
        'approved_pending_payment', 'partially_paid', 'paid',
        'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
        'offset_completed'
      )
        AND (claim."companyEntityId" = OLD."companyEntityId" OR claim."paymentSubjectCompanyEntityId" = OLD."companyEntityId")
  ) OR EXISTS (
    SELECT 1 FROM "PaymentExecution" execution
      INNER JOIN "PaymentExecutionAllocation" allocation ON allocation."paymentExecutionId" = execution."id"
      WHERE allocation."projectId" = OLD."projectId" AND execution."companyEntityIdSnapshot" = OLD."companyEntityId"
  ) OR EXISTS (
    SELECT 1 FROM "SpotProcurementPayment" payment
      WHERE payment."projectId" = OLD."projectId" AND payment."invalidatedAt" IS NULL
        AND payment."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
        AND payment."payerCompanyEntityId" = OLD."companyEntityId"
  ) THEN
    RAISE EXCEPTION '该公司已有正式经营事实，只能停止新增业务，不能删除'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectParticipatingCompany_protect_factful_delete"
  BEFORE DELETE ON "ProjectParticipatingCompany"
  FOR EACH ROW EXECUTE FUNCTION "protectFactfulProjectParticipatingCompany"();

CREATE OR REPLACE FUNCTION "protectLockedProjectConstructionEnterprise"()
RETURNS TRIGGER AS $$
DECLARE
  locked_at TIMESTAMP(3);
  protected_change BOOLEAN;
BEGIN
  protected_change := TG_OP = 'DELETE';
  IF TG_OP = 'UPDATE' THEN
    protected_change :=
      OLD."projectId" IS DISTINCT FROM NEW."projectId"
      OR OLD."businessPartyId" IS DISTINCT FROM NEW."businessPartyId"
      OR OLD."businessPartyVersionId" IS DISTINCT FROM NEW."businessPartyVersionId"
      OR OLD."affiliateNameSnapshot" IS DISTINCT FROM NEW."affiliateNameSnapshot"
      OR OLD."affiliateCreditCodeSnapshot" IS DISTINCT FROM NEW."affiliateCreditCodeSnapshot"
      OR OLD."effectiveFrom" IS DISTINCT FROM NEW."effectiveFrom"
      OR OLD."endedAt" IS DISTINCT FROM NEW."endedAt";
  END IF;
  IF protected_change THEN
    SELECT "constructionEnterpriseLockedAt"
      INTO locked_at
      FROM "Project"
      WHERE "id" = OLD."projectId"
      FOR UPDATE;
    IF locked_at IS NOT NULL THEN
      RAISE EXCEPTION '项目已有正式经营事实，施工企业已经锁定，不能普通更换'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectAffiliateAssignment_protect_locked_change"
  BEFORE UPDATE OR DELETE ON "ProjectAffiliateAssignment"
  FOR EACH ROW EXECUTE FUNCTION "protectLockedProjectConstructionEnterprise"();

CREATE OR REPLACE FUNCTION "validateProjectConstructionEnterprisePeriod"()
RETURNS TRIGGER AS $$
DECLARE
  operating_ledger_effective_date DATE;
BEGIN
  IF NEW."endedAt" IS NULL THEN
    SELECT "operatingLedgerEffectiveDate" INTO operating_ledger_effective_date
      FROM "Project" WHERE "id" = NEW."projectId" FOR UPDATE;
    IF operating_ledger_effective_date IS NOT NULL
       AND NEW."effectiveFrom"::DATE > operating_ledger_effective_date THEN
      RAISE EXCEPTION '施工企业生效日不得晚于经营账生效日'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectAffiliateAssignment_validate_operating_period"
  BEFORE INSERT OR UPDATE ON "ProjectAffiliateAssignment"
  FOR EACH ROW EXECUTE FUNCTION "validateProjectConstructionEnterprisePeriod"();

CREATE OR REPLACE FUNCTION "rejectInitiallyActiveProjectOperatingLedger"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."operatingLedgerEffectiveDate" IS NOT NULL THEN
    RAISE EXCEPTION '经营账生效日必须在项目创建后通过项目设置启用'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_reject_initial_operating_ledger"
  BEFORE INSERT ON "Project"
  FOR EACH ROW EXECUTE FUNCTION "rejectInitiallyActiveProjectOperatingLedger"();

CREATE OR REPLACE FUNCTION "activateProjectOperatingLedger"()
RETURNS TRIGGER AS $$
DECLARE
  first_formal_fact_at TIMESTAMP(3);
  current_assignment_id TEXT;
  current_assignment_version_id TEXT;
  assignment_effective_from DATE;
  company_fact RECORD;
BEGIN
  IF OLD."operatingLedgerEffectiveDate" IS NOT NULL
     AND NEW."operatingLedgerEffectiveDate" IS NULL
     AND OLD."constructionEnterpriseLockedAt" IS NOT NULL THEN
    RAISE EXCEPTION '项目已有正式经营事实，经营账生效日不能清空'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."operatingLedgerEffectiveDate" IS NOT NULL
     AND NEW."operatingLedgerEffectiveDate" IS DISTINCT FROM OLD."operatingLedgerEffectiveDate" THEN
    SELECT "id", "businessPartyVersionId", "effectiveFrom"
      INTO current_assignment_id, current_assignment_version_id, assignment_effective_from
      FROM "ProjectAffiliateAssignment"
      WHERE "projectId" = OLD."id" AND "endedAt" IS NULL
      FOR KEY SHARE;
    IF assignment_effective_from IS NULL THEN
      RAISE EXCEPTION '启用经营账前必须先设置唯一施工企业'
        USING ERRCODE = '23514';
    END IF;
    IF assignment_effective_from > NEW."operatingLedgerEffectiveDate" THEN
      RAISE EXCEPTION '施工企业生效日不得晚于经营账生效日'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM "ProjectParticipatingCompany"
      WHERE "projectId" = OLD."id"
        AND "effectiveFrom" <= NEW."operatingLedgerEffectiveDate"
        AND ("endedAt" IS NULL OR "endedAt" > NEW."operatingLedgerEffectiveDate")
      FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '启用经营账前必须至少设置一家我方参与公司'
        USING ERRCODE = '23514';
    END IF;
    SELECT MIN(fact."occurredAt") INTO first_formal_fact_at FROM (
      SELECT COALESCE(version."effectiveAt", version."createdAt") AS "occurredAt"
        FROM "ContractVersion" version INNER JOIN "Contract" contract ON contract."id" = version."contractId"
        WHERE contract."projectId" = OLD."id" AND version."status" = 'effective'
      UNION ALL SELECT settlement."createdAt" FROM "Settlement" settlement WHERE settlement."projectId" = OLD."id" AND settlement."status" = 'effective'
      UNION ALL SELECT fact."occurredAt" FROM "ProjectUpstreamFundFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."signedAt" FROM "ProjectAffiliateContractFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."settledAt" FROM "ProjectAffiliateSettlementFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."paidAt" FROM "ProjectAffiliatePaymentFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."signedAt" FROM "ProjectAffiliateCompanyContract" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."settledAt" FROM "ProjectUpstreamSettlement" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT fact."signedAt" FROM "ProjectOwnerContract" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      UNION ALL SELECT payment."paidAt" FROM "ProjectProxyPayment" payment WHERE payment."projectId" = OLD."id" AND payment."voidedAt" IS NULL
      UNION ALL SELECT receipt."receivedAt" FROM "ProjectReceipt" receipt WHERE receipt."projectId" = OLD."id" AND receipt."voidedAt" IS NULL
      UNION ALL SELECT execution."paidAt" FROM "ProjectExpenseExecution" execution WHERE execution."projectId" = OLD."id"
      UNION ALL SELECT execution."paidAt" FROM "PaymentExecutionAllocation" allocation INNER JOIN "PaymentExecution" execution ON execution."id" = allocation."paymentExecutionId" WHERE allocation."projectId" = OLD."id"
      UNION ALL SELECT COALESCE(claim."approvedAt", claim."createdAt") FROM "ExpenseClaim" claim WHERE claim."projectId" = OLD."id" AND claim."voidedAt" IS NULL AND claim."status" IN ('approved_pending_payment','partially_paid','paid','approved_pending_disbursement','partially_disbursed','disbursed','offset_completed')
      UNION ALL SELECT COALESCE(payment."approvedAt", payment."createdAt") FROM "SpotProcurementPayment" payment WHERE payment."projectId" = OLD."id" AND payment."invalidatedAt" IS NULL AND payment."status" IN ('approved_pending_payment','partially_paid','paid')
    ) fact;
    IF first_formal_fact_at IS NOT NULL THEN
      IF assignment_effective_from > first_formal_fact_at::DATE THEN
        RAISE EXCEPTION '施工企业生效日不得晚于项目已有正式经营事实日期'
          USING ERRCODE = '23514';
      END IF;
      NEW."constructionEnterpriseLockedAt" := COALESCE(NEW."constructionEnterpriseLockedAt", first_formal_fact_at);
    END IF;

    IF EXISTS (
      SELECT 1 FROM (
        SELECT version."affiliateAssignmentId", version."affiliateBusinessPartyVersionId"
          FROM "ContractVersion" version INNER JOIN "Contract" contract ON contract."id" = version."contractId"
          WHERE contract."projectId" = OLD."id" AND version."status" = 'effective'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectUpstreamFundFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectAffiliateContractFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectAffiliateSettlementFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectAffiliatePaymentFact" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectAffiliateCompanyContract" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT payment."affiliateAssignmentId", payment."affiliateBusinessPartyVersionId"
          FROM "ProjectProxyPayment" payment WHERE payment."projectId" = OLD."id" AND payment."voidedAt" IS NULL
        UNION ALL SELECT receipt."affiliateAssignmentId", receipt."affiliateBusinessPartyVersionId"
          FROM "ProjectReceipt" receipt WHERE receipt."projectId" = OLD."id" AND receipt."voidedAt" IS NULL
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectUpstreamSettlement" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT fact."affiliateAssignmentId", fact."affiliateBusinessPartyVersionId"
          FROM "ProjectOwnerContract" fact WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
      ) reference
      WHERE (reference."affiliateAssignmentId" IS NOT NULL
             AND reference."affiliateAssignmentId" <> current_assignment_id)
         OR (reference."affiliateBusinessPartyVersionId" IS NOT NULL
             AND reference."affiliateBusinessPartyVersionId" <> current_assignment_version_id)
    ) THEN
      RAISE EXCEPTION '项目已有正式经营事实引用的施工企业与当前映射不一致，请先人工修复'
        USING ERRCODE = '23514';
    END IF;

    FOR company_fact IN
      SELECT company."companyEntityId", company."occurredAt" FROM (
        SELECT contract."companyEntityId" AS "companyEntityId", COALESCE(version."effectiveAt", version."createdAt") AS "occurredAt"
          FROM "ContractVersion" version INNER JOIN "Contract" contract ON contract."id" = version."contractId"
          WHERE contract."projectId" = OLD."id" AND version."status" = 'effective'
        UNION ALL SELECT version."companyEntityIdSnapshot", COALESCE(version."effectiveAt", version."createdAt")
          FROM "ContractVersion" version INNER JOIN "Contract" contract ON contract."id" = version."contractId"
          WHERE contract."projectId" = OLD."id" AND version."status" = 'effective'
        UNION ALL SELECT fact."companyEntityId", fact."signedAt" FROM "ProjectAffiliateCompanyContract" fact
          WHERE fact."projectId" = OLD."id" AND fact."status" = 'confirmed'
        UNION ALL SELECT claim."companyEntityId", COALESCE(claim."approvedAt", claim."createdAt") FROM "ExpenseClaim" claim
          WHERE claim."projectId" = OLD."id" AND claim."voidedAt" IS NULL AND claim."status" IN ('approved_pending_payment','partially_paid','paid','approved_pending_disbursement','partially_disbursed','disbursed','offset_completed')
        UNION ALL SELECT claim."paymentSubjectCompanyEntityId", COALESCE(claim."approvedAt", claim."createdAt") FROM "ExpenseClaim" claim
          WHERE claim."projectId" = OLD."id" AND claim."voidedAt" IS NULL AND claim."status" IN ('approved_pending_payment','partially_paid','paid','approved_pending_disbursement','partially_disbursed','disbursed','offset_completed')
        UNION ALL SELECT execution."companyEntityIdSnapshot", execution."paidAt" FROM "PaymentExecutionAllocation" allocation
          INNER JOIN "PaymentExecution" execution ON execution."id" = allocation."paymentExecutionId"
          WHERE allocation."projectId" = OLD."id"
        UNION ALL SELECT payment."payerCompanyEntityId", COALESCE(payment."approvedAt", payment."createdAt") FROM "SpotProcurementPayment" payment
          WHERE payment."projectId" = OLD."id" AND payment."invalidatedAt" IS NULL AND payment."status" IN ('approved_pending_payment','partially_paid','paid')
      ) company
      WHERE company."companyEntityId" IS NOT NULL
    LOOP
      PERFORM 1 FROM "ProjectParticipatingCompany" participant
        WHERE participant."projectId" = OLD."id"
          AND participant."companyEntityId" = company_fact."companyEntityId"
          AND participant."effectiveFrom" <= company_fact."occurredAt"::DATE
          AND (participant."endedAt" IS NULL OR participant."endedAt" > company_fact."occurredAt"::DATE)
        FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION '项目已有正式经营事实引用的公司未覆盖对应参与期间'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Project_activate_operating_ledger"
  BEFORE UPDATE OF "operatingLedgerEffectiveDate" ON "Project"
  FOR EACH ROW EXECUTE FUNCTION "activateProjectOperatingLedger"();

WITH formal_facts AS (
  SELECT contract."projectId", COALESCE(version."effectiveAt", version."createdAt") AS "occurredAt"
    FROM "ContractVersion" version
    INNER JOIN "Contract" contract ON contract."id" = version."contractId"
    WHERE version."status" = 'effective'
  UNION ALL
  SELECT settlement."projectId", settlement."createdAt"
    FROM "Settlement" settlement
    WHERE settlement."status" = 'effective'
  UNION ALL
  SELECT fact."projectId", fact."occurredAt"
    FROM "ProjectUpstreamFundFact" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."signedAt"
    FROM "ProjectAffiliateContractFact" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."settledAt"
    FROM "ProjectAffiliateSettlementFact" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."paidAt"
    FROM "ProjectAffiliatePaymentFact" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."signedAt"
    FROM "ProjectAffiliateCompanyContract" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."settledAt"
    FROM "ProjectUpstreamSettlement" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."signedAt"
    FROM "ProjectOwnerContract" fact WHERE fact."status" = 'confirmed'
  UNION ALL
  SELECT fact."projectId", fact."paidAt"
    FROM "ProjectProxyPayment" fact WHERE fact."voidedAt" IS NULL
  UNION ALL
  SELECT fact."projectId", fact."receivedAt"
    FROM "ProjectReceipt" fact WHERE fact."voidedAt" IS NULL
  UNION ALL
  SELECT fact."projectId", fact."paidAt"
    FROM "ProjectExpenseExecution" fact
  UNION ALL
  SELECT allocation."projectId", execution."paidAt"
    FROM "PaymentExecutionAllocation" allocation
    INNER JOIN "PaymentExecution" execution ON execution."id" = allocation."paymentExecutionId"
  UNION ALL
  SELECT claim."projectId", COALESCE(claim."approvedAt", claim."createdAt")
    FROM "ExpenseClaim" claim
    WHERE claim."projectId" IS NOT NULL AND claim."voidedAt" IS NULL AND claim."status" IN (
      'approved_pending_payment', 'partially_paid', 'paid',
      'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
      'offset_completed'
    )
  UNION ALL
  SELECT payment."projectId", COALESCE(payment."approvedAt", payment."createdAt")
    FROM "SpotProcurementPayment" payment
    WHERE payment."invalidatedAt" IS NULL AND payment."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
), first_formal_fact AS (
  SELECT "projectId", MIN("occurredAt") AS "lockedAt"
    FROM formal_facts
    GROUP BY "projectId"
)
UPDATE "Project" project
  SET "constructionEnterpriseLockedAt" = first_formal_fact."lockedAt"
  FROM first_formal_fact
  WHERE project."id" = first_formal_fact."projectId"
    AND project."constructionEnterpriseLockedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "ProjectAffiliateAssignment" assignment
      WHERE assignment."projectId" = project."id"
        AND assignment."effectiveFrom" <= first_formal_fact."lockedAt"::DATE
        AND assignment."endedAt" IS NULL
    );
