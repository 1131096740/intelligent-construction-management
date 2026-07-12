import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

export const ORGANIZATION_MANAGER_ROLE_KEYS: readonly RoleKey[] = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin"
];

const SUBORDINATE_ROLES: Partial<Record<RoleKey, readonly RoleKey[]>> = {
  engineering_department_director: [
    "engineering_director",
    "engineering_foreman",
    "engineering_tech"
  ],
  finance_director: ["finance_staff"],
  contract_director: ["contract_staff"],
  budget_director: ["budget_staff"],
  material_director: ["material_staff"],
  comprehensive_director: []
};

export function roleScope(roleKey: RoleKey): "global" | "project" {
  return GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.includes(roleKey) ? "global" : "project";
}

export function canManageRole(actorRoles: readonly RoleKey[], roleKey: RoleKey) {
  if (
    roleKey === "engineering_department_member" ||
    roleKey === "engineering_department_director"
  ) {
    return actorRoles.includes("chairman");
  }
  if (actorRoles.includes("super_admin")) return true;
  if (actorRoles.includes("chairman")) return roleKey !== "super_admin";
  if (actorRoles.includes("general_manager")) {
    return roleKey !== "super_admin";
  }
  return actorRoles.some((role) => SUBORDINATE_ROLES[role]?.includes(roleKey));
}

export function requiresDepartmentBoundary(actorRoles: readonly RoleKey[]) {
  return !actorRoles.some((role) =>
    role === "super_admin" || role === "chairman" || role === "general_manager"
  );
}
