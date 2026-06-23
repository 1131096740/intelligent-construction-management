import { RoleKey } from "./roles";

/**
 * 受权限保护的业务动作。
 *
 * 命名尽量与审计日志的 action 对齐，便于「谁能做」与「谁做了」一一对应。
 * 这些是后端写接口真正要守的关口。
 */
export const BUSINESS_ACTIONS = [
  "contract.submit",
  "contract.approve",
  "contract.seal",
  "contract.archive.upload",
  "contract.archive.confirm",
  "settlement.approve",
  "settlement.archive.upload",
  "settlement.archive.confirm",
  "payment.approve",
  "payment.execution",
  "payment.finance_record",
  "payment.pdf_archive"
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
 * - 合同 / 付款最终审批：董事长「或」总经理（OR-sign）。
 * - 结算审批「不」经过董事长 / 总经理。
 * - 归档件上传：合同部成员；归档确认：合同部主管。
 * - 用章审批：综合部主管。
 * - 实际付款登记：财务 / 出纳。
 *
 * 注意：
 * - `super_admin` 是技术管理员，**不是业务审批岗**，因此不出现在任何业务动作里。
 * - `settlement.approve` 这里只做粗放行；具体节点顺序、会签与合同类型路由由后端审批实例校验。
 */
export const ACTION_REQUIRED_ROLES: Record<BusinessAction, readonly RoleKey[]> = {
  "contract.submit": ["contract_staff"],
  "contract.approve": FINAL_APPROVAL_ROLES,
  "contract.seal": ["comprehensive_director"],
  "contract.archive.upload": ["contract_staff"],
  "contract.archive.confirm": ["contract_director"],
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
  "payment.approve": FINAL_APPROVAL_ROLES,
  "payment.execution": ["finance_staff"],
  "payment.finance_record": ["finance_staff", "finance_director"],
  "payment.pdf_archive": ["finance_staff", "finance_director", "contract_staff"]
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
  return Array.from(new Set([...globalRoleKeys, ...projectRoleKeys]));
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
 * 该动作是否为「董事长 / 总经理或签」的最终审批动作。
 * Service 层可据此做二次校验（Guard 粗放行 + Service 复校）。
 */
export function isFinalApprovalAction(action: BusinessAction): boolean {
  return ACTION_REQUIRED_ROLES[action] === FINAL_APPROVAL_ROLES;
}
