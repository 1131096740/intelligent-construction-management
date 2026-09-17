import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

function settlementField(key: string, label: string, example: string, order: number): BusinessEntryFieldDefinition {
  return {
    key, label, type: "text", order, scope: "header",
    description: `请按本次结算填写${label}。`, example,
    unit: "", precision: 0, required: true,
    permissions: { view: ["contract_staff"], edit: ["contract_staff"] },
    bulk: { enabled: false, strategy: "replace" },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: order, readonlyText: `以提交时的${label}为准` }
  };
}

export const SETTLEMENT_BASIC_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "settlement_basic", entityType: "settlement", version: 1,
  name: "结算基础信息", description: "本次结算的编号与期间。", rules: [],
  fields: [settlementField("code", "结算编号", "JS-2026-001", 1), settlementField("periodLabel", "结算期间", "2026-09", 2)]
};
