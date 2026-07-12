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
