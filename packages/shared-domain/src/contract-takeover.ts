export const CONTRACT_TAKEOVER_PERFORMANCE_STATUSES = [
  "not_started",
  "performing",
  "suspended",
  "completed",
  "terminated"
] as const;

export type ContractTakeoverPerformanceStatus =
  (typeof CONTRACT_TAKEOVER_PERFORMANCE_STATUSES)[number];

export const CONTRACT_TAKEOVER_BALANCE_TYPES = [
  "historical_advance",
  "abnormal_overpay"
] as const;

export type ContractTakeoverBalanceType =
  (typeof CONTRACT_TAKEOVER_BALANCE_TYPES)[number];

export const CONTRACT_TAKEOVER_BALANCE_ENTRY_KINDS = [
  "opening",
  "deduction",
  "correction",
  "reversal",
  "reclassification"
] as const;

export type ContractTakeoverBalanceEntryKind =
  (typeof CONTRACT_TAKEOVER_BALANCE_ENTRY_KINDS)[number];
