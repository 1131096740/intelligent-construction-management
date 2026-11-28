import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ActualPurchaseBatchLineInput {
  materialName: string;
  specification?: string | null;
  unit?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  amountCents?: string | null;
  note?: string | null;
}

export interface ActualPurchaseBatchPaymentView {
  id: string;
  paymentKind: "spot_procurement_payment" | "expense_claim";
  code: string;
  merchantName: string | null;
  requestedAmountCents: string;
  paidAmountCents: string;
  refundedAmountCents: string;
  status: string;
  executions: Array<{ id: string; amountCents: string; paidAt: string; refundableAmountCents: string }>;
}

export interface ActualPurchaseBatchView {
  id: string;
  kind: "spot_material" | "general";
  procurementId: string;
  supplierName: string;
  totalAmountCents: string;
  effectiveTotalAmountCents: string;
  status: string;
  costVersion: number;
  costConfirmedAt: string | null;
  note: string | null;
  lines: Array<{ id: string; materialName: string; specification: string | null; unit: string | null; quantity: string | null; unitPrice: string | null; amountCents: string | null }>;
  payments: ActualPurchaseBatchPaymentView[];
  capacity: {
    paidAmountCents: string;
    refundedAmountCents: string;
    netPaidAmountCents: string;
    outstandingCommittedAmountCents: string;
    availableAmountCents: string;
    payableNowAmountCents: string;
    overpaidAmountCents: string;
    suspended: boolean;
    suspendReason: string | null;
  };
  costContribution: {
    originalTotalAmountCents: string;
    effectiveTotalAmountCents: string;
    confirmedCostAmountCents: string;
    costVersion: number;
    note: string;
  };
  refunds: Array<{ id: string; executionType: string; executionId: string | null; paymentId: string | null; amountCents: string; receivedAt: string; reason: string; accountId: string | null }>;
  corrections: Array<{ id: string; status: string; originalTotalAmountCents: string; correctedTotalAmountCents: string; correctionDeltaCents: string; reason: string; requestedByUserId: string; confirmedByUserId: string | null; confirmedAt: string | null }>;
}

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: unknown };
    throw new Error(formatApiErrorMessage(typeof body.message === "string" ? body.message : "操作未完成", response.status, "实际采购批次操作未完成，请刷新后重试"));
  }
  return response.json() as Promise<T>;
}

export function listActualPurchaseBatches(procurementId: string) {
  return read<{ items: ActualPurchaseBatchView[] }>(`/actual-purchase-batches?procurementId=${encodeURIComponent(procurementId)}`);
}

export function fetchActualPurchaseBatch(batchId: string) {
  return read<ActualPurchaseBatchView>(`/actual-purchase-batches/${encodeURIComponent(batchId)}`);
}

export function createActualPurchaseBatch(input: {
  kind: "spot_material" | "general";
  procurementId: string;
  companyEntityId?: string | null;
  supplierName: string;
  totalAmountCents: string;
  note?: string | null;
  idempotencyKey: string;
  lines: ActualPurchaseBatchLineInput[];
}) {
  return read<ActualPurchaseBatchView>("/actual-purchase-batches", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function updateActualPurchaseBatch(batchId: string, input: {
  supplierName: string; totalAmountCents: string; note?: string | null; lines: ActualPurchaseBatchLineInput[];
}) {
  return read<ActualPurchaseBatchView>(`/actual-purchase-batches/${encodeURIComponent(batchId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function createActualPurchaseBatchSpotPayment(batchId: string, input: {
  requestedAmountCents: string;
  paymentType: "company_direct" | "handler_reimbursement";
  payeeName?: string | null;
  payeeAccountName?: string | null;
  payeeBankName?: string | null;
  payeeBankAccount?: string | null;
  paymentMethods: string[];
  channels: Array<{ channelType: string; accountName?: string | null; accountNumber?: string | null; bankName?: string | null; isPrimary: boolean }>;
  idempotencyKey: string;
}) {
  return read<{ id: string; code: string; status: string }>(`/actual-purchase-batches/${encodeURIComponent(batchId)}/spot-payments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function requestActualPurchaseBatchCorrection(batchId: string, input: {
  correctedTotalAmountCents: string; reason: string; idempotencyKey: string;
}) {
  return read<ActualPurchaseBatchView["corrections"][number]>(`/actual-purchase-batches/${encodeURIComponent(batchId)}/corrections`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function confirmActualPurchaseBatchCorrection(batchId: string, correctionId: string, input: {
  confirmationKey: string; reviewNote?: string | null; selfReviewReason?: string | null; confirmationPassword?: string | null;
}) {
  return read<ActualPurchaseBatchView["corrections"][number]>(`/actual-purchase-batches/${encodeURIComponent(batchId)}/corrections/${encodeURIComponent(correctionId)}/confirmation`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}

export function recordActualPurchaseBatchRefund(batchId: string, input: {
  executionType: "spot_procurement_payment_execution" | "expense_claim_payment_execution";
  executionId: string; amountCents: string; receivedAt: string; reason: string; accountId: string; evidenceReference?: string | null; idempotencyKey: string;
}) {
  return read<{ id: string; amountCents: string; replayed: boolean }>(`/actual-purchase-batches/${encodeURIComponent(batchId)}/refunds`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
}
