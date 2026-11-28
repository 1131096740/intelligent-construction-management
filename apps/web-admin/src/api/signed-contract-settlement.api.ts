import { apiFetch } from "./api-fetch";
import type { CreatePrivateFileDownloadTicketPayload, PrivateFileDownloadTicketReadModel } from "./core-flow-read.api";
import { formatApiErrorMessage } from "./error-message";

export type SignedContractKind = "downstream" | "outside_fact" | "upward";
export interface SignedContractOption {
  kind: SignedContractKind;
  id: string;
  label: string;
  relationship: "inside" | "outside" | "upward";
}
export interface SignedSettlementFile { fileId: string; originalName: string; mimeType: string }
export interface SignedSettlementRow {
  id: string;
  contractId: string;
  contractKind: SignedContractKind;
  number: string | null;
  amountYuan: string | null;
  state: "draft" | "pending_review" | "returned" | "confirmed";
  revision: number;
  reviewReason: string | null;
  attachments: SignedSettlementFile[];
  canUpdate: boolean;
  canReview: boolean;
  canReadAttachments: boolean;
  selfReview: boolean;
  duplicateNumber?: boolean;
}

export interface SignedSettlementDraft {
  contractId: string;
  contractKind: SignedContractKind;
  number: string;
  amountYuan: string;
  fileIds: string[];
}

const endpoint = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/signed-contract-settlements`;

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  const message = payload?.errors?.[0]?.message ?? payload?.message;
  throw new Error(formatApiErrorMessage(typeof message === "string" ? message : "", response.status, fallback));
}

async function readSettlementJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "办理结算失败");
  return response.json() as Promise<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message ?? payload?.message;
    throw new Error(formatApiErrorMessage(typeof message === "string" ? message : "", response.status, "办理结算失败"));
  }
  return payload as T;
}

export const fetchSignedSettlements = (projectId: string) => readSettlementJson<SignedSettlementRow[]>(endpoint(projectId));
export const fetchSignedSettlementContracts = (projectId: string) => readSettlementJson<SignedContractOption[]>(`${endpoint(projectId)}/contracts`);
export const fetchSignedSettlementOverview = (projectId: string, option: SignedContractOption) => {
  const query = new URLSearchParams({ contractKind: option.kind, contractId: option.id });
  return readSettlementJson<{ name: string; party: string; counterparty: string; confirmedYuan: string; canRegister: boolean }>(`${endpoint(projectId)}/contract-overview?${query}`);
};

export function uploadSignedSettlementFile(projectId: string, file: File) {
  const body = new FormData();
  body.append("file", file, file.name);
  return request<{ id: string; originalName: string; mimeType: string }>(`${endpoint(projectId)}/files`, { method: "POST", body });
}

export function saveSignedSettlement(projectId: string, draft: SignedSettlementDraft, existing?: SignedSettlementRow) {
  return existing
    ? request<SignedSettlementRow>(`${endpoint(projectId)}/${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, revision: existing.revision })
    })
    : request<SignedSettlementRow>(endpoint(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });
}

export const submitSignedSettlement = (projectId: string, row: SignedSettlementRow) =>
  request<SignedSettlementRow>(`${endpoint(projectId)}/${encodeURIComponent(row.id)}/submission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: row.revision })
  });

export const reviewSignedSettlement = (projectId: string, row: SignedSettlementRow, decision: "confirm" | "return", reason: string, confirmationPassword: string) =>
  request<SignedSettlementRow>(`${endpoint(projectId)}/${encodeURIComponent(row.id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: row.revision, decision, reason, ...(row.selfReview ? { confirmationPassword } : {}) })
  });


export async function readSignedSettlementAttachment(projectId: string, settlementId: string, fileId: string, input: CreatePrivateFileDownloadTicketPayload) {
  const path = `${endpoint(projectId)}/${encodeURIComponent(settlementId)}/attachments/${encodeURIComponent(fileId)}`;
  const file = await request<SignedSettlementFile>(path);
  const ticket = await request<PrivateFileDownloadTicketReadModel>(`${path}/download-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!ticket.downloadUrl.startsWith(`${path}/download?`) || ticket.downloadUrl.includes("\\")) {
    throw new Error("结算附件访问链接无效，请重新申请");
  }
  const response = await apiFetch(ticket.downloadUrl);
  if (!response.ok) throw new Error(formatApiErrorMessage("", response.status, "读取已签结算附件失败"));
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (mimeType !== file.mimeType || !["application/pdf", "image/png", "image/jpeg"].includes(mimeType)) {
    throw new Error("结算附件内容格式不符，请核对");
  }
  return { blob: await response.blob(), fileName: ticket.fileName, mimeType: file.mimeType };
}

export interface ConfirmedPaymentSettlement {
  id: string;
  number: string;
  amountYuan: string;
  confirmedAt: string;
  source: "legacy" | "signed_registration";
  attachmentFileIds: string[];
}

export function fetchSignedSettlementPaymentBasis(projectId: string, contractId: string) {
  const query = new URLSearchParams({ contractKind: "downstream", contractId });
  return readSettlementJson<{
    latestConfirmed: ConfirmedPaymentSettlement | null;
    confirmedHistory: ConfirmedPaymentSettlement[];
    contractAttachmentIds: string[];
    canReadSignedAttachments: boolean;
    confirmedYuan: string;
    paymentAgreementText: string | null;
    downstreamCapacity: {
      recordedPaidYuan: string;
      outstandingYuan: string;
      unoccupiedYuan: string;
      wholeCentLimit: string;
      advancePaidYuan: string;
      unsettledAdvanceYuan: string;
      overpayYuan: string;
      abnormalOverpayYuan: string;
      capacityShortfallYuan: string;
      suspended: boolean;
    } | null;
  }>(`${endpoint(projectId)}/payment-basis?${query}`);
}
