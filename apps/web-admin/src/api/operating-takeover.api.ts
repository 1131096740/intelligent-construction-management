import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface OperatingTakeoverSceneReadModel {
  key: string;
  name: string;
  description: string;
  version: number;
  defaultFactKind: string;
  requiredProfessions: string[];
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    options?: Array<{ value: string; label: string }>;
    excel: { column: string };
  }>;
}

export type OperatingTakeoverProfession = "contract" | "finance";

export interface OperatingTakeoverBatchReadModel {
  id: string;
  projectId: string;
  batchNo: string;
  sourceFileId: string | null;
  sourceFileName: string | null;
  sceneKeys: string[];
  status: string;
  revision: number;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  warningRows: number;
  createdAt: string | null;
}

export interface OperatingTakeoverRowReadModel {
  id: string;
  rowNo: number;
  sceneKey: string;
  values: Record<string, unknown>;
  amountYuan: string | null;
  evidenceLevel: string;
  reviewStatus: string;
  duplicateStatus: string;
  duplicateNote: string | null;
  reviewConclusion: string | null;
  revision: number;
  issues: Array<{ message: string; severity: string }>;
  attachmentGroups: Array<{ id: string; rowId: string | null; purpose: string; links: Array<{ id: string; fileId: string }> }>;
}

export interface OperatingTakeoverDetailReadModel extends OperatingTakeoverBatchReadModel {
  rows: OperatingTakeoverRowReadModel[];
  confirmations: Array<{ profession: string; revision: number; confirmedAt: string }>;
  activation: { status: string; generatedFactIds: string[]; gapRowIds: string[] } | null;
}

export interface OperatingTakeoverPrecheckReadModel {
  summary: { totalRows: number; readyRows: number; blockedRows: number; warningRows: number };
  rows: Array<{ rowNo: number; sceneKey: string; values: Record<string, unknown>; issues: Array<{ message: string; severity: string }> }>;
  zeroWrites: true;
  importFingerprint: string;
}

export interface OperatingTakeoverSourceFileReadModel {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.clone().json()) as { message?: unknown };
      detail = Array.isArray(body.message) ? body.message.join("；") : typeof body.message === "string" ? body.message : "";
    } catch {
      detail = "";
    }
    throw new Error(formatApiErrorMessage(detail, response.status, fallback));
  }
}

async function readJson<T>(requestPath: string, fallback: string): Promise<T> {
  const response = await apiFetch(requestPath);
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

async function postJson<T>(requestPath: string, body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(requestPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

async function patchJson<T>(requestPath: string, body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(requestPath, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

async function postFormData<T>(requestPath: string, body: FormData, fallback: string): Promise<T> {
  const response = await apiFetch(requestPath, { method: "POST", body });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

function path(projectId: string, suffix = "") {
  return `/projects/${encodeURIComponent(projectId)}/operating-takeovers${suffix}`;
}

export function fetchOperatingTakeoverCapability(projectId: string) {
  return readJson<{ projectId: string; scenes: OperatingTakeoverSceneReadModel[]; actions: Record<string, boolean>; availableActions: string[]; confirmationProfessions: Record<OperatingTakeoverProfession, boolean> }>(path(projectId, "/capability"), "加载历史经营接管能力失败");
}

export function fetchOperatingTakeoverBatches(projectId: string) {
  return readJson<OperatingTakeoverBatchReadModel[]>(path(projectId), "加载历史经营接管批次失败");
}

export function fetchOperatingTakeoverDetail(projectId: string, batchId: string) {
  return readJson<OperatingTakeoverDetailReadModel>(path(projectId, `/${encodeURIComponent(batchId)}`), "加载历史经营接管详情失败");
}

export function precheckOperatingTakeover(projectId: string, body: { sceneKey?: string; rows: Array<{ sceneKey?: string; values: Record<string, unknown> }> }) {
  return postJson<OperatingTakeoverPrecheckReadModel>(path(projectId, "/precheck"), body, "历史经营接管预检失败");
}

export function precheckOperatingTakeoverXlsx(projectId: string, file: File, sceneKey?: string) {
  const formData = new FormData();
  formData.append("file", file);
  const query = sceneKey ? `?sceneKey=${encodeURIComponent(sceneKey)}` : "";
  return postFormData<OperatingTakeoverPrecheckReadModel>(path(projectId, `/precheck-xlsx${query}`), formData, "历史经营接管 Excel 预检失败");
}

export function uploadOperatingTakeoverSourceFile(projectId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return postFormData<OperatingTakeoverSourceFileReadModel>(path(projectId, "/files"), formData, "上传历史经营接管原始文件失败");
}

export function createOperatingTakeoverBatch(projectId: string, body: { batchNo?: string; sceneKey?: string; sourceFileId?: string; rows: Array<{ sceneKey?: string; values: Record<string, unknown> }> }) {
  return postJson<OperatingTakeoverDetailReadModel>(path(projectId), body, "创建历史经营接管批次失败");
}

export function updateOperatingTakeoverRow(projectId: string, batchId: string, rowId: string, body: { expectedRevision: number; values: Record<string, unknown>; duplicateNote?: string; reviewConclusion?: string }) {
  return patchJson<OperatingTakeoverDetailReadModel>(path(projectId, `/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`), body, "保存历史经营接管行失败");
}

export function confirmOperatingTakeover(projectId: string, batchId: string, body: { profession: OperatingTakeoverProfession; expectedRevision: number; idempotencyKey: string }) {
  return postJson<unknown>(path(projectId, `/${encodeURIComponent(batchId)}/confirmations`), body, "历史经营接管专业确认失败");
}

export function activateOperatingTakeover(projectId: string, batchId: string, idempotencyKey: string) {
  return postJson<unknown>(path(projectId, `/${encodeURIComponent(batchId)}/activation`), { idempotencyKey }, "历史经营接管激活失败");
}

export function addOperatingTakeoverAttachmentGroup(projectId: string, batchId: string, body: { purpose: string; rowId?: string; fileIds: string[] }) {
  return postJson<unknown>(path(projectId, `/${encodeURIComponent(batchId)}/attachments`), body, "关联历史经营接管附件失败");
}

export async function downloadOperatingTakeoverTemplate(projectId: string, sceneKey?: string) {
  const query = sceneKey ? `?sceneKey=${encodeURIComponent(sceneKey)}` : "";
  const response = await apiFetch(path(projectId, `/workbook-template${query}`));
  if (!response.ok) throw new Error(formatApiErrorMessage("", response.status, "下载历史经营接管模板失败"));
  return response.blob();
}
