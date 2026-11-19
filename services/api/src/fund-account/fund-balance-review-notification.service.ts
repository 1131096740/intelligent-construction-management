import { ConflictException, ForbiddenException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { resolveFundReviewIdentity } from "./fund-account-duty";

const metadata = (intent: AuditLog) => (intent.metadata ?? {}) as Prisma.JsonObject;
const kind = "fund_balance_review_duty_notification";

@Injectable()
export class FundBalanceReviewNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FundBalanceReviewNotificationService.name);

  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, registrationId: string, roundId: string, actorUserId: string) {
    const positions = await tx.position.findMany({where: {key: "finance_director"}, select: {id: true}});
    const assignments = await tx.userPosition.findMany({
      where: {projectId: null, positionId: {in: positions.map(position => position.id)}}, select: {userId: true}
    });
    const eligible = [];
    for (const recipientId of new Set(assignments.map(assignment => assignment.userId))) {
      if (await this.currentDuty(tx, registrationId, roundId, recipientId)) eligible.push(recipientId);
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
    const result = await retryFailedAuditDutyNotice(this.noticeAccess(expectedRoundId), registrationId, actorId, attemptId);
    if (!result.enqueued) return result.status;
    await this.afterCommit();
    const { notice } = await this.status(registrationId, actorId);
    return notice ?? result.status;
  }

  async afterCommit() {
    try {
      const access = this.noticeAccess();
      await dispatchAuditDutyNotices(this.prisma, this.sms, kind, access.lockDuty, access.currentMessage);
    } catch {
      this.logger.warn("资金余额复核通知暂未完成，保留记录以供核对");
    }
  }

  private noticeAccess(expectedRoundId?: string) {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: async (tx: Prisma.TransactionClient, registrationId: string) => {
        await tx.$queryRaw(Prisma.sql`SELECT a."id" FROM "ApprovalInstance" a
          JOIN "FundAccountBalanceRegistration" r ON r."approvalInstanceId" = a."id"
          WHERE r."id" = ${registrationId} FOR UPDATE OF a`);
      },
      canAccess: async (tx: Prisma.TransactionClient, intent: AuditLog) => (expectedRoundId === undefined || metadata(intent).roundId === expectedRoundId) && Boolean(await this.currentNoticeDuty(tx, intent)),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent)
    };
  }

  private async currentNoticeDuty(tx: Prisma.TransactionClient, intent: AuditLog) {
    const { recipientId, roundId } = metadata(intent);
    if (!intent.businessId || typeof recipientId !== "string" || typeof roundId !== "string") return null;
    const duty = await this.currentDuty(tx, intent.businessId, roundId, recipientId);
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

  private async currentDuty(tx: Prisma.TransactionClient, registrationId: string, roundId: string, recipientId: string) {
    try { return await resolveFundReviewIdentity(tx, registrationId, recipientId, roundId); }
    catch (error) {
      if (error instanceof ForbiddenException || error instanceof ConflictException) return null;
      throw error;
    }
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const duty = await this.currentNoticeDuty(tx, intent);
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
