export interface BusinessChainLink {
  label: string;
  to: string;
}

export const contractDetailChainLinks: BusinessChainLink[] = [
  { label: "关联合同台账", to: "/合同管理" },
  { label: "关联结算", to: "/结算管理/JS-2026-018" },
  { label: "归档资料", to: "/资料库" },
  { label: "审计日志", to: "/审计日志" }
];

export const settlementDetailChainLinks: BusinessChainLink[] = [
  { label: "关联合同", to: "/合同管理/HT-2026-001" },
  { label: "付款申请", to: "/付款管理/FK-2026-006" },
  { label: "归档资料", to: "/资料库" },
  { label: "审计日志", to: "/审计日志" }
];

export const paymentDetailChainLinks: BusinessChainLink[] = [
  { label: "关联结算", to: "/结算管理/JS-2026-018" },
  { label: "付款凭证", to: "/资料库" },
  { label: "审计日志", to: "/审计日志" }
];
