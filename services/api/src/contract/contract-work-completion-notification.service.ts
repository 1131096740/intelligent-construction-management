import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import {
  auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice,
  type AuditDutyNoticeStatus, type AuditDutySmsMessage
} from "../approval/audit-duty-notification-delivery";
import { isApprovalDutyComplete, isParallelApprovalRound, activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export const CONTRACT_WORK_COMPLETION_NOTIFICATION_KIND = "contract_work_completion_duty_notification";
const KIND = CONTRACT_WORK_COMPLETION_NOTIFICATION_KIND;
const businessType = "contract_work_completion";
const flowType = "contract.work_completion.approve";
const correctionDuty = "履约确认退回，请修改后重新提交";
/** 与 `approval-progress.service.ts` 的催办冷却同口径：同一职责 60 秒内只发一批，收件人共享。 */
const DUTY_COOLDOWN_MS = 60_000;
type Completion = { id: string; contractVersionId: string; createdByUserId: string; status: string;
  approvalInstanceId: string | null; amountYuan: Prisma.Decimal };
type Round = { id: string; status: string; businessType: string; businessId: string; flowType: string;
  applicantUserId: string; currentNodeIndex: number; frozenNodes: unknown };
type NoticeStatus = AuditDutyNoticeStatus & { dutyName: string };
const object = (value: unknown): Prisma.JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : null;

/** 合同履约确认轮的短信 outbox：三职责各自待办、驳回回制单人；复用通用模板与 claimed/terminal 重试面。 */
@Injectable()
export class ContractWorkCompletionNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContractWorkCompletionNotificationService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** 业务事务内入队：每个未办结职责通知一次，任一轮次重复入队保持同一标识。 */
  async queueDuty(tx: Prisma.TransactionClient, completionId: string, roundId: string) {
    const completion = await tx.contractWorkCompletion.findUnique({ where: { id: completionId } });
    const round = await tx.approvalInstance.findUnique({ where: { id: roundId } });
    if (!completion || !round || !this.isCurrentDutyRound(completion, round)) return;
    const context = await this.context(tx, completion);
    if (!context) return;
    const nodes = round.frozenNodes as Array<Record<string, unknown>>;
    const indexes = activeApprovalNodeIndexes(nodes, round.currentNodeIndex);
    const cooling = await this.coolingDuties(tx, completion.id);
    const data: Prisma.AuditLogCreateManyInput[] = [];
    for (const index of indexes) {
      if (cooling.has(index)) continue;
      const node = nodes[index];
      if (!node) continue;
      for (const recipientId of await this.recipients(tx, context.contract.projectId, node.roleKeys as string[])) {
        data.push({
          id: auditDutyNoticeId(KIND, round.id, "duty", String(index), recipientId),
          businessType: KIND, businessId: completion.id, actorUserId: round.applicantUserId, action: "queued",
          metadata: { kind: KIND, event: "queued", stage: "duty", completionId: completion.id, roundId: round.id,
            contractVersionId: completion.contractVersionId, nodeIndex: index, recipientId,
            dutyName: typeof node.name === "string" ? node.name : "履约确认" }
        });
      }
    }
    if (data.length) await tx.auditLog.createMany({ data, skipDuplicates: true });
  }

  /** 任一职责驳回后提醒原制单人修改重提；重提后旧一轮通知在派发前自动取消。 */
  async queueCorrection(tx: Prisma.TransactionClient, completionId: string, roundId: string) {
    const completion = await tx.contractWorkCompletion.findUnique({ where: { id: completionId } });
    const round = await tx.approvalInstance.findUnique({ where: { id: roundId } });
    if (!completion || !round || completion.status !== "draft" || completion.approvalInstanceId !== round.id ||
      round.status !== "rejected" || round.businessType !== businessType || round.businessId !== completion.id ||
      round.flowType !== flowType || round.applicantUserId !== completion.createdByUserId) return;
    if (!await this.context(tx, completion)) return;
    const recipientId = completion.createdByUserId;
    await tx.auditLog.createMany({ skipDuplicates: true, data: [{
      id: auditDutyNoticeId(KIND, round.id, "correction", recipientId),
      businessType: KIND, businessId: completion.id, actorUserId: round.applicantUserId, action: "queued",
      metadata: { kind: KIND, event: "queued", stage: "correction", completionId: completion.id, roundId: round.id,
        contractVersionId: completion.contractVersionId, nodeIndex: -1, recipientId, dutyName: correctionDuty }
    }] });
  }

  async notificationStatus(completionId: string, actorId: string): Promise<NoticeStatus | null> {
    const status = await auditDutyNoticeStatus(this.noticeAccess(), completionId, actorId);
    if (!status) return null;
    return { ...status, dutyName: await this.dutyName(completionId, actorId) };
  }

  /** 合同详情页沿用的 `/contracts/:versionId/duty-sms` 聚合面：按版本列出本人当前待办短信。 */
  async notificationStatusForVersion(versionId: string, actorId: string): Promise<NoticeStatus[]> {
    const rows = await this.prisma.$queryRaw<Array<{ businessId: string }>>(Prisma.sql`
      SELECT DISTINCT ON (queued."businessId") queued."businessId"
      FROM "AuditLog" queued
      WHERE queued."businessType" = ${KIND} AND queued."action" = 'queued'
        AND queued."metadata"->>'contractVersionId' = ${versionId}
        AND queued."metadata"->>'recipientId' = ${actorId}
      ORDER BY queued."businessId", queued."createdAt" DESC, queued."id" DESC
    `);
    const notices: NoticeStatus[] = [];
    for (const row of rows) {
      const notice = await this.notificationStatus(row.businessId, actorId);
      if (notice) notices.push(notice);
    }
    return notices;
  }

  /** 仅接管属于本人、且属于本合同版本的履约待办短信；否则交给合同版本待办处理。 */
  async retry(versionId: string, actorId: string, attemptId: string): Promise<NoticeStatus | null> {
    const intent = await this.prisma.auditLog.findUnique({ where: { id: attemptId } });
    const data = object(intent?.metadata);
    if (!intent || intent.businessType !== KIND || intent.action !== "queued" || !intent.businessId ||
      !data || data.kind !== KIND || data.contractVersionId !== versionId || data.recipientId !== actorId) return null;
    const result = await retryFailedAuditDutyNotice(this.noticeAccess(), intent.businessId, actorId, attemptId);
    if (result.enqueued) void this.afterCommit();
    return { ...result.status, dutyName: typeof data.dutyName === "string" ? data.dutyName : "履约确认" };
  }

  async afterCommit() {
    try {
      await dispatchAuditDutyNotices(this.prisma, this.sms, KIND,
        (tx, businessId, intent) => this.lockCompletion(tx, businessId, intent),
        (tx, intent) => this.currentMessage(tx, intent));
    } catch {
      this.logger.warn("合同履约确认待办短信暂未完成，保留记录以供核对");
    }
  }

  private isCurrentDutyRound(completion: Completion, round: Round) {
    return completion.status === "in_approval" && completion.approvalInstanceId === round.id &&
      round.status === "in_progress" && round.businessType === businessType && round.businessId === completion.id &&
      round.flowType === flowType && isParallelApprovalRound(round.frozenNodes);
  }

  private async context(tx: Prisma.TransactionClient, completion: Completion) {
    const version = await tx.contractVersion.findUnique({ where: { id: completion.contractVersionId } });
    if (!version) return null;
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    const code = contract?.code;
    if (!contract || contract.voidedAt || !code) return null;
    const project = await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true, name: true } });
    if (!project?.isActive) return null;
    return { version, contract, project, code };
  }

  private async coolingDuties(tx: Prisma.TransactionClient, completionId: string) {
    const rows = await tx.auditLog.findMany({
      where: { businessType: KIND, businessId: completionId, action: "queued",
        createdAt: { gte: new Date(Date.now() - DUTY_COOLDOWN_MS) } },
      select: { metadata: true }
    });
    const indexes = new Set<number>();
    for (const row of rows) {
      const data = object(row.metadata);
      if (data?.stage === "duty" && typeof data.nodeIndex === "number") indexes.add(data.nodeIndex);
    }
    return indexes;
  }

  private async recipients(tx: Prisma.TransactionClient, projectId: string, roleKeys: readonly string[]) {
    const holders = (await loadEffectiveProjectApprovalAssignments(tx, projectId, roleKeys))
      .filter(row => row.userIsActive).map(row => row.userId);
    const now = new Date();
    const delegates = holders.length ? await tx.approvalDelegation.findMany({ where: {
      fromUserId: { in: [...new Set(holders)] }, actionKey: null, resourceType: null, resourceId: null,
      enabled: true, startsAt: { lte: now }, endsAt: { gt: now }
    }, select: { toUserId: true } }) : [];
    const ids = [...new Set([...holders, ...delegates.map(row => row.toUserId)])];
    if (!ids.length) return [];
    const active = await tx.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    const activeIds = new Set(active.map(row => row.id));
    return ids.filter(id => activeIds.has(id));
  }

  private async lockCompletion(tx: Prisma.TransactionClient, completionId: string, intent: AuditLog) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractWorkCompletion" WHERE "id" = ${completionId} FOR UPDATE`);
    const roundId = object(intent.metadata)?.roundId;
    if (typeof roundId === "string") {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${roundId} FOR UPDATE`);
    }
  }

  private async lockByCompletion(tx: Prisma.TransactionClient, completionId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractWorkCompletion" WHERE "id" = ${completionId} FOR UPDATE`);
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind: KIND,
      lockDuty: (tx: Prisma.TransactionClient, businessId: string) => this.lockByCompletion(tx, businessId),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent)
    };
  }

  private async dutyName(completionId: string, actorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ dutyName: string | null }>>(Prisma.sql`
      SELECT queued."metadata"->>'dutyName' AS "dutyName"
      FROM "AuditLog" queued
      WHERE queued."businessType" = ${KIND} AND queued."businessId" = ${completionId}
        AND queued."action" = 'queued' AND queued."metadata"->>'recipientId' = ${actorId}
      ORDER BY queued."createdAt" DESC, queued."id" DESC LIMIT 1
    `);
    return rows[0]?.dutyName ?? "履约确认";
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const data = object(intent.metadata);
    const completionId = intent.businessId;
    if (!completionId || !data || intent.businessType !== KIND || intent.action !== "queued" ||
      data.kind !== KIND || data.event !== "queued" || typeof data.roundId !== "string" ||
      typeof data.recipientId !== "string" || typeof data.contractVersionId !== "string") return null;
    const completion = await tx.contractWorkCompletion.findUnique({ where: { id: completionId } });
    const round = await tx.approvalInstance.findUnique({ where: { id: data.roundId } });
    if (!completion || !round || round.id !== data.roundId || completion.approvalInstanceId !== round.id ||
      completion.contractVersionId !== data.contractVersionId) return null;
    const context = await this.context(tx, completion);
    if (!context) return null;
    let dutyName: string;
    if (data.stage === "duty") {
      if (!this.isCurrentDutyRound(completion, round) || typeof data.nodeIndex !== "number" ||
        !isParallelApprovalRound(round.frozenNodes)) return null;
      const nodes = round.frozenNodes;
      const node = nodes[data.nodeIndex];
      if (!node || isApprovalDutyComplete(node) ||
        !activeApprovalNodeIndexes(nodes, round.currentNodeIndex).includes(data.nodeIndex)) return null;
      if (!(await this.recipients(tx, context.contract.projectId, node.roleKeys as string[])).includes(data.recipientId)) return null;
      dutyName = typeof node.name === "string" ? node.name : "履约确认";
    } else if (data.stage === "correction") {
      if (completion.status !== "draft" || round.status !== "rejected" || round.applicantUserId !== completion.createdByUserId ||
        data.recipientId !== completion.createdByUserId) return null;
      dutyName = correctionDuty;
    } else {
      return null;
    }
    const recipient = await tx.user.findUnique({ where: { id: data.recipientId }, select: { phone: true, isActive: true } });
    if (!recipient?.isActive) return null;
    const applicant = await tx.user.findUnique({ where: { id: round.applicantUserId }, select: { name: true } });
    const { version, contract, project, code } = context;
    return {
      phone: recipient.phone ?? "",
      intent: {
        businessLabel: data.stage === "correction" ? "合同履约确认退回" : "合同履约确认",
        dutyName, businessCode: code, scopeName: project.name,
        initiatorName: applicant?.name ?? "发起人待核对",
        subject: `${contract.name}履约确认`,
        participants: [version.companyEntityNameSnapshot ?? contract.companyEntityName, contract.counterparty]
          .filter((name): name is string => Boolean(name)),
        amountText: `${completion.amountYuan.toFixed(4)} 元`,
        targetPath: approvalDutyTarget("contract", code)
      } satisfies ApprovalDutySmsIntent
    };
  }
}
