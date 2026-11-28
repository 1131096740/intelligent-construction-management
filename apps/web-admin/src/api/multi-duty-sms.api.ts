import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type { DutySmsStatus } from "./duty-sms.api";

export type MultiDutySmsDomain = "contracts" | "company-transfers" | "general-procurements" | "spot-procurements";

export interface MultiDutySmsNotice extends DutySmsStatus {
  dutyName: string;
}

function path(domain: MultiDutySmsDomain, businessId: string) {
  const resource = encodeURIComponent(businessId);
  if (domain === "contracts") return `/contracts/${resource}/duty-sms`;
  if (domain === "company-transfers") return `/company-transfers/${resource}/duty-sms`;
  if (domain === "general-procurements") return `/general-procurements/${resource}/duty-sms`;
  if (domain === "spot-procurements") return `/spot-procurements/${resource}/duty-sms`;
  throw new Error("短信待办业务类型无法核对");
}

export async function fetchMultiDutySms(domain: MultiDutySmsDomain, businessId: string): Promise<MultiDutySmsNotice[]> {
  const response = await apiFetch(path(domain, businessId));
  if (!response.ok) return [];
  return ((await response.json()) as { notices: MultiDutySmsNotice[] }).notices;
}

export async function retryMultiDutySms(domain: MultiDutySmsDomain, businessId: string, attemptId: string): Promise<MultiDutySmsNotice> {
  const response = await apiFetch(`${path(domain, businessId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    const fallback = "重试申请未能确认，请刷新状态";
    throw new Error(response.status >= 500 ? fallback :
      formatApiErrorMessage(typeof error?.message === "string" ? error.message : "", response.status, fallback));
  }
  return response.json() as Promise<MultiDutySmsNotice>;
}
