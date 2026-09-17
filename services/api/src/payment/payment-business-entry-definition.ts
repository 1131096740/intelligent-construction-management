import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

function financeField(key: string, label: string, type: BusinessEntryFieldDefinition["type"], order: number): BusinessEntryFieldDefinition {
  return {
    key, label, type, order, scope: "header", description: `请按实际入账情况填写${label}。`,
    example: key === "amountYuan" ? "100.00" : "2026-09-17T04:34:56.000Z",
    unit: "", precision: key === "amountYuan" ? 2 : 0, required: true,
    permissions: { view: ["finance_staff", "finance_director"], edit: ["finance_staff", "finance_director"] },
    bulk: { enabled: false, strategy: "replace" },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: order, readonlyText: `以本次登记的${label}为准` }
  };
}

export const PAYMENT_FINANCE_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "payment_finance_record", entityType: "finance_record", version: 1,
  name: "财务入账", description: "按已实付金额登记财务入账。", rules: [],
  // Full ISO datetime remains governed by the original DTO and date-time control.
  fields: [financeField("amountYuan", "入账金额", "money", 1), financeField("occurredAt", "入账时间", "text", 2)]
};
