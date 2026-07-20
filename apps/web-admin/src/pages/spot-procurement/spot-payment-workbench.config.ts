export type SpotPaymentTaskRoute =
  | "edit-draft"
  | "review"
  | "payer"
  | "execution"
  | "refund"
  | "readonly";

export const spotPaymentWorkbenchViews = [
  { value: "mine", label: "待我办理" },
  { value: "all", label: "全部申请" },
  { value: "closed", label: "已办结" }
] as const;

export const spotPaymentLedgerGroups = [
  { key: "application", label: "付款申请" },
  { key: "projectMerchant", label: "项目 / 商户" },
  { key: "amount", label: "金额" },
  { key: "status", label: "当前状态" },
  { key: "task", label: "当前任务" },
  { key: "actions", label: "操作" }
] as const;

export function selectSpotPaymentTaskCards<T>(
  serverOrderedTasks: readonly T[]
): T[] {
  return serverOrderedTasks.slice(0, 5);
}

export function paymentTaskRoute(taskKey: string):
  | "edit-draft"
  | "review"
  | "payer"
  | "execution"
  | "refund"
  | "readonly" {
  switch (taskKey) {
    case "complete_payment_draft": return "edit-draft";
    case "review_payment": return "review";
    case "complete_payer": return "payer";
    case "record_execution": return "execution";
    case "record_refund": return "refund";
    case "view_only": return "readonly";
    default: return "readonly";
  }
}
