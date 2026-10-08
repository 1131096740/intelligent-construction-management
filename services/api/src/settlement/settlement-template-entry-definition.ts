import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

export const SETTLEMENT_TEMPLATE_COLUMNS = [
  "清单编码/行号", "清单项名称", "是否本期结算", "合同数量", "合同单价", "前期已结算数量",
  "本期数量", "累计结算数量", "剩余可结算数量", "本期结算金额(分)", "人工调整金额(分)",
  "调整原因", "证据说明", "异常说明", "备注"
] as const;

function field(key: string, label: string, type: BusinessEntryFieldDefinition["type"], options?: BusinessEntryFieldDefinition["options"], required = false): BusinessEntryFieldDefinition {
  const roles = ["contract_director", "super_admin"] as const;
  return { key, label, type, options, required, scope: "header", description: `结算模板的${label}`,
    example: `示例${label}`, unit: "", precision: 0, permissions: { view: roles, edit: roles },
    bulk: { enabled: false, strategy: "replace" }, excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: `以冻结的${label}为准` } };
}

export function settlementTemplateEntryDefinition(contractTypes: Array<{ value: string; label: string }> = []): BusinessEntrySceneDefinition {
  const columns = SETTLEMENT_TEMPLATE_COLUMNS.map(value => ({ value, label: value }));
  return { key: "settlement_template_version", entityType: "settlement_template_version", version: 2,
    name: "结算模板版本", description: "模板工作台与提交发布快照共用的字段定义；安全规则沿用原领域校验。", rules: [],
    fields: [
      field("name", "模板名称", "text", undefined, true), field("code", "模板编码", "text", undefined, true),
      field("sourceFileName", "模板源文件", "text", undefined, true),
      field("compatibleContractTypeKeys", "兼容合同类型", "multi_select", contractTypes),
      field("compatibleAmountRoles", "兼容金额角色", "multi_select", [
        { value: "included", label: "合同计价金额" }, { value: "reference", label: "参考价" },
        { value: "non_priced", label: "非计价" }, { value: "provisional", label: "暂定价" }
      ]),
      field("compatiblePricingModes", "兼容计价模式", "multi_select", [
        { value: "tax_inclusive", label: "含税计价" }, { value: "tax_exclusive", label: "不含税计价" }
      ]),
      field("requiredColumns", "明细必填列", "multi_select", columns),
      field("evidenceRequiredColumns", "证据必填列", "multi_select", columns),
      field("requirePrintArea", "检查打印区域", "boolean"),
      field("rejectNegativeOrdinaryRows", "拒绝负向普通行", "boolean"),
      field("requireAdjustmentReason", "检查调整原因", "boolean"),
      field("rejectFormula", "拒绝公式", "boolean"),
      field("rejectMergedDataCells", "拒绝合并数据单元格", "boolean")
    ] };
}

export const SETTLEMENT_TEMPLATE_ENTRY_DEFINITION = settlementTemplateEntryDefinition();
