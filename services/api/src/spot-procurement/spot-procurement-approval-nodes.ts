import type { RoleKey } from "@jiangkong/shared-domain";

export interface SpotProcurementApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
}

export const SPOT_PAYMENT_APPROVAL_SIGNATURE_SLOTS = [
  { key: "handler", label: "经办人" },
  { key: "comprehensive_director", label: "综合部" },
  { key: "project_manager", label: "部门经理" },
  { key: "finance_director", label: "财务部" },
  { key: "final_approver", label: "董事长/总经理" }
] as const;

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

export function paymentApprovalNodes(): SpotProcurementApprovalNode[] {
  return [
    {
      name: "综合部主管审批",
      mode: "any",
      roleKeys: ["comprehensive_director"]
    },
    {
      name: "项目经理审批",
      mode: "any",
      roleKeys: ["project_manager"]
    },
    {
      name: "财务主管审批",
      mode: "any",
      roleKeys: ["finance_director"]
    },
    {
      name: "董事长或总经理审批",
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    }
  ];
}
