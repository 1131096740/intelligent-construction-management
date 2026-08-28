import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface PayableSettlementCandidate {
  selectionRef: string;
  expiresAt: string;
  displayLabel: string;
  executedAt: string;
  payerLabel: string;
  statusLabel: string;
  availableAmountCents: string;
}

export interface PayableSettlementCapabilities {
  read: boolean;
  allocate: boolean;
  submit: boolean;
  confirm: boolean;
  return: boolean;
}

export interface PayableSettlementCandidateReadModel {
  caseRevision: number;
  candidates: PayableSettlementCandidate[];
}

export interface WagePayableCaseOption {
  payableRef: string;
  caseRevision: number;
  displayLabel: string;
  debtorCompanyLabel: string;
  creditorLabel: string;
  status: "allocatable" | "over_settled_reconciliation_required";
  statusLabel: string;
  remainingAmountCents: string;
  overSettledAmountCents: string;
}

export interface PayableSettlementWorkbenchItem {
  settlementCaseId: string;
  status: string;
  statusLabel: string;
  revision: number;
  allocatedAmountCents: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface AllocatePayableSettlementInput {
  selectionRef: string;
  selectionExpiresAt: string;
  amountCents: string;
  expectedCaseRevision: number;
  idempotencyKey: string;
}

export interface PayableSettlementCommandInput {
  expectedRevision: number;
  idempotencyKey: string;
}

export interface PayableSettlementCommandResult {
  settlementCaseId: string;
  status: string;
  statusLabel?: string;
  revision: number;
  payableRef?: string;
  allocatedAmountCents?: string;
}

export interface InterEntityRelationshipReadModel {
  relationshipEntryId: string;
  debtorLabel: string;
  creditorLabel: string;
  approvedPayerLabel: string;
  amountCents: string;
  remainingAmountCents: string;
  status: "open" | "returned";
  statusLabel: string;
}

export interface ReturnInterEntityRelationshipInput {
  amountCents: string;
  evidenceFileId: string;
  evidenceClaimId: string;
  reason: string;
  idempotencyKey: string;
}

export interface InterEntityRelationshipEvidenceUploadResult {
  id: string;
  claimId: string;
}

export function fetchPayableSettlementWorkbench() {
  return read<PayableSettlementWorkbenchItem[]>(
    "/payable-settlements/workbench",
    "加载工资应付核销工作台失败"
  );
}

export function fetchPayableSettlementCapabilities() {
  return read<PayableSettlementCapabilities>(
    "/payable-settlements/capabilities",
    "加载工资应付核销权限失败"
  );
}

export function fetchWagePayableCases() {
  return read<WagePayableCaseOption[]>(
    "/payable-settlements/wage-payable-cases",
    "加载可核销工资应付案件失败"
  );
}

export function fetchInterEntityRelationships() {
  return read<InterEntityRelationshipReadModel[]>(
    "/payable-settlements/inter-entity-relationships",
    "加载跨主体代付往来失败"
  );
}

export function returnInterEntityRelationship(
  relationshipEntryId: string,
  input: ReturnInterEntityRelationshipInput
) {
  return post<{
    relationshipEntryId: string;
    returnEntryId: string;
    returnedAmountCents: string;
    remainingAmountCents: string;
    status: "open" | "returned";
  }>(
    `/payable-settlements/inter-entity-relationships/${encodeURIComponent(relationshipEntryId)}/returns`,
    input,
    "归还跨主体代付往来失败"
  );
}

export function uploadInterEntityRelationshipEvidence(
  relationshipEntryId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return postForm<InterEntityRelationshipEvidenceUploadResult>(
    `/payable-settlements/inter-entity-relationships/${encodeURIComponent(relationshipEntryId)}/evidence`,
    form
  );
}

export function fetchPaymentExecutionCandidates(payableRef: string) {
  return read<PayableSettlementCandidateReadModel>(
    `/payable-settlements/wage-payable-cases/${encodeURIComponent(payableRef)}/payment-execution-candidates`,
    "加载可核销付款候选失败"
  );
}

export function allocatePayableSettlement(
  payableRef: string,
  input: AllocatePayableSettlementInput
) {
  return post<PayableSettlementCommandResult>(
    `/payable-settlements/wage-payable-cases/${encodeURIComponent(payableRef)}/allocations`,
    input,
    "保存工资应付核销失败"
  );
}

export function submitPayableSettlement(
  settlementCaseId: string,
  input: PayableSettlementCommandInput
) {
  return lifecycle(settlementCaseId, "submit", input, "提交工资应付核销失败");
}

export function confirmPayableSettlement(
  settlementCaseId: string,
  input: PayableSettlementCommandInput
) {
  return lifecycle(settlementCaseId, "confirm", input, "确认工资应付核销失败");
}

export function returnPayableSettlement(
  settlementCaseId: string,
  input: PayableSettlementCommandInput
) {
  return lifecycle(settlementCaseId, "return", input, "退回工资应付核销失败");
}

function lifecycle(
  settlementCaseId: string,
  action: "submit" | "confirm" | "return",
  input: PayableSettlementCommandInput,
  fallback: string
) {
  return post<PayableSettlementCommandResult>(
    `/payable-settlements/${encodeURIComponent(settlementCaseId)}/${action}`,
    input,
    fallback
  );
}

async function read<T>(path: string, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path), fallback);
}

async function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), fallback);
}

async function postForm<T>(path: string, body: FormData): Promise<T> {
  return readResponse<T>(await apiFetch(path, {
    method: "POST",
    body
  }), "上传代付往来凭证失败");
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
