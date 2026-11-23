import { apiFetch } from "./api-fetch";

export type FinancialCorrectionDocType = "payment_request" | "payment_execution" | "settlement" | "contract";

export interface FinancialCorrectionAction {
  key: string;
  label: string;
  path: string;
  method: "page" | "api";
  enabled: boolean;
  reason?: string;
}

export interface FinancialCorrectionCapability {
  type: string;
  id: string;
  paymentId?: string;
  code?: string;
  status: string;
  title: string;
  guidance: string;
  actions: FinancialCorrectionAction[];
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.message === "string" ? body.message : "办理失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

export async function fetchFinancialCorrectionCapability(type: FinancialCorrectionDocType, id: string) {
  return json<FinancialCorrectionCapability>(await apiFetch(
    `/payment-financial/entry/capability?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
  ));
}
