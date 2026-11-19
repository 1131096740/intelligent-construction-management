import { ForbiddenException } from "@nestjs/common";
import { Prisma, type GeneralProcurement } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";

export const GENERAL_REQUEST_DUTY_RESOURCE = "general_procurement_approval_duty";
export const generalRequestDutyId = (roundId: string, index: number) => `${roundId}:${index}`;
export async function generalRequestActor(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService, userId: string, projectId: string | null) {
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true } });
  if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
  if (projectId) return { ...actor, ...await visibility.effectiveRoleScopesInTransaction(tx, userId, projectId) };
  const assignments = await tx.userPosition.findMany({ where: { userId, projectId: null }, select: { positionId: true } });
  const positions = await tx.position.findMany({ where: { id: { in: assignments.map(row => row.positionId) } }, select: { key: true } });
  return { ...actor, globalRoleKeys: positions.map(row => row.key as RoleKey), projectRoleKeys: [] as RoleKey[] };
}
export function generalRequestCanRead(row: Pick<GeneralProcurement, "applicantUserId">, actor: Awaited<ReturnType<typeof generalRequestActor>>) {
  return row.applicantUserId === actor.id || actor.globalRoleKeys.some(role => ["chairman", "general_manager", "comprehensive_director"].includes(role)) || actor.projectRoleKeys.some(role => ["project_manager", "comprehensive_director"].includes(role));
}
async function lockCurrentAuthority(tx: Prisma.TransactionClient, userId: string, projectId: string | null) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT up."userId" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId"
    WHERE up."userId" = ${userId} AND (up."projectId" IS NULL ${projectId ? Prisma.sql`OR up."projectId" = ${projectId}` : Prisma.empty}) FOR SHARE OF up, p`);
  if (projectId) await tx.$queryRaw(Prisma.sql`SELECT "userId" FROM "ProjectMember" WHERE "userId" = ${userId} AND "projectId" = ${projectId} FOR SHARE`);
}
export async function generalRequestDutyIdentity(tx: Prisma.TransactionClient, visibility: ProjectVisibilityService,
  row: Pick<GeneralProcurement, "projectId" | "scope">, round: { id: string; frozenNodes: unknown; currentNodeIndex: number }, index: number, actorUserId: string, delegated = true, lock = false) {
  if (!isParallelApprovalRound(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(index)) return null;
  const node = round.frozenNodes[index];
  const roles = node.roleKeys as RoleKey[];
  const directRole = async (userId: string) => {
    if (lock) await lockCurrentAuthority(tx, userId, row.projectId);
    let actor: Awaited<ReturnType<typeof generalRequestActor>>;
    try { actor = await generalRequestActor(tx, visibility, userId, row.projectId); }
    catch (error) { if (error instanceof ForbiddenException) return undefined; throw error; }
    return roles.find(role => role === "project_manager" ? Boolean(row.projectId && actor.projectRoleKeys.includes(role))
      : role === "comprehensive_director" && (actor.globalRoleKeys.includes(role) || Boolean(row.projectId && actor.projectRoleKeys.includes(role))));
  };
  const role = await directRole(actorUserId);
  if (role) return { approvedRoleKey: role, representedUserId: actorUserId, delegationId: null };
  if (!delegated) return null;
  const ids = await activeScopedApprovalDelegatorIds(tx, actorUserId, { actionKey: "general_procurement.approve", resourceType: GENERAL_REQUEST_DUTY_RESOURCE, resourceId: generalRequestDutyId(round.id, index) });
  for (const id of ids) {
    const originalRole = await directRole(id);
    if (originalRole) {
      const mandate = await tx.approvalDelegation.findFirst({ where: { fromUserId: id, toUserId: actorUserId, enabled: true,
        actionKey: "general_procurement.approve", resourceType: GENERAL_REQUEST_DUTY_RESOURCE, resourceId: generalRequestDutyId(round.id, index), startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, select: { id: true } });
      if (mandate && lock) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalDelegation" WHERE "id" = ${mandate.id} FOR SHARE`);
        const current = await tx.approvalDelegation.findUnique({ where: { id: mandate.id } });
        if (!current?.enabled || current.startsAt > new Date() || current.endsAt <= new Date() || current.toUserId !== actorUserId || current.fromUserId !== id) continue;
      }
      if (mandate) return { approvedRoleKey: originalRole, representedUserId: id, delegationId: mandate.id };
    }
  }
  return null;
}
