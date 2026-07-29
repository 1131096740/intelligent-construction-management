import { GLOBAL_BUSINESS_ROLE_KEYS, RoleKey } from "./roles";

/**
 * 受权限保护的业务动作。
 *
 * 命名尽量与审计日志的 action 对齐，便于「谁能做」与「谁做了」一一对应。
 * 这些是后端写接口真正要守的关口。
 */
export const BUSINESS_ACTIONS = [
  "contract.create",
  "contract.submit",
  "contract.approve",
  "contract.seal",
  "contract.archive.upload",
  "contract.archive.confirm",
  "contract.takeover.payment_evidence.upload",
  "contract.takeover.contract_facts.edit",
  "contract.takeover.contract_facts.confirm",
  "contract.takeover.finance_facts.edit",
  "contract.takeover.finance_facts.confirm",
  "contract.takeover.confirmation.withdraw",
  "contract.takeover.correction.submit",
  "contract.takeover.correction.review",
  "contract.tax_fact.supplement",
  "contract.tax_fact.finance_review",
  "contract.tax_fact.confirm",
  "settlement.create",
  "settlement.approve",
  "settlement.archive.upload",
  "settlement.archive.confirm",
  "project.receipt.record",
  "project.proxy_payment.record",
  "project.upstream_settlement.record",
  "project.owner_contract.record",
  "project.owner_contract.confirm",
  "project.settlement_exception_quota.request",
  "project.settlement_exception_quota.approve",
  "project.financing_quota.request",
  "project.financing_quota.approve",
  "project.financing_quota.terminate",
  "payment.create",
  "payment.approve",
  "payment.execution",
  "payment.finance_record",
  "payment.pdf_archive",
  "project_expense.create",
  "project_expense.approve",
  "project_expense.purchase_execute",
  "project_expense.execution",
  "project_expense.finance_record",
  "project_expense.receipt_confirm",
  "project_expense.void",
  "expense_claim.create",
  "expense_claim.submit",
  "expense_claim.approve",
  "expense_claim.attachment.append",
  "expense_claim.disburse",
  "expense_claim.payment.execute",
  "expense_claim.repayment.record",
  "expense_claim.repayment.confirm",
  "expense_claim.repayment.reverse",
  "spot_procurement.create",
  "spot_procurement.approve",
  "spot_procurement.payment.submit",
  "spot_procurement.payment.approve",
  "spot_procurement.payment.facts.manage",
  "spot_procurement.payment.execute",
  "spot_procurement.receipt.confirm",
  "spot_procurement.receipt.review",
  "spot_procurement.receipt.review_revoke",
  "spot_procurement.discrepancy.create",
  "spot_procurement.refund.record",
  "spot_procurement.invoice.append",
  "spot_procurement.abnormal_termination.request",
  "spot_procurement.abnormal_termination.confirm",
  "spot_procurement.archive.download",
  "spot_procurement.balance.execute",
  "spot_procurement.invoice.manage",
  "spot_procurement.invoice_exception.confirm",
  "spot_procurement.vat_rate.manage",
  "spot_procurement.void"
] as const;

export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

/**
 * 合同 / 付款最终审批的「或签」岗位：董事长或总经理任一通过即可。
 * 见 AGENTS.md「Approval Rules」。
 */
export const FINAL_APPROVAL_ROLES: readonly RoleKey[] = [
  "chairman",
  "general_manager"
];

/**
 * 动作 → 允许执行的岗位集合。集合内为「或」语义：持有任一岗位即可执行。
 *
 * 设计依据 AGENTS.md：
 * - 合同最终审批、付款最终节点：董事长「或」总经理（OR-sign）。
 * - 结算审批「不」经过董事长 / 总经理。
 * - 归档件上传：合同部成员；归档确认：合同部主管。
 * - 用章审批：综合部主管。
 * - 实际付款登记：财务 / 出纳。
 *
 * 注意：
 * - `super_admin` 是技术管理员，**不是业务审批岗**，因此不出现在任何业务动作里。
 * - `settlement.approve` / `payment.approve` 这里只做粗放行；具体节点顺序、会签与路由由后端审批实例校验。
 */
export const ACTION_REQUIRED_ROLES: Record<BusinessAction, readonly RoleKey[]> = {
  "contract.create": ["contract_staff", "contract_director"],
  "contract.submit": ["contract_staff", "contract_director"],
  "contract.approve": [
    "budget_director",
    "material_director",
    "comprehensive_director",
    "engineering_director",
    "project_manager",
    "finance_director",
    "contract_director",
    ...FINAL_APPROVAL_ROLES
  ],
  "contract.seal": ["comprehensive_director"],
  "contract.archive.upload": ["contract_staff"],
  "contract.archive.confirm": ["contract_director"],
  "contract.takeover.payment_evidence.upload": ["finance_staff", "finance_director"],
  "contract.takeover.contract_facts.edit": ["contract_staff", "contract_director"],
  "contract.takeover.contract_facts.confirm": ["contract_director"],
  "contract.takeover.finance_facts.edit": ["finance_staff", "finance_director"],
  "contract.takeover.finance_facts.confirm": ["finance_director"],
  "contract.takeover.confirmation.withdraw": [
    "contract_director",
    "finance_director"
  ],
  "contract.takeover.correction.submit": [
    "contract_staff",
    "contract_director",
    "finance_staff",
    "finance_director"
  ],
  "contract.takeover.correction.review": [
    "contract_director",
    "finance_director"
  ],
  "contract.tax_fact.supplement": ["contract_staff"],
  "contract.tax_fact.finance_review": ["finance_director"],
  "contract.tax_fact.confirm": ["contract_director"],
  "settlement.create": ["contract_staff"],
  // 评审级；具体按合同类型的路由留待审批引擎，明确不含 chairman / general_manager
  "settlement.approve": [
    "project_manager",
    "contract_director",
    "budget_director",
    "finance_director",
    "material_staff",
    "material_director",
    "engineering_foreman",
    "engineering_director",
    "engineering_tech",
  ],
  "settlement.archive.upload": ["contract_staff"],
  "settlement.archive.confirm": ["contract_director"],
  "project.receipt.record": ["finance_staff", "finance_director"],
  "project.proxy_payment.record": ["finance_staff", "finance_director"],
  "project.upstream_settlement.record": ["budget_staff", "budget_director"],
  "project.owner_contract.record": ["contract_staff"],
  "project.owner_contract.confirm": ["contract_director"],
  "project.settlement_exception_quota.request": ["project_manager"],
  "project.settlement_exception_quota.approve": [
    "project_manager",
    "contract_director",
    "budget_director",
    "chairman",
    "general_manager"
  ],
  "project.financing_quota.request": ["finance_staff", "finance_director"],
  "project.financing_quota.approve": [
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "project.financing_quota.terminate": ["finance_director"],
  "payment.create": ["contract_staff", "contract_director", "project_manager"],
  "payment.approve": [
    "comprehensive_director",
    "project_manager",
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "payment.execution": ["finance_staff"],
  "payment.finance_record": ["finance_staff", "finance_director"],
  "payment.pdf_archive": ["finance_staff", "finance_director", "contract_staff"],
  "project_expense.create": ["employee", "project_manager", "material_staff"],
  "project_expense.approve": [
    "project_manager",
    "contract_director",
    "budget_director",
    "material_director",
    "engineering_director",
    "comprehensive_director",
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "project_expense.purchase_execute": ["material_staff", "material_director"],
  "project_expense.execution": ["finance_staff"],
  "project_expense.finance_record": ["finance_staff", "finance_director"],
  "project_expense.receipt_confirm": ["employee", "material_staff", "project_manager"],
  "project_expense.void": ["finance_director", "project_manager"],
  "expense_claim.create": ["employee", "comprehensive_director"],
  "expense_claim.submit": ["employee", "comprehensive_director"],
  "expense_claim.approve": [
    "employee",
    "comprehensive_director",
    "project_manager",
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "expense_claim.attachment.append": [
    "employee",
    "comprehensive_director",
    "finance_staff",
    "finance_director"
  ],
  "expense_claim.disburse": ["finance_staff"],
  "expense_claim.payment.execute": ["finance_staff"],
  "expense_claim.repayment.record": ["finance_staff"],
  "expense_claim.repayment.confirm": ["finance_director"],
  "expense_claim.repayment.reverse": ["finance_director"],
  "spot_procurement.create": ["material_staff", "material_director"],
  "spot_procurement.approve": ["material_director", "project_manager"],
  "spot_procurement.payment.submit": ["material_staff", "material_director"],
  "spot_procurement.payment.approve": [
    "comprehensive_director",
    "project_manager",
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "spot_procurement.payment.facts.manage": [
    "finance_staff",
    "comprehensive_director",
    "finance_director"
  ],
  "spot_procurement.payment.execute": ["finance_staff"],
  "spot_procurement.receipt.confirm": [
    "employee",
    "material_staff",
    "material_director",
    "project_manager"
  ],
  "spot_procurement.receipt.review": ["material_director"],
  "spot_procurement.receipt.review_revoke": ["material_director"],
  "spot_procurement.discrepancy.create": ["material_staff", "material_director"],
  "spot_procurement.refund.record": ["finance_staff"],
  "spot_procurement.invoice.append": [
    "material_staff",
    "material_director",
    "finance_staff",
    "finance_director"
  ],
  "spot_procurement.abnormal_termination.request": [
    "material_staff",
    "material_director",
    "finance_staff"
  ],
  "spot_procurement.abnormal_termination.confirm": ["finance_director"],
  "spot_procurement.archive.download": [
    "material_staff",
    "material_director",
    "comprehensive_director",
    "project_manager",
    "finance_staff",
    "finance_director",
    "chairman",
    "general_manager"
  ],
  "spot_procurement.balance.execute": ["finance_director"],
  "spot_procurement.invoice.manage": [
    "material_staff",
    "material_director",
    "finance_staff",
    "finance_director"
  ],
  "spot_procurement.invoice_exception.confirm": ["finance_director"],
  "spot_procurement.vat_rate.manage": ["finance_director"],
  "spot_procurement.void": ["project_manager", "finance_director"]
};

/**
 * 合并用户的全局岗位与项目内岗位，得到针对「某个项目」的有效岗位集合（去重）。
 *
 * - `globalRoleKeys`：用户的全局岗位（`UserPosition.projectId` 为空）。
 * - `projectRoleKeys`：用户在「当前单据所属项目」下的岗位。
 *
 * 由调用方（后端 Guard / Service）按单据所属项目查库后传入；本函数只做纯计算。
 */
export function resolveEffectiveRoleKeys(
  globalRoleKeys: readonly RoleKey[],
  projectRoleKeys: readonly RoleKey[] = []
): RoleKey[] {
  const allowedGlobalRoles = globalRoleKeys.filter((role) =>
    GLOBAL_BUSINESS_ROLE_KEYS.includes(role)
  );
  return Array.from(new Set([...allowedGlobalRoles, ...projectRoleKeys]));
}

/**
 * 判断持有 `effectiveRoleKeys` 的用户是否可执行 `action`。
 *
 * OR 语义：用户有效岗位与该动作所需岗位有任一交集即可。
 * `super_admin` 不会因此获得业务审批权（它不在任何动作的所需岗位里）。
 */
export function canPerform(
  action: BusinessAction,
  effectiveRoleKeys: readonly RoleKey[]
): boolean {
  const required = ACTION_REQUIRED_ROLES[action];
  return effectiveRoleKeys.some((role) => required.includes(role));
}

/**
 * 返回该动作所需、但用户尚不具备的岗位（用于 403 错误信息 / 调试）。
 * 若用户已可执行，返回空数组。
 */
export function missingRolesFor(
  action: BusinessAction,
  effectiveRoleKeys: readonly RoleKey[]
): RoleKey[] {
  if (canPerform(action, effectiveRoleKeys)) {
    return [];
  }
  return [...ACTION_REQUIRED_ROLES[action]];
}

/**
 * 该动作是否包含「董事长 / 总经理或签」最终节点。
 * Guard 允许增强路由中的前置岗位，Service 仍按冻结节点复校。
 */
export function isFinalApprovalAction(action: BusinessAction): boolean {
  return action === "contract.approve";
}
