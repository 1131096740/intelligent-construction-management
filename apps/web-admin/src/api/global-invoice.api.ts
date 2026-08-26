import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type GlobalInvoiceCommandResult = {
  id: string;
  lifecycleEventId?: string;
  replayed: boolean;
};

async function post<T>(path: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.clone().json() as { message?: unknown };
      detail = Array.isArray(payload.message) ? payload.message.join("；") : typeof payload.message === "string" ? payload.message : "";
    } catch { /* fall through to safe generic message */ }
    throw new Error(formatApiErrorMessage(detail, response.status, fallback));
  }
  return response.json() as Promise<T>;
}

export type GlobalInvoiceCapabilities = { create: boolean; correct: boolean };

export type GlobalInvoiceOption = {
  id: string;
  invoiceType: string;
  identityKind: string;
  invoiceCode: string | null;
  invoiceNumber: string | null;
  externalIdentifier: string | null;
  issueDate: string;
  sellerName: string;
  totalAmountCents: string;
  direction: string | null;
  sourceBusinessType: string;
  allocations: Array<{ id: string; amountCents: string; reversesAllocationId: string | null; createdAt: string }>;
};

export async function fetchGlobalInvoices() {
  const response = await apiFetch("/global-invoices");
  if (!response.ok) throw new Error(formatApiErrorMessage("", response.status, "加载可选全局发票失败"));
  return response.json() as Promise<GlobalInvoiceOption[]>;
}

export async function fetchGlobalInvoiceCapabilities() {
  const response = await apiFetch("/global-invoices/capabilities");
  if (!response.ok) throw new Error(formatApiErrorMessage("", response.status, "加载全局发票权限失败"));
  return response.json() as Promise<GlobalInvoiceCapabilities>;
}

export function createGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/global-invoices", body, "登记全局发票失败");
}

export function allocateGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/invoice-clearing-allocations", body, "登记清分发票分配失败");
}

export function reverseGlobalInvoiceAllocation(allocationId: string, body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>(`/invoice-clearing-allocations/${encodeURIComponent(allocationId)}/reversal`, body, "反向清分发票分配失败");
}

export function voidGlobalInvoice(invoiceRecordId: string, body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>(`/global-invoices/${encodeURIComponent(invoiceRecordId)}/void`, body, "作废全局发票失败");
}

export function createRedGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/global-invoices/red", body, "登记红字全局发票失败");
}

export function createReissueGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/global-invoices/reissue", body, "重开全局发票失败");
}
