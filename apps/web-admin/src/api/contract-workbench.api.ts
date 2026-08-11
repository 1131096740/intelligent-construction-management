import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type {
  ContractClauseDefinition,
  ContractInvoiceType,
  ContractSettlementMode,
  ContractTaxMode,
  ContractWorkbenchReadModel as SharedContractWorkbenchReadModel,
  DetailActionReadModel
} from "@jiangkong/shared-domain";
import type { PrivateFileReadModel } from "./core-flow-read.api";

// ---------------------------------------------------------------------------
// Local HTTP helpers (built on apiFetch; keep isolated from core-flow client)
// ---------------------------------------------------------------------------

async function ensureOk(
  response: Response,
  fallback: string,
  preserveConflictDetails = false
): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  let code: string | undefined;
  let conflictReason: string | undefined;
  let projectId: string | undefined;
  let takeoverId: string | undefined;
  let serverRevision: number | undefined;
  let capability: {
    refreshRequired: boolean;
    draftOperationAvailableActions: string[];
  } | undefined;
  let invalidation: {
    status: "document_invalidated" | "unchanged" | "refresh_required";
  } | undefined;
  try {
    const data = (await response.clone().json()) as {
      message?: unknown;
      code?: unknown;
      conflictReason?: unknown;
      projectId?: unknown;
      takeoverId?: unknown;
      serverRevision?: unknown;
      capability?: unknown;
      invalidation?: unknown;
    };
    if (preserveConflictDetails && typeof data.code === "string") code = data.code;
    if (preserveConflictDetails && typeof data.conflictReason === "string") {
      conflictReason = data.conflictReason;
    }
    if (preserveConflictDetails && typeof data.projectId === "string") {
      projectId = data.projectId;
    }
    if (preserveConflictDetails && typeof data.takeoverId === "string") {
      takeoverId = data.takeoverId;
    }
    const conflictCapability = data.capability;
    const conflictInvalidation = data.invalidation;
    if (
      preserveConflictDetails &&
      typeof data.serverRevision === "number" &&
      Number.isInteger(data.serverRevision) &&
      typeof conflictCapability === "object" &&
      conflictCapability !== null &&
      "refreshRequired" in conflictCapability &&
      typeof conflictCapability.refreshRequired === "boolean" &&
      "draftOperationAvailableActions" in conflictCapability &&
      Array.isArray(conflictCapability.draftOperationAvailableActions) &&
      conflictCapability.draftOperationAvailableActions.every(
        (action) => typeof action === "string"
      ) &&
      typeof conflictInvalidation === "object" &&
      conflictInvalidation !== null &&
      "status" in conflictInvalidation &&
      (conflictInvalidation.status === "document_invalidated" ||
        conflictInvalidation.status === "unchanged" ||
        conflictInvalidation.status === "refresh_required")
    ) {
      serverRevision = data.serverRevision;
      capability = {
        refreshRequired: conflictCapability.refreshRequired,
        draftOperationAvailableActions: [
          ...conflictCapability.draftOperationAvailableActions
        ]
      };
      invalidation = { status: conflictInvalidation.status };
    }
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
    message = formatApiErrorMessage(message, response.status, fallback);
  }

  const error = new Error(message) as Error & {
    code?: string;
    conflictReason?: string;
    projectId?: string;
    takeoverId?: string;
    serverRevision?: number;
    capability?: {
      refreshRequired: boolean;
      draftOperationAvailableActions: string[];
    };
    invalidation?: {
      status: "document_invalidated" | "unchanged" | "refresh_required";
    };
  };
  if (code) error.code = code;
  if (conflictReason) error.conflictReason = conflictReason;
  if (projectId) error.projectId = projectId;
  if (takeoverId) error.takeoverId = takeoverId;
  if (serverRevision !== undefined) error.serverRevision = serverRevision;
  if (capability) error.capability = capability;
  if (invalidation) error.invalidation = invalidation;
  throw error;
}

async function readJson<T>(path: string, preserveErrorCode = false): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取失败", preserveErrorCode);
  return response.json() as Promise<T>;
}

async function postJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交失败");
  return response.json() as Promise<TResponse>;
}

async function postForm<TResponse>(path: string, body: FormData): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    body
  });
  await ensureOk(response, "上传失败");
  return response.json() as Promise<TResponse>;
}

async function postJsonWithHeaders<TResponse>(
  path: string,
  body: unknown,
  headers: Record<string, string>
): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "提交失败", true);
  return response.json() as Promise<TResponse>;
}

async function patchJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "保存失败");
  return response.json() as Promise<TResponse>;
}

async function putJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "保存失败");
  return response.json() as Promise<TResponse>;
}

async function putJsonWithHeaders<TResponse>(
  path: string,
  body: unknown,
  headers: Record<string, string>
): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存失败", true);
  return response.json() as Promise<TResponse>;
}

async function deleteJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "删除失败");
  return response.json() as Promise<TResponse>;
}

async function deleteJsonWithHeaders<TResponse>(
  path: string,
  body: unknown,
  headers: Record<string, string>
): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "删除失败", true);
  return response.json() as Promise<TResponse>;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Contract workbench (POST /contracts, GET/PATCH/POST /contract-workbench/…)
// ---------------------------------------------------------------------------

type CreateWorkbenchDraftBasePayload = {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
  amountLimitType: "capped" | "unlimited";
  signingSubjectType?: "affiliate" | "our_company";
};

export type CreateWorkbenchDraftPayload = CreateWorkbenchDraftBasePayload & (
  | { businessScenarioId: string; scenarioTemplateMappingId: string }
  | { businessScenarioId?: never; scenarioTemplateMappingId?: never }
);

export interface CreateWorkbenchDraftReadModel {
  contract: { id: string };
  version: { id: string };
  [key: string]: unknown;
}

export interface ContractCreateCapabilityReadModel {
  projectId: string;
  availableActions: string[];
}

export function fetchContractCreateCapabilities(projectId: string) {
  return readJson<ContractCreateCapabilityReadModel>(
    `/contracts/create-capability?projectId=${encodeURIComponent(projectId)}`
  );
}

export function createWorkbenchDraft(body: CreateWorkbenchDraftPayload) {
  return postJson<CreateWorkbenchDraftReadModel>("/contracts", body);
}

export interface ContractWorkbenchReadModel extends SharedContractWorkbenchReadModel {
  availableActions?: DetailActionReadModel[];
}

export type ContractDraftWorkbenchReadModel =
  Omit<ContractWorkbenchReadModel, "checkpoints"> & {
    draft: Record<string, unknown>;
    attachments: ContractDraftAttachmentModel[];
    draftOperationAvailableActions: string[];
    lease: ContractDraftLeaseState;
    version: ContractWorkbenchReadModel["version"] & {
      draftLifecycleKind?: "pristine_draft" | "approval_draft";
    };
  };

export interface ContractDraftAttachmentModel {
  id?: string;
  slotKey: string;
  fileId: string;
  displayOrder: number;
  [key: string]: unknown;
}

export interface ContractDraftLeaseState {
  state: "available" | "held_by_me" | "held_by_other" | "expired";
  holderDisplayName: string | null;
  expiresAt: string | null;
  canTakeOver: boolean;
}

export interface ContractDraftLeaseGrant {
  token: string;
  leaseRevision: number;
  expiresAt: string;
  heartbeatIntervalMs: number;
}

export interface ContractDraftLeaseHeartbeat {
  leaseRevision: number | null;
  expiresAt: string;
}

export interface ContractDraftFieldsPayload {
  companyEntityId?: string;
  draftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
  pricingNature: "fixed_total" | "provisional_total" | "unit_price" | "framework";
  amountSource: "bill_sum" | "manual";
  manualAmountCents?: string;
  estimatedAmountCents?: string;
  amountAdjustmentReason?: string;
  layoutTemplateVersionId?: string;
  taxFacts: {
    invoiceType: ContractInvoiceType | null;
    taxMode: ContractTaxMode;
    defaultTaxRatePercent: string | null;
    source: "contract_document";
  };
}

export interface ContractDraftPartyModel {
  roleKey: string;
  businessPartyVersionId?: string;
  displayOrder: number;
  snapshot: Record<string, unknown>;
}

export interface ContractDraftBillModel {
  billKey: string;
  expectedRevision: number;
  rows: Array<Record<string, unknown>>;
}

export interface ContractDraftPaymentTermsModel {
  originalText: string;
  stages: Array<{
    name: string;
    basis: "current_settlement" | "contract_amount";
    ratioBps: number;
    triggerEvent: string;
    dueDays: number;
    requiresInvoice: boolean;
    allowsEarlyPayment: boolean;
    allowsInstallments: boolean;
    originalText: string;
  }>;
}

export interface ContractDraftNegotiationDocumentsModel {
  selectedNegotiationRoundId?: string;
  selectedOfflineRevisionId?: string;
  referencedGeneratedDocumentIds: string[];
}

export type ContractDraftChangedSection =
  | "draft"
  | "parties"
  | "bills"
  | "payment_terms"
  | "attachments"
  | "negotiation_documents";

export interface SaveContractDraftAggregatePayload {
  idempotencyKey: string;
  saveKind: "auto" | "manual";
  expectedRevision: number;
  changedSections: ContractDraftChangedSection[];
  draft: ContractDraftFieldsPayload;
  parties: ContractDraftPartyModel[];
  bills: ContractDraftBillModel[];
  paymentTerms: ContractDraftPaymentTermsModel | null;
  attachments: ContractDraftAttachmentModel[];
  negotiationDocuments: ContractDraftNegotiationDocumentsModel;
}

export interface SaveContractDraftAggregateResult {
  contractVersionId: string;
  draftRevision: number;
  serverRevision: number;
  savedAt: string;
  effectiveChangedSections: ContractDraftChangedSection[];
  amounts: {
    taxInclusiveAmountCents: string;
    taxExclusiveAmountCents: string;
    taxAmountCents: string;
  };
  billRevisions: Record<string, number>;
  issueCounts: Record<string, number>;
  readiness: unknown;
  documentsOutdated: boolean;
  availableActions: DetailActionReadModel[];
  capability: {
    refreshRequired: boolean;
    draftOperationAvailableActions: string[];
  };
  invalidation: {
    status: "document_invalidated" | "unchanged" | "refresh_required";
  };
}

export function fetchContractWorkbench(contractId: string) {
  return readJson<ContractWorkbenchReadModel>(
    `/contract-workbench/${encodeURIComponent(contractId)}`
  );
}

export function fetchContractDraftWorkbench(contractVersionId: string) {
  return readJson<ContractDraftWorkbenchReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/workbench`,
    true
  );
}

export function fetchContractDraftOperationCapabilities(
  contractVersionId: string
) {
  return readJson<ContractDraftWorkbenchReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/workbench`,
    true
  );
}

export function acquireContractDraftEditLease(contractVersionId: string) {
  return postJson<ContractDraftLeaseGrant>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/edit-lease`
  );
}

export function heartbeatContractDraftEditLease(
  contractVersionId: string,
  leaseToken: string
) {
  return postJsonWithHeaders<ContractDraftLeaseHeartbeat>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/edit-lease/heartbeat`,
    {},
    { "X-Contract-Draft-Lease": leaseToken }
  );
}

export function releaseContractDraftEditLease(
  contractVersionId: string,
  leaseToken: string
) {
  return deleteJsonWithHeaders<{ released: boolean }>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/edit-lease`,
    {},
    { "X-Contract-Draft-Lease": leaseToken }
  );
}

export function takeOverContractDraftEditLease(
  contractVersionId: string,
  confirmation: { currentPassword: string }
) {
  return postJson<ContractDraftLeaseGrant>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/edit-lease/takeover`,
    confirmation
  );
}

export function saveContractDraftAggregate(
  contractVersionId: string,
  leaseToken: string,
  payload: SaveContractDraftAggregatePayload
) {
  return putJsonWithHeaders<SaveContractDraftAggregateResult>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}`,
    payload,
    { "X-Contract-Draft-Lease": leaseToken }
  );
}

export function queueContractDraftPreview(
  contractVersionId: string,
  sourceRevision: number
) {
  return postJson<unknown>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/preview-generation`,
    { sourceRevision }
  );
}

export interface ContractDraftSubmissionResult {
  contractVersionId: string;
  approvalInstanceId: string;
  status: "in_approval";
  formalCode: string;
  draftRevision: number;
  firstSubmittedAt: string;
}

export function submitContractDraft(
  contractVersionId: string,
  leaseToken: string,
  payload: { expectedRevision: number; idempotencyKey: string }
) {
  return postJsonWithHeaders<ContractDraftSubmissionResult>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/submission`,
    payload,
    { "X-Contract-Draft-Lease": leaseToken }
  );
}

export function deletePristineContractDraft(
  contractVersionId: string,
  expectedRevision: number,
  confirmation: { reason?: string; currentPassword?: string } = {}
) {
  return deleteJson<DeletePristineContractDraftReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}`,
    { expectedRevision, ...confirmation }
  );
}

export interface AbandonContractDraftPayload {
  expectedRevision: number;
  action: "abandon_application";
  reason?: string;
  currentPassword?: string;
}

export interface AbandonContractDraftReadModel {
  contractVersionId: string;
  status: "abandoned";
  lifecycleKind: "approval_draft";
  action: "abandon_application";
  abandonedAt: string | null;
  abandonedByUserId: string | null;
  reason: string | null;
  idempotent: boolean;
}

export interface DeletePristineContractDraftReadModel {
  contractVersionId: string;
  status: "deleting" | "deleted";
  lifecycleKind: "pristine_draft";
  retryable?: boolean;
  idempotent?: boolean;
}

type ContractDraftLifecycleResponse =
  | AbandonContractDraftReadModel
  | DeletePristineContractDraftReadModel;

export function abandonContractDraft(
  contractVersionId: string,
  body: AbandonContractDraftPayload
) {
  return postJson<AbandonContractDraftReadModel>(
    `/contracts/${encodeURIComponent(contractVersionId)}/abandonment`,
    body
  );
}

export type ContractDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

export interface ContractDraftLifecycleOperationContext {
  generation: number;
  contractId: string;
  versionId: string;
  expectedRevision: number;
  action: ContractDraftLifecycleAction;
  reason: string;
  expectedRequiresComment: boolean;
  expectedRequiresPassword: boolean;
}

export interface ExecuteContractDraftLifecycleActionInput {
  generation: number;
  contractId: string;
  versionId: string;
  expectedRevision: number;
  action: string;
  reason: string;
  currentPassword: string;
  expectedRequiresComment: boolean;
  expectedRequiresPassword: boolean;
  retryPending?: boolean;
  isCurrent: (context: ContractDraftLifecycleOperationContext) => boolean;
  beforeWrite: () => boolean;
  onWriteFailure: () => void;
  onResult: (
    result: ExecuteContractDraftLifecycleActionResult
  ) => void | Promise<void>;
  onCapabilityFailure: (error: unknown) => void;
  onOperationFailure?: (error: unknown) => void;
  onOperationSettled?: () => void;
  swallowOperationFailure?: boolean;
}

export type ExecuteSpecificContractDraftLifecycleActionInput = Omit<
  ExecuteContractDraftLifecycleActionInput,
  "action"
>;

export type ExecuteContractDraftLifecycleActionResult =
  | {
      status: "completed";
      context: ContractDraftLifecycleOperationContext;
      preflight: ContractDraftWorkbenchReadModel | null;
      response: ContractDraftLifecycleResponse;
    }
  | {
      status: "retryable";
      context: ContractDraftLifecycleOperationContext;
      preflight: ContractDraftWorkbenchReadModel | null;
      response: DeletePristineContractDraftReadModel;
    }
  | {
      status: "stale";
      context: ContractDraftLifecycleOperationContext;
    };

type ContractDraftLifecycleOperationErrorCode =
  | "CONTRACT_DRAFT_LIFECYCLE_BUSY"
  | "CONTRACT_DRAFT_LIFECYCLE_INVALID_CONTEXT"
  | "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
  | "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH";

function contractDraftLifecycleOperationError(
  code: ContractDraftLifecycleOperationErrorCode,
  message: string
) {
  return Object.assign(new Error(message), { code });
}

function normalizeContractDraftLifecycleOperation(
  input: ExecuteContractDraftLifecycleActionInput
): ContractDraftLifecycleOperationContext {
  const contractId = input.contractId.trim();
  const versionId = input.versionId.trim();
  const reason = input.reason.trim();
  if (
    !Number.isInteger(input.generation) ||
    input.generation < 0 ||
    !contractId ||
    !versionId ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    (
      input.action !== "delete_pristine_draft" &&
      input.action !== "abandon_application"
    )
  ) {
    throw contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_INVALID_CONTEXT",
      "合同草稿结束操作上下文已失效，请重新读取当前工作台"
    );
  }
  return {
    generation: input.generation,
    contractId,
    versionId,
    expectedRevision: input.expectedRevision,
    action: input.action,
    reason,
    expectedRequiresComment: input.expectedRequiresComment,
    expectedRequiresPassword: input.expectedRequiresPassword
  };
}

function assertContractDraftLifecyclePreflight(
  context: ContractDraftLifecycleOperationContext,
  preflight: ContractDraftWorkbenchReadModel
) {
  const enabledLifecycleActions = (preflight.availableActions ?? []).filter(
    (
      action
    ): action is DetailActionReadModel & { key: ContractDraftLifecycleAction } =>
      action.enabled &&
      (
        action.key === "delete_pristine_draft" ||
        action.key === "abandon_application"
      )
  );
  if (
    preflight.contract.id !== context.contractId ||
    preflight.version.id !== context.versionId ||
    preflight.version.draftRevision !== context.expectedRevision
  ) {
    throw contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH",
      "合同草稿结束操作的读取坐标已变化，请刷新后重试"
    );
  }
  if (
    enabledLifecycleActions.length !== 1 ||
    enabledLifecycleActions[0]?.key !== context.action ||
    Boolean(enabledLifecycleActions[0]?.requiresComment) !==
      context.expectedRequiresComment ||
    Boolean(enabledLifecycleActions[0]?.requiresPassword) !==
      context.expectedRequiresPassword
  ) {
    throw contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH",
      "当前结束操作已变化，请按最新合同工作台动作重新确认"
    );
  }
}

function assertContractDraftLifecycleResponse(
  context: ContractDraftLifecycleOperationContext,
  response: ContractDraftLifecycleResponse
) {
  if (context.action === "delete_pristine_draft") {
    const deletion = response as DeletePristineContractDraftReadModel;
    if (
      deletion.contractVersionId !== context.versionId ||
      deletion.lifecycleKind !== "pristine_draft" ||
      !["deleting", "deleted"].includes(deletion.status)
    ) {
      throw contractDraftLifecycleOperationError(
        "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH",
        "合同草稿结束操作响应与请求坐标不一致，已暂停编辑，请刷新页面核对"
      );
    }
    return;
  }
  const abandonment = response as AbandonContractDraftReadModel;
  if (
    abandonment.contractVersionId !== context.versionId ||
    abandonment.status !== "abandoned" ||
    abandonment.action !== "abandon_application" ||
    abandonment.lifecycleKind !== "approval_draft"
  ) {
    throw contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH",
      "合同草稿结束操作响应与请求坐标不一致，已暂停编辑，请刷新页面核对"
    );
  }
}

let activeContractDraftLifecycleOperation: {
  fingerprint: string;
  promise: Promise<void>;
} | null = null;

async function preflightContractDraftLifecycleOperation(
  context: ContractDraftLifecycleOperationContext,
  input: ExecuteContractDraftLifecycleActionInput
): Promise<ContractDraftWorkbenchReadModel | null> {
  let preflight: ContractDraftWorkbenchReadModel;
  try {
    preflight = await fetchContractDraftWorkbench(context.versionId);
  } catch (error) {
    if (!input.isCurrent(context)) return null;
    throw error;
  }
  if (!input.isCurrent(context)) return null;
  assertContractDraftLifecyclePreflight(context, preflight);
  if (!input.beforeWrite()) {
    throw new Error("合同草稿正在保存，请等待保存完成后再结束草稿");
  }
  return preflight;
}

async function runDeletePristineContractDraftLifecycleOperation(
  context: ContractDraftLifecycleOperationContext,
  input: ExecuteContractDraftLifecycleActionInput
): Promise<ExecuteContractDraftLifecycleActionResult> {
  const preflight = input.retryPending
    ? null
    : await preflightContractDraftLifecycleOperation(context, input);
  if (!input.retryPending && !preflight) return { status: "stale", context };
  if (input.retryPending && !input.isCurrent(context)) {
    return { status: "stale", context };
  }
  let response: DeletePristineContractDraftReadModel;
  try {
    response = await deletePristineContractDraft(
      context.versionId,
      context.expectedRevision,
      {
        ...(context.reason ? { reason: context.reason } : {}),
        ...(input.currentPassword ? { currentPassword: input.currentPassword } : {})
      }
    );
  } catch (error) {
    if (!input.isCurrent(context)) return { status: "stale", context };
    input.onWriteFailure();
    throw error;
  }
  if (!input.isCurrent(context)) return { status: "stale", context };
  try {
    assertContractDraftLifecycleResponse(context, response);
  } catch (error) {
    input.onWriteFailure();
    throw error;
  }
  if (response.status === "deleting" && response.retryable) {
    return {
      status: "retryable",
      context,
      preflight,
      response
    };
  }
  return { status: "completed", context, preflight, response };
}

async function runAbandonContractDraftLifecycleOperation(
  context: ContractDraftLifecycleOperationContext,
  input: ExecuteContractDraftLifecycleActionInput
): Promise<ExecuteContractDraftLifecycleActionResult> {
  const preflight = await preflightContractDraftLifecycleOperation(context, input);
  if (!preflight) return { status: "stale", context };
  let response: AbandonContractDraftReadModel;
  try {
    response = await abandonContractDraft(context.versionId, {
      expectedRevision: context.expectedRevision,
      action: "abandon_application",
      ...(context.reason ? { reason: context.reason } : {}),
      ...(input.currentPassword ? { currentPassword: input.currentPassword } : {})
    });
  } catch (error) {
    if (!input.isCurrent(context)) return { status: "stale", context };
    input.onWriteFailure();
    throw error;
  }
  if (!input.isCurrent(context)) return { status: "stale", context };
  assertContractDraftLifecycleResponse(context, response);
  return { status: "completed", context, preflight, response };
}

export function executeAbandonContractDraftAction(
  input: ExecuteSpecificContractDraftLifecycleActionInput
) {
  const lifecycleInput: ExecuteContractDraftLifecycleActionInput = {
    ...input,
    action: "abandon_application"
  };
  let context: ContractDraftLifecycleOperationContext;
  try {
    context = normalizeContractDraftLifecycleOperation(lifecycleInput);
  } catch (error) {
    lifecycleInput.onCapabilityFailure(error);
    lifecycleInput.onOperationFailure?.(error);
    lifecycleInput.onOperationSettled?.();
    return lifecycleInput.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }
  const fingerprint = [
    context.generation,
    context.contractId,
    context.versionId,
    context.expectedRevision,
    context.action,
    context.reason,
    Number(context.expectedRequiresComment),
    Number(context.expectedRequiresPassword)
  ].join("\u0000");
  if (activeContractDraftLifecycleOperation) {
    if (activeContractDraftLifecycleOperation.fingerprint === fingerprint) {
      return activeContractDraftLifecycleOperation.promise;
    }
    const error = contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_BUSY",
      "另一项合同草稿结束操作正在确认，请等待完成后重试"
    );
    lifecycleInput.onOperationFailure?.(error);
    return lifecycleInput.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }
  const resultPromise = runAbandonContractDraftLifecycleOperation(
    context,
    lifecycleInput
  );
  const operation = resultPromise
    .then(lifecycleInput.onResult)
    .catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (
        code === "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH" ||
        code === "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH"
      ) {
        lifecycleInput.onCapabilityFailure(error);
      }
      lifecycleInput.onOperationFailure?.(error);
      if (!lifecycleInput.swallowOperationFailure) throw error;
    })
    .finally(() => {
      lifecycleInput.onOperationSettled?.();
    });
  const ownedPromise = operation.finally(() => {
    if (activeContractDraftLifecycleOperation?.promise === ownedPromise) {
      activeContractDraftLifecycleOperation = null;
    }
  });
  activeContractDraftLifecycleOperation = {
    fingerprint,
    promise: ownedPromise
  };
  return ownedPromise;
}

export function executeDeletePristineContractDraftAction(
  input: ExecuteSpecificContractDraftLifecycleActionInput
) {
  const lifecycleInput: ExecuteContractDraftLifecycleActionInput = {
    ...input,
    action: "delete_pristine_draft"
  };
  let context: ContractDraftLifecycleOperationContext;
  try {
    context = normalizeContractDraftLifecycleOperation(lifecycleInput);
  } catch (error) {
    lifecycleInput.onCapabilityFailure(error);
    lifecycleInput.onOperationFailure?.(error);
    lifecycleInput.onOperationSettled?.();
    return lifecycleInput.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }
  const fingerprint = [
    context.generation,
    context.contractId,
    context.versionId,
    context.expectedRevision,
    context.action,
    context.reason,
    Number(context.expectedRequiresComment),
    Number(context.expectedRequiresPassword)
  ].join("\u0000");
  if (activeContractDraftLifecycleOperation) {
    if (activeContractDraftLifecycleOperation.fingerprint === fingerprint) {
      return activeContractDraftLifecycleOperation.promise;
    }
    const error = contractDraftLifecycleOperationError(
      "CONTRACT_DRAFT_LIFECYCLE_BUSY",
      "另一项合同草稿结束操作正在确认，请等待完成后重试"
    );
    lifecycleInput.onOperationFailure?.(error);
    return lifecycleInput.swallowOperationFailure
      ? Promise.resolve()
      : Promise.reject(error);
  }
  const resultPromise = runDeletePristineContractDraftLifecycleOperation(
    context,
    lifecycleInput
  );
  const operation = resultPromise
    .then(lifecycleInput.onResult)
    .catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (
        code === "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH" ||
        code === "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH"
      ) {
        lifecycleInput.onCapabilityFailure(error);
      }
      lifecycleInput.onOperationFailure?.(error);
      if (!lifecycleInput.swallowOperationFailure) throw error;
    })
    .finally(() => {
      lifecycleInput.onOperationSettled?.();
    });
  const ownedPromise = operation.finally(() => {
    if (activeContractDraftLifecycleOperation?.promise === ownedPromise) {
      activeContractDraftLifecycleOperation = null;
    }
  });
  activeContractDraftLifecycleOperation = {
    fingerprint,
    promise: ownedPromise
  };
  return ownedPromise;
}

export type ContractAuthorizationSide = "first_party" | "counterparty";

export interface SetContractAuthorizationPayload {
  side: ContractAuthorizationSide;
  expectedRevision: number;
  required: boolean;
  upload?: {
    fileId: string;
    grantorName: string;
    agentName: string;
    scopeSummary: string;
  };
  reuse?: {
    authorizationId: string;
    sourceContractVersionId: string;
    agentName: string;
  };
}

export interface UploadContractFormalApprovalFilePayload {
  fileId: string;
  sourceRevision: number;
  counterpartySigned: boolean;
  counterpartyStamped: boolean;
  crossPageSealCompleted: boolean;
  documentOrderConfirmed: boolean;
  authorizationsBeforeSignaturePageConfirmed: boolean;
}

export function setContractAuthorization(
  contractVersionId: string,
  body: SetContractAuthorizationPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/authorizations`, body);
}

export function uploadContractFormalApprovalFile(
  contractVersionId: string,
  body: UploadContractFormalApprovalFilePayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/formal-files/approval`, body);
}

export interface UploadCounterpartySignedFilesPayload {
  fileIds: string[];
  sourceRevision: number;
}

export interface ConfirmCounterpartySignedFilePayload {
  formalFileId: string;
  expectedDraftRevision: number;
}

export interface CounterpartySignedOriginalFile {
  formalFileId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sourceRevision: number;
  status: string;
  uploadedAt: string;
  displayOrder: number | null;
}

export interface CounterpartySignedPreviewFile {
  formalFileId: string;
  fileId: string;
  fileName: string;
  pageCount: number;
  sourceRevision: number;
  status: string;
  mode: "inline_pdf" | "converted_pdf" | "merged_images_pdf" | string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  confirmedAtRevision: number | null;
  confirmedDocumentContentRevision: number | null;
  confirmedDocumentContentFingerprint: string | null;
  confirmationValid: boolean;
}

export interface CounterpartySignedReadModel {
  documentContentRevision: number;
  documentContentFingerprint: string | null;
  status: string;
  confirmationValid: boolean;
  originalFiles: CounterpartySignedOriginalFile[];
  preview: CounterpartySignedPreviewFile | null;
}

export interface CounterpartySignedConfirmationReceipt {
  formalFileId: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  confirmedAtRevision: number;
  confirmedDocumentContentRevision: number;
  confirmedDocumentContentFingerprint: string;
  confirmationValid: true;
}

export function uploadCounterpartySignedFiles(
  contractVersionId: string,
  body: UploadCounterpartySignedFilesPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/formal-files/counterparty`, body);
}

export function confirmCounterpartySignedFile(
  contractVersionId: string,
  body: ConfirmCounterpartySignedFilePayload
) {
  return postJson<CounterpartySignedConfirmationReceipt>(
    `/contracts/${contractVersionId}/formal-files/counterparty/confirmation`,
    body
  );
}

export function listCounterpartySignedFiles(contractVersionId: string) {
  return readJson<CounterpartySignedReadModel>(
    `/contracts/${contractVersionId}/formal-files/counterparty`
  );
}

export function uploadContractWorkbenchPrivateFile(
  contractVersionId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  return postForm<PrivateFileReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/files`,
    form
  );
}

export function checkContractSubmissionReadiness(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/readiness`);
}

export function listContractDrafts(scope: "my" | "voided") {
  return readJson<unknown[]>(`/contract-workbench?scope=${scope}`);
}

export interface SaveContractDraftPayload {
  expectedRevision: number;
  companyEntityId?: string;
  draftData?: Record<string, unknown>;
  clauses?: unknown[];
  pricingNature?: string;
  amountSource?: string;
  manualAmountCents?: string;
  estimatedAmountCents?: string;
  taxFacts: {
    invoiceType: ContractInvoiceType | null;
    taxMode: ContractTaxMode;
    defaultTaxRatePercent: string | null;
    source: "contract_document";
  };
  paymentTermsOriginalText?: string;
  paymentStages?: Array<{
    name: string;
    basis: "current_settlement" | "contract_amount";
    ratioBps: number;
    triggerEvent: string;
    dueDays: number;
    requiresInvoice: boolean;
    allowsEarlyPayment: boolean;
    allowsInstallments: boolean;
    originalText: string;
  }>;
  [key: string]: unknown;
}

export interface SaveContractDraftResult {
  id: string;
  draftRevision: number;
}

export function saveContractDraft(contractVersionId: string, body: SaveContractDraftPayload) {
  return patchJson<SaveContractDraftResult>(
    `/contract-workbench/${contractVersionId}`,
    body
  );
}

export interface ConfirmContractSettlementModePayload {
  expectedRevision: number;
  settlementMode: ContractSettlementMode;
}

export function confirmContractSettlementMode(
  contractVersionId: string,
  body: ConfirmContractSettlementModePayload
) {
  return postJson<SaveContractDraftResult>(
    `/contract-workbench/${contractVersionId}/settlement-mode/confirm`,
    body
  );
}

export interface ContractBillTransitionMappingPayload {
  sourceContractBillRowId: string;
  targetContractBillRowId: string;
  sourceSettledQuantityAllocated: string;
  targetOpeningQuantity: string;
  settledAmountAllocatedCents: string;
  quantityConversionBasis?: string;
}

export interface ContractBillTransitionOptions {
  fromContractVersionId: string | null;
  canConfirm: boolean;
  sources: Array<{ id: string; itemName: string; specification: string | null; unit: string; historicalQuantity: string | null; historicalAmountCents: string }>;
  targets: Array<{ id: string; itemName: string; specification: string | null; unit: string }>;
}

export function fetchContractBillTransitionOptions(contractVersionId: string) {
  return readJson<ContractBillTransitionOptions>(`/contract-versions/${encodeURIComponent(contractVersionId)}/bill-transitions/options`);
}

export function fetchContractBillTransitions(contractVersionId: string) {
  return readJson<Array<Record<string, unknown>>>(`/contract-versions/${encodeURIComponent(contractVersionId)}/bill-transitions`);
}

export function saveContractBillTransitions(contractVersionId: string, body: { fromContractVersionId: string; expectedTargetVersionRevision: number; mappings: ContractBillTransitionMappingPayload[] }) {
  return putJson<Array<Record<string, unknown>>>(`/contract-versions/${encodeURIComponent(contractVersionId)}/bill-transitions`, body);
}

export function discardContractBillTransitions(contractVersionId: string, body: { fromContractVersionId: string; expectedTargetVersionRevision: number }) {
  return deleteJson<Array<Record<string, unknown>>>(`/contract-versions/${encodeURIComponent(contractVersionId)}/bill-transitions`, body);
}

export function confirmContractBillTransitions(contractVersionId: string, body: { expectedTargetVersionRevision: number }) {
  return postJson<Array<Record<string, unknown>>>(`/contract-versions/${encodeURIComponent(contractVersionId)}/bill-transitions/confirm`, body);
}

export interface CreateDraftCheckpointPayload {
  name: string;
}

export function createDraftCheckpoint(
  contractVersionId: string,
  body: CreateDraftCheckpointPayload
) {
  return postJson<unknown>(`/contract-workbench/${contractVersionId}/checkpoints`, body);
}

export function restoreDraftCheckpoint(contractVersionId: string, checkpointId: string) {
  return postJson<unknown>(
    `/contract-workbench/${contractVersionId}/checkpoints/${checkpointId}/restore`
  );
}

export interface PreviewContractTypeChangePayload {
  targetBusinessTemplateVersionId: string;
  expectedRevision: number;
}

export function previewContractTypeChange(
  contractVersionId: string,
  body: PreviewContractTypeChangePayload
) {
  return postJson<unknown>(`/contract-workbench/${contractVersionId}/type-change-preview`, body);
}

export interface ApplyContractTypeChangePayload {
  targetBusinessTemplateVersionId: string;
  expectedRevision: number;
}

export function applyContractTypeChange(
  contractVersionId: string,
  body: ApplyContractTypeChangePayload
) {
  // Backend requires explicit `confirmed: true` (ApplyContractTypeChangeDto) so the
  // migration only runs after the user accepts the preview.
  return postJson<unknown>(`/contract-workbench/${contractVersionId}/type-change`, {
    ...body,
    confirmed: true
  });
}

export interface TransferContractDraftPayload {
  toUserId: string;
  expectedContractVersionId?: string;
}

export interface ContractDraftTransferCapabilityReadModel {
  contractId: string;
  contractVersionId: string | null;
  availableActions: string[];
}

export function fetchContractDraftTransferCapabilities(contractId: string) {
  return readJson<ContractDraftTransferCapabilityReadModel>(
    `/contract-workbench/${encodeURIComponent(contractId)}/transfer-capability`
  );
}

export function transferContractDraft(contractId: string, body: TransferContractDraftPayload) {
  return postJson<unknown>(`/contract-workbench/${contractId}/transfer`, body);
}

export interface VoidContractDraftPayload {
  reason: string;
}

export function voidContractDraft(contractId: string, body: VoidContractDraftPayload) {
  return postJson<unknown>(`/contract-workbench/${contractId}/void`, body);
}

export function restoreContractDraft(contractId: string) {
  return postJson<unknown>(`/contract-workbench/${contractId}/restore`);
}

// ---------------------------------------------------------------------------
// Business parties (GET/POST /business-parties)
// ---------------------------------------------------------------------------

export function listBusinessParties(query?: string) {
  const qs = query ? `?query=${encodeURIComponent(query)}` : "";
  return readJson<unknown[]>(`/business-parties${qs}`);
}

export interface CreateBusinessPartyPayload {
  name: string;
  unifiedSocialCreditCode?: string;
  attachments?: unknown[];
  [key: string]: unknown;
}

export function createBusinessParty(body: CreateBusinessPartyPayload) {
  return postJson<unknown>("/business-parties", body);
}

export function getBusinessParty(partyId: string) {
  return readJson<unknown>(`/business-parties/${partyId}`);
}

export function createBusinessPartyVersion(partyId: string, body: CreateBusinessPartyPayload) {
  return postJson<unknown>(`/business-parties/${partyId}/versions`, body);
}

// ---------------------------------------------------------------------------
// Contract number rules (GET/POST /contract-number-rules)
// ---------------------------------------------------------------------------

export function listContractNumberRules() {
  return readJson<unknown[]>("/contract-number-rules");
}

export interface CreateContractNumberRulePayload {
  name: string;
  pattern: string;
  contractTypeKey?: string;
  sequenceWidth?: number;
  [key: string]: unknown;
}

export function createContractNumberRule(body: CreateContractNumberRulePayload) {
  return postJson<unknown>("/contract-number-rules", body);
}

export function updateContractNumberRule(ruleId: string, body: CreateContractNumberRulePayload) {
  return patchJson<unknown>(`/contract-number-rules/${ruleId}`, body);
}

export function stopContractNumberRule(ruleId: string) {
  return postJson<unknown>(`/contract-number-rules/${ruleId}/stop`);
}

// ---------------------------------------------------------------------------
// Templates and template versions
// ---------------------------------------------------------------------------

export interface ContractTemplateUsagePreview {
  fields: Array<{
    label: string;
    type: "text" | "long_text" | "number" | "money" | "date" | "single_select" | "multi_select" | "boolean";
    required: boolean;
    group?: string;
    conditional: boolean;
  }>;
  bills: Array<{
    name: string;
    amountRole: "included" | "reference" | "non_priced" | "provisional";
    pricingMode: "tax_inclusive" | "tax_exclusive";
    columns: Array<{
      label: string;
      type: "text" | "number" | "boolean";
      required: boolean;
    }>;
  }>;
  clauses: Array<{ title: string; required: boolean }>;
  attachments: Array<{ name: string; required: boolean; mustBeValid: boolean }>;
  validations: Array<{ level: "block" | "warning"; message: string }>;
}

export interface PublishedContractTemplateReadModel {
  id: string;
  code?: string;
  businessCode?: string | null;
  name: string;
  status: "published";
  contractTypeKey: string;
  versionId: string;
  versionNo: number;
  usagePreview: ContractTemplateUsagePreview;
}

export function listPublishedContractTemplates(contractTypeKey?: string) {
  const qs = contractTypeKey ? `?contractTypeKey=${encodeURIComponent(contractTypeKey)}` : "";
  return readJson<PublishedContractTemplateReadModel[]>(`/contract-templates${qs}`);
}

export interface ContractTemplateSchemaPayload {
  fields: unknown[];
  bills: unknown[];
  clauses: unknown[];
  attachments: unknown[];
  validations: unknown[];
}

export type ContractTemplateVersionStatus =
  | "draft"
  | "submitted"
  | "published"
  | "stopped"
  | "revoked"
  | "discarded";

export interface ContractTemplateVersionReadModel {
  id: string;
  templateId: string;
  versionNo: number;
  status: ContractTemplateVersionStatus;
  schema: ContractTemplateSchemaPayload;
  submittedByUserId?: string | null;
  publishedByUserId?: string | null;
  publishedAt?: string | null;
  stoppedAt?: string | null;
  revokedAt?: string | null;
  changeSummary?: string | null;
  createdAt?: string;
  updatedAt?: string;
  discardedAt?: string | null;
  discardedByUserId?: string | null;
  discardReason?: string | null;
  availableActions?: DetailActionReadModel[];
  blockedReasons?: string[];
}

export interface ContractTemplateDetailReadModel {
  template: {
    id: string;
    code: string;
    businessCode?: string | null;
    name: string;
    contractTypeKey: string;
    status: string;
    createdByUserId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  versions: ContractTemplateVersionReadModel[];
}

export function getContractTemplate(templateId: string, includeHistory = false) {
  const query = includeHistory ? "?includeHistory=true" : "";
  return readJson<ContractTemplateDetailReadModel>(`/contract-templates/${templateId}${query}`);
}

export interface CreateContractTemplatePayload {
  code: string;
  businessCode: string;
  name: string;
  contractTypeKey: string;
  schema: ContractTemplateSchemaPayload;
}

export function createContractTemplate(body: CreateContractTemplatePayload) {
  return postJson<unknown>("/contract-templates", body);
}

export interface UpdateContractTemplateVersionPayload {
  schema: ContractTemplateSchemaPayload;
  changeSummary?: string;
}

export function updateContractTemplateVersion(
  versionId: string,
  body: UpdateContractTemplateVersionPayload
) {
  return patchJson<unknown>(`/contract-template-versions/${versionId}`, body);
}

export function cloneContractTemplateVersion(versionId: string) {
  return postJson<ContractTemplateVersionReadModel>(
    `/contract-template-versions/${versionId}/clone`
  );
}

export function submitContractTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-template-versions/${versionId}/submission`);
}

export function publishContractTemplateVersion(
  versionId: string,
  body: { changeSummary: string }
) {
  return postJson<unknown>(`/contract-template-versions/${versionId}/publication`, body);
}

export function stopContractTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-template-versions/${versionId}/stop`);
}

export function revokeContractTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-template-versions/${versionId}/revoke`);
}

export function discardContractTemplateVersion(
  versionId: string,
  body: { reason: string; expectedUpdatedAt: string }
) {
  return postJson<unknown>(`/contract-template-versions/${versionId}/discard`, body);
}

export function listPublishedLayoutTemplates(contractTypeKey?: string) {
  const qs = contractTypeKey ? `?contractTypeKey=${encodeURIComponent(contractTypeKey)}` : "";
  return readJson<unknown[]>(`/contract-layout-templates${qs}`);
}

export interface CreateLayoutTemplatePayload {
  name: string;
  contractTypeKey: string;
  docxFileId: string;
  placeholderSchema: unknown;
}

export interface LayoutTemplatePreviewReadModel {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "stale";
  sourceRevision: number;
  previewPdfFileId?: string | null;
  errorMessage?: string | null;
}

export interface LayoutTemplateVersionReadModel {
  id: string;
  layoutTemplateId: string;
  versionNo: number;
  status: ContractTemplateVersionStatus;
  docxFileId: string;
  placeholderSchema: Record<string, unknown>;
  draftRevision: number;
  inspectionReport?: Record<string, unknown> | null;
  inspectionRevision?: number | null;
  previewPdfFileId?: string | null;
  latestPreview?: LayoutTemplatePreviewReadModel | null;
  createdAt?: string;
  updatedAt?: string;
  discardedAt?: string | null;
  discardedByUserId?: string | null;
  discardReason?: string | null;
  availableActions?: DetailActionReadModel[];
  blockedReasons?: string[];
}

export interface LayoutTemplateDetailReadModel {
  template: {
    id: string;
    name: string;
    contractTypeKey: string;
  };
  versions: LayoutTemplateVersionReadModel[];
}

export interface CreateLayoutTemplateReadModel {
  template: LayoutTemplateDetailReadModel["template"];
  version: LayoutTemplateVersionReadModel;
}

export function createLayoutTemplate(body: CreateLayoutTemplatePayload) {
  return postJson<CreateLayoutTemplateReadModel>("/contract-layout-templates", body);
}

export function getLayoutTemplate(templateId: string, includeHistory = false) {
  const query = includeHistory ? "?includeHistory=true" : "";
  return readJson<LayoutTemplateDetailReadModel>(`/contract-layout-templates/${templateId}${query}`);
}

export function updateLayoutTemplateVersion(
  versionId: string,
  body: {
    expectedRevision: number;
    docxFileId?: string;
    placeholderSchema?: Record<string, unknown>;
  }
) {
  return patchJson<LayoutTemplateVersionReadModel>(
    `/contract-layout-template-versions/${versionId}`,
    body
  );
}

export function inspectLayoutTemplateVersion(versionId: string) {
  return postJson<Record<string, unknown> & { sourceRevision: number }>(
    `/contract-layout-template-versions/${versionId}/inspection`
  );
}

export function queueLayoutTemplatePreview(versionId: string, sampleData: unknown) {
  return postJson<LayoutTemplatePreviewReadModel>(
    `/contract-layout-template-versions/${versionId}/preview-generation`,
    sampleData
  );
}

export function getLatestLayoutTemplatePreview(versionId: string) {
  return readJson<LayoutTemplatePreviewReadModel | null>(
    `/contract-layout-template-versions/${versionId}/preview-generation`
  );
}

export function submitLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/submission`);
}

export function publishLayoutTemplateVersion(
  versionId: string,
  body: { changeSummary: string }
) {
  return postJson<unknown>(
    `/contract-layout-template-versions/${versionId}/publication`,
    body
  );
}

export function cloneLayoutTemplateVersion(versionId: string) {
  return postJson<LayoutTemplateVersionReadModel>(
    `/contract-layout-template-versions/${versionId}/clone`
  );
}

export function stopLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/stop`);
}

export function revokeLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/revoke`);
}

export function discardLayoutTemplateVersion(
  versionId: string,
  body: { reason: string; expectedRevision: number }
) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/discard`, body);
}

export interface PublishedStandardClause {
  standardClauseVersionId: string;
  versionId: string;
  versionNo: number;
  title: string;
  content: unknown;
  clauseId: string;
  code: string;
  name: string;
  category: string;
}

export interface StandardClauseVersionReadModel {
  id: string;
  clauseId: string;
  versionNo: number;
  status: ContractTemplateVersionStatus;
  title: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
  discardedAt?: string | null;
  discardedByUserId?: string | null;
  discardReason?: string | null;
  availableActions: DetailActionReadModel[];
  blockedReasons: string[];
}

export interface StandardClauseHistoryReadModel {
  id: string;
  code: string;
  category: string;
  name: string;
  versions: StandardClauseVersionReadModel[];
}

export function listPublishedStandardClauses(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return readJson<PublishedStandardClause[]>(`/standard-clauses${qs}`);
}

export function listStandardClauseHistory(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return readJson<StandardClauseHistoryReadModel[]>(`/standard-clauses/history${qs}`);
}

export interface CreateStandardClausePayload {
  code: string;
  category: string;
  name: string;
  title: string;
  content: unknown;
}

export function createStandardClause(body: CreateStandardClausePayload) {
  return postJson<unknown>("/standard-clauses", body);
}

export function submitStandardClauseVersion(versionId: string) {
  return postJson<unknown>(`/standard-clause-versions/${versionId}/submission`);
}

export function publishStandardClauseVersion(
  versionId: string,
  body: { changeSummary: string }
) {
  return postJson<unknown>(`/standard-clause-versions/${versionId}/publication`, body);
}

export function discardStandardClauseVersion(
  versionId: string,
  body: { reason: string; expectedUpdatedAt: string }
) {
  return postJson<unknown>(`/standard-clause-versions/${versionId}/discard`, body);
}

// ---------------------------------------------------------------------------
// Contract bill rows (POST/PATCH /contract-bills/:billId/rows/:rowKey)
// ---------------------------------------------------------------------------

export interface SaveBillRowPayload {
  expectedBillRevision: number;
  itemCode?: string;
  itemName?: string;
  specification?: string;
  unit?: string;
  quantity?: string;
  unitPrice?: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

export function addBillRow(billId: string, body: SaveBillRowPayload) {
  return postJson<unknown>(`/contract-bills/${billId}/rows`, body);
}

export function updateBillRow(billId: string, rowKey: string, body: SaveBillRowPayload) {
  return patchJson<unknown>(`/contract-bills/${billId}/rows/${rowKey}`, body);
}

export interface DeleteBillRowPayload {
  expectedBillRevision: number;
}

export function deleteBillRow(
  billId: string,
  rowKey: string,
  body: DeleteBillRowPayload
) {
  return deleteJson<unknown>(`/contract-bills/${billId}/rows/${rowKey}`, body);
}

export interface CancelContractBillRemainderPayload {
  expectedBillRevision: number;
  expectedDraftRevision: number;
  expectedOccupancyToken: string;
  reason: string;
}

async function cancelContractBillRemainder(
  billId: string,
  rowKey: string,
  leaseToken: string,
  body: CancelContractBillRemainderPayload
) {
  let response: Response;
  try {
    response = await apiFetch(
      `/contract-bills/${encodeURIComponent(billId)}/rows/${encodeURIComponent(rowKey)}/remainder-cancellation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Draft-Lease": leaseToken
        },
        body: JSON.stringify(body)
      }
    );
  } catch (error) {
    throw contractBillRemainderResultUnknownError(error);
  }
  try {
    await ensureOk(response, "取消未实施余量失败", true);
  } catch (error) {
    if (response.status === 408 || response.status >= 500) {
      throw contractBillRemainderResultUnknownError(error);
    }
    throw error;
  }
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw contractBillRemainderResultUnknownError(error);
  }
}

export interface ContractBillRemainderCancellationOperationContext {
  ownerScope: string;
  routeGeneration: number;
  operationId: number;
  contractId: string;
  versionId: string;
  billId: string;
  billKey: string;
  rowKey: string;
  leaseToken: string;
  reason: string;
}

export interface ContractBillRemainderCancellationFlushResult {
  saved: boolean;
  expectedDraftRevision?: number;
  error?: string;
}

export interface ExecuteContractBillRemainderCancellationInput {
  capture: () => ContractBillRemainderCancellationOperationContext | null;
  flush: (
    context: ContractBillRemainderCancellationOperationContext
  ) => Promise<ContractBillRemainderCancellationFlushResult>;
  isCurrent: (
    context: ContractBillRemainderCancellationOperationContext
  ) => boolean;
}

interface PreparedContractBillRemainderCancellation {
  expectedBillRevision: number;
  expectedDraftRevision: number;
  expectedOccupancyToken: string;
  historicalQuantity: string;
  historicalAmountCents: string;
}

export type ExecuteContractBillRemainderCancellationResult =
  | { status: "not_started" }
  | {
      status: "save_failed";
      context: ContractBillRemainderCancellationOperationContext;
      error: Error;
    }
  | {
      status: "stale";
      context: ContractBillRemainderCancellationOperationContext;
    }
  | {
      status: "failed";
      context: ContractBillRemainderCancellationOperationContext;
      error: unknown;
      resultUnknown: boolean;
    }
  | {
      status: "completed";
      context: ContractBillRemainderCancellationOperationContext;
      prepared: PreparedContractBillRemainderCancellation;
      preflight: ContractDraftWorkbenchReadModel;
      response: unknown;
    };

export async function executeContractBillRemainderCancellation(
  input: ExecuteContractBillRemainderCancellationInput
): Promise<ExecuteContractBillRemainderCancellationResult> {
  const captured = input.capture();
  if (!captured) return { status: "not_started" };

  let context: ContractBillRemainderCancellationOperationContext;
  try {
    context = normalizeContractBillRemainderCancellationContext(captured);
  } catch (error) {
    return { status: "failed", context: captured, error, resultUnknown: false };
  }
  if (!input.isCurrent(context)) return { status: "stale", context };

  let flush: ContractBillRemainderCancellationFlushResult;
  try {
    flush = await input.flush(context);
  } catch (error) {
    return {
      status: "save_failed",
      context,
      error: error instanceof Error ? error : new Error("合同草稿未保存成功")
    };
  }
  if (!flush.saved) {
    return {
      status: "save_failed",
      context,
      error: new Error(flush.error?.trim() || "合同草稿未保存成功，本次取消未执行")
    };
  }
  if (!input.isCurrent(context)) return { status: "stale", context };
  if (
    !Number.isInteger(flush.expectedDraftRevision) ||
    Number(flush.expectedDraftRevision) < 1
  ) {
    return {
      status: "failed",
      context,
      error: contractBillRemainderOperationError(
        "CONTRACT_BILL_REMAINDER_INVALID_CONTEXT",
        "合同草稿保存修订无效，本次取消未执行"
      ),
      resultUnknown: false
    };
  }

  let preflight: ContractDraftWorkbenchReadModel;
  let prepared: PreparedContractBillRemainderCancellation;
  try {
    preflight = await fetchContractDraftWorkbench(context.versionId);
    if (!input.isCurrent(context)) return { status: "stale", context };
    prepared = prepareContractBillRemainderCancellation(
      context,
      Number(flush.expectedDraftRevision),
      preflight
    );
  } catch (error) {
    return { status: "failed", context, error, resultUnknown: false };
  }
  if (!input.isCurrent(context)) return { status: "stale", context };

  let response: unknown;
  try {
    response = await cancelContractBillRemainder(
      context.billId,
      context.rowKey,
      context.leaseToken,
      {
        expectedBillRevision: prepared.expectedBillRevision,
        expectedDraftRevision: prepared.expectedDraftRevision,
        expectedOccupancyToken: prepared.expectedOccupancyToken,
        reason: context.reason
      }
    );
  } catch (error) {
    return {
      status: "failed",
      context,
      error,
      resultUnknown: contractBillRemainderErrorCode(error) ===
        "CONTRACT_BILL_REMAINDER_RESULT_UNKNOWN"
    };
  }
  return { status: "completed", context, prepared, preflight, response };
}

function normalizeContractBillRemainderCancellationContext(
  context: ContractBillRemainderCancellationOperationContext
): ContractBillRemainderCancellationOperationContext {
  const normalized = {
    ...context,
    ownerScope: context.ownerScope.trim(),
    contractId: context.contractId.trim(),
    versionId: context.versionId.trim(),
    billId: context.billId.trim(),
    billKey: context.billKey.trim(),
    rowKey: context.rowKey.trim(),
    leaseToken: context.leaseToken.trim(),
    reason: context.reason.trim()
  };
  if (
    !normalized.ownerScope ||
    !normalized.contractId ||
    !normalized.versionId ||
    !normalized.billId ||
    !normalized.billKey ||
    !normalized.rowKey ||
    !normalized.leaseToken ||
    !normalized.reason ||
    normalized.reason.length > 500 ||
    !Number.isInteger(normalized.routeGeneration) ||
    normalized.routeGeneration < 0 ||
    !Number.isInteger(normalized.operationId) ||
    normalized.operationId < 1
  ) {
    throw contractBillRemainderOperationError(
      "CONTRACT_BILL_REMAINDER_INVALID_CONTEXT",
      "取消未实施余量的页面上下文已失效，请重新读取当前清单"
    );
  }
  return normalized;
}

function prepareContractBillRemainderCancellation(
  context: ContractBillRemainderCancellationOperationContext,
  expectedDraftRevision: number,
  preflight: ContractDraftWorkbenchReadModel
): PreparedContractBillRemainderCancellation {
  const matchingBills = preflight.bills.filter((candidate) => {
    const value = contractBillRemainderObject(candidate);
    return value["id"] === context.billId && value["billKey"] === context.billKey;
  });
  const bill = matchingBills[0];
  const billValue = contractBillRemainderObject(bill);
  const rows = Array.isArray(billValue["rows"])
    ? billValue["rows"] as unknown[]
    : [];
  const matchingRows = rows.filter(
    (candidate) => contractBillRemainderObject(candidate)["rowKey"] === context.rowKey
  );
  const rowValue = contractBillRemainderObject(matchingRows[0]);
  const actions = Array.isArray(rowValue["availableActions"])
    ? rowValue["availableActions"] as unknown[]
    : [];
  const matchingActions = actions
    .map(contractBillRemainderObject)
    .filter((action) => action["key"] === "contract-bill.remainder-cancellation");
  const action = matchingActions[0] ?? {};
  const facts = contractBillRemainderObject(rowValue["remainderCancellation"]);
  const expectedBillRevision = Number(facts["expectedBillRevision"]);
  const factDraftRevision = Number(facts["expectedDraftRevision"]);
  const billRevision = Number(billValue["revision"]);
  const expectedOccupancyToken =
    typeof facts["expectedOccupancyToken"] === "string"
      ? facts["expectedOccupancyToken"].trim()
      : "";
  const historicalQuantity =
    typeof facts["historicalQuantity"] === "string"
      ? facts["historicalQuantity"].trim()
      : "";
  const historicalAmountCents =
    typeof facts["historicalAmountCents"] === "string"
      ? facts["historicalAmountCents"].trim()
      : "";
  if (
    preflight.contract.id !== context.contractId ||
    preflight.contract.ownerUserId !== context.ownerScope ||
    preflight.version.id !== context.versionId ||
    preflight.version.draftRevision !== expectedDraftRevision ||
    matchingBills.length !== 1 ||
    matchingRows.length !== 1 ||
    matchingActions.length !== 1 ||
    action["enabled"] !== true ||
    action["kind"] !== "danger" ||
    action["requiresComment"] !== true ||
    action["requiresPassword"] !== false ||
    !Number.isInteger(billRevision) ||
    !Number.isInteger(expectedBillRevision) ||
    expectedBillRevision !== billRevision ||
    !Number.isInteger(factDraftRevision) ||
    factDraftRevision !== expectedDraftRevision ||
    !expectedOccupancyToken ||
    !historicalQuantity ||
    !/^\d+$/u.test(historicalAmountCents)
  ) {
    throw contractBillRemainderOperationError(
      "CONTRACT_BILL_REMAINDER_PREFLIGHT_MISMATCH",
      "当前清单余量取消条件已变化，本次未写入，请按最新工作台重新确认"
    );
  }
  return {
    expectedBillRevision,
    expectedDraftRevision,
    expectedOccupancyToken,
    historicalQuantity,
    historicalAmountCents
  };
}

function contractBillRemainderObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function contractBillRemainderOperationError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function contractBillRemainderResultUnknownError(cause: unknown) {
  return Object.assign(
    new Error(
      "取消未实施余量的提交结果未知，已禁止自动重试；请重新读取工作台后核对"
    ),
    { code: "CONTRACT_BILL_REMAINDER_RESULT_UNKNOWN", cause }
  );
}

function contractBillRemainderErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

export interface ReorderBillRowsPayload {
  expectedBillRevision: number;
  rowKeys: string[];
}

export function reorderBillRows(billId: string, body: ReorderBillRowsPayload) {
  return postJson<unknown>(`/contract-bills/${billId}/rows/reorder`, body);
}

/** Core row field name or the exact key of a template-defined custom column. */
export type ContractBillRowValidationField = string;

export interface ContractBillRowValidationError {
  clientRowKey: string;
  field: ContractBillRowValidationField;
  message: string;
}

export interface ContractBillCandidateRowInput {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReplaceContractBillRowsInput {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: ContractBillCandidateRowInput[];
}

/** The post-save bill projection returned by the batch endpoint. */
export interface ContractBillBatchSaveBillReadModel {
  id: string;
  contractVersionId: string;
  billKey: string;
  name: string;
  amountRole: string;
  pricingMode: string;
  quantityScale: number;
  unitPriceScale: number;
  schemaSnapshot: Record<string, unknown>;
  sourceExcelFileId: string | null;
  revision: number;
  taxInclusiveAmountCents: string;
  taxExclusiveAmountCents: string;
  taxAmountCents: string;
  createdAt: string;
  updatedAt: string;
}

/** A fully authoritative bill-row projection used to rebuild local candidates. */
export interface ContractBillBatchSaveRowReadModel {
  id: string;
  contractBillId: string;
  rowKey: string;
  sortOrder: number;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: string | null;
  unitPrice: string | null;
  taxRate: string | null;
  taxRateSource: string;
  pricingFactStatus: string;
  precisionPolicy: string;
  taxInclusiveAmountCents: string | null;
  taxExclusiveAmountCents: string | null;
  taxAmountCents: string | null;
  taxExclusiveUnitPrice: string | null;
  isProvisional: boolean;
  settlementBasis: string | null;
  customData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReplaceContractBillRowsReadModel {
  bill: ContractBillBatchSaveBillReadModel | null;
  rows: ContractBillBatchSaveRowReadModel[];
}

// ---------------------------------------------------------------------------
// Contract bill Excel templates and draft import preview
// ---------------------------------------------------------------------------

// Excel template download: backend responds with a streaming .xlsx file.
export async function downloadBillExcelTemplate(billId: string): Promise<void> {
  return downloadBillExcelTemplateFromPath(
    `/contract-bills/${billId}/excel-template`,
    `合同清单模板-${billId}.xlsx`
  );
}

export async function downloadContractDraftBillExcelTemplate(
  contractVersionId: string,
  billKey: string
): Promise<void> {
  return downloadBillExcelTemplateFromPath(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/bills/${encodeURIComponent(billKey)}/template`,
    `合同清单模板-${billKey}.xlsx`
  );
}

async function downloadBillExcelTemplateFromPath(
  path: string,
  fallbackFileName: string
): Promise<void> {
  const response = await apiFetch(path);
  await ensureOk(response, "下载清单模板失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match
    ? decodeURIComponent(match[1])
    : fallbackFileName;
  saveBlob(blob, fileName);
}

export interface ContractDraftBillExcelImportPreview {
  billKey: string;
  targetBillRevision: number;
  rows: ContractBillCandidateRowInput[];
  added: number;
  skipped: number;
  beforeAmountCents: string;
  afterAmountCents: string;
  errors: Array<{
    sheet: string;
    row: number;
    column: string;
    message: string;
  }>;
}

export function previewContractDraftBillExcelImport(
  contractVersionId: string,
  billKey: string,
  body: { fileId: string }
) {
  return postJson<ContractDraftBillExcelImportPreview>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/bills/${encodeURIComponent(billKey)}/import-preview`,
    body
  );
}

// ---------------------------------------------------------------------------
// Contract documents (POST/GET /contract-workbench/:contractVersionId/documents)
// ---------------------------------------------------------------------------

export interface QueueContractDocumentPayload {
  layoutTemplateVersionId: string;
  purpose?: string;
  attachmentFileIds?: string[];
  [key: string]: unknown;
}

export function queueContractDocument(
  contractVersionId: string,
  body: QueueContractDocumentPayload
) {
  return postJson<unknown>(`/contract-workbench/${contractVersionId}/documents`, body);
}

export function listContractDocuments(contractVersionId: string) {
  return readJson<unknown[]>(`/contract-workbench/${contractVersionId}/documents`);
}

export function retryContractDocument(documentId: string) {
  return postJson<unknown>(`/contract-documents/${documentId}/retry`);
}
