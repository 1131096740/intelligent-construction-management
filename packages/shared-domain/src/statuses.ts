export const CONTRACT_VERSION_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "superseded",
  "voided",
  "abandoned",
  "deleting"
] as const;

export type ContractVersionStatus = (typeof CONTRACT_VERSION_STATUSES)[number];

export const CONTRACT_APPROVAL_FORM_AVAILABLE_STATUSES = [
  "approved",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "sealed_pending_archive",
  "pending_archive_confirm",
  "effective",
  "superseded",
  "voided"
] as const;

export const SETTLEMENT_ELIGIBLE_CONTRACT_STATUSES = ["effective"] as const satisfies readonly ContractVersionStatus[];

export const SETTLEMENT_STATUSES = [
  "draft",
  "in_approval",
  "approval_pending",
  "approval_rejected",
  "withdrawn",
  "pending_generation",
  "approved_pending_archive",
  "archive_pending",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_IN_PROGRESS_STATUSES = [
  "draft",
  "in_approval",
  "approval_pending",
  "approval_rejected",
  "withdrawn",
  "pending_generation",
  "approved_pending_archive",
  "archive_pending",
  "pending_archive_confirm"
] as const satisfies readonly SettlementStatus[];

export const SETTLEMENT_OCCUPANCY_STATUSES = [
  "in_approval",
  "approval_pending",
  "pending_generation",
  "approved_pending_archive",
  "archive_pending",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
] as const satisfies readonly SettlementStatus[];

export const PAYMENT_ELIGIBLE_SETTLEMENT_STATUSES = [
  "effective",
  "partially_paid"
] as const satisfies readonly SettlementStatus[];

export const PAYMENT_REQUEST_STATUSES = [
  "draft",
  "approval_pending",
  "in_approval",
  "approval_rejected",
  "withdrawn",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export function canCreateSettlementFromContractStatus(status: ContractVersionStatus): boolean {
  return SETTLEMENT_ELIGIBLE_CONTRACT_STATUSES.some((eligibleStatus) => eligibleStatus === status);
}

export function canUseCurrentContractApprovalForm(
  status: string | null | undefined
): boolean {
  return CONTRACT_APPROVAL_FORM_AVAILABLE_STATUSES.some(
    (availableStatus) => availableStatus === status
  );
}

export function canCreatePaymentFromSettlementStatus(status: SettlementStatus): boolean {
  return PAYMENT_ELIGIBLE_SETTLEMENT_STATUSES.some((eligibleStatus) => eligibleStatus === status);
}
