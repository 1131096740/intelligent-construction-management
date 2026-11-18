import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

const transferStatuses = ["pending_receipt", "rejected_held", "received", "returned"] as const;
export type FundTransferStatus = typeof transferStatuses[number];
export type FundTransferAction = "confirm" | "reject" | "resubmit" | "return";
export interface FundTransferReceipt {
  id: string;
  revision: number;
  status: FundTransferStatus;
}
export interface FundTransfer extends FundTransferReceipt {
  sourceScopeKey: string;
  destinationScopeKey: string;
  amountYuan: string;
  transferredOn: string;
  evidenceReference: string;
  actions: Array<{ action: FundTransferAction | "register"; evidenceReference: string; createdAt: string }>;
  canReceive: boolean;
  canResolveRejection: boolean;
}
export interface FundTransferReadModel {
  canRegisterCash: boolean;
  canRegisterCompany: boolean;
  transfers: FundTransfer[];
}
export interface RegisterFundTransferInput {
  sourceScopeKey: string;
  destinationScopeKey: string;
  expectedRegistrationId: string;
  idempotencyKey: string;
  transferredOn: string;
  evidenceReference: string;
  lines: Array<{ sourceBatchId: string; amountYuan: string }>;
}
export interface ActOnFundTransferInput {
  idempotencyKey: string;
  expectedRevision: number;
  action: FundTransferAction;
  evidenceReference: string;
}

export class FundTransferApiError extends Error {
  constructor(message: string, readonly status: number, private readonly code?: string) {
    super(message);
  }

  get isSupersededCommand() {
    return this.status === 409 && this.code === "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED";
  }

  get isDefinitiveRejection() {
    return [400, 403, 404].includes(this.status) ||
      (this.status === 409 && this.code === "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE");
  }
}

async function result(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  const payload: unknown = await response.json().catch(() => null);
  const body = payload && typeof payload === "object" ? payload as { message?: unknown; statusCode?: unknown; code?: unknown } : {};
  const code = body.statusCode === response.status && typeof body.code === "string" ? body.code : undefined;
  throw new FundTransferApiError(
    formatApiErrorMessage(typeof body.message === "string" ? body.message : "", response.status, "转款办理失败，请核对原记录"),
    response.status, code
  );
}

export async function fetchFundAccountTransfers() {
  return result(await apiFetch("/fund-account-transfers")) as Promise<FundTransferReadModel>;
}

function receipt(value: unknown, expected: Partial<FundTransferReceipt>): FundTransferReceipt {
  if (!value || typeof value !== "object") throw new Error("转款回执尚未确认");
  const row = value as FundTransferReceipt;
  if (typeof row.id !== "string" || !row.id || !Number.isSafeInteger(row.revision) || row.revision < 1 || !transferStatuses.includes(row.status)
    || (expected.id !== undefined && row.id !== expected.id) || row.revision !== expected.revision || row.status !== expected.status) {
    throw new Error("转款回执尚未确认");
  }
  return row;
}

export async function registerFundAccountTransfer(input: RegisterFundTransferInput) {
  return receipt(await result(await apiFetch("/fund-account-transfers", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  })), { revision: 1, status: "pending_receipt" });
}

const actionStatus: Record<FundTransferAction, FundTransferStatus> = {
  confirm: "received", reject: "rejected_held", resubmit: "pending_receipt", return: "returned"
};

export async function actOnFundAccountTransfer(id: string, input: ActOnFundTransferInput) {
  return receipt(await result(await apiFetch(`/fund-account-transfers/${encodeURIComponent(id)}/actions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  })), { id, revision: input.expectedRevision + 1, status: actionStatus[input.action] });
}
