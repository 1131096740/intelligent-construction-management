import {activeApprovalNodeIndexes, isParallelApprovalRound} from "./parallel-approval-protocol";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { loadEffectiveProjectApprovalAssignments } from "./project-approval-assignments";

export const SPOT_APPROVAL_DUTY_RESOURCE = "spot_procurement_approval_duty";
export const spotApprovalDutyId = (instanceId: string, nodeIndex: number) => `${instanceId}:${nodeIndex}`;

/** Re-evaluate both accounts, mandate half-open interval and delegator's current scoped duty under caller transaction. */
export async function delegatedSpotApprovalIdentity(tx: Prisma.TransactionClient, input: {
  instanceId: string; nodeIndex: number; actorUserId: string; projectId: string; pendingRoleKeys: RoleKey[];
}) {
  const mandates = await activeSpotDutyMandates(tx, input.instanceId, input.nodeIndex, input.actorUserId);
  for (const mandate of mandates ?? []) {
    const roles = await loadEffectiveProjectApprovalAssignments(tx, input.projectId, input.pendingRoleKeys, mandate.fromUserId);
    const role = input.pendingRoleKeys.find(role => roles.some(row => row.userIsActive && row.userId === mandate.fromUserId && row.projectId === input.projectId && row.roleKey === role));
    if (role) return {approvedRoleKey: role, representedUserId: mandate.fromUserId, delegationId: mandate.id};
  }
  return null;
}

export async function activeSpotDutyMandates(tx: Prisma.TransactionClient, instanceId: string, nodeIndex: number, toUserId?: string) {
  const now = new Date();
  return await tx.$queryRaw<Array<{id: string; fromUserId: string; toUserId: string}>>(Prisma.sql`
    SELECT d."id", d."fromUserId", d."toUserId" FROM "ApprovalDelegation" d
    INNER JOIN "User" original ON original."id" = d."fromUserId" AND original."isActive" = TRUE
    INNER JOIN "User" actual ON actual."id" = d."toUserId" AND actual."isActive" = TRUE
    WHERE d."enabled" = TRUE ${toUserId ? Prisma.sql`AND d."toUserId" = ${toUserId}` : Prisma.empty}
      AND d."startsAt" <= ${now} AND d."endsAt" > ${now}
      AND d."actionKey" = 'spot_procurement.approve' AND d."resourceType" = ${SPOT_APPROVAL_DUTY_RESOURCE}
      AND d."resourceId" = ${spotApprovalDutyId(instanceId, nodeIndex)}
    ORDER BY d."createdAt", d."id" FOR SHARE OF d, original, actual
  `);
}

export async function scopedSpotDutyNodeIndexes(tx: Prisma.TransactionClient, round: {
  id: string; status: string; frozenNodes: unknown; currentNodeIndex: number;
}, projectId: string, actorUserId: string): Promise<number[]> {
  if (round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes) || typeof tx.$queryRaw !== "function") return [];
  const result: number[] = [];
  for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
    const identity = await delegatedSpotApprovalIdentity(tx, {instanceId: round.id, nodeIndex: index, actorUserId, projectId,
      pendingRoleKeys: (round.frozenNodes[index].roleKeys as RoleKey[])});
    if (identity) result.push(index);
  }
  return result;
}
