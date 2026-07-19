import type {
  ContractInvoiceType,
  ContractTaxFactSource,
  ContractTaxFactStatus,
  ContractTaxMode,
  DetailActionReadModel
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ContractTaxFactRevisionKind = "supplement" | "correction";
export type ContractTaxFactRevisionStatus =
  | "draft"
  | "pending_finance_review"
  | "pending_contract_confirmation"
  | "confirmed"
  | "rejected"
  | "abandoned";

export interface ContractTaxFactCurrentReadModel {
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  status: ContractTaxFactStatus;
  source: ContractTaxFactSource | null;
  confirmationExplanation: string | null;
  evidenceFileId: string | null;
  revision: number;
}

export interface ContractTaxFactRowPayload {
  contractBillRowId: string;
  taxInclusiveUnitPrice?: string;
  taxRatePercentOverride?: string;
}

export interface ContractTaxFactCurrentRowReadModel {
  contractBillRowId: string;
  billName: string;
  rowKey: string;
  itemName: string;
  specification: string | null;
  unit: string;
  taxInclusiveUnitPrice: string | null;
  taxRatePercent: string | null;
  taxRateSource: string;
  pricingFactStatus: string;
}

export interface SaveContractTaxFactRevisionPayload {
  kind: ContractTaxFactRevisionKind;
  invoiceType?: ContractInvoiceType;
  taxMode?: ContractTaxMode;
  defaultTaxRatePercent?: string;
  source?: ContractTaxFactSource;
  confirmationExplanation?: string;
  evidenceFileId?: string;
  correctionReason?: string;
  rowFacts?: ContractTaxFactRowPayload[];
}

export interface ReviewContractTaxFactRevisionPayload {
  decision: "approve" | "reject";
  comment?: string;
}

export interface AbandonContractTaxFactRevisionPayload {
  expectedUpdatedAt: string;
  action: "delete_pristine_draft" | "abandon_application";
  reason?: string;
}

export interface ContractTaxFactRevisionReadModel {
  id: string;
  revisionNo: number;
  kind: ContractTaxFactRevisionKind;
  status: ContractTaxFactRevisionStatus;
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode | null;
  defaultTaxRatePercent: string | null;
  source: ContractTaxFactSource | null;
  confirmationExplanation: string | null;
  evidenceFileId: string | null;
  rowFacts: Array<{
    contractBillRowId: string;
    taxInclusiveUnitPrice: string | null;
    taxRatePercentOverride: string | null;
  }>;
  beforeSnapshot: Record<string, unknown>;
  createdByUserId: string;
  submittedByUserId: string | null;
  submittedAt: string | null;
  financeReviewedByUserId: string | null;
  financeReviewedAt: string | null;
  financeReviewComment: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  contractReviewComment: string | null;
  abandonedAt: string | null;
  abandonedByUserId: string | null;
  abandonReason: string | null;
  lifecycleKind?: "pristine_draft" | "approval_draft" | "formal_record";
  lifecycleBlockers?: string[];
  availableActions?: DetailActionReadModel[];
  blockedReasons?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractTaxFactRevisionListReadModel {
  contractId: string;
  current: ContractTaxFactCurrentReadModel;
  rows: ContractTaxFactCurrentRowReadModel[];
  revisions: ContractTaxFactRevisionReadModel[];
}

export function fetchContractTaxFactRevisions(projectId: string, takeoverId: string) {
  return readJson<ContractTaxFactRevisionListReadModel>(revisionBase(projectId, takeoverId));
}

export function createContractTaxFactRevision(
  projectId: string,
  takeoverId: string,
  body: SaveContractTaxFactRevisionPayload
) {
  return postJson<ContractTaxFactRevisionReadModel>(
    revisionBase(projectId, takeoverId),
    body
  );
}

export function updateContractTaxFactRevision(
  projectId: string,
  takeoverId: string,
  revisionId: string,
  body: SaveContractTaxFactRevisionPayload
) {
  return patchJson<ContractTaxFactRevisionReadModel>(
    revisionPath(projectId, takeoverId, revisionId),
    body
  );
}

export function submitContractTaxFactRevisionForFinanceReview(
  projectId: string,
  takeoverId: string,
  revisionId: string
) {
  return postJson<ContractTaxFactRevisionReadModel>(
    `${revisionPath(projectId, takeoverId, revisionId)}/finance-review-submission`
  );
}

export function reviewContractTaxFactRevisionByFinance(
  projectId: string,
  takeoverId: string,
  revisionId: string,
  body: ReviewContractTaxFactRevisionPayload
) {
  return postJson<ContractTaxFactRevisionReadModel>(
    `${revisionPath(projectId, takeoverId, revisionId)}/finance-review`,
    body
  );
}

export function confirmContractTaxFactRevision(
  projectId: string,
  takeoverId: string,
  revisionId: string,
  body: ReviewContractTaxFactRevisionPayload
) {
  return postJson<ContractTaxFactRevisionReadModel>(
    `${revisionPath(projectId, takeoverId, revisionId)}/contract-confirmation`,
    body
  );
}

export function abandonContractTaxFactRevision(
  projectId: string,
  takeoverId: string,
  revisionId: string,
  body: AbandonContractTaxFactRevisionPayload
) {
  return postJson<ContractTaxFactRevisionReadModel>(
    `${revisionPath(projectId, takeoverId, revisionId)}/abandonment`,
    body
  );
}

function revisionBase(projectId: string, takeoverId: string) {
  return `/projects/${encodeURIComponent(projectId)}/contract-takeovers/${encodeURIComponent(
    takeoverId
  )}/tax-fact-revisions`;
}

function revisionPath(projectId: string, takeoverId: string, revisionId: string) {
  return `${revisionBase(projectId, takeoverId)}/${encodeURIComponent(revisionId)}`;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取税务事实修订失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交税务事实修订失败");
  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存税务事实修订失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let message = fallback;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const raw = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof data.message === "string"
        ? data.message
        : "";
    message = formatApiErrorMessage(raw, response.status, fallback);
  } catch {
    message = formatApiErrorMessage("", response.status, fallback);
  }
  throw new Error(message);
}
