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

export class SpotProcurementApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SpotProcurementApiError";
    this.status = status;
    this.code = code;
  }
}

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

export type SpotProcurementA5ReviewDecision =
  | "approve"
  | "return_to_applicant";

export interface SpotProcurementProjectSummary {
  id: string;
  code: string;
  name: string;
}

export interface SpotProcurementCreateProjectOptionReadModel {
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

export interface SpotProcurementReviewApprovalContext {
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
}

export interface SpotProcurementWithdrawApprovalContext {
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
}

export interface SpotProcurementFutureUnavailableReadModel {
  available: false;
  status: "not_available";
  label: string;
}

export interface SpotProcurementInvoiceCoverageReadModel {
  available: boolean;
  status: string;
  label: string;
  actualCostCents: string;
  normalInvoiceCents: string;
  confirmedNoInvoiceCents: string;
  confirmedExceptionCents: string;
  effectiveCoveredCents: string;
  remainingCents: string;
  pendingCount: number;
  inconsistent: boolean;
}

export interface SpotProcurementInvoiceLedgerReadModel {
  available: boolean;
  currentCoordinates: unknown;
  invoices: Array<Record<string, unknown> & { id: string; fileId: string; status: string }>;
  allocations: Array<Record<string, unknown> & { id: string; amountCents: string; status: string }>;
  noInvoiceConfirmations: Array<Record<string, unknown> & { id: string; amountCents: string; status: string; reason: string }>;
  invoiceExceptions: Array<Record<string, unknown> & { id: string; amountCents: string; status: string; reason: string }>;
}

export interface SpotProcurementReceiptDetailReadModel {
  receipt: {
    id: string;
    projectId: string;
    procurementId: string;
    procurementCode: string;
    procurementVersionId: string;
    procurementVersionNo: number;
    procurementVersionStatus: string;
    status: string;
    currentRevisionNo: number;
    receiptOpen: boolean;
    firstActualPayment: { executionId: string; paidAt: string } | null;
    blockedReason: string | null;
    handler: SpotProcurementUserSummary;
    note: string | null;
    actualCostCents: string;
    firstSubmittedAt: string | null;
    submittedAt: string | null;
    submittedBy: SpotProcurementUserSummary | null;
    lockedAt: string | null;
  };
  delegation: null | {
    id: string;
    delegatorUserId: string;
    delegateUserId: string;
    delegateName: string;
    delegatedAt: string;
  };
  latestPdf: null | { documentId: string; fileId: string; templateKey: string; createdAt: string };
  lines: SpotProcurementReceiptLineReadModel[];
  photos: SpotProcurementReceiptPhotoReadModel[];
  reviews: SpotProcurementReceiptReviewReadModel[];
  discrepancy: {
    id?: string;
    status: string;
    resolutionType?: "replenishment" | "full_refund";
    replenishedAt?: string | null;
    refundExpectedAmountCents?: string;
    resolvedAt?: string | null;
    nextStep: string | null;
  };
  availableActions: DetailActionReadModel[];
  removablePhotoIds: string[];
}

export interface SpotProcurementInvoiceAppendActionContext {
  procurementId: string;
  paymentId: string;
  file: Blob;
  fileName: string;
  uploadIdempotencyKey: string;
}

export interface ExecuteSpotProcurementInvoiceAppendInput<
  TContext extends SpotProcurementInvoiceAppendActionContext =
    SpotProcurementInvoiceAppendActionContext
> {
  capture: () => TContext | null;
  upload: (
    file: Blob,
    fileName: string,
    idempotencyKey: string
  ) => Promise<{ id: string }>;
  current: (
    context: TContext,
    freshReceipt?: SpotProcurementReceiptDetailReadModel,
    freshPayment?: SpotProcurementPaymentDetailReadModel
  ) => boolean;
  stale: (context: TContext) => void | Promise<void>;
  complete: (context: TContext) => void | Promise<void>;
  completionFail: (
    context: TContext,
    error: unknown
  ) => void | Promise<void>;
  fail: (context: TContext, error: unknown) => void | Promise<void>;
  finish: (context: TContext) => void;
}

export type ExecuteSpotProcurementInvoiceAppendResult<
  TContext extends SpotProcurementInvoiceAppendActionContext =
    SpotProcurementInvoiceAppendActionContext
> =
  | { status: "not_started" }
  | { status: "stale"; context: TContext }
  | { status: "completed"; context: TContext }
  | { status: "completed_detached"; context: TContext }
  | { status: "completed_with_refresh_error"; context: TContext }
  | { status: "failed"; context: TContext };

export interface SpotProcurementReceiptLineReadModel {
  procurementLineId: string;
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  approvedQuantity: string;
  frozenUnitPrice: string;
  qualifiedQuantity: string | null;
  unqualifiedQuantity: string | null;
  unqualifiedReason: string | null;
  freeGiftQuantity: string | null;
  replenishmentPending: boolean | null;
  discrepancyNote: string | null;
  actualCostCents: string | null;
}

export interface SpotProcurementReceiptPhotoReadModel {
  id: string;
  watermarkedFileId: string;
  primaryFileId: string;
  source: "camera" | "album";
  category: "material_scene" | "delivery_note";
  note: string | null;
  appendReason: string | null;
  uploadedByUserId: string;
  serverRecordedAt: string;
  locked: boolean;
}

export interface SpotProcurementReceiptReviewReadModel {
  id: string;
  sequenceNo: number;
  receiptRevisionNo: number;
  decision: "approved" | "returned" | "revoked";
  comment: string | null;
  reviewedBy: SpotProcurementUserSummary;
  submissionDelegationId: string | null;
  targetReviewId: string | null;
  createdAt: string;
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
  availableActions: string[];
  unavailableReason: string | null;
  handlerOptions: SpotProcurementHandlerOptionReadModel[];
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

export interface SpotProcurementRealPaymentSummaryReadModel {
  paymentId: string | null;
  status: string;
  statusLabel: string;
  approvalAmountCents: string | null;
  actualPaidAmountCents: string | null;
  refundAmountCents: string | null;
  netPaidAmountCents: string | null;
  remainingAmountCents: string | null;
  visibilityRestricted: boolean;
}

export interface SpotProcurementReceiptSummaryReadModel {
  available: boolean;
  status: string;
  statusLabel: string;
  openAfterActualPayment: boolean;
  hasActualPayment: boolean;
  blockedReason: string | null;
  currentRevisionNo: number | null;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  discrepancyStatus?: string | null;
  workflow?: {
    stage: string;
    stageLabel: string;
    resetAction: {
      key: "reset_receipt_draft";
      label: string;
      enabled: boolean;
      disabledReason: string | null;
      expectedRevision: number;
    };
  };
}

export interface SpotProcurementReceiptWorkbenchReadModel {
  materialSummary: string;
  approvedQuantitySummary: string;
  actualPaidAmountCents: string | null;
  receiptResponsible: SpotProcurementUserSummary;
  receiptDelegate: SpotProcurementUserSummary | null;
  updatedAt: string;
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
  payment: SpotProcurementPaymentSummaryReadModel | SpotProcurementRealPaymentSummaryReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel | SpotProcurementReceiptSummaryReadModel;
  invoiceCoverage: SpotProcurementFutureUnavailableReadModel;
  status: SpotProcurementStatus;
  statusLabel: string;
  approval: SpotProcurementApprovalSummary;
  receiptWorkbench: SpotProcurementReceiptWorkbenchReadModel;
  createdAt: string;
  updatedAt: string;
  form?: "real_application" | "legacy";
  applicationDepartment?: string;
  applicationName?: string;
  purchaserName?: string;
  purchaserDepartment?: string;
  requestedArrivalAt?: string;
}

export interface SpotProcurementListReadModel {
  items: SpotProcurementListItemReadModel[];
  view: "active" | "ended";
  surface?: "procurement" | "receipt";
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  statistics: {
    total: number;
    byStatus: Record<string, number>;
  };
}

export interface SpotProcurementApplicationTextSuggestionReadModel {
  applicationDepartment: string;
  applicationName: string;
  versionId: string;
}

export type SpotProcurementVoucherStatus = "none" | "complete" | "anomaly";

export const SPOT_PAYMENT_WORKBENCH_VIEWS = ["mine", "all", "closed"] as const;
export type SpotPaymentWorkbenchView =
  (typeof SPOT_PAYMENT_WORKBENCH_VIEWS)[number];
export interface SpotPaymentCurrentTask {
  key: string;
  label: string;
  hint: string;
  priority: 400 | 300 | 200 | 0;
  scope: "personal" | "shared" | "none";
  enabled: boolean;
  disabledReason: string | null;
}
export interface SpotPaymentListAmountSummary {
  approvalAmountCents: string;
  actualPaidAmountCents: string;
  refundAmountCents: string;
  netPaidAmountCents: string;
  complete: boolean;
}

export interface SpotProcurementPaymentListItemReadModel {
  id: string;
  code: string;
  procurement: {
    id: string;
    code: string;
    supplierName?: string;
  };
  project: SpotProcurementProjectSummary;
  form?: "real_payment" | "legacy";
  paymentType?: "company_direct" | "handler_reimbursement" | null;
  paymentTypeLabel?: string;
  merchantName?: string | null;
  payerCompanyName?: string | null;
  payee?: {
    name: string;
    accountName: string | null;
    accountNumberLast4: string | null;
  };
  approvalAmountCents?: string | null;
  actualPaidAmountCents?: string | null;
  refundAmountCents?: string | null;
  netPaidAmountCents?: string | null;
  remainingAmountCents?: string | null;
  receipt?: SpotProcurementReceiptSummaryReadModel | SpotProcurementFutureUnavailableReadModel;
  invoice?: {
    status: string;
    statusLabel: string;
    activeCount: number;
  };
  paymentPath?: PaymentPath | null;
  paymentPathLabel?: string;
  payeeName?: string;
  settlementAmountCents?: string;
  supplierBalanceAmountCents?: string;
  companyPaymentAmountCents?: string;
  effectiveCompanyPaymentAmountCents?: string;
  paidAmountCents?: string;
  remainingCompanyPaymentAmountCents?: string;
  executedSupplierBalanceAmountCents?: string;
  canceledAmountCents?: string;
  status: SpotProcurementPaymentStatus;
  statusLabel: string;
  companyPaymentStatusLabel: string;
  approval: SpotProcurementApprovalSummary;
  handler: SpotProcurementUserSummary;
  voucherStatus: SpotProcurementVoucherStatus;
  voucherStatusLabel: string;
  paymentFactConsistent: boolean;
  currentTask: SpotPaymentCurrentTask;
  invoiceCoverage?: SpotProcurementFutureUnavailableReadModel;
  createdAt: string;
  updatedAt: string;
}

export interface SpotProcurementPaymentListReadModel {
  view: SpotPaymentWorkbenchView;
  items: SpotProcurementPaymentListItemReadModel[];
  viewCounts: Record<SpotPaymentWorkbenchView, number>;
  amountSummary: SpotPaymentListAmountSummary | null;
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
  applicationDepartment?: string;
  applicationName?: string;
  purchaserName?: string;
  purchaserDepartment?: string;
  requestedArrivalAt?: string;
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

export interface SpotProcurementPaymentInvoiceReadModel {
  id: string;
  paymentId: string;
  fileId: string;
  status: string;
  uploadedByUserId: string;
  invalidatedAt: string | null;
  invalidatedByUserId: string | null;
  invalidationReason: string | null;
  createdAt: string;
  file: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storageStatus: string;
  } | null;
  availableActions: DetailActionReadModel[];
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
    abandonedAt?: string | null;
    abandonReason?: string | null;
    createdAt: string;
    updatedAt: string;
    form?: "real_application" | "legacy";
    payment?: SpotProcurementRealPaymentSummaryReadModel;
  };
  currentVersion: SpotProcurementVersionReadModel;
  versions: SpotProcurementVersionReadModel[];
  lines: SpotProcurementLineReadModel[];
  invoiceComposition: SpotProcurementInvoiceComposition;
  attachments: EvidenceFileReadModel[];
  approval: SpotProcurementApprovalSummary;
  approvalTimeline: ApprovalTimelineItemReadModel[];
  payments: SpotProcurementPaymentListItemReadModel[];
  paymentSummary: SpotProcurementPaymentSummaryReadModel | SpotProcurementRealPaymentSummaryReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel | SpotProcurementReceiptSummaryReadModel;
  invoiceCoverage: SpotProcurementInvoiceCoverageReadModel;
  invoiceLedger: SpotProcurementInvoiceLedgerReadModel;
  discrepancy: SpotProcurementFutureUnavailableReadModel | {
    status: string;
    statusLabel?: string;
    nextStep: string | null;
    refund?: { amountCents: string; receivedAt: string } | null;
  };
  applicationPdf: SpotProcurementApprovalPdfReadModel;
  availableActions: DetailActionReadModel[];
  reviewApprovalContext:
    | SpotProcurementReviewApprovalContext
    | null;
  withdrawApprovalContext:
    | SpotProcurementWithdrawApprovalContext
    | null;
  primaryAction: string | null;
  disabledReasons: string[];
  abnormalTermination?: {
    id: string;
    procurementId: string;
    status: string;
    reason: string;
    requestedByUserId: string;
    requestedAt: string;
    confirmedByUserId: string | null;
    confirmedAt: string | null;
  } | null;
  invoice?: {
    status: string;
    statusLabel: string;
    activeCount: number;
    invoices: Array<Record<string, unknown>>;
  };
}

export interface SpotProcurementPaymentExecutionReadModel {
  id: string;
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentMethodLabel: string;
  executedBy: SpotProcurementUserSummary;
  voucherFileId: string | null;
  voucherFileName: string;
  voidedAt: string | null;
  voidReason: string | null;
  active: boolean;
  vouchers?: Array<{
    id: string;
    fileId: string;
    sortOrder: number;
  }>;
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
      supplierName?: string;
    };
    procurementVersionId: string;
    form?: "real_payment" | "legacy";
    paymentType?: "company_direct" | "handler_reimbursement" | null;
    paymentTypeLabel?: string;
    merchantName?: string | null;
    merchantPayeeMismatchNote?: string | null;
    payerCompanyName?: string | null;
    payee?: {
      name: string;
      accountName: string | null;
      primaryChannel: SpotProcurementPaymentChannelReadModel | null;
    };
    approvalAmountCents?: string | null;
    actualPaidAmountCents?: string | null;
    refundAmountCents?: string | null;
    netPaidAmountCents?: string | null;
    remainingAmountCents?: string | null;
    paymentFactConsistent?: boolean;
    voucherStatus?: SpotProcurementVoucherStatus;
    voucherStatusLabel?: string;
    payerManagement?: SpotProcurementPayerManagementReadModel;
    settlementAmountCents?: string;
    supplierBalanceAmountCents?: string;
    companyPaymentAmountCents?: string;
    effectiveCompanyPaymentAmountCents?: string;
    paidAmountCents?: string;
    remainingCompanyPaymentAmountCents?: string;
    executedSupplierBalanceAmountCents?: string;
    canceledAmountCents?: string;
    canceledCompanyPaymentAmountCents?: string;
    canceledSupplierBalanceAmountCents?: string;
    paymentPath?: PaymentPath | null;
    paymentPathLabel?: string;
    paymentMethod?: SpotProcurementPaymentMethod | null;
    paymentMethodLabel?: string;
    payeeName?: string;
    payeeAccountName?: string | null;
    payeeBankName?: string | null;
    payeeBankAccountLast4?: string | null;
    expectedPaymentAt?: string | null;
    paymentNote?: string | null;
    balanceOverrideReason?: string | null;
    handler: SpotProcurementUserSummary;
    submittedAt: string | null;
    approvedAt: string | null;
    invalidatedAt: string | null;
    invalidatedReason: string | null;
    draftOrigin?: string;
    sourcePaymentId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  procurementVersion: SpotProcurementVersionReadModel;
  approval: SpotProcurementApprovalSummary;
  approvalTimeline: ApprovalTimelineItemReadModel[];
  composition?: {
    settlementAmountCents: string;
    supplierBalanceAmountCents: string;
    companyPaymentAmountCents: string;
  };
  companyPayment?: {
    status: SpotProcurementPaymentStatus;
    statusLabel: string;
    approvedAmountCents: string;
    paidAmountCents: string;
    remainingAmountCents: string;
    paymentFactConsistent: boolean;
    voucherStatus: SpotProcurementVoucherStatus;
    voucherStatusLabel: string;
  };
  balanceExecution?: {
    requestedAmountCents: string;
    executedAmountCents: string;
    reservationStatus: string | null;
  };
  executions: SpotProcurementPaymentExecutionReadModel[];
  evidenceFiles: EvidenceFileReadModel[];
  invoiceCoverage?: SpotProcurementInvoiceCoverageReadModel;
  invoiceLedger?: SpotProcurementInvoiceLedgerReadModel;
  receipt: SpotProcurementFutureUnavailableReadModel | SpotProcurementReceiptSummaryReadModel;
  materials?: SpotProcurementPaymentMaterialReadModel[];
  procurementMaterials?: Array<{
    id: string;
    sortOrder: number;
    materialName: string;
    specification: string | null;
    unit: string;
    approvedQuantity: string;
    note: string | null;
  }>;
  paymentMethods?: Array<{ value: SpotProcurementPaymentMethod; label: string }>;
  paymentChannels?: SpotProcurementPaymentChannelReadModel[];
  discrepancy?: {
    status: string;
    statusLabel?: string;
    nextStep: string | null;
    refund?: { amountCents: string; receivedAt: string } | null;
  };
  approvalOriginal?: {
    documentId: string;
    fileId: string;
    templateKey: string;
    createdAt: string;
    immutable: boolean;
  } | null;
  archives?: SpotProcurementPaymentArchiveReadModel[];
  archiveStatus?: {
    status: string;
    label: string;
    canRetry: boolean;
    latestVersionNo: number | null;
    latestGeneratedAt?: string;
  };
  invoice?: {
    status: string;
    statusLabel: string;
    activeCount: number;
    invoices: SpotProcurementPaymentInvoiceReadModel[];
  };
  paymentPdf: SpotProcurementApprovalPdfReadModel;
  currentTask: SpotPaymentCurrentTask;
  availableActions: DetailActionReadModel[];
  primaryAction: string | null;
  disabledReasons: string[];
}

export interface SpotProcurementPaymentMaterialReadModel {
  id: string;
  procurementLineId: string;
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  approvedQuantity: string;
  paymentQuantity: string;
  unitPrice: string;
  amountCents: string;
  expectedInvoiceCondition: "vat_general" | "vat_special" | "no_invoice";
  vatRateOptionId: string | null;
  vatRateValue: string | null;
  vatRateLabel: string | null;
}

export interface SpotProcurementPaymentChannelReadModel {
  id: string;
  sortOrder: number;
  channelType: SpotProcurementPaymentMethod;
  channelTypeLabel: string;
  accountName: string | null;
  bankName: string | null;
  accountNumberLast4: string | null;
  note: string | null;
  primary: boolean;
}

export interface SpotProcurementPayerManagementReadModel {
  visible: boolean;
  enabled: boolean;
  disabledReason: string | null;
  requiresReapproval: boolean;
}

export interface SpotProcurementPaymentArchiveReadModel {
  id: string;
  versionNo: number;
  status: string;
  statusLabel?: string;
  archiveTrigger: string;
  createdAt: string;
  files: Array<{
    id: string;
    fileId: string;
    role: string;
    sortOrder: number;
  }>;
}

export interface SpotProcurementListQuery {
  projectId?: string;
  status?: SpotProcurementStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
  view?: "active" | "ended";
  surface?: "procurement" | "receipt";
}

export interface SpotProcurementPaymentListQuery {
  projectId?: string;
  status?: SpotProcurementPaymentStatus;
  keyword?: string;
  view?: SpotPaymentWorkbenchView;
}

export interface SpotProcurementLinePayload {
  materialName: string;
  specification?: string;
  unit: string;
  quantity: string;
  note?: string;
}

export interface SpotProcurementAttachmentPayload {
  fileId: string;
  category: SpotProcurementAttachmentCategory;
}

export interface SpotProcurementDraftPayload {
  applicationDepartment: string;
  applicationName: string;
  requestedArrivalAt: string;
  reason: string;
  note?: string | null;
  lines: SpotProcurementLinePayload[];
  attachments?: SpotProcurementAttachmentPayload[];
}

export interface CreateSpotProcurementDraftPayload
  extends SpotProcurementDraftPayload {
  projectId: string;
}

export interface CreateSpotProcurementVersionPayload extends SpotProcurementDraftPayload {
  changeReason: string;
}

export interface SpotProcurementReviewDecisionPayload {
  decision: SpotProcurementReviewDecision;
  comment?: string;
}

export interface ReviewSpotProcurementPayload
  extends SpotProcurementReviewDecisionPayload {
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
}

export type SpotProcurementReviewActionDecision =
  | "approve"
  | "reject"
  | "return_to_applicant";

export interface SpotProcurementReviewActionContext {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  procurementId: string;
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  decision: SpotProcurementReviewActionDecision;
  comment?: string;
}

export interface PrepareSpotProcurementReviewActionInput
  extends SpotProcurementReviewActionContext {
  isCurrent: (context: SpotProcurementReviewActionContext) => boolean;
}

export type PrepareSpotProcurementReviewActionResult =
  | {
      status: "ready";
      context: SpotProcurementReviewActionContext;
      preflight: SpotProcurementDetailReadModel;
    }
  | {
      status: "stale";
      context: SpotProcurementReviewActionContext;
    };

export interface ExecuteSpotProcurementReviewActionInput {
  decision: SpotProcurementReviewActionDecision;
  capture: (
    decision: SpotProcurementReviewActionDecision
  ) => SpotProcurementReviewActionContext | null;
  preflight: (
    context: SpotProcurementReviewActionContext
  ) => Promise<PrepareSpotProcurementReviewActionResult>;
  current: (
    context: SpotProcurementReviewActionContext,
    prepared: PrepareSpotProcurementReviewActionResult
  ) => boolean;
  complete: (
    context: SpotProcurementReviewActionContext,
    response: SpotProcurementWriteReadModel
  ) => void | Promise<void>;
  fail: (
    context: SpotProcurementReviewActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: SpotProcurementReviewActionContext) => void;
}

export type ExecuteSpotProcurementReviewActionResult =
  | {
      status: "not_started";
    }
  | {
      status: "stale";
      context: SpotProcurementReviewActionContext;
    }
  | {
      status: "completed";
      context: SpotProcurementReviewActionContext;
      response: SpotProcurementWriteReadModel;
    }
  | {
      status: "failed";
      context: SpotProcurementReviewActionContext;
    };

export interface SpotProcurementWithdrawalActionContext
  extends SpotProcurementWithdrawApprovalContext {
  action: "withdraw";
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  procurementId: string;
}

export interface PrepareSpotProcurementWithdrawalActionInput
  extends SpotProcurementWithdrawalActionContext {
  isCurrent: (
    context: SpotProcurementWithdrawalActionContext
  ) => boolean;
}

export type PrepareSpotProcurementWithdrawalActionResult =
  | {
      status: "ready";
      context: SpotProcurementWithdrawalActionContext;
      preflight: SpotProcurementDetailReadModel;
    }
  | {
      status: "stale";
      context: SpotProcurementWithdrawalActionContext;
    };

export interface ExecuteSpotProcurementWithdrawalActionInput {
  action: "withdraw";
  capture: (
    action: "withdraw"
  ) => SpotProcurementWithdrawalActionContext | null;
  preflight: (
    context: SpotProcurementWithdrawalActionContext
  ) => Promise<PrepareSpotProcurementWithdrawalActionResult>;
  current: (
    context: SpotProcurementWithdrawalActionContext,
    prepared: PrepareSpotProcurementWithdrawalActionResult
  ) => boolean;
  complete: (
    context: SpotProcurementWithdrawalActionContext,
    response: SpotProcurementWriteReadModel
  ) => void | Promise<void>;
  fail: (
    context: SpotProcurementWithdrawalActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: SpotProcurementWithdrawalActionContext) => void;
}

export type ExecuteSpotProcurementWithdrawalActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: SpotProcurementWithdrawalActionContext;
    }
  | {
      status: "completed";
      context: SpotProcurementWithdrawalActionContext;
      response: SpotProcurementWriteReadModel;
    }
  | {
      status: "failed";
      context: SpotProcurementWithdrawalActionContext;
      error: unknown;
    };

export interface ReviewSpotProcurementPaymentPayload {
  decision: SpotProcurementA5ReviewDecision;
  comment?: string;
  adjustedSupplierBalanceAmountCents?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface SpotProcurementPaymentReviewActionContext {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  paymentId: string;
  paymentForm: "real_payment" | "legacy";
  decision: SpotProcurementA5ReviewDecision;
  comment?: string;
  requiresSelfReviewConfirmation: boolean;
  requiresLegacySupplierBalanceAdjustment: boolean;
  adjustedSupplierBalanceAmountCents?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface PrepareSpotProcurementPaymentReviewActionInput
  extends SpotProcurementPaymentReviewActionContext {
  isCurrent: (
    context: SpotProcurementPaymentReviewActionContext
  ) => boolean;
}

export type PrepareSpotProcurementPaymentReviewActionResult =
  | {
      status: "ready";
      context: SpotProcurementPaymentReviewActionContext;
      preflight: SpotProcurementPaymentDetailReadModel;
    }
  | {
      status: "stale";
      context: SpotProcurementPaymentReviewActionContext;
    };

export interface ExecuteSpotProcurementPaymentReviewActionInput {
  decision: SpotProcurementA5ReviewDecision;
  capture: (
    decision: SpotProcurementA5ReviewDecision
  ) => SpotProcurementPaymentReviewActionContext | null;
  preflight: (
    context: SpotProcurementPaymentReviewActionContext
  ) => Promise<PrepareSpotProcurementPaymentReviewActionResult>;
  current: (
    context: SpotProcurementPaymentReviewActionContext,
    prepared: PrepareSpotProcurementPaymentReviewActionResult
  ) => boolean;
  complete: (
    context: SpotProcurementPaymentReviewActionContext,
    response: SpotProcurementPaymentWriteReadModel
  ) => void | Promise<void>;
  fail: (
    context: SpotProcurementPaymentReviewActionContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (
    context: SpotProcurementPaymentReviewActionContext
  ) => void;
}

export type ExecuteSpotProcurementPaymentReviewActionResult =
  | { status: "not_started" }
  | {
      status: "stale";
      context: SpotProcurementPaymentReviewActionContext;
    }
  | {
      status: "completed";
      context: SpotProcurementPaymentReviewActionContext;
      response: SpotProcurementPaymentWriteReadModel;
    }
  | {
      status: "failed";
      context: SpotProcurementPaymentReviewActionContext;
    };

export interface VoidSpotProcurementPayload {
  reason: string;
}

export interface AbandonSpotProcurementDraftPayload {
  action: "delete_pristine_draft" | "abandon_application";
  reason?: string;
}

export interface AbandonSpotProcurementPaymentDraftPayload {
  expectedUpdatedAt: string;
  reason: string;
}

export interface UpdateSpotProcurementPaymentDraftPayload {
  paymentType?: "company_direct" | "handler_reimbursement";
  merchantName?: string;
  payeeName?: string;
  merchantPayeeMismatchNote?: string | null;
  paymentLines?: Array<{
    procurementLineId: string;
    paymentQuantity: string;
    unitPrice: string;
    expectedInvoiceCondition: "vat_general" | "vat_special" | "no_invoice";
    vatRatePercent?: string;
  }>;
  channels?: Array<{
    channelType: SpotProcurementPaymentMethod;
    accountName?: string | null;
    accountNumber?: string | null;
    bankName?: string | null;
    note?: string | null;
    isPrimary: boolean;
  }>;
  paymentMethods?: SpotProcurementPaymentMethod[];
  attachments?: Array<{
    fileId: string;
    category: "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other";
  }>;
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
  voucherFileId?: string;
  voucherFileIds?: string[];
  paymentChannelId?: string;
  idempotencyKey: string;
  confirmationPassword: string;
}

export interface UpdateSpotProcurementPaymentPayerPayload {
  companyEntityId: string;
  changeReason?: string;
  paymentMethods?: SpotProcurementPaymentMethod[];
}

export interface UpdateSpotProcurementReceiptDraftPayload {
  note?: string | null;
  lines: Array<{
    procurementLineId: string;
    qualifiedQuantity: string;
    unqualifiedQuantity: string;
    unqualifiedReason?: string;
    freeGiftQuantity: string;
    replenishmentPending: boolean;
    discrepancyNote?: string;
  }>;
}

export interface AttachSpotProcurementReceiptPhotoPayload {
  originalFileId: string;
  source: "camera" | "album";
  category: "material_scene" | "delivery_note";
  note?: string;
  appendReason?: string;
}

export interface SpotProcurementWriteReadModel {
  procurementId: string;
  projectId: string;
  code: string;
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

async function uploadSpotProcurementPrivateFile(
  path: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  const form = new FormData();
  form.append("file", file, fileName);
  if (idempotencyKey !== undefined) {
    form.append("idempotencyKey", idempotencyKey);
  }
  const response = await apiFetch(path, { method: "POST", body: form });
  await ensureOk(response, "零星采购文件上传失败");
  return response.json() as Promise<{ id: string }>;
}

export function uploadSpotProcurementCreateFile(
  projectId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurements/projects/${encodeURIComponent(projectId)}/draft-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementDraftFile(
  procurementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurements/${encodeURIComponent(procurementId)}/draft-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementPaymentDraftFile(
  paymentId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/draft-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementExecutionVoucherFile(
  paymentId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/execution-voucher-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementReceiptPhotoFile(
  procurementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt-photo-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementRefundVoucherFile(
  procurementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurements/${encodeURIComponent(procurementId)}/refund-voucher-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function uploadSpotProcurementInvoiceFile(
  procurementId: string,
  file: Blob,
  fileName: string,
  idempotencyKey?: string
) {
  return uploadSpotProcurementPrivateFile(
    `/spot-procurements/${encodeURIComponent(procurementId)}/invoice-file-uploads`,
    file,
    fileName,
    idempotencyKey
  );
}

export function fetchSpotProcurementCreateProjectOptions() {
  return readJson<SpotProcurementCreateProjectOptionReadModel[]>(
    "/spot-procurements/create-project-options"
  );
}

export function fetchSpotProcurements(query: SpotProcurementListQuery = {}) {
  return readJson<SpotProcurementListReadModel>(
    withQuery("/spot-procurements", query)
  );
}

export function fetchSpotProcurementApplicationTextSuggestions(
  projectId: string,
  keyword?: string
) {
  const search = new URLSearchParams({ projectId });
  if (keyword?.trim()) search.set("keyword", keyword.trim());
  return readJson<SpotProcurementApplicationTextSuggestionReadModel[]>(
    `/spot-procurements/application-text-suggestions?${search.toString()}`
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

export function updateSpotProcurementPaymentPayer(
  paymentId: string,
  body: UpdateSpotProcurementPaymentPayerPayload
) {
  return patchJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/payer`,
    body
  );
}

export function fetchSpotProcurementReceipt(procurementId: string) {
  return readJson<SpotProcurementReceiptDetailReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt`
  );
}

export function updateSpotProcurementReceiptDraft(
  procurementId: string,
  body: UpdateSpotProcurementReceiptDraftPayload
) {
  return patchJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/draft`,
    body
  );
}

export function attachSpotProcurementReceiptPhoto(
  procurementId: string,
  body: AttachSpotProcurementReceiptPhotoPayload
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/photos`,
    body
  );
}

export function deleteSpotProcurementReceiptPhoto(procurementId: string, photoId: string) {
  return deleteJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/photos/${encodeURIComponent(photoId)}`
  );
}

export function submitSpotProcurementReceipt(procurementId: string) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/submission`
  );
}

export function createSpotProcurementReceiptDelegation(procurementId: string, delegateUserId: string) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/delegations`,
    { delegateUserId }
  );
}

export function reviewSpotProcurementReceipt(
  procurementId: string,
  body: { decision: "approved" | "returned"; comment?: string }
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/review`,
    body
  );
}

export function revokeSpotProcurementReceiptReview(
  procurementId: string,
  body: { targetReviewId: string; reason: string; confirmReviewRevocation: true }
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/review-revocation`,
    body
  );
}

export function createSpotProcurementDiscrepancy(
  procurementId: string,
  body: {
    operation: "initiate" | "confirm";
    resolutionType?: "replenishment" | "full_refund";
    note?: string;
  }
) {
  return postJson<unknown>(`/spot-procurements/${encodeURIComponent(procurementId)}/discrepancy`, body);
}

export function recordSpotProcurementRefund(
  procurementId: string,
  body: {
    amountCents: string;
    receivedAt: string;
    refundMethod: "bank_transfer" | "cash";
    voucherFileId: string;
    idempotencyKey: string;
  }
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/refunds`,
    body
  );
}

function postSpotProcurementPaymentInvoice(
  paymentId: string,
  fileId: string
) {
  return postJson<unknown>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/invoices`,
    { fileId }
  );
}

export async function executeSpotProcurementInvoiceAppend<
  TContext extends SpotProcurementInvoiceAppendActionContext
>(
  input: ExecuteSpotProcurementInvoiceAppendInput<TContext>
): Promise<ExecuteSpotProcurementInvoiceAppendResult<TContext>> {
  const context = input.capture();
  if (!context) return { status: "not_started" };
  let appendCompleted = false;

  try {
    if (!input.current(context)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    const freshReceipt = await fetchSpotProcurementReceipt(
      context.procurementId
    );
    const appendActions = freshReceipt.availableActions.filter(
      (action) => action.key === "append_invoice"
    );
    if (
      freshReceipt.receipt.procurementId !== context.procurementId ||
      appendActions.length !== 1 ||
      appendActions[0]?.enabled !== true
    ) {
      throw new Error(
        "发票追加权限或采购坐标已变化，请刷新当前收货单后重试"
      );
    }
    if (!input.current(context, freshReceipt)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    const freshPayment = await fetchSpotProcurementPaymentDetail(
      context.paymentId
    );
    if (
      freshPayment.payment.id !== context.paymentId ||
      freshPayment.payment.procurement.id !== context.procurementId ||
      freshPayment.payment.status === "invalidated" ||
      !freshPayment.payment.paymentType ||
      !freshPayment.executions.some((execution) => execution.active)
    ) {
      throw new Error(
        "发票对应付款已变化或尚无有效实付，请刷新当前收货单后重试"
      );
    }
    if (!input.current(context, freshReceipt, freshPayment)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    const uploaded = await input.upload(
      context.file,
      context.fileName,
      context.uploadIdempotencyKey
    );
    if (!input.current(context, freshReceipt, freshPayment)) {
      await input.stale(context);
      return { status: "stale", context };
    }
    await postSpotProcurementPaymentInvoice(context.paymentId, uploaded.id);
    appendCompleted = true;
    if (!input.current(context, freshReceipt, freshPayment)) {
      return { status: "completed_detached", context };
    }
    await input.complete(context);
    return { status: "completed", context };
  } catch (error) {
    if (appendCompleted) {
      await input.completionFail(context, error);
      return { status: "completed_with_refresh_error", context };
    }
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    input.finish(context);
  }
}

export function invalidateSpotProcurementPaymentInvoice(
  paymentId: string,
  invoiceId: string,
  body: { reason: string }
) {
  return postJson<unknown>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/invoices/${encodeURIComponent(invoiceId)}/invalidation`,
    body
  );
}

export function requestSpotProcurementAbnormalTermination(
  procurementId: string,
  body: { reason: string }
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/abnormal-termination`,
    body
  );
}

export function confirmSpotProcurementAbnormalTermination(procurementId: string) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/abnormal-termination/confirmation`,
    { confirmTermination: true }
  );
}

export function refreshSpotProcurementReceiptPdf(procurementId: string) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/pdf-refresh`
  );
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

function reviewSpotProcurement(
  procurementId: string,
  body: ReviewSpotProcurementPayload
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/approval`,
    body
  );
}

export async function prepareSpotProcurementReviewAction(
  input: PrepareSpotProcurementReviewActionInput
): Promise<PrepareSpotProcurementReviewActionResult> {
  const context = normalizeSpotProcurementReviewAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchSpotProcurementDetail(context.procurementId);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertSpotProcurementReviewPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeSpotProcurementReviewAction(
  input: ExecuteSpotProcurementReviewActionInput
): Promise<ExecuteSpotProcurementReviewActionResult> {
  const context = input.capture(input.decision);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await reviewSpotProcurement(
      context.procurementId,
      reviewSpotProcurementActionPayload(context, input.decision)
    );
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    input.finish(context);
  }
}

function reviewSpotProcurementActionPayload(
  context: SpotProcurementReviewActionContext,
  decision: SpotProcurementReviewActionDecision
): ReviewSpotProcurementPayload {
  if (
    context.decision !== decision ||
    (decision !== "approve" && !context.comment)
  ) {
    throw new Error(
      "零星采购审批上下文无效，请重新读取当前采购后再操作"
    );
  }
  return {
    decision,
    ...(decision !== "approve" ? { comment: context.comment } : {}),
    expectedVersionId: context.expectedVersionId,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex
  };
}

function normalizeSpotProcurementReviewAction(
  input: PrepareSpotProcurementReviewActionInput
): SpotProcurementReviewActionContext {
  const ownerScope = input.ownerScope.trim();
  const procurementId = input.procurementId.trim();
  const expectedVersionId = input.expectedVersionId.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  const comment =
    input.decision !== "approve" ? input.comment?.trim() ?? "" : undefined;
  if (
    !ownerScope ||
    !procurementId ||
    !expectedVersionId ||
    !expectedApprovalInstanceId ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0 ||
    !["approve", "reject", "return_to_applicant"].includes(input.decision) ||
    (input.decision !== "approve" && !comment)
  ) {
    throw new Error(
      "零星采购审批上下文无效，请重新读取当前采购后再操作"
    );
  }
  return Object.freeze({
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    procurementId,
    expectedVersionId,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    decision: input.decision,
    ...(input.decision !== "approve" ? { comment } : {})
  });
}

function assertSpotProcurementReviewPreflight(
  context: SpotProcurementReviewActionContext,
  preflight: SpotProcurementDetailReadModel
) {
  const enabledReviewActions = preflight.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  const coordinates = preflight.reviewApprovalContext;
  if (
    preflight.procurement.id !== context.procurementId ||
    preflight.currentVersion.id !== context.expectedVersionId ||
    enabledReviewActions.length !== 1 ||
    coordinates?.expectedVersionId !== context.expectedVersionId ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex
  ) {
    throw new Error(
      "零星采购审批资格或审批坐标已变化，请重新读取当前采购"
    );
  }
}

export async function prepareSpotProcurementWithdrawalAction(
  input: PrepareSpotProcurementWithdrawalActionInput
): Promise<PrepareSpotProcurementWithdrawalActionResult> {
  const context = normalizeSpotProcurementWithdrawalAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchSpotProcurementDetail(
    context.procurementId
  );
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertSpotProcurementWithdrawalPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeSpotProcurementWithdrawalAction(
  input: ExecuteSpotProcurementWithdrawalActionInput
): Promise<ExecuteSpotProcurementWithdrawalActionResult> {
  const context = input.capture(input.action);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await postSpotProcurementWithdrawal(
      context.procurementId,
      spotProcurementWithdrawalPayload(context)
    );
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context, error };
  } finally {
    input.finish(context);
  }
}

function normalizeSpotProcurementWithdrawalAction(
  input: PrepareSpotProcurementWithdrawalActionInput
): SpotProcurementWithdrawalActionContext {
  const ownerScope = input.ownerScope.trim();
  const procurementId = input.procurementId.trim();
  const expectedVersionId = input.expectedVersionId.trim();
  const expectedApprovalInstanceId =
    input.expectedApprovalInstanceId.trim();
  if (
    input.action !== "withdraw" ||
    !ownerScope ||
    !procurementId ||
    !expectedVersionId ||
    !expectedApprovalInstanceId ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    !Number.isInteger(input.expectedNodeIndex) ||
    input.expectedNodeIndex < 0
  ) {
    throw new Error(
      "零星采购撤回上下文无效，请重新读取当前采购后再操作"
    );
  }
  return Object.freeze({
    action: "withdraw",
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    procurementId,
    expectedVersionId,
    expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex
  });
}

function assertSpotProcurementWithdrawalPreflight(
  context: SpotProcurementWithdrawalActionContext,
  preflight: SpotProcurementDetailReadModel
) {
  const enabledWithdrawalActions =
    preflight.availableActions.filter(
      (action) =>
        action.key === "withdraw_approval" && action.enabled
    );
  const coordinates = preflight.withdrawApprovalContext;
  if (
    preflight.procurement.form !== "real_application" ||
    preflight.procurement.id !== context.procurementId ||
    preflight.currentVersion.id !== context.expectedVersionId ||
    enabledWithdrawalActions.length !== 1 ||
    coordinates?.expectedVersionId !== context.expectedVersionId ||
    coordinates.expectedApprovalInstanceId !==
      context.expectedApprovalInstanceId ||
    coordinates.expectedNodeIndex !== context.expectedNodeIndex
  ) {
    throw new Error(
      "零星采购撤回资格或审批坐标已变化，请重新读取当前采购"
    );
  }
}

function spotProcurementWithdrawalPayload(
  context: SpotProcurementWithdrawalActionContext
): SpotProcurementWithdrawApprovalContext {
  if (context.action !== "withdraw") {
    throw new Error(
      "零星采购撤回上下文无效，请重新读取当前采购后再操作"
    );
  }
  return {
    expectedVersionId: context.expectedVersionId,
    expectedApprovalInstanceId:
      context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex
  };
}

function postSpotProcurementWithdrawal(
  procurementId: string,
  body: SpotProcurementWithdrawApprovalContext
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/approval-withdrawal`,
    body
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

export function abandonSpotProcurementDraft(
  procurementId: string,
  body: AbandonSpotProcurementDraftPayload
) {
  return postJson<SpotProcurementWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/abandonment`,
    body
  );
}

export function createSpotProcurementPaymentDraft(procurementId: string) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/payments`
  );
}

export function recreateSpotProcurementPaymentDraft(procurementId: string) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/payment-drafts`
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

function postSpotProcurementPaymentReview(
  paymentId: string,
  body: ReviewSpotProcurementPaymentPayload
) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/approval`,
    body
  );
}

export async function prepareSpotProcurementPaymentReviewAction(
  input: PrepareSpotProcurementPaymentReviewActionInput
): Promise<PrepareSpotProcurementPaymentReviewActionResult> {
  const context = normalizeSpotProcurementPaymentReviewAction(input);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  const preflight = await fetchSpotProcurementPaymentDetail(
    context.paymentId
  );
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }
  assertSpotProcurementPaymentReviewPreflight(context, preflight);
  if (!input.isCurrent(context)) {
    return { status: "stale", context };
  }

  return { status: "ready", context, preflight };
}

export async function executeSpotProcurementPaymentReviewAction(
  input: ExecuteSpotProcurementPaymentReviewActionInput
): Promise<ExecuteSpotProcurementPaymentReviewActionResult> {
  const context = input.capture(input.decision);
  if (!context) return { status: "not_started" };

  try {
    const prepared = await input.preflight(context);
    if (!input.current(context, prepared)) {
      return { status: "stale", context };
    }
    const response = await postSpotProcurementPaymentReview(
      context.paymentId,
      spotProcurementPaymentReviewPayload(context, input.decision)
    );
    assertSpotProcurementPaymentReviewResponse(context, response);
    await input.complete(context, response);
    return { status: "completed", context, response };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    input.finish(context);
  }
}

function spotProcurementPaymentReviewPayload(
  context: SpotProcurementPaymentReviewActionContext,
  decision: SpotProcurementA5ReviewDecision
): ReviewSpotProcurementPaymentPayload {
  if (
    context.decision !== decision ||
    (decision === "return_to_applicant" && !context.comment) ||
    (context.requiresSelfReviewConfirmation &&
      (!context.selfReviewReason ||
        !context.confirmationPassword?.trim()))
  ) {
    throw new Error(
      "零星采购付款审批上下文无效，请重新读取当前付款后再操作"
    );
  }
  return {
    decision,
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresLegacySupplierBalanceAdjustment
      ? {
          adjustedSupplierBalanceAmountCents:
            context.adjustedSupplierBalanceAmountCents
        }
      : {}),
    ...(context.requiresSelfReviewConfirmation
      ? {
          selfReviewReason: context.selfReviewReason,
          confirmationPassword: context.confirmationPassword
        }
      : {})
  };
}

function normalizeSpotProcurementPaymentReviewAction(
  input: PrepareSpotProcurementPaymentReviewActionInput
): SpotProcurementPaymentReviewActionContext {
  const ownerScope = input.ownerScope.trim();
  const paymentId = input.paymentId.trim();
  const comment = input.comment?.trim() || undefined;
  const selfReviewReason = input.requiresSelfReviewConfirmation
    ? input.selfReviewReason?.trim() || undefined
    : undefined;
  const confirmationPassword = input.requiresSelfReviewConfirmation
    ? input.confirmationPassword
    : undefined;
  const adjustedSupplierBalanceAmountCents =
    input.adjustedSupplierBalanceAmountCents?.trim();
  const validAdjustedSupplierBalanceAmount =
    adjustedSupplierBalanceAmountCents !== undefined &&
    /^(0|[1-9]\d*)$/u.test(adjustedSupplierBalanceAmountCents);
  if (
    !ownerScope ||
    !paymentId ||
    !Number.isInteger(input.routeGeneration) ||
    input.routeGeneration < 0 ||
    !Number.isInteger(input.detailEpoch) ||
    input.detailEpoch < 0 ||
    !Number.isInteger(input.dialogGeneration) ||
    input.dialogGeneration < 0 ||
    !Number.isInteger(input.operationId) ||
    input.operationId < 1 ||
    (input.paymentForm !== "real_payment" &&
      input.paymentForm !== "legacy") ||
    (input.decision !== "approve" &&
      input.decision !== "return_to_applicant") ||
    (input.decision === "return_to_applicant" && !comment) ||
    (input.paymentForm === "real_payment" &&
      (input.requiresLegacySupplierBalanceAdjustment ||
        input.adjustedSupplierBalanceAmountCents !== undefined)) ||
    (input.requiresLegacySupplierBalanceAdjustment &&
      (input.paymentForm !== "legacy" ||
        input.decision !== "return_to_applicant" ||
        !validAdjustedSupplierBalanceAmount)) ||
    (!input.requiresLegacySupplierBalanceAdjustment &&
      input.adjustedSupplierBalanceAmountCents !== undefined) ||
    (input.requiresSelfReviewConfirmation &&
      (!selfReviewReason || !confirmationPassword?.trim()))
  ) {
    throw new Error(
      "零星采购付款审批上下文无效，请重新读取当前付款后再操作"
    );
  }
  return Object.freeze({
    ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    paymentId,
    paymentForm: input.paymentForm,
    decision: input.decision,
    requiresSelfReviewConfirmation:
      input.requiresSelfReviewConfirmation,
    requiresLegacySupplierBalanceAdjustment:
      input.requiresLegacySupplierBalanceAdjustment,
    ...(validAdjustedSupplierBalanceAmount
      ? {
          adjustedSupplierBalanceAmountCents:
            BigInt(adjustedSupplierBalanceAmountCents).toString()
        }
      : {}),
    ...(comment ? { comment } : {}),
    ...(selfReviewReason ? { selfReviewReason } : {}),
    ...(confirmationPassword ? { confirmationPassword } : {})
  });
}

function assertSpotProcurementPaymentReviewPreflight(
  context: SpotProcurementPaymentReviewActionContext,
  preflight: SpotProcurementPaymentDetailReadModel
) {
  const enabledReviewActions = preflight.availableActions.filter(
    (action) => action.key === "review_approval" && action.enabled
  );
  const paymentForm =
    preflight.payment.form === "real_payment"
      ? "real_payment"
      : "legacy";
  const requiresLegacySupplierBalanceAdjustment =
    paymentForm === "legacy" &&
    context.decision === "return_to_applicant" &&
    preflight.approval.currentRoleKeys.length === 1 &&
    preflight.approval.currentRoleKeys[0] === "finance_director";
  if (
    preflight.payment.id !== context.paymentId ||
    paymentForm !== context.paymentForm ||
    enabledReviewActions.length !== 1 ||
    requiresLegacySupplierBalanceAdjustment !==
      context.requiresLegacySupplierBalanceAdjustment ||
    (enabledReviewActions[0]?.requiresSelfReviewConfirmation === true) !==
      context.requiresSelfReviewConfirmation
  ) {
    throw new Error(
      "零星采购付款审批资格已变化，请重新读取当前付款"
    );
  }
}

function assertSpotProcurementPaymentReviewResponse(
  context: SpotProcurementPaymentReviewActionContext,
  response: SpotProcurementPaymentWriteReadModel
) {
  if (
    context.decision === "return_to_applicant" &&
    !response.newDraftPaymentId?.trim()
  ) {
    throw new Error(
      "付款申请已退回，但服务端未返回新草稿编号，请刷新页面核对"
    );
  }
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

export function abandonSpotProcurementPaymentDraft(
  paymentId: string,
  body: AbandonSpotProcurementPaymentDraftPayload
) {
  return postJson<SpotProcurementPaymentWriteReadModel>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/abandonment`,
    body
  );
}

export function resetSpotProcurementReceiptDraft(
  procurementId: string,
  expectedRevision: number
) {
  return postJson<unknown>(
    `/spot-procurements/${encodeURIComponent(procurementId)}/receipt/draft-reset`,
    { expectedRevision }
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

async function deleteJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { method: "DELETE" });
  await ensureOk(response, "提交零星采购操作失败");
  return response.json() as Promise<T>;
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
  let code: string | null = null;
  try {
    const data = (await response.clone().json()) as { code?: unknown; message?: unknown };
    if (typeof data.code === "string") code = data.code;
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
  throw new SpotProcurementApiError(message, response.status, code);
}

function withQuery(
  path: string,
  query: {
    projectId?: string;
    status?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
    view?: string;
    surface?: string;
  }
): string {
  const search = new URLSearchParams();
  appendTrimmed(search, "projectId", query.projectId);
  appendTrimmed(search, "status", query.status);
  appendTrimmed(search, "keyword", query.keyword);
  appendTrimmed(search, "view", query.view);
  appendTrimmed(search, "surface", query.surface);
  if (query.page !== undefined) search.set("page", String(query.page));
  if (query.pageSize !== undefined) search.set("pageSize", String(query.pageSize));
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
