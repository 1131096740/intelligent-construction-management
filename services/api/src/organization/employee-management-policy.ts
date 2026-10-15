import { ForbiddenException } from "@nestjs/common";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";

export const IMPORTANT_EMPLOYEE_ROLES: readonly RoleKey[] = [
  "chairman", "general_manager", "project_manager", "contract_director", "budget_director",
  "finance_director", "finance_staff", "material_director", "engineering_department_director",
  "engineering_director", "comprehensive_director"
];

export const ORDINARY_EMPLOYEE_ROLES: readonly RoleKey[] = ROLE_KEYS.filter(
  (role) => role !== "super_admin" && !IMPORTANT_EMPLOYEE_ROLES.includes(role)
);

export function canApproveEmployeeRoles(actorRoles: readonly RoleKey[], targetRoles: readonly RoleKey[]) {
  if (targetRoles.length === 0 || targetRoles.includes("super_admin")) return false;
  if (actorRoles.includes("chairman")) return true;
  return actorRoles.includes("comprehensive_director") && targetRoles.every((role) => ORDINARY_EMPLOYEE_ROLES.includes(role));
}

export async function employeeManagerRoles(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
  if (!actor?.isActive) throw new ForbiddenException("当前账号已停用，请重新登录");
  const assignments = await tx.userPosition.findMany({ where: { userId: actorId, projectId: null }, select: { positionId: true } });
  const positions = await tx.position.findMany({ where: { id: { in: assignments.map((row) => row.positionId) } }, select: { key: true } });
  const roles = positions.map((row) => row.key).filter((key): key is RoleKey => ROLE_KEYS.includes(key as RoleKey));
  if (!roles.includes("chairman") && !roles.includes("comprehensive_director")) {
    throw new ForbiddenException("只有董事长或综合部负责人可以审核入职和管理人员账号");
  }
  return roles;
}

export async function employeeTargetNeedsChairman(tx: Prisma.TransactionClient, userId: string) {
  const [user, assignments, members] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { requiresChairmanManagement: true } }),
    tx.userPosition.findMany({ where: { userId }, select: { positionId: true } }),
    tx.projectMember.findMany({ where: { userId }, select: { positionKey: true } })
  ]);
  if (user?.requiresChairmanManagement) return true;
  const positions = await tx.position.findMany({ where: { id: { in: assignments.map((row) => row.positionId) } }, select: { key: true } });
  return [...positions.map((row) => row.key), ...members.map((row) => row.positionKey)].some(
    (role) => role === "super_admin" || IMPORTANT_EMPLOYEE_ROLES.includes(role as RoleKey));
}
