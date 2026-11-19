import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type DutySmsDomain =
  | "contract-bank-verifications"
  | "contract-economic-reviews"
  | "contract-proxy-executions"
  | "expense-claims"
  | "fund-account-transfers"
  | "fund-accounts/registrations"
  | "fund-accounts/principal-returns"
  | "payment-executions"
  | "payments"
  | "settlements"
  | "spot-procurement-payments"
  | "spot-procurements"
  | "upward-contract-amount-revisions"
  | "upward-receipt-matches";

export interface DutySmsStatus {
  attemptId: string;
  status: "queued" | "failed" | "unknown" | "accepted" | "cancelled";
  canRetry: boolean;
}

function path(domain: DutySmsDomain, id: string, dutyKey?: string) {
  const resource = encodeURIComponent(id);
  if (domain === "contract-bank-verifications") return `/contract-bank-verifications/${resource}/duty-sms`;
  if (domain === "contract-economic-reviews") return `/contract-economic-reviews/${resource}/duty-sms`;
  if (domain === "contract-proxy-executions") return `/contract-proxy-executions/${resource}/duty-sms`;
  if (domain === "expense-claims") return `/expense-claims/${resource}/duty-sms`;
  if (domain === "fund-account-transfers") return `/fund-account-transfers/${resource}/duty-sms`;
  if (domain === "fund-accounts/principal-returns") {
    if (!dutyKey || !/^(?:pay|review-[0-3])$/u.test(dutyKey)) throw new Error("当前归还申请职责无法确认");
    return `/fund-accounts/principal-returns/applications/${resource}/duty-sms/${dutyKey}`;
  }
  if (domain === "fund-accounts/registrations") return `/fund-accounts/registrations/${resource}/review/duty-sms`;
  if (domain === "payment-executions") return `/payment-executions/${resource}/duty-sms`;
  if (domain === "payments") return `/payments/${resource}/approval/duty-sms`;
  if (domain === "settlements") return `/settlements/${resource}/duty-sms`;
  if (domain === "spot-procurement-payments") return `/spot-procurement-payments/${resource}/duty-sms`;
  if (domain === "spot-procurements") return `/spot-procurements/${resource}/receipt/duty-sms`;
  if (domain === "upward-contract-amount-revisions") return `/upward-contract-amount-revisions/${resource}/duty-sms`;
  if (domain === "upward-receipt-matches") return `/upward-receipt-matches/${resource}/duty-sms`;
  throw new Error("短信待办业务类型无法核对");
}

export async function fetchDutySms(domain: DutySmsDomain, id: string, dutyKey?: string): Promise<DutySmsStatus | null> {
  const response = await apiFetch(path(domain, id, dutyKey));
  if (!response.ok) return null;
  return ((await response.json()) as { notice: DutySmsStatus | null }).notice;
}

export async function retryDutySms(domain: DutySmsDomain, id: string, attemptId: string, expectedApprovalInstanceId?: string, dutyKey?: string): Promise<DutySmsStatus> {
  if (domain === "fund-accounts/registrations" && !expectedApprovalInstanceId) {
    throw new Error("当前余额复核轮次无法确认，请刷新状态");
  }
  const body = domain === "fund-accounts/registrations" ? { attemptId, expectedApprovalInstanceId } : { attemptId };
  const response = await apiFetch(`${path(domain, id, dutyKey)}/retry`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    const fallback = "重试申请未能确认，请刷新状态";
    throw new Error(response.status >= 500 ? fallback :
      formatApiErrorMessage(typeof error?.message === "string" ? error.message : "", response.status, fallback));
  }
  return response.json() as Promise<DutySmsStatus>;
}
