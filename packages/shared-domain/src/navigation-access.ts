import {
  ACTION_REQUIRED_ROLES,
  FINAL_APPROVAL_ROLES,
  type BusinessAction
} from "./permissions";
import {
  COMPANY_ENTITY_READER_ROLES
} from "./company-entity";
import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  type RoleKey
} from "./roles";

/**
 * 后端只读接口真正使用的岗位集合。
 *
 * 这些常量同时被 Nest Guard 的 `@RequirePositions(...)` 与 Web 导航矩阵引用，
 * 保证「导航里能看到」与「后端允许读」是同一条真相。任何一处新增岗位只需改这里。
 */
export const CONTRACT_LEDGER_READ_ROLE_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "project_manager",
  "budget_staff",
  "material_staff",
  "engineering_department_member",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech",
  "employee"
] as const satisfies readonly RoleKey[];

/** 项目经营总览（`GET /projects/:projectId/operating-funds-overview`）的只读岗位。 */
export const PROJECT_OVERVIEW_READ_ROLE_KEYS = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.filter((role) => role !== "contract_staff"),
  "project_manager"
] as const satisfies readonly RoleKey[];

/** 档案资料库（`GET /archives`）的只读岗位。 */
export const ARCHIVE_READ_ROLE_KEYS = [
  "chairman",
  "general_manager",
  "contract_director",
  "contract_staff",
  "finance_director",
  "finance_staff",
  "super_admin"
] as const satisfies readonly RoleKey[];

/** 审计日志（`GET /audit-logs`）的只读岗位。 */
export const AUDIT_READ_ROLE_KEYS = [
  "chairman",
  "finance_director",
  "super_admin"
] as const satisfies readonly RoleKey[];

/** 资金账户与资金办理（`GET /fund-accounts`）的只读岗位。 */
export const FUND_ACCOUNT_READ_ROLE_KEYS = [
  "finance_staff",
  "finance_director",
  "comprehensive_director"
] as const satisfies readonly RoleKey[];

/** 资金执行能力（`GET /fund-executions/capabilities`）的只读岗位。 */
export const FUND_EXECUTION_READ_ROLE_KEYS = [
  "finance_staff",
  "finance_director"
] as const satisfies readonly RoleKey[];

/**
 * 组织目录与人员管理（`GET /organization/directory`、`GET /organization/management-capabilities`）
 * 的只读岗位。员工管理的组织维护规则仍由 API 侧 `canManageRole` 等函数约束。
 */
export const ORGANIZATION_DIRECTORY_READ_ROLE_KEYS = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin"
] as const satisfies readonly RoleKey[];

/**
 * 固定业务入口 → 所需岗位/能力。
 *
 * 约束（Issue #423）：入口矩阵不得在 Web 手写 role 列表。
 * - `actions`：岗位由 `ACTION_REQUIRED_ROLES` 展开，与后端 `canPerform` 同一张表；
 * - `positions`：岗位来自后端只读 Guard 使用的常量（本文件顶部）或 shared-domain 既有读取授权；
 * - `authenticated`：后端对应列表接口就是登录即可读，导航不再额外裁剪。
 *
 * 新增入口时只允许引用上述三类来源，不能写死岗位数组。
 */
export type NavigationAccessRule =
  | { kind: "authenticated" }
  | { kind: "actions"; actions: readonly BusinessAction[] }
  | { kind: "positions"; roles: readonly RoleKey[]; globalOnly?: boolean };

export const NAVIGATION_ENTRY_ACCESS = {
  home: { kind: "authenticated" },
  global_search: { kind: "authenticated" },
  approval_center: { kind: "authenticated" },
  approval_archive: { kind: "authenticated" },

  project_workbench: { kind: "positions", roles: PROJECT_OVERVIEW_READ_ROLE_KEYS },
  historical_operating_takeover: {
    kind: "actions",
    actions: [
      "operating_takeover.manage",
      "operating_takeover.confirm",
      "operating_takeover.activate",
      "operating_takeover.file.upload"
    ]
  },
  historical_expense: {
    kind: "actions",
    actions: [
      "history_expense.manage",
      "history_expense.verify",
      "history_expense.confirm",
      "history_expense.activate",
      "history_expense.correct"
    ]
  },
  clearing_workbench: { kind: "actions", actions: ["clearing.read"] },
  necessary_expense_reserve: { kind: "actions", actions: ["necessary_expense_reserve.read"] },
  project_fund_dispute: { kind: "actions", actions: ["project_fund_dispute.read"] },
  wage_assumption: { kind: "actions", actions: ["wage_sensitive_read"] },
  global_invoice_allocation: { kind: "actions", actions: ["clearing.read"] },
  employee_management: { kind: "positions", roles: ORGANIZATION_DIRECTORY_READ_ROLE_KEYS },

  // 合同/结算工作台同时是只读台账入口：后端台账读取岗位即可进入，写动作仍由接口单独校验。
  contract_workbench: { kind: "positions", roles: CONTRACT_LEDGER_READ_ROLE_KEYS },
  historical_contract_takeover: {
    kind: "positions",
    roles: HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS
  },
  contract_template_library: {
    kind: "actions",
    actions: ["contract.create", "contract.submit"]
  },
  settlement_workbench: { kind: "positions", roles: CONTRACT_LEDGER_READ_ROLE_KEYS },
  payment_workbench: {
    kind: "actions",
    actions: [
      "payment.create",
      "payment.approve",
      "payment.execution",
      "payment.finance_record",
      "payment.pdf_archive"
    ]
  },

  spot_procurement_workbench: { kind: "authenticated" },
  spot_material_payment_workbench: { kind: "authenticated" },
  receipt_confirmation_workbench: { kind: "authenticated" },
  general_procurement_request: { kind: "authenticated" },
  expense_claim_workbench: { kind: "authenticated" },
  other_project_payment: {
    kind: "actions",
    actions: [
      "project_expense.execution",
      "project_expense.finance_record",
      "project.owner_settlement.record"
    ]
  },

  fund_account: { kind: "positions", roles: FUND_ACCOUNT_READ_ROLE_KEYS },
  correction_center: {
    kind: "actions",
    actions: [
      "project.construction_payment_correction.request",
      "project.construction_payment_correction.confirm",
      "contract.create"
    ]
  },
  fund_handling_workbench: { kind: "positions", roles: FUND_ACCOUNT_READ_ROLE_KEYS },
  fund_execution_cases: {
    kind: "positions",
    roles: [...new Set([...FUND_EXECUTION_READ_ROLE_KEYS, ...FINAL_APPROVAL_ROLES])]
  },
  company_transfer_ledger: {
    kind: "actions",
    actions: ["fund_flow.read", "contract.create"]
  },
  fund_flow: { kind: "actions", actions: ["fund_flow.read"] },
  fund_movement_workbench: { kind: "actions", actions: ["payment.finance_record"] },
  payable_settlement_workbench: {
    kind: "actions",

    actions: ["payable_settlement.read"]
  },

  ledger_contract: { kind: "positions", roles: CONTRACT_LEDGER_READ_ROLE_KEYS },
  ledger_settlement: { kind: "positions", roles: CONTRACT_LEDGER_READ_ROLE_KEYS },
  ledger_payment: { kind: "positions", roles: CONTRACT_LEDGER_READ_ROLE_KEYS },
  ledger_spot_procurement: { kind: "authenticated" },
  ledger_general_procurement: { kind: "authenticated" },
  ledger_expense_claim: { kind: "authenticated" },

  archives: { kind: "positions", roles: ARCHIVE_READ_ROLE_KEYS },
  audit_logs: { kind: "positions", roles: AUDIT_READ_ROLE_KEYS },

  company_entity: { kind: "positions", roles: COMPANY_ENTITY_READER_ROLES, globalOnly: true },
  business_parties: { kind: "authenticated" },
  system_settings: { kind: "authenticated" }
} as const satisfies Record<string, NavigationAccessRule>;

export type NavigationEntryKey = keyof typeof NAVIGATION_ENTRY_ACCESS;
export const NAVIGATION_ENTRY_KEYS = Object.keys(
  NAVIGATION_ENTRY_ACCESS
) as NavigationEntryKey[];

/**
 * 把入口能力展开成岗位集合。`authenticated` 返回 `null`（不裁剪）。
 * 这是矩阵的唯一展开点：Web 只引用入口 key，不再自行维护岗位。
 */
export function navigationEntryRoleKeys(entry: NavigationEntryKey): readonly RoleKey[] | null {
  const rule: NavigationAccessRule = NAVIGATION_ENTRY_ACCESS[entry];
  if (rule.kind === "authenticated") return null;
  if (rule.kind === "positions") return rule.roles;
  return Array.from(
    new Set(rule.actions.flatMap((action) => ACTION_REQUIRED_ROLES[action]))
  );
}

export function hasNavigationEntryAccess(
  entry: NavigationEntryKey,
  roleKeys: readonly RoleKey[] | undefined,
  globalRoleKeys: readonly RoleKey[] = roleKeys ?? []
): boolean {
  const rule: NavigationAccessRule = NAVIGATION_ENTRY_ACCESS[entry];
  if (rule.kind === "authenticated") return true;
  if (rule.kind === "positions" && rule.globalOnly) {
    const roles = navigationEntryRoleKeys(entry) ?? [];
    return roles.some((role) => globalRoleKeys.includes(role));
  }
  const roles = navigationEntryRoleKeys(entry) ?? [];
  return roles.some((role) => roleKeys?.includes(role));
}

/** 当前账号可见的固定入口集合；兼岗自然取并集，顺序稳定且不重复。 */
export function visibleNavigationEntryKeys(
  roleKeys: readonly RoleKey[] | undefined,
  globalRoleKeys: readonly RoleKey[] = roleKeys ?? []
): NavigationEntryKey[] {
  return NAVIGATION_ENTRY_KEYS.filter((entry) =>
    hasNavigationEntryAccess(entry, roleKeys, globalRoleKeys)
  );
}
