export const LEGACY_GENERAL_PROCUREMENT_CATEGORIES = [
  { key: "office_supplies", label: "办公用品" },
  { key: "construction_tools", label: "施工工具" },
  { key: "gifts", label: "礼品" },
  { key: "logistics", label: "后勤费用" },
  { key: "meals", label: "餐费" },
  { key: "utilities", label: "水电网费" },
  { key: "other", label: "其他物资或服务" }
] as const;
export const GENERAL_PROCUREMENT_CATEGORIES = [
  ...LEGACY_GENERAL_PROCUREMENT_CATEGORIES,
  { key: "equipment", label: "设备" },
  { key: "software", label: "软件" },
  { key: "services", label: "服务" }
] as const;
export type GeneralProcurementCategory = (typeof GENERAL_PROCUREMENT_CATEGORIES)[number]["key"];
export const GENERAL_PROCUREMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  approved_pending_procurement: "待综合部采购", draft: "草稿", approval_pending: "审批中", returned: "待修改", approved_pending_archive: "待综合部归档", archived: "已归档"
};

export type GeneralProcurementPaymentCategory = `procurement_${GeneralProcurementCategory}`;
export const GENERAL_PROCUREMENT_PAYMENT_CATEGORIES = GENERAL_PROCUREMENT_CATEGORIES.map((item) => `procurement_${item.key}` as GeneralProcurementPaymentCategory);

/** Request estimates are decimal text or unknown, never actual procurement cost. */
export interface GeneralProcurementRequestLine {
  id: string;
  name: string;
  specification: string | null;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  estimatedAmount: string | null;
  requiredOn: string | null;
  note: string | null;
}

export const GENERAL_PROCUREMENT_REQUEST_LINE_FIELDS = [
  { key: "name", label: "名称", type: "text", precision: 0, required: true, size: 180 },
  { key: "specification", label: "规格型号", type: "text", precision: 0, required: false, size: 160 },
  { key: "unit", label: "单位", type: "text", precision: 0, required: false, size: 80 },
  { key: "quantity", label: "预计数量", type: "number", precision: 4, required: false, size: 120 },
  { key: "unitPrice", label: "预计单价（元）", type: "money", precision: 4, required: false, size: 140 },
  { key: "estimatedAmount", label: "预计总价（元）", type: "money", precision: 4, required: false, size: 140 },
  { key: "requiredOn", label: "到位日期", type: "date", precision: 0, required: false, size: 140 },
  { key: "note", label: "采购说明", type: "long_text", precision: 0, required: false, size: 220 }
] as const;
