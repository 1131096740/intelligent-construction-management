import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type FundExecutionObservationPurpose = "fund_execution_case";
export type FundExecutionKind = "quarantine" | "reversal";
export type FundExecutionDirection = "inflow" | "outflow";
export type FundExecutionCaseStatus =
  | "draft"
  | "submitted"
  | "confirmed";
export type FundExecutionAxis =
  | "payable"
  | "project_fund"
  | "relationship"
  | "operating";
export type FundExecutionAxisStatus = "applied" | "not_applicable";
export type FundExecutionCaseActionKey =
  | "update_case"
  | "submit_case"
  | "return_case"
  | "confirm_case"
  | "approve"
  | "return_approval";

export interface FundExecutionObservationOption {
  selectionRef: string;
  expiresAt: string;
  summary: string;
}

export interface FundExecutionReversalOption {
  targetSelectionRef: string;
  expiresAt: string;
  summary: string;
}

export interface FundExecutionClassificationAxisOption {
  axis: FundExecutionAxis;
  status: FundExecutionAxisStatus;
  selectionRef: string;
  summary: string;
}

export interface FundExecutionClassificationLine {
  lineNo: number;
  amountCents: string;
  summary: string;
  axes: FundExecutionClassificationAxisOption[];
}

export interface FundExecutionClassificationPlan {
  summary: string;
  expiresAt: string;
  lines: FundExecutionClassificationLine[];
}

export interface FundExecutionCaseAction {
  key: FundExecutionCaseActionKey;
  label: string;
  enabled: boolean;
  disabledReason: string | null;
}

export interface FundExecutionCaseListItem {
  caseRef: string;
  caseLabel: string;
  executionKind: FundExecutionKind;
  direction: FundExecutionDirection;
  directionLabel: string;
  observationSummary: string;
  amountCents: string;
  occurredAt: string;
  reason: string;
  classificationSummary: string | null;
  status: FundExecutionCaseStatus;
  statusLabel: string;
  approvalStatusLabel: string | null;
  revision: number;
  updatedAt: string;
  actions: FundExecutionCaseAction[];
}

export interface FundExecutionCapabilities {
  createCase: boolean;
  createReversal: boolean;
}

export interface CreateFundExecutionCaseInput {
  observationSelectionRef: string;
  reason: string;
  idempotencyKey: string;
}

export interface CreateFundExecutionReversalInput {
  targetSelectionRef: string;
  observationSelectionRef: string;
  reason: string;
  idempotencyKey: string;
}

export interface UpdateFundExecutionCaseInput {
  expectedRevision: number;
  reason: string;
  selections: Array<{ selectionRef: string }>;
  idempotencyKey: string;
}

export interface UpdateFundExecutionReversalReasonInput {
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
}

export interface FundExecutionCaseCommandInput {
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ReturnFundExecutionCaseInput
  extends FundExecutionCaseCommandInput {
  reason: string;
}

export function fetchFundExecutionCases() {
  return read<FundExecutionCaseListItem[]>(
    "/fund-executions/cases",
    "加载资金执行案件失败"
  );
}

export function fetchFundExecutionCapabilities() {
  return read<FundExecutionCapabilities>(
    "/fund-executions/capabilities",
    "加载资金执行操作能力失败"
  );
}

export function fetchFundExecutionCaseActions(caseRef: string) {
  return read<Pick<FundExecutionCaseListItem, "actions">>(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}`,
    "加载资金执行案件操作失败"
  );
}

export function fetchFundExecutionObservationOptions(
  purpose: FundExecutionObservationPurpose
) {
  const query = new URLSearchParams({ purpose });
  return read<FundExecutionObservationOption[]>(
    `/fund-executions/observation-options?${query.toString()}`,
    "加载银行流水候选失败"
  );
}

export function fetchFundExecutionCaseOptions(caseRef: string) {
  return read<FundExecutionClassificationPlan[]>(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}/classification-options`,
    "加载逐轴分类选项失败"
  );
}

export function fetchFundExecutionReversalOptions() {
  return read<FundExecutionReversalOption[]>(
    "/fund-executions/reversal-options",
    "加载可反向执行事项失败"
  );
}

export function createFundExecutionCase(input: CreateFundExecutionCaseInput) {
  return post("/fund-executions/cases", input, "创建资金执行案件失败");
}

export function createFundExecutionReversal(
  input: CreateFundExecutionReversalInput
) {
  return post(
    "/fund-executions/reversals",
    input,
    "创建反向资金执行案件失败"
  );
}

export function updateFundExecutionCase(
  caseRef: string,
  input: UpdateFundExecutionCaseInput
) {
  return request(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}`,
    "PATCH",
    input,
    "保存资金执行分类失败"
  );
}

export function updateFundExecutionReversalReason(
  caseRef: string,
  input: UpdateFundExecutionReversalReasonInput
) {
  return request(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}/reversal`,
    "PATCH",
    input,
    "保存反向资金执行原因失败"
  );
}

export function submitFundExecutionCase(
  caseRef: string,
  input: FundExecutionCaseCommandInput
) {
  return lifecycle(caseRef, "submit", input, "提交资金执行案件失败");
}

export function returnFundExecutionCase(
  caseRef: string,
  input: ReturnFundExecutionCaseInput
) {
  return lifecycle(caseRef, "return", input, "生成退回修改稿失败");
}

export function confirmFundExecutionCase(
  caseRef: string,
  input: FundExecutionCaseCommandInput
) {
  return lifecycle(caseRef, "confirm", input, "确认资金执行案件失败");
}

export function reviewFundExecutionCase(
  caseRef: string,
  input: { action: "approve" | "return_to_applicant"; comment?: string }
) {
  const comment = input.comment?.trim();
  return post(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}/approval-actions`,
    {
      action: input.action,
      ...(comment ? { comment } : {})
    },
    input.action === "approve" ? "审批资金执行案件失败" : "退回资金执行审批失败"
  );
}

function lifecycle(
  caseRef: string,
  action: "submit" | "return" | "confirm",
  input: FundExecutionCaseCommandInput | ReturnFundExecutionCaseInput,
  fallback: string
) {
  return post(
    `/fund-executions/cases/${encodeURIComponent(caseRef)}/${action}`,
    input,
    fallback
  );
}

async function read<T>(path: string, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path), fallback);
}

async function post(path: string, body: unknown, fallback: string) {
  return request(path, "POST", body, fallback);
}

async function request(
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  fallback: string
) {
  return readResponse<unknown>(
    await apiFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    fallback
  );
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let detail = "";
  try {
    const body = await response.clone().json() as { message?: unknown };
    detail = Array.isArray(body.message)
      ? body.message.join("；")
      : typeof body.message === "string"
        ? body.message
        : "";
  } catch {
    detail = "";
  }
  throw new Error(formatApiErrorMessage(detail, response.status, fallback));
}
