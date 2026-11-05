import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type ApprovalActionLog, type ApprovalInstance } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { activeApprovalNodeIndexes, isParallelApprovalRound, SPOT_PARALLEL_NOTIFICATION_KIND } from "../approval/parallel-approval-protocol";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

const KIND = SPOT_PARALLEL_NOTIFICATION_KIND;
const eventId = (intentId: string, stage: string) => createHash("sha256").update(JSON.stringify([KIND, intentId, stage])).digest("hex");
const metadata = (raw: unknown): Prisma.InputJsonObject => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Prisma.InputJsonObject : {};

/** Only this vertical slice. Durable queued -> dispatching -> outcome; an uncertain send is never retried. */
@Injectable()
export class SpotProcurementApprovalNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpotProcurementApprovalNotificationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private cursor?: string;
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService,
    @Optional() private readonly pilot?: SpotProcurementPilotService) {}

  onModuleInit() {
    if (process.env.SKIP_DATABASE_CONNECT === "true" || process.env.NODE_ENV === "test" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.reconcilePending().catch(() => this.logger.warn("零采审批通知暂未完成，持久记录保留待核对")); }, 60_000);
    this.timer.unref();
    void this.reconcilePending().catch(() => this.logger.warn("零采审批通知暂未完成，持久记录保留待核对"));
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queueInTransaction(tx: Prisma.TransactionClient,
    round: Pick<ApprovalInstance, "id" | "status" | "applicantUserId" | "frozenNodes">,
    projectId: string, businessCode: string): Promise<void> {
    if (round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes)) return;
    const nodes = round.frozenNodes;
    const indexes = activeApprovalNodeIndexes(nodes, 0);
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, projectId, indexes.flatMap(index => nodes[index].roleKeys as string[]));
    const intents = indexes.flatMap(index => assignments.filter(row => row.userIsActive && (nodes[index].roleKeys as string[]).includes(row.roleKey)).map(row => ({
      id: createHash("sha256").update(JSON.stringify([KIND, round.id, index, row.userId])).digest("hex"),
      approvalInstanceId: round.id, actorUserId: round.applicantUserId, action: "system_notification",
      metadata: { kind: KIND, event: "queued", nodeIndex: index, recipientId: row.userId, projectId, businessCode, dutyName: String(nodes[index].name ?? "审批职责") }
    })));
    if (intents.length) await tx.approvalActionLog.createMany({ data: intents, skipDuplicates: true });
  }

  /** Reconcile missing/replaced assignees after committed roster changes; only pending duties are enqueued. */
  async reconcilePending(): Promise<void> {
    if (this.busy || !this.sms.available()) return;
    this.busy = true;
    try {
      const rounds = await this.prisma.approvalInstance.findMany({
        where: { businessType: "spot_procurement_version", flowType: "spot_procurement.approve", status: "approval_pending" },
        orderBy: {id: "asc"}, take: 100, ...(this.cursor ? {cursor: {id: this.cursor}, skip: 1} : {})
      });
      this.cursor = rounds.length === 100 ? rounds.at(-1)!.id : undefined;
      for (const round of rounds) {
        if (!isParallelApprovalRound(round.frozenNodes)) continue;
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${round.id} FOR UPDATE`);
          const current = await tx.approvalInstance.findUnique({where: {id: round.id}});
          const business = current ? await this.currentBusiness(tx, current) : null;
          if (current && business) await this.queueInTransaction(tx, current, business.projectId, business.code);
        });
      }
      await this.dispatchQueued();
    } finally { this.busy = false; }
  }

  async dispatchQueued(): Promise<void> {
    if (!this.sms.available()) return;
    const queued = await this.prisma.$queryRaw<ApprovalActionLog[]>(Prisma.sql`
      SELECT queued.* FROM "ApprovalActionLog" queued
      WHERE queued."action" = 'system_notification' AND queued."metadata"->>'kind' = ${KIND}
        AND queued."metadata"->>'event' = 'queued'
        AND NOT EXISTS (SELECT 1 FROM "ApprovalActionLog" receipt
          WHERE receipt."action" = 'system_notification' AND receipt."metadata"->>'kind' = ${KIND}
            AND receipt."metadata"->>'intentId' = queued."id"
            AND receipt."metadata"->>'event' IN ('dispatch_claimed', 'accepted', 'failed', 'unknown', 'cancelled'))
      ORDER BY queued."createdAt", queued."id" LIMIT 100
    `);
    for (const intent of queued) {
      const reservation = await this.prisma.$transaction(async tx => {
        // Every consumer reserves the approval before its intent, matching the business review serialization point.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${intent.approvalInstanceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalActionLog" WHERE "id" = ${intent.id} FOR UPDATE`);
        const fresh = await tx.approvalActionLog.findUnique({where: {id: intent.id}});
        const data = metadata(fresh?.metadata);
        if (!fresh || fresh.action !== "system_notification" || data.kind !== KIND || data.event !== "queued") return null;
        const [claim, terminal] = await Promise.all([
          tx.approvalActionLog.findUnique({where: {id: eventId(intent.id, "dispatch_claimed")}}),
          tx.approvalActionLog.findUnique({where: {id: eventId(intent.id, "terminal")}})
        ]);
        if (claim || terminal) return null;
        const round = await tx.approvalInstance.findUnique({where: {id: intent.approvalInstanceId}});
        const business = round ? await this.currentBusiness(tx, round) : null;
        const index = Number(data.nodeIndex);
        const node = round && isParallelApprovalRound(round.frozenNodes) ? round.frozenNodes[index] : null;
        const eligible = Boolean(round && business && node && activeApprovalNodeIndexes(round.frozenNodes, 0).includes(index));
        const assignments = eligible ? await loadEffectiveProjectApprovalAssignments(tx, business!.projectId, node!.roleKeys as string[], String(data.recipientId)) : [];
        const user = assignments.some(row => row.userIsActive && row.userId === data.recipientId && (node!.roleKeys as string[]).includes(row.roleKey))
          ? await tx.user.findUnique({where: {id: String(data.recipientId)}, select: {id: true, phone: true, isActive: true}}) : null;
        if (!user?.isActive) {
          await this.appendEvent(tx, intent, "cancelled", data);
          return null;
        }
        const claimResult = await this.appendEvent(tx, intent, "dispatch_claimed", data);
        return claimResult.count === 1 ? {phone: user.phone ?? "", data} : null;
      });
      if (!reservation) continue;
      // Reservation was committed before the external boundary. Crash/unknown stays non-retryable.
      const outcome = await this.sms.send(reservation.phone, "零采申请审批", String(reservation.data.dutyName), String(reservation.data.businessCode))
        .catch(() => ({status: "unknown" as const, message: "短信发送结果待确认，请勿重复发送"}));
      await this.appendEvent(this.prisma, intent, outcome.status, {
        ...reservation.data, message: outcome.message,
        ...("receipt" in outcome && outcome.receipt ? {receipt: outcome.receipt} : {})
      });
    }
  }

  private appendEvent(client: Pick<Prisma.TransactionClient, "approvalActionLog">, intent: ApprovalActionLog,
    event: "dispatch_claimed" | "accepted" | "failed" | "unknown" | "cancelled", data: Prisma.InputJsonObject) {
    return client.approvalActionLog.createMany({skipDuplicates: true, data: [{
      id: eventId(intent.id, event === "dispatch_claimed" ? event : "terminal"), approvalInstanceId: intent.approvalInstanceId,
      actorUserId: intent.actorUserId, action: "system_notification", metadata: {...data, kind: KIND, intentId: intent.id, event}
    }]});
  }

  private async currentBusiness(tx: Prisma.TransactionClient, round: ApprovalInstance) {
    if (round.businessType !== "spot_procurement_version" || round.status !== "approval_pending" || !isParallelApprovalRound(round.frozenNodes)) return null;
    const version = await tx.spotProcurementVersion.findUnique({where: {id: round.businessId}});
    const business = version ? await tx.spotProcurement.findUnique({where: {id: version.procurementId}}) : null;
    return business && business.currentVersionId === round.businessId && business.status === "approval_pending" && (!this.pilot || this.pilot.isEnabled(business.projectId)) ? business : null;
  }
}
