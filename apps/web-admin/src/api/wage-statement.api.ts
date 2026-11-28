import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

/** Carries the HTTP response status for a historical read failure. */
export class WageStatementApiError extends Error {
  readonly name = "WageStatementApiError";

  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type WageStatementWorkflowStatus = "draft" | "submitted" | "returned" | "confirmed";

/** The server retains disabled write flags for older clients. */
export interface WageStatementCapabilities {
  canPrepare: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canConfirm: boolean;
  canReadSensitive: boolean;
  canDownloadSensitive: boolean;
  canExportSensitive: boolean;
}

/** The monthly workbench deliberately transports aggregate, non-sensitive data only. */
export interface WageStatementWorkbenchItem {
  statementId: string;
  employmentCompanyName: string;
  wageMonth: string;
  status: WageStatementWorkflowStatus;
  statusLabel: string;
  revision: number;
  sourceLabel: string;
  personLineCount: number;
  positionCategoryCount: number;
  projectAllocationCount: number;
  updatedAt: string;
  latestReviewReturn: { revision: number; returnedAt: string } | null;
}

export interface WageStatementWorkbenchReadModel {
  items: WageStatementWorkbenchItem[];
  capabilities: WageStatementCapabilities;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface WageStatementSummaryReadModel {
  employmentCompanyName: string;
  wageMonth: string;
  statusLabel: string;
  revision: number;
  sourceLabel: string;
  personLineCount: number;
  positionCategoryCount: number;
  projectAllocationCount: number;
  categories: Array<{
    positionCategoryLabel: string;
    personLineCount: number;
    projectAllocationCount: number;
  }>;
  latestReviewReturn: { revision: number; returnedAt: string } | null;
  capabilities: WageStatementCapabilities;
}

export interface WageStatementImportPreviewReadModel {
  employmentCompanyName: string;
  wageMonth: string;
  sourceLabel: string;
  sourceStatusLabel: string;
  personLineCount: number;
  positionCategoryCount: number;
  projectAllocationCount: number;
}

export async function fetchWageStatementWorkbench(page = 1, pageSize = 20) {
  return read<WageStatementWorkbenchReadModel>(`/wage-statements/workbench?page=${page}&pageSize=${pageSize}`, "读取月度工资承担工作台失败");
}

export async function fetchWageStatementSummary(statementId: string) {
  return read<WageStatementSummaryReadModel>(
    `/wage-statements/${encodeURIComponent(statementId)}/summary`,
    "读取月度工资汇总详情失败"
  );
}

export async function fetchWageStatementImportPreview(statementId: string) {
  return read<WageStatementImportPreviewReadModel>(
    `/wage-statements/${encodeURIComponent(statementId)}/import-preview`,
    "读取工资来源导入预览失败"
  );
}

async function read<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  let message = `${fallback}：${response.status}`;
  try {
    const body = await response.clone().json() as { message?: unknown };
    const detail = typeof body.message === "string"
      ? body.message
      : Array.isArray(body.message)
        ? body.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new WageStatementApiError(message, response.status);
}
