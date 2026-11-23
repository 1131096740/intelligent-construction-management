import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type FundFlowType =
  | "receipt"
  | "payment"
  | "transfer_in"
  | "transfer_out"
  | "refund";

export interface FundFlowFilters {
  projectId?: string;
  companyEntityId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: FundFlowType | null;
  page?: number;
  pageSize?: number;
}

export interface FundFlowRow {
  id: string;
  factId: string;
  impactId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  occurredAt: string;
  holderKind: string;
  holderId: string;
  holderName: string;
  direction: "in" | "out";
  directionLabel: string;
  type: FundFlowType;
  typeLabel: string;
  amountCents: string;
  balanceAfterCents: string;
  sourceType: string;
  sourceTypeLabel: string;
  sourceBusinessCode: string;
  description: string | null;
}

export interface FundFlowPage {
  rows: FundFlowRow[];
  summary: {
    inflowCents: string;
    outflowCents: string;
    refundCents: string;
    rowCount: number;
  };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: {
    projectId: string | null;
    companyEntityId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    type: FundFlowType | null;
  };
}

function queryString(filters: FundFlowFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function fetchFundFlows(filters: FundFlowFilters = {}) {
  const response = await apiFetch(`/fund-flows${queryString(filters)}`);
  if (!response.ok) {
    throw new Error(
      formatApiErrorMessage(
        await response.text().catch(() => ""),
        response.status,
        "读取资金流水失败"
      )
    );
  }
  return response.json() as Promise<FundFlowPage>;
}

export async function downloadFundFlowExport(filters: FundFlowFilters = {}) {
  const response = await apiFetch(`/fund-flows/export${queryString(filters)}`);
  if (!response.ok) {
    throw new Error(
      formatApiErrorMessage(
        await response.text().catch(() => ""),
        response.status,
        "导出资金流水失败"
      )
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  saveBlob(
    blob,
    match ? decodeURIComponent(match[1]) : "资金流水.xlsx"
  );
}
