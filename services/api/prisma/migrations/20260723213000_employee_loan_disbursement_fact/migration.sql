-- 阶段 2：真实借款放款才形成余额。此迁移不读取、回填或删除旧项目支出事实。

BEGIN;

SELECT pg_advisory_xact_lock(190731, 24);

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "fundedAmountCents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ExpenseClaim"
  DROP CONSTRAINT "ExpenseClaim_status_check",
  ADD CONSTRAINT "ExpenseClaim_status_check" CHECK ("status" IN (
    'draft', 'approval_pending', 'approved_pending_payment', 'approved_pending_disbursement',
    'partially_disbursed', 'disbursed', 'offset_completed', 'paid', 'withdrawn', 'rejected', 'voided'
  )),
  ADD CONSTRAINT "ExpenseClaim_funded_amount_check" CHECK (
    "fundedAmountCents" >= 0 AND "fundedAmountCents" <= "requestedAmountCents"
  );

ALTER TABLE "EmployeeProjectLoanEntry"
  ADD COLUMN "voucherFileId" TEXT,
  ADD COLUMN "paymentMethod" TEXT;

ALTER TABLE "EmployeeProjectLoanEntry"
  DROP CONSTRAINT "EmployeeProjectLoanEntry_source_check",
  ADD CONSTRAINT "EmployeeProjectLoanEntry_source_check" CHECK (
    ("entryType" = 'disbursement' AND "sourceExpenseClaimId" IS NOT NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NULL AND "voucherFileId" IS NOT NULL AND "paymentMethod" IS NOT NULL AND btrim("paymentMethod") <> '')
    OR ("entryType" = 'offset' AND "sourceExpenseClaimId" IS NOT NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NOT NULL AND "reversalOfEntryId" IS NULL AND "voucherFileId" IS NULL AND "paymentMethod" IS NULL)
    OR ("entryType" = 'repayment' AND "sourceExpenseClaimId" IS NULL AND "sourceRepaymentId" IS NOT NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NULL AND "voucherFileId" IS NULL AND "paymentMethod" IS NULL)
    OR ("entryType" = 'reversal' AND "sourceExpenseClaimId" IS NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NOT NULL AND "voucherFileId" IS NULL AND "paymentMethod" IS NULL)
  ),
  ADD CONSTRAINT "EmployeeProjectLoanEntry_voucherFileId_fkey" FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id");

CREATE INDEX "EmployeeProjectLoanEntry_voucherFileId_idx" ON "EmployeeProjectLoanEntry"("voucherFileId");

COMMIT;
