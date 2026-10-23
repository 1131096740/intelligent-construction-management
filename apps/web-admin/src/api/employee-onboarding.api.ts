import type { RoleKey } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage, formatUnknownApiError } from "./error-message";

export interface EmployeeApplication {
  id: string; name: string; phone: string;
  status: "pending" | "chairman_review" | "returned" | "approved";
  revision: number; reason: string; createdAt: string; phoneVerified: boolean; mustChangePassword: boolean;
  canResubmit?: boolean; canChangePassword?: boolean;
  departmentId?: string | null;
  proposedRoles?: Array<{ roleKey: RoleKey; scope?: "global" | "project"; projectId?: string }>;
}
export interface ApplicationSession { application: EmployeeApplication; applicationToken: string }
export interface EmployeeReview {
  revision: number; decision: "approve" | "refer" | "return"; departmentId?: string;
  roles?: Array<{ roleKey: RoleKey; scope?: "global" | "project"; projectId?: string }>; identityVerified?: boolean; reason?: string; confirmationPassword: string;
}
export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const applicationStorageKey = "jiangkong-employee-application";
export function saveApplicationSession(session: ApplicationSession) { sessionStorage.setItem(applicationStorageKey, session.applicationToken); }
export function clearApplicationSession() { sessionStorage.removeItem(applicationStorageKey); }
function applicationToken() { return sessionStorage.getItem(applicationStorageKey) ?? ""; }

function requestInit(method: "GET" | "POST", body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

async function responseError(response: Response) {
  let message = "操作未完成，请稍后重试";
  try { const data = await response.json() as { message?: unknown }; message = Array.isArray(data.message) ? data.message.join("；") : typeof data.message === "string" ? data.message : message; } catch { /* 使用中文默认提示 */ }
  return new AccountApiError(formatApiErrorMessage(message, response.status, "操作未完成，请稍后重试"), response.status);
}
async function publicRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  try {
    const response = await fetch(`/api${path}`, { ...requestInit(method, body), method });
    if (!response.ok) throw await responseError(response);
    return await response.json() as T;
  } catch (error) { throw error instanceof AccountApiError ? error : new Error(formatUnknownApiError(error, "网络连接失败，请稍后重试")); }
}
async function applicationRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  try {
    const response = await fetch(`/api${path}`, { ...requestInit(method, body), method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${applicationToken()}` } });
    if (!response.ok) throw await responseError(response);
    return await response.json() as T;
  } catch (error) { throw error instanceof AccountApiError ? error : new Error(formatUnknownApiError(error, "网络连接失败，请稍后重试")); }
}
async function userRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  try {
    const response = await apiFetch(path, { ...requestInit(method, body), method });
    if (!response.ok) throw await responseError(response);
    return await response.json() as T;
  } catch (error) { throw error instanceof AccountApiError ? error : new Error(formatUnknownApiError(error, "网络连接失败，请稍后重试")); }
}
export const fetchAccountOptions = () => publicRequest<{ smsEnabled: boolean; canRegister: boolean; canLoginApplication: boolean; canUseRecoveryCode: boolean }>("/account-security/options", "GET");
export const registerEmployee = (body: { name: string; phone: string; password: string; code?: string }) => publicRequest<ApplicationSession>("/employee-onboarding/register", "POST", body);
export const loginApplication = (phone: string, password: string) => publicRequest<ApplicationSession>("/employee-onboarding/login", "POST", { phone, password });
export const fetchMyApplication = () => applicationRequest<EmployeeApplication>("/employee-onboarding/mine", "GET", undefined);
export const resubmitApplication = (name: string, revision: number) => applicationRequest<EmployeeApplication>("/employee-onboarding/mine", "POST", { name, revision });
export const changeApplicationPassword = (newPassword: string) => applicationRequest<ApplicationSession>("/employee-onboarding/mine/password", "POST", { newPassword });
export const sendAccountSms = (phone: string, purpose: "register" | "reset") => publicRequest<{ ok: boolean; retryAfterSeconds: number }>("/account-security/sms", "POST", { phone, purpose });
export const sendPhoneChangeSms = (phone: string) => userRequest<{ ok: boolean; retryAfterSeconds: number }>("/account-security/phone-change-sms", "POST", { phone });
export const resetPasswordWithSms = (body: { phone: string; code: string; newPassword: string }) => publicRequest<{ ok: boolean }>("/account-security/reset-with-sms", "POST", body);
export const recoverWithCode = (body: { phone: string; recoveryCode: string; newPassword: string }) => publicRequest<{ ok: boolean }>("/account-security/recover", "POST", body);
export const fetchEmployeeApplications = () => userRequest<{ pendingCount: number; applications: EmployeeApplication[] }>("/employee-onboarding/applications", "GET", undefined);
export const reviewEmployeeApplication = (id: string, body: EmployeeReview) => userRequest<EmployeeApplication>(`/employee-onboarding/applications/${encodeURIComponent(id)}/review`, "POST", body);
export const resetEmployeePassword = (id: string, kind: "users" | "applications", confirmationPassword: string) => userRequest<{ temporaryPassword: string; expiresAt?: string }>(`/account-security/${kind}/${encodeURIComponent(id)}/reset-password`, "POST", { confirmationPassword, identityVerified: true });
export const generateRecoveryCode = (confirmationPassword: string) => userRequest<{ recoveryCode: string }>("/account-security/recovery-code", "POST", { confirmationPassword });
