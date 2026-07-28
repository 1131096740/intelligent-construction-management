BEGIN;

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "incidentalExpenseCategory" TEXT;

ALTER TABLE "ExpenseClaim"
  DROP CONSTRAINT "ExpenseClaim_claimType_check";

ALTER TABLE "ExpenseClaim"
  ADD CONSTRAINT "ExpenseClaim_claimType_check"
  CHECK ("claimType" IN ('reimbursement', 'loan', 'incidental_expense'));

ALTER TABLE "ExpenseClaim"
  ADD CONSTRAINT "ExpenseClaim_incidental_expense_category_check"
  CHECK (
    (
      "claimType" = 'incidental_expense'
      AND "projectId" IS NOT NULL
      AND "incidentalExpenseCategory" IN (
        'temporary_service',
        'temporary_machinery_shift',
        'sporadic_labor',
        'other_incidental'
      )
    )
    OR (
      "claimType" <> 'incidental_expense'
      AND "incidentalExpenseCategory" IS NULL
    )
  );

COMMIT;
