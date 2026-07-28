export const CONTRACT_WORKBENCH_SECTIONS = [
  { id: "inspection", label: "资料检查" },
  { id: "basic", label: "基础信息" },
  { id: "parties", label: "合同主体" },
  { id: "professional", label: "专业信息" },
  { id: "bill_tax", label: "清单与税务" },
  { id: "settlement_payment", label: "结算与付款" },
  { id: "clauses", label: "合同条款" },
  { id: "attachments", label: "附件资料" },
  { id: "negotiation_documents", label: "协商与文档" },
  { id: "flow_history", label: "流程记录" }
] as const;

export type ContractWorkbenchSectionId =
  (typeof CONTRACT_WORKBENCH_SECTIONS)[number]["id"];

export interface ContractWorkbenchSectionObservation {
  id: ContractWorkbenchSectionId;
  isIntersecting: boolean;
  top: number;
}

const SECTION_TRACKING_OFFSET_PX = 80;

export function contractWorkbenchSectionAnchorId(
  id: ContractWorkbenchSectionId
): string {
  return `contract-workbench-section-${id}`;
}

export function isContractWorkbenchSectionId(
  value: string
): value is ContractWorkbenchSectionId {
  return CONTRACT_WORKBENCH_SECTIONS.some((section) => section.id === value);
}

export function selectActiveContractWorkbenchSection(
  observations: readonly ContractWorkbenchSectionObservation[],
  fallback: ContractWorkbenchSectionId
): ContractWorkbenchSectionId {
  const visible = observations.filter((observation) => observation.isIntersecting);
  if (!visible.length) return fallback;
  return [...visible].sort(
    (left, right) =>
      Math.abs(left.top - SECTION_TRACKING_OFFSET_PX) -
      Math.abs(right.top - SECTION_TRACKING_OFFSET_PX)
  )[0]!.id;
}
