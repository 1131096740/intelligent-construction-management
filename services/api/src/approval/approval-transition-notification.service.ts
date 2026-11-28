import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice
} from "./audit-duty-notification-delivery";
import { ApprovalProgressService } from "./approval-progress.service";
import { ApprovalSmsService } from "./approval-sms.service";

const kind = "approval_transition_duty_notification";

@Injectable()
export class ApprovalTransitionNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(ApprovalTransitionNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: ApprovalSmsService,
    private readonly progress: ApprovalProgressService
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, roundId: string, actorUserId: string, correction = false) {
    const duties = await this.progress.transitionSmsDuties(tx, roundId, correction);
    const data = duties.flatMap(({ duty, recipients }) => recipients.map(({ id: recipientId }) => ({
      id: auditDutyNoticeId(kind, roundId, String(duty), recipientId),
      action: "queued", businessType: kind, businessId: roundId, actorUserId,
      metadata: { duty, recipientId }
    })));
    return data.length > 0 && (await tx.auditLog.createMany({ skipDuplicates: true, data })).count > 0;
  }

  async afterCommit() {
    try {
      await dispatchAuditDutyNotices(this.prisma, this.sms, kind,
        (tx, id) => this.lockRound(tx, id), (tx, intent) => this.currentMessage(tx, intent));
    } catch {
      this.logger.warn("审批待办短信暂未完成，保留记录以供核对");
    }
  }

  status(roundId: string, actorId: string) {
    return auditDutyNoticeStatus(this.noticeAccess(), roundId, actorId);
  }

  async retry(roundId: string, actorId: string, attemptId: string) {
    const result = await retryFailedAuditDutyNotice(this.noticeAccess(), roundId, actorId, attemptId);
    if (result.enqueued) await this.afterCommit();
    return (await this.status(roundId, actorId)) ?? result.status;
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: (tx: Prisma.TransactionClient, id: string) => this.lockRound(tx, id),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent)
    };
  }

  private async lockRound(tx: Prisma.TransactionClient, id: string) {
    const round = await tx.approvalInstance.findUnique({ where: { id }, select: { businessType: true, businessId: true } });
    if (!round) return;
    const businessId = round.businessId;
    switch (round.businessType) {
      case "project_expense_request":
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectExpenseRequest" WHERE "id" = ${businessId} FOR UPDATE`);
        break;
      case "project_financing_quota":
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectFinancingQuota" WHERE "id" = ${businessId} FOR UPDATE`);
        break;
      case "project_settlement_exception_quota":
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectSettlementExceptionQuota" WHERE "id" = ${businessId} FOR UPDATE`);
        break;
      case "fund_execution_case":
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FundExecutionCase" WHERE "caseKey" = ${businessId}
          ORDER BY "revision" DESC LIMIT 1 FOR UPDATE`);
        break;
      default:
        return;
    }
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${id} FOR UPDATE`);
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog) {
    const data = intent.metadata as Prisma.JsonObject | null;
    if (!intent.businessId || typeof data?.recipientId !== "string" ||
        (data.duty !== "correction" && typeof data.duty !== "number")) return null;
    const duties = await this.progress.transitionSmsDuties(tx, intent.businessId, data.duty === "correction");
    const user = duties.find(row => row.duty === data.duty)?.recipients.find(row => row.id === data.recipientId);
    return user ? { phone: user.phone ?? "" } : null;
  }
}
