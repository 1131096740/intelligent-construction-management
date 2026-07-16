export interface SpotProcurementApprovalNode {
  name: string;
  mode: "any";
  roleKeys: string[];
  approvedRoleKeys?: string[];
}

export function procurementApprovalNodes(
  applicantRoleKeys: readonly string[]
): SpotProcurementApprovalNode[] {
  const nodes: SpotProcurementApprovalNode[] = [];
  if (!applicantRoleKeys.includes("material_director")) {
    nodes.push({
      name: "物资主管审批",
      mode: "any",
      roleKeys: ["material_director"]
    });
  }
  nodes.push({
    name: "项目经理审批",
    mode: "any",
    roleKeys: ["project_manager"]
  });
  return nodes;
}
