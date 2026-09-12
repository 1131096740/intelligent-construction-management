-- POL-284 v1.2: preserve participant history against the terminal operating ledger.

CREATE INDEX "OperatingFact_participant_debtor_history_idx"
  ON "OperatingFact"("projectId", "debtorSubjectId", "occurredAt")
  WHERE "debtorSubjectKind" = 'participating_company';
CREATE INDEX "OperatingFact_participant_creditor_history_idx"
  ON "OperatingFact"("projectId", "creditorSubjectId", "occurredAt")
  WHERE "creditorSubjectKind" = 'participating_company';
CREATE INDEX "OperatingFact_participant_approvedPayer_history_idx"
  ON "OperatingFact"("projectId", "approvedPayerSubjectId", "occurredAt")
  WHERE "approvedPayerSubjectKind" = 'participating_company';
CREATE INDEX "OperatingFact_participant_actualPayer_history_idx"
  ON "OperatingFact"("projectId", "actualPayerSubjectId", "occurredAt")
  WHERE "actualPayerSubjectKind" = 'participating_company';
CREATE INDEX "OperatingFact_participant_payee_history_idx"
  ON "OperatingFact"("projectId", "payeeSubjectId", "occurredAt")
  WHERE "payeeSubjectKind" = 'participating_company';
CREATE INDEX "OperatingFact_participant_costBearingCompany_history_idx"
  ON "OperatingFact"("projectId", "costBearingCompanySubjectId", "occurredAt")
  WHERE "costBearingCompanySubjectKind" = 'participating_company';
CREATE INDEX "OperatingImpactEntry_participant_subject_history_idx"
  ON "OperatingImpactEntry"("projectId", "subjectId", "factId")
  WHERE "subjectKind" = 'participating_company';

-- Different participant rows need one project-scoped write conflict before the
-- last-active-participant check. This internal fence carries no business state
-- and deliberately has no Project foreign key: even the first DELETE must not
-- reacquire a Project row lock after it has already locked its target.
CREATE TABLE "ProjectParticipatingCompanyMutationFence" (
  "projectId" TEXT NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 0,

  CONSTRAINT "ProjectParticipatingCompanyMutationFence_pkey" PRIMARY KEY ("projectId")
);

CREATE OR REPLACE FUNCTION "serializeProjectParticipatingCompanyMutation"(
  target_project_id TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO "ProjectParticipatingCompanyMutationFence" ("projectId", "revision")
  VALUES (target_project_id, 1)
  ON CONFLICT ("projectId") DO UPDATE
  SET "revision" = "ProjectParticipatingCompanyMutationFence"."revision" + 1;
END;
$$ LANGUAGE plpgsql;

-- These four functions are redefined below. Refuse the migration unless the
-- expected terminal behavior is still present; never overwrite unknown drift.
DO $pol284_terminal_functions$
DECLARE
  current_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('"requireActiveProjectParticipatingCompany"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(current_definition, 'TG_TABLE_NAME = ''ContractVersion''') = 0
     OR strpos(current_definition, 'TG_TABLE_NAME = ''ProjectAffiliateCompanyContract''') = 0
     OR strpos(current_definition, 'TG_TABLE_NAME = ''ExpenseClaim''') = 0
     OR strpos(current_definition, 'TG_TABLE_NAME = ''SpotProcurementPayment''') = 0
     OR strpos(current_definition, 'TG_TABLE_NAME = ''PaymentExecutionAllocation''') = 0
     OR strpos(current_definition, 'FOR KEY SHARE') = 0
     OR strpos(current_definition, '该公司未在本项目参与公司名单中，或已停止新增业务') = 0 THEN
    RAISE EXCEPTION 'POL-284 active-participant validator terminal semantics drifted; refusing replacement';
  END IF;

  SELECT pg_get_functiondef('"protectProjectParticipatingCompanyEndDate"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(current_definition, 'FROM "Project" WHERE "id" = OLD."projectId" FOR UPDATE') = 0
     OR strpos(current_definition, 'FROM "Contract" contract') = 0
     OR strpos(current_definition, 'FROM "ProjectAffiliateCompanyContract" fact') = 0
     OR strpos(current_definition, 'FROM "ExpenseClaim" claim') = 0
     OR strpos(current_definition, 'FROM "PaymentExecutionAllocation" allocation') = 0
     OR strpos(current_definition, 'FROM "SpotProcurementPayment" payment') = 0
     OR strpos(current_definition, '停止日期当日或之后已有正式经营事实，不能截断参与期间') = 0 THEN
    RAISE EXCEPTION 'POL-284 participant end-date guard terminal semantics drifted; refusing replacement';
  END IF;

  SELECT pg_get_functiondef('"protectFactfulProjectParticipatingCompany"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(current_definition, 'FROM "Contract" contract') = 0
     OR strpos(current_definition, 'FROM "ProjectAffiliateCompanyContract" fact') = 0
     OR strpos(current_definition, 'FROM "ExpenseClaim" claim') = 0
     OR strpos(current_definition, 'FROM "PaymentExecution" execution') = 0
     OR strpos(current_definition, 'FROM "SpotProcurementPayment" payment') = 0
     OR strpos(current_definition, '该公司已有正式经营事实，只能停止新增业务，不能删除') = 0 THEN
    RAISE EXCEPTION 'POL-284 participant delete guard terminal semantics drifted; refusing replacement';
  END IF;

  SELECT pg_get_functiondef('"activateProjectOperatingLedger"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(current_definition, 'constructionEnterpriseLockedAt') = 0
     OR strpos(current_definition, 'FROM "ProjectAffiliateAssignment"') = 0
     OR strpos(current_definition, 'FROM "PaymentExecutionAllocation" allocation') = 0
     OR strpos(current_definition, '项目已有正式经营事实引用的施工企业与当前映射不一致，请先人工修复') = 0
     OR strpos(current_definition, '项目已有正式经营事实引用的公司未覆盖对应参与期间') = 0
     OR strpos(current_definition, 'FOR KEY SHARE') = 0 THEN
    RAISE EXCEPTION 'POL-284 operating-ledger activation terminal semantics drifted; refusing replacement';
  END IF;
END;
$pol284_terminal_functions$;

-- Existing formal source writers already lock Project first. Upgrade their
-- participant dependency locks and acquire every matching relation in id order.
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
    SELECT contract."projectId" INTO target_project_id
      FROM "Contract" contract WHERE contract."id" = NEW."contractId";
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
    IF NEW."invalidatedAt" IS NOT NULL
       OR NEW."status" NOT IN ('approved_pending_payment', 'partially_paid', 'paid') THEN
      RETURN NEW;
    END IF;
    target_project_id := NEW."projectId";
    primary_company_id := NEW."payerCompanyEntityId";
    candidate_fact_date := COALESCE(NEW."approvedAt", NEW."createdAt")::DATE;
  ELSIF TG_TABLE_NAME = 'PaymentExecutionAllocation' THEN
    target_project_id := NEW."projectId";
    SELECT execution."companyEntityIdSnapshot", execution."paidAt"::DATE
      INTO primary_company_id, candidate_fact_date
      FROM "PaymentExecution" execution
      WHERE execution."id" = NEW."paymentExecutionId";
  END IF;

  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE;
  END IF;

  SELECT "operatingLedgerEffectiveDate" INTO operating_ledger_effective_date
    FROM "Project" WHERE "id" = target_project_id FOR UPDATE;
  IF operating_ledger_effective_date IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM participant."id"
    FROM "ProjectParticipatingCompany" participant
    WHERE participant."projectId" = target_project_id
      AND participant."companyEntityId" = ANY (
        ARRAY[primary_company_id, secondary_company_id]::TEXT[]
      )
      AND participant."effectiveFrom" <= candidate_fact_date
      AND (participant."endedAt" IS NULL OR participant."endedAt" > candidate_fact_date)
    ORDER BY participant."id" FOR SHARE;

  FOREACH candidate_company_id IN ARRAY ARRAY[primary_company_id, secondary_company_id] LOOP
    IF candidate_company_id IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "ProjectParticipatingCompany" participant
      WHERE participant."projectId" = target_project_id
        AND participant."companyEntityId" = candidate_company_id
        AND participant."effectiveFrom" <= candidate_fact_date
        AND (participant."endedAt" IS NULL OR participant."endedAt" > candidate_fact_date)
    ) THEN
      RAISE EXCEPTION '该公司未在本项目参与公司名单中，或已停止新增业务'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Preserve the terminal owner/downstream/employee/canonical-wage fact validator.
-- Only the participant resolution block is replaced.
DO $pol284_fact$
DECLARE
  current_definition TEXT;
  old_fragment TEXT := $old$
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
$old$;
  new_fragment TEXT := $new$
  PERFORM participant."id"
    FROM "ProjectParticipatingCompany" participant
    WHERE participant."projectId" = NEW."projectId"
      AND (
        participant."companyEntityId" = ANY (ARRAY[
          CASE WHEN NEW."debtorSubjectKind" = 'participating_company' THEN NEW."debtorSubjectId" ELSE NULL END,
          CASE WHEN NEW."creditorSubjectKind" = 'participating_company' THEN NEW."creditorSubjectId" ELSE NULL END,
          CASE WHEN NEW."approvedPayerSubjectKind" = 'participating_company' THEN NEW."approvedPayerSubjectId" ELSE NULL END,
          CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN NEW."actualPayerSubjectId" ELSE NULL END,
          CASE WHEN NEW."payeeSubjectKind" = 'participating_company' THEN NEW."payeeSubjectId" ELSE NULL END,
          CASE WHEN NEW."costBearingCompanySubjectKind" = 'participating_company' THEN NEW."costBearingCompanySubjectId" ELSE NULL END
        ]::TEXT[])
        OR participant."companyEntityVersionId" = ANY (ARRAY[
          CASE WHEN NEW."debtorSubjectKind" = 'participating_company' THEN NEW."debtorSubjectId" ELSE NULL END,
          CASE WHEN NEW."creditorSubjectKind" = 'participating_company' THEN NEW."creditorSubjectId" ELSE NULL END,
          CASE WHEN NEW."approvedPayerSubjectKind" = 'participating_company' THEN NEW."approvedPayerSubjectId" ELSE NULL END,
          CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN NEW."actualPayerSubjectId" ELSE NULL END,
          CASE WHEN NEW."payeeSubjectKind" = 'participating_company' THEN NEW."payeeSubjectId" ELSE NULL END,
          CASE WHEN NEW."costBearingCompanySubjectKind" = 'participating_company' THEN NEW."costBearingCompanySubjectId" ELSE NULL END
        ]::TEXT[])
      )
      AND participant."effectiveFrom" <= NEW."occurredAt"::DATE
      AND (participant."endedAt" IS NULL OR participant."endedAt" > NEW."occurredAt"::DATE)
    ORDER BY participant."id" FOR SHARE;

  FOREACH candidate_company_id IN ARRAY ARRAY[
    CASE WHEN NEW."debtorSubjectKind" = 'participating_company' THEN NEW."debtorSubjectId" ELSE NULL END,
    CASE WHEN NEW."creditorSubjectKind" = 'participating_company' THEN NEW."creditorSubjectId" ELSE NULL END,
    CASE WHEN NEW."approvedPayerSubjectKind" = 'participating_company' THEN NEW."approvedPayerSubjectId" ELSE NULL END,
    CASE WHEN NEW."actualPayerSubjectKind" = 'participating_company' THEN NEW."actualPayerSubjectId" ELSE NULL END,
    CASE WHEN NEW."payeeSubjectKind" = 'participating_company' THEN NEW."payeeSubjectId" ELSE NULL END,
    CASE WHEN NEW."costBearingCompanySubjectKind" = 'participating_company' THEN NEW."costBearingCompanySubjectId" ELSE NULL END
  ]::TEXT[] LOOP
    IF candidate_company_id IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "ProjectParticipatingCompany" participant
      WHERE participant."projectId" = NEW."projectId"
        AND (
          participant."companyEntityId" = candidate_company_id
          OR participant."companyEntityVersionId" = candidate_company_id
        )
        AND participant."effectiveFrom" <= NEW."occurredAt"::DATE
        AND (participant."endedAt" IS NULL OR participant."endedAt" > NEW."occurredAt"::DATE)
    ) THEN
      RAISE EXCEPTION '经营事实引用的我方公司未在本项目事实日参与'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
$new$;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(
    current_definition,
    'candidate_subject->>''kind'' NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'', ''employee'')'
  ) = 0 OR strpos(
    current_definition,
    'jg_validate_canonical_wage_operating_fact(NEW)'
  ) = 0 THEN
    RAISE EXCEPTION 'POL-284 fact validator terminal semantics drifted; refusing replacement';
  END IF;
  IF strpos(current_definition, old_fragment) = 0 THEN
    RAISE EXCEPTION 'POL-284 cannot locate the participant fact validator block';
  END IF;
  current_definition := replace(current_definition, old_fragment, new_fragment);
  EXECUTE current_definition;
END;
$pol284_fact$;

-- Preserve the terminal FundExecution partial-reversal validator and replace
-- only the independent participant impact block.
DO $pol284_impact$
DECLARE
  current_definition TEXT;
  old_fragment TEXT := $old$
  IF NEW."subjectKind" = 'participating_company' AND NOT EXISTS (
    SELECT 1 FROM "ProjectParticipatingCompany" participant
     WHERE participant."projectId" = NEW."projectId"
       AND (NEW."subjectId" = participant."companyEntityId"
         OR NEW."subjectId" = participant."companyEntityVersionId")
       AND participant."effectiveFrom" <= fact_occurred_at::DATE
       AND (participant."endedAt" IS NULL
         OR participant."endedAt" > fact_occurred_at::DATE)
  ) THEN
    RAISE EXCEPTION '影响分录引用的我方公司未在本项目事实日参与'
      USING ERRCODE = '23514';
  END IF;
$old$;
  new_fragment TEXT := $new$
  IF NEW."subjectKind" = 'participating_company' THEN
    PERFORM 1 FROM "Project"
      WHERE "id" = NEW."projectId"
      FOR UPDATE;
    PERFORM participant."id"
      FROM "ProjectParticipatingCompany" participant
      WHERE participant."projectId" = NEW."projectId"
        AND (
          NEW."subjectId" = participant."companyEntityId"
          OR NEW."subjectId" = participant."companyEntityVersionId"
        )
        AND participant."effectiveFrom" <= fact_occurred_at::DATE
        AND (participant."endedAt" IS NULL
          OR participant."endedAt" > fact_occurred_at::DATE)
      ORDER BY participant."id" FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '影响分录引用的我方公司未在本项目事实日参与'
        USING ERRCODE = '23514';
    END IF;
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingImpactEntryReferences"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(
    current_definition,
    'fact_source_type = ''fund_execution'''
  ) = 0 OR strpos(
    current_definition,
    '经营影响累计冲销金额超过原分录'
  ) = 0 THEN
    RAISE EXCEPTION 'POL-284 impact validator terminal semantics drifted; refusing replacement';
  END IF;
  IF strpos(current_definition, old_fragment) = 0 THEN
    RAISE EXCEPTION 'POL-284 cannot locate the participant impact validator block';
  END IF;
  current_definition := replace(current_definition, old_fragment, new_fragment);
  EXECUTE current_definition;
END;
$pol284_impact$;

-- The participant row is already the mutation target. Do not acquire Project
-- here: writers use Project -> participant, while owner DELETE uses participant only.
CREATE OR REPLACE FUNCTION "protectProjectParticipatingCompanyEndDate"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    PERFORM "serializeProjectParticipatingCompanyMutation"(OLD."projectId");
    IF EXISTS (
      SELECT 1
      FROM "Project" project
      WHERE project."id" = OLD."projectId"
        AND project."operatingLedgerEffectiveDate" IS NOT NULL
        AND OLD."effectiveFrom" <= project."operatingLedgerEffectiveDate"
        AND (OLD."endedAt" IS NULL OR OLD."endedAt" > project."operatingLedgerEffectiveDate")
        AND NEW."endedAt" <= project."operatingLedgerEffectiveDate"
        AND NOT EXISTS (
          SELECT 1
          FROM "ProjectParticipatingCompany" other_participant
          WHERE other_participant."projectId" = OLD."projectId"
            AND other_participant."id" <> OLD."id"
            AND other_participant."effectiveFrom" <= project."operatingLedgerEffectiveDate"
            AND (
              other_participant."endedAt" IS NULL
              OR other_participant."endedAt" > project."operatingLedgerEffectiveDate"
            )
        )
    ) THEN
      RAISE EXCEPTION '启用经营账前必须至少设置一家我方参与公司'
        USING ERRCODE = '23514';
    ELSIF EXISTS (
      SELECT 1 FROM "Contract" contract
      INNER JOIN "ContractVersion" version ON version."contractId" = contract."id"
      WHERE contract."projectId" = OLD."projectId"
        AND version."status" = 'effective'
        AND (
          contract."companyEntityId" = OLD."companyEntityId"
          OR version."companyEntityIdSnapshot" = OLD."companyEntityId"
        )
        AND COALESCE(version."effectiveAt", version."createdAt")::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "ProjectAffiliateCompanyContract" fact
      WHERE fact."projectId" = OLD."projectId"
        AND fact."companyEntityId" = OLD."companyEntityId"
        AND fact."status" = 'confirmed'
        AND fact."signedAt"::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "ExpenseClaim" claim
      WHERE claim."projectId" = OLD."projectId"
        AND claim."voidedAt" IS NULL
        AND claim."status" IN (
          'approved_pending_payment','partially_paid','paid',
          'approved_pending_disbursement','partially_disbursed','disbursed',
          'offset_completed'
        )
        AND (
          claim."companyEntityId" = OLD."companyEntityId"
          OR claim."paymentSubjectCompanyEntityId" = OLD."companyEntityId"
        )
        AND COALESCE(claim."approvedAt", claim."createdAt")::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "PaymentExecutionAllocation" allocation
      INNER JOIN "PaymentExecution" execution
        ON execution."id" = allocation."paymentExecutionId"
      WHERE allocation."projectId" = OLD."projectId"
        AND execution."companyEntityIdSnapshot" = OLD."companyEntityId"
        AND execution."paidAt"::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1 FROM "SpotProcurementPayment" payment
      WHERE payment."projectId" = OLD."projectId"
        AND payment."payerCompanyEntityId" = OLD."companyEntityId"
        AND payment."invalidatedAt" IS NULL
        AND payment."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
        AND COALESCE(payment."approvedAt", payment."createdAt")::DATE >= NEW."endedAt"
    ) OR EXISTS (
      SELECT 1
      FROM "OperatingFact" fact
      WHERE fact."projectId" = OLD."projectId"
        AND fact."occurredAt" >= NEW."endedAt"::timestamp
        AND (
          (fact."debtorSubjectKind" = 'participating_company'
            AND fact."debtorSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
          OR (fact."creditorSubjectKind" = 'participating_company'
            AND fact."creditorSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
          OR (fact."approvedPayerSubjectKind" = 'participating_company'
            AND fact."approvedPayerSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
          OR (fact."actualPayerSubjectKind" = 'participating_company'
            AND fact."actualPayerSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
          OR (fact."payeeSubjectKind" = 'participating_company'
            AND fact."payeeSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
          OR (fact."costBearingCompanySubjectKind" = 'participating_company'
            AND fact."costBearingCompanySubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        )
    ) OR EXISTS (
      SELECT 1
      FROM "OperatingImpactEntry" impact
      INNER JOIN "OperatingFact" fact ON fact."id" = impact."factId"
      WHERE impact."projectId" = OLD."projectId"
        AND impact."subjectKind" = 'participating_company'
        AND impact."subjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId")
        AND fact."occurredAt" >= NEW."endedAt"::timestamp
    ) THEN
      RAISE EXCEPTION '停止日期当日或之后已有正式经营事实，不能截断参与期间'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "serializeProjectParticipatingCompanyMutation"(OLD."projectId");
  IF EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project."id" = OLD."projectId"
      AND project."operatingLedgerEffectiveDate" IS NOT NULL
      AND OLD."effectiveFrom" <= project."operatingLedgerEffectiveDate"
      AND (OLD."endedAt" IS NULL OR OLD."endedAt" > project."operatingLedgerEffectiveDate")
      AND NOT EXISTS (
        SELECT 1
        FROM "ProjectParticipatingCompany" other_participant
        WHERE other_participant."projectId" = OLD."projectId"
          AND other_participant."id" <> OLD."id"
          AND other_participant."effectiveFrom" <= project."operatingLedgerEffectiveDate"
          AND (
            other_participant."endedAt" IS NULL
            OR other_participant."endedAt" > project."operatingLedgerEffectiveDate"
          )
      )
  ) THEN
    RAISE EXCEPTION '启用经营账前必须至少设置一家我方参与公司'
      USING ERRCODE = '23514';
  ELSIF EXISTS (
    SELECT 1 FROM "Contract" contract
    INNER JOIN "ContractVersion" version ON version."contractId" = contract."id"
    WHERE contract."projectId" = OLD."projectId"
      AND version."status" = 'effective'
      AND (
        contract."companyEntityId" = OLD."companyEntityId"
        OR version."companyEntityIdSnapshot" = OLD."companyEntityId"
      )
  ) OR EXISTS (
    SELECT 1 FROM "ProjectAffiliateCompanyContract" fact
    WHERE fact."projectId" = OLD."projectId"
      AND fact."companyEntityId" = OLD."companyEntityId"
      AND fact."status" = 'confirmed'
  ) OR EXISTS (
    SELECT 1 FROM "ExpenseClaim" claim
    WHERE claim."projectId" = OLD."projectId"
      AND claim."voidedAt" IS NULL
      AND claim."status" IN (
        'approved_pending_payment', 'partially_paid', 'paid',
        'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
        'offset_completed'
      )
      AND (
        claim."companyEntityId" = OLD."companyEntityId"
        OR claim."paymentSubjectCompanyEntityId" = OLD."companyEntityId"
      )
  ) OR EXISTS (
    SELECT 1 FROM "PaymentExecution" execution
    INNER JOIN "PaymentExecutionAllocation" allocation
      ON allocation."paymentExecutionId" = execution."id"
    WHERE allocation."projectId" = OLD."projectId"
      AND execution."companyEntityIdSnapshot" = OLD."companyEntityId"
  ) OR EXISTS (
    SELECT 1 FROM "SpotProcurementPayment" payment
    WHERE payment."projectId" = OLD."projectId"
      AND payment."invalidatedAt" IS NULL
      AND payment."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
      AND payment."payerCompanyEntityId" = OLD."companyEntityId"
  ) OR EXISTS (
    SELECT 1
    FROM "OperatingFact" fact
    WHERE fact."projectId" = OLD."projectId"
      AND (
        (fact."debtorSubjectKind" = 'participating_company'
          AND fact."debtorSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        OR (fact."creditorSubjectKind" = 'participating_company'
          AND fact."creditorSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        OR (fact."approvedPayerSubjectKind" = 'participating_company'
          AND fact."approvedPayerSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        OR (fact."actualPayerSubjectKind" = 'participating_company'
          AND fact."actualPayerSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        OR (fact."payeeSubjectKind" = 'participating_company'
          AND fact."payeeSubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
        OR (fact."costBearingCompanySubjectKind" = 'participating_company'
          AND fact."costBearingCompanySubjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId"))
      )
  ) OR EXISTS (
    SELECT 1
    FROM "OperatingImpactEntry" impact
    WHERE impact."projectId" = OLD."projectId"
      AND impact."subjectKind" = 'participating_company'
      AND impact."subjectId" IN (OLD."companyEntityId", OLD."companyEntityVersionId")
  ) THEN
    RAISE EXCEPTION '该公司已有正式经营事实，只能停止新增业务，不能删除'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- The Project update owns the root lock. Lock both participant invariant sets
-- in participant relation-id order before validating the historical facts.
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
    PERFORM participant."id"
      FROM "ProjectParticipatingCompany" participant
      WHERE participant."projectId" = OLD."id"
        AND participant."effectiveFrom" <= NEW."operatingLedgerEffectiveDate"
        AND (
          participant."endedAt" IS NULL
          OR participant."endedAt" > NEW."operatingLedgerEffectiveDate"
        )
      ORDER BY participant."id" FOR SHARE;
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
      NEW."constructionEnterpriseLockedAt" := COALESCE(
        NEW."constructionEnterpriseLockedAt",
        first_formal_fact_at
      );
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
      WHERE (
        reference."affiliateAssignmentId" IS NOT NULL
        AND reference."affiliateAssignmentId" <> current_assignment_id
      ) OR (
        reference."affiliateBusinessPartyVersionId" IS NOT NULL
        AND reference."affiliateBusinessPartyVersionId" <> current_assignment_version_id
      )
    ) THEN
      RAISE EXCEPTION '项目已有正式经营事实引用的施工企业与当前映射不一致，请先人工修复'
        USING ERRCODE = '23514';
    END IF;

    PERFORM participant."id"
    FROM "ProjectParticipatingCompany" participant
    INNER JOIN (
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
      ON company."companyEntityId" IS NOT NULL
     AND participant."companyEntityId" = company."companyEntityId"
     AND participant."effectiveFrom" <= company."occurredAt"::DATE
     AND (
       participant."endedAt" IS NULL
       OR participant."endedAt" > company."occurredAt"::DATE
     )
    WHERE participant."projectId" = OLD."id"
    ORDER BY participant."id" FOR SHARE OF participant;

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
      IF NOT EXISTS (
        SELECT 1 FROM "ProjectParticipatingCompany" participant
        WHERE participant."projectId" = OLD."id"
          AND participant."companyEntityId" = company_fact."companyEntityId"
          AND participant."effectiveFrom" <= company_fact."occurredAt"::DATE
          AND (
            participant."endedAt" IS NULL
            OR participant."endedAt" > company_fact."occurredAt"::DATE
          )
      ) THEN
        RAISE EXCEPTION '项目已有正式经营事实引用的公司未覆盖对应参与期间'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
