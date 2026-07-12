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
