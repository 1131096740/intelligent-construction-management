import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type SettlementRecoveryEntryType = "refund" | "offset" | "reversal";

export interface SettlementRecoveryBalanceReadModel {
  id: string;
  settlementId: string;
  projectId: string;
  contractId: string;
  originalAmountCents: string;
  resolvedAmountCents: string;
  outstandingAmountCents: string;
  status: "open" | "partially_resolved" | "resolved";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementRecoveryEntryReadModel {
  id: string;
  balanceId: string;
  entryType: SettlementRecoveryEntryType;
  amountCents: string;
  occurredAt: string;
  relatedPaymentId: string | null;
  evidenceFileId: string;
  reason: string;
  recordedByUserId: string;
  idempotencyKey: string;
  reversalOfEntryId: string | null;
  createdAt: string;
}

export interface SettlementRecoveryReadModel {
  balance: SettlementRecoveryBalanceReadModel;
  entries: SettlementRecoveryEntryReadModel[];
}

export interface RecordSettlementRecoveryPayload {
  entryType: "refund" | "offset";
  amountCents: string;
  occurredOn: string;
  relatedPaymentId?: string;
  evidenceFileId: string;
  reason: string;
  idempotencyKey: string;
  confirmationPassword: string;
}

export interface ReverseSettlementRecoveryPayload {
  evidenceFileId: string;
  reason: string;
  idempotencyKey: string;
  confirmationPassword: string;
}

export function fetchSettlementRecovery(settlementId: string) {
  return request<SettlementRecoveryReadModel | null>(
    `/settlements/${encodeURIComponent(settlementId)}/recovery`,
    { method: "GET" },
    "读取结算回收台账失败"
  );
}

export function recordSettlementRecovery(settlementId: string, body: RecordSettlementRecoveryPayload) {
  return request<{ balance: SettlementRecoveryBalanceReadModel; entry: SettlementRecoveryEntryReadModel }>(
    `/settlements/${encodeURIComponent(settlementId)}/recovery-entries`,
    jsonPost(body),
    "登记结算回收失败"
  );
}

export function reverseSettlementRecovery(
  settlementId: string,
  entryId: string,
  body: ReverseSettlementRecoveryPayload
) {
  return request<{ balance: SettlementRecoveryBalanceReadModel; entry: SettlementRecoveryEntryReadModel }>(
    `/settlements/${encodeURIComponent(settlementId)}/recovery-entries/${encodeURIComponent(entryId)}/reversal`,
    jsonPost(body),
    "登记反向更正失败"
  );
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await apiFetch(path, init);
  if (response.ok) return response.json() as Promise<T>;

  let message = `${fallback}：${response.status}`;
  try {
    const body = await response.clone().json() as { message?: unknown };
    const detail = typeof body.message === "string"
      ? body.message
      : Array.isArray(body.message)
        ? body.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new Error(message);
}
