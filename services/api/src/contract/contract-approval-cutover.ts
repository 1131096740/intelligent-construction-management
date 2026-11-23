import { ACTION_REQUIRED_ROLES } from "@jiangkong/shared-domain";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { finalApprovalEvidence } from "../approval/approval-evidence";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import { hasVersionedApprovalNodes } from "../approval/parallel-approval-protocol";
import type { PrismaService } from "../database/prisma.service";
import type { FileService } from "../file/file.service";

type BlockedReason =
  | "not_in_legacy_approval"
  | "active_round_not_unique"
  | "unsupported_frozen_nodes"
  | "unproven_frozen_principals"
  | "legacy_assignment"
  | "invalid_cursor"
  | "ambiguous_action_history"
  | "invalid_signature_evidence";

type LegacyContractCutoverPlan =
  | { status: "blocked"; reason: BlockedReason }
  | {
      status: "planned";
      approvalInstanceId: string;
      frozenNodes: Prisma.JsonArray;
      completedActionIds: string[];
      pendingNodeIndexes: number[];
    };

const permittedRoles = new Set<string>(ACTION_REQUIRED_ROLES["contract.approve"]);

function blocked(reason: BlockedReason): LegacyContractCutoverPlan {
  return { status: "blocked", reason };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function distinctIds(value: unknown): value is string[] {
  return Array.isArray(value) && new Set(value).size === value.length &&
    value.every(id => typeof id === "string" && id.length > 0 && id.trim() === id);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Read frozen legacy authority and verify existing signatures. The result preserves the serial snapshot verbatim for inspection. */
export function inspectLegacyContractApprovalCutover(
  prisma: Pick<PrismaService, "$transaction">,
  files: Pick<FileService, "getFileBuffer">,
  contractVersionId: string
): Promise<LegacyContractCutoverPlan> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }, select: { status: true, numericProtocolVersion: true }
    });
    if (version?.status !== "in_approval" || version.numericProtocolVersion !== 1) {
      return blocked("not_in_legacy_approval");
    }
    const rounds = await tx.approvalInstance.findMany({
      where: { businessType: "contract_version", businessId: contractVersionId, flowType: "contract.approve", status: "in_progress" },
      select: { id: true, applicantUserId: true, currentNodeIndex: true, frozenNodes: true },
      take: 2
    });
    if (rounds.length !== 1) return blocked("active_round_not_unique");
    const { id, applicantUserId, currentNodeIndex, frozenNodes } = rounds[0];
    if (!Array.isArray(frozenNodes) || !frozenNodes.length || hasVersionedApprovalNodes(frozenNodes)) {
      return blocked("unsupported_frozen_nodes");
    }
    if (!Number.isInteger(currentNodeIndex) || currentNodeIndex < 0 || currentNodeIndex >= frozenNodes.length) {
      return blocked("invalid_cursor");
    }

    const rolesSeen = new Set<string>();
    const duties: { candidateUserIds: string[]; candidatesByRole: ReadonlyMap<string, string[]> }[] = [];
    for (const node of frozenNodes) {
      if (!object(node) || typeof node.name !== "string" || !node.name.trim() || node.mode !== "any" ||
          !distinctIds(node.roleKeys) || !node.roleKeys.length ||
          node.roleKeys.some(role => !permittedRoles.has(role) || rolesSeen.has(role)) ||
          Object.hasOwn(node, "legacySerialCutover") || Object.hasOwn(node, "submissionSnapshot")) {
        return blocked("unsupported_frozen_nodes");
      }
      // Legacy serial approvals advance the cursor and append an action. A declared
      // completion in a frozen node needs a separate lineage check.
      if (node.approvedRoleKeys !== undefined && (!Array.isArray(node.approvedRoleKeys) || node.approvedRoleKeys.length)) {
        return blocked("ambiguous_action_history");
      }
      if (Object.hasOwn(node, "assignments") && (!Array.isArray(node.assignments) || node.assignments.length)) {
        return blocked("legacy_assignment");
      }
      const { roleKeys, candidateUserIds, candidateUserIdsByRole, roleScopesByRole } = node;
      if (Object.hasOwn(node, "selectedUserId") || !object(candidateUserIdsByRole) || !object(roleScopesByRole) ||
          !distinctIds(candidateUserIds) || !candidateUserIds.length ||
          !hasExactlyKeys(candidateUserIdsByRole, roleKeys) || !hasExactlyKeys(roleScopesByRole, roleKeys)) {
        return blocked("unproven_frozen_principals");
      }
      const candidatesByRole = new Map<string, string[]>();
      for (const role of roleKeys) {
        const eligible = candidateUserIdsByRole[role];
        const scope = roleScopesByRole[role];
        if (!distinctIds(eligible) || (scope !== "global" && scope !== "project")) {
          return blocked("unproven_frozen_principals");
        }
        rolesSeen.add(role);
        candidatesByRole.set(role, eligible);
      }
      const union = new Set([...candidatesByRole.values()].flat());
      if (union.size !== candidateUserIds.length || candidateUserIds.some(userId => !union.has(userId))) {
        return blocked("unproven_frozen_principals");
      }
      duties.push({ candidateUserIds, candidatesByRole });
    }

    const logs = await tx.approvalActionLog.findMany({
      where: { approvalInstanceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    if (logs.some((log, index) => log.action !== "approve" && !(index === 0 && log.action === "submit" &&
      log.actorUserId === applicantUserId && !log.signatureFileIdSnapshot && !log.signatureVersionIdSnapshot && !log.signatureSha256Snapshot))) {
      return blocked("ambiguous_action_history");
    }
    const approvals = logs.filter(log => log.action === "approve");
    if (approvals.some(log => log.representedUserId && log.representedUserId !== log.actorUserId)) {
      return blocked("legacy_assignment");
    }
    if (approvals.length !== currentNodeIndex || approvals.some((log, index) =>
      !duties[index].candidatesByRole.get(log.approvedRoleKey ?? "")?.includes(log.actorUserId))) {
      return blocked("ambiguous_action_history");
    }

    const pending = duties.slice(currentNodeIndex);
    const standing = await tx.approvalDelegation.findFirst({
      where: {
        fromUserId: { in: [...new Set(pending.flatMap(duty => duty.candidateUserIds))] },
        actionKey: null, resourceType: null, resourceId: null, enabled: true, endsAt: { gt: new Date() }
      },
      select: { id: true }
    });
    if (standing) return blocked("legacy_assignment");

    try {
      if (approvals.length) finalApprovalEvidence("approved", frozenNodes.slice(0, currentNodeIndex), approvals);
      for (const log of approvals) {
        const signature = await tx.handwrittenSignatureVersion.findUnique({
          where: { id: log.signatureVersionIdSnapshot! },
          select: { source: true, userId: true, fileId: true, contentSha256: true }
        });
        if (!signature || signature.source !== "canvas" || signature.userId !== log.actorUserId ||
            signature.fileId !== log.signatureFileIdSnapshot ||
            signature.contentSha256.toLowerCase() !== log.signatureSha256Snapshot?.toLowerCase()) {
          return blocked("invalid_signature_evidence");
        }
        const { file, buffer } = await files.getFileBuffer(signature.fileId, tx);
        if (file.storageStatus !== "active" || file.contentSha256?.toLowerCase() !== signature.contentSha256.toLowerCase()) {
          return blocked("invalid_signature_evidence");
        }
        verifyApprovalSignatureSnapshot(buffer, signature.contentSha256);
      }
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      return blocked("invalid_signature_evidence");
    }

    return {
      status: "planned",
      approvalInstanceId: id,
      frozenNodes,
      completedActionIds: approvals.map(log => log.id),
      pendingNodeIndexes: pending.map((_, index) => currentNodeIndex + index)
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
