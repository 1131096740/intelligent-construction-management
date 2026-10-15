export const GENERAL_PROCUREMENT_CATEGORIES = [
  { key: "office_supplies", label: "办公用品" },
  { key: "construction_tools", label: "施工工具" },
  { key: "gifts", label: "礼品" },
  { key: "logistics", label: "后勤费用" },
  { key: "meals", label: "餐费" },
  { key: "utilities", label: "水电网费" },
  { key: "other", label: "其他物资或服务" }
] as const;
export type GeneralProcurementCategory = (typeof GENERAL_PROCUREMENT_CATEGORIES)[number]["key"];
export const GENERAL_PROCUREMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "草稿", approval_pending: "审批中", returned: "待修改", approved_pending_archive: "待综合部归档", archived: "已归档"
};

export type GeneralProcurementPaymentCategory = `procurement_${GeneralProcurementCategory}`;
export const GENERAL_PROCUREMENT_PAYMENT_CATEGORIES = GENERAL_PROCUREMENT_CATEGORIES.map((item) => `procurement_${item.key}` as GeneralProcurementPaymentCategory);
