import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface PayableSettlementCapabilities {
  read: boolean;
  allocate: boolean;
  submit: boolean;
  confirm: boolean;
  return: boolean;
  returnRelationship: boolean;
}

export interface WagePayableCaseOption {
  payableRef: string;
  caseRevision: number;
  displayLabel: string;
  debtorCompanyLabel: string;
  creditorLabel: string;
  status: "allocatable" | "over_settled_reconciliation_required";
  statusLabel: string;
  remainingAmountCents: string;
  overSettledAmountCents: string;
}

export interface PayableSettlementWorkbenchItem {
  settlementCaseId: string;
  status: string;
  statusLabel: string;
  revision: number;
  allocatedAmountCents: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface InterEntityRelationshipReadModel {
  relationshipEntryId: string;
  debtorLabel: string;
  creditorLabel: string;
  approvedPayerLabel: string;
  amountCents: string;
  remainingAmountCents: string;
  status: "open" | "returned";
  statusLabel: string;
}

export function fetchPayableSettlementWorkbench() {
  return read<PayableSettlementWorkbenchItem[]>(
    "/payable-settlements/workbench",
    "加载历史工资应付核销失败"
  );
}

export function fetchPayableSettlementCapabilities() {
  return read<PayableSettlementCapabilities>(
    "/payable-settlements/capabilities",
    "加载工资应付核销权限失败"
  );
}

export function fetchWagePayableCases() {
  return read<WagePayableCaseOption[]>(
    "/payable-settlements/wage-payable-cases",
    "加载历史工资应付案件失败"
  );
}

export function fetchInterEntityRelationships() {
  return read<InterEntityRelationshipReadModel[]>(
    "/payable-settlements/inter-entity-relationships",
    "加载跨主体代付往来失败"
  );
}

async function read<T>(path: string, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path), fallback);
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let detail = "";
  try {
    const body = await response.clone().json() as { message?: unknown };
    detail = Array.isArray(body.message)
      ? body.message.join("；")
      : typeof body.message === "string"
        ? body.message
        : "";
  } catch {
    detail = "";
  }
  throw new Error(formatApiErrorMessage(detail, response.status, fallback));
}
