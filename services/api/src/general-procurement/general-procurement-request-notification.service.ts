import { generalProcurementDutySmsIntent } from "./general-procurement-request-facts";
import { ConflictException, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { Prisma, type GeneralProcurement, type ApprovalInstance, type ApprovalActionLog } from "@prisma/client";
import { createHash } from "node:crypto";
import type { AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { generalRequestActor, generalRequestDutyIdentity } from "./general-procurement-request-access";

export const GENERAL_REQUEST_NOTIFICATION_KIND = "general_request_duty_notification_v2";
const KIND = GENERAL_REQUEST_NOTIFICATION_KIND;
const digest = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const retryId = (attemptId: string) => digest(KIND, attemptId, "retry");
const object = (value: unknown): Prisma.InputJsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.InputJsonObject : {};

/** Task 20 outbox only. Reservation commits before SMS; crash or unknown outcome is never auto-resent. */
@Injectable()
export class GeneralProcurementRequestNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeneralProcurementRequestNotificationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private roundCursor?: string;
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService, private readonly visibility: ProjectVisibilityService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.reconcilePending().catch(() => this.logger.warn("综合采购通知暂未完成，持久记录保留待核对")); }, 60_000); this.timer.unref();
    void this.reconcilePending().catch(() => this.logger.warn("综合采购通知暂未完成，持久记录保留待核对"));
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queueInTransaction(tx: Prisma.TransactionClient, row: GeneralProcurement, round: ApprovalInstance) {
    if (row.requestProtocolVersion !== 2 || row.approvalInstanceId !== round.id || round.businessType !== "general_procurement" || round.businessId !== row.id) return;
    const approval = row.status === "approval_pending" && round.status === "in_progress";
    const procurement = row.status === "approved_pending_procurement" && round.status === "approved";
    const correction = row.status === "returned" && round.status === "returned";
    if (!approval && !procurement && !correction) return;
    const stage = approval ? "approval" : procurement ? "procurement" : "correction";
    const users = await tx.user.findMany({
      where: { isActive: true, ...(correction ? { id: row.applicantUserId } : {}) }, select: { id: true }
    });
    const nodes = Array.isArray(round.frozenNodes) ? round.frozenNodes as Array<Record<string, unknown>> : [];
    const indexes = approval ? activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex) : [nodes.length];
    const intents: Prisma.ApprovalActionLogCreateManyInput[] = [];
    for (const index of indexes) for (const user of users) {
      const authorized = approval ? Boolean(await generalRequestDutyIdentity(tx, this.visibility, row, round, index, user.id))
        : correction ? user.id === row.applicantUserId
        : (await generalRequestActor(tx, this.visibility, user.id, null)).globalRoleKeys.includes("comprehensive_director");
      if (!authorized) continue;
      intents.push({ id: digest(KIND, round.id, stage, index, user.id), approvalInstanceId: round.id, actorUserId: row.applicantUserId, action: "system_notification",
        metadata: { kind: KIND, event: "queued", stage, nodeIndex: index, recipientId: user.id, businessCode: row.code, dutyName: approval ? String(nodes[index].name) : correction ? "修改退回的申请" : "综合部采购" } });
    }
    if (intents.length) await tx.approvalActionLog.createMany({ data: intents, skipDuplicates: true });
  }

  async reconcilePending() {
    if (this.busy || !this.sms.available()) return;
    this.busy = true;
    try {
      const rounds = await this.prisma.approvalInstance.findMany({ where: { businessType: "general_procurement", status: { in: ["in_progress", "approved"] } }, orderBy: { id: "asc" }, take: 100, ...(this.roundCursor ? { cursor: { id: this.roundCursor }, skip: 1 } : {}) });
      this.roundCursor = rounds.length === 100 ? rounds.at(-1)!.id : undefined;
      for (const round of rounds) await this.prisma.$transaction(async tx => {
        const row = await tx.generalProcurement.findUnique({ where: { id: round.businessId } });
        if (!row) return;
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${row.id} FOR UPDATE`);
        const current = await tx.generalProcurement.findUnique({ where: { id: row.id } });
        const fresh = await tx.approvalInstance.findUnique({ where: { id: round.id } });
        if (current && fresh) await this.queueInTransaction(tx, current, fresh);
      });
      await this.dispatchQueued();
    } finally { this.busy = false; }
  }

  async status(id: string, actorId: string) {
    return this.prisma.$transaction(async tx => ({
      notices: (await this.currentNotices(tx, id, actorId)).map(notice => notice.status)
    }));
  }

  async retry(id: string, actorId: string, attemptId: string) {
    const next = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${id} FOR UPDATE`);
      const notice = (await this.currentNotices(tx, id, actorId)).find(item => item.chain.includes(attemptId));
      if (!notice) throw new ConflictException("当前没有可重试的采购待办短信");
      if (notice.attempt.id !== attemptId) return { kind: "replay", status: notice.status } as const;
      if (!notice.status.canRetry) throw new ConflictException("仅可重试明确发送失败的采购待办短信");
      const queuedId = retryId(attemptId);
      await tx.approvalActionLog.createMany({ skipDuplicates: true, data: [{
        id: queuedId, approvalInstanceId: notice.attempt.approvalInstanceId, actorUserId: notice.attempt.actorUserId,
        action: "system_notification",
        metadata: { ...object(notice.attempt.metadata), originalId: notice.chain[0], retryOf: attemptId }
      }] });
      return { kind: "new", queuedId } as const;
    });
    if (next.kind === "replay") return next.status;
    await this.dispatchQueued(next.queuedId);
    const { notices } = await this.status(id, actorId);
    const result = notices.find(notice => notice.attemptId === next.queuedId);
    if (!result) throw new ConflictException("采购待办已变更，请刷新后查看");
    return result;
  }

  private async currentNotices(tx: Prisma.TransactionClient, id: string, actorId: string) {
    const row = await tx.generalProcurement.findUnique({ where: { id } });
    if (row?.requestProtocolVersion !== 2 || !row.approvalInstanceId) return [];
    const round = await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId } });
    if (!round || round.businessType !== "general_procurement" || round.businessId !== id) return [];
    const user = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!user?.isActive) return [];
    const events = await tx.approvalActionLog.findMany({ where: {
      approvalInstanceId: round.id, action: "system_notification", AND: [
        { metadata: { path: ["kind"], equals: KIND } },
        { metadata: { path: ["recipientId"], equals: actorId } }
      ]
    } });
    const byId = new Map(events.map(event => [event.id, event]));
    const notices = [];
    for (const original of events) {
      const data = object(original.metadata);
      if (!this.isOriginal(original) || !await this.canHandleIntent(tx, row, round, data)) continue;
      const chain = [original.id];
      let attempt = original;
      let status = this.attemptStatus(attempt, byId);
      while (status.status === "failed") {
        const retry = byId.get(retryId(attempt.id));
        if (!retry || !this.matchesRetry(retry, attempt, original)) break;
        chain.push(retry.id);
        attempt = retry;
        status = this.attemptStatus(attempt, byId);
      }
      notices.push({ attempt, chain, status });
    }
    return notices.sort((a, b) => Number(object(a.attempt.metadata).nodeIndex) - Number(object(b.attempt.metadata).nodeIndex));
  }

  private attemptStatus(attempt: ApprovalActionLog, events: Map<string, ApprovalActionLog>): AuditDutyNoticeStatus & { dutyName: string } {
    const terminal = events.get(digest(KIND, attempt.id, "terminal"));
    const receipt = object(terminal?.metadata);
    const origin = object(attempt.metadata);
    const event = receipt.intentId === attempt.id && ["stage", "nodeIndex", "recipientId", "businessCode", "dutyName", "originalId", "retryOf"]
      .every(key => receipt[key] === origin[key]) ? receipt.event : undefined;
    const claimed = events.has(digest(KIND, attempt.id, "claim"));
    const status = event === "failed" || event === "accepted" || event === "cancelled" || event === "unknown"
      ? event : claimed || terminal ? "unknown" : "queued";
    return { attemptId: attempt.id, status, canRetry: status === "failed" && this.sms.available(), dutyName: String(object(attempt.metadata).dutyName) };
  }

  private isOriginal(intent: ApprovalActionLog) {
    const data = object(intent.metadata);
    return intent.action === "system_notification" && data.kind === KIND && data.event === "queued" && !data.retryOf && !data.originalId
      && intent.id === digest(KIND, intent.approvalInstanceId, data.stage, data.nodeIndex, data.recipientId);
  }

  private matchesRetry(retry: ApprovalActionLog, previous: ApprovalActionLog, original: ApprovalActionLog) {
    const data = object(retry.metadata);
    const frozen = object(original.metadata);
    return retry.id === retryId(previous.id) && retry.action === original.action && retry.approvalInstanceId === original.approvalInstanceId
      && retry.actorUserId === original.actorUserId && data.kind === KIND && data.event === "queued" && data.originalId === original.id
      && data.retryOf === previous.id && ["stage", "nodeIndex", "recipientId", "dutyName", "businessCode"].every(key => data[key] === frozen[key]);
  }

  private async canHandleIntent(tx: Prisma.TransactionClient, row: GeneralProcurement, round: ApprovalInstance, data: Prisma.InputJsonObject) {
    if (row.requestProtocolVersion !== 2 || row.approvalInstanceId !== round.id || round.businessType !== "general_procurement" || round.businessId !== row.id
      || typeof data.recipientId !== "string" || typeof data.nodeIndex !== "number") return false;
    if (data.stage === "approval") {
      return row.status === "approval_pending" && round.status === "in_progress"
        && Boolean(await generalRequestDutyIdentity(tx, this.visibility, row, round, data.nodeIndex, data.recipientId));
    }
    if (!Array.isArray(round.frozenNodes) || data.nodeIndex !== round.frozenNodes.length) return false;
    if (data.stage === "procurement") {
      return row.status === "approved_pending_procurement" && round.status === "approved"
        && (await generalRequestActor(tx, this.visibility, data.recipientId, null)).globalRoleKeys.includes("comprehensive_director");
    }
    return data.stage === "correction" && row.status === "returned" && round.status === "returned" && data.recipientId === row.applicantUserId
      && (!row.projectId || (await this.visibility.visibleRequestedProjectIdsInTransaction(tx, row.applicantUserId, [row.projectId])).includes(row.projectId));
  }

  async dispatchQueued(attemptId?: string) {
    if (!this.sms.available()) return;
    const events = await this.prisma.$queryRaw<ApprovalActionLog[]>(Prisma.sql`
      SELECT queued.* FROM "ApprovalActionLog" queued
      WHERE queued."action" = 'system_notification' AND queued."metadata"->>'kind' = ${KIND}
        AND queued."metadata"->>'event' = 'queued'
        ${attemptId ? Prisma.sql`AND queued."id" = ${attemptId}` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM "ApprovalActionLog" receipt
          WHERE receipt."action" = 'system_notification' AND receipt."metadata"->>'kind' = ${KIND}
            AND receipt."metadata"->>'intentId' = queued."id"
            AND receipt."metadata"->>'event' IN ('dispatch_claimed','accepted','failed','unknown','cancelled'))
      ORDER BY queued."createdAt", queued."id" LIMIT 100
    `);
    for (const intent of events) {
      const data = object(intent.metadata);
      if (data.event !== "queued") continue;
      const reservation = await this.prisma.$transaction(async tx => {
        const round = await tx.approvalInstance.findUnique({ where: { id: intent.approvalInstanceId } });
        if (!round) return null;
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${round.businessId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalActionLog" WHERE "id" = ${intent.id} FOR UPDATE`);
        const [row, fresh, claim, terminal] = await Promise.all([
          tx.generalProcurement.findUnique({ where: { id: round.businessId } }), tx.approvalInstance.findUnique({ where: { id: round.id } }),
          tx.approvalActionLog.findUnique({ where: { id: digest(KIND, intent.id, "claim") } }), tx.approvalActionLog.findUnique({ where: { id: digest(KIND, intent.id, "terminal") } })
        ]);
        if (claim || terminal) return null;
        const user = typeof data.recipientId === "string" ? await tx.user.findUnique({
          where: { id: data.recipientId }, select: { phone: true, isActive: true }
        }) : null;
        const authorized = user?.isActive && row && fresh && await this.canHandleIntent(tx, row, fresh, data);
        if (authorized && !this.isOriginal(intent)) {
          const notices = await this.currentNotices(tx, row.id, String(data.recipientId));
          if (!notices.some(notice => notice.attempt.id === intent.id && notice.status.status === "queued")) {
            await this.append(tx, intent, "cancelled", data);
            return null;
          }
        }
        if (!authorized || !user || !row) { await this.append(tx, intent, "cancelled", data); return null; }
        const project = row.projectId ? await tx.project.findUnique({where:{id:row.projectId},select:{name:true}}) : null;
        const message = generalProcurementDutySmsIntent(row,project?.name,"综合采购申请",String(data.dutyName));
        const reserved = await this.append(tx, intent, "dispatch_claimed", data);
        return reserved.count === 1 ? { phone: user.phone ?? "", message } : null;
      });
      if (!reservation) continue;
      const result = await this.sms.sendDutyIntent(reservation.phone,reservation.message).catch(() => ({ status: "unknown" as const, message: "短信发送结果待确认，请勿重复发送" }));
      await this.append(this.prisma, intent, result.status, { ...data, message: result.message, ...("receipt" in result && result.receipt ? { receipt: result.receipt } : {}) });
    }
  }
  private append(client: Pick<Prisma.TransactionClient, "approvalActionLog">, intent: { id: string; approvalInstanceId: string; actorUserId: string }, event: string, data: Prisma.InputJsonObject) {
    return client.approvalActionLog.createMany({ skipDuplicates: true, data: [{ id: digest(KIND, intent.id, event === "dispatch_claimed" ? "claim" : "terminal"),
      approvalInstanceId: intent.approvalInstanceId, actorUserId: intent.actorUserId, action: "system_notification", metadata: { ...data, kind: KIND, intentId: intent.id, event } }] });
  }
}
