import type { RoleKey } from "@jiangkong/shared-domain";

export type ApprovalFlowMode = "any" | "all";

export interface ApprovalFlowNode {
  name: string;
  mode: ApprovalFlowMode;
  roleKeys: RoleKey[];
}

export interface ApprovalFlowRule {
  id: string;
  title: string;
  businessType: string;
  status: "readonly";
  nodes: ApprovalFlowNode[];
  guardrails: string[];
}

export const roleLabels: Record<RoleKey, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "工长",
  engineering_tech: "工程技术部",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

export const approvalFlowRules: ApprovalFlowRule[] = [
  {
    id: "contract",
    title: "合同审批",
    businessType: "合同",
    status: "readonly",
    nodes: [
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "合同审批通过后进入用章与归档链路",
      "归档确认前合同版本不生效，付款条款不能作为结算付款依据",
      "董事长/总经理为或签节点，任一角色通过即可进入下一阶段"
    ]
  },
  {
    id: "settlement_material_mechanical",
    title: "结算审批（材料/机械）",
    businessType: "结算",
    status: "readonly",
    nodes: [
      { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
      { name: "物资主管", mode: "any", roleKeys: ["material_director"] },
      { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
    ],
    guardrails: [
      "结算只能从已生效合同版本发起",
      "合同部主管与预算部主管为会签节点，两个角色都需通过",
      "结算审批不经过董事长/总经理"
    ]
  },
  {
    id: "settlement_labor_professional",
    title: "结算审批（劳务/专业分包）",
    businessType: "结算",
    status: "readonly",
    nodes: [
      { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
      { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
      { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] },
      { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
    ],
    guardrails: [
      "劳务/专业分包结算先经工程现场角色复核",
      "合同部主管与预算部主管为会签节点，两个角色都需通过",
      "结算审批不经过董事长/总经理"
    ]
  },
  {
    id: "payment",
    title: "付款审批",
    businessType: "付款",
    status: "readonly",
    nodes: [
      { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务总监", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "付款申请可来自有效结算、合同预付款或历史期初结算",
      "付款审批通过只进入已批待付，不代表实际付款",
      "董事长/总经理为或签终审节点"
    ]
  }
];

export function modeLabel(mode: ApprovalFlowMode): string {
  return mode === "all" ? "会签" : "或签";
}

export function roleNames(roleKeys: RoleKey[]): string {
  return roleKeys.map((role) => roleLabels[role]).join("、");
}
