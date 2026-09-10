export const NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE =
  "project_necessary_expense_reserve_entry" as const;

export const NECESSARY_EXPENSE_RESERVE_REASON_KINDS = Object.freeze([
  "warranty_or_remediation",
  "legal_or_compliance",
  "mandatory_closeout",
  "other_approved_necessary"
] as const);
export type NecessaryExpenseReserveReasonKind =
  (typeof NECESSARY_EXPENSE_RESERVE_REASON_KINDS)[number];

export const NECESSARY_EXPENSE_RESERVE_ENTRY_KINDS = Object.freeze([
  "establish",
  "increase",
  "release",
  "technical_reversal"
] as const);
export type NecessaryExpenseReserveEntryKind =
  (typeof NECESSARY_EXPENSE_RESERVE_ENTRY_KINDS)[number];

export const NECESSARY_EXPENSE_RESERVE_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "attested",
  "confirmed",
  "returned"
] as const);
export type NecessaryExpenseReserveStatus =
  (typeof NECESSARY_EXPENSE_RESERVE_STATUSES)[number];

export const NECESSARY_EXPENSE_RESERVE_TRANSITION_ACTIONS = Object.freeze([
  "submit",
  "attest",
  "confirm",
  "return"
] as const);
export type NecessaryExpenseReserveTransitionAction =
  (typeof NECESSARY_EXPENSE_RESERVE_TRANSITION_ACTIONS)[number];

export const NECESSARY_EXPENSE_RESERVE_REASON_LABELS = Object.freeze({
  warranty_or_remediation: "质保、返修或缺陷整改准备",
  legal_or_compliance: "法律、合规或行政事项准备",
  mandatory_closeout: "项目收尾必要支出准备",
  other_approved_necessary: "其他已批准必要准备"
} as const satisfies Readonly<Record<NecessaryExpenseReserveReasonKind, string>>);

export type NecessaryExpenseReserveFundHolderKind =
  | "construction_enterprise"
  | "participating_company";
