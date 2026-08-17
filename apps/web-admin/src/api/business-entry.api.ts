import type {
  BusinessEntryDraftPayload,
  BusinessEntryFrozenSnapshot,
  BusinessEntryOperation,
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface BusinessEntryExcelPreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: Array<{ fieldKey?: string; column: string; message: string }>;
  payload: BusinessEntryDraftPayload;
}

export interface BusinessEntryExcelPreviewResult {
  zeroWrites: true;
  rows: BusinessEntryExcelPreviewRow[];
}

function path(
  sceneKey: string,
  projectId: string,
  suffix = "",
  operation?: BusinessEntryOperation
) {
  const query = new URLSearchParams({ projectId });
  if (operation) query.set("operation", operation);
  return `/business-entry-definitions/${encodeURIComponent(sceneKey)}${suffix}?${query.toString()}`;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let detail = "";
  try {
    const body = await response.clone().json() as { message?: unknown };
    detail = Array.isArray(body.message)
      ? body.message.join("；")
      : typeof body.message === "string"
        ? body.message
        : "";
  } catch {
    detail = "";
  }
  throw new Error(formatApiErrorMessage(detail, response.status, fallback));
}

function requestBody(payload: BusinessEntryDraftPayload, operation?: BusinessEntryOperation) {
  return {
    ...(payload.definitionVersion === undefined
      ? {}
      : { definitionVersion: payload.definitionVersion }),
    ...(payload.expectedRevision === undefined
      ? {}
      : { expectedRevision: payload.expectedRevision }),
    target: payload.target,
    values: payload.values,
    ...(operation ? { operation } : {})
  };
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

export async function fetchBusinessEntryDefinition(
  sceneKey: string,
  projectId: string,
  operation: BusinessEntryOperation = "edit"
) {
  const response = await apiFetch(path(sceneKey, projectId, "", operation));
  await ensureOk(response, "加载业务字段失败");
  return response.json() as Promise<BusinessEntrySceneDefinition>;
}

export function validateBusinessEntryDraft(
  projectId: string,
  payload: BusinessEntryDraftPayload,
  operation: BusinessEntryOperation = "edit"
) {
  return postJson<BusinessEntryValidationResult>(
    path(payload.sceneKey, projectId, "/validate"),
    requestBody(payload, operation),
    "检查业务草稿失败"
  );
}

export function freezeBusinessEntrySnapshot(
  projectId: string,
  payload: BusinessEntryDraftPayload,
  operation: "edit" | "import" = "edit"
) {
  return postJson<BusinessEntryFrozenSnapshot>(
    path(payload.sceneKey, projectId, "/freeze"),
    requestBody(payload, operation),
    "提交业务草稿失败"
  );
}

export async function downloadBusinessEntryExcelTemplate(
  sceneKey: string,
  projectId: string
) {
  const response = await apiFetch(path(sceneKey, projectId, "/excel-template"));
  await ensureOk(response, "下载中文 Excel 模板失败");
  return response.blob();
}

export async function previewBusinessEntryExcel(
  projectId: string,
  payload: BusinessEntryDraftPayload,
  file: File
) {
  if (payload.definitionVersion === undefined || !payload.target) {
    throw new Error("Excel 预检需要当前字段版本和正式业务对象");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("definitionVersion", String(payload.definitionVersion));
  formData.append("targetEntityType", payload.target.entityType);
  formData.append("targetEntityId", payload.target.entityId);
  const response = await apiFetch(path(payload.sceneKey, projectId, "/excel-preview"), {
    method: "POST",
    body: formData
  });
  await ensureOk(response, "预检业务 Excel 失败");
  return response.json() as Promise<BusinessEntryExcelPreviewResult>;
}
