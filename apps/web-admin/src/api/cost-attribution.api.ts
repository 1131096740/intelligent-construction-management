import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface CostAttributionCandidate {
  factId: string;
  expenseCashCostLinkId?: string;
  sourceType: string;
  sourceBusinessCode: string;
  occurredAt: string;
  amountCents: string;
  description: string | null;
  companyName: string;
  activeConfirmationId: string | null;
  activeStatus: string | null;
  cashEvidenceChanged?: boolean;
}

export interface CostAttributionConfirmation {
  id: string;
  factId: string;
  expenseCashCostLinkId?: string;
  attributedAmountCents?: string;
  factCode: string;
  status: string;
  statusLabel: string;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyName: string;
  reason: string;
  requestedByUserId: string;
  requestedAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  revision: number;
}

export interface CostAttributionPage {
  candidates: CostAttributionCandidate[];
  confirmations: CostAttributionConfirmation[];
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: unknown };
    throw new Error(
      formatApiErrorMessage(
        typeof body.message === "string" ? body.message : "读取成本归属失败",
        response.status,
        "读取成本归属失败"
      )
    );
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(
      formatApiErrorMessage(
        await response.text().catch(() => ""),
        response.status,
        "提交成本归属失败"
      )
    );
  }
  return response.json() as Promise<T>;
}

export function fetchCostAttributions(projectId: string) {
  return readJson<CostAttributionPage>(`/projects/${projectId}/cost-attributions`);
}

export function requestCostAttribution(
  projectId: string,
  factId: string,
  body: { companyEntityId: string; reason: string; idempotencyKey: string; expenseCashCostLinkId?: string }
) {
  return postJson<CostAttributionConfirmation>(
    `/projects/${projectId}/cost-attributions/${factId}`,
    body
  );
}

export function reviewCostAttribution(
  projectId: string,
  id: string,
  body: {
    decision: "confirm" | "return";
    revision: number;
    reason?: string;
    password?: string;
  }
) {
  return postJson<CostAttributionConfirmation>(
    `/projects/${projectId}/cost-attributions/${id}/review`,
    body
  );
}
