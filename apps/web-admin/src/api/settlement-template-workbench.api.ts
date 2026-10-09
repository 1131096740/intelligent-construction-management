import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import type {
  CreateSettlementTemplatePayload, UpdateSettlementTemplateVersionPayload,
  SettlementTemplateDetailReadModel, SettlementTemplateReadModel, SettlementTemplateVersionReadModel,
  SettlementTemplateInspectionReadModel, SettlementTemplatePreviewReadModel
} from "./settlement-template.api";
export type { SettlementTemplateDetailReadModel, SettlementTemplateReadModel, SettlementTemplateVersionReadModel } from "./settlement-template.api";
type Revision = { expectedRevision: number; definitionVersion: number };

export function fetchTemplateWorkbenchCapability() {
  return readJson<{ definition: BusinessEntrySceneDefinition; availableActions: string[] }>("/settlement-template-workbench/capability");
}

export function fetchTemplateVersionCapability(versionId: string) {
  return readJson<{ workbenchActions: string[]; availableActions: NonNullable<SettlementTemplateVersionReadModel["availableActions"]> }>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/capability`
  );
}

export function listSettlementTemplates(includeHistory = false) {
  return readJson<SettlementTemplateReadModel[]>(
    `/settlement-template-workbench/templates${includeHistory ? "?includeHistory=true" : ""}`
  );
}

export function createSettlementTemplate(body: CreateSettlementTemplatePayload & { definitionVersion: number }) {
  return postJson<{
    template: SettlementTemplateDetailReadModel["template"];
    version: SettlementTemplateVersionReadModel;
  }>(
    "/settlement-template-workbench/templates",
    body
  );
}

export function getSettlementTemplate(templateId: string, includeHistory = false) {
  return readJson<SettlementTemplateDetailReadModel>(
    `/settlement-template-workbench/templates/${encodeURIComponent(templateId)}${includeHistory ? "?includeHistory=true" : ""}`
  );
}

export function updateSettlementTemplateVersion(
  versionId: string,
  body: UpdateSettlementTemplateVersionPayload & { definitionVersion: number }
) {
  return patchJson<{ id: string; draftRevision: number }>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}`,
    body
  );
}

export function inspectSettlementTemplateVersion(versionId: string, revision: Revision) {
  return postJson<SettlementTemplateInspectionReadModel>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/inspection`,
    revision
  );
}

export function generateSettlementTemplatePreview(versionId: string, revision: Revision) {
  return postJson<SettlementTemplatePreviewReadModel>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/preview-generation`,
    revision
  );
}

export function submitSettlementTemplateVersion(versionId: string, revision: Revision) {
  return postJson<unknown>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/submission`,
    revision
  );
}

export function publishSettlementTemplateVersion(versionId: string, changeSummary: string, revision: Revision) {
  return postJson<unknown>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/publication`,
    { ...revision, changeSummary }
  );
}

export function cloneSettlementTemplateVersion(versionId: string) {
  return postJson<SettlementTemplateVersionReadModel>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/clone`
  );
}

export function discardSettlementTemplateVersion(
  versionId: string,
  body: { reason: string; expectedRevision: number }
) {
  return postJson<unknown>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/discard`,
    body
  );
}

export function stopSettlementTemplateVersion(versionId: string) {
  return postJson<unknown>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/stop`
  );
}

export async function downloadSettlementTemplatePreview(
  versionId: string,
  format: "xlsx" | "pdf",
  downloadReason: string
) {
  const ticket = await postJson<{ downloadUrl: string; fileName: string }>(
    `/settlement-template-workbench/versions/${encodeURIComponent(versionId)}/preview-${format}/download-ticket`,
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
  const displayStatus = [401, 403, 404].includes(response.status) || response.status >= 500 ? response.status : 0;
  let message = formatApiErrorMessage("", displayStatus, fallback);
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const detail = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof data.message === "string"
        ? data.message
        : "";
    message = formatApiErrorMessage(detail, displayStatus, fallback);
  } catch {
    // 非 JSON 响应保留统一中文提示，不展示接口状态。
  }
  throw new Error(message);
}
