import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { Prisma, type GeneralProcurement, type ApprovalInstance, type ApprovalActionLog } from "@prisma/client";
import { createHash } from "node:crypto";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { generalRequestActor, generalRequestDutyIdentity } from "./general-procurement-request-access";

export const GENERAL_REQUEST_NOTIFICATION_KIND = "general_request_duty_notification_v2";
const KIND = GENERAL_REQUEST_NOTIFICATION_KIND;
const digest = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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
    if (!approval && !procurement) return;
    const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true } });
    const nodes = Array.isArray(round.frozenNodes) ? round.frozenNodes as Array<Record<string, unknown>> : [];
    const indexes = approval ? activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex) : [nodes.length];
    const intents: Prisma.ApprovalActionLogCreateManyInput[] = [];
    for (const index of indexes) for (const user of users) {
      const authorized = approval ? Boolean(await generalRequestDutyIdentity(tx, this.visibility, row, round, index, user.id))
        : (await generalRequestActor(tx, this.visibility, user.id, null)).globalRoleKeys.includes("comprehensive_director");
      if (!authorized) continue;
      const stage = approval ? "approval" : "procurement";
      intents.push({ id: digest(KIND, round.id, stage, index, user.id), approvalInstanceId: round.id, actorUserId: row.applicantUserId, action: "system_notification",
        metadata: { kind: KIND, event: "queued", stage, nodeIndex: index, recipientId: user.id, businessCode: row.code, dutyName: approval ? String(nodes[index].name) : "综合部采购" } });
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

  async dispatchQueued() {
    if (!this.sms.available()) return;
    const events = await this.prisma.$queryRaw<ApprovalActionLog[]>(Prisma.sql`
      SELECT queued.* FROM "ApprovalActionLog" queued
      WHERE queued."action" = 'system_notification' AND queued."metadata"->>'kind' = ${KIND}
        AND queued."metadata"->>'event' = 'queued'
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
        let authorized = Boolean(row && fresh && row.requestProtocolVersion === 2 && row.approvalInstanceId === fresh.id);
        if (authorized && row && fresh) authorized = data.stage === "approval"
          ? row.status === "approval_pending" && fresh.status === "in_progress" && Boolean(await generalRequestDutyIdentity(tx, this.visibility, row, fresh, Number(data.nodeIndex), String(data.recipientId)))
          : data.stage === "procurement" && row.status === "approved_pending_procurement" && fresh.status === "approved" && (await generalRequestActor(tx, this.visibility, String(data.recipientId), null)).globalRoleKeys.includes("comprehensive_director");
        const user = authorized ? await tx.user.findUnique({ where: { id: String(data.recipientId) }, select: { phone: true, isActive: true } }) : null;
        if (!user?.isActive) { await this.append(tx, intent, "cancelled", data); return null; }
        const reserved = await this.append(tx, intent, "dispatch_claimed", data);
        return reserved.count === 1 ? { phone: user.phone ?? "", data } : null;
      });
      if (!reservation) continue;
      const result = await this.sms.send(reservation.phone, "综合采购申请", String(data.dutyName), String(data.businessCode)).catch(() => ({ status: "unknown" as const, message: "短信发送结果待确认，请勿重复发送" }));
      await this.append(this.prisma, intent, result.status, { ...data, message: result.message, ...("receipt" in result && result.receipt ? { receipt: result.receipt } : {}) });
    }
  }
  private append(client: Pick<Prisma.TransactionClient, "approvalActionLog">, intent: { id: string; approvalInstanceId: string; actorUserId: string }, event: string, data: Prisma.InputJsonObject) {
    return client.approvalActionLog.createMany({ skipDuplicates: true, data: [{ id: digest(KIND, intent.id, event === "dispatch_claimed" ? "claim" : "terminal"),
      approvalInstanceId: intent.approvalInstanceId, actorUserId: intent.actorUserId, action: "system_notification", metadata: { ...data, kind: KIND, intentId: intent.id, event } }] });
  }
}
