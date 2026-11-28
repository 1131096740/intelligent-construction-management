import type { RoleKey } from "@jiangkong/shared-domain";

export interface SpotProcurementApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  protocolVersion?: 1;
  executionMode?: "parallel";
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
  return nodes.map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel" }));
}

/**
 * #403 批次付款并联岗位：按票面固定岗位表（综合部主管、项目经理、财务主管、
 * 董事长/总经理）同时待办，不是单人顺序办理；仅用于批次付款，v1 顺序不变。
 */
export function batchPaymentApprovalNodes(): SpotProcurementApprovalNode[] {
  const nodes: SpotProcurementApprovalNode[] = [
    { name: "综合部主管审批", mode: "any", roleKeys: ["comprehensive_director"] },
    { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] },
    { name: "财务主管审批", mode: "any", roleKeys: ["finance_director"] },
    { name: "董事长或总经理审批", mode: "any", roleKeys: ["chairman", "general_manager"] }
  ];
  return nodes.map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel" }));
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
