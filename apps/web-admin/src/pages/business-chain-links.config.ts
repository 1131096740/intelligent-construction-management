export interface BusinessChainLink {
  label: string;
  to: string;
}

export const contractDetailChainLinks: BusinessChainLink[] = [
  { label: "关联合同台账", to: "/contracts" },
  { label: "关联结算", to: "/settlements/JS-2026-018" },
  { label: "归档资料", to: "/archives" },
  { label: "审计日志", to: "/audit" }
];

export const settlementDetailChainLinks: BusinessChainLink[] = [
  { label: "关联合同", to: "/contracts/HT-2026-001" },
  { label: "付款申请", to: "/payments/FK-2026-006" },
  { label: "归档资料", to: "/archives" },
  { label: "审计日志", to: "/audit" }
];

export const paymentDetailChainLinks: BusinessChainLink[] = [
  { label: "关联结算", to: "/settlements/JS-2026-018" },
  { label: "付款凭证", to: "/archives" },
  { label: "审计日志", to: "/audit" }
];
