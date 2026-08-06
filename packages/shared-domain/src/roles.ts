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

/**
 * 全局合同全貌岗位。
 *
 * 可查看全部激活项目的合同全貌（正文、金额、条款、清单、附件、版本、
 * 审批和归档资料）。当前与 {@link GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS}
 * 一致，但作为独立的读取授权分组存在，避免把「项目可见性」与「合同读取
 * 授权」耦合在一起。未来新增全局岗位必须在此显式配置，否则默认拒绝。
 */
export const CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS = [
  "chairman",
  "general_manager",
  "contract_director",
  "material_director",
  "finance_director",
  "finance_staff",
  "comprehensive_director",
  "budget_director",
  "engineering_department_director",
  "super_admin"
] as const satisfies readonly RoleKey[];

/**
 * 项目范围合同全貌岗位。
 *
 * 只在本人激活的项目任职范围内看到合同全貌，不获得任何全局范围。
 */
export const CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS = [
  "contract_staff",
  "material_staff",
  "budget_staff",
  "project_manager",
  "engineering_department_member",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech"
] as const satisfies readonly RoleKey[];

/**
 * 可读取他人未提交草稿的岗位。
 *
 * 未提交草稿仅对当前经办人（合同根 owner）、合同部主管与 Super Admin 开放。
 * 当前经办人在调用侧以 owner 身份单独判断，因此这里只列出全局角色。
 */
export const CONTRACT_DRAFT_PRIVATE_READ_ROLES: ReadonlySet<RoleKey> = new Set([
  "contract_director",
  "super_admin"
]);

/**
 * 合同摘要查看岗位。
 *
 * 仅能看到本人任职项目中已归档生效合同的不敏感摘要，摘要字段为
 * 正式编号、名称、类型、项目、相对方、生效日期与状态；金额、条款、
 * 清单、正文、文件、版本与审批历史一律不返回。未来新增岗位默认无任何
 * 合同查看权限，必须在此显式配置后才开放。
 */
export const CONTRACT_SUMMARY_VIEW_ROLE_KEYS: readonly RoleKey[] = [
  "employee"
] as const satisfies readonly RoleKey[];
