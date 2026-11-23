import { BadRequestException, ConflictException } from "@nestjs/common";
import { BUSINESS_APPROVAL_ROLES } from "@jiangkong/shared-domain";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import { approvalEvidenceMetadata, finalApprovalEvidence } from "../approval/approval-evidence";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import { hasVersionedApprovalNodes } from "../approval/parallel-approval-protocol";
import type { PrismaService } from "../database/prisma.service";
import type { FileService } from "../file/file.service";

const NOTICE_KIND = "payment_approval_duty_notification";
const NOTICE_OUTCOMES = new Set(["dispatch_claimed", "accepted", "failed", "unknown", "cancelled"]);
const BUSINESS_ROLES = new Set<string>(BUSINESS_APPROVAL_ROLES);
const hasText = (value: unknown): value is string => typeof value === "string" && !!value.trim();

type Assignment = { kind: string; fromUserId: string; fromRoleKey: string; toUserId: string };

function readAssignment(value: unknown, roles: readonly string[]): Assignment {
  const { kind, fromUserId, fromRoleKey, toUserId } = approvalEvidenceMetadata(value);
  if ((kind !== "transfer" && kind !== "delegate") || !hasText(fromUserId) || !hasText(toUserId) ||
      !hasText(fromRoleKey) || !roles.includes(fromRoleKey)) {
    throw new BadRequestException("原付款审批转派记录不一致");
  }
  return { kind, fromUserId, fromRoleKey, toUserId };
}

function readFrozenDuties(value: unknown) {
  if (!Array.isArray(value) || !value.length || hasVersionedApprovalNodes(value)) {
    throw new BadRequestException("原付款审批岗位快照不受支持");
  }
  const seenRoles = new Set<string>();
  return value.map(raw => {
    const node = approvalEvidenceMetadata(raw);
    const { name, mode, roleKeys, approvedRoleKeys, assignments } = node;
    if (!hasText(name) || mode !== "any" || !Array.isArray(roleKeys) || !roleKeys.length) {
      throw new BadRequestException("原付款审批岗位快照不受支持");
    }
    for (const role of roleKeys) {
      if (!hasText(role) || !BUSINESS_ROLES.has(role) || seenRoles.has(role)) {
        throw new BadRequestException("原付款审批岗位无法唯一对应");
      }
      seenRoles.add(role);
    }
    if (approvedRoleKeys !== undefined && (!Array.isArray(approvedRoleKeys) || approvedRoleKeys.length > 1 ||
        approvedRoleKeys.some(role => !roleKeys.includes(role)))) {
      throw new BadRequestException("原付款审批签批与岗位快照不一致");
    }
    if (assignments !== undefined && !Array.isArray(assignments)) {
      throw new BadRequestException("原付款审批转派记录不一致");
    }
    return {
      node, mode, roleKeys: roleKeys as string[], approvedRoleKeys: (approvedRoleKeys ?? []) as string[],
      assignments: (assignments ?? []).map(value => readAssignment(value, roleKeys))
    };
  });
}

function verifyNoticeHistory(
  notices: readonly ApprovalActionLog[], openedAt: ReadonlyMap<string, number>,
  applicantId: string, payment: { id: string; projectId: string }
) {
  const queued = new Map<string, Record<string, unknown>>();
  const entries = notices.map(log => ({ log, metadata: approvalEvidenceMetadata(log.metadata) }));
  const invalid = () => new BadRequestException("原付款审批通知记录不一致");
  for (const { log, metadata } of entries) {
    if (metadata.kind !== NOTICE_KIND || log.actorUserId !== applicantId) throw invalid();
    if (metadata.event !== "queued") continue;
    if (metadata.phase !== undefined || metadata.paymentId !== payment.id || metadata.projectId !== payment.projectId ||
        !hasText(metadata.recipientId) || !hasText(metadata.anchorId) || !openedAt.has(metadata.anchorId) ||
        openedAt.get(metadata.anchorId) !== metadata.nodeIndex ||
        !hasText(metadata.roundRevision) || !Number.isFinite(Date.parse(metadata.roundRevision))) throw invalid();
    queued.set(log.id, metadata);
  }
  for (const { log, metadata } of entries) {
    if (metadata.event === "queued") {
      if (metadata.retryOf === undefined) continue;
      const first = hasText(metadata.retryOf) && queued.get(metadata.retryOf);
      if (!first || metadata.retryOf === log.id || first.anchorId !== metadata.anchorId ||
          first.recipientId !== metadata.recipientId || first.roundRevision !== metadata.roundRevision) throw invalid();
    } else if (typeof metadata.event !== "string" || !NOTICE_OUTCOMES.has(metadata.event) ||
               !hasText(metadata.intentId) || !queued.has(metadata.intentId)) throw invalid();
  }
}

function replayPendingDuties(
  round: { id: string; applicantUserId: string; frozenNodes: Prisma.JsonValue; currentNodeIndex: number },
  payment: { id: string; projectId: string },
  logs: readonly ApprovalActionLog[]
) {
  const duties = readFrozenDuties(round.frozenNodes);
  const effective: ApprovalActionLog[] = [];
  const assignments = duties.map((): Assignment[] => []);
  const openedAt = new Map([[round.id, 0]]);
  const notices: ApprovalActionLog[] = [];
  const invalid = () => new BadRequestException("原付款审批操作记录与岗位快照不一致");
  let priorTransitionAt: number | undefined;
  for (const log of logs) {
    if (log.action !== "approve" &&
        (log.signatureFileIdSnapshot || log.signatureSha256Snapshot || log.signatureVersionIdSnapshot)) throw invalid();
    if (log.action === "system_notification") {
      notices.push(log);
      continue;
    }
    if (log.action === "remind") {
      if (log.actorUserId !== round.applicantUserId) throw invalid();
      continue;
    }
    const at = log.createdAt.getTime();
    if (priorTransitionAt === at) throw invalid();
    priorTransitionAt = at;
    const nodeIndex = effective.length;
    const duty = duties[nodeIndex];
    if (!duty || !log.approvedRoleKey || !duty.roleKeys.includes(log.approvedRoleKey)) throw invalid();
    switch (log.action) {
      case "approve":
        effective.push(log);
        openedAt.set(log.id, effective.length);
        break;
      case "reject_previous":
        if (!effective.pop()) throw invalid();
        openedAt.set(log.id, effective.length);
        break;
      case "transfer":
      case "delegate": {
        const assignment = readAssignment(log.metadata, duty.roleKeys);
        if (assignment.kind !== log.action || assignment.fromRoleKey !== log.approvedRoleKey ||
            assignment.fromUserId !== log.representedUserId || assignment.toUserId === log.actorUserId) throw invalid();
        assignments[nodeIndex] = assignments[nodeIndex].filter(previous =>
          previous.kind !== assignment.kind || previous.fromUserId !== assignment.fromUserId ||
          previous.fromRoleKey !== assignment.fromRoleKey
        );
        assignments[nodeIndex].push(assignment);
        break;
      }
      default:
        throw invalid();
    }
  }
  if (effective.length !== round.currentNodeIndex || effective.length === duties.length ||
      duties.some((duty, index) =>
        duty.approvedRoleKeys.length !== (effective[index] ? 1 : 0) ||
        duty.approvedRoleKeys[0] !== effective[index]?.approvedRoleKey ||
        JSON.stringify(duty.assignments) !== JSON.stringify(assignments[index]))) throw invalid();
  verifyNoticeHistory(notices, openedAt, round.applicantUserId, payment);
  if (effective.length) finalApprovalEvidence("approved", duties.slice(0, effective.length), effective);
  return {
    effective,
    pendingDuties: duties.slice(effective.length).map(({ node }, index) => ({ ...node, nodeIndex: effective.length + index }))
  };
}

/** Read-only evidence for a stopped-writer cutover rehearsal. The normal approval round stays serial. */
export function inspectPendingPaymentApprovalCutover(
  prisma: Pick<PrismaService, "$transaction">,
  files: Pick<FileService, "getFileBuffer">,
  paymentId: string
) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const payment = await tx.paymentRequest.findUnique({
      where: { id: paymentId }, select: { id: true, projectId: true, status: true }
    });
    if (payment?.status !== "approval_pending") {
      throw new ConflictException("只有在途普通付款可核对审批切换记录");
    }
    const rounds = await tx.approvalInstance.findMany({
      where: { businessType: "payment_request", businessId: payment.id, flowType: "payment.approve", status: "in_progress" },
      take: 2
    });
    if (rounds.length !== 1) throw new ConflictException("在途普通付款审批轮次缺失或不唯一");
    const [round] = rounds;
    const logs = await tx.approvalActionLog.findMany({
      where: { approvalInstanceId: round.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const { effective, pendingDuties } = replayPendingDuties(round, payment, logs);
    for (const log of effective) {
      const signature = await tx.handwrittenSignatureVersion.findUnique({ where: { id: log.signatureVersionIdSnapshot! } });
      if (!signature || signature.source !== "canvas" || signature.userId !== log.actorUserId ||
          signature.fileId !== log.signatureFileIdSnapshot ||
          signature.contentSha256.toLowerCase() !== log.signatureSha256Snapshot?.toLowerCase()) {
        throw new BadRequestException("原付款审批签名版本与签批记录不一致");
      }
      const { file, buffer } = await files.getFileBuffer(signature.fileId, tx);
      if (file.storageStatus !== "active" || file.contentSha256?.toLowerCase() !== signature.contentSha256.toLowerCase()) {
        throw new BadRequestException("原付款审批签名文件状态或摘要不一致");
      }
      verifyApprovalSignatureSnapshot(buffer, signature.contentSha256);
    }
    return { roundId: round.id, completedActionIds: effective.map(log => log.id), pendingDuties };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
