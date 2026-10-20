import type { RoleKey } from "@jiangkong/shared-domain";

export type ApprovalFlowMode = "any" | "all";

export interface ApprovalFlowNode {
  name: string;
  mode: ApprovalFlowMode;
  roleKeys: RoleKey[];
  participantLabel?: string;
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
  material_director: "物资部主管",
  material_staff: "物资员",
  engineering_department_member: "公司工程技术部成员",
  engineering_department_director: "公司工程技术部部长",
  engineering_director: "项目总工",
  engineering_foreman: "工长",
  engineering_tech: "施工员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

export const approvalFlowRules: ApprovalFlowRule[] = [
  {
    id: "contract_material_purchase",
    title: "新合同审批（材料采购）",
    businessType: "新合同",
    status: "readonly",
    nodes: [
      { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "物资部主管、项目经理及其他审批人按提交时的人员快照处理",
      "合同审批通过后进入用章与归档链路",
      "董事长/总经理为或签节点，任一角色通过即可进入下一阶段"
    ]
  },
  {
    id: "contract_equipment_rental",
    title: "新合同审批（机械租赁）",
    businessType: "新合同",
    status: "readonly",
    nodes: [
      { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "所有机械类合同统一由物资部主管审批",
      "审批人按提交时的人员快照处理，董事长/总经理为或签终审"
    ]
  },
  {
    id: "contract_labor_subcontract",
    title: "新合同审批（劳务分包）",
    businessType: "新合同",
    status: "readonly",
    nodes: [
      { name: "所属项目总工", mode: "any", roleKeys: ["engineering_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "项目总工只从合同所属项目的启用成员中唯一确定",
      "审批人按提交时的人员快照处理，董事长/总经理为或签终审"
    ]
  },
  {
    id: "contract_professional_subcontract",
    title: "新合同审批（专业分包）",
    businessType: "新合同",
    status: "readonly",
    nodes: [
      { name: "所属项目总工", mode: "any", roleKeys: ["engineering_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "项目总工只从合同所属项目的启用成员中唯一确定",
      "审批人按提交时的人员快照处理，董事长/总经理为或签终审"
    ]
  },
  {
    id: "contract_generic_contract",
    title: "新合同审批（通用合同）",
    businessType: "新合同",
    status: "readonly",
    nodes: [
      { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "只有通用合同经过综合部主管审批",
      "审批人按提交时的人员快照处理，董事长/总经理为或签终审"
    ]
  },
  {
    id: "contract_change_major",
    title: "合同变更审批",
    businessType: "合同变更",
    status: "readonly",
    nodes: [
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "合同员或合同部主管作为合同经办人发起",
      "发起人兼任审批岗位时保留节点，须本人逐节点审批并签名",
      "项目经理只能处理冻结实例中的项目经理节点",
      "累计正向增项严格超过原始签约含税金额 10% 时必须新签合同",
      "预算部主管不是强制节点，董事长/总经理为或签终审节点"
    ]
  },
  {
    id: "settlement_material_mechanical",
    title: "结算审批（材料/机械）",
    businessType: "结算",
    status: "readonly",
    nodes: [
      { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
      { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] }
    ],
    guardrails: [
      "材料、机械结算由合同员从已生效合同版本发起",
      "所属项目物资员由合同员选择并在提交时冻结具体人员",
      "过程结算与最终结算使用完全相同的审批路线",
      "结算成本控制节点由合同部主管单独审批",
      "结算审批不经过董事长/总经理"
    ]
  },
  {
    id: "settlement_labor_professional",
    title: "结算审批（劳务/专业分包）",
    businessType: "结算",
    status: "readonly",
    nodes: [
      { name: "工长/施工员", mode: "any", roleKeys: ["engineering_foreman", "engineering_tech"] },
      { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] }
    ],
    guardrails: [
      "劳务/专业分包结算先经工程现场角色复核",
      "同项目任意施工员、工长或项目总工可发起；发起人选择同项目工长或施工员复核，项目总工按所属项目唯一确定",
      "过程结算与最终结算使用完全相同的审批路线",
      "结算成本控制节点由合同部主管单独审批",
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
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "付款申请可来自有效结算、合同预付款或历史期初结算",
      "付款审批通过只进入已批待付，不代表实际付款",
      "董事长/总经理为或签终审节点"
    ]
  },
  {
    id: "general_procurement",
    title: "综合采购申请审批",
    businessType: "综合采购",
    status: "readonly",
    nodes: [
      { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "任何启用角色均可为本人发起申请",
      "董事长/总经理为或签终审，任一人审批通过即可",
      "审批通过后由综合部归档，归档后才能请款"
    ]
  },
  {
    id: "spot_procurement",
    title: "零星材料采购申请审批",
    businessType: "零星材料采购",
    status: "readonly",
    nodes: [
      { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] }
    ],
    guardrails: [
      "由同项目物资员发起申请",
      "物资部主管、项目经理依次审批，审批通过后生成付款草稿"
    ]
  },
  {
    id: "spot_procurement_payment",
    title: "零星材料付款申请审批",
    businessType: "零星材料付款",
    status: "readonly",
    nodes: [
      { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "物资部主管为首级审批人",
      "董事长/总经理为或签终审，审批通过后进入已批待付"
    ]
  },
  {
    id: "expense_claim_project",
    title: "费用申请及综合采购付款审批（有项目）",
    businessType: "费用申请",
    status: "readonly",
    nodes: [
      { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "适用于费用报销、借款、申请备用金、零星费用和综合采购付款",
      "费用报销允许任何启用角色为本人发起；代办仍按原权限",
      "按单据所属项目确定项目经理，董事长/总经理或签"
    ]
  },
  {
    id: "expense_claim_no_project",
    title: "费用申请审批（无项目）",
    businessType: "费用申请",
    status: "readonly",
    nodes: [
      { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "事实证明人", mode: "any", roleKeys: ["employee"], participantLabel: "申请时选定的有效用户" },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    guardrails: [
      "无项目费用由申请时选定的事实证明人复核",
      "事实证明人为选定的有效用户，不限定其必须具有员工岗位",
      "综合部主管节点保留，董事长/总经理为或签终审"
    ]
  }
];

export function modeLabel(mode: ApprovalFlowMode): string {
  return mode === "all" ? "会签" : "或签";
}

export function roleNames(roleKeys: RoleKey[]): string {
  return roleKeys.map((role) => roleLabels[role]).join("、");
}
