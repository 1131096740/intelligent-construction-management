import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type SettlementTemplateVersionStatus = "draft" | "submitted" | "published" | "stopped";
export type SettlementTemplatePreviewStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "stale";

export interface SettlementTemplateInspectionReadModel {
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  duplicateColumns: string[];
  hasPrintArea: boolean;
  handlerSignatureRow: number | null;
  reviewerSignatureRow: number | null;
  blockingErrors: string[];
  warnings: string[];
  sourceRevision?: number;
}

export interface SettlementTemplatePreviewReadModel {
  id: string;
  status: SettlementTemplatePreviewStatus;
  sourceRevision: number;
  errorMessage: string | null;
  hasPreviewXlsx: boolean;
  hasPreviewPdf: boolean;
}

export interface SettlementTemplateVersionReadModel {
  id: string;
  settlementTemplateId: string;
  versionNo: number;
  status: SettlementTemplateVersionStatus;
  draftRevision: number;
  compatibleContractTypeKeys: string[];
  compatibleAmountRoles: string[];
  compatiblePricingModes: string[];
  columnSchema: Record<string, unknown>;
  printRules: Record<string, unknown>;
  evidenceRules: Record<string, unknown>;
  anomalyRules: Record<string, unknown>;
  inspectionReport: SettlementTemplateInspectionReadModel | null;
  inspectionRevision: number | null;
  hasSourceXlsx: boolean;
  hasPreviewXlsx: boolean;
  hasPreviewPdf: boolean;
  changeSummary: string | null;
  publishedAt: string | null;
  stoppedAt: string | null;
  latestPreview?: SettlementTemplatePreviewReadModel | null;
}

export interface SettlementTemplateReadModel {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  versions: SettlementTemplateVersionReadModel[];
}

export interface SettlementTemplateDetailReadModel {
  template: Omit<SettlementTemplateReadModel, "versions">;
  versions: SettlementTemplateVersionReadModel[];
}

export interface SettlementTemplateCompatibilityPayload {
  compatibleContractTypeKeys: string[];
  compatibleAmountRoles: string[];
  compatiblePricingModes: string[];
}

export interface CreateSettlementTemplatePayload extends SettlementTemplateCompatibilityPayload {
  name: string;
  code: string;
  xlsxFileId: string;
  columnSchema: Record<string, unknown>;
  printRules: Record<string, unknown>;
  evidenceRules: Record<string, unknown>;
  anomalyRules: Record<string, unknown>;
}

export interface UpdateSettlementTemplateVersionPayload
  extends Partial<SettlementTemplateCompatibilityPayload> {
  expectedRevision: number;
  xlsxFileId?: string;
  columnSchema?: Record<string, unknown>;
  printRules?: Record<string, unknown>;
  evidenceRules?: Record<string, unknown>;
  anomalyRules?: Record<string, unknown>;
}

export interface SettlementTemplateRecommendationChoice {
  templateVersionId: string;
  templateName: string;
  templateCode: string;
  versionNo: number;
  reasons: string[];
}

export type SettlementTemplateRecommendationReadModel =
  | {
      selectionMode: "automatic";
      selected: SettlementTemplateRecommendationChoice;
      choices: SettlementTemplateRecommendationChoice[];
    }
  | {
      selectionMode: "choice_required";
      selected: null;
      choices: SettlementTemplateRecommendationChoice[];
    };

export function listSettlementTemplates() {
  return readJson<SettlementTemplateReadModel[]>("/settlement-templates");
}

export function createSettlementTemplate(body: CreateSettlementTemplatePayload) {
  return postJson<{
    template: SettlementTemplateDetailReadModel["template"];
    version: SettlementTemplateVersionReadModel;
  }>(
    "/settlement-templates",
    body
  );
}

export function getSettlementTemplate(templateId: string) {
  return readJson<SettlementTemplateDetailReadModel>(
    `/settlement-templates/${encodeURIComponent(templateId)}`
  );
}

export function updateSettlementTemplateVersion(
  versionId: string,
  body: UpdateSettlementTemplateVersionPayload
) {
  return patchJson<{ id: string; draftRevision: number }>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}`,
    body
  );
}

export function inspectSettlementTemplateVersion(versionId: string) {
  return postJson<SettlementTemplateInspectionReadModel>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/inspection`
  );
}

export function generateSettlementTemplatePreview(versionId: string) {
  return postJson<SettlementTemplatePreviewReadModel>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/preview-generation`
  );
}

export function submitSettlementTemplateVersion(versionId: string) {
  return postJson<unknown>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/submission`
  );
}

export function publishSettlementTemplateVersion(versionId: string, changeSummary: string) {
  return postJson<unknown>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/publication`,
    { changeSummary }
  );
}

export function cloneSettlementTemplateVersion(versionId: string) {
  return postJson<SettlementTemplateVersionReadModel>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/clone`
  );
}

export function stopSettlementTemplateVersion(versionId: string) {
  return postJson<unknown>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/stop`
  );
}

export function fetchSettlementTemplateRecommendations(
  projectId: string,
  contractVersionId: string
) {
  return readJson<SettlementTemplateRecommendationReadModel>(
    `/settlement-workbench/projects/${encodeURIComponent(projectId)}/contract-versions/${encodeURIComponent(contractVersionId)}/template-recommendations`
  );
}

export async function downloadSettlementTemplatePreview(
  versionId: string,
  format: "xlsx" | "pdf",
  downloadReason: string
) {
  const ticket = await postJson<{ downloadUrl: string; fileName: string }>(
    `/settlement-template-versions/${encodeURIComponent(versionId)}/preview-${format}/download-ticket`,
    { downloadReason }
  );
  const response = await apiFetch(ticket.downloadUrl);
  await ensureOk(response, "下载结算模板脱敏预览失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ticket.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取结算模板失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交结算模板操作失败");
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存结算模板失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const detail = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof data.message === "string"
        ? data.message
        : "";
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    // 非 JSON 响应保留中文状态码兜底。
  }
  throw new Error(message);
}
