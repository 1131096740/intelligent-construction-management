import type {
  SettlementSourceLinesReadModel,
  SettlementSubmissionBlocker
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export const SETTLEMENT_FIELD_REVIEWER_ROLE_KEYS = [
  "material_staff",
  "engineering_foreman",
  "engineering_tech"
] as const;

export type SettlementFieldReviewerRoleKey =
  (typeof SETTLEMENT_FIELD_REVIEWER_ROLE_KEYS)[number];

export function isSettlementFieldReviewerRoleAllowed(
  value: unknown
): value is SettlementFieldReviewerRoleKey {
  return typeof value === "string" &&
    (SETTLEMENT_FIELD_REVIEWER_ROLE_KEYS as readonly string[]).includes(value);
}

export interface SettlementParticipantOptionReadModel {
  userId: string;
  name: string;
  roleKey: SettlementFieldReviewerRoleKey;
  roleLabel: string;
}

export interface SettlementParticipantOptionsReadModel {
  route: "material_mechanical" | "labor_professional";
  options: SettlementParticipantOptionReadModel[];
}

export interface SettlementLineDraftPayload {
  sourceType: "contract_bill_row" | "visa_change" | "manual_adjustment";
  adjustmentKind?: "ordinary" | "retrospective_price_difference" | "over_settlement_offset";
  lineKey?: string;
  contractBillRowId?: string;
  sourceItemType?: string;
  occurredOn?: string;
  name?: string;
  description?: string;
  unit?: string;
  quantity?: string;
  unitPriceCents?: string;
  amountCents?: string;
  pricingBasis?: string;
  overageReason?: string;
  relatedSettlementLineId?: string;
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
  amountCents: string | null;
  reason: string | null;
  remark: string | null;
  sortOrder: number;
}

export interface SettlementCanonicalSubmissionBlocker
  extends SettlementSubmissionBlocker {
  contractBillRowId: string | null;
}

export interface SettlementCanonicalPreviewReadModel {
  contractVersionId: string;
  amountCents: string | null;
  lines: SettlementCanonicalPreviewLineReadModel[];
  submissionBlockers: SettlementCanonicalSubmissionBlocker[];
}

export interface SettlementImportErrorReadModel {
  row: number;
  column: string;
  message: string;
}

export interface SettlementImportPreviewReadModel {
  importId: string;
  sourceRevision: string;
  selectedCount: number;
  settlementLines: SettlementLineDraftPayload[];
  canonical: SettlementCanonicalPreviewReadModel | null;
  errors: SettlementImportErrorReadModel[];
}

export interface SettlementImportAppliedResultReadModel {
  contractVersionId: string;
  settlementTemplateVersionId: string;
  sourceRevision: string;
  settlementLines: SettlementLineDraftPayload[];
  canonical: SettlementCanonicalPreviewReadModel;
}

export interface SettlementImportApplyReadModel {
  importId: string;
  status: "applied";
  result: SettlementImportAppliedResultReadModel;
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

export async function fetchSettlementParticipantOptions(
  contractVersionId: string
): Promise<SettlementParticipantOptionsReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/participant-options`,
    { method: "GET" }
  );
  await ensureOk(response, "加载现场复核人失败");
  return response.json() as Promise<SettlementParticipantOptionsReadModel>;
}

export async function previewSettlementLines(
  contractVersionId: string,
  body: { isFinal?: boolean; settlementLines: SettlementLineDraftPayload[] }
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

export async function previewSettlementImport(
  contractVersionId: string,
  body: { fileId: string; settlementTemplateVersionId: string }
): Promise<SettlementImportPreviewReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/imports/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  await ensureOk(response, "结算 Excel 预检失败");
  return response.json() as Promise<SettlementImportPreviewReadModel>;
}

export async function applySettlementImport(
  projectId: string,
  importId: string
): Promise<SettlementImportApplyReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }
  );
  await ensureOk(response, "应用结算 Excel 导入失败");
  return response.json() as Promise<SettlementImportApplyReadModel>;
}

export function downloadSettlementImportTemplate(contractVersionId: string): Promise<void> {
  return downloadWorkbook(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/import-template`,
    "下载结算导入模板失败",
    "本期结算导入模板.xlsx"
  );
}

export function downloadSettlementImportErrors(
  projectId: string,
  importId: string
): Promise<void> {
  return downloadWorkbook(
    `/settlement-workbench/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}/errors.xlsx`,
    "下载结算导入错误表失败",
    "结算导入错误.xlsx"
  );
}

export function downloadSettlementImportResult(
  projectId: string,
  importId: string
): Promise<void> {
  return downloadWorkbook(
    `/settlement-workbench/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(importId)}/result.xlsx`,
    "下载结算导入结果失败",
    "结算导入结果.xlsx"
  );
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
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
    // 非 JSON 错误响应保留中文状态码兜底。
  }
  throw new Error(message);
}

async function downloadWorkbook(path: string, fallback: string, fallbackFileName: string) {
  const response = await apiFetch(path);
  await ensureOk(response, fallback);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1]) : fallbackFileName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
