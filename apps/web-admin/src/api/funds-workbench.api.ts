import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type FundsWorkbenchView = "all" | "pending_action" | "in_progress" | "pending_funds" | "partial_payment" | "pending_refund" | "pending_evidence" | "completed";
export type FundsWorkbenchSource = "all" | "contract_payment" | "spot_procurement_payment" | "expense_reimbursement" | "loan_disbursement";

export interface FundsWorkbenchItem {
  id: string;
  code: string;
  source: Exclude<FundsWorkbenchSource, "all">;
  project: { id: string; code: string; name: string } | null;
  sourceDocument: string;
  reason: string;
  payeeName: string | null;
  payerName: string | null;
  requestedAmountCents: string;
  paidAmountCents: string;
  remainingAmountCents: string;
  status: string;
  statusLabel: string;
  pendingRefund: boolean;
  pendingEvidence: boolean;
  pendingMyAction: boolean;
  updatedAt: string;
}

export interface FundsWorkbenchReadModel {
  view: FundsWorkbenchView;
  source: FundsWorkbenchSource;
  items: FundsWorkbenchItem[];
  viewCounts: Record<FundsWorkbenchView, number>;
  sourceCounts: Record<Exclude<FundsWorkbenchSource, "all">, number>;
}

export async function fetchFundsWorkbench(query: { view?: FundsWorkbenchView; source?: FundsWorkbenchSource } = {}) {
  const parameters = new URLSearchParams();
  if (query.view && query.view !== "all") parameters.set("view", query.view);
  if (query.source && query.source !== "all") parameters.set("source", query.source);
  const response = await apiFetch(`/funds-workbench${parameters.size ? `?${parameters.toString()}` : ""}`);
  if (response.ok) return response.json() as Promise<FundsWorkbenchReadModel>;
  let message = `读取统一资金工作台失败：${response.status}`;
  try {
    const body = await response.clone().json() as { message?: unknown };
    const detail = typeof body.message === "string"
      ? body.message
      : Array.isArray(body.message)
        ? body.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, "读取统一资金工作台失败");
  } catch {
    message = formatApiErrorMessage(message, response.status, "读取统一资金工作台失败");
  }
  throw new Error(message);
}
