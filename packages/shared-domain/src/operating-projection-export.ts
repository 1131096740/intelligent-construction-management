import type { OperatingFactKind, OperatingImpactKind } from "./project-operating-contracts";

export const OPERATING_PROJECTION_EXPORT_KINDS = Object.freeze([
  "project_operating_ledger_detail",
  "construction_enterprise_funds_reconciliation",
  "company_project_funds_subledger",
  "receivable_payable_cashflow_detail",
  "takeover_coverage_evidence_gap"
] as const);
export type OperatingProjectionExportKind = (typeof OPERATING_PROJECTION_EXPORT_KINDS)[number];
export const OPERATING_PROJECTION_ROW_STATUSES = Object.freeze([
  "confirmed", "retroactive_confirmation", "pending_reconciliation"
] as const);
export type OperatingProjectionRowStatus = (typeof OPERATING_PROJECTION_ROW_STATUSES)[number];
export const OPERATING_PROJECTION_ROW_STATUS_LABELS = Object.freeze({
  confirmed: "已确认",
  retroactive_confirmation: "追溯确认",
  pending_reconciliation: "待核对"
} satisfies Readonly<Record<OperatingProjectionRowStatus, string>>);
export interface OperatingProjectionExportFilters {
  occurredFrom?: string;
  occurredTo?: string;
  rowStatus?: OperatingProjectionRowStatus;
}

// Read-side catalog only: registering a source here does not authorize a writer.
export const OPERATING_SOURCE_TYPES = Object.freeze([
  "owner_settlement", "project_upstream_settlement", "project_upstream_fund_fact",
  "project_affiliate_contract_fact", "project_affiliate_settlement_fact",
  "project_affiliate_payment_fact", "project_proxy_payment", "contract_version",
  "settlement", "payment_execution", "expense_claim_approval",
  "expense_claim_payment_execution", "employee_project_loan_entry",
  "spot_procurement_receipt_review", "spot_procurement_payment_execution",
  "spot_procurement_refund", "spot_procurement_invoice_record",
  "contract_takeover_historical_payment", "project_expense_execution",
  "expense_claim", "expense_claim_execution", "wage_statement_version", "fund_movement", "fund_execution",
  "clearing_event_version", "project_necessary_expense_reserve_entry",
  "project_fund_dispute_entry", "operating_takeover"
] as const);
export type OperatingSourceType = (typeof OPERATING_SOURCE_TYPES)[number];
export const OPERATING_PROJECTION_RISK_IMPACTS = Object.freeze([
  "clearing_open_reconciliation_risk", "clearing_continued_withheld_risk"
] as const);
type ExportImpactKind = OperatingImpactKind | (typeof OPERATING_PROJECTION_RISK_IMPACTS)[number];
type ExportFactKind = OperatingFactKind | "clearing_reconciliation_risk";
const ledger = "project_operating_ledger_detail";
const enterprise = "construction_enterprise_funds_reconciliation";
const company = "company_project_funds_subledger";
const cashflow = "receivable_payable_cashflow_detail";
const takeover = "takeover_coverage_evidence_gap";
const none = Object.freeze([] as OperatingProjectionExportKind[]);
const all = Object.freeze([ledger] as const);
const ce = Object.freeze([ledger, enterprise] as const);
const co = Object.freeze([ledger, company] as const);
const ceCash = Object.freeze([ledger, enterprise, cashflow] as const);
const coCash = Object.freeze([ledger, company, cashflow] as const);
const flow = Object.freeze([ledger, cashflow] as const);
const history = Object.freeze([takeover] as const);

export const OPERATING_EXPORT_SOURCE_KINDS = Object.freeze({
  owner_settlement: none, project_upstream_settlement: none, project_upstream_fund_fact: none,
  project_affiliate_contract_fact: none, project_affiliate_settlement_fact: none,
  project_affiliate_payment_fact: none, project_proxy_payment: none, contract_version: none,
  settlement: none, payment_execution: none, expense_claim_approval: none,
  expense_claim_payment_execution: none, employee_project_loan_entry: none,
  spot_procurement_receipt_review: none, spot_procurement_payment_execution: none,
  spot_procurement_refund: none, spot_procurement_invoice_record: none,
  contract_takeover_historical_payment: history, project_expense_execution: none,
  expense_claim: none, expense_claim_execution: none, wage_statement_version: none,
  fund_movement: none, fund_execution: none, clearing_event_version: none, project_necessary_expense_reserve_entry: none,
  project_fund_dispute_entry: none, operating_takeover: history
} satisfies Readonly<Record<OperatingSourceType, readonly OperatingProjectionExportKind[]>>);
export const OPERATING_EXPORT_FACT_KINDS = Object.freeze({
  owner_settlement: none, owner_payment: none, downstream_contract: none,
  downstream_settlement: none, downstream_payment: none, expense: none, employee_loan: none,
  project_wage: none, construction_enterprise_deduction: Object.freeze([enterprise]),
  invoice: none, fund_movement: none, profit_distribution: none, project_cash_restriction: none,
  historical_gap: none, clearing_reconciliation_risk: none
} satisfies Readonly<Record<ExportFactKind, readonly OperatingProjectionExportKind[]>>);
export const OPERATING_EXPORT_IMPACT_KINDS = Object.freeze({
  confirmed_income: all, confirmed_cost: all, contract_commitment_reference: all,
  estimated_clearing_expense: ce, necessary_expense_reserve_increase: ce,
  necessary_expense_reserve_decrease: ce, project_disputed_funds_increase: ce,
  project_disputed_funds_decrease: ce, receivable_increase: flow, receivable_decrease: flow,
  payable_increase: flow, payable_decrease: flow, construction_enterprise_funds_increase: ceCash,
  construction_enterprise_funds_decrease: ceCash, construction_enterprise_funds_freeze: ce,
  construction_enterprise_funds_release: ce, company_project_funds_increase: coCash,
  company_project_funds_decrease: coCash, company_advance_for_project_increase: co,
  company_advance_for_project_decrease: co, company_returnable_to_project_increase: co,
  company_returnable_to_project_decrease: co, inter_subject_balance_increase: co,
  inter_subject_balance_decrease: co, temporary_profit_distribution: co,
  final_profit_distribution: co, profit_distribution_adjustment: co, invoice_reference: all,
  evidence_gap_notice: Object.freeze([ledger, takeover]),
  clearing_open_reconciliation_risk: ce, clearing_continued_withheld_risk: ce
} satisfies Readonly<Record<ExportImpactKind, readonly OperatingProjectionExportKind[]>>);

// null means unknown input and must be rejected, even if the row would be filtered out.
export function operatingProjectionExportMatches(
  kind: OperatingProjectionExportKind, source: string, fact: string, impact: string,
  evidenceLevel: string | null
): boolean | null {
  if (!Object.hasOwn(OPERATING_EXPORT_SOURCE_KINDS, source) ||
      !Object.hasOwn(OPERATING_EXPORT_FACT_KINDS, fact) ||
      !Object.hasOwn(OPERATING_EXPORT_IMPACT_KINDS, impact)) return null;
  const includes = (values: readonly OperatingProjectionExportKind[]) => values.includes(kind);
  return includes(OPERATING_EXPORT_SOURCE_KINDS[source as OperatingSourceType]) ||
    includes(OPERATING_EXPORT_FACT_KINDS[fact as ExportFactKind]) ||
    includes(OPERATING_EXPORT_IMPACT_KINDS[impact as ExportImpactKind]) ||
    (kind === takeover && evidenceLevel === "C");
}
