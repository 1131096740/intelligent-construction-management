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

export function createGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/global-invoices", body, "登记全局发票失败");
}

export function allocateGlobalInvoice(body: Record<string, unknown>) {
  return post<GlobalInvoiceCommandResult>("/invoice-clearing-allocations", body, "登记清分发票分配失败");
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
