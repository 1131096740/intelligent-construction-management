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
  try {
    const data = (await response.clone().json()) as {
      message?: unknown;
      code?: unknown;
      conflictReason?: unknown;
    };
    if (preserveConflictDetails && typeof data.code === "string") code = data.code;
    if (preserveConflictDetails && typeof data.conflictReason === "string") {
      conflictReason = data.conflictReason;
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
  };
  if (code) error.code = code;
  if (conflictReason) error.conflictReason = conflictReason;
  throw error;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取失败");
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

async function putJson<TResponse>(
  path: string,
  body?: unknown,
  parseError?: (response: Response) => Promise<Error | null>
): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) {
    const parsedError = parseError ? await parseError(response) : null;
    if (parsedError) throw parsedError;
    await ensureOk(response, "保存失败");
  }
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
}

export function fetchContractWorkbench(contractId: string) {
  return readJson<ContractWorkbenchReadModel>(
    `/contract-workbench/${encodeURIComponent(contractId)}`
  );
}

export function fetchContractDraftWorkbench(contractVersionId: string) {
  return readJson<ContractDraftWorkbenchReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}/workbench`
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

export function submitContractDraft(
  contractVersionId: string,
  leaseToken: string,
  payload: { expectedRevision: number; idempotencyKey: string }
) {
  return postJsonWithHeaders<unknown>(
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
  return deleteJson<AbandonContractDraftReadModel>(
    `/contract-drafts/${encodeURIComponent(contractVersionId)}`,
    { expectedRevision, ...confirmation }
  );
}

export interface AbandonContractDraftPayload {
  expectedRevision: number;
  action: "delete_pristine_draft" | "abandon_application";
  reason?: string;
}

export interface AbandonContractDraftReadModel {
  contractVersionId: string;
  status: "abandoned";
  lifecycleKind: "pristine_draft" | "approval_draft";
  action: "delete_pristine_draft" | "abandon_application";
  abandonedAt: string | null;
  abandonedByUserId: string | null;
  reason: string | null;
  idempotent: boolean;
}

export function abandonContractDraft(
  contractVersionId: string,
  body: AbandonContractDraftPayload
) {
  return postJson<AbandonContractDraftReadModel>(
    `/contracts/${encodeURIComponent(contractVersionId)}/abandonment`,
    body
  );
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

export function checkContractSubmissionReadiness(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/readiness`);
}

export function submitContractFromWorkbench(
  contractVersionId: string,
  body: Record<string, unknown> = {}
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-submission`, body);
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
// Business parties (GET/POST /business-parties, POST /contract-workbench/:versionId/parties)
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

export interface AddContractPartyPayload {
  roleKey: string;
  businessPartyVersionId?: string;
  snapshot?: Record<string, unknown>;
}

export function addContractParty(contractVersionId: string, body: AddContractPartyPayload) {
  return postJson<unknown>(`/contract-workbench/${contractVersionId}/parties`, body);
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

export type ContractBillValidationError = Error & {
  code: "CONTRACT_BILL_VALIDATION_FAILED";
  rowErrors: ContractBillRowValidationError[];
};

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseContractBillValidationError(
  data: unknown
): ContractBillValidationError | null {
  if (
    !isPlainRecord(data) ||
    data.code !== "CONTRACT_BILL_VALIDATION_FAILED" ||
    !isNonEmptyString(data.message) ||
    !Array.isArray(data.rowErrors)
  ) {
    return null;
  }

  const rowErrors: ContractBillRowValidationError[] = [];
  for (const rowError of data.rowErrors) {
    if (
      !isPlainRecord(rowError) ||
      !isNonEmptyString(rowError.clientRowKey) ||
      !isNonEmptyString(rowError.field) ||
      !isNonEmptyString(rowError.message)
    ) {
      return null;
    }
    rowErrors.push({
      clientRowKey: rowError.clientRowKey,
      field: rowError.field,
      message: rowError.message
    });
  }

  const error = new Error(data.message) as ContractBillValidationError;
  error.code = "CONTRACT_BILL_VALIDATION_FAILED";
  error.rowErrors = rowErrors;
  return error;
}

async function parseContractBillValidationResponse(response: Response): Promise<Error | null> {
  if (response.status !== 400) return null;
  try {
    return parseContractBillValidationError(await response.clone().json());
  } catch {
    return null;
  }
}

export function replaceContractBillRows(
  billId: string,
  input: ReplaceContractBillRowsInput
) {
  return putJson<ReplaceContractBillRowsReadModel>(
    `/contract-bills/${encodeURIComponent(billId)}/rows`,
    input,
    parseContractBillValidationResponse
  );
}

// ---------------------------------------------------------------------------
// Contract bill Excel (GET blob, POST JSON preview, POST apply)
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

export interface PreviewBillExcelImportPayload {
  /** Already-uploaded private file id — send as JSON, NOT FormData. */
  fileId: string;
  mode?: "replace" | "update" | "append" | "version_replace";
}

export type ContractBillImportDiffKind =
  | "unchanged"
  | "added"
  | "removed"
  | "one_to_one"
  | "manual_review";

export interface ContractBillImportDiffRow {
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
}

export interface ContractBillImportDiff {
  kind: ContractBillImportDiffKind;
  rowKey: string;
  source?: ContractBillImportDiffRow;
  incoming?: ContractBillImportDiffRow;
}

export interface VersionBillExcelImportPreview {
  importId: string;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  beforeAmountCents: string;
  afterAmountCents: string;
  errors: Array<{ message: string }>;
  diffs: ContractBillImportDiff[];
}

// Preview: file is already uploaded via /files; we only pass its id as JSON.
export function previewBillExcelImport(
  billId: string,
  body: PreviewBillExcelImportPayload
) {
  return postJson<VersionBillExcelImportPreview>(
    `/contract-bills/${billId}/excel-imports`,
    body
  );
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

export function applyBillExcelImport(importId: string): Promise<unknown> {
  return postJson<unknown>(`/contract-bill-imports/${importId}/apply`);
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
