import {
  GLOBAL_USER_POSITION_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ORDINARY_EMPLOYEE_ROLES } from "./employee-management-policy";

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

export function roleScope(roleKey: RoleKey): "global" | "project" {
  return GLOBAL_USER_POSITION_ROLE_KEYS.includes(roleKey) ? "global" : "project";
}

export function canManageRole(actorRoles: readonly RoleKey[], roleKey: RoleKey) {
  if (roleKey === "super_admin") return actorRoles.includes("super_admin");
  if (actorRoles.includes("chairman")) return true;
  return actorRoles.includes("comprehensive_director") && ORDINARY_EMPLOYEE_ROLES.includes(roleKey);
}

export function requiresDepartmentBoundary(actorRoles: readonly RoleKey[]) {
  return !actorRoles.some((role) =>
    role === "super_admin" || role === "chairman" || role === "general_manager" || role === "comprehensive_director"
  );
}
