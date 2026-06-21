export interface CoreFlowApiVerificationTarget {
  path: string;
  requiredText: string[];
}

export const coreFlowApiVerificationTargets: CoreFlowApiVerificationTarget[] = [
  {
    path: "/contracts/HT-2026-001",
    requiredText: ["HT-2026-001", "钢材采购合同", "合同 v1"]
  },
  {
    path: "/settlements/JS-2026-018",
    requiredText: ["JS-2026-018", "HT-2026-001", "付款申请"]
  },
  {
    path: "/payments/FK-2026-006",
    requiredText: ["FK-2026-006", "JS-2026-018", "approved_pending_payment"]
  }
];
