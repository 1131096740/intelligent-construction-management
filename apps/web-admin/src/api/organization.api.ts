import type { RoleKey } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface OrganizationDepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  children: OrganizationDepartmentNode[];
}

export interface OrganizationDirectoryUser {
  id: string;
  name: string;
  phone: string;
  departmentId: string | null;
  departmentName: string;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  globalPositions: Array<{ key: RoleKey; name: string }>;
  projectPositions: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    keys: RoleKey[];
    names: string[];
  }>;
}

export interface OrganizationDirectory {
  summary: {
    departments: number;
    activeUsers: number;
    inactiveUsers: number;
    positions: number;
  };
  departments: OrganizationDepartmentNode[];
  users: OrganizationDirectoryUser[];
  positions: Array<{ id: string; key: RoleKey; name: string }>;
}

export interface CreateOrganizationDepartmentPayload {
  name: string;
  parentId?: string | null;
  confirmationPassword: string;
}

export interface UpdateOrganizationDepartmentPayload {
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
  confirmationPassword: string;
}

export interface UpdateOrganizationUserPayload {
  departmentId?: string | null;
  isActive?: boolean;
  confirmationPassword: string;
}

export interface OrganizationDepartmentMutationResult {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

export interface OrganizationUserMutationResult {
  id: string;
  departmentId: string | null;
  isActive: boolean;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new Error(message);
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取组织目录失败");
  return response.json() as Promise<T>;
}

async function sendJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存组织信息失败");
  return response.json() as Promise<T>;
}

export function fetchOrganizationDirectory() {
  return readJson<OrganizationDirectory>("/organization/directory");
}

export function createOrganizationDepartment(payload: CreateOrganizationDepartmentPayload) {
  return sendJson<OrganizationDepartmentMutationResult>("/organization/departments", "POST", {
    name: payload.name,
    ...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
    confirmationPassword: payload.confirmationPassword
  });
}

export function updateOrganizationDepartment(
  departmentId: string,
  payload: UpdateOrganizationDepartmentPayload
) {
  return sendJson<OrganizationDepartmentMutationResult>(
    `/organization/departments/${encodeURIComponent(departmentId)}`,
    "PATCH",
    {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      confirmationPassword: payload.confirmationPassword
    }
  );
}

export function updateOrganizationUser(userId: string, payload: UpdateOrganizationUserPayload) {
  return sendJson<OrganizationUserMutationResult>(
    `/organization/users/${encodeURIComponent(userId)}`,
    "PATCH",
    {
      ...(payload.departmentId !== undefined ? { departmentId: payload.departmentId } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      confirmationPassword: payload.confirmationPassword
    }
  );
}
