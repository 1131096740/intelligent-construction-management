import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type {
  ExpenseClaimDetailReadModel,
  ExpenseClaimListItemReadModel
} from "./expense-claim.api";

export type OtherProjectPaymentCategoryKey =
  | "temporary_service"
  | "temporary_machinery_shift"
  | "sporadic_labor"
  | "other_incidental";

export interface OtherProjectPaymentCategory {
  key: OtherProjectPaymentCategoryKey;
  label: string;
  costCategoryCode: string;
}

export interface OtherProjectPaymentEntryReadModel {
  key: string;
  name: string;
  description: string;
  claimType: "incidental_expense";
  requiresContract: boolean;
  requiresSettlement: boolean;
  costCountingRule: string;
  refundRule: string;
  correctRule: string;
  fields: Array<{ key: string; label: string; required: boolean; scope: string }>;
  approvalDutyRoleKeys: string[];
  approvalDutyLabels: string[];
  categories: OtherProjectPaymentCategory[];
  entryPath: string;
  voucherUploadPath: string;
  viewerUserId: string;
}

export interface OtherProjectPaymentCapacityReadModel {
  payableCents: string;
  fundedAmountCents: string;
  refundedCents: string;
  netPaidCents: string;
  remainingPayableCents: string;
  overpaidCents: string;
  status: string;
  costConfirmed: boolean;
}

export interface OtherProjectPaymentDetailReadModel extends ExpenseClaimDetailReadModel {
  fundsPermissions: ExpenseClaimDetailReadModel["fundsPermissions"] & {
    canRecordRefund?: boolean;
    canCorrectAmount?: boolean;
  };
  paymentCapacity?: OtherProjectPaymentCapacityReadModel;
  paymentRefunds?: Array<{
    id: string;
    expenseClaimPaymentExecutionId: string | null;
    amountCents: string;
    receivedAt: string;
    reason: string;
    evidenceReference: string | null;
    accountId: string | null;
    recordedByUserId: string;
    createdAt: string;
  }>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let message = `${fallback}：${response.status}`;
  try {
    const detail = await response.json();
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw Object.assign(new Error(message), { status: response.status });
}

export async function fetchOtherProjectPaymentEntry() {
  const response = await apiFetch("/other-project-payments/entry");
  await ensureOk(response, "读取其他项目付款入口失败");
  return response.json() as Promise<OtherProjectPaymentEntryReadModel>;
}

export async function fetchOtherProjectPayments(view?: string) {
  const query = view ? `?${new URLSearchParams({ view }).toString()}` : "";
  const response = await apiFetch(`/other-project-payments${query}`);
  await ensureOk(response, "读取其他项目付款台账失败");
  return response.json() as Promise<ExpenseClaimListItemReadModel[]>;
}

export async function fetchOtherProjectPaymentDetail(claimId: string) {
  const response = await apiFetch(`/other-project-payments/${encodeURIComponent(claimId)}`);
  await ensureOk(response, "读取其他项目付款详情失败");
  return response.json() as Promise<OtherProjectPaymentDetailReadModel>;
}
