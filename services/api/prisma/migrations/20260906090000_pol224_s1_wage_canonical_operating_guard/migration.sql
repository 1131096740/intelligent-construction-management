-- POL224-S1: align the generic project_wage envelope guard with the canonical
-- ordinary wage projection.  The exception is graph-backed: a caller cannot
-- obtain it merely by claiming the wage_statement_version sourceType.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 31);

CREATE OR REPLACE FUNCTION jg_validate_canonical_wage_operating_fact(
  candidate "OperatingFact"
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  version_kind TEXT;
BEGIN
  IF candidate."sourceType" <> 'wage_statement_version'
     OR candidate."factKind" <> 'project_wage'
     OR candidate."operatingLevel" <> 'participating_company'
     OR candidate."evidenceLevel" <> 'A'
     OR candidate."currencyCode" <> 'CNY'
     OR candidate."direction" <> 'neutral'
     OR candidate."status" <> 'confirmed'
     OR candidate."debtorSubjectKind" <> 'participating_company'
     OR candidate."costBearingCompanySubjectKind" <> 'participating_company'
     OR candidate."debtorSubjectId" IS NULL
     OR candidate."debtorSubjectId" IS DISTINCT FROM candidate."costBearingCompanySubjectId"
     OR candidate."creditorSubjectKind" IS NOT NULL
     OR candidate."creditorSubjectId" IS NOT NULL
     OR candidate."payeeSubjectKind" IS NOT NULL
     OR candidate."payeeSubjectId" IS NOT NULL
     OR candidate."approvedPayerSubjectKind" IS NOT NULL
     OR candidate."approvedPayerSubjectId" IS NOT NULL
     OR candidate."actualPayerSubjectKind" IS NOT NULL
     OR candidate."actualPayerSubjectId" IS NOT NULL THEN
    RAISE EXCEPTION '普通工资聚合事实必须仅冻结同一劳动关系公司的债务和成本主体，且不得设置聚合收款主体'
      USING ERRCODE = '23514';
  END IF;

  SELECT version."kind"
    INTO version_kind
    FROM "WageStatementVersion" version
    JOIN "WageStatement" statement
      ON statement."id" = version."statementId"
    JOIN "WageApprovedSourceVersion" source
      ON source."id" = version."sourceVersionId"
    JOIN "User" confirmer
      ON confirmer."id" = candidate."confirmedByUserId"
     AND confirmer."isActive" = TRUE
    WHERE candidate."sourceBusinessId" = version."id" || ':' || candidate."projectId"
      AND candidate."sourceVersion" = version."revision"
      AND version."status" = 'submitted'
      AND version."projectionOrigin" = 'ordinary'
      AND statement."currentRevision" = version."revision"
      AND statement."employmentCompanyId" = source."employmentCompanyId"
      AND statement."employmentCompanyId" = candidate."debtorSubjectId"
      AND statement."wageMonth" = source."wageMonth"
      AND source."periodStart" <= source."periodEnd"
      AND source."periodEnd"::TIMESTAMP = candidate."occurredAt"
      AND candidate."confirmedAt" IS NOT NULL
      AND candidate."confirmedByUserId" IS NOT NULL
      AND candidate."confirmedByUserId" IS DISTINCT FROM version."createdByUserId"
      AND candidate."confirmedByUserId" IS DISTINCT FROM version."lastEditedByUserId"
      AND candidate."confirmedByUserId" IS DISTINCT FROM version."submittedByUserId"
      AND EXISTS (
        SELECT 1
        FROM "UserPosition" user_position
        JOIN "Position" position ON position."id" = user_position."positionId"
        WHERE user_position."userId" = candidate."confirmedByUserId"
          AND user_position."projectId" IS NULL
          AND position."key" = 'finance_director'
      )
      AND jsonb_typeof(candidate."sourceSnapshot") = 'object'
      AND candidate."sourceSnapshot"->>'formalStatus' = 'confirmed'
      AND candidate."sourceSnapshot"->>'projectionOrigin' = 'ordinary'
      AND candidate."sourceSnapshot"->>'wageStatementVersionId' = version."id"
      AND candidate."sourceSnapshot"->>'sourceVersion' = version."revision"::TEXT
      AND candidate."sourceSnapshot"->>'wageVersionKind' = version."kind"
      AND candidate."sourceSnapshot"->>'projectId' = candidate."projectId"
      AND candidate."sourceSnapshot"->>'employmentCompanyId' = statement."employmentCompanyId"
      AND candidate."sourceSnapshot"->>'confirmedByUserId' = candidate."confirmedByUserId"
      AND (candidate."sourceSnapshot"->>'occurredAt')::TIMESTAMPTZ = candidate."occurredAt" AT TIME ZONE 'UTC'
      AND (candidate."sourceSnapshot"->>'confirmedAt')::TIMESTAMPTZ = candidate."confirmedAt" AT TIME ZONE 'UTC'
      AND version."operatingProjectionSnapshot"->>'formalStatus' = 'confirmed'
      AND version."operatingProjectionSnapshot"->>'wageStatementVersionId' = version."id"
      AND version."operatingProjectionSnapshot"->>'sourceVersion' = version."revision"::TEXT
      AND version."operatingProjectionSnapshot"->>'wageVersionKind' = version."kind"
      AND version."operatingProjectionSnapshot"->'projects'->candidate."projectId" = candidate."sourceSnapshot"
    FOR KEY SHARE OF version, statement, source, confirmer;

  IF version_kind IS NULL THEN
    RAISE EXCEPTION '普通工资经营事实必须引用待确认的真实工资版本、来源、项目和有效确认人'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "WageProjectAllocation" allocation
    JOIN "WagePersonLine" person
      ON person."id" = allocation."personLineId"
    WHERE person."statementVersionId" =
      split_part(candidate."sourceBusinessId", ':', 1)
      AND allocation."projectId" = candidate."projectId"
  ) THEN
    RAISE EXCEPTION '普通工资经营事实引用的项目不属于该工资版本'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WagePersonLine" person
    WHERE person."statementVersionId" =
      split_part(candidate."sourceBusinessId", ':', 1)
      AND (
        person."approvedAmountCents" IS DISTINCT FROM (
          SELECT COALESCE(sum(component."amountCents"), 0)
          FROM "WageCostComponent" component
          WHERE component."personLineId" = person."id"
        )
        OR person."approvedAmountCents" IS DISTINCT FROM (
          SELECT COALESCE(sum(creditor."amountCents"), 0)
          FROM "WageCreditorBreakdown" creditor
          WHERE creditor."personLineId" = person."id"
        )
        OR person."approvedAmountCents" IS DISTINCT FROM (
          SELECT COALESCE(sum(allocation."amountCents"), 0)
          FROM "WageProjectAllocation" allocation
          WHERE allocation."personLineId" = person."id"
        )
        OR (
          SELECT count(*)
          FROM "WageProjectCostComponentAllocation" cell
          JOIN "WageProjectAllocation" allocation
            ON allocation."id" = cell."projectAllocationId"
          WHERE allocation."personLineId" = person."id"
        ) IS DISTINCT FROM (
          SELECT count(*) FROM "WageProjectAllocation" allocation
          WHERE allocation."personLineId" = person."id"
        ) * (
          SELECT count(*) FROM "WageCostComponent" component
          WHERE component."personLineId" = person."id"
        )
        OR (
          SELECT count(*)
          FROM "WageProjectCreditorAllocation" cell
          JOIN "WageProjectAllocation" allocation
            ON allocation."id" = cell."projectAllocationId"
          WHERE allocation."personLineId" = person."id"
        ) IS DISTINCT FROM (
          SELECT count(*) FROM "WageProjectAllocation" allocation
          WHERE allocation."personLineId" = person."id"
        ) * (
          SELECT count(*) FROM "WageCreditorBreakdown" creditor
          WHERE creditor."personLineId" = person."id"
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM "WageProjectAllocation" allocation
    JOIN "WagePersonLine" person ON person."id" = allocation."personLineId"
    JOIN "WageServiceBasisBinding" basis ON basis."id" = allocation."serviceBasisBindingId"
    JOIN "WageStatementVersion" version ON version."id" = person."statementVersionId"
    JOIN "WageApprovedSourceVersion" source ON source."id" = version."sourceVersionId"
    WHERE version."id" = split_part(candidate."sourceBusinessId", ':', 1)
      AND (
        allocation."projectId" IS DISTINCT FROM basis."projectId"
        OR allocation."serviceSnapshotId" IS DISTINCT FROM basis."serviceSnapshotId"
        OR basis."sourceVersionId" IS DISTINCT FROM version."sourceVersionId"
        OR basis."serviceMonth" IS DISTINCT FROM source."wageMonth"
        OR basis."evidenceSha256" IS DISTINCT FROM source."evidenceSha256"
        OR allocation."amountCents" IS DISTINCT FROM (
          SELECT COALESCE(sum(cell."amountCents"), 0)
          FROM "WageProjectCostComponentAllocation" cell
          WHERE cell."projectAllocationId" = allocation."id"
        )
        OR allocation."amountCents" IS DISTINCT FROM (
          SELECT COALESCE(sum(cell."amountCents"), 0)
          FROM "WageProjectCreditorAllocation" cell
          WHERE cell."projectAllocationId" = allocation."id"
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM "WageCostComponent" component
    JOIN "WagePersonLine" person ON person."id" = component."personLineId"
    WHERE person."statementVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
      AND component."amountCents" IS DISTINCT FROM (
        SELECT COALESCE(sum(cell."amountCents"), 0)
        FROM "WageProjectCostComponentAllocation" cell
        WHERE cell."costComponentId" = component."id"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "WageCreditorBreakdown" creditor
    JOIN "WagePersonLine" person ON person."id" = creditor."personLineId"
    WHERE person."statementVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
      AND creditor."amountCents" IS DISTINCT FROM (
        SELECT COALESCE(sum(cell."amountCents"), 0)
        FROM "WageProjectCreditorAllocation" cell
        WHERE cell."creditorBreakdownId" = creditor."id"
      )
  ) THEN
    RAISE EXCEPTION '普通工资版本的人员、项目、成本或债权人矩阵不完整或未逐分平衡'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(candidate."sourceSnapshot"->'payableRefIds') IS DISTINCT FROM 'array'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(candidate."sourceSnapshot"->'payableRefIds') value
       WHERE jsonb_typeof(value) <> 'string'
     )
     OR (
       SELECT count(*)
       FROM jsonb_array_elements_text(candidate."sourceSnapshot"->'payableRefIds') value
     ) IS DISTINCT FROM (
       SELECT count(DISTINCT value)
       FROM jsonb_array_elements_text(candidate."sourceSnapshot"->'payableRefIds') value
     )
     OR EXISTS (
       SELECT 1
       FROM "WagePayableRef" payable
       WHERE payable."confirmedVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
         AND payable."projectId" = candidate."projectId"
         AND (
           payable."debtorCompanyId" IS DISTINCT FROM candidate."debtorSubjectId"
           OR payable."costBearingCompanyId" IS DISTINCT FROM candidate."costBearingCompanySubjectId"
           OR payable."amountCents" <= 0
           OR NOT (candidate."sourceSnapshot"->'payableRefIds' ? payable."id")
         )
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(candidate."sourceSnapshot"->'payableRefIds') value
       WHERE NOT EXISTS (
         SELECT 1
         FROM "WagePayableRef" payable
         WHERE payable."id" = value
           AND payable."confirmedVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
           AND payable."projectId" = candidate."projectId"
       )
     ) THEN
    RAISE EXCEPTION '普通工资经营事实与不可变工资应付引用集合不一致'
      USING ERRCODE = '23514';
  END IF;

  IF version_kind = 'base' AND (
    candidate."amountCents" IS DISTINCT FROM (
      SELECT COALESCE(sum(allocation."amountCents"), 0)
      FROM "WageProjectAllocation" allocation
      JOIN "WagePersonLine" person ON person."id" = allocation."personLineId"
      WHERE person."statementVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
        AND allocation."projectId" = candidate."projectId"
    )
    OR EXISTS (
      SELECT 1
      FROM "WageProjectCreditorAllocation" cell
      JOIN "WageProjectAllocation" allocation ON allocation."id" = cell."projectAllocationId"
      JOIN "WagePersonLine" person ON person."id" = allocation."personLineId"
      WHERE person."statementVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
        AND allocation."projectId" = candidate."projectId"
        AND cell."amountCents" > 0
        AND NOT EXISTS (
          SELECT 1
          FROM "WagePayableRef" payable
          WHERE payable."confirmedVersionId" = person."statementVersionId"
            AND payable."projectAllocationId" = allocation."id"
            AND payable."creditorBreakdownId" = cell."creditorBreakdownId"
            AND payable."amountCents" = cell."amountCents"
            AND payable."direction" = 'increase'
            AND payable."adjustsPayableRefId" IS NULL
        )
    )
  ) THEN
    RAISE EXCEPTION '普通基础工资经营事实的金额或逐笔应付引用与冻结矩阵不一致'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DO $migration$
DECLARE
  current_definition TEXT;
  old_fragment TEXT := $old$
  IF NEW."factKind" = 'project_wage'
     AND (NEW."costBearingCompanySubjectKind" IS NULL OR NEW."payeeSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '工资事实必须填写成本承担公司和收款主体' USING ERRCODE = '23514';
  END IF;
$old$;
  new_fragment TEXT := $new$
  IF NEW."factKind" = 'project_wage' THEN
    IF NEW."sourceType" = 'wage_statement_version' THEN
      PERFORM jg_validate_canonical_wage_operating_fact(NEW);
    ELSIF NEW."costBearingCompanySubjectKind" IS NULL OR NEW."payeeSubjectKind" IS NULL THEN
      RAISE EXCEPTION '工资事实必须填写成本承担公司和收款主体' USING ERRCODE = '23514';
    END IF;
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::REGPROCEDURE)
    INTO current_definition;
  IF strpos(current_definition, old_fragment) = 0 THEN
    RAISE EXCEPTION 'POL224-S1 cannot locate the canonical project_wage guard';
  END IF;
  current_definition := replace(current_definition, old_fragment, new_fragment);
  EXECUTE current_definition;
END;
$migration$;

COMMIT;
