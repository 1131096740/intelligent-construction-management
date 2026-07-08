export interface CreateProjectExpenseRequestDto {
  code: string;
  expenseType: "sporadic_payment" | "loan_reserve" | "comprehensive_expense" | "reimbursement";
  expenseSubtype:
    | "sporadic_material"
    | "sporadic_machinery"
    | "sporadic_labor"
    | "temporary_service"
    | "other_sporadic"
    | "employee_loan"
    | "owner_loan"
    | "project_reserve"
    | "travel"
    | "entertainment"
    | "reimbursement";
  paymentSubject: string;
  reason: string;
  requestedAmountCents: number;
  paymentMethod: "cash" | "wechat" | "alipay" | "bank_transfer" | "other";
  counterpartyName?: string;
  counterpartyAccountName?: string;
  counterpartyBankName?: string;
  counterpartyBankAccount?: string;
  handlerUserId?: string;
  attachmentFileId?: string;
}
