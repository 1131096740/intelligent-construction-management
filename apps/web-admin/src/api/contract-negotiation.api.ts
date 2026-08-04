import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ContractNegotiationRoundStatus = "open" | "closed";
export type ContractNegotiationProcessStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "stale";
export type ContractDifferenceDisposition =
  | "pending"
  | "confirmed"
  | "rejected"
  | "no_material_change";

export type ContractDifferenceCandidate =
  | { kind: "amount"; label: string; cents: string }
  | { kind: "date"; label: string; isoDate: string }
  | {
      kind: "key_clause";
      title: string;
      proposedText: string;
    };

export interface ContractDocumentDifferenceReadModel {
  id: string;
  sortOrder: number;
  changeType: "insert" | "delete" | "replace";
  kind: string;
  locationPath: string;
  beforeText: string | null;
  afterText: string | null;
  candidate: ContractDifferenceCandidate | null;
  disposition: ContractDifferenceDisposition;
  dispositionReason: string | null;
  disposedAt: string | null;
}

export interface ContractDocumentComparisonReadModel {
  id: string;
  status: ContractNegotiationProcessStatus;
  errorMessage: string | null;
  completedAt: string | null;
  differences: ContractDocumentDifferenceReadModel[];
}

export interface ContractOfflineRevisionReadModel {
  id: string;
  label: string;
  note: string | null;
  status: ContractNegotiationProcessStatus;
  hasPreviewPdf: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  comparison: ContractDocumentComparisonReadModel | null;
}

export interface ContractOfflineRevisionHistoryRoundReadModel {
  id: string;
  roundNo: number;
  status: ContractNegotiationRoundStatus;
  sourceRevision: number;
}

export interface ContractOfflineRevisionHistoryReadModel {
  id: string;
  label: string;
  note: string | null;
  status: ContractNegotiationProcessStatus;
  hasPreviewPdf: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  negotiationRound: ContractOfflineRevisionHistoryRoundReadModel | null;
}

export interface ContractNegotiationRoundReadModel {
  id: string;
  roundNo: number;
  status: ContractNegotiationRoundStatus;
  sourceRevision: number;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  revisions: ContractOfflineRevisionReadModel[];
}

export interface UploadContractNegotiationRevisionPayload {
  fileId: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: true;
}

export interface DisposeContractDifferencePayload {
  disposition: Exclude<ContractDifferenceDisposition, "pending">;
  reason?: string;
}

export interface RevisionPreviewDownloadTicketPayload {
  confirmationPassword: string;
  downloadReason: string;
}

export function listContractNegotiationRounds(contractVersionId: string) {
  return readJson<unknown>(
    `/contract-workbench/${encodeURIComponent(contractVersionId)}/negotiation-rounds`
  );
}

export async function listContractOfflineRevisionHistory(
  contractVersionId: string
): Promise<ContractOfflineRevisionHistoryReadModel[]> {
  return normalizeContractOfflineRevisionHistory(await readJson<unknown>(
    `/contract-workbench/${encodeURIComponent(contractVersionId)}/offline-revisions`
  ));
}

export function openContractNegotiationRound(contractVersionId: string, note?: string) {
  return postJson<unknown>(
    `/contract-workbench/${encodeURIComponent(contractVersionId)}/negotiation-rounds`,
    note?.trim() ? { note: note.trim() } : {}
  );
}

export function uploadContractNegotiationRevision(
  contractVersionId: string,
  body: UploadContractNegotiationRevisionPayload
) {
  return postJson<unknown>(
    `/contract-workbench/${encodeURIComponent(contractVersionId)}/offline-revisions`,
    body
  );
}

export function closeContractNegotiationRound(roundId: string) {
  return postJson<unknown>(
    `/contract-negotiation-rounds/${encodeURIComponent(roundId)}/close`
  );
}

export function disposeContractDocumentDifference(
  differenceId: string,
  body: DisposeContractDifferencePayload
) {
  return postJson<unknown>(
    `/contract-document-differences/${encodeURIComponent(differenceId)}/disposition`,
    body
  );
}

export function retryContractOfflineRevision(revisionId: string) {
  return postJson<unknown>(
    `/contract-offline-revisions/${encodeURIComponent(revisionId)}/retry`
  );
}

export async function openContractRevisionPreview(
  revisionId: string,
  body: RevisionPreviewDownloadTicketPayload,
  isCurrent: () => boolean
) {
  const ticket = normalizeRevisionPreviewDownloadTicket(await postJson<unknown>(
    `/contract-offline-revisions/${encodeURIComponent(revisionId)}/preview-download-ticket`,
    body
  ));
  if (!isCurrent()) return false;
  const response = await apiFetch(ticket.downloadPath);
  await ensureOk(response, "打开修订 PDF 失败");
  const blob = await response.blob();
  if (!isCurrent()) return false;
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return true;
}

const historyRevisionKeys = new Set([
  "id",
  "label",
  "note",
  "status",
  "hasPreviewPdf",
  "errorMessage",
  "createdAt",
  "completedAt",
  "comparison",
  "negotiationRound"
]);
const historyRoundKeys = new Set(["id", "roundNo", "status", "sourceRevision"]);
const historyComparisonKeys = new Set([
  "id",
  "status",
  "algorithmVersion",
  "errorMessage",
  "completedAt",
  "differences"
]);
const historyDifferenceKeys = new Set([
  "id",
  "sortOrder",
  "changeType",
  "kind",
  "locationPath",
  "basePath",
  "revisedPath",
  "beforeText",
  "afterText",
  "candidate",
  "disposition",
  "dispositionReason",
  "disposedAt"
]);

function normalizeContractOfflineRevisionHistory(
  value: unknown
): ContractOfflineRevisionHistoryReadModel[] {
  if (!Array.isArray(value)) return malformedOfflineRevisionHistory();
  const revisions = value.map(normalizeOfflineRevisionHistoryItem);
  assertUniqueHistoryIds(revisions.map((revision) => revision.id), "线下修订记录");
  return revisions;
}

function normalizeOfflineRevisionHistoryItem(
  value: unknown
): ContractOfflineRevisionHistoryReadModel {
  const record = strictHistoryRecord(value, historyRevisionKeys);
  const status = historyProcessStatus(record.status);
  if (typeof record.hasPreviewPdf !== "boolean") malformedOfflineRevisionHistory();
  if (record.hasPreviewPdf && status !== "succeeded") malformedOfflineRevisionHistory();
  const negotiationRound = record.negotiationRound === null
    ? null
    : normalizeHistoryRound(record.negotiationRound);
  if (record.comparison === null) {
    // 旧流程记录必须保持无轮次、无比较结果、无预览事实的只读形态。
    if (negotiationRound === null && record.hasPreviewPdf) malformedOfflineRevisionHistory();
  } else {
    if (negotiationRound === null) malformedOfflineRevisionHistory();
    validateHistoryComparison(record.comparison);
  }
  return {
    id: requiredHistoryId(record.id),
    label: requiredHistoryText(record.label),
    note: optionalHistoryText(record.note),
    status,
    hasPreviewPdf: record.hasPreviewPdf,
    errorMessage: optionalHistoryText(record.errorMessage),
    createdAt: requiredHistoryTimestamp(record.createdAt),
    completedAt: optionalHistoryTimestamp(record.completedAt),
    negotiationRound
  };
}

function normalizeHistoryRound(value: unknown): ContractOfflineRevisionHistoryRoundReadModel {
  const record = strictHistoryRecord(value, historyRoundKeys);
  if (record.status !== "open" && record.status !== "closed") {
    return malformedOfflineRevisionHistory();
  }
  if (!Number.isInteger(record.roundNo) || Number(record.roundNo) <= 0) {
    return malformedOfflineRevisionHistory();
  }
  if (!Number.isInteger(record.sourceRevision) || Number(record.sourceRevision) <= 0) {
    return malformedOfflineRevisionHistory();
  }
  return {
    id: requiredHistoryId(record.id),
    roundNo: Number(record.roundNo),
    status: record.status,
    sourceRevision: Number(record.sourceRevision)
  };
}

function validateHistoryComparison(value: unknown) {
  const record = strictHistoryRecord(value, historyComparisonKeys);
  requiredHistoryId(record.id);
  historyProcessStatus(record.status);
  requiredHistoryText(record.algorithmVersion);
  optionalHistoryText(record.errorMessage);
  optionalHistoryTimestamp(record.completedAt);
  if (!Array.isArray(record.differences)) malformedOfflineRevisionHistory();
  const differenceIds = record.differences.map(validateHistoryDifference);
  assertUniqueHistoryIds(differenceIds, "合同文档差异");
}

function validateHistoryDifference(value: unknown) {
  const record = strictHistoryRecord(value, historyDifferenceKeys);
  const id = requiredHistoryId(record.id);
  if (!Number.isInteger(record.sortOrder) || Number(record.sortOrder) <= 0) {
    malformedOfflineRevisionHistory();
  }
  if (!new Set(["insert", "delete", "replace"]).has(String(record.changeType))) {
    malformedOfflineRevisionHistory();
  }
  if (!new Set(["pending", "confirmed", "rejected", "no_material_change"]).has(String(record.disposition))) {
    malformedOfflineRevisionHistory();
  }
  requiredHistoryText(record.kind);
  requiredHistoryText(record.locationPath);
  optionalHistoryText(record.basePath);
  optionalHistoryText(record.revisedPath);
  optionalHistoryText(record.beforeText);
  optionalHistoryText(record.afterText);
  optionalHistoryText(record.dispositionReason);
  optionalHistoryTimestamp(record.disposedAt);
  if (record.candidate !== null) validateHistoryCandidate(record.candidate);
  return id;
}

function validateHistoryCandidate(value: unknown) {
  const record = historyRecord(value);
  if (record.kind === "amount") {
    assertExactHistoryKeys(record, new Set(["kind", "label", "cents"]));
    requiredHistoryText(record.label);
    requiredHistoryText(record.cents);
    return;
  }
  if (record.kind === "date") {
    assertExactHistoryKeys(record, new Set(["kind", "fieldKey", "label", "isoDate"]));
    requiredHistoryText(record.fieldKey);
    requiredHistoryText(record.label);
    requiredHistoryText(record.isoDate);
    return;
  }
  if (record.kind === "key_clause") {
    assertExactHistoryKeys(
      record,
      new Set(["kind", "clauseKey", "title", "proposedText", "baseTextSha256"])
    );
    requiredHistoryText(record.clauseKey);
    requiredHistoryText(record.title);
    requiredHistoryText(record.proposedText);
    requiredHistoryText(record.baseTextSha256);
    return;
  }
  malformedOfflineRevisionHistory();
}

function strictHistoryRecord(value: unknown, allowedKeys: Set<string>) {
  const record = historyRecord(value);
  assertExactHistoryKeys(record, allowedKeys);
  return record;
}

function historyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return malformedOfflineRevisionHistory();
  }
  return value as Record<string, unknown>;
}

function assertExactHistoryKeys(record: Record<string, unknown>, allowedKeys: Set<string>) {
  const keys = Object.keys(record);
  if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
    malformedOfflineRevisionHistory();
  }
}

function historyProcessStatus(value: unknown): ContractNegotiationProcessStatus {
  if (!new Set(["queued", "processing", "succeeded", "failed", "stale"]).has(String(value))) {
    return malformedOfflineRevisionHistory();
  }
  return value as ContractNegotiationProcessStatus;
}

function requiredHistoryId(value: unknown) {
  const id = requiredHistoryText(value);
  if (id !== id.trim()) return malformedOfflineRevisionHistory();
  return id;
}

function requiredHistoryText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return malformedOfflineRevisionHistory();
  return value;
}

function optionalHistoryText(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return malformedOfflineRevisionHistory();
  return value.trim() ? value : null;
}

function requiredHistoryTimestamp(value: unknown) {
  const timestamp = requiredHistoryText(value);
  if (Number.isNaN(Date.parse(timestamp))) return malformedOfflineRevisionHistory();
  return timestamp;
}

function optionalHistoryTimestamp(value: unknown) {
  if (value === null) return null;
  return requiredHistoryTimestamp(value);
}

function assertUniqueHistoryIds(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label}存在重复记录，请刷新后重试。`);
  }
}

function malformedOfflineRevisionHistory(): never {
  throw new Error("线下修订记录格式不正确，请刷新后重试。");
}

function normalizeRevisionPreviewDownloadTicket(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("修订 PDF 下载票据格式不正确，请重试。");
  }
  const record = value as Record<string, unknown>;
  const fileName = requiredTicketText(record.fileName);
  const mimeType = requiredTicketText(record.mimeType);
  const expiresAt = requiredTicketText(record.expiresAt);
  if (
    !Number.isInteger(record.sizeBytes) ||
    Number(record.sizeBytes) < 0 ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    throw new Error("修订 PDF 下载票据格式不正确，请重试。");
  }
  return {
    fileName,
    mimeType,
    sizeBytes: Number(record.sizeBytes),
    expiresAt,
    downloadPath: normalizePrivateFileTicketPath(record.downloadUrl)
  };
}

function requiredTicketText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("修订 PDF 下载票据格式不正确，请重试。");
  }
  return value;
}

function normalizePrivateFileTicketPath(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/files/") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error("修订 PDF 下载票据地址不安全，请重试。");
  }
  const base = new URL("https://contract-preview.invalid");
  const parsed = new URL(value, base);
  if (
    parsed.origin !== base.origin ||
    !parsed.pathname.startsWith("/files/") ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("修订 PDF 下载票据地址不安全，请重试。");
  }
  return `${parsed.pathname}${parsed.search}`;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取合同磋商记录失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交合同磋商操作失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
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
    // 非 JSON 错误响应保留中文状态码兜底。
  }
  throw new Error(message);
}
