import type {
  ContractDetailReadModel,
  PaymentDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = data.message;
    } else if (Array.isArray(data.message)) {
      message = data.message.join("；");
    }
  } catch {
    // 响应体非 JSON，沿用兜底文案。
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

async function postForm<TResponse>(path: string, body: FormData): Promise<TResponse> {
  const response = await apiFetch(path, { method: "POST", body });
  await ensureOk(response, "上传失败");
  return response.json() as Promise<TResponse>;
}

export function fetchContractDetail(contractId: string) {
  return readJson<ContractDetailReadModel>(`/contracts/${contractId}`);
}

export function fetchSettlementDetail(settlementId: string) {
  return readJson<SettlementDetailReadModel>(`/settlements/${settlementId}`);
}

export function fetchPaymentDetail(paymentId: string) {
  return readJson<PaymentDetailReadModel>(`/payments/${paymentId}`);
}

// 操作人统一来自登录态（access token），写入负载不再携带 *ByUserId。
export interface ReviewPaymentApprovalPayload {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
}

export interface ReviewContractApprovalPayload {
  decision: "approve" | "reject";
}

export interface ReviewSettlementApprovalPayload {
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant";
}

export interface AssignSettlementApprovalPayload {
  toUserId: string;
}

export interface RecordPaymentExecutionPayload {
  amountCents: number;
  paidAt: string;
  voucherFileId: string;
}

export interface RecordPaymentFinancePayload {
  amountCents: number;
  occurredAt: string;
}

export interface RecordPaymentPdfArchivePayload {
  fileId: string;
  templateKey?: string;
  departmentScope?: string;
}

export interface UploadContractArchiveFilePayload {
  fileId: string;
}

export interface ConfirmContractArchivePayload {
  archiveFileId: string;
}

export interface UploadSettlementArchiveFilePayload {
  fileId: string;
}

export interface ConfirmSettlementArchivePayload {
  archiveFileId: string;
}

export interface PrivateFileReadModel {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export function uploadPrivateFile(file: Blob, fileName: string) {
  const form = new FormData();
  form.append("file", file, fileName);

  return postForm<PrivateFileReadModel>("/files", form);
}

export function uploadContractArchiveFile(
  contractVersionId: string,
  body: UploadContractArchiveFilePayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/archive-files`, body);
}

export function confirmContractArchive(
  contractVersionId: string,
  body: ConfirmContractArchivePayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/archive-confirmation`, body);
}

export function submitContractApproval(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-submission`);
}

export function reviewContractApproval(
  contractVersionId: string,
  body: ReviewContractApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval`, body);
}

export function approveContractSeal(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/seal-approval`);
}

export function uploadSettlementArchiveFile(
  settlementId: string,
  body: UploadSettlementArchiveFilePayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/archive-files`, body);
}

export function confirmSettlementArchive(
  settlementId: string,
  body: ConfirmSettlementArchivePayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/archive-confirmation`, body);
}

export function reviewSettlementApproval(
  settlementId: string,
  body: ReviewSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval`, body);
}

export function withdrawSettlementApproval(settlementId: string) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-withdrawal`);
}

export function transferSettlementApproval(
  settlementId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-transfer`, body);
}

export function delegateSettlementApproval(
  settlementId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-delegation`, body);
}

export function reviewPaymentApproval(paymentId: string, body: ReviewPaymentApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval`, body);
}

export function recordPaymentExecution(paymentId: string, body: RecordPaymentExecutionPayload) {
  return postJson<unknown>(`/payments/${paymentId}/executions`, body);
}

export function recordPaymentFinance(paymentId: string, body: RecordPaymentFinancePayload) {
  return postJson<unknown>(`/payments/${paymentId}/finance-records`, body);
}

export function recordPaymentPdfArchive(paymentId: string, body: RecordPaymentPdfArchivePayload) {
  return postJson<unknown>(`/payments/${paymentId}/pdf-archive`, body);
}
