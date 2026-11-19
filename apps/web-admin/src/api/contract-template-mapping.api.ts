import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface MaintainedLayout {
  id: string;
  name: string;
  contractTypeKey: string;
  versions: Array<{ id: string; versionNo: number; status: string; draftRevision: number; updatedAt: string }>;
}

async function templateRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await apiFetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: unknown };
    const message = typeof error.message === "string" ? error.message : Array.isArray(error.message) ? error.message.filter(value => typeof value === "string").join("；") : "";
    throw new Error(formatApiErrorMessage(message, response.status, "模板操作失败，请检查后重试"));
  }
  return response.json() as Promise<T>;
}

export function getLayoutCreationCapability() {
  return templateRequest<{ canCreate: boolean }>("/contract-layout-templates/creation-capability");
}

export function getLayoutVersionMaintenanceCapability(versionId: string) {
  return templateRequest<{ versionId: string; draftRevision: number; sourceFileId: string; availableActions: Array<{ key: string; enabled: boolean }> }>(`/contract-layout-template-versions/${encodeURIComponent(versionId)}/maintenance-capability`);
}

export function listMaintainedLayouts() {
  return templateRequest<MaintainedLayout[]>("/contract-layout-templates/maintenance");
}

export interface LayoutSourceBinding { positionId: string; start: number; end: number; fieldKey: string }
export interface LayoutSourcePositions {
  availableActions: Array<{ key: string; enabled: boolean; disabledReason?: string | null }>;
  versionId: string;
  sourceFileId: string;
  sourceSha256: string;
  draftRevision: number;
  fields: Array<{ key: string; label: string; required: boolean }>;
  positions: Array<{ positionId: string; part: string; paragraphIndex: number; text: string }>;
  bindings: LayoutSourceBinding[];
  mappingFingerprint: string | null;
  confirmed: boolean;
}
export function getLayoutSourcePositions(versionId: string) {
  return templateRequest<LayoutSourcePositions>(`/contract-layout-template-versions/${encodeURIComponent(versionId)}/source-positions`);
}
export function saveLayoutSourceMapping(versionId: string, body: { expectedRevision: number; sourceFileId: string; sourceSha256: string; bindings: LayoutSourceBinding[] }) {
  return templateRequest<{ draftRevision: number; mappingFingerprint: string; confirmed: false }>(`/contract-layout-template-versions/${encodeURIComponent(versionId)}/source-mapping`, "PATCH", body);
}
export function confirmLayoutSourceMapping(versionId: string, body: { expectedRevision: number; sourceFileId: string; sourceSha256: string; mappingFingerprint: string }) {
  return templateRequest<{ confirmed: true; draftRevision: number }>(`/contract-layout-template-versions/${encodeURIComponent(versionId)}/source-mapping-confirmation`, "POST", body);
}
