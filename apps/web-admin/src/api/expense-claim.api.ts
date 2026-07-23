import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ExpenseClaimWorkbenchView = "all" | "drafts" | "in_progress" | "pending_funds";

export interface ExpenseClaimListItemReadModel {
  id: string;
  code: string;
  claimType: "reimbursement" | "loan";
  status: string;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  companyEntityNameSnapshot: string;
  applicantNameSnapshot: string;
  handledByNameSnapshot: string;
  reason: string;
  requestedAmountCents: string;
  loanOffsetAmountCents: string;
  companyPayableAmountCents: string;
  fundedAmountCents: string;
  updatedAt: string;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `读取费用与报销工作台失败：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const detail = typeof data.message === "string"
      ? data.message
      : Array.isArray(data.message)
        ? data.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, "读取费用与报销工作台失败");
  } catch {
    message = formatApiErrorMessage(message, response.status, "读取费用与报销工作台失败");
  }
  throw new Error(message);
}

export async function fetchExpenseClaims(view: ExpenseClaimWorkbenchView = "all") {
  const query = view === "all" ? "" : `?${new URLSearchParams({ view }).toString()}`;
  const response = await apiFetch(`/expense-claims${query}`);
  await ensureOk(response);
  return response.json() as Promise<ExpenseClaimListItemReadModel[]>;
}
