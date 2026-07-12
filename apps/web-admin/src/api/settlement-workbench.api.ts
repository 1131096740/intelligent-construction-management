import type { SettlementSourceLinesReadModel } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface SettlementLineDraftPayload {
  sourceType: "contract_bill_row" | "manual_adjustment";
  contractBillRowId?: string;
  name?: string;
  quantity?: string;
  amountCents?: string;
  reason?: string;
  remark?: string;
  sortOrder?: number;
}

export interface SettlementCanonicalPreviewLineReadModel {
  sourceType: "contract_bill_row" | "manual_adjustment";
  calculationMode: "normal_auto" | "manual_amount" | "manual_adjustment";
  contractBillRowId: string | null;
  name: string;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amountCents: string;
  reason: string | null;
  remark: string | null;
  sortOrder: number;
}

export interface SettlementCanonicalPreviewReadModel {
  contractVersionId: string;
  amountCents: string;
  lines: SettlementCanonicalPreviewLineReadModel[];
}

export async function fetchSettlementSourceLines(
  contractVersionId: string
): Promise<SettlementSourceLinesReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/source-lines`,
    { method: "GET" }
  );
  if (!response.ok) {
    let message = `加载合同清单失败：${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: unknown };
      if (typeof data.message === "string") {
        message = formatApiErrorMessage(data.message, response.status, "加载合同清单失败");
      }
    } catch {
      // 非 JSON 错误响应保留中文状态码兜底。
    }
    throw new Error(message);
  }
  return response.json() as Promise<SettlementSourceLinesReadModel>;
}

export async function previewSettlementLines(
  contractVersionId: string,
  body: { settlementLines: SettlementLineDraftPayload[] }
): Promise<SettlementCanonicalPreviewReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    let message = `后台核算结算明细失败：${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: unknown };
      if (typeof data.message === "string") {
        message = formatApiErrorMessage(data.message, response.status, "后台核算结算明细失败");
      }
    } catch {
      // 非 JSON 错误响应保留中文状态码兜底。
    }
    throw new Error(message);
  }
  return response.json() as Promise<SettlementCanonicalPreviewReadModel>;
}
