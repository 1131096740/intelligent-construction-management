import type { CompanyEntityDataStatus, RoleKey } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface CompanyEntityModel {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
  registeredAddress: string | null;
  dataStatus: CompanyEntityDataStatus;
  isActive: boolean;
  currentVersionNo: number;
  createdAt: string;
  updatedAt: string;
}

export function fetchActiveCompanyEntities() {
  return readJson<CompanyEntityModel[]>("/company-entities", "加载可选我方公司主体失败");
}

export interface CompanyEntityVersionModel {
  id: string;
  companyEntityId: string;
  versionNo: number;
  name: string;
  unifiedSocialCreditCode: string | null;
  registeredAddress: string | null;
  isActive: boolean;
  action: string;
  actorName: string;
  actorRoleKey: RoleKey | null;
  createdAt: string;
}

export interface CompanyEntityFactsPayload {
  name: string;
  unifiedSocialCreditCode: string;
  registeredAddress: string | null;
}

export interface CompanyEntityManagementFilters {
  keyword?: string;
  status?: "all" | "active" | "inactive";
}

export interface CompanyEntityHistoryResponse {
  entity: CompanyEntityModel;
  versions: CompanyEntityVersionModel[];
}

export interface CompanyEntityWriteResponse {
  entity: CompanyEntityModel;
  warning: string | null;
}

export interface CompanyEntityStatusResponse {
  entity: CompanyEntityModel;
  unchanged: boolean;
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
    message = formatApiErrorMessage("", response.status, fallback);
  }
  throw new Error(message);
}

async function readJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: "POST" | "PATCH", body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, fallback);
  return response.json() as Promise<T>;
}

export function fetchCompanyEntityManagement(filters: CompanyEntityManagementFilters = {}) {
  const query = new URLSearchParams();
  if (filters.keyword) query.set("keyword", filters.keyword);
  if (filters.status) query.set("status", filters.status);
  const suffix = query.size ? `?${query.toString()}` : "";
  return readJson<CompanyEntityModel[]>(`/company-entities/management${suffix}`, "加载我方公司主体失败");
}

export function fetchCompanyEntityHistory(id: string) {
  return readJson<CompanyEntityHistoryResponse>(
    `/company-entities/${encodeURIComponent(id)}/history`,
    "加载主体历史失败"
  );
}

export function createCompanyEntity(body: CompanyEntityFactsPayload) {
  return sendJson<CompanyEntityWriteResponse>("/company-entities", "POST", body, "新增我方公司主体失败");
}

export function updateCompanyEntity(id: string, body: CompanyEntityFactsPayload) {
  return sendJson<CompanyEntityWriteResponse>(
    `/company-entities/${encodeURIComponent(id)}`,
    "PATCH",
    body,
    "保存我方公司主体失败"
  );
}

export function updateCompanyEntityStatus(id: string, isActive: boolean) {
  return sendJson<CompanyEntityStatusResponse>(
    `/company-entities/${encodeURIComponent(id)}/status`,
    "POST",
    { isActive },
    "更新主体状态失败"
  );
}
