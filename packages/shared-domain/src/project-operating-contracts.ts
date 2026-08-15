function freezeCatalog<const T extends readonly Readonly<Record<string, unknown>>[]>(
  catalog: T
): T {
  for (const item of catalog) Object.freeze(item);
  return Object.freeze(catalog);
}

export const OPERATING_FACT_KINDS = Object.freeze([
  "owner_settlement",
  "owner_payment",
  "downstream_settlement",
  "downstream_payment",
  "expense",
  "employee_loan",
  "project_wage",
  "construction_enterprise_deduction",
  "invoice",
  "fund_movement",
  "profit_distribution",
  "historical_gap"
] as const);

export type OperatingFactKind = (typeof OPERATING_FACT_KINDS)[number];

export const OPERATING_FACT_KIND_LABELS = Object.freeze({
  owner_settlement: "业主结算",
  owner_payment: "业主付款",
  downstream_settlement: "下游结算",
  downstream_payment: "下游付款",
  expense: "项目费用",
  employee_loan: "员工借款往来",
  project_wage: "项目工资承担",
  construction_enterprise_deduction: "施工企业扣费",
  invoice: "发票事实",
  fund_movement: "项目资金流动",
  profit_distribution: "项目盈亏分配",
  historical_gap: "历史资料缺口"
} as const satisfies Readonly<Record<OperatingFactKind, string>>);

export const OPERATING_IMPACT_KINDS = Object.freeze([
  "confirmed_income",
  "confirmed_cost",
  "estimated_clearing_expense",
  "receivable_increase",
  "receivable_decrease",
  "payable_increase",
  "payable_decrease",
  "construction_enterprise_funds_increase",
  "construction_enterprise_funds_decrease",
  "construction_enterprise_funds_freeze",
  "construction_enterprise_funds_release",
  "company_project_funds_increase",
  "company_project_funds_decrease",
  "company_advance_for_project_increase",
  "company_advance_for_project_decrease",
  "company_returnable_to_project_increase",
  "company_returnable_to_project_decrease",
  "inter_subject_balance_increase",
  "inter_subject_balance_decrease",
  "temporary_profit_distribution",
  "final_profit_distribution",
  "profit_distribution_adjustment",
  "invoice_reference",
  "evidence_gap_notice"
] as const);

export type OperatingImpactKind = (typeof OPERATING_IMPACT_KINDS)[number];

export const OPERATING_IMPACT_KIND_LABELS = Object.freeze({
  confirmed_income: "已确认收入",
  confirmed_cost: "已确认成本",
  estimated_clearing_expense: "预计待清算费用",
  receivable_increase: "应收增加",
  receivable_decrease: "应收减少",
  payable_increase: "应付增加",
  payable_decrease: "应付减少",
  construction_enterprise_funds_increase: "施工企业项目资金增加",
  construction_enterprise_funds_decrease: "施工企业项目资金减少",
  construction_enterprise_funds_freeze: "施工企业项目资金冻结",
  construction_enterprise_funds_release: "施工企业项目资金解除冻结",
  company_project_funds_increase: "我方公司项目资金增加",
  company_project_funds_decrease: "我方公司项目资金减少",
  company_advance_for_project_increase: "公司为项目垫资增加",
  company_advance_for_project_decrease: "公司为项目垫资减少",
  company_returnable_to_project_increase: "公司应归还项目款增加",
  company_returnable_to_project_decrease: "公司应归还项目款减少",
  inter_subject_balance_increase: "主体间往来增加",
  inter_subject_balance_decrease: "主体间往来减少",
  temporary_profit_distribution: "暂分利润",
  final_profit_distribution: "最终利润分配",
  profit_distribution_adjustment: "盈亏分配退补",
  invoice_reference: "发票登记依据",
  evidence_gap_notice: "历史资料缺口提示"
} as const satisfies Readonly<Record<OperatingImpactKind, string>>);

export const OPERATING_SUBJECT_KINDS = Object.freeze([
  "owner",
  "construction_enterprise",
  "participating_company",
  "downstream_counterparty",
  "employee"
] as const);

export type OperatingSubjectKind = (typeof OPERATING_SUBJECT_KINDS)[number];

export const OPERATING_SUBJECT_KIND_LABELS = Object.freeze({
  owner: "业主",
  construction_enterprise: "施工企业",
  participating_company: "我方参与公司",
  downstream_counterparty: "下游相对方",
  employee: "员工或其他个人"
} as const satisfies Readonly<Record<OperatingSubjectKind, string>>);

export const OPERATING_SUBJECT_ROLES = Object.freeze([
  "debtor",
  "creditor",
  "approved_payer",
  "actual_payer",
  "payee",
  "cost_bearing_company"
] as const);

export type OperatingSubjectRole = (typeof OPERATING_SUBJECT_ROLES)[number];

export const OPERATING_SUBJECT_ROLE_LABELS = Object.freeze({
  debtor: "债务主体",
  creditor: "债权主体",
  approved_payer: "批准付款主体",
  actual_payer: "实际付款主体",
  payee: "收款主体",
  cost_bearing_company: "成本承担公司"
} as const satisfies Readonly<Record<OperatingSubjectRole, string>>);

export const EVIDENCE_LEVELS = Object.freeze(["A", "B", "C"] as const);
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_LEVEL_LABELS = Object.freeze({
  A: "A级逐笔可靠事实",
  B: "B级受控汇总事实",
  C: "C级历史资料缺口"
} as const satisfies Readonly<Record<EvidenceLevel, string>>);

export const DEDUCTION_LIFECYCLES = Object.freeze([
  "estimated",
  "withheld",
  "final_confirmed",
  "supplemental",
  "returned",
  "pending_reconciliation"
] as const);

export type DeductionLifecycle = (typeof DEDUCTION_LIFECYCLES)[number];

export const DEDUCTION_LIFECYCLE_LABELS = Object.freeze({
  estimated: "预计扣费",
  withheld: "暂扣或预结算",
  final_confirmed: "最终确认",
  supplemental: "补扣",
  returned: "退回",
  pending_reconciliation: "待核对扣费"
} as const satisfies Readonly<Record<DeductionLifecycle, string>>);

export const PROJECT_STAGES = Object.freeze([
  "construction_completed",
  "owner_settlement_completed",
  "downstream_cost_confirmed",
  "tax_and_enterprise_clearing_completed",
  "final_profit_confirmed",
  "profit_distribution_completed",
  "project_funds_cleared"
] as const);

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS = Object.freeze({
  construction_completed: "工程完工",
  owner_settlement_completed: "对上结算完成",
  downstream_cost_confirmed: "下游成本确认完成",
  tax_and_enterprise_clearing_completed: "税费和施工企业清算完成",
  final_profit_confirmed: "项目最终盈亏确认",
  profit_distribution_completed: "盈亏分配完成",
  project_funds_cleared: "项目资金结清"
} as const satisfies Readonly<Record<ProjectStage, string>>);

export const PROJECT_OPERATING_TAKEOVER_STATUSES = Object.freeze([
  "preparing",
  "operating_with_takeover",
  "balance_review",
  "takeover_completed",
  "supplemental_review"
] as const);

export type ProjectOperatingTakeoverStatus =
  (typeof PROJECT_OPERATING_TAKEOVER_STATUSES)[number];

export const PROJECT_OPERATING_TAKEOVER_STATUS_LABELS = Object.freeze({
  preparing: "准备中",
  operating_with_takeover: "正式使用、历史接管中",
  balance_review: "余额复核中",
  takeover_completed: "经营接管完成",
  supplemental_review: "需要补充复核"
} as const satisfies Readonly<Record<ProjectOperatingTakeoverStatus, string>>);

export const FINANCIAL_RECONCILIATION_STATUSES = Object.freeze([
  "matched",
  "partially_matched",
  "not_matched",
  "difference_found"
] as const);

export type FinancialReconciliationStatus =
  (typeof FINANCIAL_RECONCILIATION_STATUSES)[number];

export const FINANCIAL_RECONCILIATION_STATUS_LABELS = Object.freeze({
  matched: "已与财务账核对",
  partially_matched: "部分核对",
  not_matched: "尚未核对",
  difference_found: "存在差异"
} as const satisfies Readonly<Record<FinancialReconciliationStatus, string>>);

export const PRIMARY_COST_CATEGORY_CODES = Object.freeze([
  "material",
  "crew_and_labor",
  "professional_subcontract",
  "machinery_and_rental",
  "site_construction_and_measures",
  "project_daily_expense",
  "construction_enterprise_deduction",
  "other_project_cost"
] as const);

export type PrimaryCostCategoryCode = (typeof PRIMARY_COST_CATEGORY_CODES)[number];

export const PRIMARY_COST_CATEGORY_LABELS = Object.freeze({
  material: "材料成本",
  crew_and_labor: "班组及人工成本",
  professional_subcontract: "专业分包成本",
  machinery_and_rental: "机械设备及租赁成本",
  site_construction_and_measures: "现场施工及措施费用",
  project_daily_expense: "项目日常费用",
  construction_enterprise_deduction: "施工企业扣费",
  other_project_cost: "其他项目成本"
} as const satisfies Readonly<Record<PrimaryCostCategoryCode, string>>);

export const PRIMARY_COST_CATEGORIES = freezeCatalog([
  { code: "material", name: "材料成本" },
  { code: "crew_and_labor", name: "班组及人工成本" },
  { code: "professional_subcontract", name: "专业分包成本" },
  { code: "machinery_and_rental", name: "机械设备及租赁成本" },
  { code: "site_construction_and_measures", name: "现场施工及措施费用" },
  { code: "project_daily_expense", name: "项目日常费用" },
  { code: "construction_enterprise_deduction", name: "施工企业扣费" },
  { code: "other_project_cost", name: "其他项目成本" }
] as const satisfies readonly {
  code: PrimaryCostCategoryCode;
  name: (typeof PRIMARY_COST_CATEGORY_LABELS)[PrimaryCostCategoryCode];
}[]);

export const CONTROLLED_SECONDARY_COST_CATEGORY_POLICY = Object.freeze({
  mustBelongToOnePrimaryCategory: true,
  nameMustUseChineseBusinessLanguage: true,
  projectMayCreatePrimaryCategory: false,
  projectMayRenamePrimaryCategory: false
} as const);

export const CONSTRUCTION_ENTERPRISE_DEDUCTION_SECONDARY_CATEGORIES = freezeCatalog([
  {
    code: "management_fee",
    name: "管理费",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "final_tax",
    name: "最终税费",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "deposit",
    name: "保证金",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "insurance_fee",
    name: "保险费",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "service_fee",
    name: "手续费",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "resident_management_wage",
    name: "派驻管理人员工资",
    primaryCategoryCode: "construction_enterprise_deduction"
  },
  {
    code: "other_deduction",
    name: "其他扣费",
    primaryCategoryCode: "construction_enterprise_deduction"
  }
] as const);

export const OPERATING_AMOUNT_UNIT_POLICY = Object.freeze({
  storedAndCalculated: "cent",
  apiAmountText: "cent",
  pageInputAndDisplay: "yuan",
  excelInputAndExport: "yuan"
} as const);
