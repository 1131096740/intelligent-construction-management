import { ACTION_REQUIRED_ROLES, GENERAL_PROCUREMENT_CATEGORIES, LEGACY_GENERAL_PROCUREMENT_CATEGORIES, GENERAL_PROCUREMENT_REQUEST_LINE_FIELDS, ROLE_KEYS, type BusinessEntryFieldDefinition, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
const roles = ACTION_REQUIRED_ROLES["expense_claim.create"];
const field = (key: string, label: string, type: BusinessEntryFieldDefinition["type"], options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition => ({
  key, label, type, description: label, example: "按实际需求填写", scope: "header", unit: type === "money" ? "元" : "", precision: type === "money" ? 2 : 0, required: true,
  permissions: { view: roles, edit: roles, import: roles, export: roles }, display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: label },
  excel: { column: label, paste: "single", errorLocation: "cell" }, bulk: { enabled: false, maxRows: 1, strategy: "append" }, ...options
});
export const GENERAL_PROCUREMENT_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "general_procurement.application", entityType: "general_procurement", name: "综合采购申请", description: "项目物资、服务和日常费用需求", version: 1,
  fields: [field("projectId", "所属项目", "single_select"), field("companyEntityId", "费用承担公司", "company"),
    field("category", "采购或费用类别", "single_select", { options: LEGACY_GENERAL_PROCUREMENT_CATEGORIES.map((item) => ({ value: item.key, label: item.label })) }),
    field("requestedAmountYuan", "申请金额", "money"), field("reason", "采购内容及用途", "long_text")], rules: []
};

const requestField = (key: string, label: string, type: BusinessEntryFieldDefinition["type"], options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition =>
  field(key, label, type, { required: false, permissions: { view: ROLE_KEYS, edit: ROLE_KEYS, import: ROLE_KEYS, export: ROLE_KEYS }, ...options });
export const GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "general_procurement.request", entityType: "general_procurement", name: "综合采购需求申请", description: "项目或公司日常需求，未知与零分别保存", version: 2,
  fields: [
    requestField("scope", "采购范围", "single_select", { required: true, options: [{ value: "project", label: "项目采购" }, { value: "company_daily", label: "公司日常采购" }] }),
    requestField("projectId", "所属项目", "single_select", { visibleWhen: { fieldKey: "scope", operator: "eq", value: "project" } }),
    requestField("companyEntityId", "费用承担公司", "company"),
    requestField("category", "采购或费用类别", "single_select", { required: true, options: GENERAL_PROCUREMENT_CATEGORIES.map(item => ({ value: item.key, label: item.label })) }),
    requestField("estimatedAmount", "整单独立预计金额", "money", { precision: 4, exactDecimalString: { sign: "nonnegative" } }),
    requestField("reason", "采购内容及用途", "long_text"),
    ...GENERAL_PROCUREMENT_REQUEST_LINE_FIELDS.map(item => requestField(item.key, item.label, item.type, { scope: "line", precision: item.precision, required: item.required,
      ...(item.type === "money" || item.type === "number" ? { exactDecimalString: { sign: "nonnegative" as const, maximumExclusive: item.key === "quantity" ? "1000000000000000000" : "100000000000000000000" } } : {}),
      bulk: { enabled: true, maxRows: 500, strategy: "append" }, excel: { column: item.label, paste: "multi", errorLocation: "cell" } }))
  ],
  rules: [{ key: "project_required", kind: "required_if", when: { fieldKey: "scope", operator: "eq", value: "project" }, fieldKey: "projectId", message: "项目采购请选择所属项目" },
    { key: "company_daily_no_project", kind: "forbidden_if", when: { fieldKey: "scope", operator: "eq", value: "company_daily" }, fieldKey: "projectId", message: "公司日常采购不应选择项目" }]
};
