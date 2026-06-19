export const CONTRACT_VERSION_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "voided"
] as const;

export type ContractVersionStatus = (typeof CONTRACT_VERSION_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const PAYMENT_REQUEST_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];
