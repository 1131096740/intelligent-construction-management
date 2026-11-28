BEGIN;

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "requestedAmountYuan" NUMERIC(24,4),
  DROP CONSTRAINT "ExpenseClaim_amounts_nonnegative_check",
  ADD CONSTRAINT "ExpenseClaim_amounts_nonnegative_check" CHECK (
    (
      ("requestedAmountYuan" IS NULL AND "requestedAmountCents" > 0)
      OR ("claimType" = 'reimbursement' AND "requestedAmountYuan" IS NOT NULL AND "requestedAmountYuan" > 0
        AND "requestedAmountCents"::numeric = round("requestedAmountYuan" * 100))
    )
    AND "loanOffsetAmountCents" >= 0
    AND "companyPayableAmountCents" >= 0
    AND "loanOffsetAmountCents" + "companyPayableAmountCents" <= "requestedAmountCents"
  );

ALTER TABLE "ExpenseClaimLine"
  ADD COLUMN "amountYuan" NUMERIC(24,4),
  DROP CONSTRAINT "ExpenseClaimLine_amount_positive_check",
  ADD CONSTRAINT "ExpenseClaimLine_amount_positive_check" CHECK (
    ("amountYuan" IS NULL AND "amountCents" > 0)
    OR ("amountYuan" IS NOT NULL AND "amountYuan" > 0
      AND "amountCents"::numeric BETWEEN floor("amountYuan" * 100) AND ceil("amountYuan" * 100))
  );

COMMIT;
