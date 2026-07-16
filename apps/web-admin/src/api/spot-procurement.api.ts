import type {
  ApprovalTimelineItemReadModel,
  DetailActionReadModel,
  EvidenceFileReadModel,
  InvoiceMode,
  PaymentPath,
  RoleKey,
  SpotProcurementPaymentStatus,
  SpotProcurementStatus,
  VatInvoiceType
} from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type SpotProcurementVersionStatus =
  | "draft"
  | "approval_pending"
  | "approved"
  | "rejected"
  | "returned"
  | "withdrawn"
  | "invalidated";

export type SpotProcurementAttachmentCategory =
  | "merchant_quote"
  | "material_list"
  | "reference_photo"
  | "other";

export type SpotProcurementPaymentMethod =
  | "cash"
  | "wechat"
  | "alipay"
  | "bank_transfer"
  | "other";

export type SpotProcurementReviewDecision =
  | "approve"
  | "reject"
  | "return_to_applicant";

export interface SpotProcurementProjectSummary {
  id: string;
  code: string;
  name: string;
}

export interface SpotProcurementUserSummary {
  id: string;
  name: string;
}

export interface SpotProcurementApprovalSummary {
  status: string;
  statusLabel: string;
  currentNodeName: string;
  currentRoleKeys: RoleKey[];
}

export interface SpotProcurementFutureUnavailableReadModel {
  available: false;
  status: "not_available";
  label: string;
}

export interface SpotProcurementHandlerOptionReadModel {
  id: string;
  name: string;
  roleKeys: RoleKey[];
}

export interface SpotProcurementCapabilitiesReadModel {
  projectId: string;
  enabled: boolean;
  canCreate: boolean;
  canExecutePayment: boolean;
  unavailableReason: string | null;
  handlerOptions: SpotProcurementHandlerOptionReadModel[];
}

export interface VatRateOptionReadModel {
  id: string;
  label: string;
  rateValue: string;
  isEnabled?: boolean;
}

export type SpotProcurementInvoiceComposition =
  | "invoice"
  | "no_invoice"
  | "mixed"
  | "unknown";

export interface SpotProcurementPaymentSummaryReadModel {
  paymentCount: number;
  activeSettlementAmountCents: string;
  companyPaymentAmountCents: string;
  paidAmountCents: string;
  supplierBalanceAmountCents: string;
  executedSupplierBalanceAmountCents: string;
  canceledAmountCents: string;
  statusLabel: string;
  visibilityRestricted: boolean;
}

export interface SpotProcurementListItemReadModel {
  id: string;
  code: string;
  project: SpotProcurementProjectSummary;
  supplierPartyId: string | null;
  supplierName: string;
  reason: string;
  applicant: SpotProcurementUserSummary;
  handler: SpotProcurementUserSummary;
  approvedAmountCents: string;
  currentTotalAmountCents: string;
  actualCostCents: null;
  actualCost: SpotProcurementFutureUnavailableReadModel;
  invoiceComposition: SpotProcurementInvoiceComposition;
  payment: SpotProcurementPaymentSummaryReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel;
  invoiceCoverage: SpotProcurementFutureUnavailableReadModel;
  status: SpotProcurementStatus;
  statusLabel: string;
  approval: SpotProcurementApprovalSummary;
  createdAt: string;
  updatedAt: string;
}

export interface SpotProcurementListReadModel {
  items: SpotProcurementListItemReadModel[];
  truncated: boolean;
  limit: number;
}

export type SpotProcurementVoucherStatus = "none" | "complete" | "anomaly";

export interface SpotProcurementPaymentListItemReadModel {
  id: string;
  code: string;
  procurement: {
    id: string;
    code: string;
    supplierName: string;
  };
  project: SpotProcurementProjectSummary;
  paymentPath: PaymentPath | null;
  paymentPathLabel: string;
  payeeName: string;
  settlementAmountCents: string;
  supplierBalanceAmountCents: string;
  companyPaymentAmountCents: string;
  effectiveCompanyPaymentAmountCents: string;
  paidAmountCents: string;
  remainingCompanyPaymentAmountCents: string;
  executedSupplierBalanceAmountCents: string;
  canceledAmountCents: string;
  status: SpotProcurementPaymentStatus;
  statusLabel: string;
  companyPaymentStatusLabel: string;
  approval: SpotProcurementApprovalSummary;
  handler: SpotProcurementUserSummary;
  voucherStatus: SpotProcurementVoucherStatus;
  voucherStatusLabel: string;
  paymentFactConsistent: boolean;
  invoiceCoverage: SpotProcurementFutureUnavailableReadModel;
  createdAt: string;
  updatedAt: string;
}

export interface SpotProcurementPaymentListReadModel {
  items: SpotProcurementPaymentListItemReadModel[];
  truncated: boolean;
  limit: number;
}

export interface SpotProcurementVersionReadModel {
  id: string;
  versionNo: number;
  status: SpotProcurementVersionStatus;
  statusLabel: string;
  reason: string;
  note: string | null;
  supplierPartyId: string | null;
  supplierName: string;
  handlerUserId: string;
  totalAmountCents: string;
  changeReason: string | null;
  changeSummary: unknown;
  submittedAt: string | null;
  approvedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpotProcurementLineReadModel {
  id: string;
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  quantity: string;
  invoiceMode: InvoiceMode;
  invoiceType: VatInvoiceType | null;
  vatRateOptionId: string | null;
  vatRateValue: string | null;
  vatRateLabel: string | null;
  unitPrice: string;
  amountCents: string;
  usageLocation: string | null;
  note: string | null;
}

export interface SpotProcurementApprovalPdfReadModel {
  available: boolean;
  generated?: boolean;
  businessType: "spot_procurement_version" | "spot_procurement_payment";
  businessId: string;
  disabledReason: string | null;
}

export interface SpotProcurementDetailReadModel {
  procurement: {
    id: string;
    code: string;
    project: SpotProcurementProjectSummary;
    supplierPartyId: string | null;
    supplierName: string;
    applicant: SpotProcurementUserSummary;
    handler: SpotProcurementUserSummary;
    status: SpotProcurementStatus;
    statusLabel: string;
    approvedAmountCents: string;
    actualCostCents: null;
    actualCost: SpotProcurementFutureUnavailableReadModel;
    closedAt: string | null;
    voidedAt: string | null;
    voidReason: string | null;
    createdAt: string;
    updatedAt: string;
  };
  currentVersion: SpotProcurementVersionReadModel;
  versions: SpotProcurementVersionReadModel[];
  lines: SpotProcurementLineReadModel[];
  invoiceComposition: SpotProcurementInvoiceComposition;
  attachments: EvidenceFileReadModel[];
  approval: SpotProcurementApprovalSummary;
  approvalTimeline: ApprovalTimelineItemReadModel[];
  payments: SpotProcurementPaymentListItemReadModel[];
  paymentSummary: SpotProcurementPaymentSummaryReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel;
  invoiceCoverage: SpotProcurementFutureUnavailableReadModel;
  discrepancy: SpotProcurementFutureUnavailableReadModel;
  applicationPdf: SpotProcurementApprovalPdfReadModel;
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
}

export interface SpotProcurementPaymentExecutionReadModel {
  id: string;
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentMethodLabel: string;
  executedBy: SpotProcurementUserSummary;
  voucherFileId: string;
  voucherFileName: string;
  voidedAt: string | null;
  voidReason: string | null;
  active: boolean;
}

export interface SpotProcurementPaymentDetailReadModel {
  payment: {
    id: string;
    code: string;
    status: SpotProcurementPaymentStatus;
    statusLabel: string;
    project: SpotProcurementProjectSummary;
    procurement: {
      id: string;
      code: string;
      supplierName: string;
    };
    procurementVersionId: string;
    settlementAmountCents: string;
    supplierBalanceAmountCents: string;
    companyPaymentAmountCents: string;
    effectiveCompanyPaymentAmountCents: string;
    paidAmountCents: string;
    remainingCompanyPaymentAmountCents: string;
    paymentFactConsistent: boolean;
    voucherStatus: SpotProcurementVoucherStatus;
    voucherStatusLabel: string;
    executedSupplierBalanceAmountCents: string;
    canceledAmountCents: string;
    canceledCompanyPaymentAmountCents: string;
    canceledSupplierBalanceAmountCents: string;
    paymentPath: PaymentPath | null;
    paymentPathLabel: string;
    paymentMethod: SpotProcurementPaymentMethod | null;
    paymentMethodLabel: string;
    payeeName: string;
    payeeAccountName: string | null;
    payeeBankName: string | null;
    payeeBankAccountLast4: string | null;
    expectedPaymentAt: string | null;
    paymentNote: string | null;
    balanceOverrideReason: string | null;
    handler: SpotProcurementUserSummary;
    submittedAt: string | null;
    approvedAt: string | null;
    invalidatedAt: string | null;
    invalidatedReason: string | null;
    createdAt: string;
    updatedAt: string;
  };
  procurementVersion: SpotProcurementVersionReadModel;
  approval: SpotProcurementApprovalSummary;
  approvalTimeline: ApprovalTimelineItemReadModel[];
  composition: {
    settlementAmountCents: string;
    supplierBalanceAmountCents: string;
    companyPaymentAmountCents: string;
  };
  companyPayment: {
    status: SpotProcurementPaymentStatus;
    statusLabel: string;
    approvedAmountCents: string;
    paidAmountCents: string;
    remainingAmountCents: string;
    paymentFactConsistent: boolean;
    voucherStatus: SpotProcurementVoucherStatus;
    voucherStatusLabel: string;
  };
  balanceExecution: {
    requestedAmountCents: string;
    executedAmountCents: string;
    reservationStatus: string | null;
  };
  executions: SpotProcurementPaymentExecutionReadModel[];
  evidenceFiles: EvidenceFileReadModel[];
  invoiceCoverage: SpotProcurementFutureUnavailableReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel;
  paymentPdf: SpotProcurementApprovalPdfReadModel;
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
}

export interface SpotProcurementListQuery {
  projectId?: string;
  status?: SpotProcurementStatus;
  keyword?: string;
}

export interface SpotProcurementPaymentListQuery {
  projectId?: string;
  status?: SpotProcurementPaymentStatus;
  keyword?: string;
}

export interface SpotProcurementLinePayload {
  materialName: string;
  specification?: string;
  unit: string;
  quantity: string;
  invoiceMode: InvoiceMode;
  invoiceType?: VatInvoiceType;
  vatRateOptionId?: string;
  unitPrice: string;
  usageLocation?: string;
  note?: string;
  amountCents?: string;
}

export interface SpotProcurementAttachmentPayload {
  fileId: string;
  category: SpotProcurementAttachmentCategory;
}

export interface SpotProcurementDraftPayload {
  supplierPartyId?: string | null;
  supplierName: string;
  handlerUserId?: string;
  reason: string;
  note?: string | null;
  lines: SpotProcurementLinePayload[];
  attachments?: SpotProcurementAttachmentPayload[];
  totalAmountCents?: string;
}

export interface CreateSpotProcurementDraftPayload
  extends SpotProcurementDraftPayload {
  projectId: string;
  code: string;
}

export interface CreateSpotProcurementVersionPayload extends SpotProcurementDraftPayload {
  changeReason: string;
}

export interface ReviewSpotProcurementPayload {
  decision: SpotProcurementReviewDecision;
  comment?: string;
}

export interface ReviewSpotProcurementPaymentPayload
  extends ReviewSpotProcurementPayload {
  adjustedSupplierBalanceAmountCents?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface VoidSpotProcurementPayload {
  reason: string;
}

export interface UpdateSpotProcurementPaymentDraftPayload {
  settlementAmountCents?: string;
  supplierBalanceAmountCents?: string;
  companyPaymentAmountCents?: string;
  paymentPath?: PaymentPath | null;
  paymentMethod?: SpotProcurementPaymentMethod | null;
  payeeAccountName?: string | null;
  payeeBankName?: string | null;
  payeeBankAccount?: string | null;
  expectedPaymentAt?: string | null;
  paymentNote?: string | null;
  supportingAttachmentFileId?: string | null;
  merchantPaymentProofFileId?: string | null;
}

export interface RecordSpotProcurementPaymentExecutionPayload {
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  voucherFileId: string;
  idempotencyKey: string;
  confirmationPassword: string;
}

export interface SpotProcurementWriteReadModel {
  procurementId: string;
  projectId: string;
  status: SpotProcurementStatus;
  currentVersionId: string;
  versionId: string;
  versionNo: number;
  versionStatus: SpotProcurementVersionStatus;
  totalAmountCents: string;
}

export interface SpotProcurementPaymentWriteReadModel {
  id: string;
  code: string;
  status: SpotProcurementPaymentStatus;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  settlementAmountCents: string;
  supplierBalanceAmountCents: string;
  companyPaymentAmountCents: string;
  paidAmountCents: string;
  executedSupplierBalanceAmountCents: string;
  handlerUserId: string;
  paymentPath: PaymentPath | null;
  payeePartyId: string | null;
  payeeUserId: string | null;
  payeeNameSnapshot: string;
  balanceOverrideReason: string | null;
  availableBalanceAmountCents?: string;
  suggestedBalanceAmountCents?: string;
  newDraftPaymentId?: string;
}

export interface SpotProcurementPaymentExecutionWriteReadModel {
  execution: {
    id: string;
    amountCents: string;
    paidAt: string;
    paymentMethod: SpotProcurementPaymentMethod;
    voucherFileId: string;
    idempotencyKey: string;
  };
  payment: {
    id: string;
    status: SpotProcurementPaymentStatus;
    paidAmountCents: string;
    remainingCompanyPaymentAmountCents: string;
  };
}

export function fetchSpotProcurementCapabilities(projectId: string) {
  return readJson<SpotProcurementCapabilitiesReadModel>(
    `/spot-procurements/capabilities?projectId=${encodeURIComponent(projectId)}`
  );
}

export function fetchSpotProcurements(query: SpotProcurementListQuery = {}) {
  return readJson<SpotProcurementListReadModel>(
    withQuery("/spot-procurements", query)
  );
}

export function fetchSpotProcurementDetail(procurementId: string) {
  return readJson<SpotProcurementDetailReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}`
  );
}

export function fetchSpotProcurementPayments(
  query: SpotProcurementPaymentListQuery = {}
) {
  return readJson<SpotProcurementPaymentListReadModel>(
    withQuery("/spot-procurement-payments", query)
  );
}

export function fetchSpotProcurementPaymentDetail(paymentId: string) {
  return readJson<SpotProcurementPaymentDetailReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}`
  );
}

export async function fetchVatRateOptions(): Promise<VatRateOptionReadModel[]> {
  const options = await readJson<
    Array<{
      id: string;
      label: string;
      rateValue: string;
      enabled?: boolean;
    }>
  >("/vat-rate-options");
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    rateValue: option.rateValue,
    ...(option.enabled === undefined ? {} : { isEnabled: option.enabled })
  }));
}

export function createSpotProcurementDraft(
  body: CreateSpotProcurementDraftPayload
) {
  return postJson<SpotProcurementWriteReadModel>("/spot-procurements", body);
}

export function updateSpotProcurementDraft(
  procurementId: string,
  body: SpotProcurementDraftPayload
) {
  return patchJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/draft`,
    body
  );
}

export function createSpotProcurementVersion(
  procurementId: string,
  body: CreateSpotProcurementVersionPayload
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/versions`,
    body
  );
}

export function submitSpotProcurement(procurementId: string) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/submission`
  );
}

export function reviewSpotProcurement(
  procurementId: string,
  body: ReviewSpotProcurementPayload
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/approval`,
    body
  );
}

export function withdrawSpotProcurement(procurementId: string) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/approval-withdrawal`
  );
}

export function voidSpotProcurement(
  procurementId: string,
  body: VoidSpotProcurementPayload
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/voiding`,
    body
  );
}

export function createSpotProcurementPaymentDraft(procurementId: string) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/payments`
  );
}

export function updateSpotProcurementPaymentDraft(
  paymentId: string,
  body: UpdateSpotProcurementPaymentDraftPayload
) {
  return patchJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/draft`,
    body
  );
}

export function submitSpotProcurementPayment(paymentId: string) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/submission`
  );
}

export function reviewSpotProcurementPayment(
  paymentId: string,
  body: ReviewSpotProcurementPaymentPayload
) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/approval`,
    body
  );
}

export function withdrawSpotProcurementPayment(paymentId: string) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/approval-withdrawal`
  );
}

export function voidSpotProcurementPayment(
  paymentId: string,
  body: VoidSpotProcurementPayload
) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/voiding`,
    body
  );
}

export function recordSpotProcurementPaymentExecution(
  paymentId: string,
  body: RecordSpotProcurementPaymentExecutionPayload
) {
  return postJson<SpotProcurementPaymentExecutionWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/executions`,
    body
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取零星采购数据失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return writeJson<T>(path, "POST", body);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return writeJson<T>(path, "PATCH", body);
}

async function writeJson<T>(
  path: string,
  method: "POST" | "PATCH",
  body?: unknown
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  await ensureOk(response, "提交零星采购操作失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;

  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    if (typeof data.message === "string") {
      message = formatApiErrorMessage(data.message, response.status, fallback);
    } else if (Array.isArray(data.message)) {
      message = formatApiErrorMessage(
        data.message.join("；"),
        response.status,
        fallback
      );
    }
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new Error(message);
}

function withQuery(
  path: string,
  query: {
    projectId?: string;
    status?: string;
    keyword?: string;
  }
): string {
  const search = new URLSearchParams();
  appendTrimmed(search, "projectId", query.projectId);
  appendTrimmed(search, "status", query.status);
  appendTrimmed(search, "keyword", query.keyword);
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

function appendTrimmed(
  search: URLSearchParams,
  key: string,
  value: string | undefined
): void {
  const normalized = value?.trim();
  if (normalized) search.append(key, normalized);
}
