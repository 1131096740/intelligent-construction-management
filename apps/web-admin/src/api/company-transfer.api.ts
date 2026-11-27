import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface TransferEvent { id: string; kind: string; amountCents: string; occurredAt: string; outgoingEventId: string | null; canReconcile: boolean; canRefund?: boolean; remainingCents: string }
export type TransferApprovalFlow = "proxy_repayment_parallel" | "standard";
export interface TransferApprovalDuty { nodeIndex: number; roleKeys: string[]; requiresSelfPassword: boolean }
export interface TransferRow { repaymentDebtorCompanyId?: string; repaymentDebtorCompany?: string; onBehalfRepayment?: boolean; canReadOriginalDebtCorrections?: boolean; originalSource?: string | null; approvalFlow?: TransferApprovalFlow; approvalDuties?: TransferApprovalDuty[]; approvalActions: Array<{ action: string; actorName: string; roleKey: string | null; at: string; comment: string | null; signed: boolean }>; originalReference: string | null; approvedAt: string | null; approvedByUserId: string | null; id: string; code: string; kind: string; kindLabel: string; sourceCompanyId: string; destinationCompanyId: string; sourceCompany: string; destinationCompany: string; sourceProjectId: string | null; destinationProjectId: string | null; sourceScope: string; destinationScope: string; sourceAccountLast4: string | null; destinationAccountLast4: string | null; amountCents: string; sentCents: string; receivedCents: string; returnedCents: string; inTransitCents: string; status: string; statusLabel: string; reason: string; evidenceFileId: string | null; canApprove: boolean; canWithdraw: boolean; canExecute: boolean; events: TransferEvent[] }
export interface TransferData {originalSourceFound?: boolean;canDecide:boolean;canExecute:boolean;canReadEvidence:boolean; legacyOptions: Array<{ approvalFlow?: TransferApprovalFlow; id: string; reference: string; legacyType: string; sourceCompanyId: string; destinationCompanyId: string; sourceProjectId: string; destinationProjectId: string; remainingCents: string; availableCents: string }>; asOf: string; page: number; pageSize: number; total: number; rows: TransferRow[]; projects: Array<{ id: string; name: string }>; companies: Array<{ id: string; name: string }>; payerCompanies?: Array<{ id: string; name: string }>; canCreate: boolean; canUseOwnFunds: boolean; originalLoans: Array<TransferRow & { remainingCents: string; availableCents: string }>; originalProxies: Array<{ approvalFlow?: TransferApprovalFlow; id: string; projectId: string; amountCents: string; source: { debtor: { id: string; name: string }; actualPayer: { id: string; name: string }; reference: string } }>; balances: Array<{ companyId: string; companyName: string; projectId: string | null; cashChangeCents: string; inTransitCents: string; receivableCents: string; payableCents: string; legacyReceivableCents?: string; legacyPayableCents?: string; onBehalfReceivableCents?: string; onBehalfPayableCents?: string }>; notice: string }
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path: string, body?: unknown): Promise<T> { const response = await apiFetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); const value = await response.json(); if (!response.ok) throw Object.assign(new Error(formatApiErrorMessage(value?.message, response.status, "公司互转办理失败")), { status: response.status, code: value?.code }); return value as T; }
export function fetchCompanyTransfers(query: Record<string, string>) { return read<TransferData>(`/company-transfers?${new URLSearchParams(query)}`); }
export function fetchCompanyTransfer(id: string) { return read<TransferRow>(`/company-transfers/${encodeURIComponent(id)}`); }
export function createCompanyTransfer(body: unknown) { return request<{ id: string }>("/company-transfers", body); }
export function decideCompanyTransfer(id: string, body: unknown) { return request(`/company-transfers/${encodeURIComponent(id)}/decision`, body); }
export function executeCompanyTransfer(id: string, body: unknown) { return request(`/company-transfers/${encodeURIComponent(id)}/events`, body); }
export function fetchCompanyTransferBanks(id: string, kind: string) { return read<Array<{ value: string; label: string }>>(`/company-transfers/${encodeURIComponent(id)}/banks?${new URLSearchParams({ kind })}`); }
export async function exportCompanyTransfers(query: Record<string, string>) { const response = await apiFetch(`/company-transfers/export?${new URLSearchParams(query)}`); if (!response.ok) { const value = await response.json(); throw new Error(formatApiErrorMessage(value?.message, response.status, "互转台账导出失败")); } const url = URL.createObjectURL(await response.blob()), a = document.createElement("a"); a.href = url; a.download = "公司互转台账.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function fetchCompanyTransferCapabilities(projectId: string, page: number, companyId: string, asOf: string, originalSource = "") { return read<TransferData>(`/company-transfers?${new URLSearchParams({page: String(page), ...(projectId ? {projectId} : {}), ...(companyId ? {companyId} : {}), ...(asOf ? {asOf} : {}), ...(originalSource ? {originalSource} : {})})}`); }

export interface TransferOriginalDebtCorrection {
  id: string;
  targetOriginalSource: string;
  targetReference?: string;
  reason: string;
  status: "pending" | "confirmed" | "superseded";
  requiresSelfReview: boolean;
  requestedAt: string;
  confirmedAt: string | null;
}
export interface TransferOriginalDebtCorrections {
  canRequest: boolean;
  canConfirm: boolean;
  originalSource: string;
  originalReference?: string;
  result?: { id: string; status: string };
  corrections: TransferOriginalDebtCorrection[];
  candidates: Array<{ originalSource: string; reference: string; availableCents: string }>;
}

export function fetchCompanyTransferOriginalDebtCorrections(id: string, eventId: string, idempotencyKey?: string) {
  const suffix = idempotencyKey ? `?${new URLSearchParams({ idempotencyKey })}` : "";
  return read<TransferOriginalDebtCorrections>(`/company-transfers/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/original-debt-corrections${suffix}`);
}
export function requestCompanyTransferOriginalDebtCorrection(
  id: string, eventId: string, body: { targetOriginalSource: string; reason: string; idempotencyKey: string },
) {
  return request<{ id: string; status: string }>(
    `/company-transfers/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/original-debt-corrections`, body,
  );
}
export function confirmCompanyTransferOriginalDebtCorrection(
  id: string, eventId: string, correctionId: string, body: { idempotencyKey: string; confirmationPassword: string; selfReviewReason?: string },
) {
  return request<{ id: string; status: string }>(
    `/company-transfers/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/original-debt-corrections/${encodeURIComponent(correctionId)}/confirm`, body,
  );
}
