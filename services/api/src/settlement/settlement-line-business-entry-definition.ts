import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

type SettlementLineFacts = {
  sourceType: string;
  adjustmentKind?: string | null;
  contractBillRowId?: string | null;
  sourceItemType?: string | null;
  occurredOn?: Date | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  quantity?: { toString(): string } | string | number | null;
  unitPriceCents?: bigint | string | null;
  directAmountCents?: bigint | string | null;
  amountCents?: bigint | string | null;
  pricingBasis?: string | null;
  overageReason?: string | null;
  relatedSettlementLineId?: string | null;
  reason?: string | null;
  remark?: string | null;
};

const permissions = { view: ["contract_staff"], edit: ["contract_staff"] } as const;
const options = (value: string | null | undefined, label: string) => value ? [{ value, label }] : [];

function field(key: string, label: string, type: BusinessEntryFieldDefinition["type"], order: number,
  required = false, fieldOptions?: BusinessEntryFieldDefinition["options"]): BusinessEntryFieldDefinition {
  return {
    key, label, type, order, required, options: fieldOptions, scope: "line",
    description: `来自结算明细的${label}。`, example: `示例${label}`,
    unit: type === "money" ? "元" : "", precision: type === "money" ? 2 : type === "number" ? 6 : 0,
    permissions, bulk: { enabled: true, maxRows: 500, strategy: "replace" },
    excel: { column: label, paste: "multi", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: order, readonlyText: `以提交时的${label}为准` }
  };
}

export function settlementLineEntryDefinition(facts?: SettlementLineFacts): BusinessEntrySceneDefinition {
  return {
    key: "settlement_line", entityType: "settlement_line", version: 1,
    name: "结算明细", description: "本次结算提交时冻结的逐行业务事实。", rules: [],
    fields: [
      field("sourceType", "明细来源", "single_select", 1, true, [
        { value: "contract_bill_row", label: "合同清单" }, { value: "visa_change", label: "签证变更" },
        { value: "manual_adjustment", label: "人工调整" }
      ]),
      field("adjustmentKind", "调整类型", "single_select", 2, false, [
        { value: "ordinary", label: "普通调整" }, { value: "retrospective_price_difference", label: "追溯价差" },
        { value: "over_settlement_offset", label: "超结冲减" }
      ]),
      field("contractBillRowId", "合同清单项", "single_select", 3, false, options(facts?.contractBillRowId, "已选合同清单项")),
      field("sourceItemType", "签证或变更类别", "text", 4), field("occurredOn", "发生日期", "date", 5),
      field("name", "明细名称", "text", 6, true), field("description", "项目说明", "long_text", 7),
      field("unit", "单位", "text", 8), field("quantity", "数量", "number", 9),
      field("unitPriceYuan", "单价", "money", 10), field("amountYuan", "本期金额", "money", 11, true),
      field("pricingBasis", "计价依据", "long_text", 12), field("overageReason", "超量说明", "long_text", 13),
      field("relatedSettlementLineId", "原结算行", "single_select", 14, false, options(facts?.relatedSettlementLineId, "已选原结算行")),
      field("reason", "业务原因", "long_text", 15), field("remark", "备注", "long_text", 16)
    ]
  };
}

function yuan(value: bigint | string | null | undefined) {
  return value == null ? undefined : formatMoneyCentsAsPlainYuan(typeof value === "bigint" ? value : BigInt(value));
}

export function settlementLineEntryValues(facts: SettlementLineFacts): Record<string, unknown> {
  const amount = facts.amountCents ?? facts.directAmountCents;
  const values: Record<string, unknown> = { sourceType: facts.sourceType, name: facts.name };
  const optional = {
    adjustmentKind: facts.adjustmentKind, contractBillRowId: facts.contractBillRowId,
    sourceItemType: facts.sourceItemType, occurredOn: facts.occurredOn?.toISOString().slice(0, 10),
    description: facts.description, unit: facts.unit, quantity: facts.quantity?.toString(),
    unitPriceYuan: yuan(facts.unitPriceCents), amountYuan: yuan(amount), pricingBasis: facts.pricingBasis,
    overageReason: facts.overageReason, relatedSettlementLineId: facts.relatedSettlementLineId,
    reason: facts.reason, remark: facts.remark
  };
  for (const [key, value] of Object.entries(optional)) if (value !== null && value !== undefined && value !== "") values[key] = value;
  return values;
}

export const SETTLEMENT_LINE_ENTRY_DEFINITION = settlementLineEntryDefinition();
