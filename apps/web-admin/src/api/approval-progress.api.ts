import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ApprovalPerson { id: string; name: string }
export interface ApprovalProgress {
  id: string; businessType: string; businessId: string; title: string; businessCode: string;
  projectName: string; applicant: ApprovalPerson; status: string; createdAt: string;
  currentNodeIndex: number; currentNodeName: string;
  nodes: Array<{ name: string; mode: string; status: string; participants: ApprovalPerson[]; pending: ApprovalPerson[]; legacyRoster: boolean;
    signatures?: Array<{ id: string; name: string; role: string; signedAt: string }> }>;
  pendingRecipients: ApprovalPerson[]; remindableRecipients?: ApprovalPerson[]; reminderToken: string; canRemind: boolean; reminderUnavailableReason: string | null; nextRemindAt: string | null;
  parallelCompletion?: { completed: number; total: number };
  viewerOnly: boolean;
  canHandle: boolean;
  history: Array<{ id: string; actor: ApprovalPerson; action: string; comment: string | null; createdAt: string }>;
  reminders: Array<{ id: string; actor: ApprovalPerson; createdAt: string; recipients: ApprovalPerson[]; results: Array<{ userId: string; status: string; message: string }>; pending: boolean }>;
}

export class ApprovalProgressApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = payload && typeof payload === "object" && "message" in payload ? payload.message : null;
    const text = typeof message === "string" ? message : Array.isArray(message) ? message.filter(item => typeof item === "string").join("；") : "";
    throw new ApprovalProgressApiError(formatApiErrorMessage(text, response.status, "审批进度读取或催办失败"), response.status);
  }
  return response.json() as Promise<T>;
}

export async function fetchRelatedApprovals(input: { cursor?: string; businessType?: string; businessId?: string; view?: "participant" | "viewable" } = {}, signal?: AbortSignal) {
  // 默认参与范围不携带 view，保持既有链接与审计语义；只有我可查看显式请求 viewable。
  const entries = Object.entries(input).filter((entry): entry is [string, string] =>
    Boolean(entry[1]) && !(entry[0] === "view" && entry[1] === "participant"));
  return read<{ items: ApprovalProgress[]; nextCursor: string | null }>(await apiFetch(`/approval-progress?${new URLSearchParams(entries)}`, { signal }));
}

export async function fetchApprovalProgress(instanceId: string, view: "participant" | "viewable" = "participant") {
  const query = view === "viewable" ? "?view=viewable" : "";
  return read<ApprovalProgress>(await apiFetch(`/approval-progress/${encodeURIComponent(instanceId)}${query}`));
}

export async function remindApprovalBySms(instanceId: string, requestId: string, reminderToken: string, recipientIds?: string[]) {
  return read<ApprovalProgress>(await apiFetch(`/approval-progress/${encodeURIComponent(instanceId)}/remind`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, reminderToken, recipientIds })
  }));
}
