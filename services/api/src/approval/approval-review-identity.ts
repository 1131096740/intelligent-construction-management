import type { RoleKey } from "@jiangkong/shared-domain";

export interface FrozenApprovalAssignment {
  kind?: "transfer" | "delegate";
  fromUserId?: unknown;
  fromRoleKey?: unknown;
  toUserId?: unknown;
}

export interface FrozenApprovalNode {
  name?: unknown;
  mode?: unknown;
  roleKeys?: unknown;
  approvedRoleKeys?: unknown;
  candidateUserIds?: unknown;
  candidateUserIdsByRole?: unknown;
  selectedUserId?: unknown;
  assignments?: unknown;
}

export interface ApprovalReviewIdentity {
  approvedRoleKey: RoleKey;
  representedUserId: string;
  viaAssignment: boolean;
}

export interface ActiveApprovalDelegatorIdentity {
  userId: string;
  roleKeys: readonly RoleKey[];
}

export function isGovernedFrozenApprovalNode(node: unknown): node is FrozenApprovalNode {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  return ["candidateUserIdsByRole", "candidateUserIds", "selectedUserId"].some((key) =>
    Object.prototype.hasOwnProperty.call(node, key)
  );
}

export function resolveApprovalReviewIdentity(input: {
  node: FrozenApprovalNode;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
  activeDelegators?: readonly ActiveApprovalDelegatorIdentity[];
}): ApprovalReviewIdentity | null {
  const pendingRoles = pendingRoleKeys(input.node);
  if (!pendingRoles.length) return null;

  const directRole = directFrozenRole(
    input.node,
    input.actorUserId,
    pendingRoles,
    input.actorRoleKeys
  );
  if (directRole) {
    return { approvedRoleKey: directRole, representedUserId: input.actorUserId, viaAssignment: false };
  }

  const assignments = Array.isArray(input.node.assignments)
    ? (input.node.assignments as FrozenApprovalAssignment[])
    : [];
  for (const assignment of assignments) {
    if (assignment.toUserId !== input.actorUserId) continue;
    if (typeof assignment.fromRoleKey !== "string") continue;
    const role = assignment.fromRoleKey as RoleKey;
    if (!pendingRoles.includes(role)) continue;
    if (isGovernedFrozenApprovalNode(input.node)) {
      if (
        typeof assignment.fromUserId !== "string" ||
        !isFrozenCandidateForRole(input.node, assignment.fromUserId, role)
      ) {
        continue;
      }
      return { approvedRoleKey: role, representedUserId: assignment.fromUserId, viaAssignment: true };
    }
    return {
      approvedRoleKey: role,
      representedUserId:
        typeof assignment.fromUserId === "string" ? assignment.fromUserId : input.actorUserId,
      viaAssignment: true
    };
  }

  for (const delegator of input.activeDelegators ?? []) {
    const delegatorUserId = delegator.userId;
    const delegatedRole = isGovernedFrozenApprovalNode(input.node)
      ? uniqueFrozenRole(input.node, delegatorUserId, pendingRoles)
      : pendingRoles.find((role) => delegator.roleKeys.includes(role));
    if (delegatedRole && delegator.roleKeys.includes(delegatedRole)) {
      return { approvedRoleKey: delegatedRole, representedUserId: delegatorUserId, viaAssignment: false };
    }
  }

  if (isGovernedFrozenApprovalNode(input.node)) return null;
  const legacyRole = pendingRoles.find((role) => input.actorRoleKeys.includes(role));
  return legacyRole
    ? { approvedRoleKey: legacyRole, representedUserId: input.actorUserId, viaAssignment: false }
    : null;
}

export function frozenCandidateUserIds(node: FrozenApprovalNode): string[] {
  if (!isGovernedFrozenApprovalNode(node)) return [];
  const selected = typeof node.selectedUserId === "string" ? [node.selectedUserId] : [];
  const union = stringArray(node.candidateUserIds);
  const byRole = candidateMap(node.candidateUserIdsByRole);
  return Array.from(new Set([...selected, ...union, ...Object.values(byRole).flat()]));
}

export async function assertActiveApprovalRecipient(
  tx: unknown,
  userId: string
): Promise<void> {
  const userClient = (tx as { user?: { findUnique(input: unknown): Promise<{ isActive: boolean } | null> } }).user;
  if (!userClient) return;
  const recipient = await userClient.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!recipient?.isActive) {
    throw new Error("审批接收人不存在或已停用，请重新选择");
  }
}

function directFrozenRole(
  node: FrozenApprovalNode,
  userId: string,
  pendingRoles: RoleKey[],
  actorRoleKeys: readonly RoleKey[]
): RoleKey | null {
  if (!isGovernedFrozenApprovalNode(node)) return null;
  if (Object.prototype.hasOwnProperty.call(node, "selectedUserId") && node.selectedUserId !== userId) {
    return null;
  }
  const role = uniqueFrozenRole(node, userId, pendingRoles);
  return role && actorRoleKeys.includes(role) ? role : null;
}

function uniqueFrozenRole(
  node: FrozenApprovalNode,
  userId: string,
  pendingRoles: RoleKey[]
): RoleKey | null {
  const mapPresent = Object.prototype.hasOwnProperty.call(node, "candidateUserIdsByRole");
  if (mapPresent) {
    const byRole = candidateMap(node.candidateUserIdsByRole);
    const matches = pendingRoles.filter((role) => byRole[role]?.includes(userId));
    return matches.length === 1 ? matches[0] : null;
  }
  const unionPresent = Object.prototype.hasOwnProperty.call(node, "candidateUserIds");
  if (unionPresent && stringArray(node.candidateUserIds).includes(userId) && pendingRoles.length === 1) {
    return pendingRoles[0];
  }
  if (typeof node.selectedUserId === "string" && node.selectedUserId === userId && pendingRoles.length === 1) {
    return pendingRoles[0];
  }
  return null;
}

function isFrozenCandidateForRole(
  node: FrozenApprovalNode,
  userId: string,
  role: RoleKey
) {
  if (
    Object.prototype.hasOwnProperty.call(node, "selectedUserId") &&
    node.selectedUserId !== userId
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(node, "candidateUserIdsByRole")) {
    return candidateMap(node.candidateUserIdsByRole)[role]?.includes(userId) === true;
  }
  return stringArray(node.candidateUserIds).includes(userId);
}

function pendingRoleKeys(node: FrozenApprovalNode): RoleKey[] {
  const approved = new Set(stringArray(node.approvedRoleKeys));
  return stringArray(node.roleKeys)
    .filter((role) => !approved.has(role))
    .map((role) => role as RoleKey);
}

function candidateMap(value: unknown): Partial<Record<RoleKey, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, ids]) => [key, stringArray(ids)])
  ) as Partial<Record<RoleKey, string[]>>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
