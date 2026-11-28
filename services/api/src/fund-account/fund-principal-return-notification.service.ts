import { BadRequestException, ConflictException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type ApprovalInstance, type AuditLog, type RegisteredPrincipalReturnApplication } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import type { FrozenApprovalNode } from "../approval/approval-review-identity";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { PrismaService } from "../database/prisma.service";
import { PRINCIPAL_RETURN_BUSINESS_TYPE, PRINCIPAL_RETURN_REVIEW_ACTION,
  principalReturnPayableScopeKeys, resolvePrincipalReturnReviewIdentity } from "./fund-principal-return.service";

const KIND = "principal_return_duty_notification";
const PAY_ROLES = ["finance_staff", "finance_director", "comprehensive_director"];
type Tx = Prisma.TransactionClient;
type Duty = { kind: "review"; nodeIndex: number } | { kind: "pay" };

@Injectable()
export class FundPrincipalReturnNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FundPrincipalReturnNotificationService.name);

  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queueReview(tx: Tx, row: RegisteredPrincipalReturnApplication, actorId: string) {
    const round = await tx.approvalInstance.findUnique({ where: {id: row.approvalInstanceId} });
    if (!round || row.status !== "pending" || round.status !== "approval_pending" ||
        round.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE || round.businessId !== row.id || !isParallelApprovalRound(round.frozenNodes)) return;
    for (const nodeIndex of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
      const node = round.frozenNodes[nodeIndex] as FrozenApprovalNode;
      const now = new Date();
      const [holders, delegates] = await Promise.all([
        this.assigned(tx, node.roleKeys as string[], row.projectId),
        tx.approvalDelegation.findMany({
          where: {actionKey: PRINCIPAL_RETURN_REVIEW_ACTION, resourceType: PRINCIPAL_RETURN_BUSINESS_TYPE,
            resourceId: `${round.id}:${nodeIndex}`, enabled: true, startsAt: {lte: now}, endsAt: {gt: now}},
          select: {toUserId: true},
        }),
      ]);
      await this.queue(tx, row, round, {kind: "review", nodeIndex}, [...holders, ...delegates.map(item => item.toUserId)], actorId);
    }
  }

  async queuePayment(tx: Tx, row: RegisteredPrincipalReturnApplication, actorId: string) {
    const round = await tx.approvalInstance.findUnique({where: {id: row.approvalInstanceId}});
    if (!round || round.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE || round.businessId !== row.id) return;
    await this.queue(tx, row, round, {kind: "pay"}, await this.assigned(tx, PAY_ROLES, null), actorId);
  }

  async status(applicationId: string, actorId: string, key: string) {
    return {notice: await auditDutyNoticeStatus(this.noticeAccess(this.parseDuty(key)), applicationId, actorId)};
  }

  async retry(applicationId: string, actorId: string, key: string, attemptId: string) {
    const access = this.noticeAccess(this.parseDuty(key));
    if (!await auditDutyNoticeStatus(access, applicationId, actorId)) {
      throw new ConflictException("当前待办或短信记录已变化，请刷新");
    }
    const result = await retryFailedAuditDutyNotice(access, applicationId, actorId, attemptId);
    if (!result.enqueued) return result.status;
    await this.afterCommit();
    return await auditDutyNoticeStatus(access, applicationId, actorId) ?? result.status;
  }

  private parseDuty(key: string): Duty {
    if (key === "pay") return {kind: "pay"};
    const node = /^review-([0-3])$/u.exec(key);
    if (!node) throw new BadRequestException("短信职责无法核对");
    return {kind: "review", nodeIndex: Number(node[1])};
  }

  private noticeAccess(duty?: Duty) {
    return {
      prisma: this.prisma, sms: this.sms, kind: KIND,
      ...(duty ? {scope: {...duty}} : {}),
      lockDuty: async (tx: Tx, id: string) => {
        await tx.$queryRaw`SELECT id FROM public."RegisteredPrincipalReturnApplication" WHERE id = ${id} FOR UPDATE`;
      },
      currentMessage: (tx: Tx, intent: AuditLog) => this.currentMessage(tx, intent),
      canAccess: async (tx: Tx, intent: AuditLog) => Boolean(await this.readCurrentDuty(tx, intent)),
    };
  }

  async afterCommit() {
    try {
      const access = this.noticeAccess();
      await dispatchAuditDutyNotices(this.prisma, this.sms, KIND, access.lockDuty, access.currentMessage);
    } catch {
      this.logger.warn("垫资本金归还待办短信暂未完成，保留记录以供核对");
    }
  }

  private async assigned(tx: Tx, roleKeys: string[], projectId: string | null) {
    const positions = await tx.position.findMany({where: {key: {in: roleKeys}}, select: {id: true, key: true}});
    const projectManager = positions.find(position => position.key === "project_manager");
    const projectDuty = projectId && projectManager ? {projectId, positionId: projectManager.id} : null;
    const [members, assignments] = await Promise.all([
      projectDuty ? tx.projectMember.findMany({where: {projectId: projectDuty.projectId, positionKey: "project_manager"},
        select: {userId: true}}) : [],
      tx.userPosition.findMany({where: {OR: [
        {projectId: null, positionId: {in: positions.filter(position => position.key !== "project_manager").map(position => position.id)}},
        ...(projectDuty ? [projectDuty] : []),
      ]}, select: {userId: true}}),
    ]);
    return [...members, ...assignments].map(item => item.userId);
  }

  private async queue(tx: Tx, row: RegisteredPrincipalReturnApplication, round: ApprovalInstance, duty: Duty,
      recipients: string[], actorId: string) {
    const data: Prisma.AuditLogCreateManyInput[] = [];
    for (const recipientId of new Set(recipients)) {
      if (!await this.currentDuty(tx, row, round, duty, recipientId)) continue;
      data.push({id: this.intentId(round.id, duty, recipientId), actorUserId: actorId, action: "queued",
        businessType: KIND, businessId: row.id, metadata: {roundId: round.id, recipientId, ...duty}});
    }
    if (data.length) await tx.auditLog.createMany({data, skipDuplicates: true});
  }

  private intentId(roundId: string, duty: Duty, recipientId: string) {
    return auditDutyNoticeId(KIND, roundId, duty.kind, duty.kind === "review" ? String(duty.nodeIndex) : "", recipientId);
  }

  private async currentDuty(tx: Tx, row: RegisteredPrincipalReturnApplication, round: ApprovalInstance, duty: Duty, recipientId: string) {
    if (duty.kind === "pay") {
      return round.status === "approved" && ["approved", "partially_paid"].includes(row.status) &&
        row.approvedYuan?.gt(row.paidYuan) && (await principalReturnPayableScopeKeys(tx, recipientId)).length > 0
        ? "登记实际归还" : null;
    }
    if (row.status !== "pending" || round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes) ||
        !activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(duty.nodeIndex)) return null;
    const node = round.frozenNodes[duty.nodeIndex] as FrozenApprovalNode;
    const review = await resolvePrincipalReturnReviewIdentity(tx, recipientId, row.projectId, round.id, duty.nodeIndex, node);
    if (!review || (row.createdByUserId === recipientId && review.identity.viaAssignment)) return null;
    return typeof node.name === "string" ? node.name : "本金归还审批";
  }

  private async readCurrentDuty(tx: Tx, intent: AuditLog) {
    const {roundId, recipientId, kind, nodeIndex} = (intent.metadata ?? {}) as Prisma.JsonObject;
    const duty: Duty | null = kind === "pay" ? {kind} :
      kind === "review" && typeof nodeIndex === "number" && Number.isInteger(nodeIndex) ? {kind, nodeIndex} : null;
    if (!intent.businessId || typeof recipientId !== "string" || typeof roundId !== "string" || !duty) return null;
    const [row, round] = await Promise.all([
      tx.registeredPrincipalReturnApplication.findUnique({where: {id: intent.businessId}}),
      tx.approvalInstance.findUnique({where: {id: roundId}}),
    ]);
    if (!row || row.approvalInstanceId !== roundId || !round || round.businessId !== row.id ||
        round.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE) return null;
    const dutyName = await this.currentDuty(tx, row, round, duty, recipientId);
    if (!dutyName) return null;

    const originalId = this.intentId(roundId, duty, recipientId);
    let attempt = intent;
    const visited = new Set<string>();
    for (;;) {
      const meta = (attempt.metadata ?? {}) as Prisma.JsonObject;
      if (attempt.action !== "queued" || attempt.businessType !== KIND || attempt.businessId !== intent.businessId ||
          meta.roundId !== roundId || meta.recipientId !== recipientId || meta.kind !== kind || meta.nodeIndex !== nodeIndex ||
          visited.has(attempt.id)) return null;
      if (attempt.id === originalId) return meta.retryOf === undefined ? {row, duty, recipientId, dutyName} : null;
      if (typeof meta.retryOf !== "string" || attempt.id !== auditDutyNoticeId(KIND, meta.retryOf, "retry")) return null;
      visited.add(attempt.id);
      const [prior, failure] = await Promise.all([
        tx.auditLog.findUnique({where: {id: meta.retryOf}}),
        tx.auditLog.findUnique({where: {id: auditDutyNoticeId(KIND, meta.retryOf, "terminal")}}),
      ]);
      if (!prior || !failure || failure.action !== "failed" || failure.businessType !== KIND ||
          failure.businessId !== intent.businessId || (failure.metadata as Prisma.JsonObject | null)?.intentId !== prior.id) return null;
      attempt = prior;
    }
  }

  private async currentMessage(tx: Tx, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const current = await this.readCurrentDuty(tx, intent);
    if (!current) return null;
    const {row, duty, recipientId, dutyName} = current;
    const recipient = await tx.user.findUnique({where: {id: recipientId}, select: {phone: true, isActive: true}});
    if (!recipient?.isActive || !recipient.phone) return null;
    const [originator, project] = await Promise.all([
      tx.user.findUnique({where: {id: row.createdByUserId}, select: {name: true}}),
      row.projectId ? tx.project.findUnique({where: {id: row.projectId}, select: {name: true}}) : null,
    ]);
    return {phone: recipient.phone, intent: {
      businessLabel: "垫资本金归还", businessCode: "垫资本金归还", dutyName,
      scopeName: project?.name ?? "公司日常", initiatorName: originator?.name ?? "发起人待核对",
      subject: dutyName, participants: [row.contributorName],
      amountText: `${(duty.kind === "pay" ? row.approvedYuan!.minus(row.paidYuan) : row.requestedYuan).toFixed(4)} 元`,
      targetPath: approvalDutyTarget("principalReturn", row.id),
    }};
  }
}
