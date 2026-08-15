-- POL-06 接入费用、借款与还款正式来源所需的员工主体；不改变其他主体角色范围。
ALTER TABLE "OperatingFact"
  DROP CONSTRAINT "OperatingFact_supported_subject_check",
  ADD CONSTRAINT "OperatingFact_supported_subject_check"
    CHECK (
      COALESCE("debtorSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'employee'), TRUE) AND
      COALESCE("creditorSubjectKind" IN ('construction_enterprise', 'participating_company', 'downstream_counterparty'), TRUE) AND
      COALESCE("approvedPayerSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("actualPayerSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'employee'), TRUE) AND
      COALESCE("payeeSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee'), TRUE) AND
      COALESCE("costBearingCompanySubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE)
    );

ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_supported_subject_check",
  ADD CONSTRAINT "OperatingImpactEntry_supported_subject_check"
    CHECK (
      "subjectKind" IS NULL OR (
        "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty', 'employee') AND
        CASE "subjectRole"
          WHEN 'debtor' THEN "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'employee')
          WHEN 'creditor' THEN "subjectKind" IN ('construction_enterprise', 'participating_company', 'downstream_counterparty')
          WHEN 'approved_payer' THEN "subjectKind" IN ('construction_enterprise', 'participating_company')
          WHEN 'actual_payer' THEN "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'employee')
          WHEN 'payee' THEN TRUE
          WHEN 'cost_bearing_company' THEN "subjectKind" IN ('construction_enterprise', 'participating_company')
          ELSE "subjectRole" IS NULL
        END
      )
    );

-- 保留 POL-05 的事实日、参与主体和追加校验，只扩展员工主体的失败关闭基线。
DO $pol06_employee_subjects$
DECLARE
  fact_definition TEXT;
  impact_definition TEXT;
  rewritten_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::REGPROCEDURE)
    INTO fact_definition;
  rewritten_definition := replace(
    fact_definition,
    'candidate_subject->>''kind'' NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'')',
    'candidate_subject->>''kind'' NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'', ''employee'')'
  );
  IF rewritten_definition = fact_definition THEN
    RAISE EXCEPTION 'POL-06 未找到 POL-05 经营事实主体基线，拒绝漂移升级';
  END IF;
  EXECUTE rewritten_definition;

  SELECT pg_get_functiondef('"validateOperatingImpactEntryReferences"()'::REGPROCEDURE)
    INTO impact_definition;
  rewritten_definition := replace(
    impact_definition,
    'NEW."subjectKind" NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'')',
    'NEW."subjectKind" NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'', ''employee'')'
  );
  IF rewritten_definition = impact_definition THEN
    RAISE EXCEPTION 'POL-06 未找到 POL-05 经营影响主体基线，拒绝漂移升级';
  END IF;
  EXECUTE rewritten_definition;
END;
$pol06_employee_subjects$;
