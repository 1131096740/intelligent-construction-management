BEGIN;

LOCK TABLE "ProjectFundingAllocation" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ExpenseClaimPaymentExecution" execution
    JOIN "ExpenseClaim" claim ON claim."id" = execution."expenseClaimId"
    WHERE claim."projectId" IS NULL
  ) THEN
    RAISE EXCEPTION '历史报销补付缺少项目，无法建立统一资金分配';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "EmployeeProjectLoanEntry" entry
    JOIN "ExpenseClaim" claim ON claim."id" = entry."sourceExpenseClaimId"
    WHERE entry."entryType" = 'disbursement'
      AND claim."projectId" IS NULL
  ) THEN
    RAISE EXCEPTION '历史借款放款缺少项目，无法建立统一资金分配';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProjectFinancingQuotaUsage" usage
    JOIN "PaymentRequest" payment ON payment."id" = usage."paymentRequestId"
    JOIN "ProjectFinancingQuota" quota ON quota."id" = usage."quotaId"
    WHERE usage."status" = 'used'
      AND (
        usage."projectId" <> payment."projectId"
        OR usage."projectId" <> quota."projectId"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "ProjectExpenseFinancingQuotaUsage" usage
    JOIN "ProjectExpenseRequest" request
      ON request."id" = usage."projectExpenseRequestId"
    JOIN "ProjectFinancingQuota" quota ON quota."id" = usage."quotaId"
    WHERE usage."status" = 'used'
      AND (
        usage."projectId" <> request."projectId"
        OR usage."projectId" <> quota."projectId"
      )
  ) THEN
    RAISE EXCEPTION '历史垫资使用的项目、业务单或额度项目不一致';
  END IF;
END
$$;

CREATE TEMP TABLE "_ProjectFundingBackfillExecution" (
  "executionType" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  PRIMARY KEY ("executionType", "executionId")
) ON COMMIT DROP;

INSERT INTO "_ProjectFundingBackfillExecution" (
  "executionType",
  "executionId",
  "businessType",
  "businessId",
  "projectId",
  "amountCents",
  "occurredAt",
  "createdByUserId",
  "createdAt",
  "reversedAt",
  "reversedByUserId",
  "reversalReason"
)
SELECT
  'payment_execution',
  execution."id",
  'payment_request',
  payment."id",
  payment."projectId",
  execution."amountCents",
  execution."paidAt",
  execution."executedByUserId",
  execution."createdAt",
  NULL::TIMESTAMP(3),
  NULL::TEXT,
  NULL::TEXT
FROM "PaymentExecution" execution
JOIN "PaymentRequest" payment
  ON payment."id" = execution."paymentRequestId"
UNION ALL
SELECT
  'project_expense_execution',
  execution."id",
  'project_expense_request',
  request."id",
  execution."projectId",
  execution."amountCents",
  execution."paidAt",
  execution."executedByUserId",
  execution."createdAt",
  NULL::TIMESTAMP(3),
  NULL::TEXT,
  NULL::TEXT
FROM "ProjectExpenseExecution" execution
JOIN "ProjectExpenseRequest" request
  ON request."id" = execution."projectExpenseRequestId"
UNION ALL
SELECT
  'spot_procurement_payment_execution',
  execution."id",
  'spot_procurement_payment',
  payment."id",
  payment."projectId",
  execution."amountCents",
  execution."paidAt",
  execution."executedByUserId",
  execution."createdAt",
  execution."voidedAt",
  COALESCE(execution."voidedByUserId", execution."executedByUserId"),
  COALESCE(NULLIF(BTRIM(execution."voidReason"), ''), '历史零星采购实付已作废')
FROM "SpotProcurementPaymentExecution" execution
JOIN "SpotProcurementPayment" payment
  ON payment."id" = execution."paymentId"
UNION ALL
SELECT
  'expense_claim_payment_execution',
  execution."id",
  'expense_claim',
  claim."id",
  claim."projectId",
  execution."amountCents",
  execution."paidAt",
  execution."recordedByUserId",
  execution."createdAt",
  NULL::TIMESTAMP(3),
  NULL::TEXT,
  NULL::TEXT
FROM "ExpenseClaimPaymentExecution" execution
JOIN "ExpenseClaim" claim
  ON claim."id" = execution."expenseClaimId"
WHERE claim."projectId" IS NOT NULL
UNION ALL
SELECT
  'employee_loan_disbursement',
  entry."id",
  'expense_claim',
  claim."id",
  claim."projectId",
  entry."amountCents",
  entry."occurredAt",
  entry."createdByUserId",
  entry."createdAt",
  NULL::TIMESTAMP(3),
  NULL::TEXT,
  NULL::TEXT
FROM "EmployeeProjectLoanEntry" entry
JOIN "ExpenseClaim" claim
  ON claim."id" = entry."sourceExpenseClaimId"
WHERE entry."entryType" = 'disbursement'
  AND claim."projectId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_ProjectFundingBackfillExecution"
    WHERE "amountCents" <= 0
  ) THEN
    RAISE EXCEPTION '历史实际付款存在非正金额，无法建立统一资金分配';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "_ProjectFundingBackfillExecution" execution
    JOIN "ProjectFundingAllocation" allocation
      ON allocation."executionType" = execution."executionType"
      AND allocation."executionId" = execution."executionId"
    GROUP BY
      execution."executionType",
      execution."executionId",
      execution."amountCents",
      execution."projectId",
      execution."businessType",
      execution."businessId"
    HAVING
      SUM(
        CASE
          WHEN allocation."direction" = 'debit'
            THEN allocation."amountCents"
          ELSE 0
        END
      ) <> execution."amountCents"
      OR BOOL_OR(allocation."projectId" <> execution."projectId")
      OR BOOL_OR(allocation."businessType" <> execution."businessType")
      OR BOOL_OR(allocation."businessId" <> execution."businessId")
  ) THEN
    RAISE EXCEPTION '历史实际付款已有不完整或跨项目资金分配';
  END IF;
END
$$;

CREATE TEMP TABLE "_ProjectFundingBackfillExecutionOrder"
ON COMMIT DROP
AS
SELECT
  execution.*,
  SUM(execution."amountCents") OVER (
    PARTITION BY execution."businessType", execution."businessId"
    ORDER BY execution."occurredAt", execution."executionType", execution."executionId"
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) - execution."amountCents" AS "startCents",
  SUM(execution."amountCents") OVER (
    PARTITION BY execution."businessType", execution."businessId"
    ORDER BY execution."occurredAt", execution."executionType", execution."executionId"
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS "endCents"
FROM "_ProjectFundingBackfillExecution" execution;

CREATE TEMP TABLE "_ProjectFundingBackfillPendingExecution"
ON COMMIT DROP
AS
SELECT execution.*
FROM "_ProjectFundingBackfillExecutionOrder" execution
WHERE NOT EXISTS (
  SELECT 1
  FROM "ProjectFundingAllocation" existing
  WHERE existing."executionType" = execution."executionType"
    AND existing."executionId" = execution."executionId"
);

CREATE TEMP TABLE "_ProjectFundingBackfillUsageRaw" (
  "usageId" TEXT NOT NULL,
  "businessType" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "quotaId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("businessType", "usageId")
) ON COMMIT DROP;

INSERT INTO "_ProjectFundingBackfillUsageRaw" (
  "usageId",
  "businessType",
  "businessId",
  "projectId",
  "quotaId",
  "amountCents",
  "createdAt"
)
SELECT
  "id",
  'payment_request',
  "paymentRequestId",
  "projectId",
  "quotaId",
  "amountCents",
  "createdAt"
FROM "ProjectFinancingQuotaUsage"
WHERE "status" = 'used'
UNION ALL
SELECT
  "id",
  'project_expense_request',
  "projectExpenseRequestId",
  "projectId",
  "quotaId",
  "amountCents",
  "createdAt"
FROM "ProjectExpenseFinancingQuotaUsage"
WHERE "status" = 'used';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_ProjectFundingBackfillUsageRaw"
    WHERE "amountCents" <= 0
  ) THEN
    RAISE EXCEPTION '历史垫资已用金额存在非正数';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      WITH usage_totals AS (
        SELECT
          "businessType",
          "businessId",
          SUM("amountCents") AS "usedTotalCents"
        FROM "_ProjectFundingBackfillUsageRaw"
        GROUP BY "businessType", "businessId"
      ),
      execution_totals AS (
        SELECT
          "businessType",
          "businessId",
          MAX("endCents") AS "executionTotalCents"
        FROM "_ProjectFundingBackfillExecutionOrder"
        GROUP BY "businessType", "businessId"
      )
      SELECT
        usage."businessType",
        usage."businessId",
        usage."usedTotalCents",
        COALESCE(execution."executionTotalCents", 0)
          AS "executionTotalCents"
      FROM usage_totals usage
      LEFT JOIN execution_totals execution
        ON execution."businessType" = usage."businessType"
        AND execution."businessId" = usage."businessId"
    ) totals
    WHERE totals."usedTotalCents" > totals."executionTotalCents"
  ) THEN
    RAISE EXCEPTION '历史垫资已用金额超过对应实际付款金额';
  END IF;
END
$$;

CREATE TEMP TABLE "_ProjectFundingBackfillUsageOrder"
ON COMMIT DROP
AS
WITH ranked AS (
  SELECT
    usage.*,
    SUM(usage."amountCents") OVER (
      PARTITION BY usage."businessType", usage."businessId"
      ORDER BY usage."createdAt", usage."usageId"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "usedEndCents",
    SUM(usage."amountCents") OVER (
      PARTITION BY usage."businessType", usage."businessId"
    ) AS "usedTotalCents"
  FROM "_ProjectFundingBackfillUsageRaw" usage
),
execution_totals AS (
  SELECT
    "businessType",
    "businessId",
    MAX("endCents") AS "executionTotalCents"
  FROM "_ProjectFundingBackfillExecutionOrder"
  GROUP BY "businessType", "businessId"
)
SELECT
  ranked."usageId",
  ranked."businessType",
  ranked."businessId",
  ranked."projectId",
  ranked."quotaId",
  ranked."amountCents",
  totals."executionTotalCents" - ranked."usedTotalCents"
    + ranked."usedEndCents" - ranked."amountCents" AS "startCents",
  totals."executionTotalCents" - ranked."usedTotalCents"
    + ranked."usedEndCents" AS "endCents"
FROM ranked
JOIN execution_totals totals
  ON totals."businessType" = ranked."businessType"
  AND totals."businessId" = ranked."businessId";

WITH raw_funding_overlaps AS (
  SELECT
    e."executionType",
    e."executionId",
    e."businessType",
    e."businessId",
    e."projectId",
    e."occurredAt",
    e."createdByUserId",
    e."createdAt",
    u."quotaId",
    GREATEST(
      0::BIGINT,
      LEAST(e."endCents", u."endCents")
        - GREATEST(e."startCents", u."startCents")
    ) AS "amountCents"
  FROM "_ProjectFundingBackfillExecutionOrder" e
  JOIN "_ProjectFundingBackfillUsageOrder" u
    ON u."businessType" = e."businessType"
    AND u."businessId" = e."businessId"
    AND LEAST(e."endCents", u."endCents")
      > GREATEST(e."startCents", u."startCents")
),
funding_overlaps AS (
  SELECT
    "executionType",
    "executionId",
    "businessType",
    "businessId",
    "projectId",
    "occurredAt",
    "createdByUserId",
    "createdAt",
    "quotaId",
    SUM("amountCents") AS "amountCents"
  FROM raw_funding_overlaps
  GROUP BY
    "executionType",
    "executionId",
    "businessType",
    "businessId",
    "projectId",
    "occurredAt",
    "createdByUserId",
    "createdAt",
    "quotaId"
)
INSERT INTO "ProjectFundingAllocation" (
  "id",
  "projectId",
  "executionType",
  "executionId",
  "businessType",
  "businessId",
  "sourceType",
  "sourceKey",
  "sourceId",
  "direction",
  "amountCents",
  "occurredAt",
  "createdByUserId",
  "reversalOfAllocationId",
  "reversalKey",
  "reason",
  "createdAt"
)
SELECT
  'pf-backfill-' || MD5(
    overlap."executionType" || ':' || overlap."executionId"
      || ':financing_quota:' || overlap."quotaId"
  ),
  overlap."projectId",
  overlap."executionType",
  overlap."executionId",
  overlap."businessType",
  overlap."businessId",
  'financing_quota',
  'financing_quota:' || overlap."quotaId",
  overlap."quotaId",
  'debit',
  overlap."amountCents",
  overlap."occurredAt",
  overlap."createdByUserId",
  NULL,
  'original',
  '历史垫资已用事实前向桥接',
  overlap."createdAt"
FROM funding_overlaps overlap
WHERE overlap."amountCents" > 0
  AND EXISTS (
    SELECT 1
    FROM "_ProjectFundingBackfillPendingExecution" pending
    WHERE pending."executionType" = overlap."executionType"
      AND pending."executionId" = overlap."executionId"
  )
ON CONFLICT DO NOTHING;

WITH financing_by_execution AS (
  SELECT
    e."executionType",
    e."executionId",
    COALESCE(SUM(
      CASE
        WHEN u."usageId" IS NULL THEN 0::BIGINT
        ELSE GREATEST(
          0::BIGINT,
          LEAST(e."endCents", u."endCents")
            - GREATEST(e."startCents", u."startCents")
        )
      END
    ), 0) AS "financingAmountCents"
  FROM "_ProjectFundingBackfillExecutionOrder" e
  LEFT JOIN "_ProjectFundingBackfillUsageOrder" u
    ON u."businessType" = e."businessType"
    AND u."businessId" = e."businessId"
    AND LEAST(e."endCents", u."endCents")
      > GREATEST(e."startCents", u."startCents")
  GROUP BY e."executionType", e."executionId"
),
cash_allocations AS (
  SELECT
    e.*,
    e."amountCents" - financing."financingAmountCents"
      AS "cashAmountCents"
  FROM "_ProjectFundingBackfillExecutionOrder" e
  JOIN financing_by_execution financing
    ON financing."executionType" = e."executionType"
    AND financing."executionId" = e."executionId"
)
INSERT INTO "ProjectFundingAllocation" (
  "id",
  "projectId",
  "executionType",
  "executionId",
  "businessType",
  "businessId",
  "sourceType",
  "sourceKey",
  "sourceId",
  "direction",
  "amountCents",
  "occurredAt",
  "createdByUserId",
  "reversalOfAllocationId",
  "reversalKey",
  "reason",
  "createdAt"
)
SELECT
  'pf-backfill-' || MD5(
    allocation."executionType" || ':' || allocation."executionId"
      || ':project_cash'
  ),
  allocation."projectId",
  allocation."executionType",
  allocation."executionId",
  allocation."businessType",
  allocation."businessId",
  'project_cash',
  'project_cash',
  NULL,
  'debit',
  allocation."cashAmountCents",
  allocation."occurredAt",
  allocation."createdByUserId",
  NULL,
  'original',
  '历史实际付款前向桥接',
  allocation."createdAt"
FROM cash_allocations allocation
WHERE allocation."cashAmountCents" > 0
  AND EXISTS (
    SELECT 1
    FROM "_ProjectFundingBackfillPendingExecution" pending
    WHERE pending."executionType" = allocation."executionType"
      AND pending."executionId" = allocation."executionId"
  )
ON CONFLICT DO NOTHING;

INSERT INTO "ProjectFundingAllocation" (
  "id",
  "projectId",
  "executionType",
  "executionId",
  "businessType",
  "businessId",
  "sourceType",
  "sourceKey",
  "sourceId",
  "direction",
  "amountCents",
  "occurredAt",
  "createdByUserId",
  "reversalOfAllocationId",
  "reversalKey",
  "reason",
  "createdAt"
)
SELECT
  'pf-backfill-' || MD5(
    debit."executionType" || ':' || debit."executionId"
      || ':' || debit."sourceKey" || ':historical-void'
  ),
  debit."projectId",
  debit."executionType",
  debit."executionId",
  debit."businessType",
  debit."businessId",
  debit."sourceType",
  debit."sourceKey",
  debit."sourceId",
  'credit',
  debit."amountCents",
  e."reversedAt",
  e."reversedByUserId",
  debit."id",
  'historical-void:' || e."executionId",
  e."reversalReason",
  e."reversedAt"
FROM "_ProjectFundingBackfillExecution" e
JOIN "ProjectFundingAllocation" debit
  ON debit."executionType" = e."executionType"
  AND debit."executionId" = e."executionId"
  AND debit."direction" = 'debit'
  AND debit."reversalKey" = 'original'
WHERE e."executionType" = 'spot_procurement_payment_execution'
  AND e."reversedAt" IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  execution_mismatch_details TEXT;
BEGIN
  SELECT STRING_AGG(
    mismatch."executionType" || ':' || mismatch."executionId"
      || '=' || mismatch."allocatedCents"::TEXT
      || '/' || mismatch."executionCents"::TEXT,
    ','
    ORDER BY mismatch."executionType", mismatch."executionId"
  )
  INTO execution_mismatch_details
  FROM (
    SELECT
      execution."executionType",
      execution."executionId",
      execution."amountCents" AS "executionCents",
      COALESCE(SUM(allocation."amountCents"), 0)
        AS "allocatedCents"
    FROM "_ProjectFundingBackfillExecution" execution
    LEFT JOIN "ProjectFundingAllocation" allocation
      ON allocation."executionType" = execution."executionType"
      AND allocation."executionId" = execution."executionId"
      AND allocation."direction" = 'debit'
    GROUP BY
      execution."executionType",
      execution."executionId",
      execution."amountCents"
    HAVING COALESCE(SUM(allocation."amountCents"), 0)
      <> execution."amountCents"
  ) mismatch;

  IF execution_mismatch_details IS NOT NULL THEN
    RAISE EXCEPTION
      '历史实际付款资金分配总额与执行金额不一致: %',
      execution_mismatch_details;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      WITH usage_totals AS (
        SELECT
          "businessType",
          "businessId",
          "quotaId",
          SUM("amountCents") AS "usedAmountCents"
        FROM "_ProjectFundingBackfillUsageRaw"
        GROUP BY "businessType", "businessId", "quotaId"
      ),
      allocation_totals AS (
        SELECT
          "businessType",
          "businessId",
          "sourceId" AS "quotaId",
          SUM("amountCents") AS "allocatedAmountCents"
        FROM "ProjectFundingAllocation"
        WHERE "sourceType" = 'financing_quota'
          AND "direction" = 'debit'
        GROUP BY "businessType", "businessId", "sourceId"
      )
      SELECT
        usage."businessType",
        usage."businessId",
        usage."quotaId",
        usage."usedAmountCents",
        COALESCE(allocation."allocatedAmountCents", 0)
          AS "allocatedAmountCents"
      FROM usage_totals usage
      LEFT JOIN allocation_totals allocation
        ON allocation."businessType" = usage."businessType"
        AND allocation."businessId" = usage."businessId"
        AND allocation."quotaId" = usage."quotaId"
    ) totals
    WHERE totals."usedAmountCents" <> totals."allocatedAmountCents"
  ) THEN
    RAISE EXCEPTION '历史垫资已用金额与新资金分配不一致';
  END IF;
END
$$;

COMMIT;
