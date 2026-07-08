ALTER TABLE "ProjectExpenseRequest"
    ADD COLUMN IF NOT EXISTS "purchaseExecutedByUserId" TEXT,
    ADD COLUMN IF NOT EXISTS "purchaseExecutedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "purchaseExecutionNote" TEXT,
    ADD COLUMN IF NOT EXISTS "receiptConfirmedByUserId" TEXT,
    ADD COLUMN IF NOT EXISTS "receiptConfirmedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "receiptConfirmationNote" TEXT;

ALTER TABLE "ProjectExpenseRequest"
    DROP CONSTRAINT IF EXISTS "ProjectExpenseRequest_expenseType_check",
    DROP CONSTRAINT IF EXISTS "ProjectExpenseRequest_expenseSubtype_check",
    DROP CONSTRAINT IF EXISTS "ProjectExpenseRequest_type_subtype_match_check",
    ADD CONSTRAINT "ProjectExpenseRequest_expenseType_check" CHECK ("expenseType" IN ('sporadic_payment', 'loan_reserve', 'comprehensive_expense', 'reimbursement', 'spot_purchase')),
    ADD CONSTRAINT "ProjectExpenseRequest_expenseSubtype_check" CHECK ("expenseSubtype" IN ('sporadic_material', 'sporadic_machinery', 'sporadic_labor', 'temporary_service', 'other_sporadic', 'employee_loan', 'owner_loan', 'project_reserve', 'travel', 'entertainment', 'reimbursement', 'spot_material_purchase', 'spot_tool_purchase', 'spot_service_purchase', 'spot_other_purchase')),
    ADD CONSTRAINT "ProjectExpenseRequest_type_subtype_match_check" CHECK (
        ("expenseType" = 'sporadic_payment' AND "expenseSubtype" IN ('sporadic_material', 'sporadic_machinery', 'sporadic_labor', 'temporary_service', 'other_sporadic'))
        OR ("expenseType" = 'loan_reserve' AND "expenseSubtype" IN ('employee_loan', 'owner_loan', 'project_reserve'))
        OR ("expenseType" = 'comprehensive_expense' AND "expenseSubtype" IN ('travel', 'entertainment'))
        OR ("expenseType" = 'reimbursement' AND "expenseSubtype" = 'reimbursement')
        OR ("expenseType" = 'spot_purchase' AND "expenseSubtype" IN ('spot_material_purchase', 'spot_tool_purchase', 'spot_service_purchase', 'spot_other_purchase'))
    );
