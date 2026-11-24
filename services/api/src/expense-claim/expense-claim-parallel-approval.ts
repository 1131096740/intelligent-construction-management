import { GLOBAL_BUSINESS_ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import {
  frozenCandidateUserIds, resolveApprovalReviewIdentity,
  type ApprovalActorRoleScopes, type ApprovalReviewIdentity, type FrozenApprovalNode
} from "../approval/approval-review-identity";
import { isApprovalDutyComplete } from "../approval/parallel-approval-protocol";

export const EXPENSE_CURRENT_ROLE_SCOPE = "current_role_scope";

type ExpenseDuty = FrozenApprovalNode & { candidatePolicy?: unknown };

function roleScope(node: ExpenseDuty, role: RoleKey): "global" | "project" | undefined {
  const scopes = node.roleScopesByRole;
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) return;
  const scope = (scopes as Record<string, unknown>)[role];
  if (scope === "global" || scope === "project") return scope;
}

export function resolveExpenseParallelDutyIdentity(input: {
  node: ExpenseDuty;
  actorUserId: string;
  actorRoleScopes: ApprovalActorRoleScopes;
}): ApprovalReviewIdentity | null {
  const { node, actorUserId } = input;
  const actorRoleScopes = {
    ...input.actorRoleScopes,
    globalRoleKeys: input.actorRoleScopes.globalRoleKeys.filter(role =>
      role === "employee" || GLOBAL_BUSINESS_ROLE_KEYS.includes(role))
  };
  if (node.candidatePolicy === EXPENSE_CURRENT_ROLE_SCOPE) {
    if (!Array.isArray(node.roleKeys) ||
        isApprovalDutyComplete({ mode: node.mode, roleKeys: node.roleKeys, approvedRoleKeys: node.approvedRoleKeys })) return null;
    const approved = Array.isArray(node.approvedRoleKeys) ? node.approvedRoleKeys : [];
    const approvedRoleKey = (node.roleKeys as RoleKey[]).find(role => {
      const scope = roleScope(node, role);
      return !approved.includes(role) && (
        scope === "global" && actorRoleScopes.globalRoleKeys.includes(role) ||
        scope === "project" && actorRoleScopes.projectRoleKeys.includes(role)
      );
    });
    return approvedRoleKey ? { approvedRoleKey, representedUserId: actorUserId, viaAssignment: false } : null;
  }

  // Reconstructed rounds keep the original frozen candidate and witness constraints.
  const identity = resolveApprovalReviewIdentity({
    node, actorUserId, actorRoleKeys: [...actorRoleScopes.globalRoleKeys, ...actorRoleScopes.projectRoleKeys], actorRoleScopes
  });
  return identity?.representedUserId === actorUserId && !identity.viaAssignment ? identity : null;
}

export async function loadExpenseApprovalCandidateIds(
  tx: Prisma.TransactionClient,
  projectId: string | null,
  nodes: readonly ExpenseDuty[]
): Promise<string[][]> {
  const dynamicNodes = nodes.filter(node => node.candidatePolicy === EXPENSE_CURRENT_ROLE_SCOPE);
  const roles = [...new Set(dynamicNodes.flatMap(node => Array.isArray(node.roleKeys) ? node.roleKeys as RoleKey[] : []))];
  if (!roles.length) return nodes.map(frozenCandidateUserIds);

  const positions = await tx.position.findMany({ where: { key: { in: roles } }, select: { id: true, key: true } });
  const [assignments, memberships] = await Promise.all([
    tx.userPosition.findMany({
      where: { positionId: { in: positions.map(position => position.id) }, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
      select: { userId: true, positionId: true, projectId: true }
    }),
    projectId ? tx.projectMember.findMany({
      where: { projectId, positionKey: { in: roles } }, select: { userId: true, positionKey: true }
    }) : Promise.resolve([])
  ]);
  const positionRoles = new Map(positions.map(position => [position.id, position.key as RoleKey]));
  const scoped = [
    ...assignments.map(item => ({ id: item.userId, role: positionRoles.get(item.positionId), scope: item.projectId === null ? "global" : "project" })),
    ...memberships.map(item => ({ id: item.userId, role: item.positionKey as RoleKey, scope: "project" }))
  ];
  const active = await tx.user.findMany({
    where: { id: { in: [...new Set(scoped.map(item => item.id))] }, isActive: true }, select: { id: true }
  });
  const activeIds = new Set(active.map(user => user.id));
  return nodes.map(node => {
    if (node.candidatePolicy !== EXPENSE_CURRENT_ROLE_SCOPE) return frozenCandidateUserIds(node);
    if (!Array.isArray(node.roleKeys)) return [];
    const rolesForNode: unknown[] = node.roleKeys;
    return [...new Set(scoped.filter(item =>
      item.role && rolesForNode.includes(item.role) && roleScope(node, item.role) === item.scope &&
      activeIds.has(item.id)
    ).map(item => item.id))].sort();
  });
}

export function isPureExpenseReimbursement(claim: {
  claimType: string;
  generalProcurementId?: string | null;
  actualPurchaseBatchId?: string | null;
}): boolean {
  return claim.claimType === "reimbursement" &&
    claim.generalProcurementId == null && claim.actualPurchaseBatchId == null;
}

export const pureExpenseReimbursementWhere = {
  claimType: "reimbursement", generalProcurementId: null, actualPurchaseBatchId: null
} satisfies Prisma.ExpenseClaimWhereInput;

export const projectIncidentalExpenseWhere = {
  claimType: "incidental_expense", projectId: { not: null }
} satisfies Prisma.ExpenseClaimWhereInput;

export function supportsExpenseParallelApproval(claim: Parameters<typeof isPureExpenseReimbursement>[0] & {
  projectId: string | null;
}): boolean {
  return isPureExpenseReimbursement(claim) ||
    (claim.claimType === "incidental_expense" && claim.projectId != null);
}

export async function loadExpenseApprovalRoleScopes(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string | null
): Promise<ApprovalActorRoleScopes> {
  const [assignments, memberships] = await Promise.all([
    tx.userPosition.findMany({
      where: { userId, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
      select: { positionId: true, projectId: true }
    }),
    projectId ? tx.projectMember.findMany({
      where: { userId, projectId },
      select: { positionKey: true }
    }) : Promise.resolve([])
  ]);
  const positions = assignments.length ? await tx.position.findMany({
    where: { id: { in: assignments.map(assignment => assignment.positionId) } },
    select: { id: true, key: true }
  }) : [];
  const roleByPosition = new Map(positions.map(position => [position.id, position.key as RoleKey]));
  const globalRoleKeys = new Set<RoleKey>();
  const projectRoleKeys = new Set(memberships.map(membership => membership.positionKey as RoleKey));
  for (const assignment of assignments) {
    const role = roleByPosition.get(assignment.positionId);
    if (!role) continue;
    if (assignment.projectId === null) {
      if (role === "employee" || GLOBAL_BUSINESS_ROLE_KEYS.includes(role)) globalRoleKeys.add(role);
    } else if (assignment.projectId === projectId) {
      projectRoleKeys.add(role);
    }
  }
  return { globalRoleKeys: [...globalRoleKeys], projectRoleKeys: [...projectRoleKeys] };
}
