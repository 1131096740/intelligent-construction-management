export const PROJECT_FUND_DISPUTE_SOURCE_TYPE =
  "project_fund_dispute_entry" as const;

export const PROJECT_FUND_DISPUTE_KINDS = Object.freeze([
  "upstream",
  "downstream",
  "inter_subject",
  "external_restriction"
] as const);
export type ProjectFundDisputeKind =
  (typeof PROJECT_FUND_DISPUTE_KINDS)[number];

export const PROJECT_FUND_DISPUTE_ENTRY_KINDS = Object.freeze([
  "establish",
  "increase",
  "release",
  "technical_reversal"
] as const);
export type ProjectFundDisputeEntryKind =
  (typeof PROJECT_FUND_DISPUTE_ENTRY_KINDS)[number];

export const PROJECT_FUND_DISPUTE_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "attested",
  "confirmed",
  "returned"
] as const);
export type ProjectFundDisputeStatus =
  (typeof PROJECT_FUND_DISPUTE_STATUSES)[number];

export const PROJECT_FUND_DISPUTE_TRANSITION_ACTIONS = Object.freeze([
  "submit",
  "attest",
  "confirm",
  "return"
] as const);
export type ProjectFundDisputeTransitionAction =
  (typeof PROJECT_FUND_DISPUTE_TRANSITION_ACTIONS)[number];

export const PROJECT_FUND_DISPUTE_KIND_LABELS = Object.freeze({
  upstream: "上游已收项目资金争议",
  downstream: "下游已持有项目资金争议",
  inter_subject: "施工企业与参与公司资金归属争议",
  external_restriction: "司法、行政或其他外部限制"
} as const satisfies Readonly<Record<ProjectFundDisputeKind, string>>);

export type ProjectFundDisputeFundHolderKind =
  | "construction_enterprise"
  | "participating_company";
