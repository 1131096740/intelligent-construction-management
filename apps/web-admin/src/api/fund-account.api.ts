import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface FundAccountSource {
  id?: string;
  amountYuan: string;
  sourceStatus: "pending" | "known";
  sourceName: string | null;
  projectStatus: "pending" | "project" | "company_daily";
  projectId: string | null;
  previousSourceBatchId?: string | null;
}
export interface FundBalanceRegistration {
  id: string;
  approvalInstanceId: string | null;
  account?: FundAccount;
  projects?: Array<{ id: string; name: string }>;
  approvalEvidence?: Array<{ actorUserId: string; representedUserId: string | null; action: string; signed: boolean; signatureVersionId: string | null; signedAt: string; metadata: Record<string, unknown> | null }>;
  version: number;
  kind: "opening" | "correction";
  status: "confirmed" | "pending_review" | "returned" | "withdrawn";
  previousRegistrationId: string | null;
  balanceYuan: string | null;
  asOfDate: string;
  evidenceReference: string;
  reconciliationNote: string;
  reason: string;
  reviewNote: string | null;
  createdByName?: string;
  confirmedByName?: string | null;
  confirmedAt?: string | null;
  pendingConfiguration?: boolean;
  requiresSelfPassword?: boolean;
  canConfirm?: boolean;
  canWithdraw?: boolean;
  closedByName?: string | null;
  closeReason?: string | null;
  closedAt?: string | null;
  sources: FundAccountSource[];
}
export interface FundAccount {
  scopeKey: string;
  name: string;
  kind: "company" | "public_cash";
  active: boolean;
  companyEntityId: string | null;
  balanceYuan: string | null;
  currentRegistrationId: string | null;
  asOfDate: string | null;
  custodianLabel: string;
  sources: FundAccountSource[];
  projectBalances: Array<Pick<FundAccountSource, "projectStatus" | "projectId" | "amountYuan">>;
  history: FundBalanceRegistration[];
  canRegisterBalance: boolean;
  canRegisterOpening: boolean;
  canRequestCorrection: boolean;
  canReview: boolean;
}
export interface FundAccountsReadModel { accounts: FundAccount[]; projects: Array<{ id: string; name: string }>; notice: string }
export interface FundReviewCommandInput { expectedApprovalInstanceId: string; idempotencyKey: string; reviewNote: string; selfReviewReason?: string; confirmationPassword?: string }
export interface RegisterFundBalanceInput {
  scopeKey: string;
  balanceYuan: string | null;
  asOfDate: string;
  evidenceReference: string;
  reconciliationNote: string;
  reason: string;
  idempotencyKey: string;
  sources: FundAccountSource[];
  previousRegistrationId?: string;
}
async function result<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let message = "资金账户读取或登记失败，请保留输入后重试";
  try { const result = await response.json() as { message?: unknown; errors?: unknown[] }; message = [typeof result.message === "string" ? result.message : "", ...(result.errors ?? []).filter((error): error is string => typeof error === "string")].filter(Boolean).join("；") || message; } catch { /* Keep the Chinese fallback. */ }
  throw new Error(formatApiErrorMessage(message, response.status, "资金账户办理失败"));
}
export async function fetchFundAccounts() { return result<FundAccountsReadModel>(await apiFetch("/fund-accounts")); }
export async function registerFundOpening(input: RegisterFundBalanceInput) { return result<FundBalanceRegistration>(await apiFetch("/fund-accounts/openings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function requestFundCorrection(input: RegisterFundBalanceInput) { return result<FundBalanceRegistration>(await apiFetch("/fund-accounts/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function confirmFundCorrection(id: string, input: FundReviewCommandInput) { return result<FundBalanceRegistration>(await apiFetch(`/fund-accounts/registrations/${encodeURIComponent(id)}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function fetchFundAccount(scopeKey: string) { return result<FundAccount>(await apiFetch(`/fund-accounts/${encodeURIComponent(scopeKey)}`)); }
export async function fetchFundBalanceRegistration(id: string) { return result<FundBalanceRegistration>(await apiFetch(`/fund-accounts/registrations/${encodeURIComponent(id)}`)); }
export async function returnFundCorrection(id: string, input: FundReviewCommandInput) { return result<FundBalanceRegistration>(await apiFetch(`/fund-accounts/registrations/${encodeURIComponent(id)}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function withdrawFundCorrection(id: string, input: FundReviewCommandInput) { return result<FundBalanceRegistration>(await apiFetch(`/fund-accounts/registrations/${encodeURIComponent(id)}/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); }
export async function fetchFundReview(id: string) { return result<FundBalanceRegistration>(await apiFetch(`/fund-accounts/registrations/${encodeURIComponent(id)}/review`)); }
