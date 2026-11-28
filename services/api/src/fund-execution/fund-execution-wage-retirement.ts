export const WAGE_OUTFLOW_RETIRED = "工资应付出款已停止办理，历史案件可查阅或按原记录冲回";

// Wage payables were the only classification source for ordinary V7 outflows.
export function isRetiredWageOutflow(execution: { executionKind: string; direction: string } | null) {
  return execution?.executionKind === "bank_transaction" && execution.direction === "outflow";
}
