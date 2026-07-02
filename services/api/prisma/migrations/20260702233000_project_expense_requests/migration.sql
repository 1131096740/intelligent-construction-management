ALTER TABLE "FinanceRecord"
    ADD COLUMN "projectExpenseRequestId" TEXT;

CREATE TABLE "ProjectExpenseRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expenseType" TEXT NOT NULL,
    "expenseSubtype" TEXT NOT NULL,
    "paymentSubject" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedAmountCents" INTEGER NOT NULL,
    "approvedAmountCents" INTEGER,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyAccountName" TEXT,
    "counterpartyBankName" TEXT,
    "counterpartyBankAccount" TEXT,
    "handlerUserId" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "attachmentFileId" TEXT,
    "status" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpenseRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectExpenseExecution" (
    "id" TEXT NOT NULL,
    "projectExpenseRequestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "voucherFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpenseExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectExpenseFinancingQuotaUsage" (
    "id" TEXT NOT NULL,
    "quotaId" TEXT NOT NULL,
    "projectExpenseRequestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'occupied',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpenseFinancingQuotaUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectExpenseRequest_code_key" ON "ProjectExpenseRequest"("code");
CREATE INDEX "FinanceRecord_projectExpenseRequestId_idx" ON "FinanceRecord"("projectExpenseRequestId");
CREATE INDEX "ProjectExpenseRequest_projectId_status_idx" ON "ProjectExpenseRequest"("projectId", "status");
CREATE INDEX "ProjectExpenseRequest_attachmentFileId_idx" ON "ProjectExpenseRequest"("attachmentFileId");
CREATE INDEX "ProjectExpenseExecution_projectExpenseRequestId_idx" ON "ProjectExpenseExecution"("projectExpenseRequestId");
CREATE INDEX "ProjectExpenseExecution_projectId_idx" ON "ProjectExpenseExecution"("projectId");
CREATE INDEX "ProjectExpenseExecution_voucherFileId_idx" ON "ProjectExpenseExecution"("voucherFileId");
CREATE INDEX "ProjectExpenseFinancingQuotaUsage_quotaId_projectExpenseRequestId_idx"
    ON "ProjectExpenseFinancingQuotaUsage"("quotaId", "projectExpenseRequestId");
CREATE INDEX "ProjectExpenseFinancingQuotaUsage_projectExpenseRequestId_idx"
    ON "ProjectExpenseFinancingQuotaUsage"("projectExpenseRequestId");
CREATE INDEX "ProjectExpenseFinancingQuotaUsage_projectId_idx"
    ON "ProjectExpenseFinancingQuotaUsage"("projectId");

ALTER TABLE "ProjectExpenseRequest"
    ADD CONSTRAINT "ProjectExpenseRequest_requestedAmountCents_positive_check" CHECK ("requestedAmountCents" > 0),
    ADD CONSTRAINT "ProjectExpenseRequest_approvedAmountCents_positive_check" CHECK ("approvedAmountCents" IS NULL OR "approvedAmountCents" > 0),
    ADD CONSTRAINT "ProjectExpenseRequest_paidAmountCents_nonnegative_check" CHECK ("paidAmountCents" >= 0),
    ADD CONSTRAINT "ProjectExpenseRequest_approvedAmountCents_lte_requested_check" CHECK ("approvedAmountCents" IS NULL OR "approvedAmountCents" <= "requestedAmountCents"),
    ADD CONSTRAINT "ProjectExpenseRequest_paidAmountCents_lte_approved_check" CHECK ("paidAmountCents" <= COALESCE("approvedAmountCents", "requestedAmountCents")),
    ADD CONSTRAINT "ProjectExpenseRequest_expenseType_check" CHECK ("expenseType" IN ('sporadic_payment', 'loan_reserve')),
    ADD CONSTRAINT "ProjectExpenseRequest_expenseSubtype_check" CHECK ("expenseSubtype" IN ('sporadic_material', 'sporadic_machinery', 'sporadic_labor', 'temporary_service', 'other_sporadic', 'employee_loan', 'owner_loan', 'project_reserve')),
    ADD CONSTRAINT "ProjectExpenseRequest_type_subtype_match_check" CHECK (
        ("expenseType" = 'sporadic_payment' AND "expenseSubtype" IN ('sporadic_material', 'sporadic_machinery', 'sporadic_labor', 'temporary_service', 'other_sporadic'))
        OR ("expenseType" = 'loan_reserve' AND "expenseSubtype" IN ('employee_loan', 'owner_loan', 'project_reserve'))
    ),
    ADD CONSTRAINT "ProjectExpenseRequest_paymentMethod_check" CHECK ("paymentMethod" IN ('cash', 'wechat', 'alipay', 'bank_transfer', 'other')),
    ADD CONSTRAINT "ProjectExpenseRequest_status_check" CHECK ("status" IN ('approval_pending', 'withdrawn', 'rejected', 'approved_pending_payment', 'partially_paid', 'paid', 'voided', 'payment_blocked'));

ALTER TABLE "ProjectExpenseExecution"
    ADD CONSTRAINT "ProjectExpenseExecution_amountCents_positive_check" CHECK ("amountCents" > 0);

ALTER TABLE "ProjectExpenseFinancingQuotaUsage"
    ADD CONSTRAINT "ProjectExpenseFinancingQuotaUsage_amountCents_positive_check" CHECK ("amountCents" > 0),
    ADD CONSTRAINT "ProjectExpenseFinancingQuotaUsage_status_check" CHECK ("status" IN ('occupied', 'used', 'released'));
