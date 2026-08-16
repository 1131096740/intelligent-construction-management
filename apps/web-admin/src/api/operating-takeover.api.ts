import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface OperatingTakeoverSceneReadModel {
  key: string;
  name: string;
  description: string;
  version: number;
  defaultFactKind: string;
  requiredProfessions: string[];
  fields: Array<{ key: string; label: string; type: string; required: boolean; excel: { column: string } }>;
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
  revision: number;
  issues: Array<{ message: string; severity: string }>;
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

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
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
  return response.json() as Promise<T>;
}

function path(projectId: string, suffix = "") {
  return `/projects/${encodeURIComponent(projectId)}/operating-takeovers${suffix}`;
}

export function fetchOperatingTakeoverCapability(projectId: string) {
  return apiFetch(path(projectId, "/capability")).then((response) => responseJson<{ scenes: OperatingTakeoverSceneReadModel[]; actions: Record<string, boolean>; confirmationProfessions: Record<OperatingTakeoverProfession, boolean> }>(response, "加载历史经营接管能力失败"));
}

export function fetchOperatingTakeoverBatches(projectId: string) {
  return apiFetch(path(projectId)).then((response) => responseJson<OperatingTakeoverBatchReadModel[]>(response, "加载历史经营接管批次失败"));
}

export function fetchOperatingTakeoverDetail(projectId: string, batchId: string) {
  return apiFetch(path(projectId, `/${encodeURIComponent(batchId)}`)).then((response) => responseJson<OperatingTakeoverDetailReadModel>(response, "加载历史经营接管详情失败"));
}

export function precheckOperatingTakeover(projectId: string, body: { sceneKey?: string; rows: Array<{ sceneKey?: string; values: Record<string, unknown> }> }) {
  return apiFetch(path(projectId, "/precheck"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => responseJson<OperatingTakeoverPrecheckReadModel>(response, "历史经营接管预检失败"));
}

export function precheckOperatingTakeoverXlsx(projectId: string, file: File, sceneKey?: string) {
  const formData = new FormData();
  formData.append("file", file);
  const query = sceneKey ? `?sceneKey=${encodeURIComponent(sceneKey)}` : "";
  return apiFetch(path(projectId, `/precheck-xlsx${query}`), { method: "POST", body: formData }).then((response) => responseJson<OperatingTakeoverPrecheckReadModel>(response, "历史经营接管 Excel 预检失败"));
}

export function createOperatingTakeoverBatch(projectId: string, body: { batchNo?: string; sceneKey?: string; rows: Array<{ sceneKey?: string; values: Record<string, unknown> }> }) {
  return apiFetch(path(projectId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => responseJson<OperatingTakeoverDetailReadModel>(response, "创建历史经营接管批次失败"));
}

export function confirmOperatingTakeover(projectId: string, batchId: string, body: { profession: OperatingTakeoverProfession; expectedRevision: number; idempotencyKey: string }) {
  return apiFetch(path(projectId, `/${encodeURIComponent(batchId)}/confirmations`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => responseJson<unknown>(response, "历史经营接管专业确认失败"));
}

export function activateOperatingTakeover(projectId: string, batchId: string, idempotencyKey: string) {
  return apiFetch(path(projectId, `/${encodeURIComponent(batchId)}/activation`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey }) }).then((response) => responseJson<unknown>(response, "历史经营接管激活失败"));
}

export async function downloadOperatingTakeoverTemplate(projectId: string, sceneKey?: string) {
  const query = sceneKey ? `?sceneKey=${encodeURIComponent(sceneKey)}` : "";
  const response = await apiFetch(path(projectId, `/workbook-template${query}`));
  if (!response.ok) throw new Error(formatApiErrorMessage("", response.status, "下载历史经营接管模板失败"));
  return response.blob();
}
