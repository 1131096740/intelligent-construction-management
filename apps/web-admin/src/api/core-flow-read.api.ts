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

async function deleteJson<TResponse>(path: string): Promise<TResponse> {
  const response = await apiFetch(path, { method: "DELETE" });
  await ensureOk(response, "删除失败");
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
export interface CreatePaymentTermsStagePayload {
  name: string;
  basis:
    | "contract_amount"
    | "current_settlement"
    | "cumulative_settlement"
    | "fixed_amount"
    | "manual_amount";
  ratioBps?: number;
  fixedAmountCents?: number;
  triggerEvent: string;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
  retentionBps?: number;
  originalText: string;
}

export interface CreateContractPayload {
  projectId: string;
  code: string;
  name: string;
  counterparty: string;
  amountCents: number;
  paymentTermsOriginalText: string;
  paymentStages: CreatePaymentTermsStagePayload[];
}

export interface CreateContractReadModel {
  contract: { id: string; code: string };
  version: { id: string };
  terms: { id: string };
}

export interface CreateSettlementPayload {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  amountCents: number;
}

export interface CreateSettlementReadModel {
  id: string;
  code: string;
}

export interface CreatePaymentRequestPayload {
  settlementId: string;
  code: string;
  requestedAmountCents: number;
}

export interface CreatePaymentRequestReadModel {
  id: string;
  code: string;
}

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
  confirmationPassword: string;
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

export interface GeneratePaymentPdfArchivePayload {
  templateKey?: string;
  departmentScope?: string;
}

export interface UploadContractArchiveFilePayload {
  fileId: string;
}

export interface ConfirmContractArchivePayload {
  archiveFileId: string;
  confirmationPassword: string;
}

export interface UploadSettlementArchiveFilePayload {
  fileId: string;
}

export interface ConfirmSettlementArchivePayload {
  archiveFileId: string;
  confirmationPassword: string;
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

export interface PrivateFileDownloadTicketReadModel {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  downloadUrl: string;
}

export function uploadPrivateFile(file: Blob, fileName: string) {
  const form = new FormData();
  form.append("file", file, fileName);

  return postForm<PrivateFileReadModel>("/files", form);
}

export interface CreatePrivateFileDownloadTicketPayload {
  confirmationPassword: string;
}

export function createPrivateFileDownloadTicket(
  fileId: string,
  body: CreatePrivateFileDownloadTicketPayload
) {
  return postJson<PrivateFileDownloadTicketReadModel>(`/files/${fileId}/download-ticket`, body);
}

export function createContractDraft(body: CreateContractPayload) {
  return postJson<CreateContractReadModel>("/contracts", body);
}

export function createSettlementDraft(body: CreateSettlementPayload) {
  return postJson<CreateSettlementReadModel>("/settlements", body);
}

export function createPaymentRequest(body: CreatePaymentRequestPayload) {
  return postJson<CreatePaymentRequestReadModel>("/payments", body);
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

export function withdrawContractApproval(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-withdrawal`);
}

export function remindContractApproval(contractVersionId: string) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-reminder`);
}

export function transferContractApproval(
  contractVersionId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-transfer`, body);
}

export function delegateContractApproval(
  contractVersionId: string,
  body: AssignSettlementApprovalPayload
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/approval-delegation`, body);
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

export function remindSettlementApproval(settlementId: string) {
  return postJson<unknown>(`/settlements/${settlementId}/approval-reminder`);
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

export function withdrawPaymentApproval(paymentId: string) {
  return postJson<unknown>(`/payments/${paymentId}/approval-withdrawal`);
}

export function remindPaymentApproval(paymentId: string) {
  return postJson<unknown>(`/payments/${paymentId}/approval-reminder`);
}

export function transferPaymentApproval(paymentId: string, body: AssignSettlementApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval-transfer`, body);
}

export function delegatePaymentApproval(paymentId: string, body: AssignSettlementApprovalPayload) {
  return postJson<unknown>(`/payments/${paymentId}/approval-delegation`, body);
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

export function generatePaymentPdfArchive(
  paymentId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/payments/${paymentId}/pdf-generation`, body);
}

export function generateContractPdfArchive(
  contractVersionId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/contracts/${contractVersionId}/pdf-generation`, body);
}

export function generateSettlementPdfArchive(
  settlementId: string,
  body: GeneratePaymentPdfArchivePayload = {}
) {
  return postJson<unknown>(`/settlements/${settlementId}/pdf-generation`, body);
}

export interface ApprovalDelegationReadModel {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  createdAt: string;
}

export interface CreateApprovalDelegationPayload {
  toUserId: string;
  startsAt: string;
  endsAt: string;
}

export function listApprovalDelegations() {
  return readJson<ApprovalDelegationReadModel[]>("/approval-delegations");
}

export function createApprovalDelegation(body: CreateApprovalDelegationPayload) {
  return postJson<ApprovalDelegationReadModel>("/approval-delegations", body);
}

export function revokeApprovalDelegation(delegationId: string) {
  return deleteJson<ApprovalDelegationReadModel>(`/approval-delegations/${delegationId}`);
}
