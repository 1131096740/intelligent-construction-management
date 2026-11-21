import { ConflictException, ForbiddenException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Prisma, AuditLog } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { FundBalanceNoticeWorker } from "./fund-balance-notice-worker";
import { fundBalanceNoticeLocks, prepareFundBalanceNoticeAudit, type FundNoticeLock, type NoticeLockOperation } from "./fund-balance-notice-locks";
import { resolveFreshCorrectionRecipient, resolveFundReviewIdentity } from "./fund-account-duty";

const metadata = (intent: AuditLog) => (intent.metadata ?? {}) as Prisma.JsonObject;
const kind = "fund_balance_review_duty_notification";

@Injectable()
export class FundBalanceReviewNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FundBalanceReviewNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: ApprovalSmsService,
    private readonly worker: FundBalanceNoticeWorker
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available() || !this.worker.client) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, registrationId: string, roundId: string, actorUserId: string, freshControlledRound = false) {
    const positions = await tx.position.findMany({where: {key: "finance_director"}, select: {id: true}});
    const assignments = await tx.userPosition.findMany({
      where: {projectId: null, positionId: {in: positions.map(position => position.id)}}, select: {userId: true}
    });
    const eligible = [];
    for (const recipientId of new Set(assignments.map(assignment => assignment.userId))) {
      if (await this.currentDuty(tx, registrationId, roundId, recipientId, freshControlledRound)) eligible.push(recipientId);
    }
    if (eligible.length) await tx.auditLog.createMany({skipDuplicates: true, data: eligible.map(recipientId => ({
      id: auditDutyNoticeId(kind, roundId, recipientId), actorUserId, action: "queued", businessType: kind,
      businessId: registrationId, metadata: {recipientId, roundId}
    }))});
  }

  async status(registrationId: string, actorId: string) {
    return { notice: await auditDutyNoticeStatus(this.noticeAccess(), registrationId, actorId) };
  }

  async retry(registrationId: string, actorId: string, attemptId: string, expectedRoundId: string) {
    const result = await retryFailedAuditDutyNotice(this.noticeAccess({ attemptId, expectedRoundId, actorId }), registrationId, actorId, attemptId);
    if (!result.enqueued) return result.status;
    await this.afterCommit();
    const { notice } = await this.status(registrationId, actorId);
    return notice ?? result.status;
  }

  async afterCommit() {
    try {
      if (!this.worker.client) return;
      await dispatchAuditDutyNotices(this.worker.client, this.sms, kind,
        async (tx, id, intent) => {
          const lock = this.locks(tx, "dispatch", id, intent);
          return lock ? lock("round") : false;
        },
        (tx, intent) => this.currentMessage(tx, intent), prepareFundBalanceNoticeAudit);
    } catch {
      this.logger.warn("资金余额复核通知暂未完成，保留记录以供核对");
    }
  }

  private noticeAccess(retry?: { attemptId: string; expectedRoundId: string; actorId: string }) {
    return {
      prisma: this.prisma, sms: { available: () => Boolean(this.worker.client) && this.sms.available() }, kind,
      lockDuty: async (tx: Prisma.TransactionClient, registrationId: string) => {
        if (retry && !await fundBalanceNoticeLocks(tx, "retry", registrationId, retry.expectedRoundId,
          retry.attemptId, retry.actorId)("round")) {
          throw new ConflictException("当前待办或短信记录已变化，请刷新");
        }
      },
      prepareAudit: prepareFundBalanceNoticeAudit,
      canAccess: async (tx: Prisma.TransactionClient, intent: AuditLog) =>
        (retry === undefined || metadata(intent).roundId === retry.expectedRoundId) &&
        Boolean(await this.currentNoticeDuty(tx, intent, retry ? "retry" : "status")),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent)
    };
  }

  private locks(tx: Prisma.TransactionClient, operation: NoticeLockOperation, registrationId: string, intent: AuditLog) {
    const { recipientId, roundId } = metadata(intent);
    if (typeof recipientId !== "string" || typeof roundId !== "string") return null;
    return fundBalanceNoticeLocks(tx, operation, registrationId, roundId, intent.id, recipientId);
  }

  private async currentNoticeDuty(tx: Prisma.TransactionClient, intent: AuditLog, operation: NoticeLockOperation) {
    const { recipientId, roundId } = metadata(intent);
    if (!intent.businessId || typeof recipientId !== "string" || typeof roundId !== "string") return null;
    const lock = this.locks(tx, operation, intent.businessId, intent);
    if (!lock) return null;
    const duty = await this.currentDuty(tx, intent.businessId, roundId, recipientId, false, lock);
    if (!duty || duty.round.id !== roundId) return null;
    const originalId = auditDutyNoticeId(kind, roundId, recipientId);
    const checked = new Set<string>();
    let attempt = intent;
    for (;;) {
      const data = metadata(attempt);
      if (checked.has(attempt.id) || attempt.action !== "queued" || attempt.businessId !== intent.businessId
        || attempt.businessType !== kind || data.recipientId !== recipientId || data.roundId !== roundId) return null;
      if (attempt.id === originalId) return data.retryOf === undefined ? duty : null;
      if (typeof data.retryOf !== "string" || attempt.id !== auditDutyNoticeId(kind, data.retryOf, "retry")) return null;
      checked.add(attempt.id);
      const [previous, terminal] = await Promise.all([
        tx.auditLog.findUnique({ where: { id: data.retryOf } }),
        tx.auditLog.findUnique({ where: { id: auditDutyNoticeId(kind, data.retryOf, "terminal") } })
      ]);
      if (!previous || !terminal || terminal.action !== "failed" || terminal.businessType !== kind
        || terminal.businessId !== intent.businessId || metadata(terminal).intentId !== previous.id) return null;
      attempt = previous;
    }
  }

  private async currentDuty(tx: Prisma.TransactionClient, registrationId: string, roundId: string, recipientId: string, freshControlledRound = false, noticeLock?: FundNoticeLock) {
    try {
      return await (freshControlledRound
        ? resolveFreshCorrectionRecipient(tx, registrationId, roundId, recipientId)
        : noticeLock
          ? resolveFundReviewIdentity(tx, registrationId, recipientId, roundId, false, noticeLock)
          : resolveFundReviewIdentity(tx, registrationId, recipientId, roundId));
    }
    catch (error) {
      if (error instanceof ForbiddenException || error instanceof ConflictException) return null;
      throw error;
    }
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const duty = await this.currentNoticeDuty(tx, intent, "dispatch");
    const { recipientId } = metadata(intent);
    if (!duty || !intent.businessId || typeof recipientId !== "string") return null;
    const [recipient, applicant, company] = await Promise.all([
      tx.user.findUnique({where: {id: recipientId}, select: {phone: true, isActive: true}}),
      tx.user.findUnique({where: {id: duty.row.createdByUserId}, select: {name: true}}),
      duty.account.companyEntityId
        ? tx.companyEntity.findUnique({where: {id: duty.account.companyEntityId}, select: {name: true}}) : null
    ]);
    if (!recipient?.isActive) return null;
    return {phone: recipient.phone ?? "", intent: {
      businessLabel: "资金余额更正", dutyName: "复核余额更正", businessCode: `余额更正第 ${duty.row.version} 版`,
      scopeName: duty.account.companyEntityId ? company?.name ?? "公司资金账户" : "公共现金",
      initiatorName: applicant?.name ?? "发起人待核对", subject: "核对登记余额更正",
      participants: company ? [company.name] : [],
      amountText: duty.row.balanceYuan === null ? "余额待核对" : `${duty.row.balanceYuan.toFixed(4)} 元`,
      targetPath: approvalDutyTarget("fundBalanceReview", intent.businessId)
    }};
  }
}
