import { BadRequestException, ConflictException } from "@nestjs/common";
import { BUSINESS_APPROVAL_ROLES } from "@jiangkong/shared-domain";
import { Prisma, type ApprovalActionLog } from "@prisma/client";
import { approvalEvidenceMetadata, finalApprovalEvidence } from "../approval/approval-evidence";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import { hasVersionedApprovalNodes } from "../approval/parallel-approval-protocol";
import type { PrismaService } from "../database/prisma.service";
import type { FileService } from "../file/file.service";
import { PAYMENT_DUTY_NOTICE_KIND, PAYMENT_DUTY_NOTICE_OUTCOMES } from "./ordinary-payment-parallel";

const BUSINESS_ROLES = new Set<string>(BUSINESS_APPROVAL_ROLES);
const CONTRACT_PAYMENT_SOURCES = ["settlement", "signed_settlement", "contract_advance", "contract_due"];
const hasText = (value: unknown): value is string => typeof value === "string" && !!value.trim();

type Assignment = { kind: string; fromUserId: string; fromRoleKey: string; toUserId: string };
type EvidenceReason = "unsupported_frozen_duties" | "ambiguous_action_history" | "invalid_notification_history" |
  "invalid_signature_evidence" | "signature_file_unavailable";

class PaymentCutoverEvidenceError extends BadRequestException {
  constructor(readonly reason: EvidenceReason, message: string) {
    super(message);
  }
}

function readAssignment(value: unknown, roles: readonly string[]): Assignment {
  const { kind, fromUserId, fromRoleKey, toUserId } = approvalEvidenceMetadata(value);
  if ((kind !== "transfer" && kind !== "delegate") || !hasText(fromUserId) || !hasText(toUserId) ||
      !hasText(fromRoleKey) || !roles.includes(fromRoleKey)) {
    throw new PaymentCutoverEvidenceError("ambiguous_action_history", "原付款审批转派记录不一致");
  }
  return { kind, fromUserId, fromRoleKey, toUserId };
}

function readFrozenDuties(value: unknown) {
  if (!Array.isArray(value) || !value.length || hasVersionedApprovalNodes(value)) {
    throw new PaymentCutoverEvidenceError("unsupported_frozen_duties", "原付款审批岗位快照不受支持");
  }
  const seenRoles = new Set<string>();
  return value.map(raw => {
    const node = approvalEvidenceMetadata(raw);
    const { name, mode, roleKeys, approvedRoleKeys, assignments } = node;
    if (!hasText(name) || mode !== "any" || !Array.isArray(roleKeys) || !roleKeys.length) {
      throw new PaymentCutoverEvidenceError("unsupported_frozen_duties", "原付款审批岗位快照不受支持");
    }
    for (const role of roleKeys) {
      if (!hasText(role) || !BUSINESS_ROLES.has(role) || seenRoles.has(role)) {
        throw new PaymentCutoverEvidenceError("unsupported_frozen_duties", "原付款审批岗位无法唯一对应");
      }
      seenRoles.add(role);
    }
    if (approvedRoleKeys !== undefined && (!Array.isArray(approvedRoleKeys) || approvedRoleKeys.length > 1 ||
        approvedRoleKeys.some(role => !roleKeys.includes(role)))) {
      throw new PaymentCutoverEvidenceError("ambiguous_action_history", "原付款审批签批与岗位快照不一致");
    }
    if (assignments !== undefined && !Array.isArray(assignments)) {
      throw new PaymentCutoverEvidenceError("ambiguous_action_history", "原付款审批转派记录不一致");
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
  const invalid = () => new PaymentCutoverEvidenceError("invalid_notification_history", "原付款审批通知记录不一致");
  for (const { log, metadata } of entries) {
    if (metadata.kind !== PAYMENT_DUTY_NOTICE_KIND || log.actorUserId !== applicantId) throw invalid();
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
    } else if (typeof metadata.event !== "string" || !PAYMENT_DUTY_NOTICE_OUTCOMES.has(metadata.event) ||
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
  const invalid = () => new PaymentCutoverEvidenceError("ambiguous_action_history", "原付款审批操作记录与岗位快照不一致");
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
    const { plan } = await inspectPaymentApprovalHistory(tx, files, paymentId);
    return plan;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export function inspectPendingPaymentApprovalInventory(
  prisma: Pick<PrismaService, "$transaction">,
  files: Pick<FileService, "getFileBuffer">
) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const payments = await tx.paymentRequest.findMany({
      where: { status: "approval_pending", sourceType: { in: CONTRACT_PAYMENT_SOURCES } },
      select: { id: true }, orderBy: { id: "asc" }
    });
    const blockedByReason: Partial<Record<EvidenceReason | "active_round_not_unique", number>> = {};
    let replayed = 0;
    for (const { id } of payments) {
      try {
        await inspectPaymentApprovalHistory(tx, files, id);
        replayed++;
      } catch (error) {
        const reason = error instanceof PaymentCutoverEvidenceError ? error.reason
          : error instanceof ConflictException ? "active_round_not_unique"
          : error instanceof BadRequestException ? "invalid_signature_evidence" : null;
        if (!reason) throw error;
        blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1;
      }
    }
    return { total: payments.length, replayed, blocked: payments.length - replayed, blockedByReason };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 });
}

export async function inspectPaymentApprovalHistory(
  tx: Prisma.TransactionClient,
  files: Pick<FileService, "getFileBuffer">,
  paymentId: string
) {
  const payment = await tx.paymentRequest.findUnique({
    where: { id: paymentId }, select: { id: true, projectId: true, status: true, sourceType: true, paidAmountCents: true, approvedAmountCents: true }
  });
  if (payment?.status !== "approval_pending" || !CONTRACT_PAYMENT_SOURCES.includes(payment.sourceType) ||
      payment.paidAmountCents !== 0n || payment.approvedAmountCents !== null) {
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
      throw new PaymentCutoverEvidenceError("invalid_signature_evidence", "原付款审批签名版本与签批记录不一致");
    }
    const { file, buffer } = await files.getFileBuffer(signature.fileId, tx).catch((error: unknown) => {
      // FileService wraps unavailable content as Error; database and programming failures stop the entire report.
      if (!(error instanceof Error) || error.constructor !== Error) throw error;
      throw new PaymentCutoverEvidenceError("signature_file_unavailable", error.message);
    });
    if (file.storageStatus !== "active" || file.contentSha256?.toLowerCase() !== signature.contentSha256.toLowerCase()) {
      throw new PaymentCutoverEvidenceError("invalid_signature_evidence", "原付款审批签名文件状态或摘要不一致");
    }
    verifyApprovalSignatureSnapshot(buffer, signature.contentSha256);
  }
  const plan = { roundId: round.id, completedActionIds: effective.map(log => log.id), pendingDuties };
  return { plan, payment, round };
}
