import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ApprovalPerson { id: string; name: string }
export interface ApprovalProgress {
  id: string; businessType: string; businessId: string; title: string; businessCode: string;
  projectName: string; applicant: ApprovalPerson; status: string; createdAt: string;
  currentNodeIndex: number; currentNodeName: string;
  nodes: Array<{ name: string; mode: string; status: string; participants: ApprovalPerson[]; pending: ApprovalPerson[]; legacyRoster: boolean }>;
  pendingRecipients: ApprovalPerson[]; reminderToken: string; canRemind: boolean; reminderUnavailableReason: string | null; nextRemindAt: string | null;
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

export async function fetchRelatedApprovals(input: { cursor?: string; businessType?: string; businessId?: string } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams(Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return read<{ items: ApprovalProgress[]; nextCursor: string | null }>(await apiFetch(`/approval-progress?${query}`, { signal }));
}

export async function fetchApprovalProgress(instanceId: string) {
  return read<ApprovalProgress>(await apiFetch(`/approval-progress/${encodeURIComponent(instanceId)}`));
}

export async function remindApprovalBySms(instanceId: string, requestId: string, reminderToken: string) {
  return read<ApprovalProgress>(await apiFetch(`/approval-progress/${encodeURIComponent(instanceId)}/remind`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, reminderToken })
  }));
}
