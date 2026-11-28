import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import { approvalEvidenceMetadata } from "../approval/approval-evidence";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import { hasVersionedApprovalNodes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import type { FileService } from "../file/file.service";
import { supportsExpenseParallelApproval } from "./expense-claim-parallel-approval";
import type { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";

const validRoles = new Set(["comprehensive_director", "project_manager", "employee", "finance_director", "chairman", "general_manager"]);
const cutoverAction = "expense_claim.approval.legacy_cutover";

export type ExpenseApprovalCutoverCoordinates = {
  approvalInstanceId: string;
  claimUpdatedAt: Date;
  approvalUpdatedAt: Date;
};

export function planLegacyExpenseApproval(
  round: { applicantUserId: string; currentNodeIndex: number; frozenNodes: unknown },
  logs: ReadonlyArray<Pick<ApprovalActionLog, "id" | "action" | "approvedRoleKey" | "actorUserId" |
    "representedUserId" | "signatureFileIdSnapshot" | "signatureSha256Snapshot" | "signatureVersionIdSnapshot">>
) {
  const { frozenNodes, currentNodeIndex } = round;
  const unsupported = () => new ConflictException("原费用审批职责或签批无法唯一对应，请先核对");
  if (!Array.isArray(frozenNodes) || hasVersionedApprovalNodes(frozenNodes) ||
      !Number.isInteger(currentNodeIndex) || currentNodeIndex < 0 || currentNodeIndex >= frozenNodes.length) {
    throw unsupported();
  }

  const approvals = logs.filter(log => log.action === "approve");
  if (approvals.length !== currentNodeIndex || logs.some(log => {
    if (log.action === "approve") {
      return !log.signatureFileIdSnapshot || !log.signatureSha256Snapshot || !log.signatureVersionIdSnapshot ||
        Boolean(log.representedUserId && log.representedUserId !== log.actorUserId);
    }
    return log.action !== "remind" || log.actorUserId !== round.applicantUserId ||
      Boolean(log.signatureFileIdSnapshot || log.signatureSha256Snapshot || log.signatureVersionIdSnapshot);
  })) {
    throw unsupported();
  }

  const seenRoles = new Set<string>();
  const completedActionIds: string[] = [];
  const pendingNodeIndexes: number[] = [];
  const nodes = frozenNodes.map((item, index) => {
    const duty = approvalEvidenceMetadata(item);
    const { name, mode, roleKeys, approvedRoleKeys, assignments } = duty;
    if (typeof name !== "string" || !name.trim() || mode !== "any" || !Array.isArray(roleKeys) ||
        roleKeys.length === 0 || duty.candidatePolicy !== undefined || (assignments !== undefined && (!Array.isArray(assignments) || assignments.length > 0))) {
      throw unsupported();
    }
    for (const role of roleKeys) {
      if (typeof role !== "string" || !validRoles.has(role) || seenRoles.has(role)) throw unsupported();
      seenRoles.add(role);
    }
    const candidatesByRole = approvalEvidenceMetadata(duty.candidateUserIdsByRole);
    if (roleKeys.some(role => {
      const candidatesForRole = candidatesByRole[role];
      return !Array.isArray(candidatesForRole) || candidatesForRole.some(id => typeof id !== "string" || !id.trim());
    })) throw unsupported();
    const approved = approvedRoleKeys === undefined ? [] : approvedRoleKeys;
    if (!Array.isArray(approved)) throw unsupported();
    if (index < currentNodeIndex) {
      const matching = approvals.filter(log => log.approvedRoleKey && roleKeys.includes(log.approvedRoleKey));
      if (approved.length !== 1 || matching.length !== 1 || approved[0] !== matching[0].approvedRoleKey) {
        throw unsupported();
      }
      const candidates = candidatesByRole[approved[0] as string];
      const { actorUserId } = matching[0];
      if (!Array.isArray(candidates) || !candidates.includes(actorUserId)) throw unsupported();
      completedActionIds.push(matching[0].id);
    } else {
      if (approved.length > 0) throw unsupported();
      pendingNodeIndexes.push(index);
    }
    return { ...duty, protocolVersion: 1, executionMode: "parallel" };
  });
  return { nodes, completedActionIds, pendingNodeIndexes };
}

export async function migrateLegacyExpenseApprovalRound(
  prisma: PrismaService,
  audit: AuditService,
  files: Pick<FileService, "getFileBuffer">,
  notifications: Pick<ExpenseClaimFundingNotificationService, "queueApprovalDuties" | "afterCommit">,
  claimId: string,
  actorUserId: string,
  expected: ExpenseApprovalCutoverCoordinates
) {
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ExpenseClaim" WHERE id = ${claimId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ApprovalInstance" WHERE "businessType" = 'expense_claim'
      AND "businessId" = ${claimId} AND "flowType" = 'expense_claim.approve' AND status = 'in_progress' FOR UPDATE`;

    if (!(await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } }))?.isActive) {
      throw new ForbiddenException("费用审批切换经办人不存在或已停用");
    }
    const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
    if (!claim || !supportsExpenseParallelApproval(claim) || claim.status !== "approval_pending" ||
        claim.approvedAt || claim.fundedAmountCents !== 0n ||
        await tx.expenseClaimPaymentExecution.findFirst({ where: { expenseClaimId: claimId }, select: { id: true } })) {
      throw new ConflictException("只有尚未通过审批且未付款的费用申请可切换审批");
    }
    const rounds = await tx.approvalInstance.findMany({
      where: { businessType: "expense_claim", businessId: claimId, flowType: "expense_claim.approve", status: "in_progress" },
      take: 2
    });
    if (rounds.length !== 1) throw new ConflictException("在途费用审批轮次缺失或不唯一");
    const [round] = rounds;
    const stale = () => new ConflictException("费用审批轮次已变化，请重新盘点");
    if (round.id !== claim.approvalInstanceId || round.id !== expected.approvalInstanceId ||
        claim.updatedAt.getTime() !== expected.claimUpdatedAt.getTime()) throw stale();

    const evidence = {
      approvalInstanceId: expected.approvalInstanceId,
      claimUpdatedAt: expected.claimUpdatedAt.toISOString(),
      approvalUpdatedAt: expected.approvalUpdatedAt.toISOString()
    };

    if (isParallelApprovalRound(round.frozenNodes)) {
      const prior = await tx.auditLog.findFirst({
        where: { actorUserId, businessType: "expense_claim", businessId: claimId, action: cutoverAction,
          AND: Object.entries({ ...evidence, mappedApprovalUpdatedAt: round.updatedAt.toISOString() })
            .map(([key, value]) => ({ metadata: { path: [key], equals: value } })) },
        select: { id: true }
      });
      if (!prior) throw stale();
      return { status: "already_mapped" as const, queued: false };
    }
    if (round.updatedAt.getTime() !== expected.approvalUpdatedAt.getTime()) throw stale();

    const logs = await tx.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } });
    const plan = planLegacyExpenseApproval(round, logs);
    const completed = new Set(plan.completedActionIds);
    for (const log of logs) {
      if (!completed.has(log.id)) continue;
      const signature = await tx.handwrittenSignatureVersion.findUnique({ where: { id: log.signatureVersionIdSnapshot! } });
      if (!signature || signature.source !== "canvas" || signature.userId !== log.actorUserId ||
          signature.fileId !== log.signatureFileIdSnapshot ||
          signature.contentSha256.toLowerCase() !== log.signatureSha256Snapshot?.toLowerCase()) {
        throw new ConflictException("原费用签名版本与签批记录不一致");
      }
      const { file, buffer } = await files.getFileBuffer(signature.fileId, tx);
      if (file.storageStatus !== "active" || file.contentSha256?.toLowerCase() !== signature.contentSha256.toLowerCase()) {
        throw new ConflictException("原费用签名文件状态或摘要不一致");
      }
      verifyApprovalSignatureSnapshot(buffer, signature.contentSha256);
    }
    const migrated = await tx.approvalInstance.update({
      where: { id: round.id }, data: { frozenNodes: plan.nodes as Prisma.InputJsonValue }
    });
    const queued = await notifications.queueApprovalDuties(tx, claim, migrated, actorUserId);
    await audit.record(tx, {
      actorUserId, businessType: "expense_claim", businessId: claimId, action: cutoverAction,
      metadata: { ...evidence, mappedApprovalUpdatedAt: migrated.updatedAt.toISOString(),
        completedActionIds: plan.completedActionIds, pendingNodeIndexes: plan.pendingNodeIndexes }
    });
    return { status: "mapped" as const, pendingNodeIndexes: plan.pendingNodeIndexes, queued };
  });

  const { queued, ...receipt } = result;
  if (queued) void notifications.afterCommit();
  return receipt;
}
