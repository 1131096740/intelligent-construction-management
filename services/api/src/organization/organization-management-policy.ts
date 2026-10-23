import {
  DUAL_SCOPE_ROLE_KEYS,
  GLOBAL_USER_POSITION_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { BadRequestException } from "@nestjs/common";
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

export function resolveRoleAssignmentScope(
  roleKey: RoleKey,
  input: { scope?: "global" | "project"; projectId?: string | null } = {}
): "global" | "project" {
  const projectId = input.projectId?.trim();
  if (input.projectId !== undefined && input.projectId !== null && !projectId) {
    throw new BadRequestException("请选择有效项目");
  }
  const scope = input.scope ?? (projectId ? "project" : roleScope(roleKey));
  if (scope === "global") {
    if (projectId) throw new BadRequestException("公司岗位不能同时选择项目");
    if (!GLOBAL_USER_POSITION_ROLE_KEYS.includes(roleKey)) {
      throw new BadRequestException("请为该岗位选择具体项目");
    }
  } else {
    if (!projectId) throw new BadRequestException("项目岗位必须选择项目");
    if (GLOBAL_USER_POSITION_ROLE_KEYS.includes(roleKey) && !DUAL_SCOPE_ROLE_KEYS.includes(roleKey)) {
      throw new BadRequestException("该岗位只能安排在公司范围");
    }
  }
  return scope;
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
