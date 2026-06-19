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
