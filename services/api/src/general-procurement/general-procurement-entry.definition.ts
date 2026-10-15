import { ACTION_REQUIRED_ROLES, GENERAL_PROCUREMENT_CATEGORIES, type BusinessEntryFieldDefinition, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
const roles = ACTION_REQUIRED_ROLES["expense_claim.create"];
const field = (key: string, label: string, type: BusinessEntryFieldDefinition["type"], options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition => ({
  key, label, type, description: label, example: "按实际需求填写", scope: "header", unit: type === "money" ? "元" : "", precision: type === "money" ? 2 : 0, required: true,
  permissions: { view: roles, edit: roles, import: roles, export: roles }, display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: label },
  excel: { column: label, paste: "single", errorLocation: "cell" }, bulk: { enabled: false, maxRows: 1, strategy: "append" }, ...options
});
export const GENERAL_PROCUREMENT_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "general_procurement.application", entityType: "general_procurement", name: "综合采购申请", description: "项目物资、服务和日常费用需求", version: 1,
  fields: [field("projectId", "所属项目", "single_select"), field("companyEntityId", "费用承担公司", "company"),
    field("category", "采购或费用类别", "single_select", { options: GENERAL_PROCUREMENT_CATEGORIES.map((item) => ({ value: item.key, label: item.label })) }),
    field("requestedAmountYuan", "申请金额", "money"), field("reason", "采购内容及用途", "long_text")], rules: []
};
