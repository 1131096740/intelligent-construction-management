import { BadRequestException } from "@nestjs/common";
import { pendingRoleKeysForFrozenApprovalNode } from "../approval/approval-node-access";
import {
  finalApprovalEvidence,
  type ApprovalEvidenceAction
} from "../approval/approval-evidence";
import {
  activeApprovalNodeIndexes,
  hasVersionedApprovalNodes,
  isParallelApprovalRound
} from "../approval/parallel-approval-protocol";
import {
  paymentApprovalNodes,
  type SpotProcurementApprovalNode
} from "./spot-procurement-approval-nodes";

type LegacyParallelPaymentNode = SpotProcurementApprovalNode & { legacySerialCutover: true };

export function isLegacySerialCutoverRound(frozenNodes: unknown): boolean {
  return isParallelApprovalRound(frozenNodes) &&
    frozenNodes.every((node) => node.legacySerialCutover === true);
}

export function hasInvalidLegacySerialCutoverMarker(frozenNodes: unknown): boolean {
  return Array.isArray(frozenNodes) &&
    frozenNodes.some((node) => node && typeof node === "object" && "legacySerialCutover" in node) &&
    !isLegacySerialCutoverRound(frozenNodes);
}

export function pendingSpotPaymentPayerApprovalRoles(
  frozenNodes: unknown,
  currentNodeIndex: number
) {
  if (hasInvalidLegacySerialCutoverMarker(frozenNodes)) return [];
  const indexes = isLegacySerialCutoverRound(frozenNodes)
    ? activeApprovalNodeIndexes(frozenNodes, currentNodeIndex)
    : [currentNodeIndex];
  return indexes.flatMap((index) =>
    pendingRoleKeysForFrozenApprovalNode(frozenNodes, index)
  );
}

type BlockedReason =
  | "unsupported_frozen_nodes"
  | "invalid_cursor"
  | "ambiguous_action_history"
  | "inconsistent_completed_duties"
  | "invalid_signature_evidence";

type SpotPaymentApprovalCutoverPlan =
  | { status: "blocked"; reason: BlockedReason }
  | {
      status: "mapped";
      frozenNodes: LegacyParallelPaymentNode[];
      completedActionIds: string[];
      pendingNodeIndexes: number[];
    };

function blocked(reason: BlockedReason): SpotPaymentApprovalCutoverPlan {
  return { status: "blocked", reason };
}

/**
 * Validates the old duty mapping without writing the round or its actions.
 * A cutover caller must separately preserve legacy payment finalization and
 * validate the original signature objects before making the converted round live.
 */
export function planSpotPaymentApprovalCutover({
  frozenNodes,
  currentNodeIndex,
  actionLogs
}: {
  frozenNodes: unknown;
  currentNodeIndex: number;
  actionLogs: readonly ApprovalEvidenceAction[];
}): SpotPaymentApprovalCutoverPlan {
  const expected = paymentApprovalNodes();
  if (!Array.isArray(frozenNodes) || frozenNodes.length !== expected.length ||
      hasVersionedApprovalNodes(frozenNodes)) {
    return blocked("unsupported_frozen_nodes");
  }
  if (!Number.isInteger(currentNodeIndex) || currentNodeIndex < 0 ||
      currentNodeIndex >= frozenNodes.length) {
    return blocked("invalid_cursor");
  }

  const nodes: LegacyParallelPaymentNode[] = [];
  for (const [index, node] of frozenNodes.entries()) {
    const roles = expected[index].roleKeys;
    if (!node || typeof node !== "object" || Array.isArray(node) ||
        typeof node.name !== "string" || !node.name.trim() || node.mode !== "any" ||
        !Array.isArray(node.roleKeys) || node.roleKeys.length !== roles.length ||
        !roles.every(role => node.roleKeys.includes(role))) {
      return blocked("unsupported_frozen_nodes");
    }
    if (node.approvedRoleKeys !== undefined &&
        (!Array.isArray(node.approvedRoleKeys) || node.approvedRoleKeys.length > 1 ||
          node.approvedRoleKeys.some((role: unknown) => !node.roleKeys.includes(role)))) {
      return blocked("inconsistent_completed_duties");
    }
    if ((node.approvedRoleKeys?.length ?? 0) !== (index < currentNodeIndex ? 1 : 0)) {
      return blocked("inconsistent_completed_duties");
    }
    nodes.push({
      ...node,
      roleKeys: [...node.roleKeys],
      ...(node.approvedRoleKeys ? { approvedRoleKeys: [...node.approvedRoleKeys] } : {}),
      protocolVersion: 1,
      executionMode: "parallel",
      legacySerialCutover: true
    });
  }

  // The serial submit paths write an AuditLog entry, so an ApprovalActionLog
  // submit is optional. A later submit or reset makes this mapping ambiguous.
  if (new Set(actionLogs.map(log => log.id)).size !== actionLogs.length ||
      actionLogs.some((log, index) => !log.id.trim() ||
        (log.action !== "approve" && !(index === 0 && log.action === "submit")))) {
    return blocked("ambiguous_action_history");
  }
  const approvals = actionLogs.filter(log => log.action === "approve");
  if (approvals.length !== currentNodeIndex ||
      approvals.some((log, index) => log.approvedRoleKey !== nodes[index].approvedRoleKeys?.[0])) {
    return blocked("inconsistent_completed_duties");
  }
  try {
    finalApprovalEvidence("approval_pending", nodes, actionLogs);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return blocked("invalid_signature_evidence");
  }

  return {
    status: "mapped",
    frozenNodes: nodes,
    completedActionIds: approvals.map(log => log.id),
    pendingNodeIndexes: activeApprovalNodeIndexes(nodes, currentNodeIndex)
  };
}
