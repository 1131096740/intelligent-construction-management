import type {
  ProjectExpensePaymentMethod,
  ProjectExpenseSubtype,
  ProjectExpenseType
} from "../../api/core-flow-read.api";

export const expenseTypeOptions: Array<{ value: ProjectExpenseType; label: string }> = [
  { value: "sporadic_payment", label: "零星付款" },
  { value: "loan_reserve", label: "借款/备用金" },
  { value: "comprehensive_expense", label: "综合费用" }
];

export const sporadicSubtypeOptions: Array<{ value: ProjectExpenseSubtype; label: string }> = [
  { value: "sporadic_material", label: "零星材料" },
  { value: "sporadic_machinery", label: "零星机械" },
  { value: "sporadic_labor", label: "零星用工" },
  { value: "temporary_service", label: "临时服务" },
  { value: "other_sporadic", label: "其他零星" }
];

export const loanReserveSubtypeOptions: Array<{ value: ProjectExpenseSubtype; label: string }> = [
  { value: "employee_loan", label: "员工借款" },
  { value: "owner_loan", label: "老板借款" },
  { value: "project_reserve", label: "项目备用金" }
];

export const comprehensiveExpenseSubtypeOptions: Array<{
  value: ProjectExpenseSubtype;
  label: string;
}> = [
  { value: "travel", label: "差旅" },
  { value: "entertainment", label: "招待" },
  { value: "reimbursement", label: "报销" }
];

export const expensePaymentMethodOptions: Array<{
  value: ProjectExpensePaymentMethod;
  label: string;
}> = [
  { value: "cash", label: "现金" },
  { value: "wechat", label: "微信" },
  { value: "alipay", label: "支付宝" },
  { value: "bank_transfer", label: "网银转账" },
  { value: "other", label: "其他" }
];

export function subtypeOptionsFor(expenseType: ProjectExpenseType) {
  if (expenseType === "sporadic_payment") {
    return sporadicSubtypeOptions;
  }
  if (expenseType === "loan_reserve") {
    return loanReserveSubtypeOptions;
  }
  return comprehensiveExpenseSubtypeOptions;
}

export function expenseTypeLabel(value: ProjectExpenseType) {
  return expenseTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function expenseSubtypeLabel(value: ProjectExpenseSubtype) {
  return (
    [
      ...sporadicSubtypeOptions,
      ...loanReserveSubtypeOptions,
      ...comprehensiveExpenseSubtypeOptions
    ].find((option) => option.value === value)?.label ?? value
  );
}

export function expensePaymentMethodLabel(value: ProjectExpensePaymentMethod) {
  return expensePaymentMethodOptions.find((option) => option.value === value)?.label ?? value;
}
