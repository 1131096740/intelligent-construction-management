import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

/** A lifecycle rejection is a known response, unlike an uncertain transport failure. */
export class WageStatementApiError extends Error {
  readonly name = "WageStatementApiError";

  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type WageStatementWorkflowStatus = "draft" | "submitted" | "returned" | "confirmed";

/** Action availability is issued by the server; the client never infers it from roles. */
export interface WageStatementCapabilities {
  canPrepare: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canConfirm: boolean;
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

export interface WageStatementCommandInput {
  idempotencyKey: string;
  expectedRevision: number;
}

export interface ReturnWageStatementInput extends WageStatementCommandInput {
  reason: string;
}

export interface WageStatementCommandResult {
  statementId: string;
  revision: number;
  status?: WageStatementWorkflowStatus;
}

export interface ApprovedWageSourceResult {
  id: string;
}

export async function fetchWageStatementWorkbench() {
  return read<WageStatementWorkbenchReadModel>("/wage-statements/workbench", "读取月度工资承担工作台失败");
}

/** Fresh capability reads gate writes; aggregate reads are display hints only. */
export async function fetchWageStatementCapabilities() {
  return read<WageStatementCapabilities>("/wage-statements/capabilities", "读取工资承担操作权限失败");
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

/**
 * The external approved-source payload is intentionally opaque in this UI module:
 * it is parsed locally only to produce non-sensitive counts, then sent to the
 * domain API. No employee, amount, or evidence field is rendered by this page.
 */
export function createApprovedWageSource(body: Record<string, unknown>) {
  return post<ApprovedWageSourceResult>("/wage-statements/approved-sources", body, "导入外部批准工资来源失败");
}

export function createWageStatementDraft(body: Record<string, unknown>) {
  return post<WageStatementCommandResult>("/wage-statements/drafts", body, "创建工资承担草稿失败");
}

export function submitWageStatement(statementId: string, body: WageStatementCommandInput) {
  return command(statementId, "submit", body, "提交工资承担单失败");
}

export function returnWageStatement(statementId: string, body: ReturnWageStatementInput) {
  return command(statementId, "return", body, "退回工资承担单失败");
}

export function confirmWageStatement(statementId: string, body: WageStatementCommandInput) {
  return command(statementId, "confirm", body, "确认工资承担单失败");
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

function command(
  statementId: string,
  action: "submit" | "return" | "confirm",
  body: WageStatementCommandInput | ReturnWageStatementInput,
  fallback: string
) {
  return post<WageStatementCommandResult>(
    `/wage-statements/${encodeURIComponent(statementId)}/${action}`,
    body,
    fallback
  );
}

async function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.ok) return response.json() as Promise<T>;
  let message = `${fallback}：${response.status}`;
  try {
    const payload = await response.clone().json() as { message?: unknown };
    const detail = typeof payload.message === "string"
      ? payload.message
      : Array.isArray(payload.message)
        ? payload.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new WageStatementApiError(message, response.status);
}
