import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { ProjectVisibilityService } from "../auth/project-visibility.service";

export async function generalProcurementActor(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService, userId: string, projectId: string) {
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true } });
  if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
  const scopes = await visibility.effectiveRoleScopesInTransaction(tx, userId, projectId);
  if (![...scopes.globalRoleKeys, ...scopes.projectRoleKeys].some((role) => role !== "super_admin")) throw new ForbiddenException("当前账号没有业务岗位");
  return { ...actor, ...scopes };
}
export function canReadGeneralProcurement(
  row: { applicantUserId: string; status: string },
  actor: { id: string; globalRoleKeys: RoleKey[]; projectRoleKeys: RoleKey[] }
) {
  return row.applicantUserId === actor.id || actor.globalRoleKeys.some((role) => ["chairman", "comprehensive_director"].includes(role)) || actor.projectRoleKeys.includes("project_manager") ||
    (row.status === "archived" && (actor.globalRoleKeys.includes("general_manager") || [...actor.globalRoleKeys, ...actor.projectRoleKeys].some((role) => ["finance_staff", "finance_director"].includes(role))));
}
