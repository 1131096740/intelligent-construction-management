export interface CreateProjectExpenseRequestDto {
  code: string;
  expenseType:
    | "sporadic_payment"
    | "loan_reserve"
    | "comprehensive_expense"
    | "reimbursement"
    | "spot_purchase";
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
    | "reimbursement"
    | "spot_material_purchase"
    | "spot_tool_purchase"
    | "spot_service_purchase"
    | "spot_other_purchase";
  paymentSubject: string;
  reason: string;
  requestedAmountCents: string;
  paymentMethod: "cash" | "wechat" | "alipay" | "bank_transfer" | "other";
  counterpartyName?: string;
  counterpartyAccountName?: string;
  counterpartyBankName?: string;
  counterpartyBankAccount?: string;
  handlerUserId?: string;
  attachmentFileId?: string;
}
