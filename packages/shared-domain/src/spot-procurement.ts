export const SPOT_PROCUREMENT_STATUSES = [
  "draft",
  "approval_pending",
  "approved_in_progress",
  "closed",
  "abnormally_terminated",
  "voided"
] as const;

export type SpotProcurementStatus = (typeof SPOT_PROCUREMENT_STATUSES)[number];

export const SPOT_PROCUREMENT_PAYMENT_STATUSES = [
  "draft",
  "approval_pending",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled",
  "returned",
  "rejected",
  "withdrawn",
  "voided",
  "invalidated"
] as const;

export type SpotProcurementPaymentStatus =
  (typeof SPOT_PROCUREMENT_PAYMENT_STATUSES)[number];

export const RECEIPT_STATUSES = [
  "draft",
  "submitted",
  "returned",
  "reviewed",
  "review_revoked",
  "locked"
] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const INVOICE_MODES = ["invoice", "no_invoice"] as const;

export type InvoiceMode = (typeof INVOICE_MODES)[number];

export const VAT_INVOICE_TYPES = ["vat_general", "vat_special"] as const;

export type VatInvoiceType = (typeof VAT_INVOICE_TYPES)[number];

export const PAYMENT_PATHS = [
  "supplier_direct",
  "handler_reimbursement"
] as const;

export type PaymentPath = (typeof PAYMENT_PATHS)[number];

/**
 * 新版真实表单的付款类型。
 *
 * `PAYMENT_PATHS` 保留给已上线旧记录兼容读取；新写入必须改用本常量，
 * 避免将“实际商户”错误等同为付款给正式供应商。
 */
export const SPOT_PROCUREMENT_PAYMENT_TYPES = [
  "company_direct",
  "handler_reimbursement"
] as const;

export type SpotProcurementPaymentType =
  (typeof SPOT_PROCUREMENT_PAYMENT_TYPES)[number];

export const SPOT_PROCUREMENT_PAYMENT_METHODS = [
  "cash",
  "wechat",
  "alipay",
  "bank_transfer",
  "other"
] as const;

export type SpotProcurementPaymentMethod =
  (typeof SPOT_PROCUREMENT_PAYMENT_METHODS)[number];

/**
 * 付款明细的预计票据条件，不等同于后续实际发票附件。
 */
export const SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS = [
  "no_invoice",
  "vat_general",
  "vat_special"
] as const;

export type SpotProcurementExpectedInvoiceCondition =
  (typeof SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS)[number];

export const SPOT_PROCUREMENT_INVOICE_STATUSES = [
  "not_required",
  "pending",
  "uploaded"
] as const;

export type SpotProcurementInvoiceStatus =
  (typeof SPOT_PROCUREMENT_INVOICE_STATUSES)[number];

export const SPOT_PROCUREMENT_DISCREPANCY_STATUSES = [
  "pending",
  "awaiting_replenishment",
  "awaiting_refund",
  "resolved"
] as const;

export type SpotProcurementDiscrepancyStatus =
  (typeof SPOT_PROCUREMENT_DISCREPANCY_STATUSES)[number];

export const SPOT_PROCUREMENT_ARCHIVE_TRIGGERS = [
  "approval_completed",
  "payment_execution_recorded",
  "payment_execution_voided",
  "refund_recorded",
  "procurement_closed",
  "abnormal_termination_confirmed",
  "invoice_appended"
] as const;

export type SpotProcurementArchiveTrigger =
  (typeof SPOT_PROCUREMENT_ARCHIVE_TRIGGERS)[number];

/**
 * 业务事实完成后不可改写，但可以按设计追加付款级发票归档附件。
 */
export function isSpotProcurementBusinessLocked(
  status: SpotProcurementStatus
): boolean {
  return status === "closed" || status === "abnormally_terminated";
}

export function canAppendSpotProcurementInvoice(
  status: SpotProcurementStatus
): boolean {
  return isSpotProcurementBusinessLocked(status);
}

export const RECEIPT_PHOTO_SOURCES = ["camera", "album"] as const;

export type ReceiptPhotoSource = (typeof RECEIPT_PHOTO_SOURCES)[number];
