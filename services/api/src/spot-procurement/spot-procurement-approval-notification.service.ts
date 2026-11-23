import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { appendCorrectionIntentInTransaction } from "../approval/correction-notification-intent";
import { normalizeBusinessAmount, type RoleKey } from "@jiangkong/shared-domain";
import {activeSpotDutyMandates, delegatedSpotApprovalIdentity} from "../approval/spot-approval-duty-access";
import type { AuditDutyNoticeStatus } from "../approval/audit-duty-notification-delivery";
import { ConflictException, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type ApprovalActionLog, type ApprovalInstance } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { activeApprovalNodeIndexes, isParallelApprovalRound, SPOT_PARALLEL_NOTIFICATION_KIND } from "../approval/parallel-approval-protocol";
import { loadProjectApprovalAssignments, loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { currentSpotMaterialRoleKeys } from "./spot-procurement-material-role-scope";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

const KIND = SPOT_PARALLEL_NOTIFICATION_KIND;
const eventId = (intentId: string, stage: string) => createHash("sha256").update(JSON.stringify([KIND, intentId, stage])).digest("hex");
const retryId = (attemptId: string) => eventId(attemptId, "retry");
const originalId = (roundId: string, duty: unknown, recipient: unknown) => createHash("sha256").update(JSON.stringify([KIND, roundId, duty, recipient])).digest("hex");
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
        id: originalId(round.id, index, recipientId),
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
      id: originalId(round.id, "purchase", recipientId),
      approvalInstanceId: round.id, actorUserId: round.applicantUserId, action: "system_notification", metadata: {
        kind: KIND, event: "queued", phase: "purchase", recipientId, projectId, businessCode, dutyName: "项目物资采购",
        link: "/零星材料采购"
      }
    })) });
  }

  async queueCorrectionInTransaction(tx: Prisma.TransactionClient,
    round: Pick<ApprovalInstance, "id" | "applicantUserId">, draftVersionId: string, nodeIndex: number): Promise<void> {
    const recipientId = round.applicantUserId;
    await appendCorrectionIntentInTransaction(tx, {
      kind: KIND,
      roundId: round.id,
      actorUserId: recipientId,
      recipientId,
      dutyName: "原采购人修改并重新提交",
      nodeIndex,
      extra: { draftVersionId }
    });
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
          const snapshot = current ? await this.currentBusiness(tx, current, current.status === "approved") : null;
          if (current && snapshot) {
            const {business} = snapshot;
            if (current.status === "approved") await this.queuePurchaseInTransaction(tx, current, business.projectId, business.code);
            else await this.queueInTransaction(tx, current, business.projectId, business.code);
          }
        });
      }
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
      const requested = await tx.approvalActionLog.findUnique({ where: { id: attemptId } });
      if (!requested || metadata(requested.metadata).recipientId !== actorId) {
        throw new ConflictException("当前没有可重试的零采待办短信");
      }
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${requested.approvalInstanceId} FOR UPDATE`);
      const notice = (await this.currentNotices(tx, id, actorId)).find(item => item.chain.includes(attemptId));
      if (!notice) throw new ConflictException("当前没有可重试的零采待办短信");
      if (notice.attempt.id !== attemptId) return { kind: "replay", status: notice.status } as const;
      if (!notice.status.canRetry) throw new ConflictException("仅可重试明确发送失败的零采待办短信");
      const queuedId = retryId(attemptId);
      await tx.approvalActionLog.createMany({ skipDuplicates: true, data: [{
        id: queuedId, approvalInstanceId: notice.attempt.approvalInstanceId, actorUserId: notice.attempt.actorUserId,
        action: "system_notification",
        metadata: { ...metadata(notice.attempt.metadata), originalId: notice.chain[0], retryOf: attemptId }
      }] });
      return { kind: "new", queuedId } as const;
    });
    if (next.kind === "replay") return next.status;
    await this.dispatchQueued(next.queuedId);
    const { notices } = await this.status(id, actorId);
    const result = notices.find(notice => notice.attemptId === next.queuedId);
    if (!result) throw new ConflictException("零采待办已变更，请刷新后查看");
    return result;
  }

  private async currentNotices(tx: Prisma.TransactionClient, id: string, actorId: string) {
    const business = await tx.spotProcurement.findUnique({ where: { id } });
    if (!business?.currentVersionId) return [];
    let sourceId = business.currentVersionId;
    if (business.status === "draft") {
      const draft = await tx.spotProcurementVersion.findUnique({ where: { id: sourceId } });
      if (!draft || draft.versionNo < 2 || draft.requestProtocolVersion !== 2) return [];
      const source = await tx.spotProcurementVersion.findUnique({
        where: { procurementId_versionNo: { procurementId: id, versionNo: draft.versionNo - 1 } }
      });
      if (!source) return [];
      sourceId = source.id;
    }
    const round = await tx.approvalInstance.findFirst({ where: {
      businessType: "spot_procurement_version", businessId: sourceId, flowType: "spot_procurement.approve",
      status: { in: ["approval_pending", "approved", "rejected", "returned_to_applicant"] }
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!round) return [];
    const events = await tx.approvalActionLog.findMany({ where: {
      approvalInstanceId: round.id, action: "system_notification", AND: [
        { metadata: { path: ["kind"], equals: KIND } },
        { metadata: { path: ["recipientId"], equals: actorId } }
      ]
    } });
    const byId = new Map(events.map(event => [event.id, event]));
    const notices = [];
    for (const original of events) {
      const data = metadata(original.metadata);
      if (original.approvalInstanceId !== round.id || data.recipientId !== actorId || !this.isOriginal(original)) continue;
      const current = await this.currentRecipient(tx, round, data);
      if (current?.business.id !== id) continue;
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
    return notices.sort((a, b) => Number(metadata(a.attempt.metadata).nodeIndex) - Number(metadata(b.attempt.metadata).nodeIndex));
  }

  private attemptStatus(attempt: ApprovalActionLog, events: Map<string, ApprovalActionLog>): AuditDutyNoticeStatus & { dutyName: string } {
    const terminal = events.get(eventId(attempt.id, "terminal"));
    const receipt = metadata(terminal?.metadata);
    const origin = metadata(attempt.metadata);
    const event = receipt.intentId === attempt.id && ["phase", "nodeIndex", "recipientId", "projectId", "businessCode", "dutyName", "draftVersionId", "originalId", "retryOf"]
      .every(key => receipt[key] === origin[key]) ? receipt.event : undefined;
    const claimed = events.has(eventId(attempt.id, "dispatch_claimed"));
    const status = event === "failed" || event === "accepted" || event === "cancelled" || event === "unknown"
      ? event : claimed || terminal ? "unknown" : "queued";
    return { attemptId: attempt.id, status, canRetry: status === "failed" && this.sms.available(), dutyName: String(metadata(attempt.metadata).dutyName) };
  }

  private isOriginal(intent: ApprovalActionLog) {
    const data = metadata(intent.metadata);
    return intent.action === "system_notification" && data.kind === KIND && data.event === "queued" && !data.retryOf && !data.originalId
      && intent.id === originalId(intent.approvalInstanceId, data.phase ?? data.nodeIndex, data.recipientId);
  }

  private matchesRetry(retry: ApprovalActionLog, previous: ApprovalActionLog, original: ApprovalActionLog) {
    const data = metadata(retry.metadata);
    const frozen = metadata(original.metadata);
    return retry.id === retryId(previous.id) && retry.action === original.action && retry.approvalInstanceId === original.approvalInstanceId
      && retry.actorUserId === original.actorUserId && data.kind === KIND && data.event === "queued" && data.originalId === original.id
      && data.retryOf === previous.id && ["phase", "nodeIndex", "recipientId", "projectId", "dutyName", "businessCode", "draftVersionId"].every(key => data[key] === frozen[key]);
  }

  async dispatchQueued(attemptId?: string): Promise<void> {
    if (!this.sms.available()) return;
    const queued = await this.prisma.$queryRaw<ApprovalActionLog[]>(Prisma.sql`
      SELECT queued.* FROM "ApprovalActionLog" queued
      WHERE queued."action" = 'system_notification' AND queued."metadata"->>'kind' = ${KIND}
        AND queued."metadata"->>'event' = 'queued'
        ${attemptId ? Prisma.sql`AND queued."id" = ${attemptId}` : Prisma.empty}
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
        const snapshot = round ? await this.currentRecipient(tx, round, data) : null;
        if (!snapshot || (!this.isOriginal(fresh) && !(await this.currentNotices(tx, snapshot.business.id, String(data.recipientId)))
          .some(notice => notice.attempt.id === intent.id && notice.status.status === "queued"))) {
          await this.appendEvent(tx, intent, "cancelled", data);
          return null;
        }
        const {business: current, version} = snapshot;
        const user = await tx.user.findUnique({ where: { id: String(data.recipientId) }, select: { phone: true } });
        const correction = data.phase === "correction";
        const purchase = data.phase === "purchase";
        const project = await tx.project.findUnique({where:{id:current.projectId},select:{name:true}});
        const estimate = normalizeBusinessAmount(version.estimatedTotalAmount?.toString() ?? null);
        const message: ApprovalDutySmsIntent = {
          businessLabel:correction ? "零采申请退回修改" : purchase ? "零星材料待采购" : "零采申请审批",dutyName:String(data.dutyName),businessCode:current.code,
          scopeName:project?.name ?? "项目名称待核对",initiatorName:version.applicationNameSnapshot,
          subject:version.reason,participants:[
            ...(version.purchaserNameSnapshot ? [`采购人：${version.purchaserNameSnapshot}`] : []),
            ...(version.supplierNameSnapshot ? [`供应商：${version.supplierNameSnapshot}`] : []),
          ],
          amountText:estimate === null ? "待确定" : `预计 ${estimate} 元`,
          targetPath:approvalDutyTarget("spotProcurement",current.id),
        };
        const claimResult = await this.appendEvent(tx, intent, "dispatch_claimed", data);
        return claimResult.count === 1 ? {phone: user?.phone ?? "", data, message} : null;
      });
      if (!reservation) continue;
      // Reservation was committed before the external boundary. Crash/unknown stays non-retryable.
      const outcome = await this.sms.sendDutyIntent(reservation.phone,reservation.message)
        .catch(() => ({status: "unknown" as const, message: "短信发送结果待确认，请勿重复发送"}));
      await this.appendEvent(this.prisma, intent, outcome.status, {
        ...reservation.data, message: outcome.message,
        ...("receipt" in outcome && outcome.receipt ? {receipt: outcome.receipt} : {})
      });
    }
  }

  private async currentRecipient(tx: Prisma.TransactionClient, round: ApprovalInstance, data: Prisma.InputJsonObject) {
    if (round.flowType !== "spot_procurement.approve" || typeof data.recipientId !== "string" || (data.phase !== undefined && data.phase !== "correction" && data.phase !== "purchase")) return null;
    const purchase = data.phase === "purchase";
    const correction = data.phase === "correction";
    const snapshot = correction ? await this.currentCorrection(tx, round, data) : await this.currentBusiness(tx, round, purchase);
    if (!snapshot || (!correction && data.projectId !== snapshot.business.projectId)) return null;
    const { business } = snapshot;
    const index = Number(data.nodeIndex);
    const node = isParallelApprovalRound(round.frozenNodes) ? round.frozenNodes[index] : null;
    const eligible = !correction && (purchase || (node && activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).includes(index)));
    const roles = purchase ? ["material_staff"] : node?.roleKeys as string[] ?? [];
    const assignments = eligible ? purchase
      ? await loadProjectApprovalAssignments(tx, business.projectId, roles, String(data.recipientId))
      : await loadEffectiveProjectApprovalAssignments(tx, business.projectId, roles, String(data.recipientId)) : [];
    const direct = assignments.some(row => row.userIsActive && row.userId === data.recipientId && roles.includes(row.roleKey) && (!purchase || row.projectId === business.projectId));
    const delegated = !purchase && !direct && eligible ? await delegatedSpotApprovalIdentity(tx, {instanceId: round.id, nodeIndex: index,
      actorUserId: String(data.recipientId), projectId: business.projectId, pendingRoleKeys: node!.roleKeys as RoleKey[]}) : null;
    const user = correction || direct || delegated
      ? await tx.user.findUnique({ where: { id: data.recipientId }, select: { isActive: true } }) : null;
    return user?.isActive ? snapshot : null;
  }

  private appendEvent(client: Pick<Prisma.TransactionClient, "approvalActionLog">, intent: ApprovalActionLog,
    event: "dispatch_claimed" | "accepted" | "failed" | "unknown" | "cancelled", data: Prisma.InputJsonObject) {
    return client.approvalActionLog.createMany({skipDuplicates: true, data: [{
      id: eventId(intent.id, event === "dispatch_claimed" ? event : "terminal"), approvalInstanceId: intent.approvalInstanceId,
      actorUserId: intent.actorUserId, action: "system_notification", metadata: {...data, kind: KIND, intentId: intent.id, event}
    }]});
  }

  private async currentCorrection(tx: Prisma.TransactionClient, round: ApprovalInstance, data: Prisma.InputJsonObject) {
    if (round.businessType !== "spot_procurement_version" || !["rejected", "returned_to_applicant"].includes(round.status)
      || data.recipientId !== round.applicantUserId || typeof data.draftVersionId !== "string") return null;
    const source = await tx.spotProcurementVersion.findUnique({where: {id: round.businessId}});
    if (source?.requestProtocolVersion !== 2 || source.status !== "returned") return null;
    const business = await tx.spotProcurement.findUnique({where: {id: source.procurementId}});
    if (!business || business.status !== "draft" || business.currentVersionId !== data.draftVersionId
      || business.applicantUserId !== round.applicantUserId || business.handlerUserId !== round.applicantUserId
      || (this.pilot && !this.pilot.isEnabled(business.projectId))) return null;
    const version = await tx.spotProcurementVersion.findUnique({where: {id: data.draftVersionId}});
    if (!version || version.status !== "draft" || version.requestProtocolVersion !== 2 || version.procurementId !== business.id
      || version.versionNo !== source.versionNo + 1 || version.handlerUserId !== round.applicantUserId) return null;
    const allowedRoles = ["material_staff", "material_director"] as const;
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, business.projectId, allowedRoles, round.applicantUserId);
    const roles = allowedRoles.filter(role => assignments.some(row => row.userIsActive && row.roleKey === role && row.userId === round.applicantUserId && row.projectId === business.projectId));
    return (await currentSpotMaterialRoleKeys(tx, round.applicantUserId, roles)).length ? {business, version} : null;
  }

  private async currentBusiness(tx: Prisma.TransactionClient, round: ApprovalInstance, purchase = false) {
    if (round.businessType !== "spot_procurement_version" || round.status !== (purchase ? "approved" : "approval_pending") || !isParallelApprovalRound(round.frozenNodes)) return null;
    const version = await tx.spotProcurementVersion.findUnique({where: {id: round.businessId}});
    const business = version ? await tx.spotProcurement.findUnique({where: {id: version.procurementId}}) : null;
    return version && business && business.currentVersionId === round.businessId && business.status === (purchase ? "approved_in_progress" : "approval_pending") && (!purchase || version.requestProtocolVersion === 2) && (!this.pilot || this.pilot.isEnabled(business.projectId)) ? {business,version} : null;
  }
}
