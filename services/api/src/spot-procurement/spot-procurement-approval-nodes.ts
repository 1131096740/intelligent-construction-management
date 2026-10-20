import type { RoleKey } from "@jiangkong/shared-domain";

export interface SpotProcurementApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
}

export const SPOT_PAYMENT_APPROVAL_SIGNATURE_SLOTS = [
  { key: "handler", label: "经办人" },
  { key: "material_director", label: "物资部主管" },
  { key: "project_manager", label: "部门经理" },
  { key: "finance_director", label: "财务部" },
  { key: "final_approver", label: "董事长/总经理" }
] as const;

export function procurementApprovalNodes(
  _applicantRoleKeys: readonly string[]
): SpotProcurementApprovalNode[] {
  void _applicantRoleKeys;
  const nodes: SpotProcurementApprovalNode[] = [];
  {
    nodes.push({
      name: "物资部主管审批",
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
      name: "物资部主管审批",
      mode: "any",
      roleKeys: ["material_director"]
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
