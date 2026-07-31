import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import type {
  SettlementFieldReviewerRoleKey,
  SettlementLineDraftPayload
} from "./settlement-workbench.api";

export interface SaveSettlementDraftPayload {
  contractVersionId: string;
  settlementTemplateVersionId: string;
  code: string;
  periodLabel: string;
  isFinal?: boolean;
  finalDeclarationAccepted?: boolean;
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
  finalDeclarationVersion: number | null;
  finalDeclarationSnapshot: { accepted?: boolean; statement?: string } | null;
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
  status: "draft" | "submitted" | "abandoned";
  ownerUserId: string;
  submittedSettlementId: string | null;
  submittedAt: string | null;
  abandonedAt?: string | null;
  abandonedByUserId?: string | null;
  abandonReason?: string | null;
  lifecycleKind?: "pristine_draft" | "approval_draft" | "formal_record";
  lifecycleBlockers?: string[];
  availableActions?: DetailActionReadModel[];
  blockedReasons?: string[];
  createdAt: string;
  updatedAt: string;
  submissionBlockingReason: string | null;
  /** Present on the draft detail endpoint; create/update/list responses remain scalar-only. */
  documents?: SettlementDraftDocumentsReadModel;
}

export interface SettlementFinalPreparationReadModel {
  isFinal: boolean;
  checks: Array<{
    key: string;
    label: string;
    status: "ready" | "action_required" | "blocking";
    message: string;
    amountCents?: string;
  }>;
}

export interface SettlementLineAttachmentReadModel {
  id: string;
  lineKey: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: string;
  status: "active" | "invalidated";
  createdAt: string;
}

export interface SettlementLineAttachmentMutationReadModel {
  revision: number;
  idempotent?: boolean;
}

export interface AbandonSettlementDraftPayload {
  expectedRevision: number;
  action: "delete_pristine_draft" | "abandon_application";
  reason?: string;
}

export interface AbandonSettlementDraftReadModel {
  draftId: string;
  status: "abandoned";
  action: "delete_pristine_draft" | "abandon_application";
  abandonedAt?: string;
  releasedFinalSettlementOccupancy?: boolean;
  idempotent: boolean;
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
  pdfInspection?: {
    version: 1;
    frozenPageCount: number;
    originalPageCount: number;
    hasDifferences: boolean;
    differences: Array<"page_count" | "orientation" | "dimensions" | "rotation">;
  };
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

export function fetchSettlementFinalPreparation(projectId: string, draftId: string) {
  return requestDraft<SettlementFinalPreparationReadModel>(
    `${draftItemPath(projectId, draftId)}/final-preparation`,
    { method: "GET" },
    "读取最终结算准备情况失败"
  );
}

export function listSettlementDraftLineAttachments(projectId: string, draftId: string) {
  return requestDraft<SettlementLineAttachmentReadModel[]>(
    `${draftItemPath(projectId, draftId)}/line-attachments`,
    { method: "GET" },
    "读取结算明细附件失败"
  );
}

export function attachSettlementDraftLineFile(
  projectId: string,
  draftId: string,
  lineKey: string,
  body: { fileId: string; purpose: string; expectedRevision: number }
) {
  return requestDraft<SettlementLineAttachmentMutationReadModel>(
    `${draftItemPath(projectId, draftId)}/lines/${encodeURIComponent(lineKey)}/attachments`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    "关联结算明细附件失败"
  );
}

export function invalidateSettlementDraftLineAttachment(
  projectId: string,
  draftId: string,
  attachmentId: string,
  expectedRevision: number
) {
  return requestDraft<SettlementLineAttachmentMutationReadModel>(
    `${draftItemPath(projectId, draftId)}/line-attachments/${encodeURIComponent(attachmentId)}/invalidation`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }) },
    "作废结算明细附件失败"
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

export function abandonSettlementDraftRecord(
  projectId: string,
  draftId: string,
  body: AbandonSettlementDraftPayload
) {
  return requestDraft<AbandonSettlementDraftReadModel>(
    `${draftItemPath(projectId, draftId)}/abandonment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    "结束结算草稿失败"
  );
}

export type SettlementDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

export interface SettlementDraftLifecycleOperationContext {
  ownerScope: string;
  generation: number;
  projectId: string;
  draftId: string;
  expectedRevision: number;
  action: SettlementDraftLifecycleAction;
  reason: string;
  expectedRequiresComment: boolean;
}

export type ExecuteSettlementDraftLifecycleActionResult =
  | {
      status: "completed";
      context: SettlementDraftLifecycleOperationContext;
      preflight: SettlementDraftReadModel;
      response: AbandonSettlementDraftReadModel;
    }
  | {
      status: "stale";
      context: SettlementDraftLifecycleOperationContext;
    };

export interface ExecuteSettlementDraftLifecycleActionInput {
  ownerScope: string;
  generation: number;
  projectId: string;
  draftId: string;
  expectedRevision: number;
  action: string;
  reason: string;
  expectedRequiresComment: boolean;
  isCurrent: (context: SettlementDraftLifecycleOperationContext) => boolean;
  beforeWrite: () => boolean;
  onResult: (
    result: ExecuteSettlementDraftLifecycleActionResult
  ) => void | Promise<void>;
  onCapabilityFailure: (error: unknown) => void;
  onOperationFailure?: (error: unknown) => void;
  onOperationSettled?: () => void;
  swallowOperationFailure?: boolean;
}

type SettlementDraftLifecycleOperationErrorCode =
  | "SETTLEMENT_DRAFT_LIFECYCLE_BUSY"
  | "SETTLEMENT_DRAFT_LIFECYCLE_INVALID_CONTEXT"
  | "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
  | "SETTLEMENT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH";

function settlementDraftLifecycleOperationError(
  code: SettlementDraftLifecycleOperationErrorCode,
  message: string
) {
  return Object.assign(new Error(message), { code });
}

function normalizeSettlementDraftLifecycleOperation(
  input: ExecuteSettlementDraftLifecycleActionInput
): SettlementDraftLifecycleOperationContext {
  const ownerScope = input.ownerScope.trim();
  const projectId = input.projectId.trim();
  const draftId = input.draftId.trim();
  const reason = input.reason.trim();
  if (
    !ownerScope ||
    !Number.isInteger(input.generation) ||
    input.generation < 0 ||
    !projectId ||
    !draftId ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    (
      input.action !== "delete_pristine_draft" &&
      input.action !== "abandon_application"
    )
  ) {
    throw settlementDraftLifecycleOperationError(
      "SETTLEMENT_DRAFT_LIFECYCLE_INVALID_CONTEXT",
      "结算草稿结束操作上下文已失效，请重新读取当前草稿"
    );
  }
  return {
    ownerScope,
    generation: input.generation,
    projectId,
    draftId,
    expectedRevision: input.expectedRevision,
    action: input.action,
    reason,
    expectedRequiresComment: input.expectedRequiresComment
  };
}

function assertSettlementDraftLifecyclePreflight(
  context: SettlementDraftLifecycleOperationContext,
  preflight: SettlementDraftReadModel
) {
  const enabledLifecycleActions = (preflight.availableActions ?? []).filter(
    (
      action
    ): action is DetailActionReadModel & { key: SettlementDraftLifecycleAction } =>
      action.enabled &&
      (
        action.key === "delete_pristine_draft" ||
        action.key === "abandon_application"
      )
  );
  if (
    preflight.projectId !== context.projectId ||
    preflight.id !== context.draftId ||
    preflight.revision !== context.expectedRevision ||
    preflight.status !== "draft"
  ) {
    throw settlementDraftLifecycleOperationError(
      "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH",
      "结算草稿结束操作的读取坐标已变化，请刷新后重试"
    );
  }
  if (
    enabledLifecycleActions.length !== 1 ||
    enabledLifecycleActions[0]?.key !== context.action ||
    Boolean(enabledLifecycleActions[0]?.requiresComment) !==
      context.expectedRequiresComment
  ) {
    throw settlementDraftLifecycleOperationError(
      "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH",
      "当前结算草稿结束操作已变化，请按最新动作重新确认"
    );
  }
}

function assertSettlementDraftLifecycleResponse(
  context: SettlementDraftLifecycleOperationContext,
  response: AbandonSettlementDraftReadModel
) {
  if (
    response.draftId !== context.draftId ||
    response.status !== "abandoned" ||
    response.action !== context.action
  ) {
    throw settlementDraftLifecycleOperationError(
      "SETTLEMENT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH",
      "结算草稿结束操作响应与请求坐标不一致，请刷新结算台账核对"
    );
  }
}

let activeSettlementDraftLifecycleOperation: {
  fingerprint: string;
  promise: Promise<void>;
} | null = null;

async function runSettlementDraftLifecycleOperation(
  context: SettlementDraftLifecycleOperationContext,
  input: ExecuteSettlementDraftLifecycleActionInput
): Promise<ExecuteSettlementDraftLifecycleActionResult> {
  let preflight: SettlementDraftReadModel;
  try {
    preflight = await fetchSettlementDraftRecord(
      context.projectId,
      context.draftId
    );
  } catch (error) {
    if (!input.isCurrent(context)) return { status: "stale", context };
    throw error;
  }
  if (!input.isCurrent(context)) return { status: "stale", context };
  assertSettlementDraftLifecyclePreflight(context, preflight);
  if (!input.beforeWrite()) {
    throw new Error("结算草稿正在执行其他写入，请等待完成后再结束草稿");
  }

  let response: AbandonSettlementDraftReadModel;
  try {
    response = await abandonSettlementDraftRecord(
      context.projectId,
      context.draftId,
      {
        expectedRevision: context.expectedRevision,
        action: context.action,
        ...(context.reason ? { reason: context.reason } : {})
      }
    );
  } catch (error) {
    if (!input.isCurrent(context)) return { status: "stale", context };
    throw error;
  }
  if (!input.isCurrent(context)) return { status: "stale", context };
  assertSettlementDraftLifecycleResponse(context, response);
  return { status: "completed", context, preflight, response };
}

export function executeSettlementDraftLifecycleAction(
  input: ExecuteSettlementDraftLifecycleActionInput
) {
  let context: SettlementDraftLifecycleOperationContext;
  try {
    context = normalizeSettlementDraftLifecycleOperation(input);
  } catch (error) {
    input.onCapabilityFailure(error);
    input.onOperationFailure?.(error);
    input.onOperationSettled?.();
    return input.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }
  const fingerprint = [
    context.ownerScope,
    context.generation,
    context.projectId,
    context.draftId,
    context.expectedRevision,
    context.action,
    context.reason,
    Number(context.expectedRequiresComment)
  ].join("\u0000");
  if (activeSettlementDraftLifecycleOperation) {
    if (activeSettlementDraftLifecycleOperation.fingerprint === fingerprint) {
      return activeSettlementDraftLifecycleOperation.promise.then(
        (result) => {
          input.onOperationSettled?.();
          return result;
        },
        (error: unknown) => {
          input.onOperationSettled?.();
          throw error;
        }
      );
    }
    const error = settlementDraftLifecycleOperationError(
      "SETTLEMENT_DRAFT_LIFECYCLE_BUSY",
      "另一项结算草稿结束操作正在确认，请等待完成后重试"
    );
    try {
      input.onOperationFailure?.(error);
    } finally {
      input.onOperationSettled?.();
    }
    return input.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }

  const operation = runSettlementDraftLifecycleOperation(context, input)
    .then(input.onResult)
    .catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (
        code === "SETTLEMENT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH" ||
        code === "SETTLEMENT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH"
      ) {
        input.onCapabilityFailure(error);
      }
      input.onOperationFailure?.(error);
      if (!input.swallowOperationFailure) throw error;
    })
    .finally(() => {
      input.onOperationSettled?.();
    });
  const ownedPromise = operation.finally(() => {
    if (activeSettlementDraftLifecycleOperation?.promise === ownedPromise) {
      activeSettlementDraftLifecycleOperation = null;
    }
  });
  activeSettlementDraftLifecycleOperation = {
    fingerprint,
    promise: ownedPromise
  };
  return ownedPromise;
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
