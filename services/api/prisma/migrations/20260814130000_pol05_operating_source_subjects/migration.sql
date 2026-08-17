-- POL-05 接入业主与下游相对方正式来源；员工主体仍由后续票失败关闭。
ALTER TABLE "OperatingFact"
  DROP CONSTRAINT "OperatingFact_supported_subject_check",
  ADD CONSTRAINT "OperatingFact_supported_subject_check"
    CHECK (
      COALESCE("debtorSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("creditorSubjectKind" IN ('construction_enterprise', 'participating_company', 'downstream_counterparty'), TRUE) AND
      COALESCE("approvedPayerSubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("actualPayerSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company'), TRUE) AND
      COALESCE("payeeSubjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty'), TRUE) AND
      COALESCE("costBearingCompanySubjectKind" IN ('construction_enterprise', 'participating_company'), TRUE)
    );

ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_supported_subject_check",
  ADD CONSTRAINT "OperatingImpactEntry_supported_subject_check"
    CHECK (
      "subjectKind" IS NULL OR (
        "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company', 'downstream_counterparty') AND
        CASE "subjectRole"
          WHEN 'debtor' THEN "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company')
          WHEN 'creditor' THEN "subjectKind" IN ('construction_enterprise', 'participating_company', 'downstream_counterparty')
          WHEN 'approved_payer' THEN "subjectKind" IN ('construction_enterprise', 'participating_company')
          WHEN 'actual_payer' THEN "subjectKind" IN ('owner', 'construction_enterprise', 'participating_company')
          WHEN 'payee' THEN TRUE
          WHEN 'cost_bearing_company' THEN "subjectKind" IN ('construction_enterprise', 'participating_company')
          ELSE "subjectRole" IS NULL
        END
      )
    );

-- 保留 POL-03 的全部引用、期间、追加和权限校验，只扩展本票正式接入的两类主体。
DO $pol05_subjects$
DECLARE
  fact_definition TEXT;
  impact_definition TEXT;
  rewritten_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::REGPROCEDURE)
    INTO fact_definition;
  rewritten_definition := replace(
    fact_definition,
    'candidate_subject->>''kind'' NOT IN (''construction_enterprise'', ''participating_company'')',
    'candidate_subject->>''kind'' NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'')'
  );
  IF rewritten_definition = fact_definition THEN
    RAISE EXCEPTION 'POL-05 未找到经营事实主体失败关闭基线，拒绝漂移升级';
  END IF;
  EXECUTE rewritten_definition;

  SELECT pg_get_functiondef('"validateOperatingImpactEntryReferences"()'::REGPROCEDURE)
    INTO impact_definition;
  rewritten_definition := replace(
    impact_definition,
    'NEW."subjectKind" NOT IN (''construction_enterprise'', ''participating_company'')',
    'NEW."subjectKind" NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'')'
  );
  IF rewritten_definition = impact_definition THEN
    RAISE EXCEPTION 'POL-05 未找到经营影响主体失败关闭基线，拒绝漂移升级';
  END IF;
  EXECUTE rewritten_definition;
END;
$pol05_subjects$;
