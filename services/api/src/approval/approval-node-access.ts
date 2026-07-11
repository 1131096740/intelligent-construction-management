import type { RoleKey } from "@jiangkong/shared-domain";
import { requiresApprovalSelfReviewConfirmation } from "./approval-self-review";

interface ApprovalNode {
  roleKeys?: unknown;
  approvedRoleKeys?: unknown;
  assignments?: unknown;
}

interface ApprovalAssignment {
  toUserId?: unknown;
  fromRoleKey?: unknown;
}

export interface ApprovalReviewAccess {
  canAct: boolean;
  canReview: boolean;
  requiresSelfReviewConfirmation: boolean;
}

export function approvalReviewAccessOnFrozenNode(
  frozenNodes: unknown,
  currentNodeIndex: number,
  roleKeys: RoleKey[],
  userId: string,
  applicantUserId: string,
  hasDelegatedRole: boolean
): ApprovalReviewAccess {
  const canAct =
    canActOnFrozenApprovalNode(frozenNodes, currentNodeIndex, roleKeys, userId) ||
    hasDelegatedRole;
  const pendingRoleKeys = pendingRoleKeysForFrozenApprovalNode(frozenNodes, currentNodeIndex);
  const requiresSelfReviewConfirmation =
    canAct &&
    requiresApprovalSelfReviewConfirmation({
      applicantUserId,
      actorUserId: userId,
      actorRoleKeys: roleKeys,
      pendingRoleKeys
    });

  return {
    canAct,
    canReview: canAct && (applicantUserId !== userId || requiresSelfReviewConfirmation),
    requiresSelfReviewConfirmation
  };
}

export function canActOnFrozenApprovalNode(
  frozenNodes: unknown,
  currentNodeIndex: number,
  roleKeys: RoleKey[],
  userId: string
) {
  if (!Array.isArray(frozenNodes)) {
    return false;
  }

  const node = frozenNodes[currentNodeIndex] as ApprovalNode | undefined;
  if (!node) {
    return false;
  }

  const pendingRoleKeys = pendingRoleKeysForApprovalNode(node);
  const hasRoleTodo = pendingRoleKeys.some((role) => roleKeys.includes(role as RoleKey));
  const assignments = Array.isArray(node.assignments) ? (node.assignments as ApprovalAssignment[]) : [];
  const hasAssignmentTodo = assignments.some(
    (assignment) =>
      assignment.toUserId === userId &&
      typeof assignment.fromRoleKey === "string" &&
      pendingRoleKeys.includes(assignment.fromRoleKey as RoleKey)
  );

  return hasRoleTodo || hasAssignmentTodo;
}

export function pendingRoleKeysForFrozenApprovalNode(
  frozenNodes: unknown,
  currentNodeIndex: number
): RoleKey[] {
  if (!Array.isArray(frozenNodes)) {
    return [];
  }

  const node = frozenNodes[currentNodeIndex] as ApprovalNode | undefined;
  return node ? pendingRoleKeysForApprovalNode(node) : [];
}

export function pendingRoleKeysForApprovalNode(node: ApprovalNode): RoleKey[] {
  const approvedRoleKeys = new Set(stringArray(node.approvedRoleKeys));
  return stringArray(node.roleKeys)
    .filter((role) => !approvedRoleKeys.has(role))
    .map((role) => role as RoleKey);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
