-- 费用公司付款主体：仅新增事实字段；不改写存量费用、借款、合同或项目支出记录。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 14);

ALTER TABLE "ExpenseClaim"
  ADD COLUMN "paymentSubjectCompanyEntityId" TEXT,
  ADD COLUMN "paymentSubjectNameSnapshot" TEXT,
  ADD COLUMN "paymentSubjectAdjustmentReason" TEXT,
  ADD COLUMN "paymentSubjectAdjustedAt" TIMESTAMP(3),
  ADD COLUMN "paymentSubjectAdjustedByUserId" TEXT,
  ADD COLUMN "paymentSubjectAdjustedByRoleKey" TEXT;

CREATE INDEX "ExpenseClaim_paymentSubjectCompanyEntityId_status_idx"
  ON "ExpenseClaim"("paymentSubjectCompanyEntityId", "status");

COMMIT;
