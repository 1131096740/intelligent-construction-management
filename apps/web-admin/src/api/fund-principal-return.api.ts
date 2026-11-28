import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type PrincipalSourceKind = "advance_receipt" | "payment_advance" | "proxy_payment";
export type PrincipalReturnAction = "approve" | "reject" | "withdraw" | "reduce";
export interface PrincipalReturnPayment {
  id: string;
  amountYuan: string;
  paidOn: string;
  scopeKey: string;
  evidenceReference: string;
  sourceAllocations: Array<{ sourceBatchId: string; sourceLabel: string; amountYuan: string }>;
}
export interface PrincipalReturnApplication {
  id: string;
  status: "pending" | "approved" | "partially_paid" | "paid" | "rejected" | "withdrawn";
  requestedYuan: string;
  approvedYuan: string | null;
  paidYuan: string;
  revision: number;
  approvalInstanceId: string;
  canApprove: boolean;
  approvalDuties: Array<{ nodeIndex: number; roleKeys: string[]; requiresSelfPassword: boolean }>;
  canWithdraw: boolean;
  canReduce: boolean;
  canPay: boolean;
  payments: PrincipalReturnPayment[];
}
export interface PrincipalReturnSource {
  sourceKind: PrincipalSourceKind;
  sourceId: string;
  contributorName: string;
  delegatedOnly?: boolean;
  projectId: string | null;
  projectName: string | null;
  principalYuan: string | null;
  paidYuan: string | null;
  reservedYuan: string | null;
  availableYuan: string | null;
  canApply: boolean;
  applications: PrincipalReturnApplication[];
}

type ApplyInput = { sourceKind: PrincipalSourceKind; sourceId: string; amountYuan: string; reason: string };
type ActionInput = { action: PrincipalReturnAction; expectedRevision: number; nodeIndex?: number; reason: string; reducedYuan?: string };
type PayInput = {
  expectedRevision: number;
  scopeKey: string;
  expectedRegistrationId: string;
  paidOn: string;
  amountYuan: string;
  sourceAllocations: Array<{ sourceBatchId: string; amountYuan: string }>;
  evidenceReference: string;
};
export type PrincipalReturnCommand = { idempotencyKey: string } & (
  | { kind: "apply"; input: ApplyInput }
  | { kind: "act"; applicationId: string; requiresPassword: boolean; input: ActionInput }
  | { kind: "pay"; applicationId: string; input: PayInput }
);
export type PrincipalReturnReadModel = { items: PrincipalReturnSource[]; payableScopeKeys: string[] };
type ReturnResult = { idempotencyKey: string } & ({ status: "recorded"; applicationId: string; paymentId?: string } | { status: "unconfirmed" });
export class PrincipalReturnApiError extends Error {
  constructor(message: string, readonly rejected: boolean) { super(message); }
}

async function result<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
  throw new PrincipalReturnApiError(
    formatApiErrorMessage(typeof body?.message === "string" ? body.message : "", response.status, "垫资本金归还办理失败，请核对原回执"),
    [400, 403, 404].includes(response.status) || (response.status === 409 && body?.code === "REGISTERED_PRINCIPAL_RETURN_REJECTED"),
  );
}

export async function fetchPrincipalReturns(responseIsCurrent: () => boolean) {
  return result<PrincipalReturnReadModel>(await apiFetch("/fund-accounts/principal-returns", { responseIsCurrent }));
}

export async function fetchPrincipalReturnResult(key: string, responseIsCurrent: () => boolean) {
  return result<ReturnResult>(await apiFetch(`/fund-accounts/principal-returns/results/${encodeURIComponent(key)}`, { responseIsCurrent }));
}

export async function applyPrincipalReturn(command: Extract<PrincipalReturnCommand, { kind: "apply" }>, responseIsCurrent: () => boolean) {
  return result<ReturnResult>(await apiFetch("/fund-accounts/principal-returns/applications", {
    responseIsCurrent, method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command.input, idempotencyKey: command.idempotencyKey }),
  }));
}

export async function actOnPrincipalReturn(command: Extract<PrincipalReturnCommand, { kind: "act" }>, password: string, responseIsCurrent: () => boolean) {
  return result<ReturnResult>(await apiFetch(`/fund-accounts/principal-returns/applications/${encodeURIComponent(command.applicationId)}/actions`, {
    responseIsCurrent, method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command.input, idempotencyKey: command.idempotencyKey, confirmationPassword: password || undefined }),
  }));
}

export async function payPrincipalReturn(command: Extract<PrincipalReturnCommand, { kind: "pay" }>, password: string, responseIsCurrent: () => boolean) {
  return result<ReturnResult>(await apiFetch(`/fund-accounts/principal-returns/applications/${encodeURIComponent(command.applicationId)}/payments`, {
    responseIsCurrent, method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command.input, idempotencyKey: command.idempotencyKey, confirmationPassword: password || undefined }),
  }));
}
