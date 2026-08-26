import { isBusinessEntryCreateTarget } from "@jiangkong/shared-domain";
import type {
  BusinessEntryDraftPayload,
  BusinessEntryFrozenSnapshot,
  BusinessEntryOperation,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget,
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

export interface BusinessEntryCreateTargetReceipt {
  createTarget: string;
  expiresAt: string;
  entityType: string;
  scope: "global" | "project";
}

export interface BusinessEntrySubmissionTargetReceipt extends BusinessEntryCreateTargetReceipt {
  target: Extract<BusinessEntrySubmissionTarget, { createTarget: string }>;
  action: string;
  definitionKey: string;
  definitionVersion: number;
}

export interface BusinessEntryTargetIntent {
  idempotencyKey: string;
  fingerprint: string;
  definitionKey: string;
  definitionVersion: number;
}

export interface BusinessPartyCreateIntent {
  idempotencyKey: string;
  fingerprint: string;
}

export interface BusinessPartySubmissionPayload {
  target: Extract<BusinessEntrySubmissionTarget, { createTarget: string }>;
  definitionKey: string;
  definitionVersion: number;
  idempotencyKey: string;
  values: Record<string, unknown>;
}

export type BusinessPartyCreationResult =
  | { status: "missing" }
  | { status: "completed"; partyId: string };

export type BusinessEntryRequestScope =
  | { scope: "global"; projectId?: never }
  | { scope: "project"; projectId: string };

function projectIdForScope(scope: BusinessEntryRequestScope) {
  if (!scope || typeof scope !== "object") throw new Error("业务场景 scope 无效");
  if (scope.scope === "project") {
    if (typeof scope.projectId !== "string" || !scope.projectId.trim()) {
      throw new Error("项目业务场景必须绑定项目");
    }
    return scope.projectId;
  }
  if (scope.scope !== "global") throw new Error("业务场景 scope 无效");
  if ("projectId" in scope && scope.projectId !== undefined) {
    throw new Error("全局业务场景不得携带项目上下文");
  }
  return undefined;
}

function appendTarget(query: URLSearchParams, target: BusinessEntrySubmissionTarget) {
  if (!target.entityType.trim()) throw new Error("业务目标类型不能为空");
  query.set("targetEntityType", target.entityType);
  if ("entityId" in target) {
    if (!target.entityId.trim()) throw new Error("业务目标 ID 不能为空");
    query.set("targetEntityId", target.entityId);
  } else {
    if (!target.createTarget.trim()) throw new Error("新建目标令牌不能为空");
    query.set("targetCreateTarget", target.createTarget);
  }
}

function path(
  sceneKey: string,
  scope: BusinessEntryRequestScope,
  suffix = "",
  operation?: BusinessEntryOperation,
  target?: BusinessEntrySubmissionTarget
) {
  const query = new URLSearchParams();
  const projectId = projectIdForScope(scope);
  if (projectId !== undefined) {
    query.set("projectId", projectId);
  }
  if (target) appendTarget(query, target);
  if (operation) query.set("operation", operation);
  const queryString = query.toString();
  return `/business-entry-definitions/${encodeURIComponent(sceneKey)}${suffix}${queryString ? `?${queryString}` : ""}`;
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
  if (!payload.target) throw new Error("业务请求必须绑定正式业务对象");
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

async function postJson<T>(
  requestPath: string,
  body: unknown,
  fallback: string,
  retryUnauthorized = true
): Promise<T> {
  const response = await apiFetch(requestPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(retryUnauthorized ? {} : { retryUnauthorized: false })
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

export function issueBusinessEntryCreateTarget(
  sceneKey: string,
  scope: BusinessEntryRequestScope,
  entityType: string,
  intent: BusinessEntryTargetIntent
) {
  return postJson<BusinessEntryCreateTargetReceipt>(
    path(sceneKey, scope, "/create-target"),
    { entityType, ...intent },
    "获取业务定义探针失败"
  );
}

export function issueBusinessEntrySubmissionTarget(
  sceneKey: string,
  scope: BusinessEntryRequestScope,
  input: BusinessEntryTargetIntent & { entityType: string; probe: string }
) {
  return postJson<BusinessEntrySubmissionTargetReceipt>(
    path(sceneKey, scope, "/submission-target"),
    input,
    "获取独立提交授权失败"
  );
}

export function issueBusinessPartyDefinitionProbe(input: BusinessPartyCreateIntent) {
  return postJson<BusinessEntryCreateTargetReceipt>(
    "/business-entry-definitions/business-party/create/probe",
    input,
    "获取合作单位业务定义探针失败",
    false
  );
}

export function issueBusinessPartySubmissionTarget(
  input: BusinessPartyCreateIntent & { probe: string }
) {
  return postJson<BusinessEntrySubmissionTargetReceipt>(
    "/business-entry-definitions/business-party/create/submission-target",
    input,
    "获取合作单位独立提交授权失败",
    false
  );
}

export function validateBusinessPartyDraft(payload: BusinessEntryDraftPayload) {
  return postJson<BusinessEntryValidationResult>(
    "/business-entry-definitions/business-party/create/validate",
    requestBody(payload),
    "检查合作单位业务草稿失败",
    false
  );
}

export async function submitBusinessPartyCreation(body: BusinessPartySubmissionPayload) {
  const response = await apiFetch("/business-parties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retryUnauthorized: false
  });
  if (response.status === 409) {
    const duplicate = await response.clone().json().catch(() => null) as {
      message?: unknown;
      partyId?: unknown;
    } | null;
    if (
      duplicate &&
      typeof duplicate.message === "string" &&
      typeof duplicate.partyId === "string" &&
      duplicate.partyId.length > 0
    ) {
      const error = new Error(formatApiErrorMessage(
        duplicate.message,
        response.status,
        "创建合作单位失败"
      )) as Error & { partyId: string };
      error.partyId = duplicate.partyId;
      throw error;
    }
  }
  await ensureOk(response, "创建合作单位失败");
  return response.json() as Promise<{ party: { id: string } }>;
}

export async function getBusinessPartyCreationResult(
  idempotencyKey: string,
  fingerprint: string
): Promise<BusinessPartyCreationResult> {
  const query = new URLSearchParams({ idempotencyKey, fingerprint });
  const response = await apiFetch(`/business-parties/creation-result?${query.toString()}`, {
    retryUnauthorized: false
  });
  await ensureOk(response, "查询合作单位创建结果失败");
  const result = await response.json() as Record<string, unknown>;
  const keys = Object.keys(result).sort();
  if (result.status === "missing" && keys.length === 1 && keys[0] === "status") {
    return { status: "missing" };
  }
  if (
    result.status === "completed" &&
    typeof result.partyId === "string" &&
    result.partyId.length > 0 &&
    keys.length === 2 &&
    keys[0] === "partyId" &&
    keys[1] === "status"
  ) {
    return { status: "completed", partyId: result.partyId };
  }
  throw new Error("合作单位创建结果响应无效");
}

export async function fetchBusinessEntryDefinition(
  sceneKey: string,
  scope: BusinessEntryRequestScope,
  target: BusinessEntrySubmissionTarget,
  operation: BusinessEntryOperation = "edit",
  options?: { retryUnauthorized?: boolean }
) {
  if (!target) throw new Error("加载业务字段需要正式业务对象");
  const response = await apiFetch(path(sceneKey, scope, "", operation, target), options);
  await ensureOk(response, "加载业务字段失败");
  return response.json() as Promise<BusinessEntrySceneDefinition>;
}

export function validateBusinessEntryDraft(
  scope: BusinessEntryRequestScope,
  payload: BusinessEntryDraftPayload,
  operation: BusinessEntryOperation = "edit"
) {
  return postJson<BusinessEntryValidationResult>(
    path(payload.sceneKey, scope, "/validate"),
    requestBody(payload, operation),
    "检查业务草稿失败"
  );
}

export function freezeBusinessEntrySnapshot(
  scope: BusinessEntryRequestScope,
  payload: BusinessEntryDraftPayload,
  operation: "edit" | "import" = "edit",
  retryUnauthorized = true
) {
  return postJson<BusinessEntryFrozenSnapshot>(
    path(payload.sceneKey, scope, "/freeze"),
    requestBody(payload, operation),
    "提交业务草稿失败",
    retryUnauthorized
  );
}

export async function downloadBusinessEntryExcelTemplate(
  sceneKey: string,
  scope: BusinessEntryRequestScope,
  target: BusinessEntrySubmissionTarget
) {
  if (!target) throw new Error("下载 Excel 模板需要正式业务对象");
  const response = await apiFetch(path(sceneKey, scope, "/excel-template", undefined, target));
  await ensureOk(response, "下载中文 Excel 模板失败");
  return response.blob();
}

export async function previewBusinessEntryExcel(
  scope: BusinessEntryRequestScope,
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
  if (isBusinessEntryCreateTarget(payload.target)) {
    formData.append("targetCreateTarget", payload.target.createTarget);
  } else {
    formData.append("targetEntityId", payload.target.entityId);
  }
  const response = await apiFetch(path(payload.sceneKey, scope, "/excel-preview"), {
    method: "POST",
    body: formData
  });
  await ensureOk(response, "预检业务 Excel 失败");
  return response.json() as Promise<BusinessEntryExcelPreviewResult>;
}
