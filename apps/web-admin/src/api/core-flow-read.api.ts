import type {
  ContractDetailReadModel,
  PaymentDetailReadModel,
  SettlementDetailReadModel
} from "@jiangkong/shared-domain";

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function postJson<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

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

export interface ReviewPaymentApprovalPayload {
  decision: "approve" | "reject";
  approvedAmountCents?: number;
  reviewedByUserId?: string;
}

export interface RecordPaymentExecutionPayload {
  amountCents: number;
  paidAt: string;
  executedByUserId: string;
  voucherFileId: string;
}

export interface RecordPaymentFinancePayload {
  amountCents: number;
  occurredAt: string;
  createdByUserId: string;
}

export interface RecordPaymentPdfArchivePayload {
  fileId: string;
  archivedByUserId: string;
  templateKey?: string;
  departmentScope?: string;
}

export function reviewPaymentApproval(paymentId: string, body: ReviewPaymentApprovalPayload) {
  return postJson<unknown, ReviewPaymentApprovalPayload>(`/payments/${paymentId}/approval`, body);
}

export function recordPaymentExecution(paymentId: string, body: RecordPaymentExecutionPayload) {
  return postJson<unknown, RecordPaymentExecutionPayload>(`/payments/${paymentId}/executions`, body);
}

export function recordPaymentFinance(paymentId: string, body: RecordPaymentFinancePayload) {
  return postJson<unknown, RecordPaymentFinancePayload>(
    `/payments/${paymentId}/finance-records`,
    body
  );
}

export function recordPaymentPdfArchive(paymentId: string, body: RecordPaymentPdfArchivePayload) {
  return postJson<unknown, RecordPaymentPdfArchivePayload>(
    `/payments/${paymentId}/pdf-archive`,
    body
  );
}
