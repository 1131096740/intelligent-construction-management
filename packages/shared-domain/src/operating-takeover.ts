import {
  EVIDENCE_LEVEL_LABELS,
  OPERATING_FACT_KIND_LABELS,
  PRIMARY_COST_CATEGORY_CODES,
  PRIMARY_COST_CATEGORY_LABELS,
  type EvidenceLevel,
  type OperatingFactKind
} from "./project-operating-contracts";
import type {
  BusinessEntryFieldDefinition,
  BusinessEntrySceneDefinition
} from "./business-entry-definition";
import type { RoleKey } from "./roles";

export const OPERATING_TAKEOVER_SCENE_KEYS = Object.freeze([
  "owner_settlement",
  "owner_payment",
  "construction_enterprise_company_payment",
  "construction_enterprise_downstream_payment",
  "construction_enterprise_deduction",
  "historical_expense",
  "employee_advance",
  "project_wage",
  "construction_enterprise_wage",
  "fund_movement",
  "invoice_tax_settlement",
  "financial_reconciliation"
] as const);

export type OperatingTakeoverSceneKey = (typeof OPERATING_TAKEOVER_SCENE_KEYS)[number];
export const OPERATING_TAKEOVER_COMBINED_WORKBOOK_KEY = "combined_workbook" as const;

export const OPERATING_TAKEOVER_PROFESSIONS = ["contract", "finance"] as const;
export type OperatingTakeoverProfession = (typeof OPERATING_TAKEOVER_PROFESSIONS)[number];

export const OPERATING_TAKEOVER_PROFESSION_LABELS = Object.freeze({
  contract: "合同专业",
  finance: "财务专业"
} as const satisfies Readonly<Record<OperatingTakeoverProfession, string>>);

export interface OperatingTakeoverSceneDefinition extends BusinessEntrySceneDefinition {
  key: OperatingTakeoverSceneKey;
  entityType: "operating_takeover_row";
  requiredProfessions: readonly OperatingTakeoverProfession[];
  defaultFactKind: OperatingFactKind;
}

const entryRoles = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director"
] as const satisfies readonly RoleKey[];
const reviewRoles = ["contract_director", "finance_director"] as const satisfies readonly RoleKey[];

const options = <const T extends readonly { value: string; label: string }[]>(items: T) => items;
const selectOptions = options([
  { value: "A", label: EVIDENCE_LEVEL_LABELS.A },
  { value: "B", label: EVIDENCE_LEVEL_LABELS.B },
  { value: "C", label: EVIDENCE_LEVEL_LABELS.C }
]);
const paymentStatusOptions = options([
  { value: "paid", label: "已付款" },
  { value: "unpaid", label: "未付款" },
  { value: "partially_paid", label: "部分付款" },
  { value: "not_applicable", label: "不涉及付款" }
]);
const employeeEntryTypeOptions = options([
  { value: "expense_advance", label: "员工垫付未报销" },
  { value: "disbursement", label: "借款发放" },
  { value: "offset", label: "报销冲账" },
  { value: "repayment", label: "员工还款" },
  { value: "reversal", label: "还款冲销" }
]);
const deductionTypeOptions = options([
  { value: "temporary_hold", label: "暂扣" },
  { value: "final_deduction", label: "最终扣费" },
  { value: "return", label: "退回" },
  { value: "adjustment", label: "补扣或调整" }
]);
const adjustmentDirectionOptions = options([
  { value: "increase", label: "增加扣费" },
  { value: "decrease", label: "减少扣费" }
]);
const costCategoryOptions = PRIMARY_COST_CATEGORY_CODES.map((value) => ({
  value,
  label: PRIMARY_COST_CATEGORY_LABELS[value]
}));

function field(
  key: string,
  label: string,
  type: BusinessEntryFieldDefinition["type"],
  overrides: Partial<BusinessEntryFieldDefinition> = {}
): BusinessEntryFieldDefinition {
  return {
    key,
    label,
    description: `${label}，请填写真实业务资料。`,
    example: type === "date" ? "2026-08-16" : type === "money" ? "10000.00" : "按资料填写",
    type,
    scope: "line",
    unit: type === "money" ? "元" : type === "date" ? "日" : "",
    precision: type === "money" ? 2 : 0,
    required: false,
    permissions: { view: entryRoles, edit: entryRoles, import: entryRoles, export: entryRoles },
    bulk: { enabled: true, maxRows: 500, strategy: "append" },
    excel: { column: label, paste: "multi", errorLocation: "cell" },
    display: {
      formHint: `请填写${label}`,
      gridColumn: label,
      mobilePriority: 5,
      readonlyText: `以已提交的${label}为准`
    },
    ...overrides
  };
}

const commonFields: readonly BusinessEntryFieldDefinition[] = [
  field("businessRef", "业务整理编号", "text", { required: true, format: { maxLength: 100 } }),
  field("occurredAt", "发生日期", "date", { required: true }),
  field("periodLabel", "所属期间", "text", { format: { maxLength: 50 } }),
  field("amountYuan", "金额", "money", { required: true }),
  field("counterpartyName", "相对方", "counterparty", { required: true }),
  field("costBearingCompanyName", "成本承担公司", "company"),
  field("actualPayerName", "实际付款方", "counterparty"),
  field("payeeName", "收款方", "counterparty"),
  field("paymentStatus", "付款状态", "single_select", { options: paymentStatusOptions }),
  field("costCategoryCode", "一级成本分类", "single_select", {
    options: costCategoryOptions,
    visibleWhen: { fieldKey: "amountYuan", operator: "neq", value: 0 }
  }),
  field("evidenceLevel", "证据等级", "single_select", { required: true, options: selectOptions }),
  field("sourceDescription", "资料来源", "long_text", { required: true, format: { maxLength: 500 } }),
  field("note", "补充说明", "long_text", { format: { maxLength: 1000 } })
];

const sceneFields: Partial<Record<OperatingTakeoverSceneKey, readonly BusinessEntryFieldDefinition[]>> = {
  construction_enterprise_deduction: [
    field("deductionType", "扣费类型", "single_select", { required: true, options: deductionTypeOptions }),
    field("originalFactId", "原扣费事实编号", "text", { format: { maxLength: 100 } }),
    field("adjustmentDirection", "调整方向", "single_select", { options: adjustmentDirectionOptions })
  ],
  employee_advance: [
    field("employeeName", "员工姓名", "text", { required: true, format: { maxLength: 100 } }),
    field("entryType", "员工往来类型", "single_select", { required: true, options: employeeEntryTypeOptions }),
    field("sourceRepaymentId", "原还款记录编号", "text", { format: { maxLength: 100 } }),
    field("adjustsFactId", "原经营事实编号", "text", { format: { maxLength: 100 } })
  ]
};

const SCENE_METADATA: Readonly<Record<OperatingTakeoverSceneKey, {
  name: string;
  description: string;
  requiredProfessions: readonly OperatingTakeoverProfession[];
  defaultFactKind: OperatingFactKind;
  requiredFields?: readonly string[];
}>> = {
  owner_settlement: {
    name: "业主结算",
    description: "接管业主结算及收入、应收依据，不录入合同专属接管资料。",
    requiredProfessions: ["contract", "finance"],
    defaultFactKind: "owner_settlement",
    requiredFields: ["counterpartyName"]
  },
  owner_payment: {
    name: "业主付款",
    description: "接管业主已向施工企业或项目付款的资金事实。",
    requiredProfessions: ["finance"],
    defaultFactKind: "owner_payment"
  },
  construction_enterprise_company_payment: {
    name: "施工企业向我方公司付款",
    description: "接管施工企业向我方参与公司付款的事实。",
    requiredProfessions: ["finance"],
    defaultFactKind: "owner_payment"
  },
  construction_enterprise_downstream_payment: {
    name: "施工企业直接向下游付款",
    description: "接管施工企业直接支付下游相对方的事实。",
    requiredProfessions: ["contract", "finance"],
    defaultFactKind: "downstream_payment"
  },
  construction_enterprise_deduction: {
    name: "施工企业扣费与退补",
    description: "接管施工企业暂扣、最终扣费、退回和补扣依据。",
    requiredProfessions: ["contract", "finance"],
    defaultFactKind: "construction_enterprise_deduction",
    requiredFields: ["costCategoryCode"]
  },
  historical_expense: {
    name: "无合同项目费用",
    description: "接管无合同零星材料和其他已发生项目费用。",
    requiredProfessions: ["finance"],
    defaultFactKind: "expense",
    requiredFields: ["costCategoryCode"]
  },
  employee_advance: {
    name: "员工垫资、报销与借款冲账",
    description: "接管员工垫付、报销清偿、借款和冲账事实。",
    requiredProfessions: ["finance"],
    defaultFactKind: "employee_loan",
    requiredFields: ["employeeName", "costBearingCompanyName"]
  },
  project_wage: {
    name: "我方项目管理人员工资",
    description: "接管我方项目管理人员工资承担和应付事实。",
    requiredProfessions: ["finance"],
    defaultFactKind: "project_wage",
    requiredFields: ["costBearingCompanyName"]
  },
  construction_enterprise_wage: {
    name: "施工企业派驻人员工资",
    description: "接管施工企业派驻人员工资，不与我方工资混账。",
    requiredProfessions: ["finance"],
    defaultFactKind: "project_wage",
    requiredFields: ["costBearingCompanyName"]
  },
  fund_movement: {
    name: "项目及公司间资金调度",
    description: "接管我方公司之间、项目之间的资金调拨和垫资归还。",
    requiredProfessions: ["finance"],
    defaultFactKind: "fund_movement",
    requiredFields: ["actualPayerName", "payeeName"]
  },
  invoice_tax_settlement: {
    name: "发票与税费清算依据",
    description: "接管发票、税费和施工企业清算依据，不自动产生收入或成本。",
    requiredProfessions: ["finance"],
    defaultFactKind: "invoice"
  },
  financial_reconciliation: {
    name: "外部财务对账",
    description: "接管外部对账值和差异依据，不覆盖正式经营事实。",
    requiredProfessions: ["finance"],
    defaultFactKind: "invoice"
  }
};

function sceneDefinition(key: OperatingTakeoverSceneKey): OperatingTakeoverSceneDefinition {
  const metadata = SCENE_METADATA[key];
  const required = new Set(metadata.requiredFields ?? []);
  return {
    key,
    entityType: "operating_takeover_row",
    name: metadata.name,
    description: metadata.description,
    version: 1,
    requiredProfessions: metadata.requiredProfessions,
    defaultFactKind: metadata.defaultFactKind,
    fields: [...commonFields, ...(sceneFields[key] ?? [])].map((definition) => ({
      ...definition,
      required: definition.required || required.has(definition.key),
      permissions: {
        ...definition.permissions,
        sensitive: definition.key === "amountYuan" ? reviewRoles : undefined
      }
    })),
    rules: [
      {
        key: "c_level_is_gap_only",
        kind: "forbidden_if",
        when: { fieldKey: "evidenceLevel", operator: "eq", value: "C" },
        fieldKey: "paymentStatus",
        message: "C级资料只能列入历史缺口，不能形成正式经营事实"
      }
    ],
    permissions: { view: entryRoles, edit: entryRoles, import: entryRoles, export: entryRoles }
  };
}

export const OPERATING_TAKEOVER_SCENE_DEFINITIONS: readonly OperatingTakeoverSceneDefinition[] =
  Object.freeze(OPERATING_TAKEOVER_SCENE_KEYS.map(sceneDefinition));

export const OPERATING_TAKEOVER_SCENE_LABELS = Object.freeze(
  Object.fromEntries(
    OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((scene) => [scene.key, scene.name])
  ) as Record<OperatingTakeoverSceneKey, string>
);

export function getOperatingTakeoverSceneDefinition(
  sceneKey: string
): OperatingTakeoverSceneDefinition | undefined {
  return OPERATING_TAKEOVER_SCENE_DEFINITIONS.find((scene) => scene.key === sceneKey);
}

export function operatingTakeoverEvidenceLabel(level: EvidenceLevel): string {
  return EVIDENCE_LEVEL_LABELS[level];
}

export function operatingTakeoverFactKindLabel(kind: OperatingFactKind): string {
  return OPERATING_FACT_KIND_LABELS[kind];
}
