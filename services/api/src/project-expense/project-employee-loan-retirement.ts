import { GoneException } from "@nestjs/common";

export const PROJECT_EMPLOYEE_LOAN_RETIRED = "项目员工借款已停止办理，只能查看历史记录";

export function isRetiredProjectEmployeeLoan(
  expense: { expenseType: unknown; expenseSubtype: unknown } | null
): boolean {
  return expense?.expenseType === "loan_reserve" && expense.expenseSubtype === "employee_loan";
}

export function assertProjectEmployeeLoanWritable(expense: { expenseType: string; expenseSubtype: string }): void {
  if (isRetiredProjectEmployeeLoan(expense)) throw new GoneException(PROJECT_EMPLOYEE_LOAN_RETIRED);
}
