export type SpotPaymentTaskRoute =
  | "edit-draft"
  | "review"
  | "payer"
  | "execution"
  | "refund"
  | "readonly";

export type SpotPaymentTaskSemantic =
  | "neutral"
  | "progress"
  | "required"
  | "success"
  | "danger";

export interface SpotPaymentTaskPresentationInput {
  key: string;
  enabled: boolean;
  priority: 400 | 300 | 200 | 0;
  scope: "personal" | "shared" | "none";
}

export interface SpotPaymentTaskPresentation {
  actionLabel: "填写" | "处理" | "查看";
  actionable: boolean;
  semantic: SpotPaymentTaskSemantic;
}

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

export function spotPaymentTaskPresentation(
  task: SpotPaymentTaskPresentationInput
): SpotPaymentTaskPresentation {
  const route = paymentTaskRoute(task.key);
  const canHandle = task.enabled && task.scope !== "none" && route !== "readonly";
  const actionable = task.enabled;
  if (task.enabled && task.scope !== "none" && task.key === "view_only" && task.priority === 400) {
    return { actionLabel: "查看", actionable, semantic: "danger" };
  }
  if (!canHandle) {
    return { actionLabel: "查看", actionable, semantic: "neutral" };
  }
  const actionLabel = route === "edit-draft" ? "填写" : "处理";
  if (task.priority === 400) return { actionLabel, actionable, semantic: "danger" };
  if (task.priority === 300 && task.scope === "personal") {
    return { actionLabel, actionable, semantic: "required" };
  }
  if (task.priority === 200 && task.scope === "shared") {
    return { actionLabel, actionable, semantic: "progress" };
  }
  return { actionLabel, actionable, semantic: "neutral" };
}

export function spotPaymentStatusSemantic(status: string): SpotPaymentTaskSemantic {
  switch (status) {
    case "approval_pending":
    case "approved_pending_payment":
    case "partially_paid":
      return "progress";
    case "paid":
    case "settled":
      return "success";
    case "returned":
    case "rejected":
    case "withdrawn":
    case "voided":
    case "invalidated":
      return "danger";
    default:
      return "neutral";
  }
}
