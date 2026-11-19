import type { BusinessEntrySceneDefinition, GeneralProcurementCategory, GeneralProcurementRequestLine } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface ProcurementListItem {
  id: string; code: string; projectName: string; applicantName: string; categoryLabel: string; reason: string;
  requestedAmountCents: string | null; estimatedAmount?: string | null; requestProtocolVersion?: number; status: string; statusLabel: string; updatedAt: string;
}
export interface ProcurementDetail extends ProcurementListItem {
  entryDefinition?: BusinessEntrySceneDefinition; requestProtocolVersion?: number; scope?: "project" | "company_daily"; lines?: GeneralProcurementRequestLine[]; lineSummary?: { knownLineEstimatedSubtotal: string | null; unknownLineCount: number }; reviewDuties?: Array<{ nodeIndex: number; name: string }>; canProcure?: boolean;
  projectId: string | null; companyEntityId: string | null; companyName: string | null; category: GeneralProcurementCategory; revision: number;
  currentNodeName: string | null; requiresSelfReviewConfirmation: boolean;
  canDeleteDraft?: boolean;
  canCancelPayment: boolean; canEdit: boolean; canSubmit: boolean; canReview: boolean; canWithdraw: boolean; canArchive: boolean;
  archive: { fileId: string; fileName: string; note: string; archivedAt: string } | null;
  approvals: Array<{ id: string; status: string; nodes: Array<{ name: string; approved: boolean }>; actions: Array<{ action: string; actorName: string; comment: string | null; createdAt: string }> }>;
  submissions: Array<{ approvalInstanceId: string; submittedAt: string; reason: string; category: string; requestProtocolVersion?: number; estimatedAmount?: string | null; requestedAmountCents: string | null; companyName?: string | null; companyNameSnapshot?: string | null }>;
  payments: Array<{ canOpen: boolean; canCancel: boolean; id: string; code: string; status: string; requestedAmountCents: string; fundedAmountCents: string }>;
  paymentSummary: { reservedAmountCents: string | null; availableAmountCents: string | null }; canRequestPayment: boolean;
}
export interface ProcurementOptions {
  entryDefinition: BusinessEntrySceneDefinition; requestEntryDefinition?: BusinessEntrySceneDefinition; canCreate: boolean; canCreateCompanyDaily?: boolean;
  projects: Array<{ id: string; name: string }>; companies: Array<{ id: string; name: string }>;
}
export interface ProcurementDraft {
  projectId: string; companyEntityId: string; category: GeneralProcurementCategory; reason: string; requestedAmountCents: string;
}
export interface ProcurementRequestDraft {
  requestProtocolVersion: 2; scope: "project" | "company_daily"; projectId: string | null; companyEntityId: string | null;
  category: GeneralProcurementCategory; reason: string; requestedAmountCents: null; estimatedAmount: string | null; lines: GeneralProcurementRequestLine[];
}
export class ProcurementHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export class ProcurementPreflightError extends Error {}
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: unknown };
    throw new ProcurementHttpError(formatApiErrorMessage(typeof body.message === "string" ? body.message : "操作未完成", response.status, "综合采购操作未完成，请刷新后重试"), response.status);
  }
  return response.json() as Promise<T>;
}
const root = "/general-procurements";
const detailPath = (id: string) => `${root}/${encodeURIComponent(id)}`;
const post = <T>(path: string, body: unknown) => read<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const fetchProcurementList = (query: { page?: number; pageSize?: number; search?: string; status?: string } = {}) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
  return read<{ items: ProcurementListItem[]; total: number; page: number; pageSize: number }>(`${root}?${params.toString()}`);
};
export const fetchProcurementOptions = () => read<ProcurementOptions>(`${root}/create-options`);
export const fetchProcurementDetail = (id: string) => read<ProcurementDetail>(detailPath(id));
export async function createProcurement(body: (ProcurementDraft | ProcurementRequestDraft) & { requestKey: string }) {
  let capability: ProcurementOptions;
  try { capability = await fetchProcurementOptions(); } catch { throw new ProcurementPreflightError("申请权限读取失败，尚未发送保存请求，填写已保留，请重试"); }
  if (!capability.canCreate) throw new ProcurementPreflightError("当前账号不能发起综合采购申请，请联系综合部");
  return post<{ id: string }>(root, body);
}
async function mutate<T extends { revision: number }>(id: string, action: "canDeleteDraft" | "canEdit" | "canSubmit" | "canReview" | "canWithdraw" | "canArchive", endpoint: string, body: T) {
  const capability = await fetchProcurementDetail(id);
  if (capability.id !== id || capability.revision !== body.revision || !capability[action]) throw new Error("申请状态或办理权限已变化，请刷新后重试");
  return post<{ id: string }>(`${detailPath(id)}/${endpoint}`, body);
}
export const updateProcurement = (id: string, body: (ProcurementDraft | ProcurementRequestDraft) & { revision: number }) => mutate(id, "canEdit", "draft", body);
export const submitProcurement = (id: string, revision: number) => mutate(id, "canSubmit", "submission", { revision });
export const withdrawProcurement = (id: string, revision: number, reason: string) => mutate(id, "canWithdraw", "withdrawal", { revision, reason });
export const reviewProcurement = (id: string, body: { revision: number; expectedNodeIndex?: number; decision: "approve" | "return"; comment?: string; selfReviewReason?: string; confirmationPassword?: string }) => mutate(id, "canReview", "review", body);
export const archiveProcurement = (id: string, revision: number, fileId: string, note: string) => mutate(id, "canArchive", "archive", { revision, fileId, note });
export async function uploadProcurementArchive(id: string, file: File, idempotencyKey: string) {
  const capability = await fetchProcurementDetail(id);
  if (capability.id !== id || !capability.canArchive) throw new Error("当前申请不可上传归档依据");
  const form = new FormData(); form.append("file", file); form.append("idempotencyKey", idempotencyKey);
  return read<{ id: string }>(`${detailPath(id)}/archive-file-uploads`, { method: "POST", body: form });
}

export async function cancelProcurementPayment(id: string, claimId: string, reason: string) {
  const capability = await fetchProcurementDetail(id);
  if (!capability.payments.some((payment) => payment.id === claimId && payment.canCancel)) throw new Error("当前付款草稿不可撤销");
  return post(`${detailPath(id)}/payments/${encodeURIComponent(claimId)}/cancellation`, { reason });
}

export const deleteProcurementDraft = (id: string, revision: number) => mutate(id, "canDeleteDraft", "draft-deletion", { revision });
