import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type {
  SettlementFieldReviewerRoleKey,
  SettlementLineDraftPayload
} from "./settlement-workbench.api";

export interface SettlementFinalConfirmationsPayload {
  finalScopeCompleted?: boolean;
  finalPriorSettlementsIncluded?: boolean;
  finalNoOutstandingSettlements?: boolean;
  finalWithinContractCap?: boolean;
  finalNoFurtherOrdinarySettlements?: boolean;
}

export interface SaveSettlementDraftPayload extends SettlementFinalConfirmationsPayload {
  contractVersionId: string;
  settlementTemplateVersionId: string;
  code: string;
  periodLabel: string;
  isFinal?: boolean;
  finalCumulativeAmountCents?: string;
  fieldReviewerUserId?: string;
  fieldReviewerRoleKey?: SettlementFieldReviewerRoleKey;
  settlementLines: SettlementLineDraftPayload[];
  expectedRevision?: number;
}

export interface SettlementDraftReadModel {
  id: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  settlementTemplateVersionId: string | null;
  code: string;
  periodLabel: string;
  isFinal: boolean;
  finalCumulativeAmountCents: string | null;
  governanceVersion: number | null;
  fieldReviewerUserId: string | null;
  fieldReviewerRoleKey: SettlementFieldReviewerRoleKey | null;
  finalScopeCompleted: boolean | null;
  finalPriorSettlementsIncluded: boolean | null;
  finalNoOutstandingSettlements: boolean | null;
  finalWithinContractCap: boolean | null;
  finalNoFurtherOrdinarySettlements: boolean | null;
  lines: SettlementLineDraftPayload[];
  revision: number;
  status: "draft" | "submitted";
  ownerUserId: string;
  submittedSettlementId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submissionBlockingReason: string | null;
  /** Present on the draft detail endpoint; create/update/list responses remain scalar-only. */
  documents?: SettlementDraftDocumentsReadModel;
}

export interface SubmittedSettlementReadModel {
  id: string;
  code: string;
}

export type SettlementSignedDocumentPurpose =
  | "frozen_counterparty_copy"
  | "counterparty_signed_original"
  | "final_internal_signed_copy";

export type SettlementSignedDocumentStatus =
  | "active"
  | "superseded"
  | "invalidated";

export type SettlementSignedDocumentGenerationStatus =
  | "not_applicable"
  | "pending"
  | "generating"
  | "completed"
  | "failed";

export interface SettlementSignedDocumentRecordReadModel {
  id: string;
  settlementDraftId: string | null;
  settlementId: string | null;
  purpose: SettlementSignedDocumentPurpose;
  fileId: string;
  contentSha256: string;
  pageCount: number;
  sourceRevision: number;
  businessSnapshotToken: string;
  status: SettlementSignedDocumentStatus;
  generationStatus: SettlementSignedDocumentGenerationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementCounterpartySignedDeclaration {
  pageOrderMatchesFrozenDocument: boolean;
  counterpartySignedAndDated: boolean;
  everyPageStamped: boolean;
  crossPageSealCompleted: boolean;
}

export interface SettlementDraftDocumentReadModel {
  id: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  sourceRevision: number;
  status: SettlementSignedDocumentStatus;
  generationStatus: SettlementSignedDocumentGenerationStatus;
  declaration: SettlementCounterpartySignedDeclaration | null;
  createdAt: string;
}

export interface SettlementDraftDocumentsReadModel {
  frozenDocument: SettlementDraftDocumentReadModel | null;
  counterpartySignedOriginal: SettlementDraftDocumentReadModel | null;
}

export interface LinkSettlementCounterpartySignedDocumentPayload {
  expectedRevision: number;
  frozenDocumentId: string;
  uploadedFileId: string;
  declaration: SettlementCounterpartySignedDeclaration;
}

export function createSettlementDraftRecord(
  projectId: string,
  body: SaveSettlementDraftPayload
) {
  return requestDraft<SettlementDraftReadModel>(draftCollectionPath(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, "保存结算草稿失败");
}

export function listSettlementDraftRecords(projectId: string) {
  return requestDraft<SettlementDraftReadModel[]>(
    draftCollectionPath(projectId),
    { method: "GET" },
    "读取结算草稿失败"
  );
}

export function fetchSettlementDraftRecord(projectId: string, draftId: string) {
  return requestDraft<SettlementDraftReadModel>(
    draftItemPath(projectId, draftId),
    { method: "GET" },
    "读取结算草稿失败"
  );
}

export function updateSettlementDraftRecord(
  projectId: string,
  draftId: string,
  body: SaveSettlementDraftPayload & { expectedRevision: number }
) {
  return requestDraft<SettlementDraftReadModel>(draftItemPath(projectId, draftId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, "更新结算草稿失败");
}

export function submitSettlementDraftRecord(
  projectId: string,
  draftId: string,
  expectedRevision: number
) {
  return requestDraft<SubmittedSettlementReadModel>(
    `${draftItemPath(projectId, draftId)}/approval-submission`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision })
    },
    "提交结算审批失败"
  );
}

export function generateSettlementFrozenDocument(
  projectId: string,
  draftId: string,
  expectedRevision: number
) {
  return requestDraft<SettlementSignedDocumentRecordReadModel>(
    `${draftItemPath(projectId, draftId)}/frozen-document`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision })
    },
    "生成冻结结算单失败"
  );
}

export function linkSettlementCounterpartySignedDocument(
  projectId: string,
  draftId: string,
  body: LinkSettlementCounterpartySignedDocumentPayload
) {
  return requestDraft<SettlementSignedDocumentRecordReadModel>(
    `${draftItemPath(projectId, draftId)}/counterparty-signed-documents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    "关联乙方签章扫描件失败"
  );
}

async function requestDraft<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let message = `${fallback}：${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: unknown };
      const detail = Array.isArray(data.message)
        ? data.message.filter((item): item is string => typeof item === "string").join("；")
        : typeof data.message === "string"
          ? data.message
          : "";
      message = formatApiErrorMessage(detail, response.status, fallback);
    } catch {
      // 非 JSON 响应保留中文状态码兜底。
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function draftCollectionPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/settlement-drafts`;
}

function draftItemPath(projectId: string, draftId: string) {
  return `${draftCollectionPath(projectId)}/${encodeURIComponent(draftId)}`;
}
