export const ROLE_KEYS = [
  "chairman",
  "general_manager",
  "project_manager",
  "contract_director",
  "contract_staff",
  "budget_director",
  "budget_staff",
  "finance_director",
  "finance_staff",
  "material_director",
  "material_staff",
  "engineering_department_member",
  "engineering_department_director",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech",
  "comprehensive_director",
  "employee",
  "super_admin"
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const BUSINESS_APPROVAL_ROLES = ROLE_KEYS.filter(
  (role) => role !== "super_admin"
);

export const GLOBAL_BUSINESS_ROLE_KEYS: readonly RoleKey[] = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_staff",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director"
];

export const GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS: readonly RoleKey[] = [
  ...GLOBAL_BUSINESS_ROLE_KEYS,
  "super_admin"
];

/**
 * Roles that may be stored as company-wide UserPosition facts.
 *
 * This is intentionally separate from project visibility: a company-wide
 * contract staff assignment is required for company-entity maintenance, but
 * it must not implicitly grant visibility into every project.
 */
export const GLOBAL_USER_POSITION_ROLE_KEYS: readonly RoleKey[] = [
  ...GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  "contract_staff"
];

/** Roles that legitimately have both a company-wide and a project assignment. */
export const DUAL_SCOPE_ROLE_KEYS: readonly RoleKey[] = ["contract_staff"];

/**
 * 历史合同接管的读取与导出岗位。
 *
 * 合同部保留原有办理范围；财务人员、财务主管和综合部主管只获得
 * 接管台账、详情、税务修订及导出能力，不因此获得任何写动作。
 */
export const HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director",
  "comprehensive_director"
] as const satisfies readonly RoleKey[];

/**
 * 合同与结算台账导出岗位。
 *
 * 列表与详情仍沿用更广的台账只读策略；导出作为单独的敏感读取能力，
 * 仅开放给合同部及本次明确授权的财务、综合部岗位。
 */
export const CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS = [
  "contract_staff",
  "contract_director",
  "finance_staff",
  "finance_director",
  "comprehensive_director"
] as const satisfies readonly RoleKey[];
