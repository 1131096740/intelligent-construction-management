export const SPOT_PROCUREMENT_BUSINESS_TYPES = {
  application: "spot_procurement_version",
  payment: "spot_procurement_payment",
  receipt: "spot_procurement_receipt"
} as const;

export type SpotProcurementBusinessType =
  (typeof SPOT_PROCUREMENT_BUSINESS_TYPES)[keyof typeof SPOT_PROCUREMENT_BUSINESS_TYPES];

export const SPOT_PROCUREMENT_PILOT_PROJECT_IDS_ENV =
  "SPOT_PROCUREMENT_PILOT_PROJECT_IDS";

export const SPOT_PROCUREMENT_PILOT_FORBIDDEN_MESSAGE =
  "零星采购未对当前项目开放";
