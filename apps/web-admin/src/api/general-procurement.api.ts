import type { BusinessEntrySceneDefinition, GeneralProcurementCategory } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface ProcurementListItem {
  id: string; code: string; projectName: string; applicantName: string; categoryLabel: string; reason: string;
  requestedAmountCents: string; status: string; statusLabel: string; updatedAt: string;
}
export interface ProcurementDetail extends ProcurementListItem {
  projectId: string; companyEntityId: string; companyName: string; category: GeneralProcurementCategory; revision: number;
  currentNodeName: string | null; requiresSelfReviewConfirmation: boolean;
  canDeleteDraft?: boolean;
  canCancelPayment: boolean; canEdit: boolean; canSubmit: boolean; canReview: boolean; canWithdraw: boolean; canArchive: boolean;
  archive: { fileId: string; fileName: string; note: string; archivedAt: string } | null;
  approvals: Array<{ id: string; status: string; nodes: Array<{ name: string; approved: boolean }>; actions: Array<{ action: string; actorName: string; comment: string | null; createdAt: string }> }>;
  submissions: Array<{ approvalInstanceId: string; submittedAt: string; reason: string; category: string; requestedAmountCents: string; companyName: string }>;
  payments: Array<{ canOpen: boolean; canCancel: boolean; id: string; code: string; status: string; requestedAmountCents: string; fundedAmountCents: string }>;
  paymentSummary: { reservedAmountCents: string; availableAmountCents: string }; canRequestPayment: boolean;
}
export interface ProcurementOptions {
  entryDefinition: BusinessEntrySceneDefinition; canCreate: boolean;
  projects: Array<{ id: string; name: string }>; companies: Array<{ id: string; name: string }>;
}
export interface ProcurementDraft {
  projectId: string; companyEntityId: string; category: GeneralProcurementCategory; reason: string; requestedAmountCents: string;
}
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: unknown };
    throw new Error(formatApiErrorMessage(typeof body.message === "string" ? body.message : "操作未完成", response.status, "综合采购操作未完成，请刷新后重试"));
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
export async function createProcurement(body: ProcurementDraft & { requestKey: string }) {
  const capability = await fetchProcurementOptions();
  if (!capability.canCreate) throw new Error("当前账号没有可申请的项目或费用承担公司，请联系综合部");
  return post<{ id: string }>(root, body);
}
async function mutate<T extends { revision: number }>(id: string, action: "canDeleteDraft" | "canEdit" | "canSubmit" | "canReview" | "canWithdraw" | "canArchive", endpoint: string, body: T) {
  const capability = await fetchProcurementDetail(id);
  if (capability.id !== id || capability.revision !== body.revision || !capability[action]) throw new Error("申请状态或办理权限已变化，请刷新后重试");
  return post<{ id: string }>(`${detailPath(id)}/${endpoint}`, body);
}
export const updateProcurement = (id: string, body: ProcurementDraft & { revision: number }) => mutate(id, "canEdit", "draft", body);
export const submitProcurement = (id: string, revision: number) => mutate(id, "canSubmit", "submission", { revision });
export const withdrawProcurement = (id: string, revision: number, reason: string) => mutate(id, "canWithdraw", "withdrawal", { revision, reason });
export const reviewProcurement = (id: string, body: { revision: number; decision: "approve" | "return"; comment?: string; selfReviewReason?: string; confirmationPassword?: string }) => mutate(id, "canReview", "review", body);
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
