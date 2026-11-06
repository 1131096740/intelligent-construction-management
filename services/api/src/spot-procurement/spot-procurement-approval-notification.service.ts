import type {RoleKey} from "@jiangkong/shared-domain";
import {activeSpotDutyMandates, delegatedSpotApprovalIdentity} from "../approval/spot-approval-duty-access";
import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type ApprovalActionLog, type ApprovalInstance } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { activeApprovalNodeIndexes, isParallelApprovalRound, SPOT_PARALLEL_NOTIFICATION_KIND } from "../approval/parallel-approval-protocol";
import { loadProjectApprovalAssignments, loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
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
    const intents: Prisma.ApprovalActionLogCreateManyInput[] = [];
    for (const index of indexes) {
      const direct = assignments.filter(row => row.userIsActive && (nodes[index].roleKeys as string[]).includes(row.roleKey));
      const mandates = await activeSpotDutyMandates(tx, round.id, index);
      const recipients = new Set([...direct.map(row => row.userId), ...(mandates ?? []).filter(mandate => direct.some(row => row.userId === mandate.fromUserId)).map(mandate => mandate.toUserId)]);
      for (const recipientId of recipients) intents.push({
        id: createHash("sha256").update(JSON.stringify([KIND, round.id, index, recipientId])).digest("hex"),
        approvalInstanceId: round.id, actorUserId: round.applicantUserId, action: "system_notification",
        metadata: {kind: KIND, event: "queued", nodeIndex: index, recipientId, projectId, businessCode, dutyName: String(nodes[index].name ?? "审批职责")}
      });
    }
    if (intents.length) await tx.approvalActionLog.createMany({ data: intents, skipDuplicates: true });
  }

  async queuePurchaseInTransaction(tx: Prisma.TransactionClient, round: Pick<ApprovalInstance, "id" | "status" | "applicantUserId">,
    projectId: string, businessCode: string): Promise<void> {
    if (round.status !== "approved") return;
    const assignments = await loadProjectApprovalAssignments(tx, projectId, ["material_staff"]);
    const recipients = [...new Set(assignments.filter(row => row.userIsActive && row.projectId === projectId && row.roleKey === "material_staff").map(row => row.userId))];
    if (recipients.length) await tx.approvalActionLog.createMany({ skipDuplicates: true, data: recipients.map(recipientId => ({
      id: createHash("sha256").update(JSON.stringify([KIND, round.id, "purchase", recipientId])).digest("hex"),
      approvalInstanceId: round.id, actorUserId: round.applicantUserId, action: "system_notification", metadata: {
        kind: KIND, event: "queued", phase: "purchase", recipientId, projectId, businessCode, dutyName: "项目物资采购",
        link: "/零星材料采购"
      }
    })) });
  }

  /** Reconcile missing/replaced assignees after committed roster changes; only pending duties are enqueued. */
  async reconcilePending(): Promise<void> {
    if (this.busy || !this.sms.available()) return;
    this.busy = true;
    try {
      const rounds = await this.prisma.approvalInstance.findMany({
        where: { businessType: "spot_procurement_version", flowType: "spot_procurement.approve", status: { in: ["approval_pending", "approved"] } },
        orderBy: {id: "asc"}, take: 100, ...(this.cursor ? {cursor: {id: this.cursor}, skip: 1} : {})
      });
      this.cursor = rounds.length === 100 ? rounds.at(-1)!.id : undefined;
      for (const round of rounds) {
        if (!isParallelApprovalRound(round.frozenNodes)) continue;
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${round.id} FOR UPDATE`);
          const current = await tx.approvalInstance.findUnique({where: {id: round.id}});
          const business = current ? await this.currentBusiness(tx, current, current.status === "approved") : null;
          if (current && business) {
            if (current.status === "approved") await this.queuePurchaseInTransaction(tx, current, business.projectId, business.code);
            else await this.queueInTransaction(tx, current, business.projectId, business.code);
          }
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
        const purchase = data.phase === "purchase";
        const business = round ? await this.currentBusiness(tx, round, purchase) : null;
        const index = Number(data.nodeIndex);
        const node = round && isParallelApprovalRound(round.frozenNodes) ? round.frozenNodes[index] : null;
        const eligible = Boolean(round && business && (purchase || (node && activeApprovalNodeIndexes(round.frozenNodes, 0).includes(index))));
        const roles = purchase ? ["material_staff"] : node?.roleKeys as string[] ?? [];
        const assignments = eligible ? purchase
          ? await loadProjectApprovalAssignments(tx, business!.projectId, roles, String(data.recipientId))
          : await loadEffectiveProjectApprovalAssignments(tx, business!.projectId, roles, String(data.recipientId)) : [];
        const direct = assignments.some(row => row.userIsActive && row.userId === data.recipientId && roles.includes(row.roleKey));
        const delegated = !purchase && !direct && eligible ? await delegatedSpotApprovalIdentity(tx, {instanceId: round!.id, nodeIndex: index,
          actorUserId: String(data.recipientId), projectId: business!.projectId, pendingRoleKeys: node!.roleKeys as RoleKey[]}) : null;
        const user = direct || delegated
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
      const outcome = await this.sms.send(reservation.phone, reservation.data.phase === "purchase" ? "零星材料待采购" : "零采申请审批", String(reservation.data.dutyName), String(reservation.data.businessCode))
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

  private async currentBusiness(tx: Prisma.TransactionClient, round: ApprovalInstance, purchase = false) {
    if (round.businessType !== "spot_procurement_version" || round.status !== (purchase ? "approved" : "approval_pending") || !isParallelApprovalRound(round.frozenNodes)) return null;
    const version = await tx.spotProcurementVersion.findUnique({where: {id: round.businessId}});
    const business = version ? await tx.spotProcurement.findUnique({where: {id: version.procurementId}}) : null;
    return business && business.currentVersionId === round.businessId && business.status === (purchase ? "approved_in_progress" : "approval_pending") && (!purchase || version?.requestProtocolVersion === 2) && (!this.pilot || this.pilot.isEnabled(business.projectId)) ? business : null;
  }
}
