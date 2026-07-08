ALTER TABLE "ProjectExpenseRequest"
    DROP CONSTRAINT IF EXISTS "ProjectExpenseRequest_expenseType_check",
    DROP CONSTRAINT IF EXISTS "ProjectExpenseRequest_type_subtype_match_check";

ALTER TABLE "ProjectExpenseRequest"
    ADD CONSTRAINT "ProjectExpenseRequest_expenseType_check" CHECK ("expenseType" IN ('sporadic_payment', 'loan_reserve', 'comprehensive_expense', 'reimbursement')),
    ADD CONSTRAINT "ProjectExpenseRequest_type_subtype_match_check" CHECK (
        ("expenseType" = 'sporadic_payment' AND "expenseSubtype" IN ('sporadic_material', 'sporadic_machinery', 'sporadic_labor', 'temporary_service', 'other_sporadic'))
        OR ("expenseType" = 'loan_reserve' AND "expenseSubtype" IN ('employee_loan', 'owner_loan', 'project_reserve'))
        OR ("expenseType" = 'comprehensive_expense' AND "expenseSubtype" IN ('travel', 'entertainment'))
        OR ("expenseType" = 'reimbursement' AND "expenseSubtype" = 'reimbursement')
    );
