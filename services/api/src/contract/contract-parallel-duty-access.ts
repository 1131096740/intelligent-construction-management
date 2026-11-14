import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { loadProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import type { ApprovalActorRoleScopes } from "../approval/approval-review-identity";

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

export function contractPendingApprovalSnapshot(
  version: {
    id: string; status: string; numericProtocolVersion: number;
    draftRevision: number; documentContentRevision: number;
    documentContentFingerprint: string | null;
  } | null,
  round: {
    businessType: string; businessId: string; flowType: string; status: string;
    applicantUserId: string; frozenNodes: unknown;
  } | null
) {
  if (version?.numericProtocolVersion !== 2 || version.status !== "in_approval" ||
      round?.businessType !== "contract_version" || round.businessId !== version.id ||
      round.flowType !== "contract.approve" || round.status !== "in_progress") return null;
  const snapshot = contractRoundSubmissionSnapshot(round.frozenNodes);
  return snapshot && snapshot.contractVersionId === version.id &&
    snapshot.applicantUserId === round.applicantUserId &&
    snapshot.draftRevision === version.draftRevision &&
    snapshot.documentContentRevision === version.documentContentRevision &&
    snapshot.documentContentFingerprint === version.documentContentFingerprint
    ? snapshot : null;
}

export function contractParallelApprovalEpoch(
  version: Parameters<typeof contractPendingApprovalSnapshot>[0],
  round: (NonNullable<Parameters<typeof contractPendingApprovalSnapshot>[1]> & { id: string }) | null
): string | undefined {
  const snapshot = contractPendingApprovalSnapshot(version, round);
  if (!version || !round || !snapshot) return undefined;
  return createHash("sha256").update(JSON.stringify([
    "contract.approve/v2", version.id, round.id, round.applicantUserId,
    version.draftRevision, version.documentContentRevision, version.documentContentFingerprint
  ])).digest("hex");
}

const CONTRACT_APPROVAL_FORM_READER_ROLES = new Set<RoleKey>([
  "contract_staff", "contract_director", "project_manager", "finance_staff",
  "finance_director", "comprehensive_director", "chairman", "general_manager"
]);

export function contractApprovalFormHasReaderRole(roles: readonly RoleKey[]) {
  return roles.some(role => CONTRACT_APPROVAL_FORM_READER_ROLES.has(role));
}

function frozenContractDutyRoleScope(node: Record<string, unknown>, role: RoleKey) {
  const scopes = node.roleScopesByRole;
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) return null;
  const scope = (scopes as Record<string, unknown>)[role];
  return scope === "global" || scope === "project" ? scope : null;
}

export function pendingContractApprovalFormHasReaderRole(nodes: unknown, scopes?: ApprovalActorRoleScopes) {
  if (!scopes || !isParallelApprovalRound(nodes)) return false;
  const dutyRoles = new Set(nodes.flatMap(node => node.roleKeys as RoleKey[]));
  const independentRoles = resolveEffectiveRoleKeys(scopes.globalRoleKeys, scopes.projectRoleKeys)
    .filter(role => !dutyRoles.has(role));
  if (contractApprovalFormHasReaderRole(independentRoles)) return true;

  if (scopes.globalRoleKeys.includes("super_admin")) return false;
  return nodes.some(node => (node.roleKeys as RoleKey[]).some(role => {
    const scope = frozenContractDutyRoleScope(node, role);
    if (scope === "global") return scopes.globalRoleKeys.includes(role);
    return scope === "project" && scopes.projectRoleKeys.includes(role);
  }));
}

/** Frozen duties define scope; current active assignments define who may discharge them. */
export async function contractParallelDutyIdentity(tx: Prisma.TransactionClient, round: {
  id: string; status: string; currentNodeIndex: number; frozenNodes: unknown;
}, projectId: string, actorUserId: string, nodeIndex: number, lockAssignments = true) {
  if (round.status !== "in_progress" || !isParallelApprovalRound(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(nodeIndex)) return null;
  const node = round.frozenNodes[nodeIndex];
  const approved = Array.isArray(node.approvedRoleKeys) ? node.approvedRoleKeys : [];
  const pending = (node.roleKeys as RoleKey[]).filter(role => !approved.includes(role));
  if (pending.some(role => !frozenContractDutyRoleScope(node, role))) return null;
  const [actor] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`SELECT "id", "isActive" FROM "User" WHERE "id" = ${actorUserId}${lockAssignments ? Prisma.sql` FOR SHARE` : Prisma.empty}`);
  if (!actor?.isActive) return null;
  const currentRole = async (userId: string) => {
    const projectRoles = pending.filter(role => frozenContractDutyRoleScope(node, role) === "project");
    const globalRoles = [...pending.filter(role => frozenContractDutyRoleScope(node, role) === "global"), "super_admin"];
    const projectAssignments = projectRoles.length ? await loadProjectApprovalAssignments(tx, projectId, projectRoles, userId, lockAssignments) : [];
    const globalAssignments = globalRoles.length ? await tx.$queryRaw<Array<{ userId: string; roleKey: string }>>(Prisma.sql`
      SELECT up."userId", p."key" AS "roleKey"
      FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId"
      INNER JOIN "User" u ON u."id" = up."userId"
      WHERE up."projectId" IS NULL AND up."userId" = ${userId} AND u."isActive" = TRUE
        AND p."key" IN (${Prisma.join(globalRoles)})
      ${lockAssignments ? Prisma.sql`FOR SHARE OF up, p, u` : Prisma.empty}
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
      if (lockAssignments) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalDelegation" WHERE "id" = ${mandate.id} FOR SHARE`);
      const verifiedNow = new Date();
      const current = await tx.approvalDelegation.findFirst({ where: { id: mandate.id, ...scope, fromUserId, toUserId: actorUserId, enabled: true, startsAt: { lte: verifiedNow }, endsAt: { gt: verifiedNow } } });
      if (current) return { approvedRoleKey: role, representedUserId: fromUserId, viaAssignment: false, delegationId: mandate.id };
    }
  }
  return null;
}
