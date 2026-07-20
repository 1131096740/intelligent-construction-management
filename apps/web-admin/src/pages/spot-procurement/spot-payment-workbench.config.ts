export type SpotPaymentTaskRoute =
  | "edit-draft"
  | "review"
  | "payer"
  | "execution"
  | "refund"
  | "readonly";

export type SpotPaymentTaskSemantic = "neutral" | "progress" | "required";

export interface SpotPaymentTaskPresentationInput {
  key: string;
  enabled: boolean;
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
  if (!canHandle) {
    return { actionLabel: "查看", actionable: task.enabled, semantic: "neutral" };
  }
  if (route === "edit-draft") {
    return { actionLabel: "填写", actionable: true, semantic: "required" };
  }
  return { actionLabel: "处理", actionable: true, semantic: "progress" };
}
