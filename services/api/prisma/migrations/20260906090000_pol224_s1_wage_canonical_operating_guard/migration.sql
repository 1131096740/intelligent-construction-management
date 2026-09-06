-- POL224-S1: align the generic project_wage envelope guard with the canonical
-- ordinary wage projection.  The exception is graph-backed: a caller cannot
-- obtain it merely by claiming the wage_statement_version sourceType.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 31);

CREATE OR REPLACE FUNCTION jg_canonical_wage_delta_projection(
  version_id TEXT,
  project_id TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
WITH current_version AS (
  SELECT version."id", version."statementId", version."revision",
    statement."employmentCompanyId" AS employment_company_id
  FROM "WageStatementVersion" version
  JOIN "WageStatement" statement ON statement."id" = version."statementId"
  WHERE version."id" = version_id
),
prior_version AS (
  SELECT prior."id"
  FROM "WageStatementVersion" prior
  JOIN current_version current
    ON current."statementId" = prior."statementId"
  WHERE prior."status" = 'confirmed'
    AND prior."revision" < current."revision"
  ORDER BY prior."revision" DESC
  LIMIT 1
),
current_costs AS (
  SELECT cell."id" AS cell_id,
    allocation."projectId" AS cell_project_id,
    allocation."serviceSnapshotId" AS service_snapshot_id,
    person."employeeId" AS employee_id,
    person."employmentSnapshotId" AS employment_snapshot_id,
    component."componentCode" AS component_code,
    cell."amountCents" AS amount_cents
  FROM "WageProjectCostComponentAllocation" cell
  JOIN "WageProjectAllocation" allocation
    ON allocation."id" = cell."projectAllocationId"
  JOIN "WagePersonLine" person
    ON person."id" = allocation."personLineId"
  JOIN "WageCostComponent" component
    ON component."id" = cell."costComponentId"
  WHERE person."statementVersionId" = version_id
),
prior_costs AS (
  SELECT allocation."projectId" AS cell_project_id,
    allocation."serviceSnapshotId" AS service_snapshot_id,
    person."employeeId" AS employee_id,
    person."employmentSnapshotId" AS employment_snapshot_id,
    component."componentCode" AS component_code,
    cell."amountCents" AS amount_cents
  FROM "WageProjectCostComponentAllocation" cell
  JOIN "WageProjectAllocation" allocation
    ON allocation."id" = cell."projectAllocationId"
  JOIN "WagePersonLine" person
    ON person."id" = allocation."personLineId"
  JOIN "WageCostComponent" component
    ON component."id" = cell."costComponentId"
  WHERE person."statementVersionId" = (SELECT "id" FROM prior_version)
),
cost_deltas AS (
  SELECT current.cell_id,
    current.amount_cents - COALESCE(prior.amount_cents, 0) AS delta_cents
  FROM current_costs current
  LEFT JOIN prior_costs prior
    ON prior.cell_project_id = current.cell_project_id
   AND prior.service_snapshot_id = current.service_snapshot_id
   AND prior.employee_id = current.employee_id
   AND prior.employment_snapshot_id = current.employment_snapshot_id
   AND prior.component_code = current.component_code
  WHERE current.cell_project_id = project_id
),
current_payables AS (
  SELECT allocation."id" AS project_allocation_id,
    creditor."id" AS creditor_breakdown_id,
    allocation."projectId" AS cell_project_id,
    allocation."serviceSnapshotId" AS service_snapshot_id,
    person."employeeId" AS employee_id,
    person."employmentSnapshotId" AS employment_snapshot_id,
    creditor."creditorSubjectType" AS creditor_subject_type,
    creditor."creditorSubjectIdentityKey" AS creditor_identity_key,
    creditor."creditorCategory" AS creditor_category,
    cell."amountCents" AS amount_cents
  FROM "WageProjectCreditorAllocation" cell
  JOIN "WageProjectAllocation" allocation
    ON allocation."id" = cell."projectAllocationId"
  JOIN "WagePersonLine" person
    ON person."id" = allocation."personLineId"
  JOIN "WageCreditorBreakdown" creditor
    ON creditor."id" = cell."creditorBreakdownId"
  WHERE person."statementVersionId" = version_id
),
prior_payables AS (
  SELECT allocation."projectId" AS cell_project_id,
    allocation."serviceSnapshotId" AS service_snapshot_id,
    person."employeeId" AS employee_id,
    person."employmentSnapshotId" AS employment_snapshot_id,
    creditor."creditorSubjectType" AS creditor_subject_type,
    creditor."creditorSubjectIdentityKey" AS creditor_identity_key,
    creditor."creditorCategory" AS creditor_category,
    cell."amountCents" AS amount_cents
  FROM "WageProjectCreditorAllocation" cell
  JOIN "WageProjectAllocation" allocation
    ON allocation."id" = cell."projectAllocationId"
  JOIN "WagePersonLine" person
    ON person."id" = allocation."personLineId"
  JOIN "WageCreditorBreakdown" creditor
    ON creditor."id" = cell."creditorBreakdownId"
  WHERE person."statementVersionId" = (SELECT "id" FROM prior_version)
),
payable_deltas AS (
  SELECT current.project_allocation_id,
    current.creditor_breakdown_id,
    current.amount_cents - COALESCE(prior.amount_cents, 0) AS delta_cents,
    roots.expected_root_id,
    roots.expected_root_count
  FROM current_payables current
  LEFT JOIN prior_payables prior
    ON prior.cell_project_id = current.cell_project_id
   AND prior.service_snapshot_id = current.service_snapshot_id
   AND prior.employee_id = current.employee_id
   AND prior.employment_snapshot_id = current.employment_snapshot_id
   AND prior.creditor_subject_type IS NOT DISTINCT FROM current.creditor_subject_type
   AND prior.creditor_identity_key IS NOT DISTINCT FROM current.creditor_identity_key
   AND prior.creditor_category = current.creditor_category
  CROSS JOIN LATERAL (
    SELECT min(root."id") AS expected_root_id,
      count(*)::BIGINT AS expected_root_count
    FROM "WagePayableRef" root
    JOIN "WageStatementVersion" root_version
      ON root_version."id" = root."confirmedVersionId"
    JOIN "WageProjectAllocation" root_allocation
      ON root_allocation."id" = root."projectAllocationId"
    JOIN "WagePersonLine" root_person
      ON root_person."id" = root."personLineId"
    JOIN "WageCreditorBreakdown" root_creditor
      ON root_creditor."id" = root."creditorBreakdownId"
    WHERE root."adjustsPayableRefId" IS NULL
      AND root."direction" = 'increase'
      AND root_version."statementId" = (SELECT "statementId" FROM current_version)
      AND root_version."revision" < (SELECT "revision" FROM current_version)
      AND root_version."status" = 'confirmed'
      AND root."debtorCompanyId" = (SELECT employment_company_id FROM current_version)
      AND root."costBearingCompanyId" = (SELECT employment_company_id FROM current_version)
      AND root."projectId" = current.cell_project_id
      AND root_allocation."serviceSnapshotId" = current.service_snapshot_id
      AND root_person."employeeId" = current.employee_id
      AND root_person."employmentSnapshotId" = current.employment_snapshot_id
      AND root_creditor."creditorSubjectType" IS NOT DISTINCT FROM current.creditor_subject_type
      AND root_creditor."creditorSubjectIdentityKey" IS NOT DISTINCT FROM current.creditor_identity_key
      AND root_creditor."creditorCategory" = current.creditor_category
  ) roots
  WHERE current.cell_project_id = project_id
)
SELECT jsonb_build_object(
  'priorVersionId', (SELECT "id" FROM prior_version),
  'missingPriorCostIdentities', EXISTS (
    SELECT 1
    FROM prior_costs prior
    WHERE prior.amount_cents > 0
      AND NOT EXISTS (
        SELECT 1 FROM current_costs current
        WHERE current.cell_project_id = prior.cell_project_id
          AND current.service_snapshot_id = prior.service_snapshot_id
          AND current.employee_id = prior.employee_id
          AND current.employment_snapshot_id = prior.employment_snapshot_id
          AND current.component_code = prior.component_code
      )
  ),
  'missingPriorPayableIdentities', EXISTS (
    SELECT 1
    FROM prior_payables prior
    WHERE prior.amount_cents > 0
      AND NOT EXISTS (
        SELECT 1 FROM current_payables current
        WHERE current.cell_project_id = prior.cell_project_id
          AND current.service_snapshot_id = prior.service_snapshot_id
          AND current.employee_id = prior.employee_id
          AND current.employment_snapshot_id = prior.employment_snapshot_id
          AND current.creditor_subject_type IS NOT DISTINCT FROM prior.creditor_subject_type
          AND current.creditor_identity_key IS NOT DISTINCT FROM prior.creditor_identity_key
          AND current.creditor_category = prior.creditor_category
      )
  ),
  'reversalHasNonZero', EXISTS (
    SELECT 1 FROM current_costs WHERE amount_cents <> 0
    UNION ALL
    SELECT 1 FROM current_payables WHERE amount_cents <> 0
  ),
  'costTotalCents', COALESCE((SELECT sum(abs(delta_cents)) FROM cost_deltas), 0),
  'payableTotalCents', COALESCE((SELECT sum(abs(delta_cents)) FROM payable_deltas), 0),
  'costCells', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', cell_id,
        'direction', CASE WHEN delta_cents > 0 THEN 'increase' ELSE 'decrease' END
      ) ORDER BY cell_id
    )
    FROM cost_deltas
    WHERE delta_cents <> 0
  ), '[]'::JSONB),
  'payableCells', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'projectAllocationId', project_allocation_id,
        'creditorBreakdownId', creditor_breakdown_id,
        'amountCents', abs(delta_cents),
        'direction', CASE WHEN delta_cents > 0 THEN 'increase' ELSE 'decrease' END,
        'expectedRootId', expected_root_id,
        'expectedRootCount', expected_root_count
      ) ORDER BY project_allocation_id, creditor_breakdown_id
    )
    FROM payable_deltas
    WHERE delta_cents <> 0
  ), '[]'::JSONB)
);
$$;

CREATE OR REPLACE FUNCTION jg_assert_canonical_wage_payable_root(
  actual_root_id TEXT,
  expected_root_id TEXT,
  expected_root_count BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF expected_root_count IS DISTINCT FROM 1
     OR actual_root_id IS DISTINCT FROM expected_root_id THEN
    RAISE EXCEPTION '普通工资更正或冲销必须逐笔绑定唯一原始应付引用'
      USING ERRCODE = '23514';
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION jg_validate_canonical_wage_operating_deltas(
  candidate "OperatingFact",
  version_kind TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  projection JSONB;
  expected_amount NUMERIC;
BEGIN
  projection := jg_canonical_wage_delta_projection(
    split_part(candidate."sourceBusinessId", ':', 1),
    candidate."projectId"
  );

  IF (version_kind = 'base' AND projection->>'priorVersionId' IS NOT NULL)
     OR (version_kind <> 'base' AND projection->>'priorVersionId' IS NULL)
     OR COALESCE((projection->>'missingPriorCostIdentities')::BOOLEAN, FALSE)
     OR COALESCE((projection->>'missingPriorPayableIdentities')::BOOLEAN, FALSE)
     OR (version_kind = 'reversal' AND COALESCE((projection->>'reversalHasNonZero')::BOOLEAN, FALSE)) THEN
    RAISE EXCEPTION '普通工资后续版本必须保留相邻已确认版本的完整身份，冲销版本必须为显式零金额矩阵'
      USING ERRCODE = '23514';
  END IF;

  expected_amount := GREATEST(
    (projection->>'costTotalCents')::NUMERIC,
    (projection->>'payableTotalCents')::NUMERIC
  );
  IF candidate."amountCents" IS DISTINCT FROM expected_amount THEN
    RAISE EXCEPTION '普通工资经营事实金额与相邻版本差额不一致'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(candidate."sourceSnapshot"->'costDeltaCells') IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate."sourceSnapshot"->'costDeltaCells')
        IS DISTINCT FROM jsonb_array_length(projection->'costCells')
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(candidate."sourceSnapshot"->'costDeltaCells') cell
       WHERE jsonb_typeof(cell) <> 'object'
         OR jsonb_typeof(cell->'id') <> 'string'
         OR jsonb_typeof(cell->'direction') <> 'string'
         OR NOT (projection->'costCells' @> jsonb_build_array(
           jsonb_build_object('id', cell->>'id', 'direction', cell->>'direction')
         ))
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(candidate."sourceSnapshot"->'costDeltaCells') cell
       GROUP BY cell->>'id'
       HAVING count(*) <> 1
     ) THEN
    RAISE EXCEPTION '普通工资经营事实的成本差额单元不一致'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(candidate."sourceSnapshot"->'payableRefIds') IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate."sourceSnapshot"->'payableRefIds')
        IS DISTINCT FROM jsonb_array_length(projection->'payableCells')
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(projection->'payableCells') expected
       WHERE NOT EXISTS (
         SELECT 1
         FROM "WagePayableRef" payable
         WHERE payable."confirmedVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
           AND payable."projectId" = candidate."projectId"
           AND payable."projectAllocationId" = expected->>'projectAllocationId'
           AND payable."creditorBreakdownId" = expected->>'creditorBreakdownId'
           AND payable."amountCents" = (expected->>'amountCents')::BIGINT
           AND payable."direction" = expected->>'direction'
           AND (
             (version_kind IN ('base', 'supplemental') AND payable."adjustsPayableRefId" IS NULL)
             OR (
               version_kind IN ('correction', 'reversal')
               AND jg_assert_canonical_wage_payable_root(
                 payable."adjustsPayableRefId",
                 expected->>'expectedRootId',
                 (expected->>'expectedRootCount')::BIGINT
               )
             )
           )
           AND candidate."sourceSnapshot"->'payableRefIds' ? payable."id"
       )
     )
     OR EXISTS (
       SELECT 1
       FROM "WagePayableRef" payable
       WHERE payable."confirmedVersionId" = split_part(candidate."sourceBusinessId", ':', 1)
         AND payable."projectId" = candidate."projectId"
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(projection->'payableCells') expected
           WHERE payable."projectAllocationId" = expected->>'projectAllocationId'
             AND payable."creditorBreakdownId" = expected->>'creditorBreakdownId'
             AND payable."amountCents" = (expected->>'amountCents')::BIGINT
             AND payable."direction" = expected->>'direction'
         )
     ) THEN
    RAISE EXCEPTION '普通工资经营事实的逐笔应付引用与相邻版本差额不一致'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

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

  PERFORM jg_validate_canonical_wage_operating_deltas(candidate, version_kind);
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
