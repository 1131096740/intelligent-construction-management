import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { loadProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";

export const CONTRACT_PARALLEL_DUTY_RESOURCE = "contract_approval_duty";
export const contractParallelDutyId = (instanceId: string, nodeIndex: number) => `${instanceId}:${nodeIndex}`;

export async function hasActiveContractGlobalRole(tx: Prisma.TransactionClient, userId: string, role: RoleKey): Promise<boolean> {
  const roles = [role, "super_admin"];
  const rows = await tx.$queryRaw<Array<{ userId: string; roleKey: string }>>(Prisma.sql`
    SELECT up."userId", p."key" AS "roleKey"
    FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId"
    INNER JOIN "User" u ON u."id" = up."userId"
    WHERE up."projectId" IS NULL AND up."userId" = ${userId} AND u."isActive" = TRUE
      AND p."key" IN (${Prisma.join(roles)})
    FOR SHARE OF up, p, u
  `);
  return rows.some(row => row.userId === userId && row.roleKey === role) && !rows.some(row => row.roleKey === "super_admin");
}

/** One immutable owner per round; never reconstruct history from current Version. */
export function contractRoundSubmissionSnapshot(nodes: unknown): Record<string, unknown> | null {
  if (!isParallelApprovalRound(nodes) || nodes.slice(1).some(node => "submissionSnapshot" in node)) return null;
  const snapshot = nodes[0].submissionSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  return value.submissionProtocolVersion === 2 && typeof value.contractVersionId === "string" && typeof value.documentContentFingerprint === "string" && /^[a-f0-9]{64}$/u.test(value.documentContentFingerprint) && Number.isInteger(value.documentContentRevision) ? value : null;
}

/** Frozen duties define scope; current active assignments define who may discharge them. */
export async function contractParallelDutyIdentity(tx: Prisma.TransactionClient, round: {
  id: string; status: string; currentNodeIndex: number; frozenNodes: unknown;
}, projectId: string, actorUserId: string, nodeIndex: number) {
  if (round.status !== "in_progress" || !isParallelApprovalRound(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(nodeIndex)) return null;
  const node = round.frozenNodes[nodeIndex];
  const approved = Array.isArray(node.approvedRoleKeys) ? node.approvedRoleKeys : [];
  const pending = (node.roleKeys as RoleKey[]).filter(role => !approved.includes(role));
  const scopes = node.roleScopesByRole as Record<string, unknown> | undefined;
  if (!scopes || pending.some(role => !["global", "project"].includes(String(scopes[role])))) return null;
  const [actor] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`SELECT "id", "isActive" FROM "User" WHERE "id" = ${actorUserId} FOR SHARE`);
  if (!actor?.isActive) return null;
  const currentRole = async (userId: string) => {
    const projectRoles = pending.filter(role => scopes[role] === "project");
    const globalRoles = [...pending.filter(role => scopes[role] === "global"), "super_admin"];
    const projectAssignments = projectRoles.length ? await loadProjectApprovalAssignments(tx, projectId, projectRoles, userId) : [];
    const globalAssignments = globalRoles.length ? await tx.$queryRaw<Array<{ userId: string; roleKey: string }>>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey"
      FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE up."projectId" IS NULL AND up."userId" = ${userId} AND u."isActive" = TRUE
        AND p."key" IN (${Prisma.join(globalRoles)})
      FOR SHARE OF up, p, u
    `) : [];
    if (globalAssignments.some(row => row.roleKey === "super_admin")) return "super_admin" as RoleKey;
    return pending.find(role => [...projectAssignments, ...globalAssignments].some(row => row.userId === userId && row.roleKey === role));
  };
  const directRole = await currentRole(actorUserId);
  if (directRole === "super_admin") return null;
  if (directRole) return { approvedRoleKey: directRole, representedUserId: actorUserId, viaAssignment: false, delegationId: null };
  const scope = { actionKey: "contract.approve", resourceType: CONTRACT_PARALLEL_DUTY_RESOURCE, resourceId: contractParallelDutyId(round.id, nodeIndex) };
  const now = new Date();
  for (const fromUserId of await activeScopedApprovalDelegatorIds(tx, actorUserId, scope, now)) {
    const delegator = await tx.user.findUnique({ where: { id: fromUserId } });
    if (!delegator?.isActive) continue;
    const role = await currentRole(fromUserId);
    const mandate = await tx.approvalDelegation.findFirst({ where: { ...scope, fromUserId, toUserId: actorUserId, enabled: true, startsAt: { lte: now }, endsAt: { gt: now } } });
    if (role && role !== "super_admin" && mandate) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalDelegation" WHERE "id" = ${mandate.id} FOR SHARE`);
      const verifiedNow = new Date();
      const current = await tx.approvalDelegation.findFirst({ where: { id: mandate.id, ...scope, fromUserId, toUserId: actorUserId, enabled: true, startsAt: { lte: verifiedNow }, endsAt: { gt: verifiedNow } } });
      if (current) return { approvedRoleKey: role, representedUserId: fromUserId, viaAssignment: false, delegationId: mandate.id };
    }
  }
  return null;
}
