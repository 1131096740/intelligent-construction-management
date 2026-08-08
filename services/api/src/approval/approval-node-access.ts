import type { RoleKey } from "@jiangkong/shared-domain";
import { requiresApprovalSelfReviewConfirmation } from "./approval-self-review";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  type ActiveApprovalDelegatorIdentity,
  type FrozenApprovalNode
} from "./approval-review-identity";

interface ApprovalNode extends FrozenApprovalNode {
  roleKeys?: unknown;
  approvedRoleKeys?: unknown;
  assignments?: unknown;
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
  activeDelegatorsOrLegacyAccess: readonly ActiveApprovalDelegatorIdentity[] | boolean,
  allowContractDirectorSelfReview = false
): ApprovalReviewAccess {
  const node = approvalNodeAt(frozenNodes, currentNodeIndex);
  const identity = node
    ? resolveApprovalReviewIdentity({
        node,
        actorUserId: userId,
        actorRoleKeys: roleKeys,
        activeDelegators: Array.isArray(activeDelegatorsOrLegacyAccess)
          ? activeDelegatorsOrLegacyAccess
          : []
      })
    : null;
  const legacyDelegatedAccess =
    activeDelegatorsOrLegacyAccess === true &&
    Boolean(node) &&
    !isGovernedFrozenApprovalNode(node);
  const canAct = Boolean(identity) || legacyDelegatedAccess;
  const nodeRoleKeys = roleKeysForFrozenApprovalNode(frozenNodes, currentNodeIndex);
  const requiresSelfReviewConfirmation =
    canAct && identity?.viaAssignment !== true &&
    requiresApprovalSelfReviewConfirmation({
      applicantUserId,
      actorUserId: userId,
      actorRoleKeys: identity ? [identity.approvedRoleKey] : roleKeys,
      nodeRoleKeys,
      allowContractDirectorSelfReview
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

  return Boolean(resolveApprovalReviewIdentity({
    node,
    actorUserId: userId,
    actorRoleKeys: roleKeys
  }));
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

export function roleKeysForFrozenApprovalNode(
  frozenNodes: unknown,
  currentNodeIndex: number
): RoleKey[] {
  if (!Array.isArray(frozenNodes)) {
    return [];
  }

  const node = frozenNodes[currentNodeIndex] as ApprovalNode | undefined;
  return node ? stringArray(node.roleKeys).map((role) => role as RoleKey) : [];
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

function approvalNodeAt(frozenNodes: unknown, currentNodeIndex: number): ApprovalNode | null {
  if (!Array.isArray(frozenNodes)) return null;
  return (frozenNodes[currentNodeIndex] as ApprovalNode | undefined) ?? null;
}
