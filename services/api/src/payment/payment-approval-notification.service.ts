import { ConflictException, ForbiddenException, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { canPerform, GLOBAL_BUSINESS_ROLE_KEYS, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma, type ApprovalActionLog, type ApprovalInstance, type PaymentRequest } from "@prisma/client";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { auditDutyNoticeId, type AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { paymentReminderIntent } from "../approval/approval-reminder-business-intent";
import { frozenCandidateUserIds, resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { ApprovalSmsService, approvalDutyRichTemplateEnabled } from "../approval/approval-sms.service";
import { assertOrdinaryApplicantCannotReview } from "../approval/approval-self-review";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { sensitiveBusinessReadAllowed } from "../auth/sensitive-business-read";
import { PrismaService } from "../database/prisma.service";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { hasOrdinaryPaymentParallelMarker, isOrdinaryPaymentAssignmentActive, isOrdinaryPaymentParallelRound, loadOrdinaryPaymentDelegationPrincipals, PAYMENT_DUTY_NOTICE_KIND as KIND, resolveOrdinaryPaymentDuty } from "./ordinary-payment-parallel";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";

const idFor = (...coordinates: string[]) => auditDutyNoticeId(KIND, ...coordinates);
type PendingPayment = Pick<PaymentRequest, "id" | "projectId" | "code" | "status">;

function opensApprovalNode(transition: ApprovalActionLog, roundId: string) {
  return transition.approvalInstanceId === roundId && (transition.action === "reject_previous" ||
    (transition.action === "approve" && Boolean(transition.signatureVersionIdSnapshot) && Boolean(transition.signatureFileIdSnapshot) &&
      /^[a-f0-9]{64}$/iu.test(transition.signatureSha256Snapshot ?? "")));
}

function dutyNode(round: ApprovalInstance, index: number): FrozenApprovalNode | null {
  if (round.businessType !== "payment_request" || round.flowType !== "payment.approve" || round.status !== "in_progress") return null;
  const node = Array.isArray(round.frozenNodes) ? round.frozenNodes[index] : null;
  return node && typeof node === "object" && !Array.isArray(node) && typeof node.name === "string" && Array.isArray(node.roleKeys) ? node : null;
}

@Injectable()
export class PaymentApprovalNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(PaymentApprovalNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: ApprovalSmsService,
    private readonly visibility: ProjectVisibilityService,
    @Optional() private readonly writeFreeze: OperationalWriteFreezeService = new OperationalWriteFreezeService()
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, payment: PendingPayment, round: ApprovalInstance, transition: ApprovalActionLog | null) {
    if (payment.status !== "approval_pending" || round.businessId !== payment.id) return;
    if (isOrdinaryPaymentParallelRound(round.frozenNodes)) {
      if (transition) {
        const data = transition.metadata as Prisma.JsonObject | null;
        const index = data?.ordinaryPaymentDutyIndex;
        const recipient = data?.toUserId;
        if (transition.action !== "delegate" || transition.approvalInstanceId !== round.id || typeof index !== "number" ||
            typeof recipient !== "string" || !isOrdinaryPaymentAssignmentActive(data, index)) return;
        const node = dutyNode(round, index);
        if (!node || !await this.currentRecipient(tx, payment, round, node, recipient, index, transition.id)) return;
        await tx.approvalActionLog.createMany({
          data: [this.dutyIntent(payment, round, index, `delegation:${transition.id}`, recipient)],
          skipDuplicates: true
        });
        return;
      }
      for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
        const node = dutyNode(round, index);
        if (!node) continue;
        const legacyRevision = round.frozenNodes[index].legacyPaymentNoticeRevision;
        const existing = typeof legacyRevision === "string" ? await tx.approvalActionLog.findMany({
          where: { approvalInstanceId: round.id, action: "system_notification", AND: [
            { metadata: { path: ["nodeIndex"], equals: index } },
            { metadata: { path: ["roundRevision"], equals: legacyRevision } }
          ] }
        }) : [];
        const retainedRecipients = new Set(existing.filter(log => this.isBaseAttempt(log) &&
          log.actorUserId === round.applicantUserId && (log.metadata as Prisma.JsonObject).paymentId === payment.id &&
          (log.metadata as Prisma.JsonObject).projectId === payment.projectId
        ).flatMap(log => {
          const recipient = (log.metadata as Prisma.JsonObject).recipientId;
          return typeof recipient === "string" ? [recipient] : [];
        }));
        await this.queueDuty(tx, payment, round, node, index, `parallel:${round.id}`, retainedRecipients);
      }
      return;
    }
    const node = dutyNode(round, round.currentNodeIndex);
    if (!node || hasOrdinaryPaymentParallelMarker(round.frozenNodes) ||
        (transition ? !opensApprovalNode(transition, round.id) : round.currentNodeIndex !== 0)) return;
    await this.queueDuty(tx, payment, round, node, round.currentNodeIndex, transition?.id ?? round.id);
  }

  private async queueDuty(
    tx: Prisma.TransactionClient, payment: PendingPayment, round: ApprovalInstance, node: FrozenApprovalNode,
    nodeIndex: number, anchorId: string, retainedRecipients?: ReadonlySet<string>
  ) {
    const roleKeys = node.roleKeys as RoleKey[];
    const [positions, projectMembers] = await Promise.all([
      tx.position.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } }),
      tx.projectMember.findMany({ where: { projectId: payment.projectId, positionKey: { in: roleKeys } }, select: { userId: true } })
    ]);
    const assigned = await tx.userPosition.findMany({ where: { OR: [
      { projectId: payment.projectId, positionId: { in: positions.map(position => position.id) } },
      { projectId: null, positionId: { in: positions.filter(position => GLOBAL_BUSINESS_ROLE_KEYS.includes(position.key as RoleKey)).map(position => position.id) } }
    ] }, select: { userId: true } });
    const holders = [...new Set([...projectMembers.map(row => row.userId), ...assigned.map(row => row.userId), ...frozenCandidateUserIds(node)])];
    const directs = Array.isArray(node.assignments) ? node.assignments.flatMap(assignment =>
      typeof assignment?.toUserId === "string" ? [assignment.toUserId] : []) : [];
    const now = new Date();
    const delegates = holders.length ? await tx.approvalDelegation.findMany({ where: {
      fromUserId: { in: holders }, actionKey: null, resourceType: null, resourceId: null, enabled: true, startsAt: { lte: now }, endsAt: { gt: now }
    }, select: { toUserId: true } }) : [];
    const data: Prisma.ApprovalActionLogCreateManyInput[] = [];
    for (const recipientId of new Set([...holders, ...directs, ...delegates.map(row => row.toUserId)])) {
      if (retainedRecipients?.has(recipientId)) continue;
      const active = await tx.user.findUnique({ where: { id: recipientId }, select: { isActive: true } });
      if (!active?.isActive || !await this.currentRecipient(tx, payment, round, node, recipientId, nodeIndex)) continue;
      data.push(this.dutyIntent(payment, round, nodeIndex, anchorId, recipientId));
    }
    if (data.length) await tx.approvalActionLog.createMany({ data, skipDuplicates: true });
  }

  private dutyIntent(payment: PendingPayment, round: ApprovalInstance, nodeIndex: number, anchorId: string, recipientId: string) {
    return {
      id: idFor(payment.id, round.id, String(nodeIndex), anchorId, recipientId),
      approvalInstanceId: round.id, actorUserId: round.applicantUserId, action: "system_notification",
      metadata: { kind: KIND, event: "queued", paymentId: payment.id, projectId: payment.projectId,
        nodeIndex, roundRevision: round.updatedAt.toISOString(), anchorId, recipientId }
    };
  }

  /** 最终驳回/退回申请人时提醒原申请人修改重提，共用审批待办的 claimed/terminal 幂等与失败重试。 */
  async queueCorrection(tx: Prisma.TransactionClient, payment: PendingPayment, round: ApprovalInstance, transition: ApprovalActionLog) {
    if (round.businessType !== "payment_request" || round.flowType !== "payment.approve" || round.businessId !== payment.id) return;
    if (!["reject", "return_to_applicant"].includes(transition.action)) return;
    if (!["approval_rejected", "draft"].includes(payment.status)) return;
    const recipientId = round.applicantUserId;
    await tx.approvalActionLog.createMany({ skipDuplicates: true, data: [{
      id: idFor(payment.id, round.id, "correction", transition.id, recipientId),
      approvalInstanceId: round.id, actorUserId: recipientId, action: "system_notification",
      metadata: { kind: KIND, event: "queued", phase: "correction", paymentId: payment.id, projectId: payment.projectId,
        anchorId: transition.id, recipientId }
    }] });
  }

  async status(paymentId: string, actorId: string) {
    return this.prisma.$transaction(async tx => ({
      notice: (await this.currentNotice(tx, paymentId, actorId))?.status ?? null
    }));
  }

  async retry(paymentId: string, actorId: string, attemptId: string) {
    const result = await this.prisma.$transaction(async tx => {
      const requested = await tx.approvalActionLog.findUnique({ where: { id: attemptId } });
      const data = requested?.metadata as Prisma.JsonObject | null;
      if (!requested || data?.kind !== KIND || data.event !== "queued" || data.paymentId !== paymentId || data.recipientId !== actorId) {
        throw new ConflictException("当前待办或短信记录已变化，请刷新");
      }
      await this.lockRound(tx, requested.approvalInstanceId);
      const current = await this.currentNotice(tx, paymentId, actorId);
      if (!current || !current.chain.includes(attemptId)) throw new ConflictException("当前待办或短信记录已变化，请刷新");
      if (current.attempt.id !== attemptId) return { kind: "replay", status: current.status } as const;
      if (!current.status.canRetry) throw new ConflictException("仅确认发送失败的短信可以重试");
      const nextId = idFor(attemptId, "retry");
      const inserted = await tx.approvalActionLog.createMany({ skipDuplicates: true, data: [{
        id: nextId, approvalInstanceId: current.attempt.approvalInstanceId,
        actorUserId: current.attempt.actorUserId, action: "system_notification",
        metadata: { ...current.attempt.metadata as Prisma.InputJsonObject, retryOf: attemptId }
      }] });
      return { kind: "new", nextId, enqueued: inserted.count === 1 } as const;
    });
    if (result.kind === "replay") return result.status;
    if (result.enqueued) await this.afterCommit(paymentId, result.nextId);
    const current = await this.prisma.$transaction(tx => this.currentNotice(tx, paymentId, actorId));
    if (!current?.chain.includes(result.nextId)) throw new ConflictException("当前待办或短信记录已变化，请刷新");
    return current.status;
  }

  private lockRound(tx: Prisma.TransactionClient, roundId: string) {
    return tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${roundId} FOR UPDATE`);
  }

  private async currentNotice(tx: Prisma.TransactionClient, paymentId: string, actorId: string) {
    const active = await this.inProgressNotice(tx, paymentId, actorId);
    return active ?? this.correctionNotice(tx, paymentId, actorId);
  }

  private async correctionNotice(tx: Prisma.TransactionClient, paymentId: string, actorId: string) {
    const round = await tx.approvalInstance.findFirst({ where: {
      businessType: "payment_request", businessId: paymentId, flowType: "payment.approve",
      status: { in: ["rejected", "returned_to_applicant"] }
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!round) return null;
    const entries = await tx.approvalActionLog.findMany({ where: {
      approvalInstanceId: round.id, action: "system_notification", AND: [
        { metadata: { path: ["kind"], equals: KIND } },
        { metadata: { path: ["event"], equals: "queued" } },
        { metadata: { path: ["recipientId"], equals: actorId } }
      ]
    } });
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    for (const original of entries) {
      const data = original.metadata as Prisma.JsonObject | null;
      if (data?.phase !== "correction" || data.recipientId !== actorId || data.paymentId !== paymentId || data.retryOf !== undefined) continue;
      const context = await this.currentContext(tx, original);
      if (!context) continue;
      const chain = [original.id];
      let attempt = original;
      let status = await this.attemptStatus(tx, attempt);
      while (status.status === "failed") {
        const next = byId.get(idFor(attempt.id, "retry"));
        if (!next || !this.matchesRetry(next, attempt, original)) break;
        chain.push(next.id);
        attempt = next;
        status = await this.attemptStatus(tx, attempt);
      }
      return { attempt, chain, context, status };
    }
    return null;
  }

  private async inProgressNotice(tx: Prisma.TransactionClient, paymentId: string, actorId: string) {
    const rounds = await tx.approvalInstance.findMany({ where: {
      businessType: "payment_request", businessId: paymentId, flowType: "payment.approve", status: "in_progress"
    }, take: 2 });
    if (rounds.length !== 1) return null;
    const entries = await tx.approvalActionLog.findMany({ where: {
      approvalInstanceId: rounds[0].id, action: "system_notification", AND: [
        { metadata: { path: ["kind"], equals: KIND } },
        { metadata: { path: ["event"], equals: "queued" } },
        { metadata: { path: ["recipientId"], equals: actorId } }
      ]
    } });
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const byDuty = isOrdinaryPaymentParallelRound(rounds[0].frozenNodes)
      ? [...entries].sort((left, right) =>
          Number((left.metadata as Prisma.JsonObject | null)?.nodeIndex) -
          Number((right.metadata as Prisma.JsonObject | null)?.nodeIndex))
      : entries;
    for (const original of byDuty) {
      const data = original.metadata as Prisma.JsonObject | null;
      if (data?.recipientId !== actorId || data.paymentId !== paymentId || !this.isBaseAttempt(original)) continue;
      const context = await this.currentContext(tx, original);
      if (!context) continue;
      const chain = [original.id];
      let attempt = original;
      let status = await this.attemptStatus(tx, attempt);
      while (status.status === "failed") {
        const next = byId.get(idFor(attempt.id, "retry"));
        if (!next || !this.matchesRetry(next, attempt, original)) break;
        chain.push(next.id);
        attempt = next;
        status = await this.attemptStatus(tx, attempt);
      }
      return { attempt, chain, context, status };
    }
    return null;
  }

  private isBaseAttempt(attempt: ApprovalActionLog) {
    const data = attempt.metadata as Prisma.JsonObject | null;
    return attempt.action === "system_notification" && data?.kind === KIND && data.event === "queued" &&
      typeof data.paymentId === "string" && typeof data.recipientId === "string" && typeof data.anchorId === "string" &&
      typeof data.nodeIndex === "number" && data.retryOf === undefined &&
      attempt.id === idFor(data.paymentId, attempt.approvalInstanceId, String(data.nodeIndex), data.anchorId, data.recipientId);
  }

  private matchesRetry(retry: ApprovalActionLog, previous: ApprovalActionLog, original: ApprovalActionLog) {
    const data = retry.metadata as Prisma.JsonObject;
    const frozen = original.metadata as Prisma.JsonObject;
    return retry.id === idFor(previous.id, "retry") && retry.approvalInstanceId === original.approvalInstanceId &&
      retry.actorUserId === original.actorUserId && retry.action === "system_notification" && data?.retryOf === previous.id &&
      ["kind", "event", "phase", "paymentId", "projectId", "nodeIndex", "roundRevision", "anchorId", "recipientId"].every(key => data[key] === frozen[key]);
  }

  private async attemptStatus(tx: Prisma.TransactionClient, attempt: ApprovalActionLog): Promise<AuditDutyNoticeStatus> {
    const [claim, terminal] = await Promise.all([
      tx.approvalActionLog.findUnique({ where: { id: idFor(attempt.id, "claim") } }),
      tx.approvalActionLog.findUnique({ where: { id: idFor(attempt.id, "terminal") } })
    ]);
    const isReceipt = (row: ApprovalActionLog | null) => {
      const data = row?.metadata as Prisma.JsonObject | null;
      return row?.action === "system_notification" && row.approvalInstanceId === attempt.approvalInstanceId &&
        row.actorUserId === attempt.actorUserId && data?.kind === KIND && data.intentId === attempt.id;
    };
    const outcome = (terminal?.metadata as Prisma.JsonObject | null)?.event;
    const claimed = isReceipt(claim) && (claim?.metadata as Prisma.JsonObject).event === "dispatch_claimed";
    const status = !claim && !terminal ? "queued"
      : isReceipt(terminal) && outcome === "cancelled" ? "cancelled"
      : claimed && isReceipt(terminal) && (outcome === "accepted" || outcome === "failed") ? outcome : "unknown";
    return { attemptId: attempt.id, status, canRetry: status === "failed" && this.sms.available() };
  }

  async afterCommit(paymentId?: string, attemptId?: string) {
    if (!this.sms.available()) return;
    try {
      if (this.writeFreeze.isFrozen("payment")) return;
      const intents = await this.prisma.$queryRaw<ApprovalActionLog[]>(Prisma.sql`
        SELECT queued.* FROM "ApprovalActionLog" queued
        WHERE queued."action" = 'system_notification' AND queued."metadata"->>'kind' = ${KIND}
          AND queued."metadata"->>'event' = 'queued'
          ${paymentId ? Prisma.sql`AND queued."metadata"->>'paymentId' = ${paymentId}` : Prisma.empty}
          ${attemptId ? Prisma.sql`AND queued."id" = ${attemptId}` : Prisma.empty}
          AND NOT EXISTS (SELECT 1 FROM "ApprovalActionLog" receipt
            WHERE receipt."approvalInstanceId" = queued."approvalInstanceId" AND receipt."action" = 'system_notification'
              AND receipt."metadata"->>'kind' = ${KIND} AND receipt."metadata"->>'intentId' = queued."id")
        ORDER BY queued."createdAt", queued."id" LIMIT 100
      `);
      for (const intent of intents) {
        if (this.writeFreeze.isFrozen("payment")) return;
        const dispatch = await this.prisma.$transaction(tx => this.claim(tx, intent));
        if (!dispatch) continue;
        const result = await (dispatch.rich
          ? this.sms.sendDutyIntent(dispatch.phone, dispatch.rich)
          : this.sms.send(dispatch.phone, dispatch.label, dispatch.dutyName, dispatch.code)).catch(() => ({ status: "unknown" }));
        await this.append(this.prisma, intent, result.status, "terminal");
      }
    } catch {
      this.logger.warn("付款审批待办短信暂未完成，保留记录以供核对");
    }
  }

  private async claim(tx: Prisma.TransactionClient, intent: ApprovalActionLog) {
    await this.lockRound(tx, intent.approvalInstanceId);
    if ((await this.attemptStatus(tx, intent)).status !== "queued") return null;
    const data = intent.metadata as Prisma.JsonObject;
    let context = null;
    if (data?.phase === "correction" || this.isBaseAttempt(intent)) {
      context = await this.currentContext(tx, intent);
    } else if (typeof data?.paymentId === "string" && typeof data.recipientId === "string") {
      const current = await this.currentNotice(tx, data.paymentId, data.recipientId);
      if (current?.attempt.id === intent.id) context = current.context;
    }
    if (!context) {
      await this.append(tx, intent, "cancelled", "terminal");
      return null;
    }
    const { node, payment, round } = context;
    const user = await tx.user.findUnique({ where: { id: String(data.recipientId) }, select: { isActive: true, phone: true } });
    if (!user?.isActive) {
      await this.append(tx, intent, "cancelled", "terminal");
      return null;
    }
    const dutyName = node ? String(node.name) : "审批退回，请修改后重新提交";
    let rich: ApprovalDutySmsIntent | null = null;
    if (node && approvalDutyRichTemplateEnabled()) {
      const [project, applicant] = await Promise.all([
        tx.project.findUnique({ where: { id: payment.projectId }, select: { name: true } }),
        tx.user.findUnique({ where: { id: round.applicantUserId }, select: { name: true } })
      ]);
      rich = await paymentReminderIntent(tx, payment.id, {
        projectId: payment.projectId, projectName: project?.name, applicantName: applicant?.name, businessLabel: "付款申请", dutyName
      }) ?? {
        businessLabel: "付款申请", dutyName, businessCode: payment.code, scopeName: project?.name ?? "所属项目",
        initiatorName: applicant?.name ?? "发起人待核对", subject: "付款申请审批", participants: [], amountText: "待确定",
        targetPath: approvalDutyTarget("payment", payment.id)
      };
    }
    const claim = await this.append(tx, intent, "dispatch_claimed", "claim");
    return claim.count === 1 ? { phone: user.phone ?? "", code: payment.code, dutyName, rich,
      label: node ? "付款申请" : "付款申请退回修改" } : null;
  }

  private async currentContext(tx: Prisma.TransactionClient, intent: ApprovalActionLog) {
    const data = intent.metadata as Prisma.JsonObject;
    if (data?.phase === "correction") return this.currentCorrectionContext(tx, intent, data);
    if (typeof data?.paymentId !== "string" || typeof data.recipientId !== "string" || typeof data.anchorId !== "string" ||
        typeof data.nodeIndex !== "number" || !Number.isInteger(data.nodeIndex)) return null;
    const nodeIndex = data.nodeIndex;
    const delegationActionId = data.anchorId.startsWith("delegation:") ? data.anchorId.slice("delegation:".length) : undefined;
    const [round, payment, user] = await Promise.all([
      tx.approvalInstance.findUnique({ where: { id: intent.approvalInstanceId } }),
      tx.paymentRequest.findUnique({ where: { id: data.paymentId }, select: { id: true, projectId: true, status: true, code: true } }),
      tx.user.findUnique({ where: { id: data.recipientId }, select: { isActive: true } })
    ]);
    const node = round ? dutyNode(round, nodeIndex) : null;
    if (!round || !node || !payment || !user?.isActive || payment.status !== "approval_pending" ||
      round.businessId !== payment.id || payment.projectId !== data.projectId || round.applicantUserId !== intent.actorUserId ||
      !await this.currentRecipient(tx, payment, round, node, data.recipientId, nodeIndex, delegationActionId)) {
      return null;
    }
    const parallel = isOrdinaryPaymentParallelRound(round.frozenNodes);
    if (hasOrdinaryPaymentParallelMarker(round.frozenNodes) && !parallel) return null;
    if (isOrdinaryPaymentParallelRound(round.frozenNodes)) {
      if (!activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(nodeIndex)) return null;
      if (data.anchorId === `parallel:${round.id}`) return { node, payment, round };
      if (delegationActionId) return { node, payment, round };
      const legacyRevision = round.frozenNodes[nodeIndex].legacyPaymentNoticeRevision;
      if (typeof legacyRevision !== "string" || legacyRevision !== data.roundRevision) return null;
    } else if (round.currentNodeIndex !== nodeIndex || round.updatedAt.toISOString() !== data.roundRevision) {
      return null;
    }
    if (data.anchorId !== round.id) {
      const anchor = await tx.approvalActionLog.findUnique({ where: { id: data.anchorId } });
      if (!anchor || !opensApprovalNode(anchor, round.id)) return null;
    } else if (nodeIndex !== 0) {
      return null;
    }
    return { node, payment, round };
  }

  private async currentCorrectionContext(tx: Prisma.TransactionClient, intent: ApprovalActionLog, data: Prisma.JsonObject) {
    if (typeof data.paymentId !== "string" || typeof data.recipientId !== "string" || typeof data.anchorId !== "string") return null;
    const [round, payment, user, anchor] = await Promise.all([
      tx.approvalInstance.findUnique({ where: { id: intent.approvalInstanceId } }),
      tx.paymentRequest.findUnique({ where: { id: data.paymentId }, select: { id: true, projectId: true, status: true, code: true } }),
      tx.user.findUnique({ where: { id: data.recipientId }, select: { isActive: true } }),
      tx.approvalActionLog.findUnique({ where: { id: data.anchorId } })
    ]);
    if (!round || !payment || !user?.isActive || !anchor) return null;
    if (!["rejected", "returned_to_applicant"].includes(round.status)) return null;
    if (!["approval_rejected", "draft"].includes(payment.status)) return null;
    if (!["reject", "return_to_applicant"].includes(anchor.action) || anchor.approvalInstanceId !== round.id) return null;
    if (round.businessId !== payment.id || payment.projectId !== data.projectId) return null;
    if (round.applicantUserId !== intent.actorUserId || intent.actorUserId !== data.recipientId) return null;
    const latest = await tx.approvalInstance.findFirst({ where: {
      businessType: "payment_request", businessId: payment.id, flowType: "payment.approve"
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (latest?.id !== round.id) return null;
    return { node: null, payment, round };
  }

  private async currentRecipient(tx: Prisma.TransactionClient, payment: PendingPayment, round: ApprovalInstance, node: FrozenApprovalNode, actorId: string, nodeIndex: number, expectedDelegationActionId?: string) {
    const getRoles = async (userId: string) => {
      const roleScopes = await this.visibility.effectiveRoleScopesInTransaction(tx, userId, payment.projectId);
      const roleKeys = resolveEffectiveRoleKeys(roleScopes.globalRoleKeys, roleScopes.projectRoleKeys);
      return { userId, roleKeys, roleScopes };
    };
    const { roleKeys: actorRoleKeys, roleScopes: actorRoleScopes } = await getRoles(actorId);
    const delegators = await activeApprovalDelegatorIds(tx, actorId);
    const activeDelegators = await Promise.all(delegators.map(getRoles));
    const parallel = isOrdinaryPaymentParallelRound(round.frozenNodes);
    if (!parallel && !canPerform("payment.approve", actorRoleKeys) &&
        !activeDelegators.some(actor => canPerform("payment.approve", actor.roleKeys))) return false;
    const delegationPrincipals = parallel
      ? await loadOrdinaryPaymentDelegationPrincipals(tx, round.frozenNodes, actorId, payment.projectId,
        async id => (await getRoles(id)).roleScopes, { dutyIndex: nodeIndex })
      : undefined;
    const identity = parallel ? resolveOrdinaryPaymentDuty(round.frozenNodes, nodeIndex, {
      actorUserId: actorId, actorRoleKeys, actorRoleScopes, activeDelegators, delegationPrincipals
    })
      : resolveApprovalReviewIdentity({ node, actorUserId: actorId, actorRoleKeys,
          activeDelegators: activeDelegators.map(({ userId, roleKeys }) => ({ userId, roleKeys })) });
    if (!identity) return false;
    try {
      assertOrdinaryApplicantCannotReview({ ...identity, applicantUserId: round.applicantUserId, actorUserId: actorId,
        actorRoleKeys: identity.representedUserId === actorId && !identity.viaAssignment ? [...actorRoleKeys, identity.approvedRoleKey] : actorRoleKeys });
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
    const delegationActionId = "ordinaryPaymentDelegationActionId" in identity ? identity.ordinaryPaymentDelegationActionId : undefined;
    if (expectedDelegationActionId !== undefined) return delegationActionId === expectedDelegationActionId;
    if (parallel && delegationActionId) return true;
    return (await this.visibility.visibleRequestedProjectIdsInTransaction(tx, actorId, [payment.projectId])).includes(payment.projectId)
      && await sensitiveBusinessReadAllowed(tx, "payment_request", payment.id, actorId, actorRoleKeys);
  }

  private append(client: Pick<Prisma.TransactionClient, "approvalActionLog">, intent: ApprovalActionLog, event: string, key: "claim" | "terminal") {
    return client.approvalActionLog.createMany({ skipDuplicates: true, data: [{
      id: idFor(intent.id, key), approvalInstanceId: intent.approvalInstanceId, actorUserId: intent.actorUserId,
      action: "system_notification", metadata: { kind: KIND, intentId: intent.id, event }
    }] });
  }
}
