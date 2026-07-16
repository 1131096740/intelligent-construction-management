export const SPOT_PROCUREMENT_STATUSES = [
  "draft",
  "approval_pending",
  "approved_in_progress",
  "closed",
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

export const RECEIPT_PHOTO_SOURCES = ["camera", "album"] as const;

export type ReceiptPhotoSource = (typeof RECEIPT_PHOTO_SOURCES)[number];
