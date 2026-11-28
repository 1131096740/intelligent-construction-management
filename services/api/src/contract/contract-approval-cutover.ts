import { ACTION_REQUIRED_ROLES } from "@jiangkong/shared-domain";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import { lockApprovalReviewRow } from "../approval/approval-review-lock";
import { resolveContractOriginators } from "./contract-originators";
import { finalApprovalEvidence } from "../approval/approval-evidence";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import { hasVersionedApprovalNodes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import type { PrismaService } from "../database/prisma.service";
import type { FileService } from "../file/file.service";
import type { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";

function isLegacyExecutiveDuty(node: unknown) {
  return object(node) && distinctIds(node.roleKeys) && node.roleKeys.length === 2 &&
    node.roleKeys.includes("chairman") && node.roleKeys.includes("general_manager") &&
    object(node.roleScopesByRole) && node.roleScopesByRole.chairman === "global" &&
    node.roleScopesByRole.general_manager === "global";
}

/** Admission keeps the original v1 authority and marks only this round's approved duties. */
export function isLegacyContractParallelRound(nodes: unknown): nodes is Array<Record<string, unknown> & {
  legacyContractCutover: true; approvedRoleKeys: string[]
}> {
  return isParallelApprovalRound(nodes) && isLegacyExecutiveDuty(nodes.at(-1)) &&
    nodes.every(node => node.legacyContractCutover === true && node.mode === "any" &&
      distinctIds(node.approvedRoleKeys) && node.approvedRoleKeys.length <= 1 &&
      node.approvedRoleKeys.every(role => (node.roleKeys as string[]).includes(role)));
}

export function isPendingLegacyContractCutover(
  version: { id: string; status: string; numericProtocolVersion: number } | null | undefined,
  round: { businessType: string; businessId: string; flowType: string; status: string; frozenNodes: unknown } | null
) {
  return version?.numericProtocolVersion === 1 && version.status === "in_approval" &&
    round?.businessType === "contract_version" && round.businessId === version.id &&
    round.flowType === "contract.approve" && round.status === "in_progress" &&
    isLegacyContractParallelRound(round.frozenNodes);
}

type LegacyActivationCoordinates = {
  approvalInstanceId: string;
  versionUpdatedAt: Date;
  approvalUpdatedAt: Date;
};

function cutoverConflict() {
  return new ConflictException("合同或审批轮次已变化，须重新核对原岗位和签批记录");
}

/** Internal cutover step for the exact inventoried version in a stopped-writer environment. */
export async function activateLegacyContractApprovalCutover(
  prisma: Pick<PrismaService, "$transaction">,
  files: Pick<FileService, "getFileBuffer">,
  audit: Pick<AuditService, "record">,
  actorUserId: string,
  contractVersionId: string,
  expected: LegacyActivationCoordinates,
  freeze: Pick<OperationalWriteFreezeService, "isFrozen">
) {
  if (!freeze.isFrozen("contract")) throw new ConflictException("请先暂停合同写入，再切换在途审批");
  return prisma.$transaction(async tx => {
    await lockApprovalReviewRow(tx, Prisma.sql`
      SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE
    `);
    await lockApprovalReviewRow(tx, Prisma.sql`
      SELECT "id" FROM "ApprovalInstance"
      WHERE "businessType" = 'contract_version' AND "businessId" = ${contractVersionId}
        AND "flowType" = 'contract.approve' AND "status" = 'in_progress'
      ORDER BY "id" FOR UPDATE
    `);
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    if (!actor?.isActive) throw new ForbiddenException("合同审批切换经办人不存在或已停用");
    const plan = await inspectRound(tx, files, contractVersionId, expected);
    if (plan.status !== "planned" || !isLegacyExecutiveDuty(plan.frozenNodes.at(-1))) throw cutoverConflict();
    // The inventoried cursor advances only through an unbroken signed prefix. A
    // terminal executive duty is therefore still pending on every eligible round.
    await resolveContractOriginators(tx, contractVersionId, plan.frozenNodes);
    const history = await tx.approvalActionLog.findMany({
      where: { approvalInstanceId: plan.approvalInstanceId, id: { in: plan.completedActionIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, approvedRoleKey: true }
    });
    if (history.length !== plan.completedActionIds.length || history.some((action, index) =>
      action.id !== plan.completedActionIds[index] || !action.approvedRoleKey)) throw cutoverConflict();
    const nodes = plan.frozenNodes.map((node, index) => ({
      ...(node as Prisma.JsonObject), protocolVersion: 1, executionMode: "parallel", legacyContractCutover: true,
      approvedRoleKeys: history[index]?.approvedRoleKey ? [history[index].approvedRoleKey] : []
    }));
    await tx.approvalInstance.update({ where: { id: plan.approvalInstanceId }, data: { frozenNodes: nodes } });
    await audit.record(tx, {
      actorUserId, action: "contract.approval.legacy_cutover", businessType: "contract_version",
      businessId: contractVersionId, metadata: { approvalInstanceId: plan.approvalInstanceId,
        completedActionIds: plan.completedActionIds, pendingNodeIndexes: plan.pendingNodeIndexes,
        expectedContractUpdatedAt: expected.versionUpdatedAt.toISOString(),
        expectedApprovalUpdatedAt: expected.approvalUpdatedAt.toISOString() }
    });
    return { approvalInstanceId: plan.approvalInstanceId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type BlockedReason =
  | "not_in_legacy_approval"
  | "active_round_not_unique"
  | "unsupported_frozen_nodes"
  | "unproven_frozen_principals"
  | "legacy_assignment"
  | "invalid_cursor"
  | "ambiguous_action_history"
  | "invalid_signature_evidence"
  | "signature_file_unavailable";

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
  return prisma.$transaction(
    (tx) => inspectRound(tx, files, contractVersionId),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

/** Inventories the legacy in-approval contract versions from one consistent database snapshot. */
export function inspectLegacyContractApprovalInventory(
  prisma: Pick<PrismaService, "$transaction">,
  files: Pick<FileService, "getFileBuffer">
) {
  return prisma.$transaction(async (tx) => {
    const [session] = await tx.$queryRaw<Array<{ readOnly: string }>>`
      SELECT current_setting('transaction_read_only') AS "readOnly"
    `;
    if (session?.readOnly !== "on") throw new Error("合同审批迁移盘点必须使用只读事务");
    const versions = await tx.contractVersion.findMany({
      where: { status: "in_approval", numericProtocolVersion: 1 }, select: { id: true }, orderBy: { id: "asc" }
    });
    let planned = 0;
    const blockedByReason: Partial<Record<BlockedReason, number>> = {};
    for (const version of versions) {
      const result = await inspectRound(tx, files, version.id);
      if (result.status === "planned") planned++;
      else blockedByReason[result.reason] = (blockedByReason[result.reason] ?? 0) + 1;
    }
    return { total: versions.length, planned, blocked: versions.length - planned, blockedByReason };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
}

async function inspectRound(
  tx: Prisma.TransactionClient,
  files: Pick<FileService, "getFileBuffer">,
  contractVersionId: string,
  expected?: LegacyActivationCoordinates
): Promise<LegacyContractCutoverPlan> {
  const version = await tx.contractVersion.findUnique({
    where: { id: contractVersionId }, select: { status: true, numericProtocolVersion: true, updatedAt: true }
  });
  if (version?.status !== "in_approval" || version.numericProtocolVersion !== 1) {
    return blocked("not_in_legacy_approval");
  }
  if (expected && version.updatedAt.getTime() !== expected.versionUpdatedAt.getTime()) throw cutoverConflict();
  const rounds = await tx.approvalInstance.findMany({
    where: { businessType: "contract_version", businessId: contractVersionId, flowType: "contract.approve", status: "in_progress" },
    select: { id: true, applicantUserId: true, currentNodeIndex: true, frozenNodes: true, updatedAt: true },
    take: 2
  });
  if (rounds.length !== 1) return blocked("active_round_not_unique");
  const { id, applicantUserId, currentNodeIndex, frozenNodes, updatedAt } = rounds[0];
  if (expected && (id !== expected.approvalInstanceId || updatedAt.getTime() !== expected.approvalUpdatedAt.getTime())) {
    throw cutoverConflict();
  }
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
        Object.hasOwn(node, "legacySerialCutover") || Object.hasOwn(node, "legacyContractCutover") || Object.hasOwn(node, "submissionSnapshot")) {
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
      const signature = await readLegacyContractSignature(tx, files, log);
      if (typeof signature === "string") return blocked(signature);
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
}


export async function readLegacyContractSignature(
  tx: Prisma.TransactionClient,
  files: Pick<FileService, "getFileBuffer">,
  log: Pick<ApprovalActionLog, "actorUserId" | "signatureVersionIdSnapshot" | "signatureFileIdSnapshot" | "signatureSha256Snapshot">
): Promise<"invalid_signature_evidence" | "signature_file_unavailable" | Buffer> {
  if (!log.signatureVersionIdSnapshot) return "invalid_signature_evidence";
  const signature = await tx.handwrittenSignatureVersion.findUnique({
    where: { id: log.signatureVersionIdSnapshot },
    select: { source: true, userId: true, fileId: true, contentSha256: true }
  });
  if (!signature || signature.source !== "canvas" || signature.userId !== log.actorUserId ||
      signature.fileId !== log.signatureFileIdSnapshot ||
      signature.contentSha256.toLowerCase() !== log.signatureSha256Snapshot?.toLowerCase()) {
    return "invalid_signature_evidence";
  }
  const evidence = await files.getFileBuffer(signature.fileId, tx).catch(() => null);
  if (!evidence) return "signature_file_unavailable";
  const { file, buffer } = evidence;
  if (file.storageStatus !== "active" || file.contentSha256?.toLowerCase() !== signature.contentSha256.toLowerCase()) {
    return "invalid_signature_evidence";
  }
  try {
    return verifyApprovalSignatureSnapshot(buffer, signature.contentSha256);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return "invalid_signature_evidence";
  }
}
