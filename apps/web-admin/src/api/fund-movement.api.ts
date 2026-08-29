import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type FundMovementKind =
  | "cross_project_payment"
  | "same_project_company_transfer"
  | "temporary_project_fund_use"
  | "temporary_project_fund_return"
  | "company_advance"
  | "company_advance_recovery"
  | "profit_distribution_execution";

export interface FundMovementListItem {
  id: string;
  kind: FundMovementKind;
  status: string;
  revision: number;
  sourceProjectId: string;
  beneficiaryProjectId: string;
  sourceCompanyEntityId: string;
  beneficiaryCompanyEntityId: string;
  paymentAmountCents: string;
  projectFundUsedCents: string;
  companyAdvanceCents: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  legs: Array<{
    id: string;
    legNo: number;
    role: string;
    projectId: string;
    operatingFactId: string | null;
  }>;
}

function errorMessage(response: Response, fallback: string) {
  return response.clone().json()
    .then((body: unknown) => {
      const message = body && typeof body === "object" && "message" in body
        ? (body as { message?: unknown }).message
        : undefined;
      const detail = typeof message === "string"
        ? message
        : Array.isArray(message)
          ? message.join("；")
          : `${fallback}：${response.status}`;
      return formatApiErrorMessage(detail, response.status, fallback);
    })
    .catch(() => formatApiErrorMessage(`${fallback}：${response.status}`, response.status, fallback));
}

export async function fetchFundMovements() {
  const response = await apiFetch("/fund-movements");
  if (response.ok) return response.json() as Promise<FundMovementListItem[]>;
  throw new Error(await errorMessage(response, "读取资金移动失败"));
}
