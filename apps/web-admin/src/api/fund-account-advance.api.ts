import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface RegisterFundAdvanceInput {
  scopeKey: string;
  expectedRegistrationId: string;
  idempotencyKey: string;
  contributorKind: "company" | "construction_enterprise" | "person" | "other" | "unknown";
  contributorId?: string;
  contributorName?: string;
  projectId?: string;
  amountYuan: string;
  receivedOn: string;
  evidenceReference: string;
}

export interface FundAdvanceContributorOptions {
  companies: Array<{ id: string; name: string }>;
  constructionEnterprises: Array<{ id: string; name: string }>;
  canRegisterCompanyOwned: boolean;
}

export class FundAdvanceApiError extends Error {
  constructor(message: string, readonly definiteNoWrite: boolean) {
    super(message);
  }
}

async function result(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => null) as { statusCode?: unknown; code?: unknown; message?: unknown } | null;
  const definiteNoWrite = [400, 403, 404].includes(response.status) ||
    (response.status === 409 && body?.statusCode === 409 && body.code === "FUND_ACCOUNT_ADVANCE_REJECTED_NO_WRITE");
  throw new FundAdvanceApiError(
    formatApiErrorMessage(typeof body?.message === "string" ? body.message : "", response.status, "垫资到账办理失败，请核对原登记"),
    definiteNoWrite,
  );
}

export async function fetchFundAdvanceContributorOptions() {
  return result(await apiFetch("/fund-account-advance-receipts/contributor-options")) as Promise<FundAdvanceContributorOptions>;
}

export interface RegisterCompanyOwnedFundInput {
  scopeKey: string;
  expectedRegistrationId: string;
  idempotencyKey: string;
  observationReference: string;
  ownershipEvidence: string;
}

export async function fetchCompanyOwnedBankOptions(companyId: string) {
  return result(await apiFetch(`/fund-account-advance-receipts/company-owned-bank-options?${new URLSearchParams({ companyId })}`)) as
    Promise<Array<{ value: string; occurredOn: string; amountYuan: string }>>;
}

async function readAdvanceReceipt(response: Response, idempotencyKey: string) {
  const data = await result(response) as { id?: string; idempotencyKey?: string; registrationId?: string; sourceBatchId?: string } | null;
  if (!data?.id || !data.registrationId || !data.sourceBatchId || data.idempotencyKey !== idempotencyKey) {
    throw new Error("垫资到账回执尚未确认，请按原内容核对");
  }
  return data;
}

export async function registerFundAdvance(input: RegisterFundAdvanceInput) {
  return readAdvanceReceipt(await apiFetch("/fund-account-advance-receipts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }), input.idempotencyKey);
}

export async function registerCompanyOwnedFund(input: RegisterCompanyOwnedFundInput) {
  return readAdvanceReceipt(await apiFetch("/fund-account-advance-receipts/company-owned", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }), input.idempotencyKey);
}
