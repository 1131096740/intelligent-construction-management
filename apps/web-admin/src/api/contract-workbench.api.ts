import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

// ---------------------------------------------------------------------------
// Local HTTP helpers (built on apiFetch; keep isolated from core-flow client)
// ---------------------------------------------------------------------------

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(data.message.join("；"), response.status, fallback);
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
    message = formatApiErrorMessage(message, response.status, fallback);
  }

  throw new Error(message);
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

async function patchJson<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "保存失败");
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

export interface CreateWorkbenchDraftPayload {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
}

export interface CreateWorkbenchDraftReadModel {
  contract: { id: string };
  version: { id: string };
  [key: string]: unknown;
}

export function createWorkbenchDraft(body: CreateWorkbenchDraftPayload) {
  return postJson<CreateWorkbenchDraftReadModel>("/contracts", body);
}

export function fetchContractWorkbench(contractId: string) {
  return readJson<unknown>(`/contract-workbench/${contractId}`);
}

export function listContractDrafts(scope: "my" | "voided") {
  return readJson<unknown[]>(`/contract-workbench?scope=${scope}`);
}

export interface SaveContractDraftPayload {
  expectedRevision: number;
  draftData?: Record<string, unknown>;
  clauses?: unknown[];
  pricingNature?: string;
  amountSource?: string;
  manualAmountCents?: number;
  [key: string]: unknown;
}

export function saveContractDraft(contractVersionId: string, body: SaveContractDraftPayload) {
  return patchJson<unknown>(`/contract-workbench/${contractVersionId}`, body);
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

export function listPublishedContractTemplates(contractTypeKey?: string) {
  const qs = contractTypeKey ? `?contractTypeKey=${encodeURIComponent(contractTypeKey)}` : "";
  return readJson<unknown[]>(`/contract-templates${qs}`);
}

export function getContractTemplate(templateId: string) {
  return readJson<unknown>(`/contract-templates/${templateId}`);
}

export interface ContractTemplateSchemaPayload {
  fields: unknown[];
  bills: unknown[];
  clauses: unknown[];
  attachments: unknown[];
  validations: unknown[];
}

export interface CreateContractTemplatePayload {
  code: string;
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
  return postJson<unknown>(`/contract-template-versions/${versionId}/clone`);
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

export function createLayoutTemplate(body: CreateLayoutTemplatePayload) {
  return postJson<unknown>("/contract-layout-templates", body);
}

export function inspectLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/inspection`);
}

export function queueLayoutTemplatePreview(versionId: string, sampleData: unknown) {
  return postJson<unknown>(
    `/contract-layout-template-versions/${versionId}/preview-generation`,
    sampleData
  );
}

export function getLatestLayoutTemplatePreview(versionId: string) {
  return readJson<unknown>(
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
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/clone`);
}

export function stopLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/stop`);
}

export function revokeLayoutTemplateVersion(versionId: string) {
  return postJson<unknown>(`/contract-layout-template-versions/${versionId}/revoke`);
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

export function listPublishedStandardClauses(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return readJson<PublishedStandardClause[]>(`/standard-clauses${qs}`);
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

// ---------------------------------------------------------------------------
// Contract bill rows (POST/PATCH /contract-bills/:billId/rows/:rowKey)
// ---------------------------------------------------------------------------

export interface SaveBillRowPayload {
  expectedBillRevision: number;
  itemName?: string;
  unit?: string;
  quantity?: string;
  unitPrice?: string;
  taxRatePercent?: string;
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

// ---------------------------------------------------------------------------
// Contract bill Excel (GET blob, POST JSON preview, POST apply)
// ---------------------------------------------------------------------------

// Excel template download: backend responds with a streaming .xlsx file.
export async function downloadBillExcelTemplate(billId: string): Promise<void> {
  const response = await apiFetch(`/contract-bills/${billId}/excel-template`);
  await ensureOk(response, "下载清单模板失败");
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const fileName = match
    ? decodeURIComponent(match[1])
    : `合同清单模板-${billId}.xlsx`;
  saveBlob(blob, fileName);
}

export interface PreviewBillExcelImportPayload {
  /** Already-uploaded private file id — send as JSON, NOT FormData. */
  fileId: string;
  mode?: "replace" | "update";
}

// Preview: file is already uploaded via /files; we only pass its id as JSON.
export function previewBillExcelImport(billId: string, body: PreviewBillExcelImportPayload) {
  return postJson<unknown>(`/contract-bills/${billId}/excel-imports`, body);
}

export function applyBillExcelImport(importId: string) {
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

export interface UploadContractOfflineRevisionInput {
  fileId: string;
  sourceGeneratedDocumentId?: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: boolean;
}

export function listContractOfflineRevisions(contractVersionId: string) {
  return readJson<unknown[]>(`/contract-workbench/${contractVersionId}/offline-revisions`);
}

export function uploadContractOfflineRevision(
  contractVersionId: string,
  body: UploadContractOfflineRevisionInput
) {
  return postJson<unknown>(
    `/contract-workbench/${contractVersionId}/offline-revisions`,
    body
  );
}
