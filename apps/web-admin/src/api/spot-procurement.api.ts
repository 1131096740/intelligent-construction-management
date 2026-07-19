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
}

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

export interface SpotProcurementRealPaymentSummaryReadModel {
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
  blockedReason: string | null;
  currentRevisionNo: number | null;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  discrepancyStatus?: string | null;
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
  truncated: boolean;
  limit: number;
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
  primaryAction: string | null;
  disabledReasons: string[];
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
    invoices: Array<Record<string, unknown>>;
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

export interface ReviewSpotProcurementA5PaymentPayload {
  decision: SpotProcurementA5ReviewDecision;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
}

export interface VoidSpotProcurementPayload {
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
    vatRateOptionId?: string;
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

export function appendSpotProcurementPaymentInvoice(
  paymentId: string,
  fileId: string
) {
  return postJson<unknown>(
    `/spot-procurement-payments/${encodeURIComponent(paymentId)}/invoices`,
    { fileId }
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

export function reviewSpotProcurementA5Payment(
  paymentId: string,
  body: ReviewSpotProcurementA5PaymentPayload
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
    view?: string;
  }
): string {
  const search = new URLSearchParams();
  appendTrimmed(search, "projectId", query.projectId);
  appendTrimmed(search, "status", query.status);
  appendTrimmed(search, "keyword", query.keyword);
  appendTrimmed(search, "view", query.view);
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
